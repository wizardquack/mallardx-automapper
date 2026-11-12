// A chart: many rooms the server sends at once (mudstd.map.rooms), for a place
// the character knows without having walked it. Rooms are added or refreshed
// like a room frame would, but nobody moves: no current room, no traversal
// edge. New rooms are marked `charted` until you're in them (identity.js
// clears it). Pure: no DOM, no host APIs.

import { addRoom, getRoomByKey, linkExit, currentRoom } from "./graph.js";
import { vector, isCompass, isDirection } from "./directions.js";
import { resolveArea, refreshAreaName } from "./area.js";
import { applyServerLinks, linkLinksInto } from "./links.js";
import {
  refreshAnnotations, placeAtServerCoords, recordExitKeys, linkKnownExits, linkExitKeysInto, firstFreeCell,
} from "./identity.js";

// Where a room waits until it's placed: NaN matches no cell, so it neither
// occupies one nor is displaced. Every room leaves it before the import ends.
const UNPLACED = () => ({ x: NaN, y: NaN, z: NaN });

// Import a chart's rooms (`seen` signals, from seenFromFrame) into the map.
// Returns { created, updated } room counts.
export function importChart(map, rooms, cfg) {
  const entries = [];
  const unplaced = new Set();
  let created = 0, updated = 0;
  // A room without an area signal goes with the room before it in the chart
  // (the first, with the room you're in), as a walked room would.
  let prev = currentRoom(map);

  // 1. Rooms: refresh the known, add the new.
  for (const seen of rooms || []) {
    if (!seen || seen.key == null || seen.key === "") continue;
    let room = getRoomByKey(map, seen.key);
    if (room) {
      room.name = seen.name || room.name;
      room.env = seen.env || room.env;
      refreshAreaName(map, room, seen);
      updated++;
    } else {
      const areaId = resolveArea(map, seen, prev, cfg || {});
      room = addRoom(map, { key: seen.key, name: seen.name, env: seen.env, coords: UNPLACED(), areaId });
      room.charted = true;
      unplaced.add(room.id);
      created++;
    }
    refreshAnnotations(map, room, seen);
    if (seen.coords) {
      placeAtServerCoords(map, room, seen.coords, seen.wrap);
      unplaced.delete(room.id);
    }
    recordExitKeys(room, seen.exits);
    entries.push({ room, seen });
    prev = room;
  }

  // 2. Edges, once every room exists, so the chart's order doesn't matter.
  const byKey = (k) => getRoomByKey(map, k);
  for (const { room, seen } of entries) {
    linkKnownExits(map, room, seen.exits);
    applyServerLinks(map, room, seen.links, byKey);
  }
  for (const { room } of entries) {
    linkExitKeysInto(map, room);
    linkLinksInto(map, room);
  }

  // 3. Rooms the server didn't place.
  placeByExits(map, entries.map((e) => e.room).filter((r) => unplaced.has(r.id)));

  return { created, updated };
}

// Place each room one compass step from a placed neighbour in its area, in
// that direction, where the cell is free; repeat while that places anything,
// so rooms spread out from the placed ones. The rest go to the area's first
// free cell.
function placeByExits(map, rooms) {
  let left = rooms.slice();
  let progress = true;
  while (left.length && progress) {
    progress = false;
    const next = [];
    for (const room of left) {
      const c = cellFromNeighbour(map, room);
      if (c) { room.coords = c; progress = true; } else next.push(room);
    }
    left = next;
  }
  for (const room of left) room.coords = firstFreeCell(map, room.areaId);
}

function placed(r) {
  return r && Number.isFinite(r.coords.x);
}

function cellFromNeighbour(map, room) {
  const tries = [];
  // room —dir→ p: room sits one step back from p.
  for (const dir of Object.keys(room.exits)) {
    const p = map.rooms[room.exits[dir].to];
    if (isCompass(dir) && placed(p) && p.areaId === room.areaId) tries.push({ p, dir, sign: -1 });
  }
  // p —dir→ room: room sits one step on from p.
  for (const id of Object.keys(map.rooms)) {
    const p = map.rooms[id];
    if (!placed(p) || p.areaId !== room.areaId) continue;
    for (const dir of Object.keys(p.exits)) {
      if (p.exits[dir].to === room.id && isCompass(dir)) tries.push({ p, dir, sign: 1 });
    }
  }
  for (const { p, dir, sign } of tries) {
    const v = vector(dir);
    const c = { x: p.coords.x + sign * v.dx, y: p.coords.y + sign * v.dy, z: p.coords.z + sign * v.dz };
    if (!occupied(map, room.areaId, c)) return c;
  }
  return null;
}

function occupied(map, areaId, c) {
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId === areaId && r.coords.x === c.x && r.coords.y === c.y && r.coords.z === c.z) return true;
  }
  return false;
}
