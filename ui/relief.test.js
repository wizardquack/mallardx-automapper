import { describe, it, expect } from "vitest";
import {
  decodePatch, mergePatch, clearRelief, reliefArea, ReliefGrid, reliefFromJSON,
  b64FromBytes, bytesFromB64, wrapCells, wrapI, contourInterval, contourSegments,
  reliefField, hillshade, UNKNOWN_H, UNKNOWN_G, CHUNK, FALLBACK_REACH,
} from "./relief.js";
import { createMap, toJSON, fromJSON } from "./graph.js";

// base64 of little-endian int16 values.
function h16(values) {
  const b = new Uint8Array(values.length * 2);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => dv.setInt16(i * 2, v, true));
  return b64FromBytes(b);
}

const patch = (over = {}) => ({ area: "a", z: 0, cell: 0.5, x: 0, y: 0, cols: 2, rows: 2, height: [1, 2, 3, 4], ...over });

describe("decodePatch", () => {
  it("decodes base64 heights, little-endian, with -32768 unknown", () => {
    const p = decodePatch(patch({ height: h16([100, -5, -32768, 32767]) }));
    expect([...p.height]).toEqual([100, -5, UNKNOWN_H, 32767]);
  });

  it("decodes array heights with null unknown", () => {
    const p = decodePatch(patch({ height: [1, null, -32768, 4] }));
    expect([...p.height]).toEqual([1, UNKNOWN_H, UNKNOWN_H, 4]);
  });

  it("places the north-west cell by x, y over cell (within rounding)", () => {
    const p = decodePatch(patch({ x: 4.0000001, y: -6.5, cell: 0.5 }));
    expect(p.i0).toBe(8);
    expect(p.j0).toBe(-13);
  });

  it("decodes ground in both forms, 255 and null unknown, out-of-list indices unknown", () => {
    const b = decodePatch(patch({ ground: { ids: ["dust", "sea"], data: b64FromBytes(new Uint8Array([0, 1, 255, 7])) } }));
    expect([...b.ground]).toEqual([0, 1, UNKNOWN_G, UNKNOWN_G]);
    expect(b.ids).toEqual(["dust", "sea"]);
    const a = decodePatch(patch({ ground: { ids: ["dust", "sea"], data: [1, null, 255, 0] } }));
    expect([...a.ground]).toEqual([1, UNKNOWN_G, UNKNOWN_G, 0]);
  });

  it("drops a malformed ground but keeps the heights", () => {
    const p = decodePatch(patch({ ground: { ids: ["x"], data: [0] } }));
    expect(p.ground).toBe(null);
    expect([...p.height]).toEqual([1, 2, 3, 4]);
  });

  it("rejects bad shapes and sizes", () => {
    expect(decodePatch(patch({ height: [1, 2, 3] }))).toBe(null);
    expect(decodePatch(patch({ height: h16([1, 2, 3]) }))).toBe(null);
    expect(decodePatch(patch({ height: "not base64!" }))).toBe(null);
    expect(decodePatch(patch({ cell: 0 }))).toBe(null);
    expect(decodePatch(patch({ cols: 65, rows: 1, height: new Array(65).fill(0) }))).toBe(null);
    expect(decodePatch(patch({ z: 0.5 }))).toBe(null);
    expect(decodePatch(patch({ area: "" }))).toBe(null);
    expect(decodePatch(patch({ x: NaN }))).toBe(null);
    expect(decodePatch(patch({ cols: 64, rows: 64, height: new Array(4096).fill(0) }))).not.toBe(null);
  });

  it("defaults z to 0", () => {
    expect(decodePatch(patch({ z: undefined })).z).toBe(0);
  });
});

