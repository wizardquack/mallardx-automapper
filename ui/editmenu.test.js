// ui/editmenu.test.js
import { describe, it, expect } from "vitest";
import { createMap, addRoom, addArea, listAreas } from "./graph.js";
import { addExit, setOneWay } from "./edits.js";
import { roomMenuModel } from "./editmenu.js";

function labels(nodes) { return nodes.map((n) => n.label); }
function find(nodes, label) { return nodes.find((n) => n.label === label); }

describe("roomMenuModel", () => {
  it("returns an empty model for a missing room", () => {
    const m = createMap();
    expect(roomMenuModel(m, "999", [])).toEqual([]);
  });

  it("lists the core room actions", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r", name: "Hall", areaId: "1" });
    addArea(m, { key: "__a1__", label: "Area 1" });
    const model = roomMenuModel(m, r.id, listAreas(m));
    const ls = labels(model);
    expect(ls).toContain("Rename…");
    expect(ls).toContain("Set as current");
    expect(ls).toContain("Merge into…");
    expect(find(model, "Delete room").danger).toBe(true);
    expect(find(model, "Delete room").action).toBe("deleteRoom");
  });

  it("shows an Exits submenu with a one-way toggle reflecting current state", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A", areaId: "1" });
    const b = addRoom(m, { key: "b", name: "B", areaId: "1" });
    addExit(m, a.id, "e", b.id);            // two-way
    const exits = find(roomMenuModel(m, a.id, listAreas(m)), "Exits").submenu;
    const eNode = exits.find((n) => n.label.startsWith("e "));
    const toggle = eNode.submenu.find((n) => n.action === "toggleOneWay");
    expect(toggle.label).toBe("Make one-way");
    expect(toggle.arg).toEqual({ dir: "e", oneWay: true });

    setOneWay(m, a.id, "e", true);          // now one-way
    const exits2 = find(roomMenuModel(m, a.id, listAreas(m)), "Exits").submenu;
    const eNode2 = exits2.find((n) => n.label.startsWith("e "));
    const toggle2 = eNode2.submenu.find((n) => n.action === "toggleOneWay");
    expect(toggle2.label).toBe("Make two-way");
    expect(toggle2.arg).toEqual({ dir: "e", oneWay: false });
  });

  it("offers only unused directions under Add exit", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "A", areaId: "1" });
    const b = addRoom(m, { key: "b", name: "B", areaId: "1" });
    addExit(m, a.id, "e", b.id, { bidirectional: false });
    const exits = find(roomMenuModel(m, a.id, listAreas(m)), "Exits").submenu;
    const addSub = find(exits, "Add exit").submenu;
    expect(addSub.some((n) => n.arg === "e")).toBe(false); // e already used
    expect(addSub.some((n) => n.arg === "n")).toBe(true);
    expect(addSub.some((n) => n.arg === "in")).toBe(true);   // in/out offered too
    expect(addSub.some((n) => n.arg === "out")).toBe(true);
  });

  it("lists other areas plus New area under both move menus", () => {
    const m = createMap();
    addArea(m, { key: "__a1__", label: "Area 1" }); // id 1
    addArea(m, { key: "__a2__", label: "Area 2" }); // id 2
    const r = addRoom(m, { key: "r", name: "R", areaId: "1" });
    const move = find(roomMenuModel(m, r.id, listAreas(m)), "Move to area").submenu;
    expect(move.some((n) => n.arg === "2")).toBe(true);
    expect(move.some((n) => n.arg === "1")).toBe(false);   // not the current area
    expect(move.some((n) => n.arg === "__new__")).toBe(true);
  });
});
