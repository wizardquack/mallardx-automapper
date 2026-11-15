import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, addArea } from "./graph.js";
import { exitStroke, climbTicks } from "./render.js";
import { shadeColor, inkOn, regionColor } from "./annotate.js";
import { setTagDefs } from "./graph.js";
import { knockoutShapes, HALO_ROOM } from "./render.js";
import { bandQuad, computeLayout, envColor, draw, fitText, glyphOrigin, roomsInRect, exitPort, clearOf, exitGeometry, oneWayArrow, cardAt, NAME_LABEL_MIN_SCALE } from "./render.js";
import { setTerrains } from "./graph.js";
import { addLink } from "./links.js";

function sampleMap() {
  const m = createMap();
  const a = addRoom(m, { key: "A", name: "A", env: "city", coords: { x: 0, y: 0, z: 0 } });
  const b = addRoom(m, { key: "B", name: "B", env: "city", coords: { x: 0, y: -1, z: 0 } });
  const up = addRoom(m, { key: "U", name: "U", env: "city", coords: { x: 0, y: 0, z: 1 } });
  linkExit(m, a.id, "n", b.id);
  setCurrent(m, a.id);
  return { m, a, b, up };
}

describe("computeLayout", () => {
  it("centers the current room and offsets others by scale", () => {
    const { m, a, b } = sampleMap();
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40 });
    const ra = layout.rooms.find((r) => r.id === a.id);
    const rb = layout.rooms.find((r) => r.id === b.id);
    expect(ra).toMatchObject({ px: 100, py: 100, isCurrent: true });
    // b is north of a (y = -1) → one scale-unit up on screen
    expect(rb).toMatchObject({ px: 100, py: 60, isCurrent: false });
  });

  it("only includes rooms on the current z-level", () => {
    const { m, up } = sampleMap();
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40 });
    expect(layout.rooms.find((r) => r.id === up.id)).toBeUndefined();
  });

  it("emits an exit segment between linked same-level rooms", () => {
    const { m } = sampleMap();
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40 });
    expect(layout.exits).toContainEqual({ x1: 100, y1: 100, x2: 100, y2: 60, dir1: "n", dir2: null, onPath: false, oneWay: true });
  });

  it("draws no segment for an in/out exit (routable, not drawn)", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "B", name: "B", coords: { x: 3, y: 0, z: 0 } });
    linkExit(m, a.id, "in", b.id);
    linkExit(m, b.id, "out", a.id);
    setCurrent(m, a.id);
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(layout.rooms.length).toBe(2);
    expect(layout.exits).toEqual([]);
  });

  it("returns empty layout with no current room", () => {
    const m = createMap();
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 })).toEqual({ rooms: [], exits: [], stubs: [], patches: [], regions: [], elevation: null, scale: 40 });
  });

  it("envColor is deterministic and non-empty", () => {
    expect(envColor("city")).toBe(envColor("city"));
    expect(envColor("city")).not.toBe(envColor("forest"));
    expect(envColor("")).toMatch(/^#/);
  });

  it("envColor handles numeric env (Discworld terrain codes)", () => {
    // Discworld sends terrain as a number; envColor must produce a deterministic
    // non-grey color, not the broken monochrome #505050 from when env.length was undefined.
    expect(envColor(1)).toBe(envColor(1));
    expect(envColor(1)).not.toBe(envColor(2));
    expect(envColor(1).startsWith("#")).toBe(true);
    expect(envColor(1)).not.toBe("#505050");
    expect(envColor(1)).not.toBe("#888888");
  });

  it("excludes rooms in other areas even at the same z", () => {
    const m = createMap();
    const a1 = addArea(m, { key: "k1", label: "A1" });
    const a2 = addArea(m, { key: "k2", label: "A2" });
    const here = addRoom(m, { key: "H", name: "H", areaId: a1.id, coords: { x: 0, y: 0, z: 0 } });
    const near = addRoom(m, { key: "N", name: "N", areaId: a1.id, coords: { x: 1, y: 0, z: 0 } });
    const other = addRoom(m, { key: "O", name: "O", areaId: a2.id, coords: { x: 0, y: 0, z: 0 } });
    setCurrent(m, here.id);
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40 });
    const ids = layout.rooms.map((r) => r.id);
    expect(ids).toContain(here.id);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(other.id);
  });

  it("does not emit a cross-area exit segment", () => {
    const m = createMap();
    const a1 = addArea(m, { key: "k1", label: "A1" });
    const a2 = addArea(m, { key: "k2", label: "A2" });
    const here = addRoom(m, { key: "H", name: "H", areaId: a1.id, coords: { x: 0, y: 0, z: 0 } });
    const across = addRoom(m, { key: "X", name: "X", areaId: a2.id, coords: { x: 0, y: 0, z: 0 } });
    linkExit(m, here.id, "n", across.id);
    setCurrent(m, here.id);
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40 });
    expect(layout.exits).toEqual([]);
  });

  it("renders an explicitly requested area (browsing) anchored on its first room", () => {
    const m = createMap();
    const a1 = addArea(m, { key: "k1", label: "A1" });
    const a2 = addArea(m, { key: "k2", label: "A2" });
    const here = addRoom(m, { key: "H", name: "H", areaId: a1.id, coords: { x: 0, y: 0, z: 0 } });
    const browsed = addRoom(m, { key: "B", name: "B", areaId: a2.id, coords: { x: 5, y: 5, z: 0 } });
    setCurrent(m, here.id); // current is in a1, but we browse a2
    const layout = computeLayout(m, { cx: 100, cy: 100, scale: 40, areaId: a2.id });
    expect(layout.rooms.length).toBe(1);
    // anchored (centered) on the browsed area's own room; not marked current
    expect(layout.rooms[0]).toMatchObject({ id: browsed.id, px: 100, py: 100, isCurrent: false });
  });
});

// --- appended to ui/render.test.js ---
import { computeLayout as computeLayoutP2 } from "./render.js";
import { createMap as createMapP2, addRoom as addRoomP2, linkExit as linkExitP2 } from "./graph.js";

describe("computeLayout: a ring's seam", () => {
  // A ring of 24 with rooms every 6: 0 (12:00), 6, 12, 18, linked east round.
  function ring() {
    const m = createMap();
    const rooms = [0, 6, 12, 18].map((x) => {
      const r = addRoom(m, { key: `R${x}`, name: `R${x}`, coords: { x, y: 0, z: 0 } });
      r.wrapX = 24;
      return r;
    });
    rooms.forEach((r, i) => linkExit(m, r.id, "e", rooms[(i + 1) % 4].id));
    return { m, rooms };
  }

  it("draws the ring centred on the current room, across the seam", () => {
    const { m, rooms } = ring();
    setCurrent(m, rooms[3].id); // x 18
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    const px = (r) => layout.rooms.find((l) => l.id === r.id).px;
    // 12:00 is drawn just east of 18, not 18 cells west of it.
    expect(px(rooms[0])).toBe(60);
    expect(px(rooms[1])).toBe(-120);
    expect(px(rooms[2])).toBe(-60);
    expect(layout.exits).toContainEqual(expect.objectContaining({ x1: 0, y1: 0, x2: 60, y2: 0, onPath: false }));
  });

  it("runs a way across the far side off each edge, dashed, not across the map", () => {
    const { m, rooms } = ring();
    setCurrent(m, rooms[0].id);
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    // 6 is drawn at +60, 18 at -60, and 12 at -120: the way 6 → 12 crosses the far side.
    const seam = layout.exits.filter((e) => e.seam);
    expect(seam).toHaveLength(2);
    expect(seam).toContainEqual(expect.objectContaining({ x1: 60, y1: 0, x2: 120, y2: 0, dir1: "e", onPath: false, seam: true }));
    expect(seam).toContainEqual(expect.objectContaining({ x1: -120, y1: 0, x2: -180, y2: 0, onPath: false, seam: true }));
  });

  it("leaves rooms without a wrap where they are", () => {
    const { m, rooms } = ring();
    for (const r of rooms) delete r.wrapX;
    setCurrent(m, rooms[3].id);
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(layout.rooms.find((l) => l.id === rooms[0].id).px).toBe(-180);
    expect(layout.exits.some((e) => e.seam)).toBe(false);
  });
});

