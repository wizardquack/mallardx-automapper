import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, addArea } from "./graph.js";
import { computeLayout, envColor, draw, fitText, glyphOrigin, roomsInRect, NAME_LABEL_MIN_SCALE } from "./render.js";
import { setTerrains } from "./graph.js";

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
    expect(layout.exits).toContainEqual({ x1: 100, y1: 100, x2: 100, y2: 60, onPath: false });
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
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 })).toEqual({ rooms: [], exits: [], tints: [], regions: [], scale: 40 });
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
    expect(layout.exits).toContainEqual({ x1: 0, y1: 0, x2: 60, y2: 0, onPath: false });
  });

  it("runs a way across the far side off each edge, dashed, not across the map", () => {
    const { m, rooms } = ring();
    setCurrent(m, rooms[0].id);
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    // 6 is drawn at +60, 18 at -60, and 12 at -120: the way 6 → 12 crosses the far side.
    const seam = layout.exits.filter((e) => e.seam);
    expect(seam).toHaveLength(2);
    expect(seam).toContainEqual({ x1: 60, y1: 0, x2: 120, y2: 0, onPath: false, seam: true });
    expect(seam).toContainEqual({ x1: -120, y1: 0, x2: -180, y2: 0, onPath: false, seam: true });
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
    strokeText: () => {}, closePath: () => {}, arc: () => {},
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

  it("bridges a one-cell gap between rooms of a region, but not an occupied one", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", coords: { x: 0, y: 0, z: 0 } });
    const b = addRoom(m, { key: "b", coords: { x: 2, y: 0, z: 0 } });
    const c = addRoom(m, { key: "c", coords: { x: 0, y: 2, z: 0 } });
    addRoom(m, { key: "mid", coords: { x: 0, y: 1, z: 0 } });   // no region, sits in a↔c's gap
    for (const r of [a, b, c]) r.region = "docks";
    setCurrent(m, a.id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.tints.map((t) => [t.px, t.py])).toEqual([[0, 0], [10, 0], [20, 0], [0, 20]]);
  });

  it("labels each separated cluster of a region on its own", () => {
    const m = createMap();
    const near = [0, 2].map((x) => addRoom(m, { key: `n${x}`, coords: { x, y: 0, z: 0 } }));
    const far = addRoom(m, { key: "far", coords: { x: 22, y: 0, z: 0 } });
    for (const r of [...near, far]) r.region = "concourse";
    setCurrent(m, near[0].id);
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(L.regions.map((g) => g.x)).toEqual([10, 220]);
  });
});

describe("draw: annotations", () => {
  function layoutWith(scale) {
    const { m, a } = sampleMap();
    a.tags = ["lift"]; a.region = "hub"; a.name = "Hub";
    return computeLayout(m, { cx: 0, cy: 0, scale });
  }

  it("tints region cells, draws glyphs, and names rooms at the large zooms", () => {
    const ctx = recordingCtx();
    draw(ctx, layoutWith(NAME_LABEL_MIN_SCALE), { roomSize: 22 });
    const tint = ctx.calls.find((c) => c[0] === "fillRect" && String(c[1]).startsWith("hsla"));
    expect(tint.slice(2, 6)).toEqual([-22, -22, 44, 44]);
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
    const layout = { rooms: [], exits: [], tints: [], scale: 40, regions: [
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
