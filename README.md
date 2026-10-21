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
- **`wrap`** (extension) — `{x: n}` beside `coords`, where the room's x comes
  round at n (a ring: x n-1 sits beside x 0). The ring is drawn centred on the
  room you're in, each room at the x nearest yours, so its seam is always on
  the far side; a way across that side runs off each edge, dashed.
- **`area`** (extension) — the area's key: rooms are grouped by it, one area
  shown at a time.
- **`areaName`** (extension) — the area's name, shown in the area picker. If
  it changes, the label follows; `area` stays the key.

- **`terrain`** — the room's terrain id; its label and colour come from
  `mudstd.room.terrain` (`[{id, label, color}]`), which the mapper keeps with
  the map.
- **`tags`** (extension) — what's in the room, as a list of words (`market`,
  `bank`, `lift`, `charger`…). Well-known ones get a glyph; all show on hover.
  IRE's `room.info` `details` are read the same way.
- **`region`** / **`regionName`** (extension) — the part of the area the room
  is in (a district, a quarter) and what to call it: drawn as a tint behind
  its rooms, with its name over them.

`in` and `out` are exits with no compass direction: the map stores them, and
`/goto`, click-to-walk and the speedwalk route through them (sending `in` and
`out`), but they don't place rooms or draw lines — the room through a hatch
is placed by its own coords, or the area's first free cell.

## Status

Phases 1–4 shipped, plus annotations (0.6.0: terrain colours, tags, regions,
labels, legend, hover cards, your own colours/symbols/notes) and (0.5.0) mudstd preference, server coordinates,
direction inference, in/out routing and area names: auto-maps and links rooms
as you move, groups
spatially-disjoint regions into separate areas (one shown at a time,
auto-following you), speedwalk/pathfinding (`/goto`, click-to-walk, three pacing
modes), manual editing, z-levels, and — new in Phase 4 — **non-GMCP capture** so
the mapper works on MUDs that don't emit `room.info`. The map renders live
top-down and is persisted per world.

## Annotations (0.6.0)

Rooms are filled by, in order: your own colour; the server's colour for the
room's terrain; a built-in colour for a well-known terrain word (`forest`,
`road`, `water`, `indoors`, `corridor`…); a colour hashed from the terrain;
grey. A glyph marks what's there — your symbol, else the first well-known tag:

| | | | |
|---|---|---|---|
| `★` start | `⇅` lift | `$` shop, market | `¤` bank |
| `+` healer, clinic | `⌂` inn, bunkhouse | `✉` post | `⚑` dock, berth |
| `ϟ` charger | `⚒` workshop, machines | `▣` freight, storage | `i` terminal, info |
| `!` quest | `†` trainer, guild | | |

Room names are drawn at the two largest zooms and region names from the
middle one; **Aa** turns both off. **?** opens a legend of the terrains,
glyphs and regions in view. Hover a room for its name, region, terrain, tags
and note. Search matches notes and tags too (`market` finds the market).

Right-click a room for **Colour ▸** (swatches, custom hex, clear),
**Symbol…** (one or two characters) and **Add note…**. These are yours: the
server's frames never change them.

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
