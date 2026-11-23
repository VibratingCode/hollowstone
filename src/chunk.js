// Chunk layout constants and helpers. Pure, no dependencies.

export const CX = 16;          // chunk width (x)
export const CZ = 16;          // chunk depth (z)
export const H = 128;          // world height (y)
export const SEA = 40;         // sea level
export const LAYER = CX * CZ;
export const VOLUME = LAYER * H;

export const idx = (x, y, z) => y * LAYER + z * CX + x;
export const key = (cx, cz) => cx + "," + cz;

export function worldToChunk(wx, wz) {
  return [Math.floor(wx / CX), Math.floor(wz / CZ)];
}

export class Chunk {
  constructor(cx, cz, blocks) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks || new Uint8Array(VOLUME);
    this.top = new Uint8Array(LAYER); // highest light-blocking block per column (for sky light)
    this.meshed = false;
    this.dirty = true;
    this.mesh = null;     // set by the renderer
    this.computeTop();
  }

  get(x, y, z) {
    if (y < 0 || y >= H) return 0;
    return this.blocks[idx(x, y, z)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= H) return;
    this.blocks[idx(x, y, z)] = id;
  }

  computeTop(isLightBlocking) {
    const blk = this.blocks;
    for (let z = 0; z < CZ; z++) {
      for (let x = 0; x < CX; x++) this.computeColumn(x, z, isLightBlocking);
    }
  }

  computeColumn(x, z, isLightBlocking) {
    const blk = this.blocks;
    let y = H - 1;
    for (; y > 0; y--) {
      const b = blk[idx(x, y, z)];
      if (b !== 0 && (!isLightBlocking || isLightBlocking(b))) break;
    }
    this.top[z * CX + x] = y;
  }
}
