import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent } from "./graph.js";
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
});
