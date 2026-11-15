// How far apart an area's rooms are, as a factor for the drawing distances
// that are about rooms: an off-grid region's discs and bands and how far
// it's closed, how far the relief estimate reaches round rooms and its
// lattice. Those are kept in render.js, closing.js and relief.js as they
// were tuned, and multiplied by the area's `spacing`, so a game placing rooms
// by metres (30–50 units apart) is drawn as one placing them a unit or two
// apart.
//
// Measured as the median length of the exits between two of the area's rooms
// on one floor, each over its direction's step (a diagonal is √2 steps long
// on a grid, so it counts as one step); the short way round on a ring.
//  - An area whose rooms all sit on whole multiples of that median, rounded
//    (at least 1), is a lattice, and its spacing is that whole step (a
//    grid's few long exits don't make it 1.2). A grid's is 1, so grids are
//    drawn as they always were.
//  - Off a lattice (land placed by km) it's the median over LAND_SPACING,
//    the median of the land the off-grid drawing was tuned on, so land like
//    that is drawn as tuned (spacing about 1) and land twice as sparse twice
//    as large.
// With fewer than MIN_EXITS such exits it's 1. Pure.

import { isCompass, vector } from "./directions.js";

export const MIN_EXITS = 3;
export const LAND_SPACING = 1.6;
export const MIN_SPACING = 0.01;
export const MAX_SPACING = 10000;

// Map(areaId → { spacing, lattice }) for every area with rooms, in one pass.
export function areaSpacings(map) {
  const lengths = new Map();   // areaId → [step lengths]
  const seen = new Set();
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (!r.coords) continue;
    const a = r.areaId;
    if (!lengths.has(a)) lengths.set(a, []);
    for (const dir of Object.keys(r.exits || {})) {
      if (!isCompass(dir)) continue;
      const v = vector(dir);
      const step = Math.hypot(v.dx, v.dy);
      if (!step) continue;
      const to = r.exits[dir].to;
      const t = to != null ? map.rooms[to] : null;
      if (!t || !t.coords || t.areaId !== a || t.coords.z !== r.coords.z) continue;
      const key = id < to ? `${id}|${to}` : `${to}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let dx = t.coords.x - r.coords.x;
      const w = r.wrapX;
      if (w && t.wrapX === w) dx = ((((dx + w / 2) % w) + w) % w) - w / 2;
      const len = Math.hypot(dx, t.coords.y - r.coords.y);
      if (len > 0) lengths.get(a).push(len / step);
    }
  }
  // A lattice: every room on whole multiples of the median's whole step.
  const steps = new Map(), lattice = new Map();
  for (const [a, list] of lengths) {
    steps.set(a, Math.max(1, Math.round(median(list) || 1)));
    lattice.set(a, true);
  }
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (!r.coords || !lattice.get(r.areaId)) continue;
    const st = steps.get(r.areaId);
    if (!Number.isInteger(r.coords.x / st) || !Number.isInteger(r.coords.y / st)) lattice.set(r.areaId, false);
  }
  const out = new Map();
  for (const [a, list] of lengths) out.set(a, { spacing: spacingOf(list, lattice.get(a)), lattice: lattice.get(a) });
  return out;
}

function median(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((x, y) => x - y);
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// One area's { spacing, lattice } (a pass over all the rooms: keep
// areaSpacings' result where it's needed often).
export function areaSpacing(map, areaId) {
  return areaSpacings(map).get(areaId) || NO_SPACING;
}
export const NO_SPACING = Object.freeze({ spacing: 1, lattice: false });

// The spacing from exits' step lengths: their median (over LAND_SPACING off
// a lattice, whole on one), 1 for too few, clamped.
export function spacingOf(lengths, lattice = false) {
  if (lengths.length < MIN_EXITS) return 1;
  let m = median(lengths);
  m = lattice ? Math.max(1, Math.round(m)) : m / LAND_SPACING;
  return Math.min(MAX_SPACING, Math.max(MIN_SPACING, m));
}
