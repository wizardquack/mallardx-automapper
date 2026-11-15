# mudstd.relief: a ground grid behind the map (2026-11-14)

The wire format for sending the ground under an area (heights and ground
terrain on a grid) to a client that draws it behind its map, and how this
automapper draws it.

## Package and negotiation

- New GMCP package **`mudstd.relief`**, version 1. The automapper advertises
  `mudstd.relief 1` and adds `mudstd.relief.patch` to `gmcp_access`. A server
  sends patches only to a client that advertised it (opt-in, like `mudstd.map`).
- One message: **`mudstd.relief.patch`**.

## The grid

Each area (the room frames' `area` key) and floor has one notional grid in the
area's own map units (the same units as rooms' `coords`, north +y, east +x).
Cell centres sit at whole multiples of `cell`: the cell (i, j) is centred at
x = i·cell, y = j·cell. A patch is a rectangle of that grid; patches are merged
into what the client already holds. Nothing in it is particular to one game or
to worlds: no lat/lon, no km.

```json
mudstd.relief.patch {
  "area": "wilds",
  "z": 0,
  "cell": 0.5,
  "x": 4.0, "y": 6.5,
  "cols": 12, "rows": 10,
  "height": "<base64>",
  "ground": { "ids": ["dust", "stones", "sea"], "data": "<base64>" }
}
```

| Field | Meaning |
|---|---|
| `area` | The area key, as on room frames. |
| `z` | The floor it lies under; default 0. |
| `cell` | Map units between cell centres. Positive. A client keeps one grid per (area, z, cell); patches with another `cell` for the same area and floor replace it. |
| `x`, `y` | The centre of the patch's **north-west** cell, each a whole multiple of `cell` (within rounding). |
| `cols`, `rows` | Patch size. Row 0 is the northernmost; rows go south (y decreasing), columns go east. At most 64×64 per patch. |
| `height` | Heights in metres, row-major, `cols·rows` values: **base64 of little-endian int16**, or a plain JSON array of integers. **-32768 (or `null` in an array) = unknown**: the client leaves that cell as it was. |
| `ground` | Optional. `ids` lists terrain ids (from `mudstd.room.terrain`; a server may define terrains no room uses, e.g. `sea`); `data` is base64 of one uint8 per cell (or a JSON array) indexing `ids`, **255 (or `null`) = unknown**. A cell known in `height` but unknown in `ground` has no ground colour. |

- **Merging:** known cells overwrite what the client held; unknown cells never
  erase. A client may clear an area's grid when the user deletes the area.
- **Wrap:** where the area's rooms say x wraps (`wrap.x`), the grid's x wraps
  the same way; the client stores x modulo the wrap and draws it at the x
  nearest the current room, as it does rooms. A server sends a patch in the
  same x frame as the room it surrounds.
- **What to reveal is the server's call.** The client draws only cells it has
  been sent and keeps them (persisted with the map, like charts).

## What a server reveals

That's each server's own policy. A typical one: send a patch round a place
each time a character arrives there, and on login (or `Core.Supports.Set`) the
patches near where the character is, so a fresh or cleared client map
refills.

## The automapper's drawing

- Under the rooms, links and region patches, for the floor in view: the known
  cells filled with their ground colour (subtle, so rooms stay primary),
  **hill shading** (light from the north-west) and thin **contour lines** at an
  interval chosen from the height range in view (e.g. 5/10/25/50/100 m).
  Unknown cells are left as background, edges softened.
- **Fallback:** for an area with rooms that have `elevation` but no relief
  grid near them, estimate a height field from the rooms (e.g. inverse-distance
  weighting) only within ~1.5 room spacings of rooms, fading out, and draw shading
  and contours from that (no ground fill, since that comes only from a grid).
- The existing ◭ height toggle turns all of this off with the room shading.
