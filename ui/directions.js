// Geometry of the 10 canonical directions. Coordinate convention:
// north decreases y, east increases x, up increases z.

export const DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw", "u", "d"];

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
};

export function vector(dir) {
  const v = VECTORS[dir];
  return v ? { ...v } : null;
}

export function reverse(dir) {
  return REVERSE[dir] || null;
}

export function isDirection(dir) {
  return Object.prototype.hasOwnProperty.call(VECTORS, dir);
}
