// Run: node tests/world.test.mjs
import assert from "node:assert/strict";
import { World } from "../src/world.js";
import { Player } from "../src/player.js";
import { B } from "../src/blocks.js";

let pass = 0;
const test = (n, f) => { f(); pass++; console.log("  ok  " + n); };

const w = new World(4242);
let meshes = 0;
for (let i = 0; i < 200 && w.pendingAround(0, 0, 2) > 0; i++) w.update(0, 0, 2, 50, () => meshes++, () => {});

test("streaming loads and meshes the area", () => {
  assert.equal(w.pendingAround(0, 0, 2), 0);
  assert.ok(meshes >= 25, "meshed " + meshes);
});

test("edits change blocks, mark chunks dirty and are recorded", () => {
  const before = w.getBlock(3, 100, 3);
  assert.equal(before, B.AIR);
  w.setBlock(3, 100, 3, B.TIMBER);
  assert.equal(w.getBlock(3, 100, 3), B.TIMBER);
  assert.ok(w.chunk(0, 0).dirty);
  assert.ok(w.dirtyEdits.has("0,0"));
  // border edit dirties the neighbour
  w.chunk(-1, 0).dirty = false;
  w.setBlock(0, 100, 5, B.TIMBER);
  assert.ok(w.chunk(-1, 0).dirty);
});

test("edits survive regeneration (unload + reload)", () => {
  const w2 = new World(4242, w.edits);
  w2.ensureChunk(0, 0);
  assert.equal(w2.getBlock(3, 100, 3), B.TIMBER);
});

test("player lands on the ground and stays there", () => {
  const p = new Player(w);
  const [sx, , sz] = w.findSpawn();
  const ix = Math.floor(sx), iz = Math.floor(sz);
  let top = 127; while (top > 0 && ![B.TURF, B.SILTSAND, B.FROSTTURF, B.SLATE, B.SNOWPACK, B.LOAM, B.CANOPY, B.DUSKCANOPY, B.BARKWOOD, B.DUSKWOOD].includes(w.getBlock(ix, top, iz))) top--;
  p.pos = [sx, top + 6, sz];
  const none = { forward: 0, right: 0, jump: false, down: false, sprint: false };
  for (let i = 0; i < 240; i++) p.update(1 / 60, none);
  assert.ok(p.onGround, "not grounded");
  assert.ok(Math.abs(p.pos[1] - (top + 1)) < 0.01, `feet at ${p.pos[1]} expected ${top + 1}`);
  assert.ok(!p.intersectsSolid(...p.pos));
});

test("player walks into a wall and stops", () => {
  const p = new Player(w);
  // build a flat test pad in the sky
  for (let x = -2; x <= 8; x++) for (let z = -2; z <= 2; z++) w.setBlock(x, 110, z, B.SLATE);
  for (let y = 111; y <= 113; y++) for (let z = -2; z <= 2; z++) w.setBlock(6, y, z, B.SLATE);
  p.pos = [0.5, 111, 0.5]; p.yaw = -Math.PI / 2; // facing +x
  const fwd = { forward: 1, right: 0, jump: false, down: false, sprint: false };
  for (let i = 0; i < 180; i++) p.update(1 / 60, fwd);
  assert.ok(p.pos[0] < 6 - 0.29 && p.pos[0] > 5.5, "x=" + p.pos[0]);
  assert.ok(p.onGround);
});

test("jumping clears one block", () => {
  const p = new Player(w);
  p.pos = [0.5, 111, 0.5];
  const none = { forward: 0, right: 0, jump: false, down: false, sprint: false };
  for (let i = 0; i < 10; i++) p.update(1 / 60, none);
  let maxY = 0;
  p.update(1 / 60, { ...none, jump: true });
  for (let i = 0; i < 60; i++) { p.update(1 / 60, none); maxY = Math.max(maxY, p.pos[1]); }
  assert.ok(maxY - 111 > 1.1 && maxY - 111 < 1.6, "jump height " + (maxY - 111));
});

// async pool test (fake pool with 1 slot, resolves later)
const wp = new World(777);
let free = true, queue = [];
wp.setMeshPool({ idle: () => free, run() { free = false; return new Promise((res) => queue.push(() => { free = true; res({ solid: { vertexCount: 0 }, water: { vertexCount: 0 } }); })); } });
const meshedKeys = new Set();
for (let i = 0; i < 400; i++) {
  wp.update(0, 0, 2, 50, (c) => meshedKeys.add(c.cx + "," + c.cz), () => {});
  const job = queue.shift(); if (job) job();
  await new Promise((r) => setTimeout(r, 0));
  if (wp.pendingAround(0, 0, 2) === 0) break;
}
assert.equal(wp.pendingAround(0, 0, 2), 0, "pending chunks left");
assert.equal(meshedKeys.size, 25, "meshed " + meshedKeys.size);
console.log("  ok  worker pool path meshes every chunk");
pass++;

console.log(`\n${pass} tests passed`);
