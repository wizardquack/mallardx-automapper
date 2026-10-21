// Pure layout computation + a thin canvas painter. Layout centers the
// current room; only the current z-level is drawn, and a room that leads up
// or down is marked (floors.js).

import { isCompass } from "./directions.js";
import { floorMarks } from "./floors.js";
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
  if (!anchor) return { rooms: [], exits: [], tints: [], regions: [], scale };
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

  const exits = [];
  const seen = new Set();
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
      const a = placed[id], b = placed[to];
      const onPath = pathEdges ? pathEdges.has(key) : false;
      const step = wrapStep(a, b);
      if (step == null) {
        exits.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, onPath });
      } else {
        // Across the far side of a ring from the view's centre: each end runs
        // off the edge toward where the other comes round, not across the map.
        exits.push({ x1: a.px, y1: a.py, x2: a.px + step * scale, y2: b.py, onPath, seam: true });
        exits.push({ x1: b.px, y1: b.py, x2: b.px - step * scale, y2: a.py, onPath, seam: true });
      }
    }
  }

  return { rooms, exits, tints, regions, scale };
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
export const DEFAULT_COLORS = {
  exit: "#6b7280",         // plain exit line  (→ --fg-muted)
  exitPath: "#38bdf8",     // highlighted route line (→ --accent)
  roomStroke: "#1f2937",   // plain room border (→ --border)
  roomPath: "#38bdf8",     // room on the highlighted route (→ --accent)
  current: "#facc15",      // the room you're standing in
  label: "#e5e7eb",        // room and region names (→ --fg)
  halo: "#0b0e14",         // outline behind names, for legibility (→ --bg)
};

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
  for (const e of layout.exits) {
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
    ctx.strokeStyle = e.onPath ? c.exitPath : c.exit;
    ctx.lineWidth = e.onPath ? 4 : 2;
    // A way across a ring's seam is dashed: it goes on round, out of view.
    if (ctx.setLineDash) ctx.setLineDash(e.seam ? [4, 3] : []);
    ctx.stroke();
  }
  if (ctx.setLineDash) ctx.setLineDash([]);
  for (const r of layout.rooms) {
    ctx.fillStyle = r.fill || envColor(r.env);
    ctx.fillRect(r.px - half, r.py - half, roomSize, roomSize);
    if (r.isCurrent) { ctx.strokeStyle = c.current; ctx.lineWidth = 3; }
    else if (r.onPath) { ctx.strokeStyle = c.roomPath; ctx.lineWidth = 2; }
    else { ctx.strokeStyle = c.roomStroke; ctx.lineWidth = 1; }
    ctx.strokeRect(r.px - half, r.py - half, roomSize, roomSize);
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
  if (!labels) return;

  if (scale >= NAME_LABEL_MIN_SCALE) {
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const r of layout.rooms) {
      if (!r.name) continue;
      haloText(ctx, fitText(ctx, r.name, scale - 4), r.px, r.py + half + 2, c);
    }
  }
  if (scale >= REGION_LABEL_MIN_SCALE) {
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    // Skip a region label that would overlap one already drawn.
    const drawn = [];
    for (const g of layout.regions || []) {
      if (!g.name) continue;
      const w = ctx.measureText(g.name).width, y = g.top - scale / 2 + 2;
      const box = { l: g.x - w / 2 - 4, r: g.x + w / 2 + 4, t: y - 13, b: y };
      if (drawn.some((d) => box.l < d.r && box.r > d.l && box.t < d.b && box.b > d.t)) continue;
      drawn.push(box);
      haloText(ctx, g.name, g.x, y, c);
    }
  }
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
