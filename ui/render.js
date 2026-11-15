// Pure layout computation + a thin canvas painter. Layout centers the
// current room; only the current z-level is drawn, and a room that leads up
// or down is marked (floors.js).

import { isCompass, vector, reverse } from "./directions.js";
import { floorMarks } from "./floors.js";
import { getAreaByKey } from "./graph.js";
import {
  fillColor, roomGlyph, regionColor, regionName, inkOn, envColor, areaRegionColor, areaRegionType,
  elevationRange, shadeAmount, shadeColor, exitStyle, strongerStyle,
} from "./annotate.js";
import { reliefArea, paintRelief } from "./relief.js";

export { envColor };

// Room names are drawn at these cell sizes and up (the two largest zooms);
// region names and glyphs need less room.
export const NAME_LABEL_MIN_SCALE = 44;
export const REGION_LABEL_MIN_SCALE = 24;
export const GLYPH_MIN_ROOM = 12;

// `shade` lightens or darkens each room with an elevation by where it sits
// between the lowest and highest rooms on the floor drawn (annotate.js); the
// layout's `elevation` is that range, or null where no room on it has one.
// `relief` is what draw() needs to paint the ground relief (relief.js) under
// everything, or null where the floor has no grid and fewer than two rooms
// with an elevation; it's there with `shade` off too (with `on` false), so
// the toggle still shows.
export function computeLayout(map, { cx, cy, scale, areaId, viewedZ = null, path = null, anchorId = null, shade = true }) {
  const cur = map.currentId != null ? map.rooms[map.currentId] : null;
  const viewArea = areaId != null ? areaId : (cur ? cur.areaId : null);

  // Anchor precedence: an explicit in-area anchorId, else the current room if
  // it's in the viewed area, else the area's first room.
  let anchor = null;
  if (anchorId != null && map.rooms[anchorId] && map.rooms[anchorId].areaId === viewArea) {
    anchor = map.rooms[anchorId];
  }
  if (!anchor) anchor = cur && cur.areaId === viewArea ? cur : null;
  if (!anchor) {
    const ids = Object.keys(map.rooms)
      .filter((id) => map.rooms[id].areaId === viewArea)
      .sort((a, b) => Number(a) - Number(b));
    anchor = ids.length ? map.rooms[ids[0]] : null;
  }
  if (!anchor) return { rooms: [], exits: [], stubs: [], patches: [], regions: [], elevation: null, scale };
  const z = viewedZ != null ? viewedZ : anchor.coords.z;

  const pathRooms = path && path.rooms ? path.rooms : null;
  const pathEdges = path && path.edges ? path.edges : null;

  const onFloor = Object.keys(map.rooms).map((id) => map.rooms[id])
    .filter((r) => r.areaId === viewArea && r.coords.z === z);
  // Worked out once per layout, not per room drawn.
  const elevation = elevationRange(onFloor);
  const rooms = [];
  const placed = {};
  for (const r of onFloor) {
    const id = r.id;
    const base = fillColor(map, r);
    const cell = viewCell(r, anchor);
    const px = cx + (cell.x - anchor.coords.x) * scale;
    const py = cy + (cell.y - anchor.coords.y) * scale;
    placed[id] = { px, py, cell, wrapX: r.wrapX };
    const marks = floorMarks(map, r);
    rooms.push({
      id, px, py, cell,
      isCurrent: cur != null && id === cur.id,
      // Sent in a chart, not yet visited (chart.js): drawn faded.
      charted: !!r.charted,
      onPath: pathRooms ? pathRooms.has(id) : false,
      env: r.env,
      name: r.name || "",
      // The glyph's ink is worked out from this, so it reads on the shade.
      fill: shade && elevation ? shadeColor(base, shadeAmount(r.elevation, elevation)) : base,
      glyph: roomGlyph(r, map),
      region: r.region || null,
      up: marks.up,
      down: marks.down,
      link: marks.link,
    });
  }

  // Each exit line carries the direction it leaves each room by (dir1 from
  // the x1/y1 end, dir2 from the other; null where that room has no exit
  // back), so draw() can start it from that side of the room.
  const exits = [];
  const seen = new Set();
  const drawn = new Set();   // `${id}|${dir}` of exits a line already shows
  const joins = [];          // drawn lines between two rooms of one region (regionLayout)
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (!placed[id]) continue;
    for (const dir of Object.keys(r.exits)) {
      // in/out (and any other vectorless exit) route but aren't drawn: the
      // room through a hatch sits wherever it was placed, not beside its door.
      if (!isCompass(dir)) continue;
      const to = r.exits[dir].to;
      if (to == null || !placed[to]) continue;
      const key = id < to ? `${id}|${to}` : `${to}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const back = backDir(map.rooms[to], id, dir);
      drawn.add(`${id}|${dir}`);
      if (back) drawn.add(`${to}|${back}`);
      const a = placed[id], b = placed[to];
      const onPath = pathEdges ? pathEdges.has(key) : false;
      // Drawn once, so where its ends disagree the stronger style shows.
      const style = strongerStyle(exitStyle(r, dir), back ? exitStyle(map.rooms[to], back) : "path");
      const styled = style === "path" ? {} : { style };
      const step = wrapStep(a, b);
      if (r.region && r.region === map.rooms[to].region) joins.push({ a: id, b: to, step });
      if (step == null) {
        // With no way back at all it's one way, drawn with an arrow into `to`.
        const oneWay = !back && !leadsTo(map.rooms[to], id);
        exits.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, dir1: dir, dir2: back, onPath, oneWay, ...styled });
      } else {
        // Across the far side of a ring from the view's centre: each end runs
        // off the edge toward where the other comes round, not across the map.
        exits.push({ x1: a.px, y1: a.py, x2: a.px + step * scale, y2: b.py, dir1: dir, dir2: null, onPath, seam: true, ...styled });
        exits.push({ x1: b.px, y1: b.py, x2: b.px - step * scale, y2: a.py, dir1: back, dir2: null, onPath, seam: true, ...styled });
      }
    }
  }

  // A short stub for each way out on this floor that no line shows: one not
  // taken yet (`unexplored`: the room lists it, the map doesn't know where it
  // goes), or one to a room not in view (another area or floor).
  const stubs = [];
  for (const id of Object.keys(placed)) {
    const r = map.rooms[id];
    const p = placed[id];
    for (const dir of exitDirsOf(r)) {
      const v = vector(dir);
      if (!v || (v.dx === 0 && v.dy === 0) || drawn.has(`${id}|${dir}`)) continue;
      const ex = r.exits[dir];
      if (ex && ex.to != null && placed[ex.to]) continue;   // a line, shown from the other end
      const target = ex && ex.to != null ? map.rooms[ex.to] : null;
      if (!target) {
        // Not taken yet, but the server says which area it leads to: a card
        // naming it, as for a room on the map in another area.
        const out = r.exitAreas && r.exitAreas[dir];
        if (out) { stubs.push({ px: p.px, py: p.py, dir, from: r.id, unexplored: false, ...unmapped(map, out) }); continue; }
        stubs.push({ px: p.px, py: p.py, dir, unexplored: true });
        continue;
      }
      stubs.push({
        px: p.px, py: p.py, dir, from: r.id, unexplored: false,
        oneWay: !leadsTo(target, r.id),
        ...elsewhere(map, r, target),
      });
    }
  }

  const { patches, regions } = regionLayout(map, rooms, joins, viewArea, scale);
  const relief = reliefView(map, onFloor, viewArea, z, anchor, cx, cy, scale, shade);
  return { rooms, exits, stubs, patches, regions, elevation, relief, scale };
}

// The relief to draw for this floor: the area's grid for it, if any, and the
// rooms with an elevation (for the estimate where no grid is near), at the
// x they're drawn at on a ring. `roomsSig` lets the painter's cache tell
// when those rooms change.
function reliefView(map, onFloor, areaId, z, anchor, cx, cy, scale, on) {
  const key = reliefArea(map.areas && map.areas[areaId]);
  const grid = (key && map.relief && map.relief[key] && map.relief[key][z]) || null;
  const rooms = [];
  let wrapX = null;
  for (const r of onFloor) {
    if (r.wrapX && !wrapX) wrapX = r.wrapX;
    if (!Number.isFinite(r.elevation)) continue;
    const c = viewCell(r, anchor);
    rooms.push({ x: c.x, y: c.y, e: r.elevation });
  }
  if (!grid && rooms.length < 2) return null;
  return {
    on, grid, rooms, wrapX, cx, cy, scale,
    anchor: { x: anchor.coords.x, y: anchor.coords.y },
    roomsSig: rooms.map((r) => `${r.x},${r.y},${r.e}`).join(";"),
    groundColor: (id) => fillColor(map, { env: id }),
  };
}

// Where a stub to a room out of view leads, for its card: another area (by
// the area's name), or another floor of this one (by the room's name, with
// an arrow for up or down).
function elsewhere(map, from, to) {
  if (to.areaId !== from.areaId) {
    const area = map.areas && map.areas[to.areaId];
    return { to: to.id, kind: "area", label: (area && area.label) || to.name || `#${to.id}` };
  }
  const up = to.coords.z > from.coords.z;
  return { to: to.id, kind: "floor", up, label: `${up ? "↑" : "↓"} ${to.name || `#${to.id}`}` };
}

// Where an exit not taken yet leads, by the area the server said: that area
// as the map knows it, by your label for it, where you've been there before,
// else by the server's name. `to` is null: there's no room to go to.
function unmapped(map, out) {
  const known = map.areaKeyIndex ? getAreaByKey(map, "zone:" + out.tag) : null;
  return { to: null, kind: "area", unmapped: true, label: (known && known.label) || out.name };
}

// The direction `room` leads back to `toId` by: the reverse of `dir` where
// that's what it has, else any compass exit of its that leads there.
function backDir(room, toId, dir) {
  const rev = reverse(dir);
  if (rev && room.exits[rev] && room.exits[rev].to === toId) return rev;
  for (const d of Object.keys(room.exits)) {
    if (isCompass(d) && room.exits[d].to === toId) return d;
  }
  return null;
}

// Whether `room` has any way to `toId`: an exit by any direction (up, down,
// in, out as well as across the floor) or a link.
function leadsTo(room, toId) {
  if (!room) return false;
  if (Object.values(room.exits).some((ex) => ex && ex.to === toId)) return true;
  return !!(room.links && room.links[toId]);
}

// Every direction a room has a way out by: its exits on the map, and the ones
// it last listed (mudstd `exitKeys`, a captured room's `exitDirs`), walked or not.
function exitDirsOf(r) {
  const out = new Set(Object.keys(r.exits));
  for (const d of Object.keys(r.exitKeys || {})) out.add(d);
  for (const d of r.exitDirs || []) out.add(d);
  return [...out];
}

// Where an exit by `dir` leaves a room drawn at (px, py): the middle of that
// side, or that corner for a diagonal, and the way it points from there.
// Null for a direction with no way across the floor (u, d, in, out).
export function exitPort(px, py, dir, half) {
  const v = dir ? vector(dir) : null;
  if (!v || (v.dx === 0 && v.dy === 0)) return null;
  const len = Math.hypot(v.dx, v.dy);
  return { x: px + v.dx * half, y: py + v.dy * half, ux: v.dx / len, uy: v.dy / len };
}

// Where a line with no direction at this end meets the room's square, facing
// the point it comes from.
function facingPort(px, py, tx, ty, half) {
  const dx = tx - px, dy = ty - py;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const t = half / Math.max(Math.abs(ux), Math.abs(uy), 1e-9);
  return { x: px + ux * t, y: py + uy * t, ux, uy };
}

// How an exit line is drawn: from each end's port, a short straight run the
// way its exit points, then a curve between the two. A line between rooms
// that sit the way their exits say comes out straight; one that doesn't bends,
// so the side it leaves a room by still names the command. Returns
// { start, a, c1, c2, b, end }: lineTo a, bezierCurveTo c1 c2 b, lineTo end.
export function exitGeometry(e, half) {
  if (e.seam) {
    const p = exitPort(e.x1, e.y1, e.dir1, half) || facingPort(e.x1, e.y1, e.x2, e.y2, half);
    const end = { x: e.x2, y: e.y2 };
    return { start: p, a: p, c1: p, c2: end, b: end, end };
  }
  const p1 = exitPort(e.x1, e.y1, e.dir1, half) || facingPort(e.x1, e.y1, e.x2, e.y2, half);
  const p2 = exitPort(e.x2, e.y2, e.dir2, half) || facingPort(e.x2, e.y2, e.x1, e.y1, half);
  const gap = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const run = Math.min(half * 0.75, gap / 3);
  const a = { x: p1.x + p1.ux * run, y: p1.y + p1.uy * run };
  const b = { x: p2.x + p2.ux * run, y: p2.y + p2.uy * run };
  const k = Math.hypot(b.x - a.x, b.y - a.y) * 0.4;
  return {
    start: { x: p1.x, y: p1.y },
    a,
    c1: { x: a.x + p1.ux * k, y: a.y + p1.uy * k },
    c2: { x: b.x + p2.ux * k, y: b.y + p2.uy * k },
    b,
    end: { x: p2.x, y: p2.y },
  };
}

// The arrowhead on a one-way exit's line, where it meets the room it leads
// into, pointing the way the line runs there: { tip, left, right }. Sized to
// the room, within a few px either way so it reads at any zoom.
export function oneWayArrow(g, half) {
  // The way in: along the last straight run, or the curve's end where that's
  // too short to have a direction.
  let from = g.b;
  if (Math.hypot(g.end.x - from.x, g.end.y - from.y) < 1e-6) from = g.c2;
  if (Math.hypot(g.end.x - from.x, g.end.y - from.y) < 1e-6) from = g.start;
  return arrowAt(from, g.end, arrowSize(half));
}

function arrowSize(half) {
  return Math.max(4, Math.min(8, half * 0.6));
}

// An arrowhead with its tip at `tip`, pointing the way from `from` to it, no
// longer than the way between them.
export function arrowAt(from, tip, size) {
  const dx = tip.x - from.x, dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const sz = Math.min(size, len);
  const bx = tip.x - ux * sz, by = tip.y - uy * sz;
  const w = sz * 0.6;
  return {
    tip: { x: tip.x, y: tip.y },
    left: { x: bx - uy * w, y: by + ux * w },
    right: { x: bx + uy * w, y: by - ux * w },
  };
}

function drawArrowhead(ctx, a, color) {
  ctx.beginPath();
  ctx.moveTo(a.tip.x, a.tip.y);
  ctx.lineTo(a.left.x, a.left.y);
  ctx.lineTo(a.right.x, a.right.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// The ids of the laid-out rooms whose squares meet the box between two
// canvas points (a drag to select, either way round).
export function roomsInRect(layout, x0, y0, x1, y1, roomSize) {
  const half = roomSize / 2;
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  return layout.rooms
    .filter((rm) => rm.px + half >= l && rm.px - half <= r && rm.py + half >= t && rm.py - half <= b)
    .map((rm) => rm.id);
}

// How each exit style is stroked (mudstd extension `style`): a path is the
// plain 2px line; a road clearly thicker; a trail thin, faint and dotted; a
// climb a thin line crossed by ticks, like hachures on a steep slope. None
// is dashed, so a ring's seam (dashed) still reads, and with an arrowhead or
// a route's highlight they keep their shape. Widths grow a little with zoom.
export function exitStroke(style, { onPath = false, half = 8 } = {}) {
  switch (style) {
    case "road": {
      const w = Math.max(3.5, half * 0.4);
      return { width: onPath ? Math.max(w, 4) + 1.5 : w, dash: [], alpha: 1, ticks: false };
    }
    case "trail":
      return { width: onPath ? 3 : 1.75, dash: [0.5, 3], alpha: onPath ? 1 : 0.85, ticks: false };
    case "climb":
      return { width: onPath ? 3 : 1.5, dash: [], alpha: 1, ticks: true };
    default:
      return { width: onPath ? 4 : 2, dash: [], alpha: 1, ticks: false };
  }
}

// Stroke one exit line (exitGeometry's g) in its style. A way across a ring's
// seam is dashed whatever its style: it goes on round, out of view.
function strokeExit(ctx, g, style, { color, onPath = false, seam = false, half }) {
  const st = exitStroke(style, { onPath, half });
  ctx.beginPath();
  ctx.moveTo(g.start.x, g.start.y);
  ctx.lineTo(g.a.x, g.a.y);
  ctx.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.b.x, g.b.y);
  ctx.lineTo(g.end.x, g.end.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = st.width;
  ctx.globalAlpha = st.alpha;
  if (ctx.setLineDash) ctx.setLineDash(seam ? [4, 3] : st.dash);
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);
  if (st.ticks) {
    ctx.beginPath();
    for (const t of climbTicks(g, tickSpacing(half), tickLength(half))) {
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
    }
    ctx.lineWidth = Math.max(1, st.width * 0.8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const tickSpacing = (half) => Math.max(4, Math.min(7, half * 0.5));
const tickLength = (half) => Math.max(2.5, Math.min(5, half * 0.35));

// A small sample of an exit style, as the legend shows it: a straight way
// from (x1, y) to (x2, y).
export function drawWaySample(ctx, style, x1, x2, y, color, half = 8) {
  const g = { start: { x: x1, y }, a: { x: x1, y }, c1: { x: x1, y }, c2: { x: x2, y }, b: { x: x2, y }, end: { x: x2, y } };
  ctx.lineCap = "round";
  strokeExit(ctx, g, style, { color, half });
  ctx.lineCap = "butt";
}

// The ticks across a climb's line: short strokes `len` either side of it,
// square to it, every `spacing` px along it (from half a spacing in), clear
// of its last half spacing. [{ x1, y1, x2, y2 }].
export function climbTicks(g, spacing, len) {
  const pts = [g.start, g.a];
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * g.a.x + 3 * u * u * t * g.c1.x + 3 * u * t * t * g.c2.x + t * t * t * g.b.x,
      y: u * u * u * g.a.y + 3 * u * u * t * g.c1.y + 3 * u * t * t * g.c2.y + t * t * t * g.b.y,
    });
  }
  pts.push(g.end);
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l < 1e-6) continue;
    segs.push({ p, q, l, at: total });
    total += l;
  }
  const out = [];
  let k = 0;
  for (let d = spacing / 2; d <= total - spacing / 2 + 1e-9; d += spacing) {
    while (k < segs.length - 1 && segs[k].at + segs[k].l < d) k++;
    const sg = segs[k];
    const f = (d - sg.at) / sg.l;
    const x = sg.p.x + (sg.q.x - sg.p.x) * f, y = sg.p.y + (sg.q.y - sg.p.y) * f;
    const nx = -(sg.q.y - sg.p.y) / sg.l, ny = (sg.q.x - sg.p.x) / sg.l;
    out.push({ x1: x - nx * len, y1: y - ny * len, x2: x + nx * len, y2: y + ny * len });
  }
  return out;
}

