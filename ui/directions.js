// Geometry of the 10 canonical compass directions, plus `in` and `out`.
// Coordinate convention: north decreases y, east increases x, up increases z.
//
// `in` and `out` are real exits (a hatch, a doorway, a ship's airlock) with a
// reverse but no vector: the graph stores them as edges, pathfinding and
// speedwalk follow them, and placement and drawing leave them alone.

export const DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw", "u", "d"];
export const SPECIAL_DIRECTIONS = ["in", "out"];
export const ALL_DIRECTIONS = [...DIRECTIONS, ...SPECIAL_DIRECTIONS];

const VECTORS = {
  n:  { dx: 0,  dy: -1, dz: 0 },
  s:  { dx: 0,  dy: 1,  dz: 0 },
  e:  { dx: 1,  dy: 0,  dz: 0 },
  w:  { dx: -1, dy: 0,  dz: 0 },
  ne: { dx: 1,  dy: -1, dz: 0 },
  nw: { dx: -1, dy: -1, dz: 0 },
  se: { dx: 1,  dy: 1,  dz: 0 },
  sw: { dx: -1, dy: 1,  dz: 0 },
  u:  { dx: 0,  dy: 0,  dz: 1 },
  d:  { dx: 0,  dy: 0,  dz: -1 },
};

const REVERSE = {
  n: "s", s: "n", e: "w", w: "e",
  ne: "sw", sw: "ne", nw: "se", se: "nw",
  u: "d", d: "u",
  in: "out", out: "in",
};

export function vector(dir) {
  const v = VECTORS[dir];
  return v ? { ...v } : null;
}

export function reverse(dir) {
  return REVERSE[dir] || null;
}

// A direction the graph stores as an exit: compass or in/out.
export function isDirection(dir) {
  return Object.prototype.hasOwnProperty.call(REVERSE, dir);
}

// A direction with a vector, so it can place a room relative to another.
export function isCompass(dir) {
  return Object.prototype.hasOwnProperty.call(VECTORS, dir);
}
