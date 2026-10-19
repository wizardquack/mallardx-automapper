import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { seenFromFrame } from "./seen.js";

describe("seenFromFrame", () => {
  it("rejects a frame without a key", () => {
    expect(seenFromFrame(null)).toBeNull();
    expect(seenFromFrame({ name: "X" })).toBeNull();
  });

  it("carries the room fields through", () => {
    const s = seenFromFrame({ key: "A", name: "Hall", env: "inside", areaTag: "z", areaField: "area" });
    expect(s).toMatchObject({ key: "A", name: "Hall", env: "inside", areaTag: "z", areaField: "area" });
    expect(s.exits).toBeUndefined();
  });

  it("forwards mudstd exits so known neighbours get linked", () => {
    const frame = { key: "A", name: "West", exits: [{ dir: "e", toKey: "B" }] };
    expect(seenFromFrame(frame).exits).toEqual([{ dir: "e", toKey: "B" }]);

    const m = createMap();
    resolveRoomSeen(m, seenFromFrame({ key: "B", name: "East" }), null);
    const { room: a } = resolveRoomSeen(m, seenFromFrame(frame), null);
    expect(a.exits.e).toEqual({ to: getRoomByKey(m, "B").id });
  });
});

describe("seenFromFrame coords", () => {
  it("passes valid coords, defaults z, and drops malformed ones", () => {
    expect(seenFromFrame({ key: "A", coords: { x: 1, y: 2, z: 3 } }).coords).toEqual({ x: 1, y: 2, z: 3 });
    expect(seenFromFrame({ key: "A", coords: { x: 1, y: 2 } }).coords).toEqual({ x: 1, y: 2, z: 0 });
    expect(seenFromFrame({ key: "A", coords: { x: "1", y: 2 } }).coords).toBeUndefined();
    expect(seenFromFrame({ key: "A", coords: null }).coords).toBeUndefined();
    expect(seenFromFrame({ key: "A" }).coords).toBeUndefined();
  });
});

describe("seenFromFrame areaName", () => {
  it("passes a non-empty areaName through", () => {
    expect(seenFromFrame({ key: "A", areaTag: "tiss", areaName: "T.I.S.S." }).areaName).toBe("T.I.S.S.");
    expect(seenFromFrame({ key: "A", areaName: "" }).areaName).toBeUndefined();
    expect(seenFromFrame({ key: "A" }).areaName).toBeUndefined();
  });
});
