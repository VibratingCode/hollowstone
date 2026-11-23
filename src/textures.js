// Procedurally painted texture atlas. Every tile is generated from code with Hollowstone's own
// palette, so there are no third-party texture assets anywhere in the game.

import { mulberry32 } from "./noise.js";
import { T, BLOCKS } from "./blocks.js";
import { ATLAS_COLS, ATLAS_ROWS } from "./mesher.js";

const S = 16; // tile size in pixels

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const clamp = (v) => Math.max(0, Math.min(255, v | 0));

function makeTile(seed) {
  const data = new Uint8ClampedArray(S * S * 4);
  const rand = mulberry32(seed);
  const t = {
    data, rand,
    set(x, y, c, a = 255) {
      x = ((x % S) + S) % S; y = ((y % S) + S) % S;
      const i = (y * S + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a;
    },
    get(x, y) { const i = (y * S + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; },
    fill(base, vary = 14, alpha = 255) {
      const b = hex(base);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = (rand() - 0.5) * 2 * vary;
        t.set(x, y, [clamp(b[0] + d), clamp(b[1] + d), clamp(b[2] + d)], alpha);
      }
    },
    speck(color, count, alpha = 255) {
      const c = hex(color);
      for (let i = 0; i < count; i++) t.set((rand() * S) | 0, (rand() * S) | 0, c, alpha);
    },
    shade(x, y, amt) {
      const p = t.get(((x % S) + S) % S, ((y % S) + S) % S);
      t.set(x, y, [clamp(p[0] + amt), clamp(p[1] + amt), clamp(p[2] + amt)], p[3]);
    },
  };
  return t;
}

const painters = {
  [T.TURF_TOP](t) {
    t.fill("#4e9a62", 12);
    t.speck("#6fbf7e", 26); t.speck("#3b7d4f", 22); t.speck("#8fd39a", 6);
  },
  [T.LOAM](t) {
    t.fill("#7a5537", 12);
    t.speck("#5e3f28", 30); t.speck("#9a7350", 12); t.speck("#a8a39a", 4);
  },
  [T.TURF_SIDE](t) {
    painters[T.LOAM](t);
    const g = hex("#4e9a62");
    for (let x = 0; x < S; x++) {
      const drip = 3 + ((t.rand() * 3) | 0);
      for (let y = 0; y < drip; y++) {
        const d = (t.rand() - 0.5) * 24;
        t.set(x, y, [clamp(g[0] + d), clamp(g[1] + d), clamp(g[2] + d)]);
      }
    }
  },
  [T.FROST_SIDE](t) {
    painters[T.LOAM](t);
    for (let x = 0; x < S; x++) {
      const drip = 2 + ((t.rand() * 3) | 0);
      for (let y = 0; y < drip; y++) { const v = 228 + ((t.rand() * 24) | 0); t.set(x, y, [v - 6, v, 255]); }
    }
  },
  [T.SLATE](t) {
    // layered, blue-grey slate: horizontal bands rather than lumpy stone
    t.fill("#6c7682", 7);
    for (let y = 0; y < S; y++) {
      const band = Math.sin(y * 1.7 + t.rand() * 0.6) * 9;
      for (let x = 0; x < S; x++) t.shade(x, y, band);
    }
    for (let i = 0; i < 5; i++) {
      const y = (t.rand() * S) | 0, x0 = (t.rand() * S) | 0, len = 3 + ((t.rand() * 7) | 0);
      for (let x = x0; x < x0 + len; x++) t.shade(x, y, -26);
    }
  },
  [T.SILTSAND](t) {
    t.fill("#d9c79a", 9);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x + y * 2) % 7 === 0) t.shade(x, y, -10);
    t.speck("#c2ac7a", 18); t.speck("#efe2bd", 10);
  },
  [T.WATER](t) {
    t.fill("#2f6fb0", 8);
    for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) {
      if (Math.sin((x + y * 1.3) * 0.8) > 0.55) t.shade(x, y + ((x / 5) | 0) % 2, 26);
    }
  },
  [T.BARK](t) {
    t.fill("#5b4030", 8);
    for (let x = 0; x < S; x++) {
      if (x % 4 === 0 || t.rand() < 0.12) for (let y = 0; y < S; y++) if (t.rand() < 0.85) t.shade(x, y, -22);
    }
    t.speck("#7a5a42", 10);
  },
  [T.RINGS](t) {
    t.fill("#a98057", 6);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (Math.floor(r) % 3 === 0) t.shade(x, y, -24);
      if (r > 6.8) t.set(x, y, hex("#5b4030"));
    }
  },
  [T.DUSKBARK](t) {
    t.fill("#4a4152", 8);
    for (let x = 0; x < S; x++) if (x % 3 === 1 || t.rand() < 0.1) for (let y = 0; y < S; y++) if (t.rand() < 0.8) t.shade(x, y, -18);
    t.speck("#6d5f78", 12);
  },
  [T.DUSKRINGS](t) {
    t.fill("#8a7894", 6);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (Math.floor(r) % 3 === 0) t.shade(x, y, -22);
      if (r > 6.8) t.set(x, y, hex("#4a4152"));
    }
  },
  [T.CANOPY](t) {
    // clustered leaves with see-through gaps (alpha-tested)
    t.fill("#3c8547", 18);
    for (let i = 0; i < 46; i++) t.set((t.rand() * S) | 0, (t.rand() * S) | 0, [0, 0, 0], 0);
    t.speck("#5fae68", 22); t.speck("#2c6a37", 18);
  },
  [T.DUSKCANOPY](t) {
    // Duskwood foliage: deep violet-teal, a Hollowstone signature colour
    t.fill("#4e529c", 18);
    for (let i = 0; i < 50; i++) t.set((t.rand() * S) | 0, (t.rand() * S) | 0, [0, 0, 0], 0);
    t.speck("#6d78c6", 22); t.speck("#3f9c97", 12); t.speck("#2f3166", 22);
  },
  [T.TIMBER](t) {
    t.fill("#b08a5c", 7);
    for (let y = 0; y < S; y++) {
      if (y % 4 === 3) { for (let x = 0; x < S; x++) t.set(x, y, hex("#7c5d3c")); continue; }
      const off = ((y / 4) | 0) % 2 ? 4 : 11;
      t.set(off, y, hex("#8d6c47"));
      for (let x = 0; x < S; x++) if (t.rand() < 0.08) t.shade(x, y, -14);
    }
  },
  [T.RUBBLE](t) {
    t.fill("#5a5f66", 4);
    // irregular rounded stones in mortar
    const stones = [[3, 3, 3], [10, 2, 3], [6, 9, 4], [13, 10, 3], [1, 12, 2], [10, 14, 2], [14, 5, 2]];
    for (const [cx, cy, r] of stones) {
      const tone = 120 + ((t.rand() * 40) | 0);
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + 1) continue;
        const v = tone + (y < 0 ? 12 : -8) + ((t.rand() * 10) | 0);
        t.set(cx + x, cy + y, [v - 4, v, v + 6]);
      }
    }
  },
  [T.BASALT](t) {
    t.fill("#2d2f35", 6);
    for (let x = 0; x < S; x += 5) for (let y = 0; y < S; y++) t.shade(x + ((y / 6) | 0) % 2, y, 14);
    t.speck("#45474f", 14);
  },
  [T.EMBERORE](t) {
    painters[T.SLATE](t);
    for (let i = 0; i < 5; i++) {
      const x = 2 + ((t.rand() * 12) | 0), y = 2 + ((t.rand() * 12) | 0);
      t.set(x, y, hex("#ff9a3c")); t.set(x + 1, y, hex("#ffcf6b")); t.set(x, y + 1, hex("#d9541e"));
    }
  },
  [T.LUMEN](t) {
    t.fill("#1f6f78", 10);
    // faceted crystal with a bright core
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d < 7) t.shade(x, y, 70 - d * 8);
      if ((x + y) % 5 === 0 && d < 9) t.shade(x, y, 30);
    }
    t.speck("#c9fff6", 6);
  },
  [T.CLAYBRICK](t) {
    t.fill("#b0603f", 9);
    for (let y = 0; y < S; y++) {
      const row = (y / 4) | 0;
      if (y % 4 === 3) { for (let x = 0; x < S; x++) t.set(x, y, hex("#d9c3a8")); continue; }
      const off = row % 2 ? 0 : 4;
      for (let x = off; x < S + off; x += 8) t.set(x, y, hex("#d9c3a8"));
    }
  },
  [T.GLASS](t) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, [0, 0, 0], 0);
    for (let i = 0; i < S; i++) { t.set(i, 0, hex("#cfe8ec")); t.set(i, 15, hex("#9fbfc5")); t.set(0, i, hex("#cfe8ec")); t.set(15, i, hex("#9fbfc5")); }
    for (let i = 3; i < 8; i++) t.set(i, 10 - i, hex("#ffffff"));
    t.set(11, 4, hex("#ffffff"));
  },
  [T.SNOWPACK](t) {
    t.fill("#e9f0f7", 9);
    t.speck("#cfdceb", 30); t.speck("#ffffff", 14); t.speck("#bccbdc", 8);
  },
  [T.DEEPCORE](t) {
    t.fill("#2a2433", 14);
    t.speck("#4b3f5c", 20); t.speck("#14111a", 22);
  },
};

