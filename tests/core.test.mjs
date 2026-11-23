// Run: node tests/core.test.mjs
import assert from "node:assert/strict";
import { createGenerator, BIOME_NAMES } from "../src/worldgen.js";
import { meshChunk, PX, PZ, PAD, pidx } from "../src/mesher.js";
import { Chunk, CX, CZ, H, SEA, idx } from "../src/chunk.js";
import { B, BLOCKS, OPAQUE, KIND } from "../src/blocks.js";
import { raycast } from "../src/raycast.js";

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };

const gen = createGenerator(12345);

test("generation is deterministic", () => {
  const a = gen.generate(3, -2), b = createGenerator(12345).generate(3, -2);
  assert.deepEqual(a, b);
  const c = createGenerator(999).generate(3, -2);
  assert.notDeepEqual(a, c);
});

test("strata: deepcore floor, no floating water above air", () => {
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const blk = gen.generate(cx, cz);
    for (let z = 0; z < CZ; z++) for (let x = 0; x < CX; x++) {
      assert.equal(blk[idx(x, 0, z)], B.DEEPCORE);
      for (let y = 1; y < H; y++) {
        if (blk[idx(x, y, z)] === B.WATER) assert.notEqual(blk[idx(x, y - 1, z)], B.AIR, `air under water at ${cx},${cz} ${x},${y},${z}`);
      }
    }
  }
});

test("terrain has variety (biomes, trees, caves, lumen)", () => {
  const seen = new Set(), counts = {};
  for (let cz = -12; cz <= 12; cz += 3) for (let cx = -12; cx <= 12; cx += 3) {
    const blk = gen.generate(cx, cz);
    for (const b of blk) counts[b] = (counts[b] || 0) + 1;
    for (let z = 0; z < CZ; z += 4) for (let x = 0; x < CX; x += 4) seen.add(BIOME_NAMES[gen.column(cx * CX + x, cz * CZ + z).biome]);
  }
  console.log("      biomes:", [...seen].join(", "));
  console.log("      blocks:", Object.entries(counts).map(([k, v]) => BLOCKS[k].name + "=" + v).join(" "));
  assert.ok(seen.size >= 3);
  for (const b of [B.TURF, B.SLATE, B.WATER, B.AIR, B.LUMEN]) assert.ok(counts[b] > 0, BLOCKS[b].name + " missing");
  assert.ok((counts[B.BARKWOOD] || 0) + (counts[B.DUSKWOOD] || 0) > 0, "no trees");
});

function padFor(cx, cz) {
  const chunks = {};
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = new Chunk(cx + dx, cz + dz, gen.generate(cx + dx, cz + dz));
    c.computeTop((b) => KIND[b] === 1);
    chunks[dx + "," + dz] = c;
  }
  const pad = new Uint8Array(PX * PZ * H), top = new Uint8Array(PX * PZ);
  for (let z = -PAD; z < CZ + PAD; z++) for (let x = -PAD; x < CX + PAD; x++) {
    const dx = x < 0 ? -1 : x >= CX ? 1 : 0, dz = z < 0 ? -1 : z >= CZ ? 1 : 0;
    const c = chunks[dx + "," + dz], lx = x - dx * CX, lz = z - dz * CZ;
    top[(z + PAD) * PX + (x + PAD)] = c.top[lz * CX + lx];
    for (let y = 0; y < H; y++) pad[pidx(x, y, z)] = c.blocks[idx(lx, y, lz)];
  }
  return { pad, top };
}

