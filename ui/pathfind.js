// Cross-area shortest-hop routing over the room graph. Pure: no DOM, no host
// APIs. Exits are directional `{ [dir]: { to } }`; area boundaries are ignored
// (cross-area edges are recorded by identity.js and are routable).

export function distances(map, fromId) {
  const dist = {};
  if (!map.rooms[fromId]) return dist;
  dist[fromId] = 0;
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    const room = map.rooms[id];
    for (const dir of Object.keys(room.exits)) {
      const to = room.exits[dir].to;
      if (to == null || !map.rooms[to] || dist[to] !== undefined) continue;
      dist[to] = dist[id] + 1;
      queue.push(to);
    }
  }
  return dist;
}

export function findPath(map, fromId, toId) {
  if (!map.rooms[fromId] || !map.rooms[toId]) return null;
  if (fromId === toId) return [];
  const prev = { [fromId]: null };   // roomId -> { from, dir } | null (start)
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    if (id === toId) break;
    const room = map.rooms[id];
    for (const dir of Object.keys(room.exits)) {
      const to = room.exits[dir].to;
      if (to == null || !map.rooms[to] || prev[to] !== undefined) continue;
      prev[to] = { from: id, dir };
      queue.push(to);
    }
  }
  if (prev[toId] === undefined) return null;
  const steps = [];
  let cur = toId;
  while (prev[cur]) {
    const { from, dir } = prev[cur];
    steps.unshift({ fromId: from, dir, toId: cur });
    cur = from;
  }
  return steps;
}
