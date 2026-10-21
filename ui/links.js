// Links: ways between two rooms that aren't an exit — a lift, a portal, a
// ferry, a recall. Pure: no DOM, no host APIs.
//
// A room's links are `room.links = { [toId]: { name?, cmd?, server? } }`
// (absent on rooms from older saves, so readers treat a missing one as
// empty). Like exits they're one-way; a two-way link is one each way.
//   name   — what to call it ("Lift 12"); optional.
//   cmd    — the command that takes it, where one does ("enter portal"). A
//            link without one is taken by hand: a speedwalk stops before it
//            and carries on once you arrive (walk.js).
//   server — the server sent it (mudstd `links`), rather than the user.

export function linksOf(room) {
  return (room && room.links) || {};
}

function clean(v) {
  return typeof v === "string" ? v.trim() : "";
}

function setOne(map, fromId, toId, { name, cmd, server } = {}) {
  const from = map.rooms[fromId];
  if (!from || !map.rooms[toId] || fromId === toId) return false;
  const link = {};
  if (clean(name)) link.name = clean(name);
  if (clean(cmd)) link.cmd = clean(cmd);
  if (server) link.server = true;
  from.links = from.links || {};
  from.links[toId] = link;
  return true;
}

// Link fromId to toId (and back, unless `oneWay`). Replaces a link already
// there. False when either room is missing or they're the same room.
export function addLink(map, fromId, toId, { name, cmd, oneWay = false } = {}) {
  if (!setOne(map, fromId, toId, { name, cmd })) return false;
  if (!oneWay) setOne(map, toId, fromId, { name, cmd });
  return true;
}

function dropOne(map, fromId, toId) {
  const from = map.rooms[fromId];
  if (!from || !from.links || !from.links[toId]) return false;
  delete from.links[toId];
  if (Object.keys(from.links).length === 0) delete from.links;
  return true;
}

// Remove the link fromId → toId, and the one back.
export function deleteLink(map, fromId, toId) {
  const a = dropOne(map, fromId, toId);
  const b = dropOne(map, toId, fromId);
  return a || b;
}

// One-way drops the link back; two-way adds it, named and commanded alike.
export function setLinkOneWay(map, fromId, toId, oneWay) {
  const link = linksOf(map.rooms[fromId])[toId];
  if (!link) return false;
  if (oneWay) return dropOne(map, toId, fromId);
  if (linksOf(map.rooms[toId])[fromId]) return false;
  return setOne(map, toId, fromId, link);
}

// Set a link's name or cmd, both ways where it goes both ways. Empty clears.
export function setLinkField(map, fromId, toId, field, value) {
  const v = clean(value);
  let changed = false;
  for (const [a, b] of [[fromId, toId], [toId, fromId]]) {
    const link = linksOf(map.rooms[a])[b];
    if (!link || (link[field] || "") === v) continue;
    if (v) link[field] = v; else delete link[field];
    changed = true;
  }
  return changed;
}

// What to call a link: its name, else where it goes.
export function linkLabel(map, fromId, toId) {
  const link = linksOf(map.rooms[fromId])[toId];
  const to = map.rooms[toId];
  const where = to ? (to.name || `#${toId}`) : `#${toId}`;
  return link && link.name ? `${link.name} → ${where}` : where;
}

// Does the map know a way from one room to the other — an exit or a link?
export function hasWay(map, fromId, toId) {
  const from = map.rooms[fromId];
  if (!from) return false;
  if (linksOf(from)[toId]) return true;
  return Object.keys(from.exits).some((d) => from.exits[d].to === toId);
}

// ── Keeping links whole when rooms go (edits.js) ─────────────────────────────

// Drop every link into `id` (a room being deleted).
export function dropLinksTo(map, id) {
  for (const otherId of Object.keys(map.rooms)) dropOne(map, otherId, id);
}

// Fold source's links into target's (target keeps its own), and point links
// into source at target. A link that would join target to itself goes.
export function mergeLinks(map, sourceId, targetId) {
  const src = map.rooms[sourceId], tgt = map.rooms[targetId];
  if (!src || !tgt) return;
  for (const to of Object.keys(linksOf(src))) {
    if (to === targetId || linksOf(tgt)[to]) continue;
    tgt.links = tgt.links || {};
    tgt.links[to] = { ...src.links[to] };
  }
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    const link = linksOf(r)[sourceId];
    if (!link) continue;
    dropOne(map, id, sourceId);
    if (id !== targetId && id !== sourceId && !linksOf(r)[targetId]) {
      r.links = r.links || {};
      r.links[targetId] = link;
    }
  }
}