describe("computeLayout: viewedZ + path highlight (Phase 2)", () => {
  it("honors an explicit viewedZ override instead of the current room's z", () => {
    const m = createMapP2();
    const a = addRoomP2(m, { key: "a", name: "Ground", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    const up = addRoomP2(m, { key: "b", name: "Upstairs", coords: { x: 0, y: 0, z: 1 }, areaId: "1" });
    m.currentId = a.id;
    const layout = computeLayoutP2(m, { cx: 0, cy: 0, scale: 10, areaId: "1", viewedZ: 1 });
    expect(layout.rooms.map((r) => r.id)).toEqual([up.id]);
  });

  it("tags rooms and exits that lie on the highlighted path", () => {
    const m = createMapP2();
    const a = addRoomP2(m, { key: "a", name: "A", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    const b = addRoomP2(m, { key: "b", name: "B", coords: { x: 1, y: 0, z: 0 }, areaId: "1" });
    linkExitP2(m, a.id, "e", b.id); linkExitP2(m, b.id, "w", a.id);
    m.currentId = a.id;
    const edgeKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const path = { rooms: new Set([a.id, b.id]), edges: new Set([edgeKey]) };
    const layout = computeLayoutP2(m, { cx: 0, cy: 0, scale: 10, areaId: "1", path });
    expect(layout.rooms.every((r) => r.onPath)).toBe(true);
    expect(layout.exits[0].onPath).toBe(true);
  });

  it("leaves onPath false when no path is supplied (Phase-1 behavior)", () => {
    const m = createMapP2();
    const a = addRoomP2(m, { key: "a", name: "A", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    m.currentId = a.id;
    const layout = computeLayoutP2(m, { cx: 0, cy: 0, scale: 10, areaId: "1" });
    expect(layout.rooms[0].onPath).toBe(false);
  });
});

// A canvas stand-in that records fills, rects and text, with 6px-per-char text.
function recordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    fillRect: (...a) => calls.push(["fillRect", ctx.fillStyle, ...a, ctx.globalAlpha]),
    strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    bezierCurveTo: () => {},
    strokeText: () => {}, closePath: () => {}, arc: () => {},
    createLinearGradient: (...a) => {
      const g = { stops: [], addColorStop: (o, col) => g.stops.push([o, col]) };
      calls.push(["gradient", g, ...a]);
      return g;
    },
    fill: () => calls.push(["fill", ctx.fillStyle]),
    fillText: (t, x, y) => calls.push(["fillText", t, x, y]),
    measureText: (t) => ({ width: t.length * 6 }),
  };
  return ctx;
}
const texts = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);

describe("computeLayout: annotations", () => {
  it("carries each room's fill, glyph, name and region", () => {
    const { m, a } = sampleMap();
    setTerrains(m, { city: { label: "City", color: "#123456" } });
    a.tags = ["market"]; a.region = "docks";
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    const ra = L.rooms.find((r) => r.id === a.id);
    expect(ra).toMatchObject({ fill: "#123456", glyph: "$", name: "A", region: "docks" });
    expect(L.scale).toBe(40);
  });

  it("places one label per region, centred over its rooms and above the topmost", () => {
    const m = createMap();
    const rs = [0, 1, 2].map((x) => addRoom(m, { key: `k${x}`, coords: { x, y: 0, z: 0 } }));
    const fore = addRoom(m, { key: "f", coords: { x: 1, y: -1, z: 0 } });
    for (const r of [...rs, fore]) r.region = "docks";
    setCurrent(m, rs[0].id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.regions).toEqual([{ key: "docks", name: "docks", x: 40, top: -40 }]);
  });

  it("labels each separated piece of a region on its own", () => {
    const m = createMap();
    const near = [0, 2].map((x) => addRoom(m, { key: `n${x}`, coords: { x, y: 0, z: 0 } }));
    const far = addRoom(m, { key: "far", coords: { x: 22, y: 0, z: 0 } });
    for (const r of [...near, far]) r.region = "concourse";
    linkExit(m, near[0].id, "e", near[1].id);
    setCurrent(m, near[0].id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.regions.map((g) => g.x)).toEqual([10, 220]);
  });
});

describe("computeLayout: region patches", () => {
  const band = (L, key = "r") => L.patches.find((p) => p.region === key).bands;

  it("on a grid, a cell under each room, and neighbours touch into one piece without an exit", () => {
    const m = createMap();
    const rs = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => addRoom(m, { key: `${x}${y}`, coords: { x, y, z: 0 } }));
    for (const r of rs) r.region = "r";
    setCurrent(m, rs[0].id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.patches).toEqual([{
      region: "r", color: null, shape: "square", size: 5, band: 5, cell: 10,
      nodes: [{ px: 0, py: 0 }, { px: 10, py: 0 }, { px: 0, py: 10 }, { px: 10, py: 10 }],
      bands: [],
    }]);
    expect(L.regions).toEqual([{ key: "r", name: "r", x: 5, top: 0 }]);
  });

  it("on a grid, bands a diagonal and a two-cell exit a cell wide", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 2, y: 0, z: 0 } });
    const c = addRoom(m, { key: "c", coords: { x: 3, y: 1, z: 0 } });
    for (const r of [a, b, c]) r.region = "r";
    linkExit(m, a.id, "e", b.id); linkExit(m, b.id, "w", a.id);
    linkExit(m, b.id, "se", c.id);
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(band(L)).toEqual([{ x1: 0, y1: 0, x2: 20, y2: 0 }, { x1: 20, y1: 0, x2: 30, y2: 10 }]);
    expect(L.regions.length).toBe(1);
  });

  it("doesn't bridge rooms of a region a cell apart with no exit between", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const c = addRoom(m, { key: "c", coords: { x: 0, y: 2, z: 0 } });
    for (const r of [a, c]) r.region = "r";
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(band(L)).toEqual([]);
    expect(L.regions.length).toBe(2);
  });

  it("off a grid, discs joined by a band along each exit, never across an unlinked gap", () => {
    const m = createMap();
    // Open land: km coords, odd spacing and angles.
    const pts = { a: [4.8, 1], b: [6.1, 1.7], c: [6.9, 3.2], far: [9.8, 3.3] };
    const R = {};
    for (const [k, [x, y]] of Object.entries(pts)) { R[k] = addRoom(m, { key: k, coords: { x, y, z: 0 } }); R[k].region = "downs"; }
    linkExit(m, R.a.id, "se", R.b.id); linkExit(m, R.b.id, "nw", R.a.id);
    linkExit(m, R.b.id, "s", R.c.id);
    setCurrent(m, R.a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    const p = L.patches[0];
    expect(p).toMatchObject({ shape: "round", size: 24, band: 20 });
    expect(p.nodes.length).toBe(4);
    expect(p.bands.length).toBe(2);
    const at = (k) => L.rooms.find((r) => r.id === R[k].id);
    expect(p.bands[0]).toEqual({ x1: at("a").px, y1: at("a").py, x2: at("b").px, y2: at("b").py });
    // `far` is 2.9 from c with no exit, past where closing would join them:
    // its own piece, with its own label.
    expect(p.bands.some((b) => b.x2 === at("far").px || b.x1 === at("far").px)).toBe(false);
    expect(L.regions.length).toBe(2);
  });

  it("off a grid, rooms near enough that closing joins them are one piece (labelled once)", () => {
    const m = createMap();
    const area = addArea(m, { key: "t" });
    const a = addRoom(m, { key: "a", coords: { x: 0.3, y: 0, z: 0 }, areaId: area.id });
    const b = addRoom(m, { key: "b", coords: { x: 2.7, y: 0.4, z: 0 }, areaId: area.id });   // 2.43 apart
    for (const r of [a, b]) r.region = "r";
    setCurrent(m, a.id);
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 }).regions.length).toBe(1);
    // A land region isn't drawn, so isn't closed: only touching discs join.
    area.regionTypes = { r: "land" };
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 }).regions.length).toBe(2);
  });

  it("off a grid, discs that overlap are one piece without an exit", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0.3, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 1.1, y: 0.4, z: 0 } });
    for (const r of [a, b]) r.region = "r";
    setCurrent(m, a.id);
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 }).regions.length).toBe(1);
  });

  it("gives each region its own patch, and doesn't band an exit between two regions", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 2, y: 0, z: 0 } });
    a.region = "r"; b.region = "s";
    linkExit(m, a.id, "e", b.id);
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.patches.map((p) => [p.region, p.bands.length])).toEqual([["r", 0], ["s", 0]]);
  });

  it("across a ring's seam, bands each end out toward where the other comes round", () => {
    const m = createMap();
    const rs = [0, 1, 2, 3].map((x) => addRoom(m, { key: `r${x}`, coords: { x: x * 2, y: 0, z: 0 } }));
    for (const r of rs) { r.region = "ring"; r.wrapX = 8; }
    for (let i = 0; i < 4; i++) linkExit(m, rs[i].id, "e", rs[(i + 1) % 4].id);
    setCurrent(m, rs[0].id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    // Drawn at x = 0, 20, -40, -20: r1→r2 crosses the seam.
    const seam = band(L, "ring").filter((b) => Math.abs(b.x2 - b.x1) === 20 && (b.x1 === 20 || b.x1 === -40));
    expect(seam).toEqual(expect.arrayContaining([{ x1: 20, y1: 0, x2: 40, y2: 0 }, { x1: -40, y1: 0, x2: -60, y2: 0 }]));
    // The rest of the ring joins r2 → r3 → r0 → r1 the short way: one piece.
    expect(L.regions.length).toBe(1);
  });

  it("a region on whole-number coords is a grid on a ring seen from off the grid", () => {
    const m = createMap();
    // You stand at x = 1.3 (off the grid); the region's rooms come round to
    // 1.3 + 3.7000000000000002 and so on, which isn't a whole number.
    const me = addRoom(m, { key: "me", coords: { x: 1.3, y: 0, z: 0 } });
    const rs = [5, 6].map((x) => addRoom(m, { key: `s${x}`, coords: { x, y: 0, z: 0 } }));
    for (const r of [me, ...rs]) r.wrapX = 24;
    for (const r of rs) r.region = "station";
    linkExit(m, rs[0].id, "e", rs[1].id);
    setCurrent(m, me.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.patches.find((p) => p.region === "station").shape).toBe("square");
  });

  it("bandQuad traces a band clockwise on screen, as wide as asked", () => {
    const q = bandQuad({ x1: 0, y1: 0, x2: 10, y2: 0 }, 3);
    expect(q).toEqual([{ x: 0, y: -3 }, { x: 10, y: -3 }, { x: 10, y: 3 }, { x: 0, y: 3 }]);
    expect(bandQuad({ x1: 1, y1: 1, x2: 1, y2: 1 }, 3)).toBe(null);
  });
});

