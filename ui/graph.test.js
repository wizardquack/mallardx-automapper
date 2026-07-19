import { describe, it, expect } from "vitest";
import {
  createMap, addRoom, getRoom, getRoomByKey, linkExit,
  setCurrent, currentRoom, toJSON, fromJSON,
} from "./graph.js";

describe("graph", () => {
  it("creates an empty map", () => {
    const m = createMap();
    expect(m.version).toBe(1);
    expect(m.rooms).toEqual({});
    expect(m.currentId).toBeNull();
  });

  it("adds rooms with unique ids and key index, defaulting coords", () => {
    const m = createMap();
    const a = addRoom(m, { key: "K1", name: "Foo", env: "city" });
    const b = addRoom(m, { key: "K2", name: "Bar", env: "forest", coords: { x: 1, y: 0, z: 0 } });
    expect(a.id).not.toBe(b.id);
    expect(a.coords).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.coords).toEqual({ x: 1, y: 0, z: 0 });
    expect(getRoom(m, a.id)).toBe(a);
    expect(getRoomByKey(m, "K2")).toBe(b);
    expect(getRoomByKey(m, "nope")).toBeNull();
  });

  it("links exits and sets current", () => {
    const m = createMap();
    const a = addRoom(m, { key: "K1", name: "A", env: "city" });
    const b = addRoom(m, { key: "K2", name: "B", env: "city" });
    linkExit(m, a.id, "n", b.id);
    expect(a.exits.n).toEqual({ to: b.id });
    setCurrent(m, b.id);
    expect(currentRoom(m)).toBe(b);
  });

  it("round-trips through JSON", () => {
    const m = createMap();
    const a = addRoom(m, { key: "K1", name: "A", env: "city" });
    const b = addRoom(m, { key: "K2", name: "B", env: "city" });
    linkExit(m, a.id, "n", b.id);
    setCurrent(m, a.id);
    const restored = fromJSON(toJSON(m));
    expect(restored.currentId).toBe(a.id);
    expect(getRoomByKey(restored, "K2").name).toBe("B");
    expect(getRoom(restored, a.id).exits.n).toEqual({ to: b.id });
  });

  it("returns a fresh map on bad or version-mismatched JSON", () => {
    expect(fromJSON("not json").version).toBe(1);
    expect(fromJSON("not json").rooms).toEqual({});
    expect(fromJSON(JSON.stringify({ version: 999 })).rooms).toEqual({});
  });
});
