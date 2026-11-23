// Chunk mesher: face culling, smooth ambient occlusion, sky exposure and coloured block light.
// Input is a padded block array (chunk + PAD-wide border from neighbours) so it stays pure and
// can run in a Web Worker. Output is plain typed arrays:
//   position, normal, uv
//   color  : ambient occlusion x sky exposure (multiplies sun, sky and ambient light in the shader)
//   block  : coloured block light (Lumen, Glowcap) added as emission
//   wind   : how much a vertex sways (leaves, plant tops)

import { BLOCKS, KIND, OPAQUE, GLOW, B } from "./blocks.js";
import { CX, CZ, H } from "./chunk.js";

export const PAD = 8;
export const PX = CX + 2 * PAD, PZ = CZ + 2 * PAD, PLAYER = PX * PZ;
export const pidx = (x, y, z) => y * PLAYER + (z + PAD) * PX + (x + PAD); // x,z in [-PAD, 16+PAD)
export const LIGHT_MAX = 12;
export const ATLAS_COLS = 8, ATLAS_ROWS = 8;

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], slot: 1 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], slot: 1 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], slot: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], slot: 2 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], slot: 1 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], slot: 1 },
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
for (const F of FACES) {
  const axis = F.n[0] !== 0 ? 0 : F.n[1] !== 0 ? 1 : 2;
  const ta = axis === 0 ? 1 : 0, tb = axis === 2 ? 1 : 2;
  F.ao = F.c.map((c) => {
    const da = [0, 0, 0], db = [0, 0, 0];
    da[ta] = c[ta] === 1 ? 1 : -1; db[tb] = c[tb] === 1 ? 1 : -1;
    const n = F.n;
    return [n[0] + da[0], n[1] + da[1], n[2] + da[2], n[0] + db[0], n[1] + db[1], n[2] + db[2],
      n[0] + da[0] + db[0], n[1] + da[1] + db[1], n[2] + da[2] + db[2]];
  });
}
// crossed quads for plants: two diagonal planes, each emitted with both windings
const CROSS = [
  [[0.12, 0, 0.12], [0.88, 0, 0.88], [0.88, 1, 0.88], [0.12, 1, 0.12]],
  [[0.88, 0, 0.88], [0.12, 0, 0.12], [0.12, 1, 0.12], [0.88, 1, 0.88]],
  [[0.12, 0, 0.88], [0.88, 0, 0.12], [0.88, 1, 0.12], [0.12, 1, 0.88]],
  [[0.88, 0, 0.12], [0.12, 0, 0.88], [0.12, 1, 0.88], [0.88, 1, 0.12]],
];

const AO_CURVE = [0.45, 0.64, 0.82, 1.0];
const CAVE_LIGHT = 0.2;
const UV_E = 0.0008;
const TINT = [0.55, 0.98, 0.92];          // block light colour (teal)
const AO_OCC = new Uint8Array(256);
for (let i = 0; i < 256; i++) AO_OCC[i] = OPAQUE[i] || (KIND[i] === 2 && i !== B.GLASS) ? 1 : 0;
const WIND_LEAF = new Uint8Array(256);
WIND_LEAF[B.CANOPY] = 1; WIND_LEAF[B.DUSKCANOPY] = 1;

const LIGHT_CURVE = new Float32Array(LIGHT_MAX + 1);
for (let i = 0; i <= LIGHT_MAX; i++) LIGHT_CURVE[i] = i === 0 ? 0 : Math.pow(i / LIGHT_MAX, 1.7) * 1.15;

class Buf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.blk = []; this.wind = []; this.idx = []; this.n = 0; }
  out() {
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col), block: new Float32Array(this.blk), wind: new Float32Array(this.wind),
      indices: new Uint32Array(this.idx), vertexCount: this.n,
    };
  }
}

function propagateLight(pad) {
  let light = null, queue = null, head = 0, tail = 0;
  for (let i = 0; i < pad.length; i++) {
    const g = GLOW[pad[i]];
    if (!g) continue;
    if (!light) { light = new Uint8Array(pad.length); queue = new Int32Array(pad.length); }
    light[i] = g; queue[tail++] = i;
  }
  if (!light) return null;
  const nb = [1, -1, PX, -PX, PLAYER, -PLAYER];
  while (head < tail) {
    const i = queue[head++];
    const L = light[i] - 1;
    if (L <= 0) continue;
    const x = i % PX, z = ((i / PX) | 0) % PZ;
    for (let n = 0; n < 6; n++) {
      if ((n === 0 && x === PX - 1) || (n === 1 && x === 0) || (n === 2 && z === PZ - 1) || (n === 3 && z === 0)) continue;
      const j = i + nb[n];
      if (j < 0 || j >= pad.length || OPAQUE[pad[j]] || light[j] >= L) continue;
      light[j] = L; queue[tail++] = j;
    }
  }
  return light;
}

/**
 * pad:  Uint8Array(PX*PZ*H) blocks, chunk plus PAD-wide border
 * top:  Uint8Array(PX*PZ) highest sky-blocking y per column (same padding)
 */
