import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey, currentRoom, getArea } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { importChart } from "./chart.js";
import { setRoomColor, setRoomNote } from "./edits.js";
import { linksOf } from "./links.js";

const zone = (key, extra = {}) => ({ key, name: key, env: "road", areaField: "area", areaTag: "town", ...extra });

describe("importChart", () => {
  it("adds rooms at server coords, charted, without moving you", () => {
    const m = createMap();
    const here = resolveRoomSeen(m, zone("home", { coords: { x: 9, y: 9, z: 0 } }), null).room;
    const res = importChart(m, [
      zone("a", { coords: { x: 0, y: 0, z: 0 } }),
      zone("b", { coords: { x: 0, y: 1, z: 0 } }),
    ]);
    expect(res).toEqual({ created: 2, updated: 0 });
    const a = getRoomByKey(m, "a"), b = getRoomByKey(m, "b");
    expect(a.charted).toBe(true);
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });   // server north is grid -y
    expect(currentRoom(m)).toBe(here);
    expect(here.charted).toBeUndefined();
    expect(getArea(m, a.areaId).key).toBe("zone:town");
  });

  it("links exits whatever order the rooms come in", () => {
    const m = createMap();
    importChart(m, [
      zone("a", { coords: { x: 0, y: 0, z: 0 }, exits: [{ dir: "n", toKey: "b" }] }),
      zone("b", { coords: { x: 0, y: 1, z: 0 }, exits: [{ dir: "s", toKey: "a" }] }),
    ]);
    const a = getRoomByKey(m, "a"), b = getRoomByKey(m, "b");
    expect(a.exits.n).toEqual({ to: b.id });
    expect(b.exits.s).toEqual({ to: a.id });
  });

  it("links a visited room's reported exit into a charted room", () => {
    const m = createMap();
    const here = resolveRoomSeen(m, zone("home", { exits: [{ dir: "e", toKey: "a" }] }), null).room;
    importChart(m, [zone("a")]);
    const a = getRoomByKey(m, "a");
    expect(here.exits.e).toEqual({ to: a.id });
    expect(a.coords).toEqual({ x: here.coords.x + 1, y: here.coords.y, z: 0 });
  });

  it("places rooms without coords by their exits from placed ones", () => {
    const m = createMap();
    importChart(m, [
      zone("c", { exits: [{ dir: "w", toKey: "b" }] }),
      zone("b", { exits: [{ dir: "w", toKey: "a" }, { dir: "e", toKey: "c" }] }),
      zone("a", { coords: { x: 5, y: 0, z: 0 }, exits: [{ dir: "e", toKey: "b" }] }),
    ]);
    expect(getRoomByKey(m, "b").coords).toEqual({ x: 6, y: 0, z: 0 });
    expect(getRoomByKey(m, "c").coords).toEqual({ x: 7, y: 0, z: 0 });
  });

  it("lays out an area the server gave no coords by its exits, not in a row", () => {
    const m = createMap();
    importChart(m, [
      zone("hub", { exits: [{ dir: "n", toKey: "north" }, { dir: "e", toKey: "east" }, { dir: "u", toKey: "up" }] }),
      zone("north", { exits: [{ dir: "s", toKey: "hub" }] }),
      zone("east", { exits: [{ dir: "w", toKey: "hub" }, { dir: "e", toKey: "far" }] }),
      zone("far", { exits: [{ dir: "w", toKey: "east" }] }),
      zone("up", { exits: [{ dir: "d", toKey: "hub" }] }),
    ]);
    const at = (k) => getRoomByKey(m, k).coords;
    const hub = at("hub");
    expect(at("north")).toEqual({ ...hub, y: hub.y - 1 });
    expect(at("east")).toEqual({ ...hub, x: hub.x + 1 });
    expect(at("far")).toEqual({ ...hub, x: hub.x + 2 });
    expect(at("up")).toEqual({ ...hub, z: hub.z + 1 });
  });

  it("starts a piece joined by no compass exit clear of the rest, and spreads it", () => {
    const m = createMap();
    importChart(m, [
      zone("a", { exits: [{ dir: "e", toKey: "b" }] }),
      zone("b", { exits: [{ dir: "w", toKey: "a" }] }),
      zone("c", { exits: [{ dir: "w", toKey: "d" }, { dir: "in", toKey: "a" }] }),
      zone("d", { exits: [{ dir: "e", toKey: "c" }] }),
    ]);
    const at = (k) => getRoomByKey(m, k).coords;
    const cells = ["a", "b", "c", "d"].map((k) => JSON.stringify(at(k)));
    expect(new Set(cells).size).toBe(4);
    expect(at("d")).toEqual({ ...at("c"), x: at("c").x - 1 });
    expect(at("d").x).toBeGreaterThan(at("b").x);
  });

  it("stretches along an exit's line when the next cell is taken", () => {
    const m = createMap();
    importChart(m, [
      zone("a", { coords: { x: 0, y: 0, z: 0 }, exits: [{ dir: "e", toKey: "c" }] }),
      zone("b", { coords: { x: 1, y: 0, z: 0 } }),
      zone("c", { exits: [{ dir: "w", toKey: "a" }] }),
    ]);
    expect(getRoomByKey(m, "c").coords).toEqual({ x: 2, y: 0, z: 0 });
  });

  it("puts an unreachable room without coords in a free cell", () => {
    const m = createMap();
    importChart(m, [zone("a", { coords: { x: 0, y: 0, z: 0 } }), zone("lone")]);
    const lone = getRoomByKey(m, "lone");
    expect(Number.isFinite(lone.coords.x)).toBe(true);
    expect(lone.coords).not.toEqual(getRoomByKey(m, "a").coords);
  });

  it("refreshes a known room's server fields but keeps yours and its visited state", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, zone("a"), null).room;
    setRoomColor(m, a.id, "#ff0000");
    setRoomNote(m, a.id, "mine");
    const res = importChart(m, [zone("a", { name: "Renamed", tags: ["bank"], coords: { x: 3, y: 0, z: 0 } })]);
    expect(res).toEqual({ created: 0, updated: 1 });
    expect(a.name).toBe("Renamed");
    expect(a.tags).toEqual(["bank"]);
    expect(a.coords).toEqual({ x: 3, y: 0, z: 0 });
    expect(a.color).toBe("#ff0000");
    expect(a.note).toBe("mine");
    expect(a.charted).toBeUndefined();
    expect(currentRoom(m)).toBe(a);
  });

  it("skips rooms without a key", () => {
    const m = createMap();
    const res = importChart(m, [{ name: "nobody" }, null, zone("a")]);
    expect(res.created).toBe(1);
    expect(Object.keys(m.rooms)).toHaveLength(1);
  });

  it("takes the server's links between charted rooms", () => {
    const m = createMap();
    importChart(m, [
      zone("lobby", { links: [{ toKey: "top", name: "lift" }] }),
      zone("top"),
    ]);
    const lobby = getRoomByKey(m, "lobby"), top = getRoomByKey(m, "top");
    expect(linksOf(lobby)[top.id]).toMatchObject({ name: "lift", server: true });
  });

  it("clears charted once you arrive", () => {
    const m = createMap();
    importChart(m, [zone("a")]);
    const { room } = resolveRoomSeen(m, zone("a"), null);
    expect(room.charted).toBeUndefined();
  });
});