// Where a room is drawn. On a ring (the server's `wrap`, kept as `wrapX`) x
// comes round, so the room is drawn at the x nearest the anchor's: the ring
// is centred on where you are, and its seam is always on the far side.
export function viewCell(r, anchor) {
  const w = r.wrapX;
  if (!w) return { x: r.coords.x, y: r.coords.y };
  return { x: anchor.coords.x + wrapDelta(r.coords.x - anchor.coords.x, w), y: r.coords.y };
}

// d brought into [-w/2, w/2).
function wrapDelta(d, w) {
  return ((((d + w / 2) % w) + w) % w) - w / 2;
}

// For an exit between two placed rooms on one ring that are drawn further
// apart than the way round is, the x step from a to b the short way; else null.
function wrapStep(a, b) {
  const w = a.wrapX;
  if (!w || b.wrapX !== w) return null;
  const drawn = b.cell.x - a.cell.x;
  const step = wrapDelta(drawn, w);
  return step === drawn ? null : step;
}

// Region tints and labels. Each region is one patch: a shape under each of
// its rooms, plus a band along each exit line between two of its rooms, all
// filled together as one shape (draw), so the region reads as one piece that
// follows its rooms and the ways between them. Rooms of a region that aren't
// joined by an exit and don't touch stay separate pieces, however near.
//
// On a grid (every room of the region at whole-number coords: stations,
// rings) the shape is the room's full cell, so neighbours tile into a solid
// block, and a band a cell wide joins two rooms a diagonal or a cell apart.
// Off a grid (open land placed by the server's km, rooms an odd 1.3 apart at
// odd angles) it's a disc, and the bands are as wide, so the patch is a
// rounded ribbon along the paths. A way across a ring's seam bands each end
// out to where the other room comes round, as its line is drawn.
//
// A land region (regionType "land": a named piece of country, not a district)
// has no patch, only its labels, laid out in pieces just the same.
//
// Labels: one per piece (rooms joined by a band, or whose shapes touch),
// centred over it and just above its top row, so a region split by the view
// or a ring's seam gets a label per piece.
export const PATCH_SQUARE = 0.5;   // half a cell: the room's whole cell
export const PATCH_ROUND = 0.6;    // the disc's radius, in cells
export const PATCH_BAND_ROUND = 0.5;   // half the band's width off a grid, in cells

