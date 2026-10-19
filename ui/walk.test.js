import { describe, it, expect } from "vitest";
import { createWalk } from "./walk.js";

const P = [
  { fromId: "1", dir: "e", toId: "2" },
  { fromId: "2", dir: "n", toId: "3" },
];

describe("walk: safe mode", () => {
  it("sends step by step, advancing on confirmed arrivals, then done", () => {
    const w = createWalk({ mode: "safe", timeoutMs: 1000 });
    expect(w.start(P, 0)).toEqual([{ type: "send", cmd: "e" }]);
    expect(w.pendingDir()).toBe("e");
    expect(w.onRoomSeen("2", 100)).toEqual([{ type: "send", cmd: "n" }]);
    expect(w.pendingDir()).toBe("n");
    expect(w.onRoomSeen("3", 200)).toEqual([{ type: "done" }]);
    expect(w.isActive()).toBe(false);
  });

  it("aborts on a per-step timeout", () => {
    const w = createWalk({ mode: "safe", timeoutMs: 1000 });
    w.start(P, 0);
    expect(w.onTick(500)).toEqual([]);
    expect(w.onTick(1000)).toEqual([{ type: "aborted", reason: "timeout" }]);
  });

  it("aborts when arriving at an unexpected room", () => {
    const w = createWalk({ mode: "safe", timeoutMs: 1000 });
    w.start(P, 0);
    expect(w.onRoomSeen("9", 100)).toEqual([{ type: "aborted", reason: "off-route" }]);
  });
});

describe("walk: delay mode", () => {
  it("advances on the clock, ignoring arrivals", () => {
    const w = createWalk({ mode: "delay", delayMs: 250 });
    expect(w.start(P, 0)).toEqual([{ type: "send", cmd: "e" }]);
    expect(w.onRoomSeen("2", 10)).toEqual([]);
    expect(w.onTick(100)).toEqual([]);
    expect(w.onTick(250)).toEqual([{ type: "send", cmd: "n" }]);
    expect(w.onTick(500)).toEqual([{ type: "done" }]);
  });

  it("places each arrival along the dir that reached it, even when the clock already sent the next step", () => {
    const w = createWalk({ mode: "delay", delayMs: 250 });
    w.start(P, 0);                                        // sends step 0; drain=0
    expect(w.pendingDir()).toBe("e");                    // first arrival places along step 0
    expect(w.onTick(250)).toEqual([{ type: "send", cmd: "n" }]);  // clock sends step 1 first (high latency)
    expect(w.pendingDir()).toBe("e");                    // step-0 arrival must STILL place along "e"
    w.onRoomSeen("2", 300);                              // arrival advances the placement cursor
    expect(w.pendingDir()).toBe("n");                    // next arrival places along step 1
  });
});

describe("walk: batched mode", () => {
  it("sends one joined line and drains arrivals to done", () => {
    const w = createWalk({ mode: "batched", separator: ";" });
    expect(w.start(P, 0)).toEqual([{ type: "send", cmd: "e;n" }]);
    expect(w.pendingDir()).toBe("e");
    expect(w.onRoomSeen("2", 10)).toEqual([]);
    expect(w.pendingDir()).toBe("n");
    expect(w.onRoomSeen("3", 20)).toEqual([{ type: "done" }]);
  });
});

describe("walk: control", () => {
  it("aborts on user input when abortOnInput is set (default)", () => {
    const w = createWalk({ mode: "safe" });
    w.start(P, 0);
    expect(w.onUserInput()).toEqual([{ type: "aborted", reason: "user-input" }]);
  });

  it("ignores user input when abortOnInput is false", () => {
    const w = createWalk({ mode: "safe", abortOnInput: false });
    w.start(P, 0);
    expect(w.onUserInput()).toEqual([]);
    expect(w.isActive()).toBe(true);
  });

  it("stop() aborts a running walk", () => {
    const w = createWalk({ mode: "delay" });
    w.start(P, 0);
    expect(w.stop()).toEqual([{ type: "aborted", reason: "stopped" }]);
  });

  it("an empty path completes immediately", () => {
    const w = createWalk({ mode: "safe" });
    expect(w.start([], 0)).toEqual([{ type: "done" }]);
    expect(w.isActive()).toBe(false);
  });
});

describe("walk: in/out steps", () => {
  it("sends in and out as commands like any other step", () => {
    const path = [
      { fromId: "1", dir: "in", toId: "2" },
      { fromId: "2", dir: "out", toId: "1" },
    ];
    const w = createWalk({ mode: "safe", timeoutMs: 1000 });
    expect(w.start(path, 0)).toEqual([{ type: "send", cmd: "in" }]);
    expect(w.onRoomSeen("2", 10)).toEqual([{ type: "send", cmd: "out" }]);
    const b = createWalk({ mode: "batched", separator: ";" });
    expect(b.start(path, 0)).toEqual([{ type: "send", cmd: "in;out" }]);
  });
});

