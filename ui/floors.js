import { linksOf } from "./links.js";

// The rooms a room leads to on other floors. Pure: no DOM, no host APIs.
// Only one floor is drawn at a time, so a way up or down can't be a line;
// render.js marks the room instead, and the menu and hover card name where
// it goes.

// [{ toId, up, via }] — one per room above (up true) or below (up false) that an
// exit or link reaches. A `u` or `d` exit counts wherever it leads (another
// area too); any other exit, and a link (a lift), counts where its target is
// in the same area on another z (a server's coords can put a stair's `n` a
// floor up). `via` is "exit" or "link", whichever reached it first.
export function floorNeighbours(map, room) {
  const out = [];
  const seen = new Set();
  const add = (toId, up, via) => {
    if (seen.has(toId)) return;
    seen.add(toId);
    out.push({ toId, up, via });
  };
  for (const dir of Object.keys(room.exits || {})) {
    const to = room.exits[dir].to;
    const t = to != null ? map.rooms[to] : null;
    if (!t || t.id === room.id) continue;
    if (dir === "u") add(t.id, true, "exit");
    else if (dir === "d") add(t.id, false, "exit");
    else if (t.areaId === room.areaId && t.coords.z !== room.coords.z) add(t.id, t.coords.z > room.coords.z, "exit");
  }
  for (const to of Object.keys(linksOf(room))) {
    const t = map.rooms[to];
    if (t && t.areaId === room.areaId && t.coords.z !== room.coords.z) add(t.id, t.coords.z > room.coords.z, "link");
  }
  return out;
}

// { up, down, link } — whether the room leads anywhere above or below, and
// whether it has a link that isn't one of those (a portal on this floor, a
// ferry to another area).
export function floorMarks(map, room) {
  const n = floorNeighbours(map, room);
  const onFloors = new Set(n.map((x) => x.toId));
  return {
    up: n.some((x) => x.up),
    down: n.some((x) => !x.up),
    link: Object.keys(linksOf(room)).some((to) => map.rooms[to] && !onFloors.has(to)),
  };
}
