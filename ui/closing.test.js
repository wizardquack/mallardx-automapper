import { describe, it, expect } from "vitest";
import { CLOSE_RADIUS, distanceToOutside, closedAlpha, closeBox, closeStep, closedReach } from "./closing.js";

// A round patch as regionLayout makes it, at `cell` px per unit, from rooms
// at unit coords and exits between them (index pairs).
function patch(pts, links, cell = 20) {
  const nodes = pts.map(([x, y]) => ({ px: x * cell, py: y * cell }));
  const bands = links.map(([i, j]) => ({ x1: nodes[i].px, y1: nodes[i].py, x2: nodes[j].px, y2: nodes[j].py }));
  return { nodes, bands, size: 0.6 * cell, band: 0.5 * cell, cell };
}
function close(p, ds = 1) {
  const r = CLOSE_RADIUS * p.cell;
  const b = closeBox(p, r, 1000, 1000);
  const box = { x0: b.x0, y0: b.y0, w: Math.ceil((b.x1 - b.x0) / ds), h: Math.ceil((b.y1 - b.y0) / ds) };
  const a = closedAlpha(p, box, ds, r);
  return (x, y) => {
    const i = Math.floor((x - box.x0) / ds), j = Math.floor((y - box.y0) / ds);
    return i < 0 || j < 0 || i >= box.w || j >= box.h ? 0 : a[j * box.w + i];
  };
}
// Is (x, y) px inside the patch as drawn without closing?
function inShape(p, x, y) {
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  return p.nodes.some((n) => Math.hypot(x - n.px, y - n.py) <= p.size)
    || p.bands.some((b) => seg(b.x1, b.y1, b.x2, b.y2) <= p.band);
}

describe("distanceToOutside", () => {
  it("is the Euclidean distance to the nearest 0 pixel", () => {
    const w = 9, h = 9, mask = new Uint8Array(w * h).fill(1);
    mask[4 * w + 4] = 0;
    const D = distanceToOutside(mask, w, h);
    expect(D[4 * w + 4]).toBe(0);
    expect(D[4 * w + 7]).toBeCloseTo(3);
    expect(D[0]).toBeCloseTo(Math.hypot(4, 4));
  });
  it("is Infinity with no outside, the mask's edge not counting", () => {
    const D = distanceToOutside(new Uint8Array(16).fill(1), 4, 4);
    expect(D.every((d) => d === Infinity)).toBe(true);
  });
});

describe("closedAlpha", () => {
  it("fills a hole ringed by exits", () => {
    // A ring of six rooms 1.4 apart round empty ground ~2.4 across.
    const pts = [...Array(6)].map((_, i) => [5 + 1.4 * Math.cos(i * Math.PI / 3), 5 + 1.4 * Math.sin(i * Math.PI / 3)]);
    const p = patch(pts, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]);
    expect(inShape(p, 100, 100)).toBe(false);   // a hole as drawn before
    expect(close(p)(100, 100)).toBe(255);
  });

  it("doesn't fill an outer bay wider than the closing", () => {
    // A U: two arms 4 apart, open at the top; the bay's middle stays open.
    const pts = [[2, 2], [2, 4], [2, 6], [4, 6], [6, 6], [6, 4], [6, 2]];
    const p = patch(pts, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]);
    const at = close(p);
    expect(at(80, 60)).toBe(0);    // (4, 3): between the arms, 2 from each
    expect(at(40, 80)).toBe(255);  // on an arm
  });

  it("keeps the outline: nothing grows past the patch away from its gaps", () => {
    const p = patch([[3, 3], [4.3, 3.6]], [[0, 1]]);
    const at = close(p);
    for (let y = 0; y < 200; y += 3) {
      for (let x = 0; x < 200; x += 3) {
        // Away from the shape by more than a pixel or two, nothing's added.
        if (!inShape(p, x, y) && !inShape({ ...p, size: p.size + 2, band: p.band + 2 }, x, y)) expect(at(x, y)).toBe(0);
      }
    }
  });

  it("works the same at a coarser step", () => {
    const pts = [...Array(6)].map((_, i) => [5 + 1.4 * Math.cos(i * Math.PI / 3), 5 + 1.4 * Math.sin(i * Math.PI / 3)]);
    const p = patch(pts, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], 40);
    expect(close(p, 2.5)(200, 200)).toBe(255);
  });
});

describe("closing's box, step and reach", () => {
  it("bounds the box to 2r past the view, and null out of it", () => {
    const p = patch([[-50, -50], [100, 100]], [[0, 1]]);
    const r = CLOSE_RADIUS * p.cell;
    expect(closeBox(p, r, 400, 300)).toEqual({ x0: -44, y0: -44, x1: 444, y1: 344 });
    expect(closeBox(patch([[-50, -50]], []), r, 400, 300)).toBe(null);
  });
  it("steps between 1 and 2.5 px, coarser for a huge box", () => {
    expect(closeStep(8, 100, 100)).toBe(1);
    expect(closeStep(160, 100, 100)).toBe(2.5);
    expect(closeStep(20, 4000, 4000)).toBeGreaterThan(2.5);
  });
  it("joins two discs where their grown neck is still r wide", () => {
    const d = closedReach(0.6, CLOSE_RADIUS);
    expect(d).toBeCloseTo(2 * Math.sqrt(0.36 + 1.32));
    // Just inside it, the midpoint is filled; well past it, not.
    const near = patch([[3, 3], [3 + d - 0.1, 3]], []);
    expect(close(near)(Math.round((3 + (d - 0.1) / 2) * 20), 60)).toBeGreaterThan(0);
    const far = patch([[3, 3], [3 + d + 0.3, 3]], []);
    expect(close(far)(Math.round((3 + (d + 0.3) / 2) * 20), 60)).toBe(0);
  });
});
