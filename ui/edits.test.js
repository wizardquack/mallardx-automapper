// ui/edits.test.js
import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, getRoom } from "./graph.js";
import { renameRoom, deleteRoom, mergeRooms, addExit, deleteExit, setOneWay } from "./edits.js";

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

describe("mergeRooms", () => {
  it("unions exits with the target winning conflicts", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", name: "T" });
    const s = addRoom(m, { key: "s", name: "S" });
    const x = addRoom(m, { key: "x", name: "X" });
    const y = addRoom(m, { key: "y", name: "Y" });
    linkExit(m, t.id, "n", x.id);          // target has n
    linkExit(m, s.id, "n", y.id);          // source also has n (target wins)
    linkExit(m, s.id, "e", y.id);          // source-only e (adopted)
    mergeRooms(m, s.id, t.id);
    expect(m.rooms[t.id].exits["n"].to).toBe(x.id);
    expect(m.rooms[t.id].exits["e"].to).toBe(y.id);
    expect(m.rooms[s.id]).toBeUndefined();
  });
  it("repoints inbound exits from the source to the target", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", name: "T" });
    const s = addRoom(m, { key: "s", name: "S" });
    const a = addRoom(m, { key: "a", name: "A" });
    linkExit(m, a.id, "w", s.id);          // a → source
    mergeRooms(m, s.id, t.id);
    expect(m.rooms[a.id].exits["w"].to).toBe(t.id);
  });
  it("keeps the target key and drops the source key when both are keyed", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", name: "T" });
    const s = addRoom(m, { key: "s", name: "S" });
    mergeRooms(m, s.id, t.id);
    expect(m.keyIndex["t"]).toBe(t.id);
    expect(m.keyIndex["s"]).toBeUndefined();
  });
  it("adopts the source key when the target has none", () => {
    const m = createMap();
    const t = addRoom(m, { key: null, name: "T" });
    const s = addRoom(m, { key: "s", name: "S" });
    mergeRooms(m, s.id, t.id);
    expect(m.rooms[t.id].key).toBe("s");
    expect(m.keyIndex["s"]).toBe(t.id);
  });
  it("moves current onto the target when the source was current", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", name: "T" });
    const s = addRoom(m, { key: "s", name: "S" });
    setCurrent(m, s.id);
    mergeRooms(m, s.id, t.id);
    expect(m.currentId).toBe(t.id);
  });
  it("returns false for a self-merge or a missing room", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", name: "T" });
    expect(mergeRooms(m, t.id, t.id)).toBe(false);
    expect(mergeRooms(m, "999", t.id)).toBe(false);
  });
});

describe("addExit", () => {
  it("adds a two-way exit by default", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    expect(addExit(m, a.id, "e", b.id)).toBe(true);
    expect(m.rooms[a.id].exits["e"].to).toBe(b.id);
    expect(m.rooms[b.id].exits["w"].to).toBe(a.id);
  });
  it("adds a one-way exit when bidirectional is false", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    addExit(m, a.id, "e", b.id, { bidirectional: false });
    expect(m.rooms[a.id].exits["e"].to).toBe(b.id);
    expect(m.rooms[b.id].exits["w"]).toBeUndefined();
  });
  it("returns false for a missing room", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    expect(addExit(m, a.id, "e", "999")).toBe(false);
  });
});

describe("deleteExit", () => {
  it("removes only the named directional exit", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    addExit(m, a.id, "e", b.id);
    expect(deleteExit(m, a.id, "e")).toBe(true);
    expect(m.rooms[a.id].exits["e"]).toBeUndefined();
    expect(m.rooms[b.id].exits["w"].to).toBe(a.id); // reverse untouched
  });
  it("returns false when the exit is absent", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    expect(deleteExit(m, a.id, "e")).toBe(false);
  });
});

describe("setOneWay", () => {
  it("removes the reverse edge when making one-way", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    addExit(m, a.id, "e", b.id);
    expect(setOneWay(m, a.id, "e", true)).toBe(true);
    expect(m.rooms[b.id].exits["w"]).toBeUndefined();
    expect(m.rooms[a.id].exits["e"].to).toBe(b.id);
  });
  it("restores the reverse edge when making two-way", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A" });
    const b = addRoom(m, { key: "b", name: "B" });
    addExit(m, a.id, "e", b.id, { bidirectional: false });
    expect(setOneWay(m, a.id, "e", false)).toBe(true);
    expect(m.rooms[b.id].exits["w"].to).toBe(a.id);
  });
});