function regionLayout(map, rooms, joins, areaId, scale) {
  const patches = [], regions = [];
  const inRegion = rooms.filter((r) => r.region);
  if (inRegion.length === 0) return { patches, regions };
  const byId = new Map(inRegion.map((r) => [r.id, r]));

  const byRegion = new Map();
  for (const r of inRegion) {
    if (!byRegion.has(r.region)) byRegion.set(r.region, []);
    byRegion.get(r.region).push(r);
  }
  const patchOf = new Map();
  const gridOf = new Map();
  for (const [key, rs] of byRegion) {
    const grid = rs.every((r) => Number.isInteger(r.cell.x) && Number.isInteger(r.cell.y));
    gridOf.set(key, grid);
    if (areaRegionType(map, areaId, key) === "land") continue;
    const p = {
      region: key,
      color: areaRegionColor(map, areaId, key),
      shape: grid ? "square" : "round",
      size: (grid ? PATCH_SQUARE : PATCH_ROUND) * scale,
      band: (grid ? PATCH_SQUARE : PATCH_BAND_ROUND) * scale,
      nodes: [],
      bands: [],
    };
    const at = new Set();   // one shape per spot, even where two rooms share it
    for (const r of rs) {
      const k = `${r.px},${r.py}`;
      if (!at.has(k)) { at.add(k); p.nodes.push({ px: r.px, py: r.py }); }
    }
    patches.push(p);
    patchOf.set(key, p);
  }

  // Pieces: union-find over the region's rooms.
  const parent = new Map(inRegion.map((r) => [r.id, r.id]));
  const find = (id) => {
    while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
    return id;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  for (const j of joins) {
    const a = byId.get(j.a), b = byId.get(j.b);
    if (!a || !b) continue;
    const p = patchOf.get(a.region);
    if (j.step == null) {
      if (p) p.bands.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py });
      union(a.id, b.id);
    } else if (p) {
      // Each end runs off toward where the other comes round; the two ends
      // are separate pieces on screen, so they aren't joined.
      p.bands.push({ x1: a.px, y1: a.py, x2: a.px + j.step * scale, y2: b.py });
      p.bands.push({ x1: b.px, y1: b.py, x2: b.px - j.step * scale, y2: a.py });
    }
  }

  // Shapes that touch join without an exit (a grid's neighbours, a block
  // with walls between). Bucketed by two cells, so this isn't n².
  for (const rs of byRegion.values()) {
    const grid = gridOf.get(rs[0].region);
    const touch = grid
      ? (a, b) => Math.abs(a.cell.x - b.cell.x) <= 1 + 1e-9 && Math.abs(a.cell.y - b.cell.y) <= 1 + 1e-9
      : (a, b) => Math.hypot(a.cell.x - b.cell.x, a.cell.y - b.cell.y) <= 2 * PATCH_ROUND + 1e-9;
    const buckets = new Map();
    const bk = (x, y) => `${x},${y}`;
    for (const r of rs) {
      const bx = Math.floor(r.cell.x / 2), by = Math.floor(r.cell.y / 2);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const o of buckets.get(bk(bx + dx, by + dy)) || []) if (touch(r, o)) union(r.id, o.id);
        }
      }
      const k = bk(bx, by);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
  }

  const groups = new Map();
  for (const r of inRegion) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }
  for (const group of groups.values()) {
    const xs = group.map((r) => r.px);
    regions.push({
      key: group[0].region,
      name: regionName(map, map.rooms[group[0].id]),
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      top: Math.min(...group.map((r) => r.py)),
    });
  }
  return { patches, regions };
}

