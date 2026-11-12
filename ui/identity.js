// Resolve a "room seen" signal into a graph mutation. GMCP-key identity;
// area-aware placement (per-area coordinate spaces); movement-vector placement
// within an area; loop-closing edge capture on every real traversal.

import {
  addRoom, getRoomByKey, linkExit, setCurrent, currentRoom,
} from "./graph.js";
import { vector, reverse, isDirection, isCompass, ALL_DIRECTIONS } from "./directions.js";
import { resolveArea, refreshAreaName } from "./area.js";
import { applyServerLinks, linkLinksInto } from "./links.js";

export function resolveRoomSeen(map, seen, pendingDir, cfg) {
  // Non-GMCP worlds have no stable room id; they arrive with a fingerprint
  // (fingerprint.js) instead of a key. Fingerprints are non-unique, so that
  // path resolves by position + movement vector rather than a key lookup.
  if (seen && seen.fp) return resolveFingerprint(map, seen, pendingDir, cfg);

  const prev = currentRoom(map);
  const existing = getRoomByKey(map, seen.key);

  // A typed (or speedwalk) direction wins. Without one — a local direction
  // word, a clicked link, a multi-step `go` — the move's direction is the
  // previous room's exit that leads here, if it reported one.
  let dir = pendingDir;
  let inferred = false;
  if (!dir) {
    dir = inferDirection(map, prev, seen.key);
    inferred = dir != null;
  }

  if (existing) {
    existing.name = seen.name || existing.name;
    existing.env = seen.env || existing.env;
    refreshAreaName(map, existing, seen);
    refreshAnnotations(map, existing, seen);
    delete existing.charted;   // been here now (chart.js)
    // Server coordinates win, even over where the room was placed before.
    if (seen.coords) placeAtServerCoords(map, existing, seen.coords, seen.wrap);
    // Record the traversed edge even when the destination already exists —
    // backtracks and loop-closing hops are the only chance to capture it.
    linkTraversal(map, prev, existing, dir, !inferred);
    recordExitKeys(existing, seen.exits);
    linkKnownExits(map, existing, seen.exits);
    applyServerLinks(map, existing, seen.links, (k) => getRoomByKey(map, k));
    linkLinksInto(map, existing);
    setCurrent(map, existing.id);
    return { room: existing, created: false };
  }

  const areaId = resolveArea(map, seen, prev, cfg || {});
  let coords;
  if (seen.coords) {
    coords = fromServer(seen.coords);   // and claimed below, displacing an unplaced occupant
  } else if (prev && prev.areaId === areaId && dir && isCompass(dir)) {
    const v = vector(dir);
    coords = { x: prev.coords.x + v.dx, y: prev.coords.y + v.dy, z: prev.coords.z + v.dz };
  } else {
    // No same-area anchor (area crossing, first room, or a move with no
    // vector — none, or in/out): place at the target area's first free cell
    // to avoid collisions.
    coords = firstFreeCell(map, areaId);
  }

  const room = addRoom(map, { key: seen.key, name: seen.name, env: seen.env, coords, areaId });
  refreshAnnotations(map, room, seen);
  if (seen.coords) placeAtServerCoords(map, room, seen.coords, seen.wrap);
  linkTraversal(map, prev, room, dir, !inferred);
  recordExitKeys(room, seen.exits);
  linkKnownExits(map, room, seen.exits);
  applyServerLinks(map, room, seen.links, (k) => getRoomByKey(map, k));
  linkLinksInto(map, room);
  setCurrent(map, room.id);
  return { room, created: true };
}

// The server's tags and region for a room, where the frame has them: a tags
// list replaces the room's (an empty one clears it), a region is set and its
// name recorded on the area. A frame without them leaves the room alone. The
// user's colour, symbol and note are never touched here.
export function refreshAnnotations(map, room, seen) {
  if (Array.isArray(seen.tags)) {
    if (seen.tags.length) room.tags = seen.tags.slice();
    else delete room.tags;
  }
  if (seen.region) {
    room.region = seen.region;
    const area = room.areaId != null ? map.areas[room.areaId] : null;
    if (area) {
      area.regions = area.regions || {};
      area.regions[seen.region] = seen.regionName || area.regions[seen.region] || seen.region;
    }
  }
}

// Put a room at the cell the server says it's in, and mark it so. A room
// already in that cell of the area that the server didn't place is moved to
// the area's first free cell; one the server did place stays (two rooms the
// server puts in one cell is the server's call). Where the server says x
// comes round (a ring), the room keeps it as `wrapX` for render.js.
export function placeAtServerCoords(map, room, sc, wrap) {
  const c = fromServer(sc);
  room.coords = c;
  room.serverCoords = true;
  if (wrap) room.wrapX = wrap.x;
  else delete room.wrapX;
  for (const id of Object.keys(map.rooms)) {
    const other = map.rooms[id];
    if (other === room || other.areaId !== room.areaId || other.serverCoords) continue;
    if (other.coords.x === c.x && other.coords.y === c.y && other.coords.z === c.z) {
      other.coords = firstFreeCell(map, room.areaId);
    }
  }
}

