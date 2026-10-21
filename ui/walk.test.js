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


describe("walk: links", () => {
  // 1 -e-> 2 -(Lift 12, by hand)-> 3 -n-> 4
  const lift = { name: "Lift 12" };
  const L = [
    { fromId: "1", dir: "e", toId: "2" },
    { fromId: "2", link: lift, toId: "3" },
    { fromId: "3", dir: "n", toId: "4" },
  ];

  it("safe: stops before a by-hand link and carries on from its far end", () => {
    const w = createWalk({ mode: "safe", timeoutMs: 1000 });
    expect(w.start(L, 0)).toEqual([{ type: "send", cmd: "e" }]);
    expect(w.onRoomSeen("2", 100)).toEqual([{ type: "manual", step: L[1] }]);
    expect(w.pendingDir()).toBe(null);
    // No timeout, typing doesn't cancel, a reprint of the lobby is waited out.
    expect(w.onTick(60000)).toEqual([]);
    expect(w.onUserInput()).toEqual([]);
    expect(w.onRoomSeen("2", 61000)).toEqual([]);
    expect(w.onRoomSeen("3", 62000)).toEqual([{ type: "send", cmd: "n" }]);
    expect(w.onRoomSeen("4", 62100)).toEqual([{ type: "done" }]);
  });

  it("safe: arriving somewhere else stops the walk", () => {
    const w = createWalk({ mode: "safe" });
    w.start(L, 0);
    w.onRoomSeen("2", 100);
    expect(w.onRoomSeen("9", 200)).toEqual([{ type: "aborted", reason: "off-route" }]);
  });

  it("safe: a link with a command is sent like a step", () => {
    const P2 = [{ fromId: "1", link: { cmd: "enter portal" }, toId: "2" }];
    const w = createWalk({ mode: "safe" });
    expect(w.start(P2, 0)).toEqual([{ type: "send", cmd: "enter portal" }]);
    expect(w.pendingDir()).toBe(null);
    expect(w.onRoomSeen("2", 10)).toEqual([{ type: "done" }]);
  });

  it("safe: a route that starts with a by-hand link stops at once", () => {
    const w = createWalk({ mode: "safe" });
    expect(w.start(L.slice(1), 0)).toEqual([{ type: "manual", step: L[1] }]);
  });

  it("batched: sends each stretch between by-hand links as one line", () => {
    const w = createWalk({ mode: "batched", separator: ";", timeoutMs: 1000 });
    expect(w.start(L, 0)).toEqual([{ type: "send", cmd: "e" }]);
    expect(w.onRoomSeen("2", 10)).toEqual([{ type: "manual", step: L[1] }]);
    expect(w.onTick(999999)).toEqual([]);
    expect(w.onRoomSeen("3", 20)).toEqual([{ type: "send", cmd: "n" }]);
    expect(w.pendingDir()).toBe("n");
    expect(w.onRoomSeen("4", 30)).toEqual([{ type: "done" }]);
  });

  it("batched: a command link rides in the line", () => {
    const P2 = [
      { fromId: "1", dir: "e", toId: "2" },
      { fromId: "2", link: { cmd: "enter portal" }, toId: "3" },
    ];
    const w = createWalk({ mode: "batched", separator: ";" });
    expect(w.start(P2, 0)).toEqual([{ type: "send", cmd: "e;enter portal" }]);
  });

  it("delay: lets the steps before a link land, then waits for its far end", () => {
    const w = createWalk({ mode: "delay", delayMs: 250 });
    expect(w.start(L, 0)).toEqual([{ type: "send", cmd: "e" }]);
    expect(w.onTick(250)).toEqual([{ type: "manual", step: L[1] }]);
    expect(w.onTick(500)).toEqual([]);
    expect(w.pendingDir()).toBe("e");
    expect(w.onRoomSeen("2", 300)).toEqual([]);   // the e step lands
    expect(w.pendingDir()).toBe(null);
    expect(w.onRoomSeen("3", 900)).toEqual([{ type: "send", cmd: "n" }]);
    expect(w.onTick(1149)).toEqual([]);
    expect(w.onTick(1150)).toEqual([{ type: "done" }]);
  });
});