describe("mergePatch", () => {
  it("lays rows south and columns east from the north-west cell", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 1, y: 1 })));   // i0 = 2, j0 = 2
    const g = m.relief.a[0];
    expect(g.height(2, 2)).toBe(1);
    expect(g.height(3, 2)).toBe(2);
    expect(g.height(2, 1)).toBe(3);
    expect(g.height(3, 1)).toBe(4);
    expect(g.height(4, 2)).toBe(UNKNOWN_H);
  });

  it("overwrites known cells and never erases with unknown ones", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    expect(mergePatch(m, decodePatch(patch({ height: [null, 20, null, null] })))).toBe(true);
    const g = m.relief.a[0];
    expect([g.height(0, 0), g.height(1, 0), g.height(0, -1), g.height(1, -1)]).toEqual([1, 20, 3, 4]);
    expect(mergePatch(m, decodePatch(patch({ height: [null, 20, null, null] })))).toBe(false);
  });

  it("keeps ground per cell through a per-grid palette; unknown ground never erases", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ ground: { ids: ["dust", "sea"], data: [0, 1, 1, 0] } })));
    mergePatch(m, decodePatch(patch({ height: [null, null, null, null], ground: { ids: ["stones"], data: [0, null, null, null] } })));
    const g = m.relief.a[0];
    expect(g.ids[g.ground(0, 0)]).toBe("stones");
    expect(g.ids[g.ground(1, 0)]).toBe("sea");
    expect(g.ids[g.ground(1, -1)]).toBe("dust");
  });

  it("replaces the grid when the cell size changes", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 10, y: 10 })));
    mergePatch(m, decodePatch(patch({ cell: 1, height: [9, 9, 9, 9] })));
    const g = m.relief.a[0];
    expect(g.cell).toBe(1);
    expect(g.height(20, 20)).toBe(UNKNOWN_H);
    expect(g.height(0, 0)).toBe(9);
  });

  it("keeps floors and areas apart", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    mergePatch(m, decodePatch(patch({ z: 1, height: [5, 5, 5, 5] })));
    mergePatch(m, decodePatch(patch({ area: "b", height: [7, 7, 7, 7] })));
    expect(m.relief.a[0].height(0, 0)).toBe(1);
    expect(m.relief.a[1].height(0, 0)).toBe(5);
    expect(m.relief.b[0].height(0, 0)).toBe(7);
  });

  it("leaves no grid for a patch of nothing known", () => {
    const m = createMap();
    expect(mergePatch(m, decodePatch(patch({ height: [null, null, null, null] })))).toBe(false);
    expect(m.relief.a).toBeUndefined();
  });

  it("spans chunk boundaries, negative cells included", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: (CHUNK - 1) * 0.5, y: 0 })));
    mergePatch(m, decodePatch(patch({ x: -0.5, y: 0.5, height: [11, 12, 13, 14] })));
    const g = m.relief.a[0];
    expect(g.height(CHUNK - 1, 0)).toBe(1);
    expect(g.height(CHUNK, 0)).toBe(2);
    expect(g.height(-1, 1)).toBe(11);
    expect(g.height(0, 0)).toBe(14);
  });

  it("clears an area's grids", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    expect(clearRelief(m, "a")).toBe(true);
    expect(m.relief.a).toBeUndefined();
    expect(clearRelief(m, "a")).toBe(false);
  });

  it("names the relief area of a zone area only", () => {
    expect(reliefArea({ key: "zone:surface.tamsin" })).toBe("surface.tamsin");
    expect(reliefArea({ key: "__overworld__" })).toBe(null);
    expect(reliefArea(null)).toBe(null);
  });
});

describe("wrap", () => {
  it("counts the ring in cells and brings columns into it", () => {
    expect(wrapCells(24, 0.5)).toBe(48);
    expect(wrapCells(null, 0.5)).toBe(0);
    expect(wrapI(-1, 48)).toBe(47);
    expect(wrapI(49, 48)).toBe(1);
    expect(wrapI(-1, 0)).toBe(-1);
  });

  it("stores x modulo the wrap on merge", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 12.5, y: 0 })), 12);   // i0 = 25 on a ring of 24
    expect(m.relief.a[0].height(1, 0)).toBe(1);
    expect(m.relief.a[0].height(25, 0)).toBe(UNKNOWN_H);
  });

  it("draws a ring's cells at the turn nearest the anchor", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 0, y: 0, cols: 1, rows: 1, height: [50] })), 12);
    // The anchor at x 11.5 on a ring of 12: cell 0 is drawn at x 12, beside it.
    const view = { grid: m.relief.a[0], wrapX: 12, anchor: { x: 11.5, y: 0 }, cx: 50, cy: 50, scale: 20 };
    const f = reliefField(view, 100, 100);
    const c = 24 - f.i0, r = 0 - f.k0;
    expect(f.H[r * f.cols + c]).toBe(50);
    expect(Number.isNaN(f.H[r * f.cols + (0 - f.i0)] ?? NaN)).toBe(true);
  });
});

