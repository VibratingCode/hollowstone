// Terrain generation: biomes, strata, caves, lumen crystals, ores and trees.
// Pure: same seed + chunk coords => same blocks. Safe to move into a Web Worker later.

import { createNoise, hash2, hash3 } from "./noise.js";
import { B } from "./blocks.js";
import { CX, CZ, H, SEA, idx, VOLUME } from "./chunk.js";

export const BIOME = { OCEAN: 0, BEACH: 1, MEADOW: 2, DUSKWOOD: 3, DUNES: 4, FROST: 5, PEAKS: 6 };
export const BIOME_NAMES = ["Ocean", "Shore", "Meadow", "Duskwood", "Dunes", "Frostland", "Peaks"];

export function createGenerator(seed) {
  const n = createNoise(seed);
  const n2 = createNoise((seed ^ 0x9e3779b9) >>> 0);

  // Column terrain: height + biome. Pure function of world x/z.
  function column(wx, wz) {
    const cont = n.fbm2(wx / 700, wz / 700, 4);
    const hills = n.fbm2(wx / 190 + 31.7, wz / 190 - 12.3, 4);
    const detail = n.fbm2(wx / 42, wz / 42, 3);
    const ridge = 1 - Math.abs(n2.noise2(wx / 380, wz / 380));
    const mountain = Math.pow(Math.max(0, ridge), 3) * Math.max(0, cont + 0.15);

    let h = SEA + 3 + cont * 20 + hills * 9 + detail * 2.5 + mountain * 62;
    h = Math.max(4, Math.min(H - 8, Math.round(h)));

    const temp = n2.fbm2(wx / 950 + 400, wz / 950 - 220, 3) - (h - SEA) / 140;
    const moist = n2.fbm2(wx / 820 - 900, wz / 820 + 77, 3);

    let biome;
    if (h < SEA - 1) biome = BIOME.OCEAN;
    else if (h <= SEA + 1 && temp > -0.35) biome = BIOME.BEACH;
    else if (h > 92) biome = BIOME.PEAKS;
    else if (temp < -0.28) biome = BIOME.FROST;
    else if (temp > 0.3 && moist < 0.05) biome = BIOME.DUNES;
    else if (moist > 0.18) biome = BIOME.DUSKWOOD;
    else biome = BIOME.MEADOW;
    return { h, biome };
  }

  function isCave(wx, y, wz, h) {
    if (y < 3 || y > h) return false;
    // keep the sea floor and shorelines sealed so water doesn't hang over voids
    if (h <= SEA + 2 && y > h - 6) return false;
    const a = n.noise3(wx / 38, y / 22, wz / 38);
    const b = n2.noise3(wx / 38 + 71, y / 22, wz / 38 - 19);
    const tunnel = a * a + b * b;
    const depthBias = y > h - 4 ? 0.006 : 0; // fewer holes right at the surface
    if (tunnel < 0.011 - depthBias) return true;
    // the "hollows": big lumen-lit caverns deep down
    if (y < 46) {
      const c = n.noise3(wx / 85 + 300, y / 34, wz / 85 - 300);
      if (c > 0.6 - Math.max(0, (30 - y)) * 0.004) return true;
    }
    return false;
  }

  function surfaceBlocks(biome, h) {
    switch (biome) {
      case BIOME.OCEAN: return [h < SEA - 6 ? B.LOAM : B.SILTSAND, B.SILTSAND];
      case BIOME.BEACH: return [B.SILTSAND, B.SILTSAND];
      case BIOME.DUNES: return [B.SILTSAND, B.SILTSAND];
      case BIOME.FROST: return [B.FROSTTURF, B.LOAM];
      case BIOME.PEAKS: return [h > 100 ? B.SNOWPACK : B.SLATE, B.SLATE];
      default: return [B.TURF, B.LOAM];
    }
  }

  function generate(cx, cz) {
    const blocks = new Uint8Array(VOLUME);
    const ox = cx * CX, oz = cz * CZ;
    const cols = new Array(CX * CZ);

    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        const wx = ox + x, wz = oz + z;
        const col = column(wx, wz);
        cols[z * CX + x] = col;
        const { h, biome } = col;
        const [surface, filler] = surfaceBlocks(biome, h);
        const basaltTop = 10 + Math.floor(hash2(wx, wz, 3) * 4);
        const fillerDepth = biome === BIOME.DUNES ? 5 : 3;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash3(wx, y, wz, 11) < 0.5)) id = B.DEEPCORE;
          else if (y === h) id = surface;
          else if (y > h - fillerDepth) id = filler;
          else if (y < basaltTop) id = B.BASALT;
          else id = hash3(wx, y, wz, 5) < 0.010 && y < 56 ? B.EMBERORE : B.SLATE;

          if (id !== B.DEEPCORE && isCave(wx, y, wz, h)) id = B.AIR;
          blocks[idx(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) {
          if (blocks[idx(x, y, z)] === B.AIR) blocks[idx(x, y, z)] = B.WATER;
        }
      }
    }

    // Lumen crystals grow on hollow walls and floors deep underground.
    for (let y = 4; y < 36; y++) {
      for (let z = 0; z < CZ; z++) {
        for (let x = 0; x < CX; x++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b !== B.SLATE && b !== B.BASALT) continue;
          const exposed = blocks[i + CX * CZ] === B.AIR || (x > 0 && blocks[i - 1] === B.AIR) ||
            (x < CX - 1 && blocks[i + 1] === B.AIR) || (z > 0 && blocks[i - CX] === B.AIR) ||
            (z < CZ - 1 && blocks[i + CX] === B.AIR);
          if (exposed && hash3(ox + x, y, oz + z, 21) < 0.02) blocks[i] = B.LUMEN;
        }
      }
    }

    // flora on the surface, glowcaps on hollow floors
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        const wx = ox + x, wz = oz + z;
        const { h, biome } = cols[z * CX + x];
        if (h + 1 < H && blocks[idx(x, h + 1, z)] === B.AIR) {
          const ground = blocks[idx(x, h, z)], r = hash2(wx, wz, 31);
          let plant = 0;
          if (ground === B.TURF) {
            if (biome === BIOME.DUSKWOOD) plant = r < 0.012 ? B.GLOWCAP : r < 0.09 ? B.BELLGRASS : 0;
            else plant = r < 0.018 ? B.EMBERBLOOM : r < 0.2 ? B.BELLGRASS : 0;
          } else if (ground === B.FROSTTURF) plant = r < 0.035 ? B.FROSTBELL : r < 0.07 ? B.BELLGRASS : 0;
          if (plant) blocks[idx(x, h + 1, z)] = plant;
        }
        for (let y = 4; y < Math.min(h - 3, 44); y++) {
          const i = idx(x, y, z);
          if (blocks[i] === B.AIR && (blocks[i - CX * CZ] === B.SLATE || blocks[i - CX * CZ] === B.BASALT) &&
            hash3(wx, y, wz, 41) < 0.04) blocks[i] = B.GLOWCAP;
        }
      }
    }

    placeTrees(blocks, cx, cz);
    return blocks;
  }

  function treeAt(wx, wz) {
    const col = column(wx, wz);
    const { h, biome } = col;
    if (h <= SEA + 1 || h > 96) return null;
    let density = 0;
    if (biome === BIOME.MEADOW) density = 0.006;
    else if (biome === BIOME.DUSKWOOD) density = 0.035;
    else if (biome === BIOME.FROST) density = 0.004;
    if (density === 0 || hash2(wx, wz, 7) >= density) return null;
    if (isCave(wx, h, wz, h)) return null;
    const dusk = biome === BIOME.DUSKWOOD || biome === BIOME.FROST;
    const r = hash2(wx, wz, 8);
    return { h, dusk, height: dusk ? 6 + Math.floor(r * 4) : 4 + Math.floor(r * 3) };
  }

  function placeTrees(blocks, cx, cz) {
    const ox = cx * CX, oz = cz * CZ, R = 3;
    const put = (wx, y, wz, id, onlyAir) => {
      const x = wx - ox, z = wz - oz;
      if (x < 0 || x >= CX || z < 0 || z >= CZ || y < 0 || y >= H) return;
      const i = idx(x, y, z);
      if (onlyAir && blocks[i] !== B.AIR) return;
      blocks[i] = id;
    };
    for (let wz = oz - R; wz < oz + CZ + R; wz++) {
      for (let wx = ox - R; wx < ox + CX + R; wx++) {
        const t = treeAt(wx, wz);
        if (!t) continue;
        const wood = t.dusk ? B.DUSKWOOD : B.BARKWOOD;
        const leaf = t.dusk ? B.DUSKCANOPY : B.CANOPY;
        const base = t.h + 1, topY = base + t.height - 1;
        put(wx, t.h, wz, B.LOAM, false);
        if (t.dusk) {
          // tall cone
          for (let y = base + 2; y <= topY + 1; y++) {
            const rr = Math.max(0, Math.round((topY + 1 - y) * 0.45)) + (y === topY + 1 ? 0 : 1);
            for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
              if (Math.abs(dx) + Math.abs(dz) > rr + (rr > 1 ? 1 : 0)) continue;
              put(wx + dx, y, wz + dz, leaf, true);
            }
          }
        } else {
          // round puff
          for (let dy = -2; dy <= 1; dy++) {
            const rr = dy >= 0 ? 1 : 2;
            for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
              if (rr === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(wx + dx, dy, wz + dz, 9) < 0.7) continue;
              put(wx + dx, topY + dy, wz + dz, leaf, true);
            }
          }
          put(wx, topY + 2, wz, leaf, true);
        }
        for (let y = base; y <= topY; y++) put(wx, y, wz, wood, false);
      }
    }
  }

  return { generate, column };
}
