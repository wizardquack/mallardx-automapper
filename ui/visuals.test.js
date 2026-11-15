// 0.12.0's richer visuals, end to end through the hand-off: a frame as the
// Lua adapter posts it → seenFromFrame → the graph → save and load.
import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey, getArea, toJSON, fromJSON, setTagDefs } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { importChart } from "./chart.js";
import { seenFromFrame, tagDefsFromFrame, validGlyph } from "./seen.js";
import { regionName, areaRegionColor, areaRegionType, legendModel, regionColor, tooltipSpec } from "./annotate.js";
import { computeLayout } from "./render.js";

const frame = (key, extra = {}) => ({ key, name: key, env: "road", areaField: "area", areaTag: "town", ...extra });
const see = (m, f, dir = null) => resolveRoomSeen(m, seenFromFrame(f), dir);

describe("seenFromFrame: 0.12.0 fields", () => {
  it("carries elevation, lat/lon and regionColor, and drops bad ones", () => {
    const s = seenFromFrame(frame("a", { elevation: -4.5, lat: 34.1, lon: -5.4, regionColor: "AABBCC" }));
    expect(s).toMatchObject({ elevation: -4.5, lat: 34.1, lon: -5.4, regionColor: "#aabbcc" });
    const bad = seenFromFrame(frame("a", { elevation: "4", lat: NaN, lon: null, regionColor: "#abc" }));
    expect(bad.elevation).toBeUndefined();
    expect(bad.lat).toBeUndefined();
    expect(bad.lon).toBeUndefined();
    expect(bad.regionColor).toBeUndefined();
  });
});

describe("elevation and lat/lon on rooms", () => {
  it("are stored, kept by a frame without them, and replaced by a new one", () => {
    const m = createMap();
    see(m, frame("a", { elevation: 412.4, lat: 1.5, lon: 2.5 }));
    const a = getRoomByKey(m, "a");
    expect(a).toMatchObject({ elevation: 412.4, lat: 1.5, lon: 2.5 });
    expect(a.coords.z).toBe(0);   // not a floor
    see(m, frame("a"));
    expect(a.elevation).toBe(412.4);
    see(m, frame("a", { elevation: 0 }));
    expect(a.elevation).toBe(0);
  });
});

describe("region colours", () => {
  it("are kept with the area's regions, the latest winning", () => {
    const m = createMap();
    see(m, frame("a", { region: "docks", regionName: "the Docks", regionColor: "#102030" }));
    const area = getArea(m, getRoomByKey(m, "a").areaId);
    expect(area.regions).toEqual({ docks: "the Docks" });
    expect(area.regionColors).toEqual({ docks: "#102030" });
    see(m, frame("b", { region: "docks", regionColor: "405060" }), "e");
    expect(area.regionColors.docks).toBe("#405060");
    // A frame naming the region without a colour leaves it be.
    see(m, frame("c", { region: "docks" }), "e");
    expect(area.regionColors.docks).toBe("#405060");
  });

  it("an old saved map (regions as names, no colours) loads and falls back to the hashed hue", () => {
    const m = createMap();
    see(m, frame("a", { region: "docks", regionName: "the Docks" }));
    const old = JSON.parse(toJSON(m));
    for (const id of Object.keys(old.areas)) delete old.areas[id].regionColors;
    delete old.tagDefs;
    const loaded = fromJSON(JSON.stringify(old));
    const a = getRoomByKey(loaded, "a");
    expect(regionName(loaded, a)).toBe("the Docks");
    expect(areaRegionColor(loaded, a.areaId, "docks")).toBe(null);
    expect(legendModel(loaded, [a]).regions).toEqual([{ name: "the Docks", color: regionColor("docks") }]);
    expect(loaded.tagDefs).toEqual([]);
    // And takes a colour once the server sends one.
    see(loaded, frame("a", { region: "docks", regionColor: "#102030" }));
    expect(areaRegionColor(loaded, a.areaId, "docks")).toBe("#102030");
  });

  it("survive save and load", () => {
    const m = createMap();
    see(m, frame("a", { region: "docks", regionColor: "#102030" }));
    const loaded = fromJSON(toJSON(m));
    const a = getRoomByKey(loaded, "a");
    expect(areaRegionColor(loaded, a.areaId, "docks")).toBe("#102030");
  });
});

