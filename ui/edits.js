// ui/edits.js
// Pure manual-edit mutations over the map graph. No DOM, no host APIs.
// Mirrors graph.js / identity.js style. Every function returns a boolean
// success flag so mapper's applyEdit() can skip no-ops.

export function renameRoom(map, id, name) {
  const r = map.rooms[id];
  if (!r) return false;
  r.name = name || "";
  return true;
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
