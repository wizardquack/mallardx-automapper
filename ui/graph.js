// The per-world map: rooms keyed by internal id (with a key→id index), and
// areas keyed by internal id (with a key→id index). Each area is its own
// coordinate space. Pure data + mutations; no DOM, no host APIs.

const VERSION = 2;

export function createMap() {
  return {
    version: VERSION,
    rooms: {},
    keyIndex: {},
    areas: {},
    areaKeyIndex: {},
    nextId: 1,
    nextAreaId: 1,
    currentId: null,
  };
}

// Rooms may also carry fields set by identity.js and absent on rooms from
// older saves (so readers treat a missing one as empty):
//   exitKeys     — { [dir]: targetKey }, the exits the room last reported by key.
//   serverCoords — true once the server has placed the room by coordinates;
//                  such a room isn't displaced by another the server places.
export function addRoom(map, { key, fp, name, env, coords, areaId }) {
  const id = String(map.nextId++);
  const room = {
    id,
    key: key ?? null,
    // Non-GMCP fingerprint (see fingerprint.js). Non-unique, so it is NOT
    // indexed — fingerprint identity resolves by position, not key lookup.
    fp: fp ?? null,
    name: name || "",
    env: env || "",
    coords: coords ? { ...coords } : { x: 0, y: 0, z: 0 },
    exits: {},
    areaId: areaId ?? null,
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

// ── Areas ───────────────────────────────────────────────────────────────────

export function addArea(map, { key, label }) {
  const id = String(map.nextAreaId++);
  const area = { id, key: key ?? null, label: label || "" };
  map.areas[id] = area;
  if (key != null) map.areaKeyIndex[key] = id;
  return area;
}

export function getArea(map, id) {
  return map.areas[id] || null;
}

export function getAreaByKey(map, key) {
  const id = map.areaKeyIndex[key];
  return id != null ? map.areas[id] || null : null;
}

export function listAreas(map) {
  return Object.keys(map.areas)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => ({ id, label: map.areas[id].label }));
}

// ── Serialization ────────────────────────────────────────────────────────────

export function toJSON(map) {
  return JSON.stringify(map);
}

export function fromJSON(str) {
  try {
    const parsed = JSON.parse(str);
    if (!parsed) return createMap();
    if (parsed.version === 2) {
      return {
        version: 2,
        rooms: parsed.rooms || {},
        keyIndex: parsed.keyIndex || {},
        areas: parsed.areas || {},
        areaKeyIndex: parsed.areaKeyIndex || {},
        nextId: parsed.nextId || 1,
        nextAreaId: parsed.nextAreaId || 1,
        currentId: parsed.currentId ?? null,
      };
    }
    if (parsed.version === 1) return migrateV1(parsed);
    return createMap();
  } catch {
    return createMap();
  }
}

// v1 had a single global grid and no areas. Wrap every room in one "Overworld"
// area, preserving coordinates and exits, so an existing map survives upgrade.
function migrateV1(v1) {
  const map = createMap();
  map.rooms = v1.rooms || {};
  map.keyIndex = v1.keyIndex || {};
  map.nextId = v1.nextId || 1;
  map.currentId = v1.currentId ?? null;
  const area = addArea(map, { key: "__overworld__", label: "Overworld" });
  for (const id of Object.keys(map.rooms)) {
    map.rooms[id].areaId = area.id;
  }
  return map;
}