// A region's patch, filled once at the tint's alpha. Every piece is traced
// clockwise, so under the nonzero rule where they overlap is still just
// inside: one fill, no darker seams.
const PATCH_ALPHA = 0.18;
function drawPatch(ctx, p) {
  ctx.beginPath();
  const s = p.size;
  for (const n of p.nodes) {
    if (p.shape === "square") {
      ctx.moveTo(n.px - s, n.py - s);
      ctx.lineTo(n.px + s, n.py - s);
      ctx.lineTo(n.px + s, n.py + s);
      ctx.lineTo(n.px - s, n.py + s);
      ctx.closePath();
    } else {
      ctx.moveTo(n.px + s, n.py);
      ctx.arc(n.px, n.py, s, 0, Math.PI * 2, false);
      ctx.closePath();
    }
  }
  for (const b of p.bands) {
    const q = bandQuad(b, p.band);
    if (!q) continue;
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    // Off a grid a band's far end is capped round (a seam's end has no disc).
    if (p.shape === "round") {
      ctx.moveTo(b.x2 + p.band, b.y2);
      ctx.arc(b.x2, b.y2, p.band, 0, Math.PI * 2, false);
      ctx.closePath();
    }
  }
  ctx.fillStyle = regionColor(p.region, PATCH_ALPHA, p.color);
  ctx.fill("nonzero");
}

