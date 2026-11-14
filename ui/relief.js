// Ground relief: the server's height-and-ground grid (mudstd.relief.patch,
// docs/relief-spec.md) kept per area and floor, and what's drawn from it
// behind the map: ground colour, hill shading and contours. Where an area has
// no grid near its rooms, a height field estimated from the rooms' elevation
// stands in (shading and contours only). Pure bar paintRelief, which takes a
// canvas context; mapper.js wires the host, render.js calls the painter.
//
// Frames. The grid is kept as the server sends it: cell (i, j) centred at
// x = i·cell, y = j·cell in the area's units, north +y. The map draws north
// as -y (identity.js fromServer), so the drawn lattice uses k = -j.

export const MAX_PATCH = 64;           // cols and rows per patch, at most
export const CHUNK = 32;               // cells per side of a stored chunk
export const UNKNOWN_H = -32768;
export const UNKNOWN_G = 255;
export const MAX_GROUND_IDS = 255;     // ground indices 0…254; 255 is unknown

// ── base64 ───────────────────────────────────────────────────────────────────

export function bytesFromB64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64FromBytes(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// Int16 values ↔ base64 of their little-endian bytes.
function int16FromB64(s, n) {
  const b = bytesFromB64(s);
  if (!b || b.length !== n * 2) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

function b64FromInt16(a) {
  const b = new Uint8Array(a.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < a.length; i++) dv.setInt16(i * 2, a[i], true);
  return b64FromBytes(b);
}

// ── Patches ──────────────────────────────────────────────────────────────────

// A patch's `height` (base64 of LE int16, or an array of integers with null
// for unknown) → Int16Array of n, unknown as UNKNOWN_H; null if malformed.
// Array values that aren't whole numbers in range are unknown.
export function decodeHeights(v, n) {
  if (typeof v === "string") return int16FromB64(v, n);
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const h = v[i];
    out[i] = Number.isInteger(h) && h >= -32767 && h <= 32767 ? h : UNKNOWN_H;
  }
  return out;
}

// A patch's ground `data` (base64 of uint8, or an array) → Uint8Array of n,
// with 255 for unknown and for any index past the `ids` list; null if malformed.
export function decodeGround(v, n, idCount) {
  let out;
  if (typeof v === "string") {
    out = bytesFromB64(v);
    if (!out || out.length !== n) return null;
  } else if (Array.isArray(v) && v.length === n) {
    out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const g = v[i];
      out[i] = Number.isInteger(g) && g >= 0 && g < UNKNOWN_G ? g : UNKNOWN_G;
    }
  } else {
    return null;
  }
  for (let i = 0; i < n; i++) if (out[i] >= idCount) out[i] = UNKNOWN_G;
  return out;
}

