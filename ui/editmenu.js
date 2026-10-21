// ui/editmenu.js
// Pure descriptor for the room right-click menu. No DOM, no host APIs; mapper.js
// walks this tree and binds onClick handlers by (action, arg). Node shape:
//   { label?, danger?, separator?, header?, disabled?, submenu?, action?, arg? }

import { ALL_DIRECTIONS, reverse } from "./directions.js";
import { SWATCHES } from "./annotate.js";
import { floorNeighbours } from "./floors.js";
import { linksOf, linkLabel } from "./links.js";

function colorSubmenu(room) {
  const nodes = SWATCHES.map(([name, hex]) => ({
    label: room.color === hex ? `✓ ${name}` : name,
    action: "setColor",
    arg: hex,
  }));
  nodes.push({ separator: true });
  nodes.push({ label: "Custom…", action: "setColorCustom" });
  nodes.push({ label: "Clear", action: "setColor", arg: "", disabled: !room.color });
  return nodes;
}

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
  const free = ALL_DIRECTIONS.filter((d) => !room.exits[d]);
  nodes.push({
    label: "Add exit",
    submenu: free.length
      ? free.map((d) => ({ label: d, action: "addExit", arg: d }))
      : [{ label: "(all directions used)", disabled: true }],
  });
  return nodes;
}

function linksSubmenu(map, room) {
  const nodes = [];
  const links = linksOf(room);
  for (const to of Object.keys(links)) {
    if (!map.rooms[to]) continue;
    const link = links[to];
    const oneWayNow = !linksOf(map.rooms[to])[room.id];
    nodes.push({
      label: linkLabel(map, room.id, to),
      submenu: [
        { label: "View", action: "viewRoom", arg: to },
        { label: link.name ? "Rename…" : "Name…", action: "renameLink", arg: to },
        { label: link.cmd ? `Command (${link.cmd})…` : "Command…", action: "setLinkCmd", arg: to },
        { label: oneWayNow ? "Make two-way" : "Make one-way", action: "toggleLinkOneWay", arg: { to, oneWay: !oneWayNow } },
        { label: "Delete link", danger: true, action: "deleteLink", arg: to },
      ],
    });
  }
  if (nodes.length) nodes.push({ separator: true });
  nodes.push({ label: "Link to…", action: "addLink" });
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
  // Where the room leads on other floors: each item shows that floor.
  const floors = floorNeighbours(map, room).map((f) => ({
    label: `${f.up ? "▲" : "▼"} View ${map.rooms[f.toId].name || `#${f.toId}`}`,
    action: "viewRoom",
    arg: f.toId,
  }));
  return [
    { label: room.name || `#${id}`, header: true },
    ...floors,
    ...(floors.length ? [{ separator: true }] : []),
    { label: "Rename…", action: "rename" },
    { label: "Colour", submenu: colorSubmenu(room) },
    { label: room.symbol ? `Symbol (${room.symbol})…` : "Symbol…", action: "setSymbol" },
    { label: room.note ? "Edit note…" : "Add note…", action: "setNote" },
    { label: "Set as current", action: "setCurrent" },
    { label: "Merge into…", action: "merge" },
    { label: "Exits", submenu: exitsSubmenu(map, room) },
    { label: "Links", submenu: linksSubmenu(map, room) },
    { separator: true },
    { label: "Move to area", submenu: areaSubmenu(room, areas, "moveToArea") },
    { label: "Move connected pocket", submenu: areaSubmenu(room, areas, "movePocket") },
    { separator: true },
    { label: "Delete room", danger: true, action: "deleteRoom" },
  ];
}
