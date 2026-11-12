import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey, currentRoom, getRoom, getArea } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { vector } from "./directions.js";
import { addLink } from "./links.js";

describe("resolveRoomSeen", () => {
  it("creates the first room at origin with no link", () => {
    const m = createMap();
    const { room, created } = resolveRoomSeen(m, { key: "A", name: "Start", env: "city" }, null);
    expect(created).toBe(true);
    expect(room.coords).toEqual({ x: 0, y: 0, z: 0 });
    expect(currentRoom(m)).toBe(room);
    expect(room.exits).toEqual({});
  });

  it("places a new room by movement vector and links both ways", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Start", env: "city" }, null).room;
    const { room: b, created } = resolveRoomSeen(m, { key: "B", name: "North", env: "city" }, "n");
    expect(created).toBe(true);
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });
    expect(a.exits.n).toEqual({ to: b.id });
    expect(b.exits.s).toEqual({ to: a.id });
    expect(currentRoom(m)).toBe(b);
  });

  it("revisiting a known key sets it current without creating", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "Start", env: "city" }, null);
    resolveRoomSeen(m, { key: "B", name: "North", env: "city" }, "n");
    const { room, created } = resolveRoomSeen(m, { key: "A", name: "Start", env: "city" }, "s");
    expect(created).toBe(false);
    expect(room).toBe(getRoomByKey(m, "A"));
    expect(currentRoom(m).key).toBe("A");
  });

  it("refreshes name/env on revisit", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "Old", env: "city" }, null);
    const { room } = resolveRoomSeen(m, { key: "A", name: "New Name", env: "forest" }, null);
    expect(room.name).toBe("New Name");
    expect(room.env).toBe("forest");
  });

  it("creates without a link when pendingDir is null but a current room exists (teleport)", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Start", env: "city" }, null).room;
    const { room: b } = resolveRoomSeen(m, { key: "B", name: "Elsewhere", env: "city" }, null);
    expect(a.exits).toEqual({});
    expect(b.exits).toEqual({});
    expect(currentRoom(m)).toBe(b);
  });

  it("links two already-known rooms when traversed after both exist (loop closing)", () => {
    const m = createMap();
    // A is current; B is discovered out-of-band (teleport) so it is NOT linked to A.
    const a = resolveRoomSeen(m, { key: "A", name: "A", env: "" }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "B", env: "" }, null).room;
    expect(a.exits).toEqual({});
    // Return to A, then walk east into the already-known B: the edge must be recorded.
    resolveRoomSeen(m, { key: "A", name: "A", env: "" }, null);
    const { room, created } = resolveRoomSeen(m, { key: "B", name: "B", env: "" }, "e");
    expect(created).toBe(false);
    expect(room).toBe(b);
    expect(a.exits.e).toEqual({ to: b.id });
    expect(b.exits.w).toEqual({ to: a.id });
  });

  it("does not self-link when the same room re-reports with a direction (look)", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", env: "" }, null).room;
    // room.info fires again for the SAME room while a stale pendingDir is armed.
    resolveRoomSeen(m, { key: "A", name: "A", env: "" }, "n");
    expect(a.exits).toEqual({});
  });

  const KIND = { strategy: "auto", overworld: "outside" };

  it("crossing into a NEW area places the room at that area's origin", () => {
    const m = createMap();
    // outside street room
    const a = resolveRoomSeen(m, { key: "A", name: "Street", areaTag: "outside", areaField: "kind" }, null, KIND).room;
    // step 'n' into a building interior -> new area, origin placement
    const b = resolveRoomSeen(m, { key: "B", name: "Hall", areaTag: "inside", areaField: "kind" }, "n", KIND).room;
    expect(b.areaId).not.toBe(a.areaId);
    expect(b.coords).toEqual({ x: 0, y: 0, z: 0 });
    // cross-area exit still recorded both ways for future navigation
    expect(a.exits.n).toEqual({ to: b.id });
    expect(b.exits.s).toEqual({ to: a.id });
  });

  it("same-area directional step uses vector placement", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Hall", areaTag: "inside", areaField: "kind" }, null, KIND).room;
    const b = resolveRoomSeen(m, { key: "B", name: "Kitchen", areaTag: "inside", areaField: "kind" }, "n", KIND).room;
    expect(b.areaId).toBe(a.areaId);
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });
  });

  it("crossing back into an existing area avoids colliding with its origin room", () => {
    const m = createMap();
    // overworld room O at origin of the overworld area
    const o = resolveRoomSeen(m, { key: "O", name: "Street", areaTag: "outside", areaField: "kind" }, null, KIND).room;
    expect(o.coords).toEqual({ x: 0, y: 0, z: 0 });
    // go inside (new interior area)
    resolveRoomSeen(m, { key: "I", name: "Shop", areaTag: "inside", areaField: "kind" }, "n", KIND);
    // leave by a different door to a NEW overworld room -> back into overworld area
    const o2 = resolveRoomSeen(m, { key: "O2", name: "Alley", areaTag: "outside", areaField: "kind" }, "s", KIND).room;
    expect(o2.areaId).toBe(o.areaId);
    // must NOT land on O's origin cell
    expect(o2.coords).not.toEqual(o.coords);
    expect(o2.coords).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("traversal between two already-known rooms in different areas links without moving them", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Street", areaTag: "outside", areaField: "kind" }, null, KIND).room;
    const b = resolveRoomSeen(m, { key: "B", name: "Hall", areaTag: "inside", areaField: "kind" }, "n", KIND).room;
    const bCoords = { ...b.coords };
    // walk back to A, then back into the already-known B
    resolveRoomSeen(m, { key: "A", name: "Street", areaTag: "outside", areaField: "kind" }, "s", KIND);
    const r = resolveRoomSeen(m, { key: "B", name: "Hall", areaTag: "inside", areaField: "kind" }, "n", KIND);
    expect(r.created).toBe(false);
    expect(getRoom(m, b.id).coords).toEqual(bCoords); // unmoved
    expect(a.exits.n).toEqual({ to: b.id });
  });
});

