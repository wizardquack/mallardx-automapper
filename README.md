# Mallard Automapper

A universal, GMCP-first automapper for Mallard. Builds a live 2D map as you
walk on any MUD that emits `room.info` GMCP (Discworld, IRE-style muds, and
many others) — zero configuration.

## Status

Phase 1 (core auto-map): auto-creates and links rooms as you move, renders a
live top-down map with "you are here", persisted per world. Speedwalk,
manual editing, areas/z-levels, and non-GMCP fingerprint mapping land in later
phases.

## Development

```sh
npm install
npm test        # vitest — pure JS engine (graph, identity, render layout)
npm run test:lua  # plain-Lua tests for the adapter's pure modules
```
