// Resolve a "room seen" signal into a graph mutation. Phase 1: GMCP-key
// identity with movement-vector placement for newly-discovered rooms.

import {
  addRoom, getRoomByKey, linkExit, setCurrent, currentRoom,
} from "./graph.js";
import { vector, reverse, isDirection } from "./directions.js";

export function resolveRoomSeen(map, seen, pendingDir) {
  const existing = getRoomByKey(map, seen.key);
  if (existing) {
    existing.name = seen.name || existing.name;
    existing.env = seen.env || existing.env;
    setCurrent(map, existing.id);
    return { room: existing, created: false };
  }

  const prev = currentRoom(map);
  let coords = prev ? { ...prev.coords } : { x: 0, y: 0, z: 0 };
  const canLink = prev && pendingDir && isDirection(pendingDir);
  if (canLink) {
    const v = vector(pendingDir);
    coords = { x: prev.coords.x + v.dx, y: prev.coords.y + v.dy, z: prev.coords.z + v.dz };
  }

  const room = addRoom(map, { key: seen.key, name: seen.name, env: seen.env, coords });

  if (canLink) {
    linkExit(map, prev.id, pendingDir, room.id);
    const back = reverse(pendingDir);
    if (back) linkExit(map, room.id, back, prev.id);
  }

  setCurrent(map, room.id);
  return { room, created: true };
}