describe("resolveRoomSeen — mudstd.room explicit exits", () => {
  it("links the forward edge to an already-known room without walking it", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "B", name: "East Room" }, null);
    const { room: a } = resolveRoomSeen(m, {
      key: "A", name: "West Room",
      exits: [{ dir: "e", toKey: "B" }],
    }, null);
    expect(a.exits.e).toEqual({ to: getRoomByKey(m, "B").id });
    // We did NOT fabricate the reverse — B links back only when it reports it.
    expect(getRoomByKey(m, "B").exits.w).toBeUndefined();
  });

  it("skips exits to unknown rooms (no stub, no crash) and links them later", () => {
    const m = createMap();
    const { room: a } = resolveRoomSeen(m, {
      key: "A", name: "Room A",
      exits: [{ dir: "e", toKey: "B" }],  // B unknown yet
    }, null);
    expect(a.exits.e).toBeUndefined();
    expect(Object.keys(m.rooms).length).toBe(1);
    const { room: b } = resolveRoomSeen(m, {
      key: "B", name: "Room B",
      exits: [{ dir: "w", toKey: "A" }],
    }, "e");
    expect(b.exits.w).toEqual({ to: a.id });
  });

  it("closing a loop links back from a room that already listed the arrival", () => {
    // Start at D (lists n → C), walk round D → W1 → W2 → C; arriving at C
    // with an inferred move links C → D, and D's own earlier report links D → C.
    const m = createMap();
    const d = resolveRoomSeen(m, { key: "D", name: "Start", exits: [{ dir: "n", toKey: "C" }, { dir: "w", toKey: "W" }] }, null).room;
    resolveRoomSeen(m, { key: "W", name: "West", exits: [{ dir: "e", toKey: "D" }, { dir: "n", toKey: "X" }] }, "w");
    resolveRoomSeen(m, { key: "X", name: "North-west", exits: [{ dir: "s", toKey: "W" }, { dir: "e", toKey: "C" }] }, "n");
    const c = resolveRoomSeen(m, { key: "C", name: "North", exits: [{ dir: "w", toKey: "X" }, { dir: "s", toKey: "D" }] }, "e").room;
    expect(c.exits.s).toEqual({ to: d.id });
    expect(d.exits.n).toEqual({ to: c.id });
  });

  it("is idempotent and tolerates a missing exits field", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A" }, null);           // no exits field
    const r = resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "e", toKey: "A" }] }, null);
    expect(r.created).toBe(false);
  });
});