// A host `relief_patch` frame → { area, z, cell, i0, j0, cols, rows,
// height: Int16Array, ground: Uint8Array | null, ids: [string] }, or null.
// (i0, j0) is the north-west cell; row r, column c is cell (i0 + c, j0 - r).
// A malformed ground drops the ground, not the patch.
export function decodePatch(f) {
  if (!f || typeof f !== "object") return null;
  const area = typeof f.area === "string" && f.area ? f.area
    : typeof f.area === "number" ? String(f.area) : null;
  if (area == null) return null;
  const z = f.z == null ? 0 : f.z;
  const { cell, x, y, cols, rows } = f;
  if (!Number.isInteger(z)) return null;
  if (!(Number.isFinite(cell) && cell > 0)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if (cols < 1 || rows < 1 || cols > MAX_PATCH || rows > MAX_PATCH) return null;
  const n = cols * rows;
  const height = decodeHeights(f.height, n);
  if (!height) return null;
  let ground = null, ids = [];
  const g = f.ground;
  if (g && typeof g === "object" && Array.isArray(g.ids)) {
    const list = g.ids.slice(0, MAX_GROUND_IDS).map((s) => (typeof s === "string" || typeof s === "number" ? String(s) : ""));
    ground = decodeGround(g.data, n, list.length);
    if (ground) ids = list;
  }
  return { area, z, cell, i0: Math.round(x / cell), j0: Math.round(y / cell), cols, rows, height, ground, ids };
}

// ── Storage ──────────────────────────────────────────────────────────────────

let REV = 0;

// One floor's grid: sparse CHUNK×CHUNK chunks of heights (Int16, UNKNOWN_H)
// and ground (Uint8 indices into `ids`, UNKNOWN_G). Saved as base64 per chunk
// (toJSON); a chunk with no ground known saves no ground. `rev` changes on
// every change, for the drawing cache, and isn't saved.
export class ReliefGrid {
  constructor(cell, ids = []) {
    this.cell = cell;
    this.ids = ids.slice();
    this.chunks = new Map();
    this.rev = ++REV;
  }

  chunkAt(i, j, make) {
    const ci = Math.floor(i / CHUNK), cj = Math.floor(j / CHUNK);
    const key = `${ci},${cj}`;
    let ch = this.chunks.get(key);
    if (!ch && make) {
      ch = { h: new Int16Array(CHUNK * CHUNK).fill(UNKNOWN_H), g: new Uint8Array(CHUNK * CHUNK).fill(UNKNOWN_G) };
      this.chunks.set(key, ch);
    }
    return ch ? { ch, at: (j - cj * CHUNK) * CHUNK + (i - ci * CHUNK) } : null;
  }

  height(i, j) {
    const c = this.chunkAt(i, j, false);
    return c ? c.ch.h[c.at] : UNKNOWN_H;
  }

  ground(i, j) {
    const c = this.chunkAt(i, j, false);
    return c ? c.ch.g[c.at] : UNKNOWN_G;
  }

  // The index of a ground id in `ids`, adding it; UNKNOWN_G once full.
  groundIndex(id) {
    let k = this.ids.indexOf(id);
    if (k < 0) {
      if (this.ids.length >= MAX_GROUND_IDS) return UNKNOWN_G;
      k = this.ids.push(id) - 1;
    }
    return k;
  }

  get size() {
    return this.chunks.size;
  }

  toJSON() {
    const chunks = {};
    for (const [key, ch] of this.chunks) {
      const out = { h: b64FromInt16(ch.h) };
      if (ch.g.some((v) => v !== UNKNOWN_G)) out.g = b64FromBytes(ch.g);
      chunks[key] = out;
    }
    return { cell: this.cell, ids: this.ids, chunks };
  }

  static fromJSON(o) {
    if (!o || typeof o !== "object" || !(Number.isFinite(o.cell) && o.cell > 0)) return null;
    const grid = new ReliefGrid(o.cell, Array.isArray(o.ids) ? o.ids.map(String).slice(0, MAX_GROUND_IDS) : []);
    const n = CHUNK * CHUNK;
    for (const key of Object.keys(o.chunks || {})) {
      if (!/^-?\d+,-?\d+$/.test(key)) continue;
      const c = o.chunks[key];
      const h = c && int16FromB64(c.h, n);
      if (!h) continue;
      const g = (c.g && bytesFromB64(c.g)) || null;
      grid.chunks.set(key, { h, g: g && g.length === n ? g : new Uint8Array(n).fill(UNKNOWN_G) });
    }
    return grid;
  }
}

// map.relief: { [area]: { [z]: ReliefGrid } }, the area as the room frames'
// `area` key (the map's area key without its "zone:").
export function reliefFromJSON(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const area of Object.keys(o)) {
    const floors = o[area];
    if (!floors || typeof floors !== "object") continue;
    for (const z of Object.keys(floors)) {
      const g = ReliefGrid.fromJSON(floors[z]);
      if (g && g.size) (out[area] = out[area] || {})[z] = g;
    }
  }
  return out;
}

// How many cells round a ring is for a grid of `cell` where x wraps at
// `wrapX` (map units), or 0 for no wrap.
export function wrapCells(wrapX, cell) {
  if (!(wrapX > 0) || !(cell > 0)) return 0;
  return Math.max(1, Math.round(wrapX / cell));
}

// Column i brought into [0, wc) on a ring of wc cells; as it is for none.
export function wrapI(i, wc) {
  return wc ? ((i % wc) + wc) % wc : i;
}

