// The per-world map: rooms keyed by internal id (with a key→id index), and
// areas keyed by internal id (with a key→id index). Each area is its own
// coordinate space. Pure data + mutations; no DOM, no host APIs.

import { reliefFromJSON } from "./relief.js";

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
    // mudstd.room.terrain definitions: { [id]: { label, color } }.
    terrains: {},
    // mudstd.room.tags definitions, in the server's order (annotate.js
    // roomGlyph takes the first with a glyph): [{ id, label, glyph }].
    tagDefs: [],
    // Charts imported (chart.js): { [chartName]: version }.
    charts: {},
    // True once the server has sent a `links` list (links.js): it says where
    // its ways that aren't exits go, so a move by neither is a teleport.
    serverWays: false,
    // Ground relief (relief.js, mudstd.relief.patch): { [area]: { [z]:
    // ReliefGrid } }, by the frames' area key. Saved as base64 chunks.
    relief: {},
  };
}

// Rooms may also carry fields set by identity.js and absent on rooms from
// older saves (so readers treat a missing one as empty):
//   exitKeys     — { [dir]: targetKey }, the exits the room last reported by key.
//   exitDirs     — [dir], the exits the room last listed, with a key or
//                  without (mudstd), or as a captured (non-GMCP) room's line.
//   exitAreas    — { [dir]: { tag, name } }, the exits it last reported as
//                  leading out of its area, with that area's key and name.
//   serverCoords — true once the server has placed the room by coordinates;
//                  such a room isn't displaced by another the server places.
//   wrapX        — where the server says the room's x comes round (a ring's
//                  seam); render.js draws the ring centred on the view.
//   tags, region — the server's features and part-of-area key (annotate.js).
//   links        — { [toId]: { name?, cmd?, server? } }, ways that aren't exits
//                  (links.js); the user's, or the server's `links` extension.
//   linkKeys     — { [targetKey]: { name?, cmd? } }, the links the room last
//                  reported by key, for targets not yet on the map.
//   exitStyles   — { [dir]: style }, how the exits it last reported are drawn
//                  (mudstd extension `style`: road, trail, climb; path is
//                  the default and isn't kept).
//   elevation    — metres above the world's datum (not a floor; coords.z is).
//   lat, lon     — degrees north and east.
//   charted      — true for a room the server sent in a chart (chart.js) that
//                  you haven't been in yet; cleared on arrival.
// and fields only the user sets (edits.js): color, symbol, note.
// Areas may carry `regions` — { [regionKey]: name } — and `regionColors` —
// { [regionKey]: "#rrggbb" }, the server's colour for a region (0.12.0; a
// separate map so maps saved before it load as they are).
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

// Merge mudstd.room.terrain definitions into the map. True if anything changed.
export function setTerrains(map, defs) {
  map.terrains = map.terrains || {};
  let changed = false;
  for (const id of Object.keys(defs || {})) {
    const cur = map.terrains[id], next = defs[id];
    if (!cur || cur.label !== next.label || cur.color !== next.color) {
      map.terrains[id] = { label: next.label, color: next.color };
      changed = true;
    }
  }
  return changed;
}

// Merge mudstd.room.tags definitions ([{ id, label, glyph }]) into the map:
// the new list in its order, then any held ones it doesn't name. True if
// anything changed.
export function setTagDefs(map, defs) {
  const prev = Array.isArray(map.tagDefs) ? map.tagDefs : [];
  const ids = new Set((defs || []).map((d) => d.id));
  const next = [
    ...(defs || []).map((d) => ({ id: d.id, label: d.label, glyph: d.glyph ?? null })),
    ...prev.filter((d) => !ids.has(d.id)),
  ];
  const changed = JSON.stringify(next) !== JSON.stringify(prev);
  map.tagDefs = next;
  return changed;
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

// `relief: false` leaves the relief grids out: undo snapshots don't carry
// them (they can be large, and edits don't change them), and mapper.js keeps
// the live grids across an undo.
export function toJSON(map, { relief = true } = {}) {
  if (relief) return JSON.stringify(map);
  return JSON.stringify({ ...map, relief: undefined });
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
        terrains: parsed.terrains || {},
        tagDefs: Array.isArray(parsed.tagDefs) ? parsed.tagDefs : [],
        charts: parsed.charts || {},
        serverWays: parsed.serverWays === true,
        relief: reliefFromJSON(parsed.relief),
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
