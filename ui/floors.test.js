import { describe, it, expect } from "vitest";
import { createMap, addRoom, addArea, linkExit, setCurrent } from "./graph.js";
import { floorNeighbours, floorMarks } from "./floors.js";
import { computeLayout } from "./render.js";
import { tooltipSpec } from "./annotate.js";
import { roomMenuModel } from "./editmenu.js";

function stairs() {
  const m = createMap();
  const a = addArea(m, { key: "k", label: "K" });
  const hall = addRoom(m, { key: "H", name: "Hall", areaId: a.id, coords: { x: 0, y: 0, z: 0 } });
  const loft = addRoom(m, { key: "L", name: "Loft", areaId: a.id, coords: { x: 0, y: 0, z: 1 } });
  const cellar = addRoom(m, { key: "C", name: "Cellar", areaId: a.id, coords: { x: 0, y: 0, z: -1 } });
  linkExit(m, hall.id, "u", loft.id);
  linkExit(m, hall.id, "d", cellar.id);
  linkExit(m, loft.id, "d", hall.id);
  setCurrent(m, hall.id);
  return { m, a, hall, loft, cellar };
}

describe("floorNeighbours", () => {
  it("finds the rooms u and d lead to", () => {
    const { m, hall, loft, cellar } = stairs();
    expect(floorNeighbours(m, hall)).toEqual([
      { toId: loft.id, up: true },
      { toId: cellar.id, up: false },
    ]);
    expect(floorMarks(m, hall)).toEqual({ up: true, down: true });
    expect(floorMarks(m, loft)).toEqual({ up: false, down: true });
  });

  it("counts a compass exit to another z in the same area by its target's z", () => {
    const { m, a, hall } = stairs();
    const landing = addRoom(m, { key: "N", name: "Landing", areaId: a.id, coords: { x: 0, y: -1, z: 1 } });
    linkExit(m, hall.id, "n", landing.id);
    expect(floorNeighbours(m, hall)).toContainEqual({ toId: landing.id, up: true });
  });

  it("ignores a same-floor exit and a compass exit into another area", () => {
    const { m, a, hall } = stairs();
    const b = addArea(m, { key: "b", label: "B" });
    const east = addRoom(m, { key: "E", name: "East", areaId: a.id, coords: { x: 1, y: 0, z: 0 } });
    const away = addRoom(m, { key: "W", name: "Away", areaId: b.id, coords: { x: 0, y: 0, z: 4 } });
    linkExit(m, hall.id, "e", east.id);
    linkExit(m, hall.id, "w", away.id);
    expect(floorNeighbours(m, hall).map((f) => f.toId)).not.toContain(east.id);
    expect(floorNeighbours(m, hall).map((f) => f.toId)).not.toContain(away.id);
  });

  it("counts u into another area", () => {
    const m = createMap();
    const a = addArea(m, { key: "a" }), b = addArea(m, { key: "b" });
    const r = addRoom(m, { key: "R", areaId: a.id });
    const t = addRoom(m, { key: "T", areaId: b.id });
    linkExit(m, r.id, "u", t.id);
    expect(floorNeighbours(m, r)).toEqual([{ toId: t.id, up: true }]);
  });
});

describe("floors in the layout, hover card and menu", () => {
  it("marks a room that leads up or down", () => {
    const { m, hall } = stairs();
    const layout = computeLayout(m, { cx: 0, cy: 0, scale: 10 });
    expect(layout.rooms.find((r) => r.id === hall.id)).toMatchObject({ up: true, down: true });
  });

  it("names the rooms above and below on hover", () => {
    const { m, hall } = stairs();
    expect(tooltipSpec(m, hall).rows).toEqual([
      { label: "Up", value: "Loft" },
      { label: "Down", value: "Cellar" },
    ]);
  });

  it("offers to view each room on another floor", () => {
    const { m, a, hall, loft, cellar } = stairs();
    const model = roomMenuModel(m, hall.id, [{ id: a.id, label: "K" }]);
    expect(model.slice(1, 4)).toEqual([
      { label: "▲ View Loft", action: "viewRoom", arg: loft.id },
      { label: "▼ View Cellar", action: "viewRoom", arg: cellar.id },
      { separator: true },
    ]);
  });
});
