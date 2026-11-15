// Closing the holes in an off-grid region's patch. A patch off a grid (land
// placed by km) is a disc per room and a band along each exit between two of
// its rooms (render.js regionLayout), so a ring of exits round open ground
// leaves a hole in it, and a dent between two arms a bay. Morphological
// closing fills both while keeping the outline: grow the shape by `r`, then
// shrink what that gives by `r` again. A gap narrower than about 2r is gone;
// anything wider comes back as it was, rounded off at its corners.
//
// The grown shape is exact (a disc of size + r per room, a capsule of
// band + r per band), rasterised into a mask; the shrink is a Euclidean
// distance transform of that mask's outside, so the result's edge has an
// alpha ramp a mask pixel wide (antialiased). Pure: draw() in render.js
// turns it into a canvas, unions it with the patch's own path (so the outer
// edge is the crisp vector one) and caches it.

// How far the patch is grown and shrunk, in cells (room spacings): gaps up
// to about twice this close.
export const CLOSE_RADIUS = 1.1;

// Squared Euclidean distance transform in one dimension (Felzenszwalb and
// Huttenlocher): f in, d out, over n samples. v, z are scratch. "None" is
// FAR, not Infinity, so the parabola sums stay finite.
const FAR = 1e20;
function edt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// For each pixel of a w×h mask, the distance in pixels to the nearest pixel
// where the mask is 0 (Infinity where there's none). Beyond the mask's edge
// doesn't count as 0.
export function distanceToOutside(mask, w, h) {
  const n = w * h;
  const D = new Float64Array(n);
  for (let k = 0; k < n; k++) D[k] = mask[k] ? FAR : 0;
  const m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m);
  const v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = D[y * w + x];
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) D[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = D[y * w + x];
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) D[y * w + x] = d[x];
  }
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = D[k] >= FAR / 2 ? Infinity : Math.sqrt(D[k]);
  return out;
}

// Mark the pixels of `mask` (w×h, pixel (x, y) centred at
// x0 + (x + 0.5)·ds, y0 + (y + 0.5)·ds) within `rad` of the segment a→b.
function fillCapsule(mask, w, h, x0, y0, ds, ax, ay, bx, by, rad) {
  const minX = Math.max(0, Math.floor((Math.min(ax, bx) - rad - x0) / ds));
  const maxX = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + rad - x0) / ds));
  const minY = Math.max(0, Math.floor((Math.min(ay, by) - rad - y0) / ds));
  const maxY = Math.min(h - 1, Math.ceil((Math.max(ay, by) + rad - y0) / ds));
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, r2 = rad * rad;
  for (let y = minY; y <= maxY; y++) {
    const py = y0 + (y + 0.5) * ds;
    for (let x = minX; x <= maxX; x++) {
      const px = x0 + (x + 0.5) * ds;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
      if (ex * ex + ey * ey <= r2) mask[y * w + x] = 1;
    }
  }
}

// The closed patch's alpha over a box. `p` is a round patch as regionLayout
// makes it ({ nodes: [{ px, py }], size, bands: [{ x1, y1, x2, y2 }], band },
// in px); `box` is { x0, y0, w, h } with w×h mask pixels of `ds` px each from
// (x0, y0); `r` the closing radius in px. → Uint8ClampedArray of w·h, 255
// inside the closed shape, ramping to 0 across a pixel at its edge.
export function closedAlpha(p, box, ds, r) {
  const { x0, y0, w, h } = box;
  const grown = new Uint8Array(w * h);
  for (const n of p.nodes) fillCapsule(grown, w, h, x0, y0, ds, n.px, n.py, n.px, n.py, p.size + r);
  for (const b of p.bands) fillCapsule(grown, w, h, x0, y0, ds, b.x1, b.y1, b.x2, b.y2, p.band + r);
  const D = distanceToOutside(grown, w, h);
  const rp = r / ds;
  const out = new Uint8ClampedArray(w * h);
  for (let k = 0; k < out.length; k++) {
    const a = D[k] - rp + 0.5;
    out[k] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
  }
  return out;
}

// The box (in px) to close a patch over: round its shape, grown by r, and no
// more than 2r past the view (w×h px from 0, 0), since closing near the box's
// edge isn't right and should happen out of sight. Null when none of it is
// in view.
export function closeBox(p, r, width, height) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y, rad) => {
    if (x - rad < x0) x0 = x - rad;
    if (y - rad < y0) y0 = y - rad;
    if (x + rad > x1) x1 = x + rad;
    if (y + rad > y1) y1 = y + rad;
  };
  for (const n of p.nodes) grow(n.px, n.py, p.size + r);
  for (const b of p.bands) { grow(b.x1, b.y1, p.band + r); grow(b.x2, b.y2, p.band + r); }
  x0 = Math.max(x0, -2 * r); y0 = Math.max(y0, -2 * r);
  x1 = Math.min(x1, width + 2 * r); y1 = Math.min(y1, height + 2 * r);
  if (!(x1 > x0 && y1 > y0) || x1 < 0 || y1 < 0 || x0 > width || y0 > height) return null;
  return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) };
}

// Mask pixels a closing is worked at, in px: about a sixteenth of the radius
// (so the ramp at the edge is soft but small), between 1 and 2.5 px, and
// coarser if the box would be more than MAX_MASK pixels.
export const MAX_MASK = 1_000_000;
export function closeStep(r, bw, bh) {
  let ds = Math.min(2.5, Math.max(1, r / 16));
  while ((bw / ds) * (bh / ds) > MAX_MASK) ds *= 1.25;
  return ds;
}

// Two rooms of one off-grid region whose discs (radius s) are `d` apart,
// centre to centre, are joined once closed when d is at most this: the neck
// of their grown discs is still r wide at the middle. In the same units.
export function closedReach(s, r) {
  return 2 * Math.sqrt(s * s + 2 * s * r);
}
