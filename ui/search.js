// Turn a user query into a destination room. Pure: no DOM, no host APIs.

import { distances } from "./pathfind.js";

export function matchRooms(map, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    // A room's name, its note, or one of its tags ("market" finds the Market Hall).
    const tags = Array.isArray(r.tags) ? r.tags : [];
    if ((r.name || "").toLowerCase().includes(q)
      || (r.note || "").toLowerCase().includes(q)
      || tags.some((t) => String(t).toLowerCase().includes(q))) out.push(r);
  }
  return out;
}

export function resolveDestination(map, fromId, query) {
  const raw = String(query || "").trim().replace(/^#/, "");
  if (map.rooms[raw]) return { roomId: raw, candidates: [] };   // exact id

  const candidates = matchRooms(map, raw);
  if (candidates.length === 0) return { roomId: null, candidates: [] };
  if (candidates.length === 1) return { roomId: candidates[0].id, candidates };

  const dist = distances(map, fromId);
  const reachable = candidates.filter((r) => dist[r.id] !== undefined);
  if (reachable.length === 0) return { roomId: null, candidates };

  let min = Infinity;
  for (const r of reachable) if (dist[r.id] < min) min = dist[r.id];
  const winners = reachable.filter((r) => dist[r.id] === min);
  if (winners.length === 1) return { roomId: winners[0].id, candidates };
  return { roomId: null, candidates };   // ambiguous: tie at the nearest distance
}