describe("draw: annotations", () => {
  function layoutWith(scale) {
    const { m, a } = sampleMap();
    a.tags = ["lift"]; a.region = "hub"; a.name = "Hub";
    return computeLayout(m, { cx: 0, cy: 0, scale });
  }

  it("tints each region with one fill, draws glyphs, and names rooms at the large zooms", () => {
    const ctx = recordingCtx();
    draw(ctx, layoutWith(NAME_LABEL_MIN_SCALE), { roomSize: 22 });
    const tints = ctx.calls.filter((c) => c[0] === "fill" && String(c[1]).startsWith("hsla"));
    expect(tints.length).toBe(1);
    expect(tints[0][1]).toMatch(/, 0\.18\)$/);
    expect(ctx.calls.some((c) => c[0] === "fillRect" && String(c[1]).startsWith("hsla"))).toBe(false);
    expect(texts(ctx)).toEqual(expect.arrayContaining(["⇅", "Hub", "B", "hub"]));
  });

  it("leaves room names off at smaller zooms but keeps the region's", () => {
    const ctx = recordingCtx();
    draw(ctx, layoutWith(32), { roomSize: 16 });
    expect(texts(ctx)).toEqual(["⇅", "hub"]);
  });

  it("draws no names or region labels when labels are off, and no glyph in a tiny room", () => {
    const ctx = recordingCtx();
    draw(ctx, layoutWith(16), { roomSize: 8, labels: false });
    expect(texts(ctx)).toEqual([]);
  });

  it("fitText truncates with an ellipsis", () => {
    const ctx = recordingCtx();
    expect(fitText(ctx, "Hall", 40)).toBe("Hall");
    expect(fitText(ctx, "Observation Lounge", 40)).toBe("Obser…");
  });
});

describe("draw: floor marks", () => {
  it("fills a triangle for each way up or down, in the room's ink", () => {
    const ctx = recordingCtx();
    const room = (o) => ({ id: "1", px: 0, py: 0, fill: "#ffffff", env: "", ...o });
    draw(ctx, { rooms: [room({ up: true, down: true, link: true })], exits: [], scale: 40 }, { roomSize: 20 });
    expect(ctx.calls.filter((c) => c[0] === "fill")).toEqual([["fill", "#000000"], ["fill", "#000000"], ["fill", "#000000"]]);
    const plain = recordingCtx();
    draw(plain, { rooms: [room({})], exits: [], scale: 40 }, { roomSize: 20 });
    expect(plain.calls.filter((c) => c[0] === "fill")).toEqual([]);
  });
});

