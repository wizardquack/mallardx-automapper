# Mallard Automapper

A universal, GMCP-first automapper for Mallard. Builds a live 2D map as you
walk on any MUD that emits room GMCP — the generic `room.info` package
(Discworld, IRE-style muds) or the mudstandards.org `mudstd.room` package
(string room ids + explicit exits) — zero configuration. MUDs without GMCP are
covered by name+exits capture (see below).

Both GMCP packages are advertised on connect. `mudstd.room` is preferred: once
a session has seen a `mudstd.room.info` frame, `room.info` is ignored until the
next connect, so a server that sends both has each move mapped once, from the
richer frame.

## What the mapper reads from `mudstd.room.info`

- **`exits`** — each exit carries the neighbour's id, so the mapper links rooms
  and closes loops without walking every corridor. `IN` and `OUT` are kept.
- **Direction inference.** The mapper places a new room by the direction you
  moved. A typed compass word (`n`, `southwest`, `up`, `in`…) is used as-is;
  without one — a game's own direction words, a clicked link, a multi-step
  command — the direction is the previous room's exit that leads to the room
  you arrived in. So rooms take their shape on any mudstd server without
  typing compass words.
- **`coords`** (extension) — `{x, y, z}`, the room's place in the server's own
  layout (also accepted as an `[x, y, z]` array on `room.info`), with east +x,
  north +y and up +z. A room that
  arrives with coords is placed there, and moved there if the mapper had put
  it somewhere else; any room the server didn't place that sat in that cell
  is moved aside. Without coords, rooms are placed by movement as usual.
- **`area`** (extension) — the area's key: rooms are grouped by it, one area
  shown at a time.
- **`areaName`** (extension) — the area's name, shown in the area picker. If
  it changes, the label follows; `area` stays the key.

`in` and `out` are exits with no compass direction: the map stores them, and
`/goto`, click-to-walk and the speedwalk route through them (sending `in` and
`out`), but they don't place rooms or draw lines — the room through a hatch
is placed by its own coords, or the area's first free cell.

## Status

Phases 1–4 shipped, plus (0.5.0) mudstd preference, server coordinates,
direction inference, in/out routing and area names: auto-maps and links rooms
as you move, groups
spatially-disjoint regions into separate areas (one shown at a time,
auto-following you), speedwalk/pathfinding (`/goto`, click-to-walk, three pacing
modes), manual editing, z-levels, and — new in Phase 4 — **non-GMCP capture** so
the mapper works on MUDs that don't emit `room.info`. The map renders live
top-down and is persisted per world.

## Non-GMCP MUDs (Phase 4)

On a MUD without `room.info` GMCP, the mapper identifies each room by a
*fingerprint* of its name + exits and places it by movement vector — the same
graph, just a different identity source.

1. `/map learn` — every incoming line streams into the Map panel. Walk into a
   room, then click **Name** on its title line and **Exits** on its exits line.
   The panel infers a regex for each.
2. Paste the two regexes into **Settings → Automapper** (*Room-name pattern* /
   *Exits pattern*), optionally set a *Movement-failure pattern* (e.g.
   `^You can't go that way`), turn on **Non-GMCP capture**, and reload the plugin.

Leave capture **off** on GMCP worlds (Discworld/IRE) — it isn't needed there.

## Editing the map (Phase 3)

Right-click any room for the edit menu:

- **Rename…**, **Set as current**, **Merge into…** (then click the duplicate's twin), **Delete room**.
- **Exits ▸** — delete an exit, toggle one-way/two-way, or **Add exit ▸** a direction then click the target room.
- **Move to area ▸** / **Move connected pocket ▸** — reassign a room, or flood-fill an enclosed pocket and confirm the highlighted set before moving it.
- **Drag** a room to reposition it (snaps to the grid; occupied cells are rejected).
- **Cmd/Ctrl+Z** undo, **Cmd/Ctrl+Shift+Z** redo. A real in-game movement clears the undo history.

## Development

```sh
npm install
npm test        # vitest — pure JS engine (graph, identity, render layout)
npm run test:lua  # plain-Lua tests for the adapter's pure modules
```
