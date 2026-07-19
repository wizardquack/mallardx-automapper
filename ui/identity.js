// Resolve a "room seen" signal into a graph mutation. Phase 1: GMCP-key
// identity with movement-vector placement for newly-discovered rooms.

import {
  addRoom, getRoomByKey, linkExit, setCurrent, currentRoom,
} from "./graph.js";
import { vector, reverse, isDirection } from "./directions.js";

export function resolveRoomSeen(map, seen, pendingDir) {
  const prev = currentRoom(map);
  const existing = getRoomByKey(map, seen.key);

  if (existing) {
    existing.name = seen.name || existing.name;
    existing.env = seen.env || existing.env;
    // Record the traversed edge even when the destination already exists.
    // Exits are only ever inferred from movement, so a hop between two
    // already-known rooms (backtracks, loop-closing steps) is the ONLY chance
    // to capture that connection — otherwise the link is never drawn.
    linkTraversal(map, prev, existing, pendingDir);
    setCurrent(map, existing.id);
    return { room: existing, created: false };
  }

  let coords = prev ? { ...prev.coords } : { x: 0, y: 0, z: 0 };
  const canLink = prev && pendingDir && isDirection(pendingDir);
  if (canLink) {
    const v = vector(pendingDir);
    coords = { x: prev.coords.x + v.dx, y: prev.coords.y + v.dy, z: prev.coords.z + v.dz };
  }

  const room = addRoom(map, { key: seen.key, name: seen.name, env: seen.env, coords });
  linkTraversal(map, prev, room, pendingDir);
  setCurrent(map, room.id);
  return { room, created: true };
}

// Link prev —dir→ room (and the reverse) when we moved in a real direction
// between two distinct rooms. Idempotent; a no-op for teleports (no dir),
// the first room (no prev), or a room re-reporting itself (prev === room).
function linkTraversal(map, prev, room, pendingDir) {
  if (!prev || prev.id === room.id) return;
  if (!pendingDir || !isDirection(pendingDir)) return;
  linkExit(map, prev.id, pendingDir, room.id);
  const back = reverse(pendingDir);
  if (back) linkExit(map, room.id, back, prev.id);
}