describe("draw: region label collisions", () => {
  it("skips a region label that would overlap one already drawn", () => {
    const ctx = recordingCtx();
    const layout = { rooms: [], exits: [], patches: [], scale: 40, regions: [
      { key: "a", name: "Alpha", x: 0, top: 0 },
      { key: "b", name: "Bravo", x: 10, top: 0 },
      { key: "c", name: "Charlie", x: 200, top: 0 },
    ] };
    draw(ctx, layout, { roomSize: 20 });
    expect(texts(ctx)).toEqual(["Alpha", "Charlie"]);
  });
});

describe("glyphOrigin", () => {
  it("centres a glyph's ink, not its em box", () => {
    // Ink 2px left of the origin to 8px right, 12px above the baseline to 2px below.
    const ctx = { measureText: () => ({
      width: 10, actualBoundingBoxLeft: 2, actualBoundingBoxRight: 8,
      actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 2,
    }) };
    expect(glyphOrigin(ctx, "$", 100, 50)).toEqual({ x: 97, y: 55 });
    expect(ctx.textAlign).toBe("left");
    expect(ctx.textBaseline).toBe("alphabetic");
    // Its ink then spans 95…105 across and 43…57 down: centred on (100, 50).
  });

  it("falls back to centring the em box without ink metrics", () => {
    const ctx = { measureText: () => ({ width: 10 }) };
    expect(glyphOrigin(ctx, "$", 100, 50)).toEqual({ x: 100, y: 50 });
    expect(ctx.textAlign).toBe("center");
    expect(ctx.textBaseline).toBe("middle");
  });
});

describe("roomsInRect", () => {
  it("picks the rooms whose squares meet the box, dragged either way", () => {
    const layout = { rooms: [{ id: "1", px: 0, py: 0 }, { id: "2", px: 40, py: 0 }, { id: "3", px: 0, py: 40 }] };
    expect(roomsInRect(layout, -5, -5, 32, 5, 20)).toEqual(["1", "2"]);
    expect(roomsInRect(layout, 32, 5, -5, -5, 20)).toEqual(["1", "2"]);
    expect(roomsInRect(layout, 11, 11, 29, 29, 20)).toEqual([]);
  });
});

describe("charted rooms", () => {
  it("are flagged in the layout and drawn faded", () => {
    const { m, a } = sampleMap();
    a.charted = true;
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.rooms.find((r) => r.id === a.id).charted).toBe(true);
    expect(L.rooms.filter((r) => r.id !== a.id).every((r) => r.charted === false)).toBe(true);
    const ctx = recordingCtx();
    draw(ctx, L, { roomSize: 20 });
    const alphas = ctx.calls.filter((c) => c[0] === "fillRect").map((c) => c[c.length - 1]);
    expect(alphas).toContain(0.45);
    expect(alphas).toContain(1);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("exit directions", () => {
  function pair(dirAB, dirBA, bAt) {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "B", name: "B", coords: { ...bAt, z: 0 } });
    linkExit(m, a.id, dirAB, b.id);
    if (dirBA) linkExit(m, b.id, dirBA, a.id);
    setCurrent(m, a.id);
    return { m, a, b };
  }

  it("records the direction each end of a line leaves its room by", () => {
    // B is up-and-right of A, but the way there is `n`, and back is `w`.
    const { m } = pair("n", "w", { x: 1, y: -2 });
    const [e] = computeLayout(m, { cx: 0, cy: 0, scale: 10 }).exits;
    expect(e).toMatchObject({ dir1: "n", dir2: "w" });
  });

  it("prefers the reverse exit as the way back", () => {
    const { m, a, b } = pair("e", "w", { x: 1, y: 0 });
    linkExit(m, b.id, "sw", a.id);
    const [e] = computeLayout(m, { cx: 0, cy: 0, scale: 10 }).exits;
    expect(e).toMatchObject({ dir1: "e", dir2: "w" });
  });

  it("puts a port mid-side for a straight direction and on the corner for a diagonal", () => {
    expect(exitPort(0, 0, "n", 5)).toMatchObject({ x: 0, y: -5, ux: 0, uy: -1 });
    expect(exitPort(0, 0, "ne", 5)).toMatchObject({ x: 5, y: -5 });
    expect(exitPort(0, 0, "u", 5)).toBeNull();
  });

  it("leaves a room by its exit's side even when the other room sits more the other way", () => {
    // A `n` exit to a room mostly east: the line starts at the top of A.
    const g = exitGeometry({ x1: 0, y1: 0, x2: 40, y2: -10, dir1: "n", dir2: "w" }, 5);
    expect(g.start).toEqual({ x: 0, y: -5 });
    expect(g.a.x).toBe(0);
    expect(g.a.y).toBeLessThan(-5);
    expect(g.end).toEqual({ x: 35, y: -10 });
  });

  it("meets a room with no exit back on the side facing the line", () => {
    const g = exitGeometry({ x1: 0, y1: 0, x2: 40, y2: 0, dir1: "e", dir2: null }, 5);
    expect(g.end).toEqual({ x: 35, y: 0 });
  });

  it("is straight between rooms that sit the way their exits say", () => {
    const g = exitGeometry({ x1: 0, y1: 0, x2: 0, y2: -40, dir1: "n", dir2: "s" }, 5);
    for (const p of [g.start, g.a, g.c1, g.c2, g.b, g.end]) expect(p.x).toBe(0);
  });
});

describe("exit stubs", () => {
  it("stubs a listed exit not taken yet, but not one a line already shows", () => {
    const { m, a } = sampleMap();          // a -n-> b
    a.exitKeys = { n: "B", e: "C", u: "U" };
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual([{ px: 0, py: 0, dir: "e", unexplored: true }]);
  });

  it("stubs a captured (non-GMCP) room's listed exits too", () => {
    const { m, a } = sampleMap();
    a.exitDirs = ["n", "sw"];
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual([{ px: 0, py: 0, dir: "sw", unexplored: true }]);
  });

  it("stubs a known exit to a room out of view as explored", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    const far = addRoom(m, { key: "F", name: "F", coords: { x: 1, y: 0, z: 0 }, areaId: "2" });
    linkExit(m, a.id, "e", far.id);
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual([{
      px: 0, py: 0, dir: "e", from: a.id, unexplored: false, oneWay: true,
      to: far.id, kind: "area", label: "F",
    }]);
  });

  it("names the area an exit not taken yet leads to, where the server said", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "Port Road", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    a.exitKeys = { e: "land.join", n: "B" };
    a.exitAreas = { e: { tag: "surface.tamsin", name: "Tamsin" } };
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual(expect.arrayContaining([
      { px: 0, py: 0, dir: "e", from: a.id, unexplored: false, to: null, kind: "area", unmapped: true, label: "Tamsin" },
      { px: 0, py: 0, dir: "n", unexplored: true },
    ]));
  });

  it("names a known area by your label for it, though the exit's room isn't mapped", () => {
    const m = createMap();
    const land = addArea(m, { key: "zone:surface.tamsin", label: "Tamsin's land" });
    const a = addRoom(m, { key: "A", name: "Port Road", coords: { x: 0, y: 0, z: 0 }, areaId: "9" });
    addRoom(m, { key: "X", name: "Elsewhere", coords: { x: 0, y: 0, z: 0 }, areaId: land.id });
    a.exitKeys = { e: "land.join" };
    a.exitAreas = { e: { tag: "surface.tamsin", name: "Tamsin" } };
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs[0]).toMatchObject({ unmapped: true, label: "Tamsin's land" });
  });

  it("names the area a stub leads to, by the area's label", () => {
    const m = createMap();
    const here = addArea(m, { key: "zone:downs", label: "the Downs" });
    const there = addArea(m, { key: "zone:fields", label: "Fallow Fields" });
    const a = addRoom(m, { key: "A", name: "Port Road", coords: { x: 0, y: 0, z: 0 }, areaId: here.id });
    const far = addRoom(m, { key: "F", name: "Gate", coords: { x: 9, y: 9, z: 0 }, areaId: there.id });
    linkExit(m, a.id, "nw", far.id);
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual([expect.objectContaining({
      dir: "nw", to: far.id, kind: "area", label: "Fallow Fields",
    })]);
  });

  it("names a room on another floor of the area, with which way it is", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "Hall", coords: { x: 0, y: 0, z: 0 } });
    const up = addRoom(m, { key: "T", name: "Tower Stair", coords: { x: 1, y: 0, z: 1 } });
    const down = addRoom(m, { key: "C", name: "Cellar", coords: { x: 0, y: 1, z: -1 } });
    linkExit(m, a.id, "e", up.id);
    linkExit(m, a.id, "s", down.id);
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toContainEqual(expect.objectContaining({ dir: "e", to: up.id, kind: "floor", up: true, label: "↑ Tower Stair" }));
    expect(L.stubs).toContainEqual(expect.objectContaining({ dir: "s", to: down.id, kind: "floor", up: false, label: "↓ Cellar" }));
  });

  it("doesn't stub the far end of a one-way line", () => {
    const { m, b } = sampleMap();          // a -n-> b, nothing back
    b.exitKeys = { s: "A" };               // b lists `s`, unlinked — still unexplored
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.stubs).toEqual([{ px: 0, py: -40, dir: "s", unexplored: true }]);
  });
});

