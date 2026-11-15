import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent } from "./graph.js";
import { areaSpacings, areaSpacing, spacingOf, LAND_SPACING } from "./spacing.js";

// A row of rooms `step` apart going east, plus one north of the first.
function row(m, step, n = 4, areaId) {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(addRoom(m, { key: `${areaId || "r"}${i}`, coords: { x: i * step, y: 0, z: 0 }, areaId }));
  for (let i = 0; i + 1 < n; i++) linkExit(m, rs[i].id, "e", rs[i + 1].id);
  return rs;
}

describe("spacingOf", () => {
  it("is the median (over LAND_SPACING off a lattice), 1 for too few, whole on a lattice, clamped", () => {
    expect(spacingOf([1, 2, 9], true)).toBe(2);
    expect(spacingOf([1, 2, 3, 10], true)).toBe(3);
    expect(spacingOf([1, 2, 3, 10])).toBeCloseTo(2.5 / LAND_SPACING);
    expect(spacingOf([40, 40])).toBe(1);
    expect(spacingOf([1, 1.2, 1.3], true)).toBe(1);
    expect(spacingOf([1e-9, 1e-9, 1e-9])).toBe(0.01);
    expect(spacingOf([1e9, 1e9, 1e9])).toBe(10000);
  });
});

describe("areaSpacings", () => {
  it("is 1 on a grid, diagonals and a long exit included", () => {
    const m = createMap();
    const rs = row(m, 1, 4);
    const d = addRoom(m, { key: "d", coords: { x: 1, y: -1, z: 0 } });
    linkExit(m, rs[0].id, "ne", d.id);
    const far = addRoom(m, { key: "far", coords: { x: 3, y: 3, z: 0 } });
    linkExit(m, rs[3].id, "s", far.id);
    expect(areaSpacing(m, rs[0].areaId)).toEqual({ spacing: 1, lattice: true });
  });

  it("follows the coords' units: rooms 40 apart are 40", () => {
    const m = createMap();
    const rs = row(m, 40, 5);
    expect(areaSpacing(m, rs[0].areaId)).toEqual({ spacing: 40, lattice: true });
  });

  it("off a lattice, is 1 for land as sparse as LAND_SPACING, and scales with it", () => {
    const m = createMap();
    const rs = row(m, LAND_SPACING, 4, "a");
    rs[0].coords.y = 0.01;   // off the whole numbers
    const s = areaSpacing(m, rs[0].areaId);
    expect(s.lattice).toBe(false);
    expect(s.spacing).toBeCloseTo(1);
    for (const r of rs) { r.coords.x *= 40; r.coords.y *= 40; }
    expect(areaSpacing(m, rs[0].areaId).spacing).toBeCloseTo(40);
  });

  it("is 1 with too few exits, and ignores other floors and areas", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 50, y: 0, z: 0 } });
    linkExit(m, a.id, "e", b.id);
    expect(areaSpacing(m, a.areaId).spacing).toBe(1);
  });

  it("goes the short way round a ring", () => {
    const m = createMap();
    const rs = [0, 1, 2, 3].map((i) => addRoom(m, { key: `w${i}`, coords: { x: i * 6, y: 0, z: 0 } }));
    for (const r of rs) r.wrapX = 24;
    for (let i = 0; i < 4; i++) linkExit(m, rs[i].id, "e", rs[(i + 1) % 4].id);
    expect(areaSpacings(m).get(rs[0].areaId).spacing).toBe(6);
  });
});

// The same area drawn at scale s, and ×40 at s / 40, lands on the same
// pixels: what's drawn about rooms (patches, closing, the relief estimate)
// should too.
import { computeLayout } from "./render.js";
import { reliefField } from "./relief.js";

function land(k, { lattice = false } = {}) {
  const m = createMap();
  const pts = lattice
    ? [[0, 0], [1, 0], [2, 0], [2, 1], [0, 2], [1, 2], [5, 5]]
    : [[0, 0], [1.3, 0.4], [2.9, 0.2], [3.5, 1.7], [0.6, 2.1], [2.2, 2.6], [7.4, 6.1]];
  const rs = pts.map(([x, y], i) => {
    const r = addRoom(m, { key: `p${i}`, coords: { x: x * k, y: y * k, z: 0 } });
    r.region = i < 6 ? "moor" : "fells";
    r.elevation = 100 + 40 * i;
    return r;
  });
  linkExit(m, rs[0].id, "e", rs[1].id);
  linkExit(m, rs[1].id, "e", rs[2].id);
  linkExit(m, rs[2].id, "se", rs[3].id);
  linkExit(m, rs[0].id, "s", rs[4].id);
  linkExit(m, rs[4].id, "e", rs[5].id);
  setCurrent(m, rs[0].id);
  return m;
}

describe("drawing scales with the room spacing", () => {
  for (const lattice of [false, true]) {
    it(`${lattice ? "a lattice" : "off-grid land"} ×40 lays out as it does at ×1`, () => {
      const a = computeLayout(land(1, { lattice }), { cx: 300, cy: 300, scale: 40 });
      const b = computeLayout(land(40, { lattice }), { cx: 300, cy: 300, scale: 1 });
      expect(b.spacing).toBeCloseTo(a.spacing * 40);
      const round = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "number" ? Math.round(x * 1e6) / 1e6 : x)));
      const shape = (L) => round(L.patches.map((p) => ({ shape: p.shape, size: p.size, band: p.band, cell: p.cell, nodes: p.nodes, bands: p.bands })));
      expect(shape(b)).toEqual(shape(a));
      expect(b.patches[0].shape).toBe(lattice ? "square" : "round");
      expect(round(b.regions)).toEqual(round(a.regions));
      const fa = reliefField(a.relief, 600, 600), fb = reliefField(b.relief, 600, 600);
      expect([fb.cols, fb.rows]).toEqual([fa.cols, fa.rows]);
      expect(Array.from(fb.cov).map((v) => +v.toFixed(4))).toEqual(Array.from(fa.cov).map((v) => +v.toFixed(4)));
      expect(Array.from(fb.H).map((v) => +v.toFixed(2))).toEqual(Array.from(fa.H).map((v) => +v.toFixed(2)));
    });
  }
});
