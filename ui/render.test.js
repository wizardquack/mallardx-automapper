import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, addArea } from "./graph.js";
import { computeLayout, envColor } from "./render.js";

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
    expect(layout.exits).toContainEqual({ x1: 100, y1: 100, x2: 100, y2: 60 });
  });

  it("returns empty layout with no current room", () => {
    const m = createMap();
    expect(computeLayout(m, { cx: 0, cy: 0, scale: 40 })).toEqual({ rooms: [], exits: [] });
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
