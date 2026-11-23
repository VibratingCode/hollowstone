// Chunk mesher: face culling, smooth ambient occlusion, sky-light shading.
// Input is a padded block array (chunk + 1-block border from neighbours) so it stays pure
// and can move into a Web Worker later. Output is plain typed arrays.

import { BLOCKS, KIND, OPAQUE, B } from "./blocks.js";
import { CX, CZ, H } from "./chunk.js";

export const PAD = 8;                         // border copied from neighbours (block light reaches this far)
export const PX = CX + 2 * PAD, PZ = CZ + 2 * PAD, PLAYER = PX * PZ;
export const pidx = (x, y, z) => y * PLAYER + (z + PAD) * PX + (x + PAD); // x,z in [-PAD, 16+PAD)
export const LIGHT_MAX = 12;

export const ATLAS_COLS = 8, ATLAS_ROWS = 8;

// [normal, corners (CCW from outside), shade, tileSlot(0 top,1 side,2 bottom), tangent axes]
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.80, slot: 1 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.80, slot: 1 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.00, slot: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55, slot: 2 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.68, slot: 1 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.68, slot: 1 },
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

// Precompute, per face and corner, the offsets (from the block) of the AO neighbours:
// the cell in front of the face (f), the two side cells (s1, s2) and the diagonal corner (cc).
for (const F of FACES) {
  const axis = F.n[0] !== 0 ? 0 : F.n[1] !== 0 ? 1 : 2;
  const ta = axis === 0 ? 1 : 0, tb = axis === 2 ? 1 : 2;
  F.ao = F.c.map((c) => {
    const da = [0, 0, 0], db = [0, 0, 0];
    da[ta] = c[ta] === 1 ? 1 : -1; db[tb] = c[tb] === 1 ? 1 : -1;
    const n = F.n;
    return [
      n[0] + da[0], n[1] + da[1], n[2] + da[2],
      n[0] + db[0], n[1] + db[1], n[2] + db[2],
      n[0] + da[0] + db[0], n[1] + da[1] + db[1], n[2] + da[2] + db[2],
    ];
  });
  F.uv = UVS.map(([u, v]) => [u, v]);
}
const AO_CURVE = [0.48, 0.66, 0.83, 1.0];
const CAVE_LIGHT = 0.26;
const UV_E = 0.0008;

class Buf {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  out() {
    return {
      positions: new Float32Array(this.pos), uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col), indices: new Uint32Array(this.idx), vertexCount: this.n,
    };
  }
}

const LIGHT_CURVE = new Float32Array(LIGHT_MAX + 1);
for (let i = 0; i <= LIGHT_MAX; i++) LIGHT_CURVE[i] = i === 0 ? 0 : Math.pow(i / LIGHT_MAX, 1.6) * 1.05;

// Flood-fill light from glowing blocks (Lumen) through non-opaque cells. Returns null if there are none.
function propagateLight(pad) {
  let light = null, queue = null, head = 0, tail = 0;
  for (let i = 0; i < pad.length; i++) {
    if (!BLOCKS[pad[i]] || !BLOCKS[pad[i]].glow) continue;
    if (!light) { light = new Uint8Array(pad.length); queue = new Int32Array(pad.length); }
    light[i] = LIGHT_MAX; queue[tail++] = i;
  }
  if (!light) return null;
  const neighbours = [1, -1, PX, -PX, PLAYER, -PLAYER];
  while (head < tail) {
    const i = queue[head++];
    const L = light[i] - 1;
    if (L <= 0) continue;
    const x = (i % PX), z = ((i / PX) | 0) % PZ;
    for (let n = 0; n < 6; n++) {
      if ((n === 0 && x === PX - 1) || (n === 1 && x === 0) || (n === 2 && z === PZ - 1) || (n === 3 && z === 0)) continue;
      const j = i + neighbours[n];
      if (j < 0 || j >= pad.length) continue;
      if (OPAQUE[pad[j]] || light[j] >= L) continue;
      light[j] = L; queue[tail++] = j;
    }
  }
  return light;
}

/**
 * pad:  Uint8Array(PX*PZ*H) blocks, chunk plus 1-wide border
 * top:  Uint8Array(PX*PZ) highest light-blocking y per column (same padding)
 */