describe("unexplored stubs", () => {
  it("fade from the stub colour at the room to clear at the tip, with no ring", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 } });
    a.exitDirs = ["e"];
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    const ctx = recordingCtx();
    let arcs = 0;
    ctx.arc = () => { arcs++; };
    draw(ctx, L, { roomSize: 20, colors: { unexplored: "#fb923c" } });
    const grads = ctx.calls.filter((c) => c[0] === "gradient");
    expect(grads).toHaveLength(1);
    const [, g, x1, y1, x2, y2] = grads[0];
    expect([x1, y1]).toEqual([10, 0]);       // from the east side of the room
    expect(x2).toBe(30);                     // outward, a room's width (20)
    expect(y2).toBe(0);
    expect(g.stops).toEqual([[0, "#fb923c"], [1, "rgba(251, 146, 60, 0)"]]);
    expect(arcs).toBe(0);
  });

  it("clearOf keeps the hue at no alpha, and falls back for other forms", () => {
    expect(clearOf("#f80")).toBe("rgba(255, 136, 0, 0)");
    expect(clearOf("#FB923C")).toBe("rgba(251, 146, 60, 0)");
    expect(clearOf("rgb(1, 2, 3)")).toBe("transparent");
  });
});

describe("cards on stubs to another area or floor", () => {
  // A room at the origin, its exits each to a room in another area named
  // for the label wanted; `others` are more rooms of this area, unlinked.
  function crossing(exits, others = []) {
    const m = createMap();
    const here = addArea(m, { key: "h", label: "the Downs" });
    const a = addRoom(m, { key: "A", name: "Port Road", coords: { x: 0, y: 0, z: 0 }, areaId: here.id });
    const fars = {};
    let n = 0;
    for (const [dir, label] of Object.entries(exits)) {
      const there = addArea(m, { key: `t${n}`, label });
      fars[dir] = addRoom(m, { key: `F${n}`, name: "Gate", coords: { x: 50 + n++, y: 0, z: 0 }, areaId: there.id });
      linkExit(m, a.id, dir, fars[dir].id);
    }
    for (const [x, y, name] of others) addRoom(m, { key: `o${x},${y}`, name: name || "", coords: { x, y, z: 0 }, areaId: here.id });
    setCurrent(m, a.id);
    return { m, fars };
  }
  const drawAt = (m, scale, labels = true) => {
    const L = computeLayout(m, { cx: 0, cy: 0, scale });
    const ctx = recordingCtx();
    const { cards } = draw(ctx, L, { roomSize: scale / 2, labels });
    return { L, ctx, cards };
  };
  const meets = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  it("shows the whole name where there's space, growing away from the room", () => {
    const { m, fars } = crossing({ e: "Fallow Fields" });
    const { ctx, cards } = drawAt(m, 60);
    expect(texts(ctx)).toContain("Fallow Fields");
    expect(cards).toHaveLength(1);
    const k = cards[0];
    expect(k).toMatchObject({ to: fars.e.id, dir: "e", kind: "area", label: "Fallow Fields" });
    // From the stub's end (east side 15 + 13.5) rightward, as wide as the
    // name (78 here) and its padding: far wider than a cell.
    expect(k.l).toBeCloseTo(28.5);
    expect(k.r - k.l).toBe(86);
    expect(k.t + k.b).toBe(0);              // centred on the exit's line
    expect(cardAt(cards, 80, 0)).toBe(k);
    expect(cardAt(cards, 0, 0)).toBeNull();
  });

  it("grows west leftward and north centred", () => {
    const { cards } = drawAt(crossing({ w: "Westmarch", n: "Northfold" }).m, 60);
    const w = cards.find((k) => k.dir === "w"), n = cards.find((k) => k.dir === "n");
    expect(w.r).toBeLessThan(-15);
    expect(n.b).toBeLessThan(-15);
    expect(n.l + n.r).toBeCloseTo(0);
  });

  it("stops short of a room in the way, cutting the name to fit", () => {
    const { m } = crossing({ e: "The Very Long Name Of Somewhere" }, [[2, 0]]);
    const { ctx, cards } = drawAt(m, 60);
    expect(cards).toHaveLength(1);
    expect(cards[0].r).toBeLessThanOrEqual(120 - 15 - 3);
    expect(texts(ctx).some((t) => t.endsWith("…"))).toBe(true);
    expect(cards[0].label).toBe("The Very Long Name Of Somewhere");
  });

  it("stops short of an exit line rather than covering or crossing it", () => {
    const { m } = crossing({ e: "The Very Long Name Of Somewhere" }, [[2, -1], [2, 1]]);
    const [b, c] = Object.values(m.rooms).filter((r) => r.coords.x === 2);
    linkExit(m, b.id, "s", c.id);
    linkExit(m, c.id, "n", b.id);
    const { ctx, cards } = drawAt(m, 60);    // the line runs down x = 120
    expect(cards).toHaveLength(1);
    expect(cards[0].r).toBeLessThan(120);
    expect(texts(ctx).some((t) => t.endsWith("…"))).toBe(true);
  });

  it("is a plain stub where a line leaves no room for even a few letters", () => {
    const { m } = crossing({ e: "The Very Long Name Of Somewhere" }, [[1, -1], [1, 1]]);
    const [b, c] = Object.values(m.rooms).filter((r) => r.coords.x === 1);
    linkExit(m, b.id, "s", c.id);
    linkExit(m, c.id, "n", b.id);
    expect(drawAt(m, 60).cards).toEqual([]);  // the line at x = 60: not past it
  });

  it("slides a north card off-centre where one side is short", () => {
    const { m } = crossing({ n: "Northfold Downs" }, [[-1, -1]]);
    const { cards } = drawAt(m, 60);
    const k = cards[0];
    expect(k.l).toBeGreaterThanOrEqual(-60 + 15 + 3);   // clear of the room up-left
    expect(k.l).toBeLessThanOrEqual(0);                  // still over its stub
    expect(k.r - k.l).toBe(15 * 6 + 8);                  // whole name: shifted, not cut
  });

  it("keeps a south card clear of its own room's name", () => {
    const { cards } = drawAt(crossing({ s: "Southwold" }).m, 60);
    // The name sits 17…29 under the room.
    expect(cards[0].t).toBeGreaterThanOrEqual(29);
  });

  it("never overlaps another card, a room or a name, however crowded", () => {
    const exits = Object.fromEntries(["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((d) => [d, `Somewhere ${d} rather far off`]));
    const { m } = crossing(exits, [[1, 1, "Corner Room"], [-2, 0, "Westside"], [0, -2, "Up North"]]);
    for (const scale of [24, 32, 44, 60]) {
      const { L, cards } = drawAt(m, scale);
      const half = scale / 4;
      const rooms = L.rooms.map((r) => ({ l: r.px - half, r: r.px + half, t: r.py - half, b: r.py + half }));
      for (const [i, k] of cards.entries()) {
        for (const o of [...rooms, ...cards.slice(i + 1)]) expect(meets(k, o)).toBe(false);
      }
    }
  });

  it("gives contested space to the exits by the current room first", () => {
    const { m } = crossing({ e: "Alpha Somewhere Long" }, [[2, 0]]);
    const other = Object.values(m.rooms).find((r) => r.coords.x === 2);
    const there = addArea(m, { key: "b", label: "Beta Somewhere Long" });
    const far = addRoom(m, { key: "B", coords: { x: 90, y: 0, z: 0 }, areaId: there.id });
    linkExit(m, other.id, "w", far.id);
    const { cards } = drawAt(m, 44);
    const mine = cards.find((k) => k.dir === "e");
    expect(mine).toBeDefined();
    expect(cards.filter((k) => k.dir === "w").every((k) => !meets(k, mine))).toBe(true);
  });

  it("shows at smaller zooms too, but not the smallest or with names off", () => {
    const { m } = crossing({ e: "Fields" });
    expect(drawAt(m, 24).cards).toHaveLength(1);
    expect(texts(drawAt(m, 24).ctx)).toContain("Fields");
    for (const [scale, labels] of [[16, true], [60, false]]) {
      const { ctx, cards } = drawAt(m, scale, labels);
      expect(cards).toEqual([]);
      expect(texts(ctx)).not.toContain("Fields");
    }
  });

  it("carries which way a floor card goes, for its hover card", () => {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "Hall", coords: { x: 0, y: 0, z: 0 } });
    const up = addRoom(m, { key: "T", name: "Tower", coords: { x: 1, y: 0, z: 1 } });
    linkExit(m, a.id, "e", up.id);
    setCurrent(m, a.id);
    expect(drawAt(m, 60).cards[0]).toMatchObject({ kind: "floor", up: true, label: "↑ Tower" });
  });

  it("is drawn before the rooms, so a room over it stays on top", () => {
    const { ctx } = drawAt(crossing({ e: "Fields" }).m, 60);
    const card = ctx.calls.findIndex((c) => c[0] === "fillText" && c[1] === "Fields");
    const room = ctx.calls.findIndex((c) => c[0] === "fillRect");
    expect(card).toBeGreaterThanOrEqual(0);
    expect(card).toBeLessThan(room);
  });
});

