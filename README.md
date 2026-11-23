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
| G | Graphics: Fancy / Fast |
| F | Toggle flying |
| F3 | Debug info |
| Esc | Pause menu and settings |

## What's in 0.2.0: The Light Update

- **Day and night**: sun, moon, stars, sunsets; day length and time of day in settings
- **Real-time shadows** from the sun and moon
- **Living water**: waves, sky reflections, sun glints
- **HDR + bloom + ACES** tone mapping: Lumen, Glowcaps and the sun really glow
- **Pixel clouds**, **wind** on leaves and plants, **fireflies** at night, light **motes** in the hollows
- **Flora**: Bellgrass, Emberbloom, Frostbell, Glowcap
- Held block, view bob, sprint FOV kick, break particles
- Cinematic title-screen flyover
- Chunk meshing on **Web Workers**

And from 0.1: an endless seeded world, seven biomes, caves and the Lumen-lit **hollows**, 23 original
blocks with procedurally painted textures, voxel physics, building, and IndexedDB saves.

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
| `src/mesh.worker.js` | Off-thread chunk meshing |
| `src/render/sky.js` | Day/night cycle, sky dome, sun, moon, stars |
| `src/render/materials.js` | Lit terrain (shadows, block light, wind) and water shaders |
| `src/render/clouds.js` | Pixel clouds |
| `src/render/effects.js` | Break particles, fireflies, motes |
| `src/render/hand.js` | Held block |
| `src/render/post.js` | Bloom and tone mapping |
| `src/main.js` | Renderer, input, HUD, menus, game loop |

Hollowstone is an independent, original project, not affiliated with any other game or studio. See [CREDITS.md](CREDITS.md).