export function buildAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * S; canvas.height = ATLAS_ROWS * S;
  const ctx = canvas.getContext("2d");
  for (const k of Object.keys(painters)) {
    const tile = Number(k);
    const t = makeTile(9001 + tile * 7919);
    painters[tile](t);
    const img = new ImageData(t.data, S, S);
    ctx.putImageData(img, (tile % ATLAS_COLS) * S, ((tile / ATLAS_COLS) | 0) * S);
  }
  return canvas;
}

// Isometric block icon for the hotbar, drawn from the block's atlas tiles.
export function blockIcon(atlas, id, size = 48) {
  const def = BLOCKS[id];
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const tile = (i) => [(i % ATLAS_COLS) * S, ((i / ATLAS_COLS) | 0) * S];
  const [top, side] = [tile(def.tiles[0]), tile(def.tiles[1])];
  const w = size / 2, hq = size / 4;
  // top face
  ctx.save();
  ctx.setTransform(w / S, hq / S, -w / S, hq / S, w, 0);
  ctx.drawImage(atlas, top[0], top[1], S, S, 0, 0, S, S);
  ctx.restore();
  // left face
  ctx.save();
  ctx.setTransform(w / S, hq / S, 0, (size / 2) / S, 0, hq);
  ctx.drawImage(atlas, side[0], side[1], S, S, 0, 0, S, S);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.globalCompositeOperation = "source-atop"; ctx.fillRect(0, 0, S, S);
  ctx.restore();
  // right face
  ctx.save();
  ctx.setTransform(w / S, -hq / S, 0, (size / 2) / S, w, hq * 2);
  ctx.drawImage(atlas, side[0], side[1], S, S, 0, 0, S, S);
  ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.globalCompositeOperation = "source-atop"; ctx.fillRect(0, 0, S, S);
  ctx.restore();
  return c.toDataURL();
}
