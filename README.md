# Mallard Automapper

A universal, GMCP-first automapper for Mallard. Builds a live 2D map as you
walk on any MUD that emits `room.info` GMCP (Discworld, IRE-style muds, and
many others) — zero configuration.

## Status

Phase 1 (core auto-map) + areas shipped: auto-maps and links rooms as you
move, groups spatially-disjoint regions into separate areas (one shown at a
time, auto-following you), renders a live top-down map, persisted per world.
Speedwalk, manual editing, z-levels, and non-GMCP fingerprint mapping land in
later phases.

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
