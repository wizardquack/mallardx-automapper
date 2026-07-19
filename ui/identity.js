// Resolve a "room seen" signal into a graph mutation. GMCP-key identity;
// area-aware placement (per-area coordinate spaces); movement-vector placement
// within an area; loop-closing edge capture on every real traversal.

import {
  addRoom, getRoomByKey, linkExit, setCurrent, currentRoom,
} from "./graph.js";
import { vector, reverse, isDirection } from "./directions.js";
import { resolveArea } from "./area.js";

export function resolveRoomSeen(map, seen, pendingDir, cfg) {
  const prev = currentRoom(map);
  const existing = getRoomByKey(map, seen.key);

  if (existing) {
    existing.name = seen.name || existing.name;
    existing.env = seen.env || existing.env;
    // Record the traversed edge even when the destination already exists —
    // backtracks and loop-closing hops are the only chance to capture it.
    linkTraversal(map, prev, existing, pendingDir);
    setCurrent(map, existing.id);
    return { room: existing, created: false };
  }

  const areaId = resolveArea(map, seen, prev, cfg || {});
  let coords;
  if (prev && prev.areaId === areaId && pendingDir && isDirection(pendingDir)) {
    const v = vector(pendingDir);
    coords = { x: prev.coords.x + v.dx, y: prev.coords.y + v.dy, z: prev.coords.z + v.dz };
  } else {
    // No same-area anchor (area crossing, first room, or non-directional):
    // place at the target area's first free cell to avoid collisions.
    coords = firstFreeCell(map, areaId);
  }

  const room = addRoom(map, { key: seen.key, name: seen.name, env: seen.env, coords, areaId });
  linkTraversal(map, prev, room, pendingDir);
  setCurrent(map, room.id);
  return { room, created: true };
}

// Scan deterministically from the area's origin along +x on z:0 for a cell not
// yet occupied by a room in that area.
function firstFreeCell(map, areaId) {
  const occupied = new Set();
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId === areaId) occupied.add(`${r.coords.x},${r.coords.y},${r.coords.z}`);
  }
  let x = 0;
  while (occupied.has(`${x},0,0`)) x++;
  return { x, y: 0, z: 0 };
}

// Link prev —dir→ room (and the reverse) when we moved in a real direction
// between two distinct rooms. Idempotent; a no-op for teleports (no dir), the
// first room (no prev), or a room re-reporting itself (prev === room). Works
// across areas — connectivity is recorded even when the two rooms render in
// different area views.
function linkTraversal(map, prev, room, pendingDir) {
  if (!prev || prev.id === room.id) return;
  if (!pendingDir || !isDirection(pendingDir)) return;
  linkExit(map, prev.id, pendingDir, room.id);
  const back = reverse(pendingDir);
  if (back) linkExit(map, room.id, back, prev.id);
}
