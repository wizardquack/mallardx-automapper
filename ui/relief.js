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

import { rgbOf } from "./color.js";

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

// Where each area's x comes round: Map(relief area → wrapX) from the rooms
// that carry one (identity.js `wrapX`). One pass over the rooms; mapper.js
// keeps the result and works it out again only when rooms change.
export function areaWraps(map) {
  const byArea = new Map();
  for (const id of Object.keys(map.rooms)) {
    const r = map.rooms[id];
    if (r.wrapX && !byArea.has(r.areaId)) byArea.set(r.areaId, r.wrapX);
  }
  const out = new Map();
  for (const [areaId, w] of byArea) {
    const key = reliefArea(map.areas && map.areas[areaId]);
    if (key != null) out.set(key, w);
  }
  return out;
}

// Bring an area's stored columns into its ring of `wrapX` (map units), on
// every floor: cells merged before the wrap was known (a login refill can
// come before the first room frame that carries it) sit off the ring, where
// they're never drawn. A cell landing on one already known overwrites it
// where it's known. True if anything moved.
export function rewrapRelief(map, area, wrapX) {
  const floors = map.relief && map.relief[area];
  if (!floors) return false;
  let changed = false;
  for (const z of Object.keys(floors)) {
    const grid = floors[z];
    const wc = wrapCells(wrapX, grid.cell);
    if (!wc) continue;
    let off = false;
    for (const [key, ch] of grid.chunks) {
      const ci = Number(key.split(",")[0]);
      if (ci * CHUNK >= 0 && (ci + 1) * CHUNK <= wc) continue;
      for (let at = 0; at < CHUNK * CHUNK && !off; at++) {
        const i = ci * CHUNK + (at % CHUNK);
        if ((i < 0 || i >= wc) && (ch.h[at] !== UNKNOWN_H || ch.g[at] !== UNKNOWN_G)) off = true;
      }
      if (off) break;
    }
    if (!off) continue;
    const old = grid.chunks;
    grid.chunks = new Map();
    // Cells on the ring first, so one coming round from off it overwrites.
    const passes = [[], []];
    for (const [key, ch] of old) {
      const [ci, cj] = key.split(",").map(Number);
      passes[0].push([ci, cj, ch]);
      passes[1].push([ci, cj, ch]);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const [ci, cj, ch] of passes[pass]) {
        for (let at = 0; at < CHUNK * CHUNK; at++) {
          const h = ch.h[at], g = ch.g[at];
          if (h === UNKNOWN_H && g === UNKNOWN_G) continue;
          const i = ci * CHUNK + (at % CHUNK), j = cj * CHUNK + Math.floor(at / CHUNK);
          if ((i >= 0 && i < wc) !== (pass === 0)) continue;
          const c = grid.chunkAt(wrapI(i, wc), j, true);
          if (h !== UNKNOWN_H) c.ch.h[c.at] = h;
          if (g !== UNKNOWN_G) c.ch.g[c.at] = g;
        }
      }
    }
    grid.rev = ++REV;
    changed = true;
  }
  return changed;
}

