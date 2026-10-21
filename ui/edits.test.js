// ui/edits.test.js
import { describe, it, expect } from "vitest";
import { createMap, addRoom, linkExit, setCurrent, getRoom } from "./graph.js";
import {
  renameRoom, deleteRoom, mergeRooms, addExit, deleteExit, setOneWay,
  setRoomColor, setRoomSymbol, setRoomNote,
  isCellOccupied, freeCell, moveRoom, moveToArea, computePocket, movePocket,
} from "./edits.js";

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

describe("isCellOccupied / freeCell", () => {
  it("detects an occupied cell and ignores the excepted room", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A", coords: { x: 2, y: 0, z: 0 }, areaId: "1" });
    expect(isCellOccupied(m, "1", 2, 0, 0)).toBe(true);
    expect(isCellOccupied(m, "1", 2, 0, 0, a.id)).toBe(false);
    expect(isCellOccupied(m, "1", 3, 0, 0)).toBe(false);
    expect(isCellOccupied(m, "2", 2, 0, 0)).toBe(false); // different area
  });
  it("finds the first free cell along +x on z:0", () => {
    const m = createMap();
    addRoom(m, { key: "a", name: "A", coords: { x: 0, y: 0, z: 0 }, areaId: "1" });
    addRoom(m, { key: "b", name: "B", coords: { x: 1, y: 0, z: 0 }, areaId: "1" });
    expect(freeCell(m, "1")).toEqual({ x: 2, y: 0, z: 0 });
  });
});

describe("moveRoom", () => {
  it("updates planar coords and leaves z unchanged", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A", coords: { x: 0, y: 0, z: 3 }, areaId: "1" });
    expect(moveRoom(m, a.id, 5, -2)).toBe(true);
    expect(m.rooms[a.id].coords).toEqual({ x: 5, y: -2, z: 3 });
  });
  it("returns false for a missing room", () => {
    const m = createMap();
    expect(moveRoom(m, "999", 1, 1)).toBe(false);
  });
});

describe("moveToArea", () => {
  it("reassigns the area and re-places into a free cell", () => {
    const m = createMap();
    addRoom(m, { key: "occ", name: "Occ", coords: { x: 0, y: 0, z: 0 }, areaId: "2" });
    const r = addRoom(m, { key: "r", name: "R", coords: { x: 9, y: 9, z: 0 }, areaId: "1" });
    expect(moveToArea(m, r.id, "2")).toBe(true);
    expect(m.rooms[r.id].areaId).toBe("2");
    expect(m.rooms[r.id].coords).toEqual({ x: 1, y: 0, z: 0 }); // 0,0 taken by "occ"
  });
});

describe("computePocket", () => {
  it("floods only rooms in the seed's area", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A", areaId: "1" });
    const b = addRoom(m, { key: "b", name: "B", areaId: "1" });
    const c = addRoom(m, { key: "c", name: "C", areaId: "2" }); // other area
    addExit(m, a.id, "e", b.id);
    addExit(m, b.id, "e", c.id); // crosses into area 2
    const ids = computePocket(m, a.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
    expect(ids).not.toContain(c.id);
  });
  it("returns an empty list for a missing seed", () => {
    const m = createMap();
    expect(computePocket(m, "999")).toEqual([]);
  });
});

describe("movePocket", () => {
  it("moves all rooms to the target area preserving relative coords", () => {
    const m = createMap();
    // target area "2" occupies x:0 and x:1 at y:0
    addRoom(m, { key: "t0", name: "T0", coords: { x: 0, y: 0, z: 0 }, areaId: "2" });
    addRoom(m, { key: "t1", name: "T1", coords: { x: 1, y: 0, z: 0 }, areaId: "2" });
    // pocket in area "1": two rooms one apart in x
    const p0 = addRoom(m, { key: "p0", name: "P0", coords: { x: 5, y: 0, z: 0 }, areaId: "1" });
    const p1 = addRoom(m, { key: "p1", name: "P1", coords: { x: 6, y: 1, z: 0 }, areaId: "1" });
    expect(movePocket(m, [p0.id, p1.id], "2")).toBe(true);
    expect(m.rooms[p0.id].areaId).toBe("2");
    expect(m.rooms[p1.id].areaId).toBe("2");
    // relative offset preserved (p1 is +1x,+1y from p0)
    const c0 = m.rooms[p0.id].coords, c1 = m.rooms[p1.id].coords;
    expect(c1.x - c0.x).toBe(1);
    expect(c1.y - c0.y).toBe(1);
    // landed clear of target rooms (all pocket x > max target x = 1)
    expect(c0.x).toBeGreaterThan(1);
    expect(isCellOccupied(m, "2", c0.x, c0.y, c0.z, p0.id)).toBe(false);
  });
  it("returns false for an empty id list", () => {
    const m = createMap();
    expect(movePocket(m, [], "2")).toBe(false);
  });
});

