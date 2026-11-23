// Voxel ray traversal (Amanatides & Woo). getBlock(x,y,z) -> id. Returns the first non-air,
// non-liquid block within maxDist, with the face normal that was hit.

import { KIND } from "./blocks.js";

export function raycast(getBlock, origin, dir, maxDist) {
  let [ox, oy, oz] = origin;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
  let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let normal = [0, 0, 0], t = 0;

  while (t <= maxDist) {
    const id = getBlock(x, y, z);
    const k = KIND[id];
    if (k === 1 || k === 2) return { pos: [x, y, z], normal, id, dist: t };
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; normal = [-stepX, 0, 0]; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; normal = [0, -stepY, 0]; }
    else { z += stepZ; t = tmz; tmz += tdz; normal = [0, 0, -stepZ]; }
  }
  return null;
}
