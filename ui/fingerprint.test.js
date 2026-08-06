import { describe, it, expect } from "vitest";
import {
  normalizeName, parseExitList, hashString, fingerprint, inferLinePattern,
  suggestNamePattern, suggestExitsPattern,
} from "./fingerprint.js";

describe("normalizeName", () => {
  it("lowercases, collapses whitespace, and trims", () => {
    expect(normalizeName("  The   Town   Square ")).toBe("the town square");
  });
  it("strips trailing sentence punctuation", () => {
    expect(normalizeName("A dark alley.")).toBe("a dark alley");
    expect(normalizeName("Where now?!")).toBe("where now");
  });
  it("is stable across cosmetic reprints", () => {
    expect(normalizeName("The Bridge")).toBe(normalizeName("the  bridge"));
  });
  it("handles null/empty", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("")).toBe("");
  });
});

describe("parseExitList", () => {
  it("parses comma + 'and' separated full words", () => {
    expect(parseExitList("north, east and up")).toEqual(["e", "n", "u"]);
  });
  it("parses space-separated abbreviations", () => {
    expect(parseExitList("n e u")).toEqual(["e", "n", "u"]);
  });
  it("does not eat 'northeast' as north+east", () => {
    expect(parseExitList("northeast, south")).toEqual(["ne", "s"]);
  });
  it("de-duplicates and sorts", () => {
    expect(parseExitList("east, e, EAST")).toEqual(["e"]);
  });
  it("keeps unrecognized special exits (lowercased)", () => {
    expect(parseExitList("north, enter, portal")).toEqual(["enter", "n", "portal"]);
  });
  it("strips trailing/surrounding punctuation from tokens", () => {
    expect(parseExitList("north, east.")).toEqual(["e", "n"]);
    expect(parseExitList("(north) (up)")).toEqual(["n", "u"]);
  });
  it("handles empty", () => {
    expect(parseExitList("")).toEqual([]);
    expect(parseExitList(null)).toEqual([]);
  });
});

describe("hashString", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("differs for different input", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("fingerprint", () => {
  it("prefixes fp: and is stable for equivalent rooms", () => {
    const a = fingerprint({ name: "The Square", exits: "north, east" });
    const b = fingerprint({ name: "the  square", exits: "e n" });
    expect(a).toBe(b);
    expect(a.startsWith("fp:")).toBe(true);
  });
  it("differs when exits differ", () => {
    expect(fingerprint({ name: "Hall", exits: "n" }))
      .not.toBe(fingerprint({ name: "Hall", exits: "n s" }));
  });
  it("differs when name differs", () => {
    expect(fingerprint({ name: "Hall A", exits: "n" }))
      .not.toBe(fingerprint({ name: "Hall B", exits: "n" }));
  });
  it("folds terrain in when present", () => {
    expect(fingerprint({ name: "Path", exits: "n", terrain: "forest" }))
      .not.toBe(fingerprint({ name: "Path", exits: "n", terrain: "city" }));
    // absent terrain must not equal terrain === "" being distinct from a value
    expect(fingerprint({ name: "Path", exits: "n" }))
      .toBe(fingerprint({ name: "Path", exits: "n", terrain: "" }));
  });
  it("accepts a pre-parsed exits array", () => {
    expect(fingerprint({ name: "Hall", exits: ["e", "n"] }))
      .toBe(fingerprint({ name: "Hall", exits: "north, east" }));
  });
});

describe("inferLinePattern", () => {
  it("captures the variable span with escaped literals", () => {
    const p = inferLinePattern("Obvious exits: north, east.", "north, east");
    expect(p).toBe("^Obvious exits: (.+?)\\.$");
    const m = "Obvious exits: south and up.".match(new RegExp(p));
    expect(m[1]).toBe("south and up");
  });
  it("handles a whole-line room name", () => {
    const p = inferLinePattern("The Town Square", "The Town Square");
    expect(p).toBe("^(.+?)$");
  });
  it("returns null when the variable is absent", () => {
    expect(inferLinePattern("Hello there", "goodbye")).toBeNull();
    expect(inferLinePattern("Hello", "")).toBeNull();
  });
});

describe("suggestNamePattern", () => {
  it("tightens a bracketed title to its border", () => {
    const p = suggestNamePattern("[ The Town Square ]");
    expect(p).toBe("^\\[ (.+?) \\]$");
    expect("[ A Dark Cave ]".match(new RegExp(p))[1]).toBe("A Dark Cave");
  });
  it("falls back to whole-line for a bare title", () => {
    const p = suggestNamePattern("The Town Square");
    expect("Another Room".match(new RegExp(p))[1]).toBe("Another Room");
  });
});

describe("suggestExitsPattern", () => {
  it("anchors on the label and drops trailing punctuation", () => {
    const p = suggestExitsPattern("Obvious exits: north, east.");
    expect(p).toBe("^Obvious exits: (.+?)\\.$");
    expect("Obvious exits: south, up.".match(new RegExp(p))[1]).toBe("south, up");
  });
  it("handles a label without trailing punctuation", () => {
    const p = suggestExitsPattern("Exits: north");
    expect("Exits: south and west".match(new RegExp(p))[1]).toBe("south and west");
  });
});
