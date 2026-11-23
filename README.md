# Hollowstone

An original block-building sandbox that runs in your browser. Dig, build and explore an endless world of blocks.

**Play:** https://vibratingcode.github.io/hollowstone/
**Dev hub (devlog, roadmap, changelog):** https://vibratingcode.github.io/hollowstone-hub/#/p/hollowstone

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Space | Jump · double-tap to toggle flying |
| Shift | Sneak (won't walk off edges) · fly down |
| Ctrl or R | Sprint |
| Left mouse | Break block |
| Right mouse | Place block |
| Middle mouse | Pick the block you're looking at |
| 1–9 / wheel | Choose hotbar slot |
| E | Block picker |
| F | Toggle flying |
| F3 | Debug info |
| Esc | Pause menu and settings |

## What's in 0.1.0

- Infinite, seeded world streamed in 16×16×128 chunks
- Biomes: Meadow, Duskwood (violet forests), Dunes, Frostland, Peaks, Shore, Ocean
- Caves, plus deep **hollows**: huge caverns lit by glowing Lumen crystals
- 19 original blocks with procedurally painted textures (no third-party art)
- Smooth ambient occlusion and sky-light shading, so caves are dark
- Walking, jumping, sprinting, sneaking, swimming and flying, with proper voxel collision
- Break and place blocks; worlds save automatically in your browser (IndexedDB)
- World list: create (with optional seed), play and delete worlds
- Settings: render distance, field of view, mouse sensitivity

## Running locally

No build step. Serve the folder and open it:

```
python3 -m http.server 8000
```

## Tests

The engine (noise, worldgen, meshing, raycasting, physics) is plain JS with no dependencies:

```
node tests/core.test.mjs
node tests/world.test.mjs
```

## Code map

| File | What it does |
| --- | --- |
| `src/noise.js` | Seeded simplex noise and hashes |
| `src/blocks.js` | Block registry |
| `src/chunk.js` | Chunk layout |
| `src/worldgen.js` | Terrain, biomes, caves, hollows, ores, trees |
| `src/mesher.js` | Face culling, ambient occlusion, sky light |
| `src/world.js` | Chunk streaming, edits, mesh queue |
| `src/player.js` | Movement and collision |
| `src/raycast.js` | Block targeting |
| `src/textures.js` | Procedural texture atlas and hotbar icons |
| `src/save.js` | IndexedDB saves |
| `src/main.js` | Renderer, input, HUD, menus, game loop |

Hollowstone is an independent, original project, not affiliated with any other game or studio. See [CREDITS.md](CREDITS.md).