export function meshChunk(pad, top) {
  const solid = new Buf(), water = new Buf();
  const lit = (x, y, z) => (y >= H || y > top[(z + PAD) * PX + (x + PAD)] ? 1 : CAVE_LIGHT);
  const light = propagateLight(pad);
  const blk = (x, y, z) => (light && y >= 0 && y < H ? LIGHT_CURVE[light[pidx(x, y, z)]] : 0);
  const occ = (x, y, z) => (y < 0 || y >= H ? 0 : OPAQUE[pad[pidx(x, y, z)]]);

  // skip the empty sky above the tallest block in this chunk
  let maxY = H - 1;
  scan: for (; maxY >= 0; maxY--) {
    for (let z = 0; z < CZ; z++) for (let x = 0; x < CX; x++) if (pad[pidx(x, maxY, z)] !== 0) break scan;
  }

  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) {
        const pi = pidx(x, y, z);
        const id = pad[pi];
        if (id === 0) continue;
        const kind = KIND[id];
        // fast reject: buried solid blocks (most of the underground)
        if (kind === 1 && y > 0 && y < H - 1 &&
          OPAQUE[pad[pi + 1]] && OPAQUE[pad[pi - 1]] && OPAQUE[pad[pi + PX]] &&
          OPAQUE[pad[pi - PX]] && OPAQUE[pad[pi + PLAYER]] && OPAQUE[pad[pi - PLAYER]]) continue;
        const def = BLOCKS[id];

        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          const nb = ny < 0 ? B.DEEPCORE : ny >= H ? 0 : pad[pidx(nx, ny, nz)];
          const nk = KIND[nb];

          // --- culling rules
          if (kind === 3) { // liquid: only against air (or cutout)
            if (nb === id || nk === 1) continue;
          } else if (kind === 2) { // cutout
            if (nk === 1) continue;
            if (nb === id && id === B.GLASS) continue;
          } else { // solid
            if (nk === 1) continue;
          }

          const target = kind === 3 ? water : solid;
          const tile = def.tiles[F.slot];
          const base = target.n;
          const aos = [0, 0, 0, 0];

          const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
          const u0 = tx / ATLAS_COLS + UV_E, u1 = (tx + 1) / ATLAS_COLS - UV_E;
          const vT = 1 - ty / ATLAS_ROWS - UV_E, vB = 1 - (ty + 1) / ATLAS_ROWS + UV_E;
          const waterTopDrop = kind === 3 && KIND[pad[pidx(x, Math.min(H - 1, y + 1), z)]] !== 3;
          const skyF = def.glow ? 1 : lit(nx, ny, nz);

          for (let v = 0; v < 4; v++) {
            const c = F.c[v];
            const py = y + c[1] - (waterTopDrop && c[1] === 1 ? 0.12 : 0);
            target.pos.push(x + c[0], py, z + c[2]);
            const uv = UVS[v];
            target.uv.push(u0 + (u1 - u0) * uv[0], vB + (vT - vB) * uv[1]);

            let r, g, bch;
            if (def.glow) {
              r = 0.85; g = 1.0; bch = 1.0;
            } else {
              const o = F.ao[v];
              const s1x = x + o[0], s1y = y + o[1], s1z = z + o[2];
              const s2x = x + o[3], s2y = y + o[4], s2z = z + o[5];
              const ccx = x + o[6], ccy = y + o[7], ccz = z + o[8];
              const s1 = occ(s1x, s1y, s1z), s2 = occ(s2x, s2y, s2z), cc = occ(ccx, ccy, ccz);
              const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
              aos[v] = ao;
              const sky = (skyF + (s1 ? CAVE_LIGHT : lit(s1x, s1y, s1z)) +
                (s2 ? CAVE_LIGHT : lit(s2x, s2y, s2z)) + (cc ? CAVE_LIGHT : lit(ccx, ccy, ccz))) / 4;
              const bl = light ? (blk(x + F.n[0], y + F.n[1], z + F.n[2]) + (s1 ? 0 : blk(s1x, s1y, s1z)) +
                (s2 ? 0 : blk(s2x, s2y, s2z)) + (cc ? 0 : blk(ccx, ccy, ccz))) / 4 : 0;
              const k = F.shade * AO_CURVE[ao];
              r = k * Math.max(sky, bl * 0.55); g = k * Math.max(sky, bl * 0.95); bch = k * Math.max(sky, bl * 0.9);
              if (kind === 3) { const m = 0.55 * F.shade; r = Math.max(r, m); g = Math.max(g, m); bch = Math.max(bch, m); }
            }
            target.col.push(r, g, bch);
          }
          target.n += 4;
          // flip the quad's diagonal when it makes the AO gradient look right
          if (aos[0] + aos[2] < aos[1] + aos[3]) {
            target.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          } else {
            target.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
  }
  return { solid: solid.out(), water: water.out() };
}
