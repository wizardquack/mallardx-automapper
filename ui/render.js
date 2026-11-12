// Pure layout computation + a thin canvas painter. Layout centers the
// current room; only the current z-level is drawn, and a room that leads up
// or down is marked (floors.js).

import { isCompass, vector, reverse } from "./directions.js";
import { floorMarks } from "./floors.js";
import { getAreaByKey } from "./graph.js";
import { fillColor, roomGlyph, regionColor, regionName, inkOn, envColor } from "./annotate.js";

export { envColor };

// Room names are drawn at these cell sizes and up (the two largest zooms);
// region names and glyphs need less room.
export const NAME_LABEL_MIN_SCALE = 44;
export const REGION_LABEL_MIN_SCALE = 24;
export const GLYPH_MIN_ROOM = 12;

export function computeLayout(map, { cx, cy, scale, areaId, viewedZ = null, path = null, anchorId = null }) {
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
  if (!anchor) return { rooms: [], exits: [], stubs: [], tints: [], regions: [], scale };
  const z = viewedZ != null ? viewedZ : anchor.coords.z;

  const pathRooms = path && path.rooms ? path.rooms : null;
  const pathEdges = path && path.edges ? path.edges : null;

  const rooms = [];
  const placed = {};
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId !== viewArea || r.coords.z !== z) continue;
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
      fill: fillColor(map, r),
      glyph: roomGlyph(r),
      region: r.region || null,
      up: marks.up,
      down: marks.down,
      link: marks.link,
    });
  }

  const { tints, regions } = regionLayout(map, rooms, viewArea, z, anchor, cx, cy, scale);

  // Each exit line carries the direction it leaves each room by (dir1 from
  // the x1/y1 end, dir2 from the other; null where that room has no exit
  // back), so draw() can start it from that side of the room.
  const exits = [];
  const seen = new Set();
  const drawn = new Set();   // `${id}|${dir}` of exits a line already shows
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
      const step = wrapStep(a, b);
      if (step == null) {
        exits.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, dir1: dir, dir2: back, onPath });
      } else {
        // Across the far side of a ring from the view's centre: each end runs
        // off the edge toward where the other comes round, not across the map.
        exits.push({ x1: a.px, y1: a.py, x2: a.px + step * scale, y2: b.py, dir1: dir, dir2: null, onPath, seam: true });
        exits.push({ x1: b.px, y1: b.py, x2: b.px - step * scale, y2: a.py, dir1: back, dir2: null, onPath, seam: true });
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
        ...elsewhere(map, r, target),
      });
    }
  }

  return { rooms, exits, stubs, tints, regions, scale };
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

// The ids of the laid-out rooms whose squares meet the box between two
// canvas points (a drag to select, either way round).
export function roomsInRect(layout, x0, y0, x1, y1, roomSize) {
  const half = roomSize / 2;
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  return layout.rooms
    .filter((rm) => rm.px + half >= l && rm.px - half <= r && rm.py + half >= t && rm.py - half <= b)
    .map((rm) => rm.id);
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

// Region tints and labels. A tint is a cell under each room in a region, plus
// the one empty cell between two rooms of the same region two cells apart (a
// layout that spaces rooms out, like a ring with a node every other cell,
// still reads as one patch). Rooms of a region within two cells of each other
// form a cluster, labelled once, centred over it and just above its top row —
// so a region split by the view or by a ring's seam gets a label per piece.
function regionLayout(map, rooms, areaId, z, anchor, cx, cy, scale) {
  const tints = [], regions = [];
  const inRegion = rooms.filter((r) => r.region);
  if (inRegion.length === 0) return { tints, regions };
  const cell = (r) => r.cell;
  const occupied = new Set();
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId !== areaId || r.coords.z !== z) continue;
    const c = viewCell(r, anchor);
    occupied.add(`${c.x},${c.y}`);
  }
  const at = new Map(inRegion.map((r) => [`${cell(r).x},${cell(r).y}`, r]));
  const toPx = (x, y) => ({ px: cx + (x - anchor.coords.x) * scale, py: cy + (y - anchor.coords.y) * scale });

  // One tint per cell, even where two rooms share it.
  const tinted = new Set();
  const tint = (t) => {
    const k = `${t.px},${t.py}`;
    if (!tinted.has(k)) { tinted.add(k); tints.push(t); }
  };
  for (const r of inRegion) {
    tint({ px: r.px, py: r.py, region: r.region });
    const { x, y } = cell(r);
    for (const [dx, dy] of [[2, 0], [0, 2]]) {
      const other = at.get(`${x + dx},${y + dy}`);
      const mid = `${x + dx / 2},${y + dy / 2}`;
      if (other && other.region === r.region && !occupied.has(mid)) {
        tint({ ...toPx(x + dx / 2, y + dy / 2), region: r.region });
      }
    }
  }

  const seen = new Set();
  for (const start of inRegion) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      const a = cell(group[i]);
      for (const b of inRegion) {
        if (seen.has(b.id) || b.region !== start.region) continue;
        const c = cell(b);
        if (Math.abs(a.x - c.x) <= 2 && Math.abs(a.y - c.y) <= 2) { seen.add(b.id); group.push(b); }
      }
    }
    const xs = group.map((r) => r.px);
    regions.push({
      key: start.region,
      name: regionName(map, map.rooms[start.id]),
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      top: Math.min(...group.map((r) => r.py)),
    });
  }
  return { tints, regions };
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

export function draw(ctx, layout, { roomSize, colors, labels = true }) {
  const c = { ...DEFAULT_COLORS, ...(colors || {}) };
  const half = roomSize / 2;
  const scale = layout.scale || roomSize * 2;

  // Region tints first: a faint full cell under each room, so a region's
  // neighbouring rooms join into one patch beneath the exits.
  for (const t of layout.tints || []) {
    ctx.fillStyle = regionColor(t.region, 0.18);
    ctx.fillRect(t.px - scale / 2, t.py - scale / 2, scale, scale);
  }
  ctx.lineCap = "round";
  for (const e of layout.exits) {
    const g = exitGeometry(e, half);
    ctx.beginPath();
    ctx.moveTo(g.start.x, g.start.y);
    ctx.lineTo(g.a.x, g.a.y);
    ctx.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.b.x, g.b.y);
    ctx.lineTo(g.end.x, g.end.y);
    ctx.strokeStyle = e.onPath ? c.exitPath : c.exit;
    ctx.lineWidth = e.onPath ? 4 : 2;
    // A way across a ring's seam is dashed: it goes on round, out of view.
    if (ctx.setLineDash) ctx.setLineDash(e.seam ? [4, 3] : []);
    ctx.stroke();
  }
  if (ctx.setLineDash) ctx.setLineDash([]);
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
      cards.push(drawCard(ctx, s, p, card, scale, c));
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
  if (!labels) return { cards };

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
  return { cards };
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
function drawCard(ctx, s, p, card, scale, c) {
  const { box, text, ax, ay } = card;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(ax, ay);
  ctx.strokeStyle = c.exit;
  ctx.lineWidth = 2;
  ctx.stroke();
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