describe("one-way exits", () => {
  function pair() {
    const m = createMap();
    const a = addRoom(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "B", name: "B", coords: { x: 1, y: 1, z: 0 } });
    linkExit(m, a.id, "se", b.id);
    setCurrent(m, a.id);
    return { m, a, b };
  }
  const only = (m) => computeLayout(m, { cx: 0, cy: 0, scale: 10 }).exits;

  it("marks a line with no way back as one way", () => {
    expect(only(pair().m)[0].oneWay).toBe(true);
  });

  it("isn't one way with an exit back, by any direction, or a link", () => {
    const back = pair();
    linkExit(back.m, back.b.id, "nw", back.a.id);
    expect(only(back.m)[0].oneWay).toBe(false);
    const out = pair();
    linkExit(out.m, out.b.id, "out", out.a.id);
    expect(only(out.m)[0].oneWay).toBe(false);
    const link = pair();
    addLink(link.m, link.b.id, link.a.id, { oneWay: true });
    expect(only(link.m)[0].oneWay).toBe(false);
  });

  it("draws an arrowhead at the end it leads into, pointing in", () => {
    const g = exitGeometry({ x1: 0, y1: 0, x2: 0, y2: 100, dir1: "s", dir2: null }, 10);
    const a = oneWayArrow(g, 10);
    expect(a.tip).toEqual(g.end);
    // Its base is back up the line, either side of it.
    expect(a.left.y).toBeLessThan(a.tip.y);
    expect(a.right.y).toBeLessThan(a.tip.y);
    expect(a.left.x).toBeCloseTo(-a.right.x);
  });

  it("is filled when drawn", () => {
    const { m } = pair();
    const calls = [];
    const ctx = {
      fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      stroke: () => {}, bezierCurveTo: () => {}, closePath: () => {}, arc: () => {}, strokeText: () => {},
      fill: () => calls.push(["fill", ctx.fillStyle]), fillText: () => {}, measureText: (t) => ({ width: t.length * 6 }),
    };
    draw(ctx, computeLayout(m, { cx: 0, cy: 0, scale: 40 }), { roomSize: 20, labels: false });
    expect(calls).toContainEqual(["fill", "#6b7280"]);
  });
});

