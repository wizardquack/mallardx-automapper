import { describe, it, expect } from "vitest";
import { createMap, addRoom, addArea, setTerrains } from "./graph.js";
import {
  fillColor, builtinTerrainColor, envColor, terrainLabel, roomGlyph, glyphForTag, tagWord,
  regionColor, regionName, inkOn, parseColor, legendModel, tooltipSpec,
  elevationRange, shadeAmount, shadeColor, SHADE_STRENGTH, exitStyle, strongerStyle, formatLatLon,
  areaRegionColor, tagLabel,
} from "./annotate.js";
import { setTagDefs } from "./graph.js";

describe("fillColor", () => {
  it("prefers the user's colour over everything", () => {
    const m = createMap();
    setTerrains(m, { corridor: { label: "Corridor", color: "#112233" } });
    expect(fillColor(m, { env: "corridor", color: "#abcdef" })).toBe("#abcdef");
  });

  it("uses the server's colour for a defined terrain", () => {
    const m = createMap();
    setTerrains(m, { corridor: { label: "Corridor", color: "#112233" } });
    expect(fillColor(m, { env: "corridor" })).toBe("#112233");
  });

  it("falls back to a built-in colour by terrain word, from id or label", () => {
    const m = createMap();
    expect(fillColor(m, { env: "forest" })).toBe(builtinTerrainColor("forest"));
    setTerrains(m, { t7: { label: "Dense Forest", color: null } });
    expect(fillColor(m, { env: "t7" })).toBe(builtinTerrainColor("forest"));
  });

  it("hashes an unknown word or a numeric terrain, and greys no terrain", () => {
    const m = createMap();
    expect(fillColor(m, { env: "xyzzy" })).toBe(envColor("xyzzy"));
    expect(fillColor(m, { env: 4 })).toBe(envColor(4));
    expect(fillColor(m, { env: "" })).toBe("#888888");
    expect(fillColor(m, {})).toBe("#888888");
  });

  it("matches built-in classes in order, by whole word", () => {
    expect(builtinTerrainColor("Deep Water")).toBe(builtinTerrainColor("ocean"));
    expect(builtinTerrainColor("Deep Water")).not.toBe(builtinTerrainColor("water"));
    expect(builtinTerrainColor("Urban")).toBe(builtinTerrainColor("city"));
    expect(builtinTerrainColor("roadhouse")).toBeNull();
    expect(builtinTerrainColor("")).toBeNull();
  });
});

describe("terrainLabel", () => {
  it("is the server's label, else the id", () => {
    const m = createMap();
    setTerrains(m, { lobby: { label: "Lift lobby", color: null } });
    expect(terrainLabel(m, "lobby")).toBe("Lift lobby");
    expect(terrainLabel(m, "forest")).toBe("forest");
    expect(terrainLabel(m, "")).toBe("");
  });
});

describe("glyphs", () => {
  it("normalizes tag words", () => {
    expect(tagWord("Machines: refinery")).toBe("machines");
    expect(tagWord("post office")).toBe("post_office");
    expect(tagWord("droid-dock")).toBe("droid_dock");
  });

  it("finds a glyph for a known tag and none for an unknown one", () => {
    expect(glyphForTag("market")).toBe("$");
    expect(glyphForTag("BANK")).toBe("¤");
    expect(glyphForTag("machines: refinery")).toBe("⚒");
    expect(glyphForTag("listed")).toBeNull();
  });

  it("picks the room's glyph in table order, the user's symbol first", () => {
    expect(roomGlyph({ tags: ["charger", "lift"] })).toBe("⇅");
    expect(roomGlyph({ tags: ["listed"] })).toBeNull();
    expect(roomGlyph({})).toBeNull();
    expect(roomGlyph({ tags: ["market"], symbol: "M" })).toBe("M");
  });
});