// Merge a decoded patch into the map: known cells overwrite, unknown ones
// never erase; a patch with another `cell` for that area and floor replaces
// the grid. x is kept modulo the area's wrap (`wrapX`, map units) where it
// has one. True if anything changed.
export function mergePatch(map, p, wrapX = null) {
  map.relief = map.relief || {};
  const floors = (map.relief[p.area] = map.relief[p.area] || {});
  let grid = floors[p.z];
  let changed = false;
  if (!grid || Math.abs(grid.cell - p.cell) > 1e-9 * Math.max(1, p.cell)) {
    grid = new ReliefGrid(p.cell);
    floors[p.z] = grid;
    changed = true;
  }
  const wc = wrapCells(wrapX, p.cell);
  const local = p.ground ? p.ids.map((id) => grid.groundIndex(id)) : null;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const k = r * p.cols + c;
      const h = p.height[k];
      const gk = p.ground ? p.ground[k] : UNKNOWN_G;
      const g = gk === UNKNOWN_G ? UNKNOWN_G : local[gk];
      if (h === UNKNOWN_H && g === UNKNOWN_G) continue;
      const cellAt = grid.chunkAt(wrapI(p.i0 + c, wc), p.j0 - r, true);
      const { ch, at } = cellAt;
      if (h !== UNKNOWN_H && ch.h[at] !== h) { ch.h[at] = h; changed = true; }
      if (g !== UNKNOWN_G && ch.g[at] !== g) { ch.g[at] = g; changed = true; }
    }
  }
  if (changed) grid.rev = ++REV;
  // A patch of nothing but unknowns shouldn't leave an empty grid behind.
  if (grid.size === 0) {
    delete floors[p.z];
    if (Object.keys(floors).length === 0) delete map.relief[p.area];
    return false;
  }
  return changed;
}

// Forget an area's grids, every floor. True if there were any.
export function clearRelief(map, area) {
  if (!map.relief || !map.relief[area]) return false;
  delete map.relief[area];
  return true;
}

// The relief key of a map area: its frames' `area` for a zone area, else null.
export function reliefArea(area) {
  const key = area && area.key;
  return typeof key === "string" && key.startsWith("zone:") ? key.slice(5) : null;
}

// ── The field in view ────────────────────────────────────────────────────────

// Estimated heights reach this far from a room (map units), fading from
// FALLBACK_FULL out; and aren't made within FALLBACK_REACH of a grid cell
// that's known. FALLBACK_CELL is the lattice for an area with no grid.
export const FALLBACK_REACH = 1.5;
export const FALLBACK_FULL = 0.75;
export const FALLBACK_CELL = 0.25;
const FALLBACK_SIGMA = 0.7;
// More columns or rows than this in view and nothing is drawn: the cells
// would be far below a pixel.
export const MAX_FIELD = 640;

