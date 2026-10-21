// The rooms a room leads to on other floors. Pure: no DOM, no host APIs.
// Only one floor is drawn at a time, so a way up or down can't be a line;
// render.js marks the room instead, and the menu and hover card name where
// it goes.

// [{ toId, up }] — one per room above (up true) or below (up false) that an
// exit reaches. A `u` or `d` exit counts wherever it leads (another area
// too); any other exit counts where its target is in the same area on
// another z (a server's coords can put a stair's `n` a floor up).
export function floorNeighbours(map, room) {
  const out = [];
  const seen = new Set();
  const add = (toId, up) => {
    if (seen.has(toId)) return;
    seen.add(toId);
    out.push({ toId, up });
  };
  for (const dir of Object.keys(room.exits || {})) {
    const to = room.exits[dir].to;
    const t = to != null ? map.rooms[to] : null;
    if (!t || t.id === room.id) continue;
    if (dir === "u") add(t.id, true);
    else if (dir === "d") add(t.id, false);
    else if (t.areaId === room.areaId && t.coords.z !== room.coords.z) add(t.id, t.coords.z > room.coords.z);
  }
  return out;
}

// { up, down } — whether the room leads anywhere above or below.
export function floorMarks(map, room) {
  const n = floorNeighbours(map, room);
  return { up: n.some((x) => x.up), down: n.some((x) => !x.up) };
}