describe("regions", () => {
  it("colours a region deterministically", () => {
    expect(regionColor("docks")).toBe(regionColor("docks"));
    expect(regionColor("docks")).not.toBe(regionColor("hub"));
    expect(regionColor("docks", 0.2)).toMatch(/^hsla\(\d+, 55%, 55%, 0.2\)$/);
  });

  it("names a region from its area, else by key", () => {
    const m = createMap();
    const a = addArea(m, { key: "tiss", label: "T.I.S.S." });
    a.regions = { docks: "the Docks" };
    expect(regionName(m, { areaId: a.id, region: "docks" })).toBe("the Docks");
    expect(regionName(m, { areaId: a.id, region: "hub" })).toBe("hub");
    expect(regionName(m, { areaId: a.id })).toBe("");
  });
});

describe("inkOn / parseColor", () => {
  it("picks black on light fills and white on dark", () => {
    expect(inkOn("#ffffff")).toBe("#000000");
    expect(inkOn("#101010")).toBe("#ffffff");
    expect(inkOn("hsla(1,1%,1%,1)")).toBe("#000000");
  });

  it("parses hex colours", () => {
    expect(parseColor("#AABBCC")).toBe("#aabbcc");
    expect(parseColor("abc")).toBe("#aabbcc");
    expect(parseColor(" 3aa8a0 ")).toBe("#3aa8a0");
    expect(parseColor("red")).toBeNull();
    expect(parseColor("")).toBeNull();
  });
});

describe("legendModel", () => {
  it("lists terrains, glyphs and regions in view, once each", () => {
    const m = createMap();
    const a = addArea(m, { key: "tiss" });
    a.regions = { docks: "the Docks" };
    setTerrains(m, { corridor: { label: "Corridor", color: "#8a909a" } });
    const rooms = [
      { env: "corridor", tags: ["charger"], region: "docks", areaId: a.id },
      { env: "corridor", tags: ["berth", "listed"], region: "docks", areaId: a.id },
      { env: "forest", tags: ["dock"], areaId: a.id },
      { env: "corridor", color: "#ff0000", symbol: "X", tags: ["market"] },
    ];
    const lm = legendModel(m, rooms);
    expect(lm.terrains).toEqual([
      { label: "Corridor", color: "#8a909a" },
      { label: "forest", color: builtinTerrainColor("forest") },
    ]);
    // ⚑ comes before ϟ in GLYPHS; market isn't listed (the room has its own symbol).
    expect(lm.glyphs).toEqual([
      { glyph: "⚑", tags: ["berth", "dock"], game: false },
      { glyph: "ϟ", tags: ["charger"], game: false },
    ]);
    expect(lm.regions).toEqual([{ name: "the Docks", color: regionColor("docks") }]);
  });
});

describe("tooltipSpec", () => {
  it("titles by name and rows the region, terrain and tags, with the note as body", () => {
    const m = createMap();
    const a = addArea(m, { key: "tiss" });
    a.regions = { concourse: "the Concourse" };
    setTerrains(m, { corridor: { label: "Corridor", color: null } });
    const r = addRoom(m, { key: "k", name: "Main Concourse", env: "corridor", areaId: a.id });
    r.region = "concourse"; r.tags = ["start", "listed"]; r.note = "Respawn here.";
    expect(tooltipSpec(m, r)).toEqual({
      title: "Main Concourse",
      rows: [
        { label: "Region", value: "the Concourse" },
        { label: "Terrain", value: "Corridor" },
        { label: "Here", value: "start, listed" },
      ],
      body: "Respawn here.",
    });
  });

  it("falls back to the id and omits empty rows", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k" });
    expect(tooltipSpec(m, r)).toEqual({ title: `#${r.id}`, rows: [] });
  });
});

describe("tooltipSpec: charted", () => {
  it("says a charted room hasn't been visited", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "Gate" });
    r.charted = true;
    expect(tooltipSpec(m, r).rows[0]).toEqual({ label: "Visited", value: "Not yet (charted)" });
  });
});