describe("one-way stubs to another floor", () => {
  function floors() {
    const m = createMap();
    const top = addRoom(m, { key: "S", name: "Summit", coords: { x: 0, y: 0, z: 1 } });
    const low = addRoom(m, { key: "O", name: "Old Shaft", coords: { x: 1, y: 1, z: 0 } });
    linkExit(m, top.id, "se", low.id);
    setCurrent(m, top.id);
    return { m, top, low };
  }
  const stub = (m) => computeLayout(m, { cx: 0, cy: 0, scale: 40 }).stubs[0];

  it("marks a stub with no way back as one way", () => {
    expect(stub(floors().m).oneWay).toBe(true);
  });

  it("isn't one way where the room below leads back", () => {
    const { m, top, low } = floors();
    linkExit(m, low.id, "nw", top.id);
    expect(stub(m).oneWay).toBe(false);
  });

  it("draws the arrowhead, card or no card", () => {
    for (const labels of [true, false]) {
      const { m } = floors();
      const calls = [];
      const ctx = {
        fillRect: () => {}, strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
        stroke: () => {}, bezierCurveTo: () => {}, closePath: () => {}, arc: () => {}, strokeText: () => {},
        roundRect: () => {}, fill: () => calls.push(["fill", ctx.fillStyle]), fillText: () => {},
        measureText: (t) => ({ width: t.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
      };
      draw(ctx, computeLayout(m, { cx: 200, cy: 200, scale: 40 }), { roomSize: 20, labels });
      expect(calls).toContainEqual(["fill", "#6b7280"]);
    }
  });
});

describe("computeLayout: height shading", () => {
  function hills() {
    const m = createMap();
    const area = addArea(m, { key: "land" });
    const low = addRoom(m, { key: "lo", env: "x", coords: { x: 0, y: 0, z: 0 }, areaId: area.id });
    const high = addRoom(m, { key: "hi", env: "x", coords: { x: 1, y: 0, z: 0 }, areaId: area.id });
    const flat = addRoom(m, { key: "fl", env: "x", coords: { x: 2, y: 0, z: 0 }, areaId: area.id });
    const above = addRoom(m, { key: "up", env: "x", coords: { x: 0, y: 0, z: 1 }, areaId: area.id });
    setTerrains(m, { x: { label: "X", color: "#808080" } });
    low.elevation = 0; high.elevation = 400; above.elevation = 9000;
    setCurrent(m, low.id);
    return { m, low, high, flat };
  }

  it("shades by the range on the floor drawn, lighter higher, and leaves rooms without elevation alone", () => {
    const { m, low, high, flat } = hills();
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.elevation).toEqual({ min: 0, max: 400 });   // the room upstairs isn't in it
    const fill = (r) => L.rooms.find((x) => x.id === r.id).fill;
    expect(fill(high)).toBe(shadeColor("#808080", 1));
    expect(fill(low)).toBe(shadeColor("#808080", -1));
    expect(fill(flat)).toBe("#808080");
  });

  it("shades the user's colour too, and not at all when turned off", () => {
    const { m, high } = hills();
    high.color = "#204060";
    const on = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(on.rooms.find((x) => x.id === high.id).fill).toBe(shadeColor("#204060", 1));
    const off = computeLayout(m, { cx: 0, cy: 0, scale: 40, shade: false });
    expect(off.rooms.find((x) => x.id === high.id).fill).toBe("#204060");
    expect(off.elevation).toEqual({ min: 0, max: 400 });   // still reported, for the toggle
  });

  it("has no range where no room on the floor has an elevation", () => {
    const { m } = sampleMap();
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 }).elevation).toBe(null);
  });

  it("inks the glyph for the shaded fill", () => {
    const m = createMap();
    const area = addArea(m, { key: "land" });
    // #969696 reads with black ink; darkened (30% toward black) it takes white.
    setTerrains(m, { x: { label: "X", color: "#969696" } });
    const lo = addRoom(m, { key: "lo", env: "x", coords: { x: 0, y: 0, z: 0 }, areaId: area.id });
    const hi = addRoom(m, { key: "hi", env: "x", coords: { x: 1, y: 0, z: 0 }, areaId: area.id });
    lo.elevation = 0; hi.elevation = 1000; lo.symbol = "Q";
    setCurrent(m, lo.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    const ctx = recordingCtx();
    const fills = [];
    const orig = ctx.fillText;
    ctx.fillText = (t, x, y) => { fills.push([t, ctx.fillStyle]); orig(t, x, y); };
    draw(ctx, L, { roomSize: 20, labels: false });
    expect(fills.find((f) => f[0] === "Q")[1]).toBe(inkOn(shadeColor("#969696", -1)));
    expect(inkOn(shadeColor("#969696", -1))).not.toBe(inkOn("#969696"));
  });
});

describe("computeLayout: game glyphs", () => {
  it("draws the first game tag's glyph over the built-in one", () => {
    const { m, a } = sampleMap();
    setTagDefs(m, [{ id: "smithy", label: "Smithy", glyph: "S" }]);
    a.tags = ["market", "smithy"];
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.rooms.find((r) => r.id === a.id).glyph).toBe("S");
  });
});

describe("draw: region patches", () => {
  // A stand-in OffscreenCanvas, counting how many are made.
  let made = 0;
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; made++; }
    getContext() {
      const noop = () => {};
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: noop, drawImage: noop, setTransform: noop, beginPath: noop, moveTo: noop,
        lineTo: noop, arc: noop, closePath: noop, fill: noop, fillRect: noop,
      };
    }
  }
  const withCanvas = (fn) => {
    const prev = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = FakeCanvas;
    try { return fn(); } finally { if (prev) globalThis.OffscreenCanvas = prev; else delete globalThis.OffscreenCanvas; }
  };
  const drawn = (L) => {
    const ctx = recordingCtx();
    ctx.save = () => {}; ctx.restore = () => {};
    ctx.drawImage = (...a) => ctx.calls.push(["drawImage", ctx.globalAlpha, ...a.slice(1)]);
    draw(ctx, L, { roomSize: 16, colors: {}, labels: false, size: { width: 400, height: 300 } });
    return ctx.calls;
  };

  it("fills a grid patch with its path, as ever, even with a canvas to hand", () => {
    const m = createMap();
    const rs = [[0, 0], [1, 0], [0, 1]].map(([x, y]) => addRoom(m, { key: `${x}${y}`, coords: { x, y, z: 0 } }));
    for (const r of rs) r.region = "r";
    setCurrent(m, rs[0].id);
    const calls = withCanvas(() => drawn(computeLayout(m, { cx: 200, cy: 150, scale: 40 })));
    expect(calls.filter((c) => c[0] === "drawImage")).toEqual([]);
    expect(calls).toContainEqual(["fill", regionColor("r", 0.18)]);
  });

  it("draws an off-grid patch closed, from a cache kept until the patch changes (not on a pan)", () => {
    const m = createMap();
    const rs = [[0.3, 0], [1.6, 0.4], [0.9, 1.5]].map(([x, y]) => addRoom(m, { key: `${x}${y}`, coords: { x, y, z: 0 } }));
    for (const r of rs) r.region = "q";
    setCurrent(m, rs[0].id);
    made = 0;
    const L = computeLayout(m, { cx: 200, cy: 150, scale: 40 });
    const calls = withCanvas(() => drawn(L));
    const imgs = calls.filter((c) => c[0] === "drawImage");
    expect(imgs.length).toBe(1);
    expect(imgs[0][1]).toBe(0.18);
    expect(calls.some((c) => c[0] === "fill")).toBe(false);
    expect(made).toBe(2);
    withCanvas(() => drawn(computeLayout(m, { cx: 200, cy: 150, scale: 40 })));
    expect(made).toBe(2);   // same patch, same view: not rebuilt
    const panned = withCanvas(() => drawn(computeLayout(m, { cx: 210, cy: 150, scale: 40 })));
    expect(made).toBe(2);   // panned: the same mask, drawn 10 px on
    expect(panned.find((c) => c[0] === "drawImage")[2] - imgs[0][2]).toBeCloseTo(10);
    withCanvas(() => drawn(computeLayout(m, { cx: 390, cy: 150, scale: 40 })));
    expect(made).toBe(4);   // panned past what was built: built again
    rs[1].coords.x = 1.9;
    withCanvas(() => drawn(computeLayout(m, { cx: 390, cy: 150, scale: 40 })));
    expect(made).toBe(6);   // the patch changed: built again
  });

  it("falls back to the plain path where there's no canvas", () => {
    const m = createMap();
    const rs = [[0.3, 0], [1.6, 0.4]].map(([x, y]) => addRoom(m, { key: `${x}${y}`, coords: { x, y, z: 0 } }));
    for (const r of rs) r.region = "q";
    setCurrent(m, rs[0].id);
    expect(drawn(computeLayout(m, { cx: 200, cy: 150, scale: 40 }))).toContainEqual(["fill", regionColor("q", 0.18)]);
  });
});

