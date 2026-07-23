// ui/edits.test.js
import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, getRoom } from "./graph.js";
import { renameRoom, deleteRoom } from "./edits.js";

describe("renameRoom", () => {
  it("renames an existing room and returns true", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "Old" });
    expect(renameRoom(m, r.id, "New")).toBe(true);
    expect(getRoom(m, r.id).name).toBe("New");
  });
  it("returns false for a missing room", () => {
    const m = createMap();
    expect(renameRoom(m, "999", "X")).toBe(false);
  });
});

describe("deleteRoom", () => {
  it("removes the room and its key index entry", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "R" });
    expect(deleteRoom(m, r.id)).toBe(true);
    expect(getRoom(m, r.id)).toBeNull();
    expect(m.keyIndex["k"]).toBeUndefined();
  });
  it("scrubs inbound exits from other rooms", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    linkExit(m, a.id, "e", b.id);
    linkExit(m, b.id, "w", a.id);
    deleteRoom(m, b.id);
    expect(m.rooms[a.id].exits["e"]).toBeUndefined();
  });
  it("clears currentId when the current room is deleted", () => {
    const m = createMap();
    const r = addRoom(m, { key: "k", name: "R" });
    setCurrent(m, r.id);
    deleteRoom(m, r.id);
    expect(m.currentId).toBeNull();
  });
  it("returns false for a missing room", () => {
    const m = createMap();
    expect(deleteRoom(m, "999")).toBe(false);
  });
});
