import { describe, it, expect } from "vitest";
import { createMoveQueue } from "./movequeue.js";
import { createMap, getRoomByKey } from "./graph.js";
import { resolveRoomSeen, contradicts } from "./identity.js";

describe("move queue", () => {
  it("answers a burst of moves oldest-first", () => {
    const q = createMoveQueue();
    for (const d of ["n", "n", "e", "e"]) q.push(d);
    expect([q.shift(), q.shift(), q.shift(), q.shift(), q.shift()])
      .toEqual(["n", "n", "e", "e", null]);
  });

  it("peek does not consume; clear empties", () => {
    const q = createMoveQueue();
    q.push("n"); q.push("s");
    expect(q.peek()).toBe("n");
    expect(q.size()).toBe(2);
    q.clear();
    expect(q.peek()).toBe(null);
  });

  it("caps its length, dropping the oldest", () => {
    const q = createMoveQueue(2);
    q.push("n"); q.push("e"); q.push("s");
    expect([q.shift(), q.shift()]).toEqual(["e", "s"]);
  });

  it("a paced burst maps each room by the move that reached it", () => {
    const m = createMap();
    const q = createMoveQueue();
    resolveRoomSeen(m, { key: "A", name: "A" }, null);
    for (const d of ["n", "n", "e"]) q.push(d);       // all sent before any arrival
    resolveRoomSeen(m, { key: "B", name: "B" }, q.shift());
    resolveRoomSeen(m, { key: "C", name: "C" }, q.shift());
    resolveRoomSeen(m, { key: "D", name: "D" }, q.shift());
    const [a, b, c, d] = ["A", "B", "C", "D"].map((k) => getRoomByKey(m, k));
    expect(a.exits.n.to).toBe(b.id);
    expect(b.exits.n.to).toBe(c.id);
    expect(c.exits.e.to).toBe(d.id);
    expect(d.coords).toEqual({ x: 1, y: -2, z: 0 });
  });
});

describe("contradicts", () => {
  function line() {
    const m = createMap();
    resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "s", toKey: "Z" }] }, null);
    resolveRoomSeen(m, { key: "B", name: "B" }, "n");
    resolveRoomSeen(m, { key: "A", name: "A", exits: [{ dir: "s", toKey: "Z" }] }, "s");
    return m;   // at A; A —n→ B walked, A —s→ Z reported
  }

  it("is false when the direction matches what the map knows", () => {
    const m = line();
    expect(contradicts(m, "n", "B")).toBe(false);
    expect(contradicts(m, "s", "Z")).toBe(false);
  });

  it("is true when a walked edge leads elsewhere", () => {
    expect(contradicts(line(), "n", "Q")).toBe(true);
  });

  it("is true when a reported exit leads elsewhere", () => {
    expect(contradicts(line(), "s", "B")).toBe(true);
  });

  it("is true when an unexplored dir arrives where a known exit leads", () => {
    expect(contradicts(line(), "e", "B")).toBe(true);
  });

  it("is false for an unexplored dir into an unknown room, or a re-report", () => {
    const m = line();
    expect(contradicts(m, "e", "NEW")).toBe(false);
    expect(contradicts(m, "n", "A")).toBe(false);
  });
});