// The four corners of a band `hw` either side of the line from (x1, y1) to
// (x2, y2), clockwise on screen (y down). Null for a band of no length.
export function bandQuad(b, hw) {
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = -dy / len * hw, ny = dx / len * hw;
  // Along +d then back on the +n side: clockwise when y points down.
  return [
    { x: b.x1 - nx, y: b.y1 - ny },
    { x: b.x2 - nx, y: b.y2 - ny },
    { x: b.x2 + nx, y: b.y2 + ny },
    { x: b.x1 + nx, y: b.y1 + ny },
  ];
}

// Canvas colours can't reference CSS variables, so the host theme is threaded
// in via `colors` (mapper.js reads the injected --accent/--border/… tokens with
// getComputedStyle). Defaults mirror the original dark palette so tests and any
// out-of-host use still paint correctly. `path`/`current` are deliberately kept
// vivid (accent + a fixed amber "you are here") rather than tied to muted chrome.
// How opaque a charted, unvisited room is drawn.
const CHARTED_ALPHA = 0.45;

export const DEFAULT_COLORS = {
  exit: "#6b7280",         // plain exit line  (→ --fg-muted)
  exitPath: "#38bdf8",     // highlighted route line (→ --accent)
  roomStroke: "#1f2937",   // plain room border (→ --border)
  roomPath: "#38bdf8",     // room on the highlighted route (→ --accent)
  current: "#facc15",      // the room you're standing in
  label: "#e5e7eb",        // room and region names (→ --fg)
  halo: "#0b0e14",         // outline behind names, for legibility (→ --bg)
  unexplored: "#fb923c",   // stub of an exit not taken yet (fades out)
};

// A stroke that runs from `color` at (x1, y1) to clear at (x2, y2). The clear
// end is the same colour at no alpha, so the fade doesn't dim through grey.
// Plain `color` where the context has no gradients.
function fadeOut(ctx, x1, y1, x2, y2, color) {
  if (!ctx.createLinearGradient) return color;
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  g.addColorStop(0, color);
  g.addColorStop(1, clearOf(color));
  return g;
}