describe("roomGlyph: game tags (mudstd.room.tags)", () => {
  const defs = [
    { id: "smithy", label: "Smithy", glyph: "S" },
    { id: "well", label: "Well", glyph: null },
    { id: "shrine", label: "Shrine", glyph: "Ω" },
  ];
  it("the user's symbol beats everything", () => {
    const m = createMap(); setTagDefs(m, defs);
    expect(roomGlyph({ symbol: "X", tags: ["smithy"] }, m)).toBe("X");
  });
  it("the first game tag in the server's order with a glyph beats the built-ins", () => {
    const m = createMap(); setTagDefs(m, defs);
    // The room lists shrine first, but smithy comes first in the server's list.
    expect(roomGlyph({ tags: ["shop", "shrine", "smithy"] }, m)).toBe("S");
    expect(roomGlyph({ tags: ["shop", "shrine"] }, m)).toBe("Ω");
  });
  it("a game tag without a glyph falls through to the built-ins, then none", () => {
    const m = createMap(); setTagDefs(m, defs);
    expect(roomGlyph({ tags: ["well", "bank"] }, m)).toBe("¤");
    expect(roomGlyph({ tags: ["well"] }, m)).toBe(null);
  });
  it("matches a game tag by its lookup word", () => {
    const m = createMap(); setTagDefs(m, defs);
    expect(roomGlyph({ tags: ["Smithy: dwarven"] }, m)).toBe("S");
  });
  it("without a map it's the built-ins, as before", () => {
    expect(roomGlyph({ tags: ["bank"] })).toBe("¤");
  });
});

describe("setTagDefs", () => {
  it("takes the new list's order, keeps defs it doesn't name, and says if anything changed", () => {
    const m = createMap();
    expect(setTagDefs(m, [{ id: "a", label: "A", glyph: "a" }, { id: "b", label: "B", glyph: null }])).toBe(true);
    expect(setTagDefs(m, [{ id: "a", label: "A", glyph: "a" }, { id: "b", label: "B", glyph: null }])).toBe(false);
    setTagDefs(m, [{ id: "c", label: "C", glyph: "c" }, { id: "a", label: "A2", glyph: "a" }]);
    expect(m.tagDefs.map((d) => `${d.id}:${d.label}`)).toEqual(["c:C", "a:A2", "b:B"]);
  });
});

describe("tagLabel / tooltip tags", () => {
  it("uses the game's label where defined, else the tag", () => {
    const m = createMap(); setTagDefs(m, [{ id: "smithy", label: "Smithy", glyph: "S" }]);
    expect(tagLabel(m, "smithy")).toBe("Smithy");
    expect(tagLabel(m, "bank")).toBe("bank");
    const r = addRoom(m, { key: "k", name: "Forge" });
    r.tags = ["smithy", "bank"];
    expect(tooltipSpec(m, r).rows).toContainEqual({ label: "Here", value: "Smithy, bank" });
  });
});

describe("tooltipSpec: elevation and position", () => {
  it("shows elevation rounded, and lat/lon with hemispheres", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "Pass" });
    r.elevation = 411.6; r.lat = 34.123; r.lon = -5.4;
    const rows = tooltipSpec(m, r).rows;
    expect(rows).toContainEqual({ label: "Elevation", value: "412 m" });
    expect(rows).toContainEqual({ label: "Position", value: "34.12°N 5.40°W" });
  });
  it("shows a negative elevation and leaves position out without both", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "Pit" });
    r.elevation = -3.2; r.lat = 1;
    const rows = tooltipSpec(m, r).rows;
    expect(rows).toContainEqual({ label: "Elevation", value: "-3 m" });
    expect(rows.find((x) => x.label === "Position")).toBeUndefined();
  });
  it("formats the southern and eastern hemispheres", () => {
    expect(formatLatLon(-0.5, 120)).toBe("0.50°S 120.00°E");
    expect(formatLatLon(null, 1)).toBe("");
  });
});

