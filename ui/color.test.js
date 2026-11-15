import { describe, it, expect } from "vitest";
import { rgbOf, hexColor } from "./color.js";

describe("rgbOf", () => {
  it("reads #rrggbb and rrggbb", () => {
    expect(rgbOf("#ff8000")).toEqual([255, 128, 0]);
    expect(rgbOf("00FF7f")).toEqual([0, 255, 127]);
  });
  it("is null for anything else", () => {
    for (const v of [null, undefined, "", "#fff", "red", "#ff80001", "rgba(0,0,0,1)"]) expect(rgbOf(v)).toBeNull();
  });
});

describe("hexColor", () => {
  it("normalises to lower-case #rrggbb", () => {
    expect(hexColor("AABBCC")).toBe("#aabbcc");
    expect(hexColor("#AaBbCc")).toBe("#aabbcc");
  });
  it("is null for anything else", () => {
    for (const v of [null, 12, "#abc", "blue"]) expect(hexColor(v)).toBeNull();
  });
});