describe("resolveRoomSeen — in/out", () => {
  it("links in/out both ways without placing by them", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Corridor" }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "Cantina" }, "in").room;
    expect(a.exits.in).toEqual({ to: b.id });
    expect(b.exits.out).toEqual({ to: a.id });
    // No vector: B takes the area's first free cell, not a neighbour of A.
    expect(b.coords).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("links mudstd IN/OUT exits to known rooms", () => {
    const m = createMap();
    const b = resolveRoomSeen(m, { key: "B", name: "Cantina" }, null).room;
    const a = resolveRoomSeen(m, { key: "A", name: "Corridor", exits: [{ dir: "in", toKey: "B" }] }, null).room;
    expect(a.exits.in).toEqual({ to: b.id });
  });
});

describe("resolveRoomSeen — direction inferred from exits", () => {
  it("places a NEW room by the previous room's exit that leads to it", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Rim", exits: [{ dir: "e", toKey: "B" }, { dir: "w", toKey: "Z" }] }, null).room;
    // No typed direction (a local word like "spinward", or a clicked link).
    const { room: b, created } = resolveRoomSeen(m, { key: "B", name: "Rim 2", exits: [{ dir: "w", toKey: "A" }] }, null);
    expect(created).toBe(true);
    expect(b.coords).toEqual({ x: 1, y: 0, z: 0 });
    expect(a.exits.e).toEqual({ to: b.id });
    // The reverse comes from B's own reported exits, not a guess.
    expect(b.exits.w).toEqual({ to: a.id });
  });

  it("links the forward edge only: no guessed reverse when the room doesn't report one", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "Top", exits: [{ dir: "d", toKey: "B" }] }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "Chute", exits: [] }, null).room;
    expect(a.exits.d).toEqual({ to: b.id });
    expect(b.exits).toEqual({});
    expect(b.coords).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("a typed direction still wins over the inferred one", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "e", toKey: "B" }] }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "B" }, "n").room;
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });
    expect(a.exits.n).toEqual({ to: b.id });
  });

  it("infers onto an already-known room from stored edges (no exitKeys)", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A" }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "B" }, "e").room;
    resolveRoomSeen(m, { key: "A", name: "A" }, "w");
    delete a.exitKeys;                       // e.g. a room.info-only world
    resolveRoomSeen(m, { key: "B", name: "B" }, null);
    expect(currentRoom(m)).toBe(b);
    expect(a.exits.e).toEqual({ to: b.id });
  });

  it("prefers a compass exit over in/out when both lead to the room", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "in", toKey: "B" }, { dir: "n", toKey: "B" }] }, null);
    const b = resolveRoomSeen(m, { key: "B", name: "B" }, null).room;
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });
  });

  it("infers nothing for a teleport to a room no exit leads to", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "e", toKey: "B" }] }, null).room;
    const c = resolveRoomSeen(m, { key: "C", name: "Far" }, null).room;
    expect(a.exits).toEqual({});
    expect(c.coords).toEqual({ x: 1, y: 0, z: 0 });   // first free cell
  });

  it("remembers the last reported exits by key, and keeps them across room.info frames", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "e", toKey: "B" }, { dir: "in", toKey: "S" }] }, null).room;
    expect(a.exitKeys).toEqual({ e: "B", in: "S" });
    resolveRoomSeen(m, { key: "A", name: "A" }, null);   // no exits list
    expect(a.exitKeys).toEqual({ e: "B", in: "S" });
    resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "w", toKey: "C" }] }, null);
    expect(a.exitKeys).toEqual({ w: "C" });
  });
});

