// Pure layout computation + a thin canvas painter. Layout centers the
// current room; only the current z-level is drawn (multi-level view is a
// later phase).

export function computeLayout(map, { cx, cy, scale, areaId }) {
  const cur = map.currentId != null ? map.rooms[map.currentId] : null;
  const viewArea = areaId != null ? areaId : (cur ? cur.areaId : null);

  // Anchor: current room if it's in the viewed area, else the area's first room.
  let anchor = cur && cur.areaId === viewArea ? cur : null;
  if (!anchor) {
    const ids = Object.keys(map.rooms)
      .filter((id) => map.rooms[id].areaId === viewArea)
      .sort((a, b) => Number(a) - Number(b));
    anchor = ids.length ? map.rooms[ids[0]] : null;
  }
  if (!anchor) return { rooms: [], exits: [] };
  const z = anchor.coords.z;

  const rooms = [];
  const placed = {};
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId !== viewArea || r.coords.z !== z) continue;
    const px = cx + (r.coords.x - anchor.coords.x) * scale;
    const py = cy + (r.coords.y - anchor.coords.y) * scale;
    placed[id] = { px, py };
    rooms.push({ id, px, py, isCurrent: cur != null && id === cur.id, env: r.env });
  }

  const exits = [];
  const seen = new Set();
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (!placed[id]) continue;
    for (const dir of Object.keys(r.exits)) {
      const to = r.exits[dir].to;
      if (to == null || !placed[to]) continue;
      const key = id < to ? `${id}|${to}` : `${to}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = placed[id], b = placed[to];
      exits.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py });
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

export function draw(ctx, layout, { roomSize }) {
  const half = roomSize / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#6b7280";
  for (const e of layout.exits) {
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.lineTo(e.x2, e.y2);
    ctx.stroke();
  }
  for (const r of layout.rooms) {
    ctx.fillStyle = envColor(r.env);
    ctx.fillRect(r.px - half, r.py - half, roomSize, roomSize);
    ctx.strokeStyle = r.isCurrent ? "#facc15" : "#1f2937";
    ctx.lineWidth = r.isCurrent ? 3 : 1;
    ctx.strokeRect(r.px - half, r.py - half, roomSize, roomSize);
  }
}
