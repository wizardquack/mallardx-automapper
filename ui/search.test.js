import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit } from "./graph.js";
import { matchRooms, resolveDestination } from "./search.js";

describe("matchRooms", () => {
  it("substring, case-insensitive over names", () => {
    const m = createMap();
    addRoom(m, { key: "a", name: "The Dark Alley" });
    addRoom(m, { key: "b", name: "Market Square" });
    expect(matchRooms(m, "dark").map((r) => r.key)).toEqual(["a"]);
    expect(matchRooms(m, "MARKET").map((r) => r.key)).toEqual(["b"]);
    expect(matchRooms(m, "")).toEqual([]);
  });
});

describe("resolveDestination", () => {
  it("resolves an exact room id (and a #-prefixed id) without matching names", () => {
    const m = createMap();
    const r = addRoom(m, { key: "a", name: "Alley" });
    expect(resolveDestination(m, r.id, r.id)).toEqual({ roomId: r.id, candidates: [] });
    expect(resolveDestination(m, r.id, "#" + r.id)).toEqual({ roomId: r.id, candidates: [] });
  });

  it("resolves a unique substring match", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "Guild Hall" });
    expect(resolveDestination(m, a.id, "guild").roomId).toBe(a.id);
  });

  it("picks the nearest of several matches", () => {
    const m = createMap();
    const start = addRoom(m, { key: "s", name: "Start" });
    const near = addRoom(m, { key: "n", name: "A dark alley" });
    const far = addRoom(m, { key: "f", name: "A dark alley" });
    linkExit(m, start.id, "e", near.id); linkExit(m, near.id, "w", start.id);
    linkExit(m, near.id, "e", far.id); linkExit(m, far.id, "w", near.id);
    const res = resolveDestination(m, start.id, "dark alley");
    expect(res.roomId).toBe(near.id);
    expect(res.candidates.length).toBe(2);
  });

  it("returns null + candidates on a nearest-distance tie", () => {
    const m = createMap();
    const start = addRoom(m, { key: "s", name: "Start" });
    const l = addRoom(m, { key: "l", name: "A dark alley" });
    const r = addRoom(m, { key: "r", name: "A dark alley" });
    linkExit(m, start.id, "w", l.id); linkExit(m, l.id, "e", start.id);
    linkExit(m, start.id, "e", r.id); linkExit(m, r.id, "w", start.id);
    const res = resolveDestination(m, start.id, "dark alley");
    expect(res.roomId).toBeNull();
    expect(res.candidates.length).toBe(2);
  });

  it("returns null + candidates when no match is reachable", () => {
    const m = createMap();
    const start = addRoom(m, { key: "s", name: "Start" });
    addRoom(m, { key: "i1", name: "Island alley" });
    addRoom(m, { key: "i2", name: "Island alley" });
    const res = resolveDestination(m, start.id, "island");
    expect(res.roomId).toBeNull();
    expect(res.candidates.length).toBe(2);
  });

  it("no match → null and empty candidates", () => {
    const m = createMap();
    const s = addRoom(m, { key: "a", name: "Alley" });
    expect(resolveDestination(m, s.id, "nowhere")).toEqual({ roomId: null, candidates: [] });
  });
});

describe("matchRooms: notes and tags", () => {
  it("finds rooms by a tag or a word of their note", () => {
    const m = createMap();
    const hall = addRoom(m, { key: "h", name: "Market Hall" });
    hall.tags = ["market"];
    const bay = addRoom(m, { key: "b", name: "Outfitter's Bay" });
    bay.tags = ["outfitter"]; bay.note = "sells mining lasers";
    expect(matchRooms(m, "outfit").map((r) => r.id)).toEqual([bay.id]);
    expect(matchRooms(m, "LASER").map((r) => r.id)).toEqual([bay.id]);
    expect(matchRooms(m, "market").map((r) => r.id)).toEqual([hall.id]);
  });
});
