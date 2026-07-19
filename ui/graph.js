// The per-world map: rooms keyed by internal id, with a key→id index for
// O(1) identity lookup. Pure data + mutations; no DOM, no host APIs.

const VERSION = 1;

export function createMap() {
  return { version: VERSION, rooms: {}, keyIndex: {}, nextId: 1, currentId: null };
}

export function addRoom(map, { key, name, env, coords }) {
  const id = String(map.nextId++);
  const room = {
    id,
    key,
    name: name || "",
    env: env || "",
    coords: coords ? { ...coords } : { x: 0, y: 0, z: 0 },
    exits: {},
  };
  map.rooms[id] = room;
  if (key != null) map.keyIndex[key] = id;
  return room;
}

export function getRoom(map, id) {
  return map.rooms[id] || null;
}

export function getRoomByKey(map, key) {
  const id = map.keyIndex[key];
  return id != null ? map.rooms[id] || null : null;
}

export function linkExit(map, fromId, dir, toId) {
  const from = map.rooms[fromId];
  if (!from) return;
  from.exits[dir] = { to: toId };
}

export function setCurrent(map, id) {
  map.currentId = id;
}

export function currentRoom(map) {
  return map.currentId != null ? map.rooms[map.currentId] || null : null;
}

export function toJSON(map) {
  return JSON.stringify(map);
}

export function fromJSON(str) {
  try {
    const parsed = JSON.parse(str);
    if (!parsed || parsed.version !== VERSION) return createMap();
    // Backfill any missing top-level fields defensively.
    return {
      version: VERSION,
      rooms: parsed.rooms || {},
      keyIndex: parsed.keyIndex || {},
      nextId: parsed.nextId || 1,
      currentId: parsed.currentId ?? null,
    };
  } catch {
    return createMap();
  }
}
