import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { seenFromFrame, terrainsFromFrame } from "./seen.js";

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

describe("seenFromFrame: annotations", () => {
  it("carries tags, region and regionName", () => {
    const s = seenFromFrame({ key: "A", tags: ["market", 3, ""], region: "concourse", regionName: "the Concourse" });
    expect(s.tags).toEqual(["market"]);
    expect(s.region).toBe("concourse");
    expect(s.regionName).toBe("the Concourse");
  });

  it("reads an empty Lua list ({}) as no tags, and absent as unknown", () => {
    expect(seenFromFrame({ key: "A", tags: {} }).tags).toEqual([]);
    expect(seenFromFrame({ key: "A" }).tags).toBeUndefined();
    expect(seenFromFrame({ key: "A", region: "" }).region).toBeUndefined();
  });

  it("tags and region reach the graph", () => {
    const m = createMap();
    resolveRoomSeen(m, seenFromFrame({ key: "A", areaTag: "tiss", areaField: "area", tags: ["lift"], region: "hub", regionName: "the Hub" }), null);
    const r = getRoomByKey(m, "A");
    expect(r.tags).toEqual(["lift"]);
    expect(r.region).toBe("hub");
    expect(m.areas[r.areaId].regions).toEqual({ hub: "the Hub" });
  });
});

describe("terrainsFromFrame", () => {
  it("keys definitions by id and drops malformed ones", () => {
    expect(terrainsFromFrame({ list: [
      { id: "city", label: "City", color: "#C0C0C0" },
      { id: "forest", color: "green" },
      { label: "no id" },
      null,
    ] })).toEqual({
      city: { label: "City", color: "#c0c0c0" },
      forest: { label: "forest", color: null },
    });
    expect(terrainsFromFrame(null)).toEqual({});
    expect(terrainsFromFrame({ list: {} })).toEqual({});
  });
});