describe("resolveRoomSeen — server coordinates", () => {
  it("reads server +y as north, so a room the server puts north is drawn north", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 0, y: 0, z: 0 } }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "B", coords: { x: 0, y: 1, z: 0 } }, "n").room;
    const v = vector("n");
    expect(b.coords).toEqual({ x: a.coords.x + v.dx, y: a.coords.y + v.dy, z: 0 });
  });

  it("places a new room at its server coords, ignoring the movement vector", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 5, y: 2, z: 0 } }, null);
    const b = resolveRoomSeen(m, { key: "B", name: "B", coords: { x: 9, y: 9, z: 1 } }, "n").room;
    expect(b.coords).toEqual({ x: 9, y: -9, z: 1 });
    expect(b.serverCoords).toBe(true);
  });

  it("keeps where the server says x comes round, and drops it when it stops saying so", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 23, y: 0, z: 0 }, wrap: { x: 24 } }, null).room;
    expect(a.wrapX).toBe(24);
    resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 23, y: 0, z: 0 } }, null);
    expect(a.wrapX).toBeUndefined();
  });

  it("moves an already-placed room to its server coords on a later visit", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A" }, null);
    const b = resolveRoomSeen(m, { key: "B", name: "B" }, "e").room;
    expect(b.coords).toEqual({ x: 1, y: 0, z: 0 });
    resolveRoomSeen(m, { key: "B", name: "B", coords: { x: 4, y: -3, z: 0 } }, null);
    expect(b.coords).toEqual({ x: 4, y: 3, z: 0 });
  });

  it("without coords, placement is unchanged (and a server-placed room stays put)", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 3, y: 3, z: 0 } }, null).room;
    const b = resolveRoomSeen(m, { key: "B", name: "B" }, "s").room;
    expect(b.coords).toEqual({ x: 3, y: -2, z: 0 });
    expect(b.serverCoords).toBeUndefined();
    resolveRoomSeen(m, { key: "A", name: "A" }, "n");
    expect(a.coords).toEqual({ x: 3, y: -3, z: 0 });
  });

  it("re-places a room it displaces that the server didn't place", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A" }, null).room;      // (0,0,0), no coords
    const b = resolveRoomSeen(m, { key: "B", name: "B", coords: { x: 0, y: 0, z: 0 } }, null).room;
    expect(b.coords).toEqual({ x: 0, y: 0, z: 0 });
    expect(a.coords).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(a.coords).toEqual({ x: 1, y: 0, z: 0 });                        // first free cell
  });

  it("leaves a server-placed occupant where the server put it", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", coords: { x: 2, y: 2, z: 0 } }, null).room;
    resolveRoomSeen(m, { key: "B", name: "B", coords: { x: 2, y: 2, z: 0 } }, null);
    expect(a.coords).toEqual({ x: 2, y: -2, z: 0 });
  });

  it("only displaces rooms in the same area", () => {
    const m = createMap();
    const KIND = { strategy: "auto" };
    const a = resolveRoomSeen(m, { key: "A", name: "A", areaTag: "x", areaField: "area" }, null, KIND).room;
    resolveRoomSeen(m, { key: "B", name: "B", areaTag: "y", areaField: "area", coords: { x: 0, y: 0, z: 0 } }, null, KIND);
    expect(a.coords).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("resolveRoomSeen — areaName on revisits", () => {
  it("relabels a known room's area when a revisit carries a new areaName", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", areaTag: "ship-7", areaField: "area", areaName: "Brass Kettle" }, null).room;
    resolveRoomSeen(m, { key: "A", name: "A", areaTag: "ship-7", areaField: "area", areaName: "Copper Kettle" }, null);
    expect(getArea(m, a.areaId).label).toBe("Copper Kettle");
  });

  it("doesn't relabel an area the room was moved into by hand", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, { key: "A", name: "A", areaTag: "x", areaField: "area" }, null).room;
    const other = resolveRoomSeen(m, { key: "B", name: "B", areaTag: "y", areaField: "area" }, null).room;
    a.areaId = other.areaId;   // moved to area y by an edit
    resolveRoomSeen(m, { key: "A", name: "A", areaTag: "x", areaField: "area", areaName: "Ex" }, null);
    expect(getArea(m, other.areaId).label).toBe("y");
  });
});


