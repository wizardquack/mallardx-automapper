// ui/editmenu.js
// Pure descriptor for the room right-click menu. No DOM, no host APIs; mapper.js
// walks this tree and binds onClick handlers by (action, arg). Node shape:
//   { label?, danger?, separator?, header?, disabled?, submenu?, action?, arg? }

import { DIRECTIONS, reverse } from "./directions.js";

function exitsSubmenu(map, room) {
  const nodes = [];
  const dirs = Object.keys(room.exits);
  for (const dir of dirs) {
    const to = room.exits[dir].to;
    const dest = map.rooms[to];
    const destName = dest ? (dest.name || `#${to}`) : `#${to}`;
    const back = reverse(dir);
    const oneWayNow = !(back && dest && dest.exits[back] && dest.exits[back].to === room.id);
    nodes.push({
      label: `${dir} → ${destName}`,
      submenu: [
        { label: "Delete exit", danger: true, action: "deleteExit", arg: dir },
        {
          label: oneWayNow ? "Make two-way" : "Make one-way",
          action: "toggleOneWay",
          arg: { dir, oneWay: !oneWayNow },
        },
      ],
    });
  }
  if (dirs.length) nodes.push({ separator: true });
  const free = DIRECTIONS.filter((d) => !room.exits[d]);
  nodes.push({
    label: "Add exit",
    submenu: free.length
      ? free.map((d) => ({ label: d, action: "addExit", arg: d }))
      : [{ label: "(all directions used)", disabled: true }],
  });
  return nodes;
}

function areaSubmenu(room, areas, action) {
  const others = areas.filter((a) => a.id !== room.areaId);
  const nodes = others.map((a) => ({
    label: a.label || `Area ${a.id}`,
    action,
    arg: a.id,
  }));
  if (nodes.length) nodes.push({ separator: true });
  nodes.push({ label: "New area…", action, arg: "__new__" });
  return nodes;
}

export function roomMenuModel(map, id, areas) {
  const room = map.rooms[id];
  if (!room) return [];
  return [
    { label: room.name || `#${id}`, header: true },
    { label: "Rename…", action: "rename" },
    { label: "Set as current", action: "setCurrent" },
    { label: "Merge into…", action: "merge" },
    { label: "Exits", submenu: exitsSubmenu(map, room) },
    { separator: true },
    { label: "Move to area", submenu: areaSubmenu(room, areas, "moveToArea") },
    { label: "Move connected pocket", submenu: areaSubmenu(room, areas, "movePocket") },
    { separator: true },
    { label: "Delete room", danger: true, action: "deleteRoom" },
  ];
}