// Server coords have north as +y (the usual map convention); the grid has
// north as -y (directions.js), so y is flipped. `0 - y` keeps 0 as +0.
function fromServer(c) {
  return { x: c.x, y: 0 - c.y, z: c.z };
}

// Which of prev's exits leads to the room keyed `key`? First from the exits
// prev last reported by target key (`exitKeys`, so it works for a room not
// yet on the map — the main case), then from prev's stored edges. A compass
// direction is preferred over in/out when both lead there, since it can place
// the room. Null when prev is unknown, is the same room, or has no such exit.
// Would moving `dir` out of the current room contradict arriving at the room
// keyed `key`? True when the map already knows `dir` leads somewhere else (a
// walked edge or a reported exit target), or knows a different exit leads
// here. Used to catch a queued-moves list that has fallen out of step with
// the server (a blocked move answered by no room frame).
export function contradicts(map, dir, key) {
  const prev = currentRoom(map);
  if (!prev || !dir || key == null || prev.key === key) return false;
  const walked = prev.exits[dir];
  if (walked) {
    const target = getRoomByKey(map, key);
    return !target || walked.to !== target.id;
  }
  const reported = (prev.exitKeys || {})[dir];
  if (reported != null) return String(reported) !== String(key);
  // `dir` is unexplored; it contradicts only if another exit is known to lead here.
  return inferDirection(map, prev, key) != null;
}

function inferDirection(map, prev, key) {
  if (!prev || key == null || prev.key === key) return null;
  const found = [];
  const byKey = prev.exitKeys || {};
  for (const d of Object.keys(byKey)) if (byKey[d] === key) found.push(d);
  if (found.length === 0) {
    const target = getRoomByKey(map, key);
    if (target) {
      for (const d of Object.keys(prev.exits)) {
        if (prev.exits[d].to === target.id && isDirection(d)) found.push(d);
      }
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => ALL_DIRECTIONS.indexOf(a) - ALL_DIRECTIONS.indexOf(b));
  return found[0];
}

// Remember the exits a room last reported, by target key, so a later move out
// of it can be matched to the exit taken even when its target wasn't yet on
// the map. Replaced wholesale on each report; frames without an exits list
// (room.info) leave it alone.
export function recordExitKeys(room, exits) {
  if (!Array.isArray(exits)) return;
  const byDir = {};
  for (const ex of exits) {
    if (ex && isDirection(ex.dir) && ex.toKey != null) byDir[ex.dir] = String(ex.toKey);
  }
  room.exitKeys = byDir;
}

// mudstd.room.info reports each room's exits with the neighbour's target key.
// Link the FORWARD edge to any neighbour we already know (loop closure without
// walking that corridor). We never fabricate the reverse or create stub rooms:
// the reverse arrives when the neighbour reports its own exits, and unknown
// targets link later once visited. Idempotent — safe to re-run every visit.
export function linkKnownExits(map, room, exits) {
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

  // A room shown again with no move (a `look`) is the room you're in, not a
  // twin of it.
  if (prev && !pendingDir && prev.fp === fp) {
    refresh(prev, seen);
    return { room: prev, created: false };
  }

  // (a) prev already records an exit this way — if the room there fingerprints
  //     the same, we've simply walked a known edge. Any stored direction,
  //     in/out included, so a doorway walked twice doesn't mint a twin.
  if (prev && pendingDir && isDirection(pendingDir)) {
    const exit = prev.exits[pendingDir];
    const dest = exit && exit.to != null ? map.rooms[exit.to] : null;
    if (dest && dest.fp === fp) {
      refresh(dest, seen);
      linkTraversal(map, prev, dest, pendingDir);
      setCurrent(map, dest.id);
      return { room: dest, created: false };
    }
  }

  const sameArea = prev && prev.areaId === areaId && pendingDir && isCompass(pendingDir);
  if (sameArea) {
    const v = vector(pendingDir);
    const tx = prev.coords.x + v.dx, ty = prev.coords.y + v.dy, tz = prev.coords.z + v.dz;

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

  // First room / teleport / area-cross / in-out / non-directional: stand-alone
  // placement.
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
export function firstFreeCell(map, areaId) {
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
// (compass or in/out) between two distinct rooms. Idempotent; a no-op for
// teleports (no dir), the first room (no prev), or a room re-reporting itself
// (prev === room). Works
// across areas — connectivity is recorded even when the two rooms render in
// different area views. `withReverse` false links only the forward edge: an
// inferred move knows the exit taken, but not that it leads back, and the
// room's own reported exits supply the real reverse.
function linkTraversal(map, prev, room, pendingDir, withReverse = true) {
  if (!prev || prev.id === room.id) return;
  if (!pendingDir || !isDirection(pendingDir)) return;
  linkExit(map, prev.id, pendingDir, room.id);
  if (!withReverse) return;
  const back = reverse(pendingDir);
  if (back) linkExit(map, room.id, back, prev.id);
}