export function meshChunk(pad, top) {
  const solid = new Buf(), water = new Buf();
  const lit = (x, y, z) => (y >= H || y > top[(z + PAD) * PX + (x + PAD)] ? 1 : CAVE_LIGHT);
  const occ = (x, y, z) => (y < 0 || y >= H ? 0 : AO_OCC[pad[pidx(x, y, z)]]);
  const light = propagateLight(pad);
  const blk = (x, y, z) => (light && y >= 0 && y < H ? LIGHT_CURVE[light[pidx(x, y, z)]] : 0);

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
        if (kind === 1 && y > 0 && y < H - 1 &&
          OPAQUE[pad[pi + 1]] && OPAQUE[pad[pi - 1]] && OPAQUE[pad[pi + PX]] &&
          OPAQUE[pad[pi - PX]] && OPAQUE[pad[pi + PLAYER]] && OPAQUE[pad[pi - PLAYER]]) continue;
        const def = BLOCKS[id];
        const glow = GLOW[id];

        if (kind === 4) { emitCross(solid, def, x, y, z, glow ? 1 : lit(x, y, z), glow ? glow / LIGHT_MAX * 1.6 : blk(x, y, z), glow); continue; }

        const tile0 = def.tiles;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          const nbid = ny < 0 ? B.DEEPCORE : ny >= H ? 0 : pad[pidx(nx, ny, nz)];
          const nk = KIND[nbid];
          if (kind === 3) { if (nbid === id || nk === 1) continue; }
          else if (kind === 2) { if (nk === 1 || (nbid === id && id === B.GLASS)) continue; }
          else if (nk === 1) continue;

          const target = kind === 3 ? water : solid;
          const tile = tile0[F.slot];
          const base = target.n;
          const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
          const u0 = tx / ATLAS_COLS + UV_E, u1 = (tx + 1) / ATLAS_COLS - UV_E;
          const vT = 1 - ty / ATLAS_ROWS - UV_E, vB = 1 - (ty + 1) / ATLAS_ROWS + UV_E;
          const waterTopDrop = kind === 3 && KIND[pad[pidx(x, Math.min(H - 1, y + 1), z)]] !== 3;
          const skyF = lit(nx, ny, nz), blF = blk(nx, ny, nz);
          const wind = WIND_LEAF[id] ? 0.45 : 0;
          let a0 = 0, a1 = 0, a2 = 0, a3 = 0;

          for (let v = 0; v < 4; v++) {
            const c = F.c[v];
            target.pos.push(x + c[0], y + c[1] - (waterTopDrop && c[1] === 1 ? 0.12 : 0), z + c[2]);
            target.nrm.push(F.n[0], F.n[1], F.n[2]);
            target.uv.push(u0 + (u1 - u0) * UVS[v][0], vB + (vT - vB) * UVS[v][1]);
            target.wind.push(wind);
            if (glow) {
              target.col.push(1, 1, 1);
              const e = glow / LIGHT_MAX * 2.1;
              target.blk.push(e, e, e);
              continue;
            }
            const o = F.ao[v];
            const s1x = x + o[0], s1y = y + o[1], s1z = z + o[2];
            const s2x = x + o[3], s2y = y + o[4], s2z = z + o[5];
            const ccx = x + o[6], ccy = y + o[7], ccz = z + o[8];
            const s1 = occ(s1x, s1y, s1z), s2 = occ(s2x, s2y, s2z), cc = occ(ccx, ccy, ccz);
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            if (v === 0) a0 = ao; else if (v === 1) a1 = ao; else if (v === 2) a2 = ao; else a3 = ao;
            const sky = (skyF + (s1 ? CAVE_LIGHT : lit(s1x, s1y, s1z)) + (s2 ? CAVE_LIGHT : lit(s2x, s2y, s2z)) + (cc ? CAVE_LIGHT : lit(ccx, ccy, ccz))) / 4;
            const k = AO_CURVE[ao];
            const sk = k * sky;
            target.col.push(sk, sk, sk);
            const bl = light ? k * (blF + (s1 ? 0 : blk(s1x, s1y, s1z)) + (s2 ? 0 : blk(s2x, s2y, s2z)) + (cc ? 0 : blk(ccx, ccy, ccz))) / 4 : 0;
            target.blk.push(bl * TINT[0], bl * TINT[1], bl * TINT[2]);
          }
          target.n += 4;
          if (a0 + a2 < a1 + a3) target.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          else target.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return { solid: solid.out(), water: water.out() };
}

function emitCross(buf, def, x, y, z, sky, bl, glow) {
  const tile = def.tiles[0];
  const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
  const u0 = tx / ATLAS_COLS + UV_E, u1 = (tx + 1) / ATLAS_COLS - UV_E;
  const vT = 1 - ty / ATLAS_ROWS - UV_E, vB = 1 - (ty + 1) / ATLAS_ROWS + UV_E;
  for (const quad of CROSS) {
    const base = buf.n;
    for (let v = 0; v < 4; v++) {
      const c = quad[v];
      buf.pos.push(x + c[0], y + c[1], z + c[2]);
      buf.nrm.push(0, 1, 0);
      buf.uv.push(u0 + (u1 - u0) * UVS[v][0], vB + (vT - vB) * UVS[v][1]);
      buf.col.push(sky * 0.92, sky * 0.92, sky * 0.92);
      if (glow) buf.blk.push(bl, bl, bl); else buf.blk.push(bl * TINT[0], bl * TINT[1], bl * TINT[2]);
      buf.wind.push(c[1] === 1 ? 1 : 0);
    }
    buf.n += 4;
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
