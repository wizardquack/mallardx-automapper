// ui/edits.js
// Pure manual-edit mutations over the map graph. No DOM, no host APIs.
// Mirrors graph.js / identity.js style. Every function returns a boolean
// success flag so mapper's applyEdit() can skip no-ops.

import { reverse } from "./directions.js";

export function renameRoom(map, id, name) {
  const r = map.rooms[id];
  if (!r) return false;
  r.name = name || "";
  return true;
}

// User annotations. Each clears its field when given an empty value; a no-op
// (same value) returns false so applyEdit doesn't push an undo step.
function setField(map, id, field, value) {
  const r = map.rooms[id];
  if (!r) return false;
  const v = value == null ? "" : String(value);
  if ((r[field] || "") === v) return false;
  if (v) r[field] = v; else delete r[field];
  return true;
}

export function setRoomColor(map, id, color) {
  return setField(map, id, "color", color);
}

// One or two characters (by code point, so ★ or an emoji counts as one).
export function setRoomSymbol(map, id, symbol) {
  const s = Array.from(String(symbol == null ? "" : symbol).trim()).slice(0, 2).join("");
  return setField(map, id, "symbol", s);
}

export function setRoomNote(map, id, note) {
  return setField(map, id, "note", String(note == null ? "" : note).trim());
}

export function deleteRoom(map, id) {
  const r = map.rooms[id];
  if (!r) return false;
  if (r.key != null && map.keyIndex[r.key] === id) delete map.keyIndex[r.key];
  delete map.rooms[id];
  for (const otherId of Object.keys(map.rooms)) {
    const ex = map.rooms[otherId].exits;
    for (const dir of Object.keys(ex)) {
      if (ex[dir].to === id) delete ex[dir];
    }
  }
  if (map.currentId === id) map.currentId = null;
  return true;
}

export function mergeRooms(map, sourceId, targetId) {
  if (sourceId === targetId) return false;
  const src = map.rooms[sourceId];
  const tgt = map.rooms[targetId];
  if (!src || !tgt) return false;

  // Union exits — target keeps any dir it already has.
  for (const dir of Object.keys(src.exits)) {
    if (!tgt.exits[dir]) tgt.exits[dir] = { to: src.exits[dir].to };
  }
  // Repoint inbound edges from source to target.
  for (const id of Object.keys(map.rooms)) {
    const ex = map.rooms[id].exits;
    for (const dir of Object.keys(ex)) {
      if (ex[dir].to === sourceId) ex[dir].to = targetId;
    }
  }
  // Annotations: the target keeps its own, adopting the source's where it has none.
  for (const f of ["env", "tags", "region", "color", "symbol", "note"]) {
    const has = Array.isArray(tgt[f]) ? tgt[f].length > 0 : !!tgt[f];
    if (!has && src[f] != null && src[f] !== "") tgt[f] = Array.isArray(src[f]) ? src[f].slice() : src[f];
  }
  // Key migration: target keeps its key; adopt source key only if target has none.
  if (src.key != null && map.keyIndex[src.key] === sourceId) delete map.keyIndex[src.key];
  if (tgt.key == null && src.key != null) {
    tgt.key = src.key;
    map.keyIndex[src.key] = targetId;
  }
  delete map.rooms[sourceId];
  if (map.currentId === sourceId) map.currentId = targetId;
  return true;
}

export function addExit(map, fromId, dir, toId, opts = {}) {
  const from = map.rooms[fromId];
  const to = map.rooms[toId];
  if (!from || !to || !dir) return false;
  const bidirectional = opts.bidirectional !== false; // default true
  from.exits[dir] = { to: toId };
  if (bidirectional) {
    const back = reverse(dir);
    if (back) to.exits[back] = { to: fromId };
  }
  return true;
}

export function deleteExit(map, fromId, dir) {
  const from = map.rooms[fromId];
  if (!from || !from.exits[dir]) return false;
  delete from.exits[dir];
  return true;
}

export function setOneWay(map, fromId, dir, oneWay) {
  const from = map.rooms[fromId];
  if (!from || !from.exits[dir]) return false;
  const back = reverse(dir);
  if (!back) return false;
  const to = map.rooms[from.exits[dir].to];
  if (!to) return false;
  if (oneWay) {
    if (to.exits[back] && to.exits[back].to === fromId) delete to.exits[back];
  } else {
    to.exits[back] = { to: fromId };
  }
  return true;
}

export function isCellOccupied(map, areaId, x, y, z, exceptId = null) {
  for (const id of Object.keys(map.rooms)) {
    if (id === exceptId) continue;
    const r = map.rooms[id];
    if (r.areaId === areaId && r.coords.x === x && r.coords.y === y && r.coords.z === z) {
      return true;
    }
  }
  return false;
}

export function freeCell(map, areaId) {
  let x = 0;
  while (isCellOccupied(map, areaId, x, 0, 0)) x++;
  return { x, y: 0, z: 0 };
}

export function moveRoom(map, id, x, y) {
  const r = map.rooms[id];
  if (!r) return false;
  r.coords = { x, y, z: r.coords.z };
  return true;
}

export function moveToArea(map, id, areaId) {
  const r = map.rooms[id];
  if (!r) return false;
  r.areaId = areaId;
  r.coords = freeCell(map, areaId);
  return true;
}

export function computePocket(map, seedId) {
  const seed = map.rooms[seedId];
  if (!seed) return [];
  const areaId = seed.areaId;
  const seen = new Set([seedId]);
  const queue = [seedId];
  while (queue.length) {
    const cur = map.rooms[queue.shift()];
    for (const dir of Object.keys(cur.exits)) {
      const to = cur.exits[dir].to;
      const dest = map.rooms[to];
      if (!dest || dest.areaId !== areaId || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return Array.from(seen);
}

export function movePocket(map, ids, areaId) {
  if (!ids || ids.length === 0) return false;
  // Largest x among existing target-area rooms not in the pocket.
  const moving = new Set(ids);
  let maxX = null;
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.areaId === areaId && !moving.has(id)) {
      maxX = maxX == null ? r.coords.x : Math.max(maxX, r.coords.x);
    }
  }
  // Smallest x within the pocket, to compute a shift that clears the target.
  let pocketMinX = null;
  for (const id of ids) {
    const r = map.rooms[id];
    if (!r) continue;
    pocketMinX = pocketMinX == null ? r.coords.x : Math.min(pocketMinX, r.coords.x);
  }
  if (pocketMinX == null) return false;
  const gap = 2;
  const shiftX = maxX == null ? -pocketMinX : (maxX + gap - pocketMinX);
  for (const id of ids) {
    const r = map.rooms[id];
    if (!r) continue;
    r.areaId = areaId;
    r.coords = { x: r.coords.x + shiftX, y: r.coords.y, z: r.coords.z };
  }
  return true;
}