describe("annotation edits", () => {
  it("sets and clears a colour, reporting no-ops", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r" });
    expect(setRoomColor(m, r.id, "#3aa8a0")).toBe(true);
    expect(r.color).toBe("#3aa8a0");
    expect(setRoomColor(m, r.id, "#3aa8a0")).toBe(false);
    expect(setRoomColor(m, r.id, "")).toBe(true);
    expect("color" in r).toBe(false);
    expect(setRoomColor(m, "nope", "#000000")).toBe(false);
  });

  it("keeps a symbol to two characters, counting code points", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r" });
    setRoomSymbol(m, r.id, " ABC ");
    expect(r.symbol).toBe("AB");
    setRoomSymbol(m, r.id, "★✓x");
    expect(r.symbol).toBe("★✓");
    setRoomSymbol(m, r.id, "");
    expect("symbol" in r).toBe(false);
  });

  it("sets a trimmed note and clears an empty one", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r" });
    expect(setRoomNote(m, r.id, "  shopkeeper buys ore ")).toBe(true);
    expect(r.note).toBe("shopkeeper buys ore");
    expect(setRoomNote(m, r.id, "   ")).toBe(true);
    expect("note" in r).toBe(false);
  });

  it("merge adopts the source's annotations where the target has none", () => {
    const m = createMap();
    const t = addRoom(m, { key: "t", env: "" });
    const s = addRoom(m, { key: "s", env: "corridor" });
    t.color = "#111111";
    Object.assign(s, { color: "#222222", symbol: "S", note: "n", tags: ["market"], region: "docks" });
    mergeRooms(m, s.id, t.id);
    expect(t).toMatchObject({ env: "corridor", color: "#111111", symbol: "S", note: "n", tags: ["market"], region: "docks" });
  });
});

import { moveRooms, editEach } from "./edits.js";

describe("moveRooms", () => {
  function row() {
    const m = createMap();
    const rs = [0, 1, 2].map((x) => addRoom(m, { key: `r${x}`, areaId: "1", coords: { x, y: 0, z: 0 } }));
    return { m, rs };
  }

  it("shifts rooms together, past each other's cells", () => {
    const { m, rs } = row();
    expect(moveRooms(m, [rs[0].id, rs[1].id], 1, 1)).toBe(true);
    expect(rs.map((r) => r.coords)).toEqual([
      { x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 2, y: 0, z: 0 },
    ]);
  });

  it("moves a row onto its own cells along itself", () => {
    const { m, rs } = row();
    expect(moveRooms(m, [rs[0].id, rs[1].id], 1, 0)).toBe(false);   // r1 would land on r2
    expect(moveRooms(m, rs.map((r) => r.id), 1, 0)).toBe(true);
  });

  it("refuses, moving nothing, where one would land on a room staying put", () => {
    const { m, rs } = row();
    expect(moveRooms(m, [rs[0].id], 2, 0)).toBe(false);
    expect(rs[0].coords).toEqual({ x: 0, y: 0, z: 0 });
    expect(moveRooms(m, [rs[0].id], 0, 0)).toBe(false);
  });

  it("editEach reports whether any changed", () => {
    const { m, rs } = row();
    const ids = rs.map((r) => r.id);
    expect(editEach(m, ids, (mm, id) => setRoomColor(mm, id, "#112233"))).toBe(true);
    expect(editEach(m, ids, (mm, id) => setRoomColor(mm, id, "#112233"))).toBe(false);
  });
});
