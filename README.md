# Mallard Automapper

A universal, GMCP-first automapper for Mallard. Builds a live 2D map as you
walk on any MUD that emits room GMCP — the generic `room.info` package
(Discworld, IRE-style muds) or the mudstandards.org `mudstd.room` package
(string room ids + explicit exits) — zero configuration. MUDs without GMCP are
covered by name+exits capture (see below).

Both GMCP packages are advertised on connect; `mudstd.room`'s explicit exits
(each carrying the neighbour's id) let the mapper link rooms and close loops
without walking every corridor.

## Status

Phases 1–4 shipped: auto-maps and links rooms as you move, groups
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
