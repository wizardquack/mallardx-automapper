import { describe, it, expect } from "vitest";
import { createMap, addRoom, addArea, setTerrains } from "./graph.js";
import {
  fillColor, builtinTerrainColor, envColor, terrainLabel, roomGlyph, glyphForTag, tagWord,
  regionColor, regionName, inkOn, parseColor, legendModel, tooltipSpec,
} from "./annotate.js";

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
      { glyph: "⚑", tags: ["berth", "dock"] },
      { glyph: "ϟ", tags: ["charger"] },
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
