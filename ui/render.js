// Pure layout computation + a thin canvas painter. Layout centers the
// current room; only the current z-level is drawn (multi-level view is a
// later phase).

import { isCompass } from "./directions.js";

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
  if (!anchor) return { rooms: [], exits: [] };
  const z = viewedZ != null ? viewedZ : anchor.coords.z;

  const pathRooms = path && path.rooms ? path.rooms : null;
  const pathEdges = path && path.edges ? path.edges : null;

  const rooms = [];
  const placed = {};
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId !== viewArea || r.coords.z !== z) continue;
    const px = cx + (r.coords.x - anchor.coords.x) * scale;
    const py = cy + (r.coords.y - anchor.coords.y) * scale;
    placed[id] = { px, py };
    rooms.push({
      id, px, py,
      isCurrent: cur != null && id === cur.id,
      onPath: pathRooms ? pathRooms.has(id) : false,
      env: r.env,
    });
  }

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
      exits.push({
        x1: a.px, y1: a.py, x2: b.px, y2: b.py,
        onPath: pathEdges ? pathEdges.has(key) : false,
      });
    }
  }

  return { rooms, exits };
}

export function envColor(env) {
  // Coerce to string defensively: Discworld sends terrain as a number and the
  // Lua boundary now stringifies it, but guard here too so a stale stored map
  // with a numeric env still hashes correctly rather than silently going grey.
  const s = String(env == null ? "" : env);
  if (!s) return "#888888";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffff;
  const r = 80 + (h & 0x7f);
  const g = 80 + ((h >> 7) & 0x7f);
  const b = 80 + ((h >> 14) & 0x7f);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
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
};

export function draw(ctx, layout, { roomSize, colors }) {
  const c = { ...DEFAULT_COLORS, ...(colors || {}) };
  const half = roomSize / 2;
  for (const e of layout.exits) {
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
    ctx.strokeStyle = e.onPath ? c.exitPath : c.exit;
    ctx.lineWidth = e.onPath ? 4 : 2;
    ctx.stroke();
  }
  for (const r of layout.rooms) {
    ctx.fillStyle = envColor(r.env);
    ctx.fillRect(r.px - half, r.py - half, roomSize, roomSize);
    if (r.isCurrent) { ctx.strokeStyle = c.current; ctx.lineWidth = 3; }
    else if (r.onPath) { ctx.strokeStyle = c.roomPath; ctx.lineWidth = 2; }
    else { ctx.strokeStyle = c.roomStroke; ctx.lineWidth = 1; }
    ctx.strokeRect(r.px - half, r.py - half, roomSize, roomSize);
  }
}
