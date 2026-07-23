import { describe, it, expect } from "vitest";
import { createHistory } from "./history.js";

describe("createHistory", () => {
  it("undoes to the pushed snapshot and redoes back", () => {
    const h = createHistory();
    h.push("A");                       // pre-edit state A, map is now B
    expect(h.canUndo()).toBe(true);
    expect(h.undo("B")).toBe("A");     // restore A, current B goes to redo
    expect(h.canUndo()).toBe(false);
    expect(h.redo("A")).toBe("B");     // restore B
  });
  it("returns null at the stack boundaries", () => {
    const h = createHistory();
    expect(h.undo("X")).toBeNull();
    expect(h.redo("X")).toBeNull();
  });
  it("clears the redo stack on a new push", () => {
    const h = createHistory();
    h.push("A");
    h.undo("B");        // redo now has B
    h.push("C");        // new edit — redo cleared
    expect(h.canRedo()).toBe(false);
  });
  it("evicts the oldest snapshot past the limit", () => {
    const h = createHistory({ limit: 2 });
    h.push("1"); h.push("2"); h.push("3"); // "1" evicted
    expect(h.undo("cur")).toBe("3");
    expect(h.undo("3")).toBe("2");
    expect(h.undo("2")).toBeNull();        // "1" was dropped
  });
  it("clear empties both stacks", () => {
    const h = createHistory();
    h.push("A");
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.undo("B")).toBeNull();
  });
});
