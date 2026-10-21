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

describe("roomMenuModel: annotations", () => {
  it("offers Colour swatches, Custom and Clear, ticking the current one", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r", name: "Hall" });
    let colour = find(roomMenuModel(m, r.id, []), "Colour");
    expect(colour.submenu[0]).toMatchObject({ label: "Red", action: "setColor", arg: "#d9534f" });
    expect(find(colour.submenu, "Custom…").action).toBe("setColorCustom");
    expect(find(colour.submenu, "Clear")).toMatchObject({ action: "setColor", arg: "", disabled: true });
    r.color = "#d9534f";
    colour = find(roomMenuModel(m, r.id, []), "Colour");
    expect(colour.submenu[0].label).toBe("✓ Red");
    expect(find(colour.submenu, "Clear").disabled).toBe(false);
  });

  it("labels Symbol and Note by whether the room has one", () => {
    const m = createMap();
    const r = addRoom(m, { key: "r", name: "Hall" });
    let ls = labels(roomMenuModel(m, r.id, []));
    expect(ls).toContain("Symbol…");
    expect(ls).toContain("Add note…");
    r.symbol = "$"; r.note = "x";
    ls = labels(roomMenuModel(m, r.id, []));
    expect(ls).toContain("Symbol ($)…");
    expect(ls).toContain("Edit note…");
  });
});

import { addLink } from "./links.js";

describe("roomMenuModel: links", () => {
  it("offers Link to… and, per link, view/name/command/one-way/delete", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", name: "Rim" });
    const b = addRoom(m, { key: "b", name: "Hub" });
    expect(find(roomMenuModel(m, a.id, []), "Links").submenu).toEqual([
      { label: "Link to…", action: "addLink" },
    ]);
    addLink(m, a.id, b.id, { name: "Lift 12", oneWay: true });
    const sub = find(roomMenuModel(m, a.id, []), "Links").submenu;
    expect(sub[0].label).toBe("Lift 12 → Hub");
    expect(sub[0].submenu).toEqual([
      { label: "View", action: "viewRoom", arg: b.id },
      { label: "Rename…", action: "renameLink", arg: b.id },
      { label: "Command…", action: "setLinkCmd", arg: b.id },
      { label: "Make two-way", action: "toggleLinkOneWay", arg: { to: b.id, oneWay: false } },
      { label: "Delete link", danger: true, action: "deleteLink", arg: b.id },
    ]);
    expect(sub.slice(1)).toEqual([{ separator: true }, { label: "Link to…", action: "addLink" }]);
  });
});

import { selectionMenuModel } from "./editmenu.js";

describe("selectionMenuModel", () => {
  it("offers colour, symbol, area move and delete for the selection", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", areaId: "1" });
    const b = addRoom(m, { key: "b", areaId: "1" });
    b.color = "#d9534f";
    const areas = [{ id: "1", label: "One" }, { id: "2", label: "Two" }];
    const model = selectionMenuModel(m, [a.id, b.id], areas);
    expect(model[0]).toEqual({ label: "2 rooms selected", header: true });
    const colour = find(model, "Colour").submenu;
    expect(colour[0]).toEqual({ label: "Red", action: "selSetColor", arg: "#d9534f" });   // not ✓: they differ
    expect(find(colour, "Custom…").action).toBe("selSetColorCustom");
    expect(find(colour, "Clear")).toMatchObject({ action: "selSetColor", arg: "", disabled: false });
    expect(labels(find(model, "Move to area").submenu)).toEqual(["One", "Two", undefined, "New area…"]);
    expect(find(model, "Delete 2 rooms")).toMatchObject({ danger: true, action: "selDelete" });
    expect(selectionMenuModel(m, ["99"], areas)).toEqual([]);
  });

  it("the room menu can select its connected pocket", () => {
    const m = createMap();
    const a = addRoom(m, { key: "a", areaId: "1" });
    expect(find(roomMenuModel(m, a.id, []), "Select connected pocket").action).toBe("selectPocket");
  });
});
