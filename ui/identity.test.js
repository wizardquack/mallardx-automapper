import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey, currentRoom, getRoom, getArea } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";

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

  it("is idempotent and tolerates a missing exits field", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A" }, null);           // no exits field
    const r = resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "e", toKey: "A" }] }, null);
    expect(r.created).toBe(false);
  });
});