// The height field over the view: a lattice of cells (column c is
// i = i0 + c, x = i·cell; row r is k = k0 + r, drawn y = k·cell), each with a
// height (NaN unknown), a ground index (UNKNOWN_G none), how much of it to
// draw (cov, 0…1: soft at the known region's edge), and whether it's
// estimated from rooms (est). `view`: { grid, rooms: [{ x, y, e }] in drawn
// map units, wrapX, anchor: { x, y }, cx, cy, scale } and the canvas
// width/height in px. Null when there's nothing to draw.
export function reliefField(view, width, height) {
  const { grid, rooms = [], wrapX = null, anchor, cx, cy, scale } = view;
  const cell = grid ? grid.cell : FALLBACK_CELL;
  const pad = 2;
  const x0 = anchor.x + (0 - cx) / scale, x1 = anchor.x + (width - cx) / scale;
  const y0 = anchor.y + (0 - cy) / scale, y1 = anchor.y + (height - cy) / scale;
  const i0 = Math.floor(x0 / cell) - pad, i1 = Math.ceil(x1 / cell) + pad;
  const k0 = Math.floor(y0 / cell) - pad, k1 = Math.ceil(y1 / cell) + pad;
  const cols = i1 - i0 + 1, rows = k1 - k0 + 1;
  if (cols < 2 || rows < 2 || cols > MAX_FIELD || rows > MAX_FIELD) return null;
  const n = cols * rows;
  const H = new Float32Array(n).fill(NaN);
  const G = new Uint8Array(n).fill(UNKNOWN_G);
  const known = new Uint8Array(n);
  const est = new Uint8Array(n);
  let any = false;

  if (grid) {
    const wc = wrapCells(wrapX, cell);
    const ai = Math.round(anchor.x / cell);
    for (let r = 0; r < rows; r++) {
      const j = -(k0 + r);
      for (let c = 0; c < cols; c++) {
        const i = i0 + c;
        // On a ring, only the turn nearest the anchor is drawn.
        if (wc && Math.abs(i - ai) > wc / 2) continue;
        const si = wrapI(i, wc);
        const h = grid.height(si, j);
        if (h === UNKNOWN_H) continue;
        const k = r * cols + c;
        H[k] = h;
        G[k] = grid.ground(si, j);
        known[k] = 1;
        any = true;
      }
    }
  }

  // Edge softness: the share of a known cell's 5×5 neighbourhood that's known.
  const cov = new Float32Array(n);
  if (any) {
    const frac = boxMean(known, cols, rows, 2);
    for (let k = 0; k < n; k++) if (known[k]) cov[k] = smooth(Math.min(1, frac[k] * 1.6));
  }

  if (rooms.length) {
    const near = any ? dilate(known, cols, rows, Math.ceil(FALLBACK_REACH / cell)) : null;
    const buckets = new Map();
    for (const rm of rooms) {
      const key = `${Math.floor(rm.x)},${Math.floor(rm.y)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(rm);
    }
    const reach = Math.ceil(FALLBACK_REACH);
    for (let r = 0; r < rows; r++) {
      const y = (k0 + r) * cell;
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        if (known[k] || (near && near[k])) continue;
        const x = (i0 + c) * cell;
        const bx = Math.floor(x), by = Math.floor(y);
        let sw = 0, swe = 0, dmin = Infinity;
        for (let dx = -reach; dx <= reach; dx++) {
          for (let dy = -reach; dy <= reach; dy++) {
            const list = buckets.get(`${bx + dx},${by + dy}`);
            if (!list) continue;
            for (const rm of list) {
              const d = Math.hypot(rm.x - x, rm.y - y);
              if (d > FALLBACK_REACH) continue;
              if (d < dmin) dmin = d;
              const w = Math.exp(-(d * d) / (FALLBACK_SIGMA * FALLBACK_SIGMA));
              sw += w; swe += w * rm.e;
            }
          }
        }
        if (dmin === Infinity || !(sw > 0)) continue;
        H[k] = swe / sw;
        est[k] = 1;
        cov[k] = smooth(Math.min(1, (FALLBACK_REACH - dmin) / (FALLBACK_REACH - FALLBACK_FULL)));
        any = true;
      }
    }
  }
  if (!any) return null;

  let min = Infinity, max = -Infinity;
  for (let k = 0; k < n; k++) {
    if (cov[k] <= 0 || Number.isNaN(H[k])) continue;
    if (H[k] < min) min = H[k];
    if (H[k] > max) max = H[k];
  }
  if (min === Infinity) return null;
  return { i0, k0, cols, rows, cell, H, G, cov, est, min, max, ids: grid ? grid.ids : [] };
}

function smooth(t) {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

// The mean of a 0/1 mask over a (2r+1)² box round each cell (outside counts 0).
function boxMean(mask, cols, rows, rad) {
  const tmp = new Float32Array(cols * rows), out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) { const cc = c + d; if (cc >= 0 && cc < cols) s += mask[r * cols + cc]; }
      tmp[r * cols + c] = s;
    }
  }
  const area = (2 * rad + 1) * (2 * rad + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let d = -rad; d <= rad; d++) { const rr = r + d; if (rr >= 0 && rr < rows) s += tmp[rr * cols + c]; }
      out[r * cols + c] = s / area;
    }
  }
  return out;
}

// The mask grown by `rad` cells (a square), for "near a known cell".
function dilate(mask, cols, rows, rad) {
  const m = boxMean(mask, cols, rows, rad);
  const out = new Uint8Array(cols * rows);
  for (let k = 0; k < m.length; k++) out[k] = m[k] > 0 ? 1 : 0;
  return out;
}

// ── Contours and shading ─────────────────────────────────────────────────────

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
export const MAX_CONTOURS = 10;

// The contour interval for heights spanning min…max: the smallest nice step
// giving at most MAX_CONTOURS lines; null for a span under a metre.
export function contourInterval(min, max, most = MAX_CONTOURS) {
  const span = max - min;
  if (!(span >= 1)) return null;
  for (const s of NICE) if (span / s <= most) return s;
  return NICE[NICE.length - 1] * Math.ceil(span / (most * NICE[NICE.length - 1]));
}

// Marching squares: the segments where the field crosses `level`, as
// [c1, r1, c2, r2] in fractional lattice coords. A square with any unknown
// corner (NaN, or `cov` 0 where given) has none; a saddle is split by the
// mean of its corners.
export function contourSegments(H, cols, rows, level, cov = null) {
  const out = [];
  const val = (c, r) => {
    const k = r * cols + c;
    return cov && cov[k] <= 0 ? NaN : H[k];
  };
  const cross = (va, vb) => (level - va) / (vb - va);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = val(c, r), b = val(c + 1, r), d = val(c, r + 1), e = val(c + 1, r + 1);
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(d) || Number.isNaN(e)) continue;
      const A = a >= level, B = b >= level, C = e >= level, D = d >= level;
      if (A === B && B === C && C === D) continue;
      // Edge crossings: top (a→b), right (b→e), bottom (d→e), left (a→d).
      const top = A !== B ? [c + cross(a, b), r] : null;
      const right = B !== C ? [c + 1, r + cross(b, e)] : null;
      const bottom = D !== C ? [c + cross(d, e), r + 1] : null;
      const left = A !== D ? [c, r + cross(a, d)] : null;
      const pts = [top, right, bottom, left].filter(Boolean);
      if (pts.length === 2) {
        out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
      } else if (pts.length === 4) {
        const high = (a + b + d + e) / 4 >= level;
        if (A === high) {
          // The high corners join through the middle: cut off b and d.
          out.push([...top, ...right], [...bottom, ...left]);
        } else {
          out.push([...left, ...top], [...right, ...bottom]);
        }
      }
    }
  }
  return out;
}

// Hill shading from the north-west: per cell, from -1 (in shadow) to 1
// (facing the light), 0 on the flat or unknown. Slopes are measured in metres
// per cell against `steep` (a slope of `steep` per cell reads as steep), so
// the shading follows the contours' scale.
export function hillshade(field, steep) {
  const { H, cols, rows } = field;
  const out = new Float32Array(cols * rows);
  const s = steep > 0 ? steep : 1;
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? NaN : H[r * cols + c]);
  const slope = (lo, mid, hi) => {
    const L = !Number.isNaN(lo), Hh = !Number.isNaN(hi);
    if (L && Hh) return (hi - lo) / 2;
    if (Hh) return hi - mid;
    if (L) return mid - lo;
    return 0;
  };
  // The light: from the north-west (drawn -x, -y), 45° up.
  const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = at(c, r);
      if (Number.isNaN(h)) continue;
      const gx = slope(at(c - 1, r), h, at(c + 1, r)) / s;
      const gy = slope(at(c, r - 1), h, at(c, r + 1)) / s;
      const len = Math.hypot(gx, gy, 1);
      const dot = (-gx * lx - gy * ly + lz) / len;
      out[r * cols + c] = Math.max(-1, Math.min(1, (dot - lz) * 2.2));
    }
  }
  return out;
}

// ── Painting ─────────────────────────────────────────────────────────────────

// Kept subtle: rooms, exits, labels and region patches stay primary.
export const GROUND_ALPHA = 0.26;
export const SHADE_LIGHT_ALPHA = 0.16;
export const SHADE_DARK_ALPHA = 0.3;
export const CONTOUR_ALPHA = 0.16;
export const INDEX_CONTOUR_ALPHA = 0.3;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }
  return null;
}

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

let cache = null;   // { key, canvas, info }

// Paint the relief for `view` (see reliefField) under everything else:
// ground, shading and contours, rendered once into a layer the size of the
// canvas and reused until the view or the data changes. `groundColor(id)` is
// a ground id's "#rrggbb"; `colors.label` inks the contours. Returns
// { interval, estimated, grounds: [id] } for the legend, or null when
// nothing was drawn.
export function paintRelief(ctx, view, { width, height, groundColor, colors }) {
  const ratio = (ctx.getTransform && ctx.getTransform().a) || 1;
  const grounds = view.grid ? view.grid.ids.map((id) => groundColor(id)).join(",") : "";
  const key = JSON.stringify([
    view.grid ? view.grid.rev : 0, view.roomsSig || "", view.wrapX || 0,
    view.anchor.x, view.anchor.y, view.cx, view.cy, view.scale, width, height, ratio,
    colors.label, grounds,
  ]);
  if (!cache || cache.key !== key) {
    const built = buildLayer(view, width, height, ratio, groundColor, colors.label);
    cache = { key, ...built };
  }
  if (cache.canvas) ctx.drawImage(cache.canvas, 0, 0, width, height);
  return cache.info;
}

// For tests: forget the cached layer.
export function resetReliefCache() { cache = null; }

function buildLayer(view, width, height, ratio, groundColor, ink) {
  const field = reliefField(view, width, height);
  if (!field) return { canvas: null, info: null };
  const interval = contourInterval(field.min, field.max);
  const info = {
    interval,
    estimated: field.est.some((v) => v),
    grounds: [...new Set([...field.G].filter((g) => g !== UNKNOWN_G))].map((g) => field.ids[g]).filter(Boolean),
  };
  const W = Math.max(1, Math.round(width * ratio)), Ht = Math.max(1, Math.round(height * ratio));
  const layer = makeCanvas(W, Ht);
  const small = makeCanvas(field.cols, field.rows);
  if (!layer || !small) return { canvas: null, info };
  const g = layer.getContext("2d");
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const { i0, k0, cols, rows, cell, H, G, cov, est } = field;
  const { anchor, cx, cy, scale } = view;
  const X = (c) => cx + ((i0 + c) * cell - anchor.x) * scale;
  const Y = (r) => cy + ((k0 + r) * cell - anchor.y) * scale;
  const n = cols * rows;

  // One pixel per cell, scaled up with smoothing: soft ground and shading.
  // Pixel c's centre is cell c's, so the image starts half a cell before.
  const sg = small.getContext("2d");
  const blit = (img) => {
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in g) g.imageSmoothingQuality = "high";
    g.drawImage(small, X(-0.5), Y(-0.5), cols * cell * scale, rows * cell * scale);
  };
  const palette = field.ids.map((id) => rgbOf(groundColor(id)));
  if (palette.some(Boolean)) {
    const img = sg.createImageData(cols, rows);
    for (let k = 0; k < n; k++) {
      const rgb = G[k] !== UNKNOWN_G && !est[k] ? palette[G[k]] : null;
      if (!rgb || cov[k] <= 0) continue;
      img.data[k * 4] = rgb[0]; img.data[k * 4 + 1] = rgb[1]; img.data[k * 4 + 2] = rgb[2];
      img.data[k * 4 + 3] = Math.round(255 * GROUND_ALPHA * cov[k]);
    }
    blit(img);
  }

  const shade = hillshade(field, (interval || 1) * 1.5);
  {
    const img = sg.createImageData(cols, rows);
    for (let k = 0; k < n; k++) {
      const t = shade[k];
      if (!t || cov[k] <= 0) continue;
      const v = t > 0 ? 255 : 0;
      img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = Math.round(255 * Math.abs(t) * (t > 0 ? SHADE_LIGHT_ALPHA : SHADE_DARK_ALPHA) * cov[k]);
    }
    sg.clearRect(0, 0, cols, rows);
    blit(img);
  }

  // Contours: thin, low-contrast, every fifth a little stronger; faded with
  // the known region's edge.
  if (interval) {
    const levels = [];
    for (let v = Math.ceil(field.min / interval) * interval; v <= field.max; v += interval) levels.push(v);
    const covAt = (c, r) => cov[Math.min(rows - 1, Math.round(r)) * cols + Math.min(cols - 1, Math.round(c))];
    g.lineCap = "round";
    g.strokeStyle = ink;
    for (const level of levels) {
      const major = Math.round(level / interval) % 5 === 0;
      const segs = contourSegments(H, cols, rows, level, cov);
      if (!segs.length) continue;
      g.lineWidth = major ? 1.1 : 0.75;
      // Bucketed by how faded, so each bucket is one stroke.
      const buckets = [[], [], [], []];
      for (const s of segs) {
        const f = Math.min(covAt(s[0], s[1]), covAt(s[2], s[3]));
        if (f <= 0.05) continue;
        buckets[Math.min(3, Math.floor(f * 4))].push(s);
      }
      buckets.forEach((list, b) => {
        if (!list.length) return;
        g.globalAlpha = (major ? INDEX_CONTOUR_ALPHA : CONTOUR_ALPHA) * ((b + 1) / 4);
        g.beginPath();
        for (const s of list) { g.moveTo(X(s[0]), Y(s[1])); g.lineTo(X(s[2]), Y(s[3])); }
        g.stroke();
      });
    }
    g.globalAlpha = 1;
  }
  return { canvas: layer, info };
}
