import { describe, it, expect } from "vitest";
import { createMap, addArea, addRoom, getArea } from "./graph.js";
import { resolveArea } from "./area.js";

const cfg = { strategy: "auto", overworld: "outside" };

describe("resolveArea", () => {
  it("zone: distinct zone-field values get distinct areas; same value reuses", () => {
    const m = createMap();
    const a = resolveArea(m, { name: "R1", areaTag: "Newton", areaField: "area" }, null, cfg);
    const b = resolveArea(m, { name: "R2", areaTag: "Ankh", areaField: "area" }, null, cfg);
    const aAgain = resolveArea(m, { name: "R3", areaTag: "Newton", areaField: "area" }, null, cfg);
    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);
    expect(getArea(m, a).label).toBe("Newton");
  });

  it("auto infers zone from zone/area/domain fields", () => {
    const m = createMap();
    const byZone = resolveArea(m, { name: "R", areaTag: "Z", areaField: "zone" }, null, cfg);
    const byDomain = resolveArea(m, { name: "R", areaTag: "D", areaField: "domain" }, null, cfg);
    expect(getArea(m, byZone).label).toBe("Z");
    expect(getArea(m, byDomain).label).toBe("D");
  });

  it("boundary: overworld value maps to one shared area", () => {
    const m = createMap();
    const a = resolveArea(m, { name: "Street", areaTag: "outside", areaField: "kind" }, null, cfg);
    // simulate having walked; prev is an outside room in area `a`
    const prev = addRoom(m, { key: "P", name: "Street", areaId: a });
    const b = resolveArea(m, { name: "Road", areaTag: "outside", areaField: "kind" }, prev, cfg);
    expect(b).toBe(a);
    expect(getArea(m, a).label).toBe("Overworld");
  });

  it("boundary: entering a non-overworld value from overworld opens a new interior", () => {
    const m = createMap();
    const over = resolveArea(m, { name: "Street", areaTag: "outside", areaField: "kind" }, null, cfg);
    const prevOutside = addRoom(m, { key: "P", name: "Street", areaId: over });
    const inside = resolveArea(m, { name: "Guild Hall", areaTag: "inside", areaField: "kind" }, prevOutside, cfg);
    expect(inside).not.toBe(over);
    expect(getArea(m, inside).label).toBe("Guild Hall");
  });

  it("boundary: contiguous interior run stays in the same interior area", () => {
    const m = createMap();
    const over = resolveArea(m, { name: "Street", areaTag: "outside", areaField: "kind" }, null, cfg);
    const pOut = addRoom(m, { key: "P", name: "Street", areaId: over });
    const inside = resolveArea(m, { name: "Hall", areaTag: "inside", areaField: "kind" }, pOut, cfg);
    const pIn = addRoom(m, { key: "H", name: "Hall", areaId: inside });
    const inside2 = resolveArea(m, { name: "Kitchen", areaTag: "inside", areaField: "kind" }, pIn, cfg);
    expect(inside2).toBe(inside);
  });

  it("fallback: no tag puts everything in a single default area", () => {
    const m = createMap();
    const a = resolveArea(m, { name: "R1" }, null, cfg);
    const first = addRoom(m, { key: "R1", name: "R1", areaId: a });
    const b = resolveArea(m, { name: "R2" }, first, cfg);
    expect(b).toBe(a);
    expect(getArea(m, a).label).toBe("Map");
  });
});
