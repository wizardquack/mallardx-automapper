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