describe("region types (0.13.1)", () => {
  it("reads land and district, unknown as district, absent as unsent", () => {
    expect(seenFromFrame(frame("a", { regionType: "land" })).regionType).toBe("land");
    expect(seenFromFrame(frame("a", { regionType: "LAND" })).regionType).toBe("land");
    expect(seenFromFrame(frame("a", { regionType: "district" })).regionType).toBe("district");
    expect(seenFromFrame(frame("a", { regionType: "moor" })).regionType).toBe("district");
    expect(seenFromFrame(frame("a", {})).regionType).toBeUndefined();
    expect(seenFromFrame(frame("a", { regionType: null })).regionType).toBeUndefined();
  });

  it("are kept with the area's regions, the latest sent winning", () => {
    const m = createMap();
    see(m, frame("a", { region: "downs", regionName: "the Downs", regionType: "land" }));
    const a = getRoomByKey(m, "a");
    expect(areaRegionType(m, a.areaId, "downs")).toBe("land");
    // Not sent: left alone.
    see(m, frame("b", { region: "downs" }), "e");
    expect(areaRegionType(m, a.areaId, "downs")).toBe("land");
    // A district (or anything unknown) turns it back.
    see(m, frame("c", { region: "downs", regionType: "moor" }), "e");
    expect(areaRegionType(m, a.areaId, "downs")).toBe("district");
    see(m, frame("c", { region: "downs", regionType: "land" }));
    expect(fromJSON(toJSON(m)).areas[a.areaId].regionTypes).toEqual({ downs: "land" });
  });

  it("an old saved map (no regionTypes) loads with every region a district", () => {
    const m = createMap();
    see(m, frame("a", { region: "docks" }));
    const old = JSON.parse(toJSON(m));
    for (const id of Object.keys(old.areas)) delete old.areas[id].regionTypes;
    const loaded = fromJSON(JSON.stringify(old));
    const a = getRoomByKey(loaded, "a");
    expect(areaRegionType(loaded, a.areaId, "docks")).toBe("district");
    expect(computeLayout(loaded, { cx: 0, cy: 0, scale: 40 }).patches.length).toBe(1);
  });

  it("a land region is labelled, hovered and listed but gets no patch or swatch", () => {
    const m = createMap();
    see(m, frame("a", { coords: { x: 0, y: 0, z: 0 }, region: "downs", regionName: "the Downs", regionType: "land", regionColor: "#102030" }));
    see(m, frame("b", { coords: { x: 1, y: 0, z: 0 }, region: "docks", regionName: "the Docks" }), "e");
    const a = getRoomByKey(m, "a");
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40, anchorId: a.id });
    expect(L.patches.map((p) => p.region)).toEqual(["docks"]);
    expect(L.regions.map((g) => g.name).sort()).toEqual(["the Docks", "the Downs"]);
    expect(legendModel(m, [a, getRoomByKey(m, "b")]).regions).toEqual([
      { name: "the Docks", color: regionColor("docks") },
      { name: "the Downs", color: null },
    ]);
    expect(tooltipSpec(m, a).rows).toContainEqual({ label: "Region", value: "the Downs" });
  });
});