describe("height shading", () => {
  it("finds the range among rooms with an elevation", () => {
    expect(elevationRange([{ elevation: 5 }, {}, { elevation: -20 }, { elevation: 300 }])).toEqual({ min: -20, max: 300 });
    expect(elevationRange([{}, { elevation: NaN }])).toBe(null);
  });
  it("maps the range to -1..1 about its middle", () => {
    const range = { min: 0, max: 400 };
    expect(shadeAmount(0, range)).toBe(-1);
    expect(shadeAmount(400, range)).toBe(1);
    expect(shadeAmount(200, range)).toBe(0);
    expect(shadeAmount(300, range)).toBe(0.5);
  });
  it("widens a nearly flat range to the minimum span", () => {
    const range = { min: 100, max: 110 };   // 10 m of relief
    expect(shadeAmount(110, range)).toBeCloseTo(0.1);
    expect(shadeAmount(100, range)).toBeCloseTo(-0.1);
    expect(shadeAmount(105, { min: 105, max: 105 })).toBe(0);
  });
  it("leaves a room with no elevation, or no range, unshaded", () => {
    expect(shadeAmount(undefined, { min: 0, max: 1000 })).toBe(0);
    expect(shadeAmount(50, null)).toBe(0);
  });
  it("lightens toward white and darkens toward black by the strength", () => {
    expect(shadeColor("#808080", 0)).toBe("#808080");
    const k = SHADE_STRENGTH;
    const up = Math.round(128 + 127 * k).toString(16), down = Math.round(128 * (1 - k)).toString(16);
    expect(shadeColor("#808080", 1)).toBe(`#${up}${up}${up}`);
    expect(shadeColor("#808080", -1)).toBe(`#${down}${down}${down}`);
    expect(shadeColor("#000000", -1)).toBe("#000000");
    expect(shadeColor("#ffffff", 1)).toBe("#ffffff");
    expect(shadeColor("hsl(1,2%,3%)", 1)).toBe("hsl(1,2%,3%)");
  });
});

describe("exit styles", () => {
  it("reads a room's exit style, path by default or for an unknown one", () => {
    expect(exitStyle({ exitStyles: { n: "road" } }, "n")).toBe("road");
    expect(exitStyle({ exitStyles: { n: "highway" } }, "n")).toBe("path");
    expect(exitStyle({}, "n")).toBe("path");
  });
  it("takes the stronger style: climb > road > trail > path", () => {
    expect(strongerStyle("path", "trail")).toBe("trail");
    expect(strongerStyle("trail", "road")).toBe("road");
    expect(strongerStyle("climb", "road")).toBe("climb");
    expect(strongerStyle("road", "climb")).toBe("climb");
    expect(strongerStyle("path", "path")).toBe("path");
  });
});

describe("region colours", () => {
  it("uses the server's colour at the given alpha, else the hashed hue", () => {
    expect(regionColor("docks", 0.18, "#102030")).toBe("rgba(16, 32, 48, 0.18)");
    expect(regionColor("docks", 0.18, null)).toBe(regionColor("docks", 0.18));
    expect(regionColor("docks", 0.18)).toMatch(/^hsla\(/);
  });
  it("reads an area's region colour, null for an old map without them", () => {
    const m = createMap();
    const a = addArea(m, { key: "t" });
    a.regions = { docks: "the Docks" };
    expect(areaRegionColor(m, a.id, "docks")).toBe(null);
    a.regionColors = { docks: "#102030" };
    expect(areaRegionColor(m, a.id, "docks")).toBe("#102030");
  });
});

describe("legendModel: game glyphs, region colours, ways", () => {
  it("lists game glyphs first with the game's label, and regions by the server's colour", () => {
    const m = createMap();
    setTagDefs(m, [{ id: "smithy", label: "Smithy", glyph: "S" }, { id: "bank", label: "Counting house", glyph: null }]);
    const a = addArea(m, { key: "t" });
    a.regions = { docks: "the Docks" }; a.regionColors = { docks: "#102030" };
    const lm = legendModel(m, [
      { tags: ["bank"], region: "docks", areaId: a.id },
      { tags: ["smithy"] },
    ]);
    expect(lm.glyphs).toEqual([
      { glyph: "S", tags: ["Smithy"], game: true },
      { glyph: "¤", tags: ["Counting house"], game: false },
    ]);
    expect(lm.regions).toEqual([{ name: "the Docks", color: regionColor("docks", 1, "#102030") }]);
  });
  it("lists the ways in view only when one isn't a plain path", () => {
    const m = createMap();
    expect(legendModel(m, [], [{}, { style: undefined }]).ways).toEqual([]);
    expect(legendModel(m, [], [{}, { style: "climb" }, { style: "road" }]).ways).toEqual([
      { style: "road", label: "Road" },
      { style: "path", label: "Path" },
      { style: "climb", label: "Climb" },
    ]);
  });
});