describe("storage", () => {
  it("round-trips through save and load", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: -3, y: 7, ground: { ids: ["dust", "sea"], data: [0, 1, 255, 1] } })));
    mergePatch(m, decodePatch(patch({ area: "b", z: -2, cell: 2, height: h16([-400, 32767, -32768, 0]) })));
    const back = fromJSON(toJSON(m));
    const g = back.relief.a[0];
    expect(g).toBeInstanceOf(ReliefGrid);
    expect(g.cell).toBe(0.5);
    expect([g.height(-6, 14), g.height(-5, 14), g.height(-6, 13), g.height(-5, 13)]).toEqual([1, 2, 3, 4]);
    expect(g.ids[g.ground(-5, 14)]).toBe("sea");
    expect(g.ground(-6, 13)).toBe(UNKNOWN_G);
    const b = back.relief.b[-2];
    expect([b.height(0, 0), b.height(1, 0), b.height(0, -1)]).toEqual([-400, 32767, UNKNOWN_H]);
  });

  it("saves chunks as base64, ground only where some is known", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    const saved = JSON.parse(toJSON(m)).relief.a[0];
    const chunk = Object.values(saved.chunks)[0];
    expect(typeof chunk.h).toBe("string");
    expect(bytesFromB64(chunk.h).length).toBe(CHUNK * CHUNK * 2);
    expect(chunk.g).toBeUndefined();
  });

  it("leaves relief out of an undo snapshot when asked", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    expect(JSON.parse(toJSON(m, { relief: false })).relief).toBeUndefined();
    expect(fromJSON(toJSON(m, { relief: false })).relief).toEqual({});
  });

  it("loads a map saved before relief, and skips malformed chunks", () => {
    const old = JSON.parse(toJSON(createMap()));
    delete old.relief;
    expect(fromJSON(JSON.stringify(old)).relief).toEqual({});
    const bad = reliefFromJSON({ a: { 0: { cell: 0.5, ids: [], chunks: { "0,0": { h: "AAAA" }, "x": { h: "" } } } } });
    expect(bad).toEqual({});
  });

  it("keeps a few hundred patches along a walk reasonably small", () => {
    // 300 places along a winding walk, a 11×11 patch (2.5 km at 0.5 km) at each.
    const m = createMap();
    let x = 0, y = 0, seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 300; n++) {
      x += Math.round((rnd() - 0.4) * 3); y += Math.round((rnd() - 0.45) * 3);
      const heights = Array.from({ length: 121 }, () => Math.round(rnd() * 800));
      const ground = Array.from({ length: 121 }, () => Math.floor(rnd() * 4));
      mergePatch(m, decodePatch({ area: "w", cell: 0.5, x: x - 2.5, y: y + 2.5, cols: 11, rows: 11, height: heights, ground: { ids: ["dust", "stones", "sea", "ice"], data: ground } }));
    }
    const bytes = JSON.stringify(m.relief).length;
    expect(bytes).toBeLessThan(120_000);   // ~58 KB with 32-cell chunks
  });
});

describe("contours", () => {
  it("picks a nice interval from the span in view", () => {
    expect(contourInterval(0, 0.5)).toBe(null);
    expect(contourInterval(0, 8)).toBe(1);
    expect(contourInterval(0, 40)).toBe(5);
    expect(contourInterval(100, 180)).toBe(10);
    expect(contourInterval(0, 220)).toBe(25);
    expect(contourInterval(0, 900)).toBe(100);
    expect(contourInterval(-400, 4000)).toBe(500);
  });

  it("marches a tiny grid: a single crossing", () => {
    // 0 0
    // 0 10   level 5 cuts the bottom-right corner off.
    const segs = contourSegments(new Float32Array([0, 0, 0, 10]), 2, 2, 5);
    expect(segs).toEqual([[1, 0.5, 0.5, 1]]);
  });

  it("marches a peak into a closed ring of segments", () => {
    const H = new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 0]);
    const segs = contourSegments(H, 3, 3, 5);
    expect(segs.length).toBe(4);
    // Every endpoint is shared by two segments: the ring closes.
    const ends = new Map();
    for (const s of segs) for (const p of [`${s[0]},${s[1]}`, `${s[2]},${s[3]}`]) ends.set(p, (ends.get(p) || 0) + 1);
    expect([...ends.values()].every((n) => n === 2)).toBe(true);
  });

  it("splits a saddle by the mean of its corners", () => {
    // 10 0 / 0 10: mean 5 ≥ 5, so the high corners join and b, d are cut off.
    const segs = contourSegments(new Float32Array([10, 0, 0, 10]), 2, 2, 5);
    expect(segs).toEqual([[0.5, 0, 1, 0.5], [0.5, 1, 0, 0.5]]);
    const low = contourSegments(new Float32Array([10, 0, 0, 10]), 2, 2, 6);
    expect(low).toEqual([[0, 0.4, 0.4, 0], [1, 0.6, 0.6, 1]]);
  });

  it("skips squares with an unknown corner", () => {
    expect(contourSegments(new Float32Array([0, 0, NaN, 10]), 2, 2, 5)).toEqual([]);
  });
});

