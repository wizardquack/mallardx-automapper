import { describe, it, expect } from "vitest";
import { createMap, getRoomByKey, currentRoom } from "./graph.js";
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
});