// Merge a decoded patch into the map: known cells overwrite, unknown ones
// never erase; a patch with another `cell` for that area and floor replaces
// the grid, once it has a known cell (a patch of nothing but unknowns
// changes nothing, whatever its cell). x is kept modulo the area's wrap
// (`wrapX`, map units) where it has one. True if anything changed.
export function mergePatch(map, p, wrapX = null) {
  const n = p.cols * p.rows;
  let anyKnown = false;
  for (let k = 0; k < n && !anyKnown; k++) {
    if (p.height[k] !== UNKNOWN_H || (p.ground && p.ground[k] !== UNKNOWN_G)) anyKnown = true;
  }
  if (!anyKnown) return false;
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
// Between rooms they reach further: a cell with rooms on two sides of it
// (two seen from it at least INTERP_ANGLE_FULL apart, fading to none at
// INTERP_ANGLE_NONE) is estimated where both are within INTERP_FULL,
// fading out to INTERP_REACH, so the gaps between rooms two or three units
// apart fill in, while past the rooms' outer edge (rooms on one side only)
// the estimate still ends at about FALLBACK_REACH.
// All of these are in room spacings (spacing.js): multiplied by the view's
// `spacing`, which is 1 on a grid and on land like the land they were tuned
// on, so they reach as far, in rooms, wherever the coords' units.
export const FALLBACK_REACH = 1.5;
export const FALLBACK_FULL = 0.75;
export const INTERP_REACH = 2.5;
export const INTERP_FULL = 1.9;
const INTERP_COS_FULL = -0.5;    // 120°
const INTERP_COS_NONE = 0;       // 90°
const INTERP_MOST = 10;          // nearest rooms considered for a pair
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
// map units, wrapX, anchor: { x, y }, cx, cy, scale, spacing } and the
// canvas width/height in px. Null when there's nothing to draw.
export function reliefField(view, width, height) {
  const { grid, rooms = [], wrapX = null, anchor, cx, cy, scale } = view;
  const sp = view.spacing > 0 ? view.spacing : 1;
  const cell = grid ? grid.cell : FALLBACK_CELL * sp;
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
    const near = any ? dilate(known, cols, rows, Math.ceil(FALLBACK_REACH * sp / cell)) : null;
    // Distances below are in room spacings; buckets a spacing across.
    const buckets = new Map();
    for (const rm of rooms) {
      const key = `${Math.floor(rm.x / sp)},${Math.floor(rm.y / sp)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(rm);
    }
    const reach = Math.ceil(INTERP_REACH);
    const near_ = [];   // rooms within INTERP_REACH of the cell: [d, ux, uy]
    for (let r = 0; r < rows; r++) {
      const y = (k0 + r) * cell;
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        if (known[k] || (near && near[k])) continue;
        const x = (i0 + c) * cell;
        const bx = Math.floor(x / sp), by = Math.floor(y / sp);
        let sw = 0, swe = 0, dmin = Infinity;
        near_.length = 0;
        for (let dx = -reach; dx <= reach; dx++) {
          for (let dy = -reach; dy <= reach; dy++) {
            const list = buckets.get(`${bx + dx},${by + dy}`);
            if (!list) continue;
            for (const rm of list) {
              const dr = Math.hypot(rm.x - x, rm.y - y), d = dr / sp;
              if (d > INTERP_REACH) continue;
              if (d < dmin) dmin = d;
              near_.push([d, dr > 0 ? (rm.x - x) / dr : 0, dr > 0 ? (rm.y - y) / dr : 0]);
              const w = Math.exp(-(d * d) / (FALLBACK_SIGMA * FALLBACK_SIGMA));
              sw += w; swe += w * rm.e;
            }
          }
        }
        if (dmin === Infinity || !(sw > 0)) continue;
        const f = Math.max(
          smooth(Math.min(1, (FALLBACK_REACH - dmin) / (FALLBACK_REACH - FALLBACK_FULL))),
          between(near_),
        );
        if (f <= 0 && dmin > FALLBACK_REACH) continue;
        H[k] = swe / sw;
        est[k] = 1;
        cov[k] = f;
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
  return { i0, k0, cols, rows, cell, H, G, cov, est, known, min, max, ids: grid ? grid.ids : [] };
}

// How much a cell lies between rooms (0…1): the best pair of the nearest
// rooms round it ([d, ux, uy] each: distance and unit vector from the cell),
// by how far apart they are seen from it and how near the further one is.
// One room, or rooms all to one side, give 0. Sorts `near`.
export function between(near) {
  if (near.length < 2) return 0;
  near.sort((a, b) => a[0] - b[0]);
  const n = Math.min(near.length, INTERP_MOST);
  let best = 0;
  for (let i = 0; i < n; i++) {
    const [di, xi, yi] = near[i];
    if (di === 0) return 1;
    for (let j = i + 1; j < n; j++) {
      const [dj, xj, yj] = near[j];
      // j is the further: its distance sets the fade.
      const fd = smooth((INTERP_REACH - dj) / (INTERP_REACH - INTERP_FULL));
      if (fd <= best) break;
      const cos = xi * xj + yi * yj;
      const fa = smooth((INTERP_COS_NONE - cos) / (INTERP_COS_NONE - INTERP_COS_FULL));
      const v = fd * fa;
      if (v > best) best = v;
      if (best >= 1) return 1;
    }
  }
  return best;
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

// Soften the known region's edge for the one-pixel-per-cell images: each
// cell within `rad` of a known cell takes the alpha-weighted colour of the
// known cells round it, at their mean alpha, and every cell's alpha is scaled
// by how much of that box is known (eased), so the edge comes out a soft
// curve rather than steps. A known cell keeps its own colour.
// `rgba` holds colour and alpha (0…1) per cell, set on known cells; cells
// marked `keep` (estimated ones) are copied as they are. → RGBA bytes.
export function feather(rgba, known, cols, rows, keep = null, rad = 2) {
  const out = new Uint8ClampedArray(cols * rows * 4);
  const box = (2 * rad + 1) * (2 * rad + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (keep && keep[k]) {
        out[k * 4] = rgba[k * 4]; out[k * 4 + 1] = rgba[k * 4 + 1]; out[k * 4 + 2] = rgba[k * 4 + 2];
        out[k * 4 + 3] = rgba[k * 4 + 3] * 255;
        continue;
      }
      let n = 0, sa = 0, sr = 0, sg = 0, sb = 0;
      for (let dr = -rad; dr <= rad; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -rad; dc <= rad; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const q = rr * cols + cc;
          if (!known[q]) continue;
          n++;
          const a = rgba[q * 4 + 3];
          sa += a; sr += rgba[q * 4] * a; sg += rgba[q * 4 + 1] * a; sb += rgba[q * 4 + 2] * a;
        }
      }
      if (!n) continue;
      const edge = smooth((n / box - 0.12) / 0.5);
      if (known[k]) {
        // A known cell keeps its own colour; only its alpha eases at the edge.
        out[k * 4] = rgba[k * 4]; out[k * 4 + 1] = rgba[k * 4 + 1]; out[k * 4 + 2] = rgba[k * 4 + 2];
        out[k * 4 + 3] = rgba[k * 4 + 3] * edge * 255;
      } else if (sa > 0) {
        out[k * 4] = sr / sa; out[k * 4 + 1] = sg / sa; out[k * 4 + 2] = sb / sa;
        out[k * 4 + 3] = (sa / n) * edge * 255;
      }
    }
  }
  return out;
}

// Kept subtle: rooms, exits, labels and region patches stay primary.
export const GROUND_ALPHA = 0.26;
export const SHADE_LIGHT_ALPHA = 0.16;
export const SHADE_DARK_ALPHA = 0.3;
// On a light background shadow shows more and light less.
const LIGHT_BG_DARK = 0.6, LIGHT_BG_LIGHT = 1.4;
// Contours are inked a warm sepia, like a printed map's, so they never read
// as the grey exit lines; a little stronger than the rest of the relief,
// since the halo round rooms and exits keeps them clear of the map's lines.
export const CONTOUR_INK_DARK = "#c9a06e";    // on a dark background
export const CONTOUR_INK_LIGHT = "#8a5a2b";   // on a light one
export const CONTOUR_ALPHA = 0.24;
export const INDEX_CONTOUR_ALPHA = 0.42;

// The contour ink for a background, by its brightness.
export function contourInk(lightBg) {
  return lightBg ? CONTOUR_INK_LIGHT : CONTOUR_INK_DARK;
}

// A w×h canvas to draw off screen: an OffscreenCanvas where there is one,
// else a DOM canvas; null where there's neither (tests).
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }
  return null;
}

let cache = null;   // { key, canvas, lines, info, cut, cutKey }

// Paint the relief for `view` (see reliefField) under everything else:
// ground and shading in one layer, contours in another, each rendered once
// at the canvas's size and reused until the view or the data changes.
// `groundColor(id)` is a ground id's "#rrggbb"; `colors.halo` (the
// background) picks the contour ink. `knockout` ({ key, draw(g) }, or null)
// clears the contours round rooms and along exits, so they're never taken
// for one: draw(g) paints, in CSS px, what to clear, and is called only when
// its `key` or the layers change, into a copy of the contour layer kept for
// it (ground and shading are never cleared). Returns { interval, estimated,
// measured, grounds: [id], ink } for the legend (ink: the contours' colour),
// or null when nothing was drawn.
export function paintRelief(ctx, view, { width, height, groundColor, colors, knockout = null }) {
  const ratio = (ctx.getTransform && ctx.getTransform().a) || 1;
  const grounds = view.grid ? view.grid.ids.map((id) => groundColor(id)).join(",") : "";
  const key = JSON.stringify([
    view.grid ? view.grid.rev : 0, view.roomsSig || "", view.wrapX || 0, view.spacing || 1,
    view.anchor.x, view.anchor.y, view.cx, view.cy, view.scale, width, height, ratio,
    colors.halo, grounds,
  ]);
  if (!cache || cache.key !== key) {
    const bg = rgbOf(colors.halo);
    const lightBg = !!bg && 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] > 140;
    const built = buildLayer(view, width, height, ratio, groundColor, lightBg);
    // The cut copy of the contours is kept across rebuilds while its size holds.
    const cut = cache && cache.cut && built.lines && cache.cut.width === built.lines.width
      && cache.cut.height === built.lines.height ? cache.cut : null;
    cache = { key, ...built, cut, cutKey: null };
  }
  if (cache.canvas) ctx.drawImage(cache.canvas, 0, 0, width, height);
  if (cache.lines) {
    let lines = cache.lines;
    if (knockout) {
      if (cache.cutKey !== knockout.key || !cache.cut) {
        cache.cut = cache.cut || makeCanvas(lines.width, lines.height);
        const g = cache.cut.getContext("2d");
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = "copy";
        g.globalAlpha = 1;
        g.drawImage(lines, 0, 0);
        g.globalCompositeOperation = "destination-out";
        g.setTransform(lines.width / width, 0, 0, lines.height / height, 0, 0);
        knockout.draw(g);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
        g.setTransform(1, 0, 0, 1, 0, 0);
        cache.cutKey = knockout.key;
      }
      lines = cache.cut;
    }
    ctx.drawImage(lines, 0, 0, width, height);
  }
  return cache.info;
}

// For tests: forget the cached layers.
export function resetReliefCache() { cache = null; }

function buildLayer(view, width, height, ratio, groundColor, lightBg) {
  const field = reliefField(view, width, height);
  if (!field) return { canvas: null, lines: null, info: null };
  const interval = contourInterval(field.min, field.max);
  const info = {
    interval,
    ink: contourInk(lightBg),
    estimated: field.est.some((v) => v),
    measured: field.known.some((v) => v),
    grounds: [...new Set([...field.G].filter((g) => g !== UNKNOWN_G))].map((g) => field.ids[g]).filter(Boolean),
  };
  const W = Math.max(1, Math.round(width * ratio)), Ht = Math.max(1, Math.round(height * ratio));
  const layer = makeCanvas(W, Ht);
  const small = makeCanvas(field.cols, field.rows);
  if (!layer || !small) return { canvas: null, lines: null, info };
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
  const { known } = field;
  const palette = field.ids.map((id) => rgbOf(groundColor(id)));
  const toImage = (bytes) => { const img = sg.createImageData(cols, rows); img.data.set(bytes); return img; };
  if (palette.some(Boolean)) {
    const rgba = new Float32Array(n * 4);
    const has = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const rgb = known[k] && G[k] !== UNKNOWN_G ? palette[G[k]] : null;
      if (!rgb) continue;
      has[k] = 1;
      rgba[k * 4] = rgb[0]; rgba[k * 4 + 1] = rgb[1]; rgba[k * 4 + 2] = rgb[2]; rgba[k * 4 + 3] = GROUND_ALPHA;
    }
    blit(toImage(feather(rgba, has, cols, rows)));
  }

  const shade = hillshade(field, (interval || 1) * 0.6);
  {
    const rgba = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const t = shade[k];
      if (!(known[k] || est[k])) continue;
      const v = t > 0 ? 255 : 0;
      rgba[k * 4] = v; rgba[k * 4 + 1] = v; rgba[k * 4 + 2] = v;
      const alpha = t > 0 ? SHADE_LIGHT_ALPHA * (lightBg ? LIGHT_BG_LIGHT : 1) : SHADE_DARK_ALPHA * (lightBg ? LIGHT_BG_DARK : 1);
      rgba[k * 4 + 3] = Math.abs(t) * alpha * (est[k] ? cov[k] : 1);
    }
    blit(toImage(feather(rgba, known, cols, rows, est)));
  }

  // Contours, in their own layer (so the halo round rooms and exits can be
  // cut from them alone): thin, sepia, every fifth a little stronger; faded
  // with the known region's edge.
  let lines = null;
  if (interval) {
    lines = makeCanvas(W, Ht);
    const g = lines.getContext("2d");
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ink = contourInk(lightBg);
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
  return { canvas: layer, lines, info };
}

// ── Deleting areas ───────────────────────────────────────────────────────────

// The ids of areas that have a room.
export function areasWithRooms(map) {
  const out = new Set();
  for (const id of Object.keys(map.rooms)) out.add(map.rooms[id].areaId);
  return out;
}

// After the user deletes rooms: forget the grids of each area that had rooms
// (`had`, from areasWithRooms before) and now has none. An area the map knows
// only by its relief, sent before you've been there, is left alone. Returns
// what was cleared, { [area]: floors }, for the edit's undo (swapRelief), or
// null if nothing was.
export function clearEmptiedRelief(map, had) {
  const now = areasWithRooms(map);
  const areas = [];
  for (const id of had) {
    if (now.has(id)) continue;
    const key = reliefArea(map.areas && map.areas[id]);
    if (key && map.relief && map.relief[key]) areas.push(key);
  }
  return areas.length ? swapRelief(map, { clear: areas }).put : null;
}

// Undo and redo for an edit that cleared relief: `change` is { put: {
// [area]: floors } to put back, clear: [area] to forget }. Returns the
// change that reverses it, in the same form.
export function swapRelief(map, change) {
  const back = { put: {}, clear: [] };
  for (const area of change.clear || []) {
    if (!map.relief || !map.relief[area]) continue;
    back.put[area] = map.relief[area];
    delete map.relief[area];
  }
  for (const area of Object.keys(change.put || {})) {
    map.relief = map.relief || {};
    map.relief[area] = change.put[area];
    back.clear.push(area);
  }
  return back;
}
