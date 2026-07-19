import { describe, it, expect } from "vitest";
import { DIRECTIONS, vector, reverse, isDirection } from "./directions.js";

describe("directions", () => {
  it("has 10 canonical directions", () => {
    expect(DIRECTIONS).toEqual(["n", "s", "e", "w", "ne", "nw", "se", "sw", "u", "d"]);
  });

  it("maps cardinal vectors (north = -y, east = +x)", () => {
    expect(vector("n")).toEqual({ dx: 0, dy: -1, dz: 0 });
    expect(vector("s")).toEqual({ dx: 0, dy: 1, dz: 0 });
    expect(vector("e")).toEqual({ dx: 1, dy: 0, dz: 0 });
    expect(vector("w")).toEqual({ dx: -1, dy: 0, dz: 0 });
  });

  it("maps diagonal and vertical vectors", () => {
    expect(vector("ne")).toEqual({ dx: 1, dy: -1, dz: 0 });
    expect(vector("sw")).toEqual({ dx: -1, dy: 1, dz: 0 });
    expect(vector("u")).toEqual({ dx: 0, dy: 0, dz: 1 });
    expect(vector("d")).toEqual({ dx: 0, dy: 0, dz: -1 });
  });

  it("returns null for unknown vector", () => {
    expect(vector("enter")).toBeNull();
  });

  it("reverses directions", () => {
    expect(reverse("n")).toBe("s");
    expect(reverse("sw")).toBe("ne");
    expect(reverse("u")).toBe("d");
    expect(reverse("enter")).toBeNull();
  });

  it("recognizes directions", () => {
    expect(isDirection("ne")).toBe(true);
    expect(isDirection("enter")).toBe(false);
  });
});