describe("exit styles", () => {
  const exits = (list) => list.map(([dir, toKey, style]) => ({ dir, toKey, ...(style ? { style } : {}) }));

  it("are stored per exit, path and unknown ones left off, and survive save and load", () => {
    const m = createMap();
    see(m, frame("a", { exits: exits([["e", "b", "road"], ["w", "c", "path"], ["n", "d", "motorway"], ["s", null, "climb"]]) }));
    const a = getRoomByKey(m, "a");
    expect(a.exitStyles).toEqual({ e: "road", s: "climb" });
    expect(getRoomByKey(fromJSON(toJSON(m)), "a").exitStyles).toEqual({ e: "road", s: "climb" });
  });

  it("are replaced on each report, and cleared when none is styled", () => {
    const m = createMap();
    see(m, frame("a", { exits: exits([["e", "b", "road"]]) }));
    see(m, frame("a", { exits: exits([["e", "b", "trail"]]) }));
    expect(getRoomByKey(m, "a").exitStyles).toEqual({ e: "trail" });
    see(m, frame("a", { exits: exits([["e", "b"]]) }));
    expect(getRoomByKey(m, "a").exitStyles).toBeUndefined();
  });

  it("draw a walked edge in the stronger style of its ends", () => {
    const m = createMap();
    see(m, frame("a", { coords: { x: 0, y: 0, z: 0 }, exits: exits([["e", "b", "road"]]) }));
    see(m, frame("b", { coords: { x: 1, y: 0, z: 0 }, exits: exits([["w", "a", "climb"]]) }), "e");
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40 });
    expect(L.exits).toHaveLength(1);
    expect(L.exits[0].style).toBe("climb");
  });
});

describe("charts carry the new fields", () => {
  it("elevation, lat/lon, region colour and exit styles", () => {
    const m = createMap();
    const rooms = [
      frame("r1", { coords: { x: 0, y: 0, z: 0 }, elevation: 30, lat: 1, lon: 2, region: "q", regionColor: "#0a0b0c",
        exits: [{ dir: "e", toKey: "r2", style: "trail" }] }),
      frame("r2", { coords: { x: 1, y: 0, z: 0 }, elevation: 90, exits: [{ dir: "w", toKey: "r1" }] }),
    ].map(seenFromFrame);
    importChart(m, rooms, {});
    const r1 = getRoomByKey(m, "r1");
    expect(r1).toMatchObject({ elevation: 30, lat: 1, lon: 2, exitStyles: { e: "trail" } });
    expect(areaRegionColor(m, r1.areaId, "q")).toBe("#0a0b0c");
    const L = computeLayout(m, { cx: 0, cy: 0, scale: 40, areaId: r1.areaId });
    expect(L.elevation).toEqual({ min: 30, max: 90 });
    expect(L.exits[0].style).toBe("trail");
  });
});

describe("tag definitions (mudstd.room.tags)", () => {
  it("are read in order, with bad glyphs dropped and repeats skipped", () => {
    const defs = tagDefsFromFrame({ list: [
      { id: "smithy", label: "Smithy", glyph: "S" },
      { id: "well" },
      { id: "smithy", label: "again", glyph: "X" },
      { id: "anchor", label: "Anchorage", glyph: "⚓" },
      { label: "no id" },
    ] });
    expect(defs).toEqual([
      { id: "smithy", label: "Smithy", glyph: "S" },
      { id: "well", label: "well", glyph: null },
      { id: "anchor", label: "Anchorage", glyph: null },
    ]);
    expect(tagDefsFromFrame(null)).toEqual([]);
  });

  it("are kept with the map across save and load", () => {
    const m = createMap();
    setTagDefs(m, [{ id: "smithy", label: "Smithy", glyph: "S" }]);
    expect(fromJSON(toJSON(m)).tagDefs).toEqual([{ id: "smithy", label: "Smithy", glyph: "S" }]);
  });
});

describe("validGlyph", () => {
  it("takes one or two text characters", () => {
    expect(validGlyph("$")).toBe("$");
    expect(validGlyph("Ab")).toBe("Ab");
    expect(validGlyph("★")).toBe("★");
    expect(validGlyph("𝔄")).toBe("𝔄");   // astral, one character, not emoji
    expect(validGlyph("✉︎")).toBe("✉");   // a text selector is dropped, not counted
  });
  it("turns away emoji, whitespace, controls and the wrong length", () => {
    for (const g of ["⚓", "🏠", "⚡", "✉️", "👍🏽", "", " ", "a b", "\n", "abc", 5, null]) {
      expect(validGlyph(g)).toBe(null);
    }
  });
});