// `color` (#rgb or #rrggbb) at no alpha; "transparent" for any other form.
export function clearOf(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return "transparent";
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

// `size` is the canvas's size in CSS px ({ width, height }), for the relief
// layer; without it, the backing size over the context's scale.
export function draw(ctx, layout, { roomSize, colors, labels = true, size = null }) {
  const c = { ...DEFAULT_COLORS, ...(colors || {}) };
  const half = roomSize / 2;
  const scale = layout.scale || roomSize * 2;

  // Ground relief first, under the region patches and everything else.
  let relief = null;
  if (layout.relief && layout.relief.on) {
    const ratio = (ctx.getTransform && ctx.getTransform().a) || 1;
    const cv = ctx.canvas;
    const width = size ? size.width : cv ? cv.width / ratio : 0;
    const height = size ? size.height : cv ? cv.height / ratio : 0;
    if (width > 0 && height > 0) {
      relief = paintRelief(ctx, layout.relief, { width, height, groundColor: layout.relief.groundColor, colors: c });
    }
  }

  // Region tints first, beneath the exits: each region's patch is one path
  // filled once, so where its pieces overlap it doesn't darken.
  for (const p of layout.patches || []) drawPatch(ctx, p);
  ctx.lineCap = "round";
  for (const e of layout.exits) {
    const g = exitGeometry(e, half);
    const color = e.onPath ? c.exitPath : c.exit;
    strokeExit(ctx, g, e.style, { color, onPath: e.onPath, seam: e.seam, half });
    if (e.oneWay) drawArrowhead(ctx, oneWayArrow(g, half), color);
  }
  // Stubs: a way not taken yet fades out in its own colour, a path running
  // on into the unknown; a way to a room out of view (another area or floor)
  // runs to a card naming where it goes (placeCards), or where no card fits,
  // with names off or zoomed out too far, is a plain short line.
  const names = labels && scale >= NAME_LABEL_MIN_SCALE ? nameBoxes(ctx, layout, half, scale) : [];
  const regionLabels = labels && scale >= REGION_LABEL_MIN_SCALE ? regionLabelBoxes(ctx, layout, scale) : [];
  const wantCards = labels && scale >= CARD_MIN_SCALE && (layout.stubs || []).some((s) => !s.unexplored && s.label);
  const placed = wantCards
    ? placeCards(ctx, layout, half, scale, names.map((n) => n.box), regionLabels.map((g) => g.box))
    : new Map();
  const cards = [];
  for (const s of layout.stubs || []) {
    const p = exitPort(s.px, s.py, s.dir, half);
    if (!p) continue;
    const card = placed.get(s);
    if (card) {
      cards.push(drawCard(ctx, s, p, card, scale, c, half));
      continue;
    }
    // A fading stub runs a room's width, so enough of it shows before it's gone.
    const len = s.unexplored ? Math.max(8, half * 2) : Math.max(4, half * 0.9);
    const ex = p.x + p.ux * len, ey = p.y + p.uy * len;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = s.unexplored ? fadeOut(ctx, p.x, p.y, ex, ey, c.unexplored) : c.exit;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (s.oneWay) drawArrowhead(ctx, arrowAt(p, { x: ex, y: ey }, arrowSize(half)), c.exit);
  }
  ctx.lineCap = "butt";
  for (const r of layout.rooms) {
    // A charted room you haven't been in is faded, with a dashed border.
    ctx.globalAlpha = r.charted ? CHARTED_ALPHA : 1;
    ctx.fillStyle = r.fill || envColor(r.env);
    ctx.fillRect(r.px - half, r.py - half, roomSize, roomSize);
    if (r.isCurrent) { ctx.strokeStyle = c.current; ctx.lineWidth = 3; }
    else if (r.onPath) { ctx.strokeStyle = c.roomPath; ctx.lineWidth = 2; }
    else { ctx.strokeStyle = c.roomStroke; ctx.lineWidth = 1; }
    if (ctx.setLineDash) ctx.setLineDash(r.charted ? [3, 2] : []);
    ctx.strokeRect(r.px - half, r.py - half, roomSize, roomSize);
    if (ctx.setLineDash) ctx.setLineDash([]);
    const marked = r.up || r.down || r.link;
    if (r.glyph && roomSize >= GLYPH_MIN_ROOM) {
      // Beside a mark the glyph is smaller and left of centre, clear of it.
      ctx.fillStyle = inkOn(r.fill);
      ctx.font = `bold ${Math.round(roomSize * (marked ? 0.5 : 0.62))}px system-ui, sans-serif`;
      const at = glyphOrigin(ctx, r.glyph, marked ? r.px - markSize(half) / 2 : r.px, r.py);
      ctx.fillText(r.glyph, at.x, at.y);
    }
    if (marked) drawFloorMarks(ctx, r, half);
  }
  ctx.globalAlpha = 1;
  if (!labels) return { cards, relief };

  if (names.length) {
    ctx.font = NAME_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of names) haloText(ctx, n.text, n.x, n.y, c);
  }
  if (regionLabels.length) {
    ctx.font = REGION_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const g of regionLabels) haloText(ctx, g.name, g.x, g.y, c);
  }
  return { cards, relief };
}

const NAME_FONT = "10px system-ui, sans-serif";
const NAME_H = 12;
const REGION_FONT = "bold 11px system-ui, sans-serif";

// Room names as drawn: each cut to its cell, under its room, and the box it takes.
function nameBoxes(ctx, layout, half, scale) {
  ctx.font = NAME_FONT;
  const out = [];
  for (const r of layout.rooms) {
    if (!r.name) continue;
    const text = fitText(ctx, r.name, scale - 4);
    const w = ctx.measureText(text).width, y = r.py + half + 2;
    out.push({ text, x: r.px, y, box: { l: r.px - w / 2, r: r.px + w / 2, t: y, b: y + NAME_H } });
  }
  return out;
}

// Region labels as drawn: centred over each region's cluster, skipping one
// that would overlap a label already placed.
function regionLabelBoxes(ctx, layout, scale) {
  ctx.font = REGION_FONT;
  const out = [];
  for (const g of layout.regions || []) {
    if (!g.name) continue;
    const w = ctx.measureText(g.name).width, y = g.top - scale / 2 + 2;
    const box = { l: g.x - w / 2 - 4, r: g.x + w / 2 + 4, t: y - 13, b: y };
    if (out.some((d) => overlaps(box, d.box))) continue;
    out.push({ name: g.name, x: g.x, y, box });
  }
  return out;
}

function overlaps(a, b) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

// Cards are drawn from this cell size up; a little smaller below the size
// room names show at. CARD_MAX_W keeps a very long name from running across
// the map; CARD_GAP is the clear space kept round each card.
export const CARD_MIN_SCALE = REGION_LABEL_MIN_SCALE;
const CARD_PAD = 4;
const CARD_MAX_W = 180;
const CARD_GAP = 3;
const cardFont = (scale) => `${scale >= 32 ? 10 : 9}px system-ui, sans-serif`;
const cardH = (scale) => (scale >= 32 ? 15 : 13);