describe("resolveRoomSeen: server annotations", () => {
  it("replaces tags on revisit, clears them on an empty list, keeps them when absent", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", tags: ["market"] }, null);
    const r = getRoomByKey(m, "A");
    resolveRoomSeen(m, { key: "A", tags: ["market", "charger"] }, null);
    expect(r.tags).toEqual(["market", "charger"]);
    resolveRoomSeen(m, { key: "A" }, null);
    expect(r.tags).toEqual(["market", "charger"]);
    resolveRoomSeen(m, { key: "A", tags: [] }, null);
    expect(r.tags).toBeUndefined();
  });

  it("follows a region and its renamed label, and leaves user annotations alone", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", areaTag: "tiss", areaField: "area", region: "docks", regionName: "Docks" }, null);
    const r = getRoomByKey(m, "A");
    r.color = "#ff0000"; r.symbol = "X"; r.note = "mine";
    resolveRoomSeen(m, { key: "A", areaTag: "tiss", areaField: "area", region: "docks", regionName: "the Docks", tags: ["berth"] }, null);
    expect(getArea(m, r.areaId).regions).toEqual({ docks: "the Docks" });
    expect(r).toMatchObject({ color: "#ff0000", symbol: "X", note: "mine", tags: ["berth"] });
  });
});

describe("resolveRoomSeen — the server's links", () => {
  const lobby = (key, links) => ({ key, name: key, links });
  const L12 = (key) => ({ toKey: key, name: "Lift 12" });

  it("links both ways once each end has been seen, whichever comes first", () => {
    const m = createMap();
    const rim = resolveRoomSeen(m, lobby("rim", [L12("mid"), L12("hub")]), null, {}).room;
    expect(rim.links).toBeUndefined();
    expect(rim.linkKeys).toEqual({ mid: { name: "Lift 12" }, hub: { name: "Lift 12" } });
    // Ride to the hub: its frame links it back, and the rim's pending link lands.
    const hub = resolveRoomSeen(m, lobby("hub", [L12("rim"), L12("mid")]), null, {}).room;
    expect(hub.links).toEqual({ [rim.id]: { name: "Lift 12", server: true } });
    expect(rim.links).toEqual({ [hub.id]: { name: "Lift 12", server: true } });
  });

  it("drops a server link the frame stops listing, but keeps the user's", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, lobby("a", []), null, {}).room;
    const b = resolveRoomSeen(m, lobby("b", [L12("a")]), null, {}).room;
    const c = resolveRoomSeen(m, lobby("c", []), null, {}).room;
    addLink(m, b.id, c.id, { name: "Mine", oneWay: true });
    resolveRoomSeen(m, lobby("b", []), null, {});
    expect(b.links).toEqual({ [c.id]: { name: "Mine" } });
    expect(b.linkKeys).toBeUndefined();
    expect(a.links).toBeUndefined();
  });

  it("leaves links alone on a frame without a list", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, lobby("a", []), null, {}).room;
    const b = resolveRoomSeen(m, lobby("b", [L12("a")]), null, {}).room;
    resolveRoomSeen(m, { key: "b", name: "b" }, null, {});
    expect(b.links).toEqual({ [a.id]: { name: "Lift 12", server: true } });
  });
});
