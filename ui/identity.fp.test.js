import { describe, it, expect } from "vitest";
import { createMap, currentRoom, getRoom } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { fingerprint } from "./fingerprint.js";

// Helper: build a fingerprint "room seen" the way mapper.js will.
function fp(name, exits, env) {
  return { fp: fingerprint({ name, exits }), name, env: env || "" };
}

describe("resolveRoomSeen — fingerprint path", () => {
  it("creates the first room at origin, no link", () => {
    const m = createMap();
    const { room, created } = resolveRoomSeen(m, fp("Square", "n e"), null, {});
    expect(created).toBe(true);
    expect(room.fp).toBe(fingerprint({ name: "Square", exits: "n e" }));
    expect(room.key).toBeNull();
    expect(room.coords).toEqual({ x: 0, y: 0, z: 0 });
    expect(currentRoom(m)).toBe(room);
  });

  it("places by movement vector and links both ways", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, fp("Square", "n s"), null, {}).room;
    const { room: b, created } = resolveRoomSeen(m, fp("North Road", "n s"), "n", {});
    expect(created).toBe(true);
    expect(b.coords).toEqual({ x: 0, y: -1, z: 0 });
    expect(a.exits.n).toEqual({ to: b.id });
    expect(b.exits.s).toEqual({ to: a.id });
  });

  it("re-walking a known edge revisits, does not duplicate", () => {
    const m = createMap();
    resolveRoomSeen(m, fp("Square", "n s"), null, {});
    const b = resolveRoomSeen(m, fp("North Road", "n s"), "n", {}).room;
    const back = resolveRoomSeen(m, fp("Square", "n s"), "s", {});
    expect(back.created).toBe(false);
    expect(currentRoom(m).id).not.toBe(b.id);
    expect(Object.keys(m.rooms).length).toBe(2);
  });

  it("closes a loop onto a matching room at the target cell", () => {
    // Square -e-> East, Square -n-> North, North -e-> should land on... a NEW
    // room at (1,-1). Then from that room go south to reach East (1,0) which
    // already exists with matching fp → link, no dup.
    const m = createMap();
    const sq = resolveRoomSeen(m, fp("Square", "n e"), null, {}).room;
    const east = resolveRoomSeen(m, fp("East", "w"), "e", {}).room; // (1,0)
    resolveRoomSeen(m, fp("Square", "n e"), "w", {});               // back to square via known edge
    const north = resolveRoomSeen(m, fp("North", "s"), "n", {}).room; // (0,-1)
    // Now walk east to (1,-1) create, then south to (1,0) == East (loop close).
    const ne = resolveRoomSeen(m, fp("NE Corner", "s w"), "e", {}).room; // (1,-1)
    const closed = resolveRoomSeen(m, fp("East", "w"), "s", {});
    expect(closed.created).toBe(false);
    expect(closed.room.id).toBe(east.id);
    expect(ne.exits.s).toEqual({ to: east.id });
    expect(east.exits.n).toEqual({ to: ne.id });
    expect(north).toBeTruthy();
    expect(sq).toBeTruthy();
  });

  it("does not merge two different rooms that share a cell target", () => {
    // Occupy (0,-1) with North(fp1); then from a *different* prev also try to
    // place a different fp at (0,-1) → must not collide onto North.
    const m = createMap();
    const sq = resolveRoomSeen(m, fp("Square", "n"), null, {}).room;
    const north = resolveRoomSeen(m, fp("North", "s"), "n", {}).room; // (0,-1)
    resolveRoomSeen(m, fp("Square", "n"), "s", {});                    // back
    // Teleport-style: set current to square, then a moved 'n' but the room that
    // shows up has a DIFFERENT fingerprint than North → new room, bumped cell.
    const other = resolveRoomSeen(m, fp("Different Hall", "s d"), "n", {});
    expect(other.created).toBe(true);
    expect(other.room.id).not.toBe(north.id);
    // North keeps its cell; the newcomer was pushed to a free cell.
    expect(getRoom(m, north.id).coords).toEqual({ x: 0, y: -1, z: 0 });
    expect(other.room.coords).not.toEqual({ x: 0, y: -1, z: 0 });
    expect(sq).toBeTruthy();
  });

  it("refreshes name/env on revisit", () => {
    const m = createMap();
    resolveRoomSeen(m, fp("Square", "n"), null, {});
    resolveRoomSeen(m, fp("North", "s"), "n", {});
    const back = resolveRoomSeen(m, { ...fp("Square", "n"), name: "Grand Square", env: "city" }, "s", {});
    expect(back.room.name).toBe("Grand Square");
    expect(back.room.env).toBe("city");
  });

  it("keeps fingerprint and GMCP rooms independent in one map", () => {
    const m = createMap();
    resolveRoomSeen(m, { key: "gmcp1", name: "GMCP Room" }, null, {});
    const { room } = resolveRoomSeen(m, fp("FP Room", "n"), null, {});
    expect(room.key).toBeNull();
    expect(room.fp).toBeTruthy();
    expect(Object.keys(m.rooms).length).toBe(2);
  });

  it("walking in through a known doorway again revisits, does not duplicate", () => {
    const m = createMap();
    const a = resolveRoomSeen(m, fp("Street", "n in"), null, {}).room;
    const shop = resolveRoomSeen(m, fp("Shop", "out"), "in", {}).room;
    expect(a.exits.in).toEqual({ to: shop.id });
    expect(shop.exits.out).toEqual({ to: a.id });
    resolveRoomSeen(m, fp("Street", "n in"), "out", {});
    const again = resolveRoomSeen(m, fp("Shop", "out"), "in", {});
    expect(again.created).toBe(false);
    expect(again.room.id).toBe(shop.id);
    expect(Object.keys(m.rooms).length).toBe(2);
  });
});