describe("knockoutShapes: the contour halo", () => {
  // Is (x, y) within the halo: a disc, or half the band's width of a path?
  const inHalo = (k, x, y) => k.discs.some((d) => Math.hypot(x - d.x, y - d.y) <= d.r)
    || k.paths.some((path) => path.slice(1).some((b, i) => {
      const a = path[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= k.width / 2;
    }));

  it("covers each room's stubs and every exit along its length, but not open ground", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 3, y: 1, z: 0 } });
    linkExit(m, a.id, "e", b.id); linkExit(m, b.id, "w", a.id);
    a.exitKeys = { n: "nowhere" }; b.exitKeys = { s: "nowhere" };
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    const half = 8;
    const k = knockoutShapes(L, half);
    expect(k.discs.length).toBe(2);
    expect(k.discs[0].r).toBe(half * HALO_ROOM);
    expect(k.width).toBe(Math.max(10, half * 1.8));
    // Each stub, out to its far end.
    expect(L.stubs.length).toBe(2);
    for (const s of L.stubs) {
      const p = exitPort(s.px, s.py, s.dir, half);
      const len = Math.max(8, half * 2);
      expect(inHalo(k, p.x + p.ux * len, p.y + p.uy * len)).toBe(true);
    }
    // Along the exit's curve, end to end.
    const g = exitGeometry(L.exits[0], half);
    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t;
      const x = u * u * u * g.a.x + 3 * u * u * t * g.c1.x + 3 * u * t * t * g.c2.x + t * t * t * g.b.x;
      const y = u * u * u * g.a.y + 3 * u * u * t * g.c1.y + 3 * u * t * t * g.c2.y + t * t * t * g.b.y;
      expect(inHalo(k, x, y)).toBe(true);
    }
    // Open ground off the line stays.
    expect(inHalo(k, 60, 80)).toBe(false);
    expect(inHalo(k, 60, -50)).toBe(false);
  });
});

describe("computeLayout: region colours", () => {
  it("tints with the server's region colour, else none (the hashed hue)", () => {
    const m = createMap();
    const area = addArea(m, { key: "t" });
    const r1 = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 }, areaId: area.id });
    const r2 = addRoom(m, { key: "b", coords: { x: 1, y: 0, z: 0 }, areaId: area.id });
    r1.region = "docks"; r2.region = "old";
    area.regionColors = { docks: "#102030" };
    setCurrent(m, r1.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.patches.find((t) => t.region === "docks").color).toBe("#102030");
    expect(L.patches.find((t) => t.region === "old").color).toBe(null);
  });
});

describe("computeLayout: exit styles", () => {
  function pair(styleA, styleB) {
    const m = createMap();
    const a = addRoom(m, { key: "A", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "B", coords: { x: 1, y: 0, z: 0 } });
    linkExit(m, a.id, "e", b.id);
    linkExit(m, b.id, "w", a.id);
    if (styleA) a.exitStyles = { e: styleA };
    if (styleB) b.exitStyles = { w: styleB };
    setCurrent(m, a.id);
    return computeLayout(m, { cx: 0, cy: 0, scale: 40 }).exits;
  }

  it("leaves a plain path unstyled", () => {
    expect(pair(null, null)[0].style).toBeUndefined();
  });

  it("draws the line once in the stronger style of its two ends", () => {
    expect(pair("road", null)).toHaveLength(1);
    expect(pair("road", null)[0].style).toBe("road");
    expect(pair(null, "trail")[0].style).toBe("trail");
    expect(pair("trail", "road")[0].style).toBe("road");
    expect(pair("climb", "road")[0].style).toBe("climb");
    expect(pair("road", "climb")[0].style).toBe("climb");
  });

  it("strokes each style distinctly, none dashed like a seam", () => {
    const path = exitStroke("path"), road = exitStroke("road"), trail = exitStroke("trail"), climb = exitStroke("climb");
    expect(road.width).toBeGreaterThan(path.width);
    expect(trail.width).toBeLessThan(path.width);
    expect(trail.alpha).toBeLessThan(1);
    expect(climb.ticks).toBe(true);
    for (const st of [path, road, climb]) expect(st.dash).toEqual([]);
    expect(trail.dash).not.toEqual([4, 3]);
    expect(exitStroke("bogus")).toEqual(path);
    // On a route the road stays thicker than a highlighted path.
    expect(exitStroke("road", { onPath: true }).width).toBeGreaterThan(exitStroke("path", { onPath: true }).width);
  });

  it("ticks a climb square to its line, evenly along it", () => {
    const g = { start: { x: 0, y: 0 }, a: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 20, y: 0 }, b: { x: 20, y: 0 }, end: { x: 20, y: 0 } };
    const ticks = climbTicks(g, 5, 3);
    expect(ticks.map((t) => Math.round(t.x1 * 100) / 100)).toEqual([2.5, 7.5, 12.5, 17.5]);
    for (const t of ticks) {
      expect(t.x1).toBeCloseTo(t.x2);
      expect(Math.abs(t.y2 - t.y1)).toBeCloseTo(6);
    }
  });
});

describe("computeLayout relief", () => {
  async function reliefMap() {
    const { decodePatch, mergePatch } = await import("./relief.js");
    const m = createMap();
    const area = addArea(m, { key: "zone:hills", label: "Hills" });
    const a = addRoom(m, { key: "a", name: "A", coords: { x: 0, y: 0, z: 0 }, areaId: area.id });
    setCurrent(m, a.id);
    return { m, a, area, decodePatch, mergePatch };
  }

  it("is null with no grid and fewer than two rooms with an elevation", async () => {
    const { m, a } = await reliefMap();
    a.elevation = 10;
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 }).relief).toBe(null);
  });

  it("carries the floor's grid by the area's frame key, and rooms with elevation", async () => {
    const { m, a, area, decodePatch, mergePatch } = await reliefMap();
    mergePatch(m, decodePatch({ area: "hills", cell: 0.5, x: 0, y: 0, cols: 1, rows: 1, height: [5] }));
    a.elevation = 10;
    const b = addRoom(m, { key: "b", coords: { x: 1, y: 0, z: 0 }, areaId: area.id });
    b.elevation = 30;
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.relief.grid).toBe(m.relief.hills[0]);
    expect(L.relief.rooms).toEqual([{ x: 0, y: 0, e: 10 }, { x: 1, y: 0, e: 30 }]);
    expect(L.relief.on).toBe(true);
    // Another floor has no grid.
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40, viewedZ: 1 }).relief).toBe(null);
  });

  it("is there with shading off, marked off, and draw paints nothing for it", async () => {
    const { m, decodePatch, mergePatch } = await reliefMap();
    mergePatch(m, decodePatch({ area: "hills", cell: 0.5, x: 0, y: 0, cols: 1, rows: 1, height: [5] }));
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40, shade: false });
    expect(L.relief.on).toBe(false);
    const calls = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : (...args) => calls.push(k)), set: () => true });
    expect(draw(ctx, L, { roomSize: 20, labels: false, size: { width: 100, height: 100 } }).relief).toBe(null);
    expect(calls).not.toContain("drawImage");
  });
});