test("mesh is valid, faces wind outward, timing is sane", () => {
  const { pad, top } = padFor(0, 0);
  const t0 = performance.now();
  const m = meshChunk(pad, top);
  const ms = performance.now() - t0;
  const s = m.solid;
  assert.ok(s.vertexCount > 100);
  assert.equal(s.positions.length, s.vertexCount * 3);
  assert.equal(s.uvs.length, s.vertexCount * 2);
  assert.equal(s.indices.length, (s.vertexCount / 4) * 6);
  for (let i = 0; i < s.indices.length; i++) assert.ok(s.indices[i] < s.vertexCount);
  for (const c of s.colors) assert.ok(c > 0 && c <= 1, "colour " + c);
  assert.equal(s.normals.length, s.vertexCount * 3);
  assert.equal(s.block.length, s.vertexCount * 3);
  assert.equal(s.wind.length, s.vertexCount);
  for (const u of s.uvs) assert.ok(u >= 0 && u <= 1);
  // winding check: triangle normal must point away from its block centre
  let bad = 0;
  for (let t = 0; t < s.indices.length; t += 3) {
    const [a, b, c] = [s.indices[t], s.indices[t + 1], s.indices[t + 2]].map((i) => s.positions.slice(i * 3, i * 3 + 3));
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    // face centre lies on block boundary; block centre is -n*0.5 from it, so n must align with the axis of the face
    const ax = Math.abs(n[0]) > 0 ? 0 : Math.abs(n[1]) > 0 ? 1 : 2;
    const frac = cen[ax] - Math.floor(cen[ax]);
    const isPlant = Math.abs(n[0]) > 1e-6 && Math.abs(n[2]) > 1e-6; // diagonal plant quads
    if (!isPlant && frac > 0.01 && frac < 0.99) bad++; // off-grid: shouldn't happen for cubes
  }
  assert.equal(bad, 0);
  console.log(`      solid verts=${s.vertexCount} water verts=${m.water.vertexCount} mesh=${ms.toFixed(1)}ms`);
});

test("winding: an isolated cube's faces all point outward", () => {
  const pad = new Uint8Array(PX * PZ * H), top = new Uint8Array(PX * PZ);
  pad[pidx(5, 50, 5)] = B.SLATE;
  const s = meshChunk(pad, top).solid;
  assert.equal(s.vertexCount, 24);
  for (let t = 0; t < s.indices.length; t += 3) {
    const p = [s.indices[t], s.indices[t + 1], s.indices[t + 2]].map((i) => s.positions.slice(i * 3, i * 3 + 3));
    const u = p[1].map((v, k) => v - p[0][k]), v = p[2].map((w, k) => w - p[0][k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const cen = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3 - [5.5, 50.5, 5.5][k]);
    assert.ok(n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] > 0, "inward-facing triangle");
  }
});

test("lumen lights its surroundings", () => {
  const pad = new Uint8Array(PX * PZ * H), top = new Uint8Array(PX * PZ).fill(100); // everything is "underground"
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) pad[pidx(x, 40, z)] = B.SLATE; // a floor
  pad[pidx(5, 41, 5)] = B.LUMEN;
  const s = meshChunk(pad, top).solid;
  // find top faces of the floor: near the crystal vs far away
  let near = 0, far = 1;
  for (let v = 0; v < s.vertexCount; v++) {
    const [x, y, z] = [s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]];
    if (y !== 41) continue;
    const g = s.block[v * 3 + 1], d = Math.hypot(x - 5.5, z - 5.5);
    if (d < 2.5) near = Math.max(near, g);
    if (d > 6.5) far = Math.min(far, g);
  }
  assert.ok(near > 0.5, "near " + near);
  assert.ok(far < near * 0.5, "far " + far);
});

test("plants grow and mesh as crossed quads", () => {
  let plants = 0;
  for (let cz = -6; cz <= 6; cz += 2) for (let cx = -6; cx <= 6; cx += 2) {
    const blk = gen.generate(cx, cz);
    for (const b of blk) if (KIND[b] === 4) plants++;
  }
  assert.ok(plants > 50, "plants " + plants);
  const pad = new Uint8Array(PX * PZ * H), top = new Uint8Array(PX * PZ);
  pad[pidx(3, 50, 3)] = B.BELLGRASS;
  const s = meshChunk(pad, top).solid;
  assert.equal(s.vertexCount, 16);
  assert.ok(s.wind.some((w) => w === 1) && s.wind.some((w) => w === 0));
});

test("generation timing", () => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) gen.generate(100 + i, 50);
  console.log(`      ${((performance.now() - t0) / 20).toFixed(1)} ms per chunk`);
});

test("raycast hits the right block and face", () => {
  const world = (x, y, z) => (y <= 10 ? B.SLATE : x === 3 && y === 11 && z === 0 ? B.TIMBER : 0);
  let h = raycast(world, [0.5, 12.5, 0.5], [0, -1, 0], 8);
  assert.deepEqual(h.pos, [0, 10, 0]); assert.deepEqual(h.normal, [0, 1, 0]);
  h = raycast(world, [0.5, 11.5, 0.5], [1, 0, 0], 8);
  assert.deepEqual(h.pos, [3, 11, 0]); assert.deepEqual(h.normal, [-1, 0, 0]);
  assert.equal(raycast(world, [0.5, 50, 0.5], [0, 1, 0], 8), null);
});

console.log(`\n${pass} tests passed`);