// Where each stub to a room out of view gets its card: Map(stub → { box,
// text, ax, ay }). A card starts where its stub ends and grows away from its
// room (east of it rightward, west leftward, north or south across it,
// centred where there's space), as wide as its name or the space free before
// a room, name, region label, line or card already placed, cut to fit. Where
// that's too cramped it tries further out along the stub, but not through
// something in the way (bar its own room's name); where nowhere fits
// even a few letters, it gets no card. Stubs nearest the current room are
// placed first, so contested space goes to the exits you're standing by.
function placeCards(ctx, layout, half, scale, nameBoxes, labelBoxes) {
  ctx.font = cardFont(scale);
  const h = cardH(scale);
  const reach = CARD_MAX_W + scale * 1.5;   // how far off the canvas still touches a card on it
  // Only what's on the canvas, or near enough its edge to matter (all of it
  // where the context doesn't say how big it is).
  const cv = ctx.canvas;
  const view = cv && cv.width ? { l: -reach, t: -reach, r: cv.width + reach, b: cv.height + reach } : null;
  const inView = (o) => !view || (o.r > view.l && o.l < view.r && o.b > view.t && o.t < view.b);
  const obstacles = new Grid(GRID_SIZE);
  for (const r of layout.rooms) {
    const o = { l: r.px - half, r: r.px + half, t: r.py - half, b: r.py + half };
    if (inView(o)) obstacles.add(o);
  }
  for (const o of [...nameBoxes, ...labelBoxes]) if (inView(o)) obstacles.add(o);
  for (const o of lineObstacles(layout, half, inView)) obstacles.add(o);
  const cur = layout.rooms.find((r) => r.isCurrent) || null;
  const dist = (s) => (cur ? Math.hypot(s.px - cur.px, s.py - cur.py) : 0);
  const stubs = (layout.stubs || []).filter((s) => !s.unexplored && s.label && inView(dot(s.px, s.py)))
    .sort((a, b) => dist(a) - dist(b));
  const out = new Map();
  for (const s of stubs) {
    const p = exitPort(s.px, s.py, s.dir, half);
    if (!p) continue;
    // Its own room's name, which its stub may run across (as lines do).
    const own = nameBoxes.find((n) => (n.l + n.r) / 2 === s.px && n.t === s.py + half + 2) || null;
    const full = Math.min(CARD_MAX_W, ctx.measureText(s.label).width + CARD_PAD * 2);
    const least = ctx.measureText(s.label.slice(0, 3) + "…").width + CARD_PAD * 2;
    let best = null;
    // From a short stub's length out to about a cell, a few px at a time.
    for (let d = Math.max(4, half * 0.9); d <= Math.max(scale, 12); d += 4) {
      const ax = p.x + p.ux * d, ay = p.y + p.uy * d;
      const t0 = cardTop(ay, p.uy, h);
      const near = obstacles.query(ax - CARD_MAX_W - CARD_GAP, t0 - CARD_GAP, ax + CARD_MAX_W + CARD_GAP, t0 + h + CARD_GAP);
      const free = freeAround(ax, ay, p.ux, p.uy, h, near);
      // Blocked: going on would run its stub through whatever's in the way,
      // unless that's only its own room's name.
      if (!free) {
        if (own && freeAround(ax, ay, p.ux, p.uy, h, near, own)) continue;
        break;
      }
      const w = Math.min(full, free.room);
      if (w >= least && (!best || w > best.w)) best = { ax, ay, w, free };
      if (w >= full) break;
    }
    if (!best) continue;
    const text = fitText(ctx, s.label, best.w - CARD_PAD * 2);
    const w = Math.min(best.w, ctx.measureText(text).width + CARD_PAD * 2);
    const box = cardBox(best.ax, best.ay, p.ux, p.uy, w, h, best.free);
    obstacles.add(box);
    for (const o of sampleLine([p, { x: best.ax, y: best.ay }])) obstacles.add(o);
    out.set(s, { box, text, ax: best.ax, ay: best.ay });
  }
  return out;
}

// The space a card can take starting at (ax, ay), growing the way (ux, uy)
// points: { left, right } px free either side of ax before coming within
// CARD_GAP of an obstacle across the card's height, and `room`, how wide it
// can be (one side, or both for a card centred on its stub). Null where
// something's in the way at the start.
function freeAround(ax, ay, ux, uy, h, obstacles, ignore = null) {
  const t0 = cardTop(ay, uy, h);
  const t = t0 - CARD_GAP, b = t0 + h + CARD_GAP;
  let left = CARD_MAX_W, right = CARD_MAX_W;
  for (const o of obstacles) {
    if (o === ignore || o.b <= t || o.t >= b) continue;
    if (o.r + CARD_GAP <= ax) left = Math.min(left, ax - o.r - CARD_GAP);
    else if (o.l - CARD_GAP >= ax) right = Math.min(right, o.l - CARD_GAP - ax);
    else return null;
  }
  const room = ux > 0.01 ? right : ux < -0.01 ? left : left + right;
  return { left, right, room };
}

// The box of a card w wide and h high starting at (ax, ay): right of it for
// east, left for west, else centred on it as far as `free` allows (shifted
// off-centre where one side is short); above it for north, below for south,
// centred for neither.
function cardBox(ax, ay, ux, uy, w, h, free) {
  let l;
  if (ux > 0.01) l = ax;
  else if (ux < -0.01) l = ax - w;
  else l = Math.min(Math.max(ax - w / 2, ax - free.left), ax + free.right - w);
  const t = cardTop(ay, uy, h);
  return { l, r: l + w, t, b: t + h };
}

// A card's top: below its stub's end going south, above going north, else
// centred on it.
function cardTop(ay, uy, h) {
  return uy > 0.01 ? ay : uy < -0.01 ? ay - h : ay - h / 2;
}

// Boxes bucketed in square cells `size` across, so a card only checks
// what's near it: query(l, t, r, b) is everything in the cells that box meets.
const GRID_SIZE = 32;
class Grid {
  constructor(size) { this.size = size; this.cells = new Map(); }
  // A cell's key: i and j packed into one number (fine to ±2^20 cells).
  key(i, j) { return (i + 1048576) * 2097152 + (j + 1048576); }
  add(o) {
    const z = this.size;
    for (let i = Math.floor(o.l / z); i <= Math.floor(o.r / z); i++) {
      for (let j = Math.floor(o.t / z); j <= Math.floor(o.b / z); j++) {
        const k = this.key(i, j);
        const cell = this.cells.get(k);
        if (cell) cell.push(o); else this.cells.set(k, [o]);
      }
    }
  }
  query(l, t, r, b) {
    const z = this.size;
    const out = new Set();
    for (let i = Math.floor(l / z); i <= Math.floor(r / z); i++) {
      for (let j = Math.floor(t / z); j <= Math.floor(b / z); j++) {
        const cell = this.cells.get(this.key(i, j));
        if (cell) for (const o of cell) out.add(o);
      }
    }
    return out;
  }
}

