// World: owns chunks, generation, edits and the mesh queue. No rendering code here.

import { Chunk, CX, CZ, H, idx, key } from "./chunk.js";
import { createGenerator } from "./worldgen.js";
import { meshChunk, PX, PZ, pidx } from "./mesher.js";
import { KIND, B } from "./blocks.js";

const lightBlocking = (b) => KIND[b] === 1 || KIND[b] === 2;

export class World {
  constructor(seed, edits = new Map()) {
    this.seed = seed;
    this.gen = createGenerator(seed);
    this.chunks = new Map();
    this.edits = edits;           // chunkKey -> Map(index -> blockId)
    this.dirtyEdits = new Set();  // chunk keys with unsaved edits
    this._pad = new Uint8Array(PX * PZ * H);
    this._top = new Uint8Array(PX * PZ);
  }

  chunk(cx, cz) { return this.chunks.get(key(cx, cz)); }

  ensureChunk(cx, cz) {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    const blocks = this.gen.generate(cx, cz);
    const ed = this.edits.get(k);
    if (ed) for (const [i, id] of ed) blocks[i] = id;
    c = new Chunk(cx, cz, blocks);
    c.computeTop(lightBlocking);
    this.chunks.set(k, c);
    // neighbours that were waiting on this chunk can now mesh
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunk(cx + dx, cz + dz);
      if (n) n.dirty = true;
    }
    return c;
  }

  /** Block at world coords. Unloaded chunks return `unloaded` (default air). */
  getBlock(wx, wy, wz, unloaded = 0) {
    if (wy < 0) return B.DEEPCORE;
    if (wy >= H) return 0;
    const cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return unloaded;
    return c.blocks[idx(wx - cx * CX, wy, wz - cz * CZ)];
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= H) return false;
    const cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
    const c = this.chunk(cx, cz);
    if (!c) return false;
    const lx = wx - cx * CX, lz = wz - cz * CZ, i = idx(lx, wy, lz);
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    c.computeColumn(lx, lz, lightBlocking);
    const k = key(cx, cz);
    if (!this.edits.has(k)) this.edits.set(k, new Map());
    this.edits.get(k).set(i, id);
    this.dirtyEdits.add(k);
    // remesh this chunk and any neighbour whose border (AO / light) touches the edit
    c.dirty = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nearX = dx === 0 || (dx < 0 ? lx <= 1 : lx >= CX - 2);
      const nearZ = dz === 0 || (dz < 0 ? lz <= 1 : lz >= CZ - 2);
      if (nearX && nearZ) { const n = this.chunk(cx + dx, cz + dz); if (n) n.dirty = true; }
    }
    return true;
  }

  neighboursLoaded(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunk(cx + dx, cz + dz)) return false;
    return true;
  }

  buildMesh(c) {
    const pad = this._pad, top = this._top;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunk(c.cx + dx, c.cz + dz);
      const x0 = dx < 0 ? -1 : dx > 0 ? CX : 0, x1 = dx < 0 ? -1 : dx > 0 ? CX : CX - 1;
      const z0 = dz < 0 ? -1 : dz > 0 ? CZ : 0, z1 = dz < 0 ? -1 : dz > 0 ? CZ : CZ - 1;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const lx = x - dx * CX, lz = z - dz * CZ;
        top[(z + 1) * PX + (x + 1)] = n.top[lz * CX + lx];
        for (let y = 0; y < H; y++) pad[pidx(x, y, z)] = n.blocks[idx(lx, y, lz)];
      }
    }
    return meshChunk(pad, top);
  }

  /**
   * Stream the world around (pcx, pcz). Generates missing chunks and meshes dirty ones,
   * nearest first, within a time budget. Calls onMesh(chunk, meshData) and onUnload(chunk).
   */
  update(pcx, pcz, radius, budgetMs, onMesh, onUnload) {
    const t0 = performance.now();
    const order = this._order(radius + 1);
    for (const [dx, dz] of order) {
      if (performance.now() - t0 > budgetMs) break;
      const cx = pcx + dx, cz = pcz + dz;
      if (!this.chunk(cx, cz)) this.ensureChunk(cx, cz);
    }
    let meshed = 0;
    for (const [dx, dz] of this._order(radius)) {
      if (performance.now() - t0 > budgetMs && meshed > 0) break;
      const c = this.chunk(pcx + dx, pcz + dz);
      if (!c || !c.dirty || !this.neighboursLoaded(c.cx, c.cz)) continue;
      c.dirty = false;
      onMesh(c, this.buildMesh(c));
      meshed++;
    }
    // unload far chunks (their edits stay in this.edits)
    for (const c of this.chunks.values()) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > radius + 3) {
        onUnload(c);
        this.chunks.delete(key(c.cx, c.cz));
      }
    }
    return meshed;
  }

  pendingAround(pcx, pcz, radius) {
    let n = 0;
    for (const [dx, dz] of this._order(radius)) {
      const c = this.chunk(pcx + dx, pcz + dz);
      if (!c || c.dirty) n++;
    }
    return n;
  }

  _order(r) {
    if (this._orderCache && this._orderCache.r === r) return this._orderCache.list;
    const list = [];
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) list.push([dx, dz]);
    list.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
    this._orderCache = { r, list };
    return list;
  }

  /** Find a dry spawn point near the origin. */
  findSpawn() {
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const col = this.gen.column(x, z);
        if (col.biome >= 2 && col.biome !== 6) return [x + 0.5, col.h + 1, z + 0.5];
      }
    }
    return [0.5, 90, 0.5];
  }
}
