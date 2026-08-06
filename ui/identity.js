// Resolve a "room seen" signal into a graph mutation. GMCP-key identity;
// area-aware placement (per-area coordinate spaces); movement-vector placement
// within an area; loop-closing edge capture on every real traversal.

import {
  addRoom, getRoomByKey, linkExit, setCurrent, currentRoom,
} from "./graph.js";
import { vector, reverse, isDirection } from "./directions.js";
import { resolveArea } from "./area.js";

export function resolveRoomSeen(map, seen, pendingDir, cfg) {
  // Non-GMCP worlds have no stable room id; they arrive with a fingerprint
  // (fingerprint.js) instead of a key. Fingerprints are non-unique, so that
  // path resolves by position + movement vector rather than a key lookup.
  if (seen && seen.fp) return resolveFingerprint(map, seen, pendingDir, cfg);

  const prev = currentRoom(map);
  const existing = getRoomByKey(map, seen.key);

  if (existing) {
    existing.name = seen.name || existing.name;
    existing.env = seen.env || existing.env;
    // Record the traversed edge even when the destination already exists —
    // backtracks and loop-closing hops are the only chance to capture it.
    linkTraversal(map, prev, existing, pendingDir);
    linkKnownExits(map, existing, seen.exits);
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
  linkKnownExits(map, room, seen.exits);
  setCurrent(map, room.id);
  return { room, created: true };
}

// mudstd.room.info reports each room's exits with the neighbour's target key.
// Link the FORWARD edge to any neighbour we already know (loop closure without
// walking that corridor). We never fabricate the reverse or create stub rooms:
// the reverse arrives when the neighbour reports its own exits, and unknown
// targets link later once visited. Idempotent — safe to re-run every visit.
function linkKnownExits(map, room, exits) {
  if (!Array.isArray(exits)) return;
  for (const ex of exits) {
    if (!ex || !isDirection(ex.dir) || ex.toKey == null) continue;
    const target = getRoomByKey(map, ex.toKey);
    if (target) linkExit(map, room.id, ex.dir, target.id);
  }
}

// Fingerprint (non-GMCP) resolution. Because many rooms share a fingerprint,
// we never look one up by key; we correlate the arriving fp with geometry:
// follow prev's existing exit if the room there matches, else adopt a matching
// room already sitting at the geometric target, else create a fresh one. This
// is the crux of universal mapping (design spec §"Room identity resolution").
function resolveFingerprint(map, seen, pendingDir, cfg) {
  const prev = currentRoom(map);
  const fp = seen.fp;
  const areaId = resolveArea(map, seen, prev, cfg || {});
  const sameArea = prev && prev.areaId === areaId && pendingDir && isDirection(pendingDir);

  if (sameArea) {
    const v = vector(pendingDir);
    const tx = prev.coords.x + v.dx, ty = prev.coords.y + v.dy, tz = prev.coords.z + v.dz;

    // (a) prev already records an exit this way — if the room there fingerprints
    //     the same, we've simply walked a known edge.
    const exit = prev.exits[pendingDir];
    if (exit && exit.to != null) {
      const dest = map.rooms[exit.to];
      if (dest && dest.fp === fp) {
        refresh(dest, seen);
        linkTraversal(map, prev, dest, pendingDir);
        setCurrent(map, dest.id);
        return { room: dest, created: false };
      }
    }

    // (b) a matching room already occupies the geometric target cell (loop
    //     closure reached from a different direction) — link to it, don't dup.
    const at = roomAtCell(map, areaId, tx, ty, tz);
    if (at && at.fp === fp) {
      refresh(at, seen);
      linkTraversal(map, prev, at, pendingDir);
      setCurrent(map, at.id);
      return { room: at, created: false };
    }

    // (c) create — at the target cell when free, else the first free cell (a
    //     different room already sits at the geometric target).
    const coords = at ? firstFreeCell(map, areaId) : { x: tx, y: ty, z: tz };
    const room = addRoom(map, { fp, name: seen.name, env: seen.env, coords, areaId });
    linkTraversal(map, prev, room, pendingDir);
    setCurrent(map, room.id);
    return { room, created: true };
  }

  // First room / teleport / area-cross / non-directional: stand-alone placement.
  const coords = firstFreeCell(map, areaId);
  const room = addRoom(map, { fp, name: seen.name, env: seen.env, coords, areaId });
  linkTraversal(map, prev, room, pendingDir);
  setCurrent(map, room.id);
  return { room, created: true };
}

function refresh(room, seen) {
  room.name = seen.name || room.name;
  room.env = seen.env || room.env;
}

function roomAtCell(map, areaId, x, y, z) {
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId === areaId && r.coords.x === x && r.coords.y === y && r.coords.z === z) return r;
  }
  return null;
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