describe("reliefField", () => {
  const view = (over) => ({ grid: null, rooms: [], anchor: { x: 0, y: 0 }, cx: 100, cy: 100, scale: 20, ...over });

  it("reads the grid in view, north up (drawn k = -j)", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 0, y: 1, cols: 1, rows: 1, height: [42], ground: { ids: ["sea"], data: [0] } })));
    const f = reliefField(view({ grid: m.relief.a[0] }), 200, 200);
    const k = (-2 - f.k0) * f.cols + (0 - f.i0);   // j = 2 → drawn above (k = -2)
    expect(f.H[k]).toBe(42);
    expect(f.ids[f.G[k]]).toBe("sea");
    expect(f.cov[k]).toBeGreaterThan(0);
    expect(f.min).toBe(42);
  });

  it("estimates from rooms only near them, fading out, with no ground", () => {
    const rooms = [{ x: 0, y: 0, e: 100 }, { x: 1, y: 0, e: 200 }];
    const f = reliefField(view({ rooms }), 200, 200);
    expect(f.cell).toBe(0.25);
    let near = 0;
    for (let r = 0; r < f.rows; r++) {
      for (let c = 0; c < f.cols; c++) {
        const k = r * f.cols + c;
        const x = (f.i0 + c) * f.cell, y = (f.k0 + r) * f.cell;
        const d = Math.min(Math.hypot(x, y), Math.hypot(x - 1, y));
        if (d > FALLBACK_REACH + 1e-9) expect(Number.isNaN(f.H[k])).toBe(true);
        else { near++; expect(f.est[k]).toBe(1); expect(f.G[k]).toBe(UNKNOWN_G); }
        if (d < 0.5) expect(f.cov[k]).toBe(1);
      }
    }
    expect(near).toBeGreaterThan(0);
    // Between the two rooms the height lies between theirs.
    const mid = (0 - f.k0) * f.cols + (2 - f.i0);
    expect(f.H[mid]).toBeGreaterThan(100);
    expect(f.H[mid]).toBeLessThan(200);
  });

  it("doesn't estimate near cells the grid knows", () => {
    const m = createMap();
    mergePatch(m, decodePatch(patch({ x: 0, y: 0, cols: 1, rows: 1, height: [10] })));
    const rooms = [{ x: 0, y: 0, e: 500 }, { x: 5, y: 0, e: 500 }];
    const f = reliefField(view({ grid: m.relief.a[0], rooms, scale: 10 }), 200, 200);
    const at = (x) => (0 - f.k0) * f.cols + (Math.round(x / f.cell) - f.i0);
    expect(f.H[at(0)]).toBe(10);
    expect(f.est[at(1)]).toBe(0);
    expect(Number.isNaN(f.H[at(1)])).toBe(true);
    expect(f.est[at(5)]).toBe(1);
  });

  it("is null with nothing to draw, or far too many cells", () => {
    expect(reliefField(view({}), 200, 200)).toBe(null);
    const m = createMap();
    mergePatch(m, decodePatch(patch()));
    expect(reliefField(view({ grid: m.relief.a[0], scale: 0.1 }), 2000, 2000)).toBe(null);
  });
});

describe("hillshade", () => {
  it("lights slopes facing north-west and shades those facing south-east", () => {
    // Height rises to the east: the slope faces west, half toward the light.
    const H = new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);
    const s = hillshade({ H, cols: 3, rows: 3 }, 10);
    expect(s[4]).toBeGreaterThan(0);
    const down = hillshade({ H: new Float32Array([20, 10, 0, 20, 10, 0, 20, 10, 0]), cols: 3, rows: 3 }, 10);
    expect(down[4]).toBeLessThan(0);
    expect(hillshade({ H: new Float32Array(9).fill(5), cols: 3, rows: 3 }, 10)[4]).toBe(0);
  });
});