// The exit lines and plain stubs as drawn, as small boxes along them, so a
// card isn't laid over a line. Lines `inView` rejects (by their ends'
// bounds) aren't sampled.
function lineObstacles(layout, half, inView) {
  const out = [];
  for (const e of layout.exits) {
    const span = { l: Math.min(e.x1, e.x2) - half, r: Math.max(e.x1, e.x2) + half, t: Math.min(e.y1, e.y2) - half, b: Math.max(e.y1, e.y2) + half };
    if (!inView(span)) continue;
    const g = exitGeometry(e, half);
    if ([g.a, g.c1, g.c2, g.b].every((q) => onLine(g.start, g.end, q))) out.push(...sampleLine([g.start, g.end]));
    else out.push(...sampleLine([g.start, g.a]), ...sampleCurve(g.a, g.c1, g.c2, g.b), ...sampleLine([g.b, g.end]));
  }
  for (const s of layout.stubs || []) {
    if (!s.unexplored) continue;   // a card's own stub is added as it's placed
    const p = exitPort(s.px, s.py, s.dir, half);
    if (!p || !inView(dot(p.x, p.y))) continue;
    const len = Math.max(8, half * 2);
    out.push(...sampleLine([p, { x: p.x + p.ux * len, y: p.y + p.uy * len }]));
  }
  return out;
}

const SAMPLE_STEP = 4;
const dot = (x, y) => ({ l: x - 1, r: x + 1, t: y - 1, b: y + 1 });

// Whether q is on the line through a and b (within half a px).
function onLine(a, b, q) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / len < 0.5;
}

// A line as boxes along it: one box where it runs straight across or down.
function sampleLine([a, b]) {
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) {
    return [{ l: Math.min(a.x, b.x) - 1, r: Math.max(a.x, b.x) + 1, t: Math.min(a.y, b.y) - 1, b: Math.max(a.y, b.y) + 1 }];
  }
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_STEP));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(dot(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n));
  return out;
}

function sampleCurve(a, c1, c2, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_STEP) * 2);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(dot(
      u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    ));
  }
  return out;
}

// A stub's line out to its card, and the card: a rounded box naming where
// the exit goes. Returns its box, where it leads, and the full name, for
// clicks and the hover card.
function drawCard(ctx, s, p, card, scale, c, half) {
  const { box, text, ax, ay } = card;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(ax, ay);
  ctx.strokeStyle = c.exit;
  ctx.lineWidth = 2;
  ctx.stroke();
  // One way: an arrow where the stub meets the card, the way it goes.
  if (s.oneWay) drawArrowhead(ctx, arrowAt(p, { x: ax, y: ay }, arrowSize(half)), c.exit);
  ctx.beginPath();
  roundRect(ctx, box.l, box.t, box.r - box.l, box.b - box.t, 4);
  ctx.fillStyle = c.halo;
  ctx.fill();
  ctx.strokeStyle = c.exit;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = cardFont(scale);
  ctx.fillStyle = c.label;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, (box.l + box.r) / 2, (box.t + box.b) / 2 + 0.5);
  return { ...box, to: s.to, from: s.from, dir: s.dir, kind: s.kind, up: s.up, label: s.label, unmapped: !!s.unmapped };
}

// A rounded rectangle path; square corners where the context has no roundRect.
function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else if (ctx.rect) ctx.rect(x, y, w, h);
}

// The card (from draw's `cards`) under a canvas point, or null.
export function cardAt(cards, x, y) {
  return (cards || []).find((k) => x >= k.l && x <= k.r && y >= k.t && y <= k.b) || null;
}

// A way up is a small triangle pointing up in the room's top-right corner, a
// way down one pointing down in its bottom-right, and a link elsewhere a dot
// in its top-left, all in the glyph's ink.
function markSize(half) {
  return Math.max(3, half * 0.6);
}

function drawFloorMarks(ctx, r, half) {
  const s = markSize(half);
  const right = r.px + half - 1, top = r.py - half + 1, bottom = r.py + half - 1;
  ctx.fillStyle = inkOn(r.fill || envColor(r.env));
  if (r.link) {
    ctx.beginPath();
    ctx.arc(r.px - half + 1 + s / 2, top + s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (r.up) {
    ctx.beginPath();
    ctx.moveTo(right - s, top + s);
    ctx.lineTo(right, top + s);
    ctx.lineTo(right - s / 2, top);
    ctx.closePath();
    ctx.fill();
  }
  if (r.down) {
    ctx.beginPath();
    ctx.moveTo(right - s, bottom - s);
    ctx.lineTo(right, bottom - s);
    ctx.lineTo(right - s / 2, bottom);
    ctx.closePath();
    ctx.fill();
  }
}

// Where to draw `text` so its ink, not its em box, is centred on (cx, cy):
// "middle" centres the em box, and where a glyph's ink sits in it varies by
// glyph and font (✉ and ⚒ sit low, † high). Sets the ctx's align + baseline.
// Without ink metrics, falls back to centring the em box.
export function glyphOrigin(ctx, text, cx, cy) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const { actualBoundingBoxLeft: l, actualBoundingBoxRight: r,
    actualBoundingBoxAscent: a, actualBoundingBoxDescent: d } = m;
  if (![l, r, a, d].every(Number.isFinite)) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    return { x: cx, y: cy };
  }
  // The ink spans x−l…x+r across and y−a…y+d down from the origin.
  return { x: cx - (r - l) / 2, y: cy + (a - d) / 2 };
}

function haloText(ctx, text, x, y, c) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = c.label;
  ctx.fillText(text, x, y);
}

// Truncate to fit `max` px with an ellipsis.
export function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}
