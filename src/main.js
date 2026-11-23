import * as THREE from "three";
import { World } from "./world.js";
import { Player, PLAYER_W, PLAYER_H } from "./player.js";
import { raycast } from "./raycast.js";
import { buildAtlas, blockIcon, tilePalette } from "./textures.js";
import { BLOCKS, HOTBAR, KIND, GLOW, B } from "./blocks.js";
import { CX, CZ, H, key as chunkKey } from "./chunk.js";
import { seedFromString } from "./noise.js";
import { BIOME_NAMES } from "./worldgen.js";
import * as Save from "./save.js";
import { skyState, clockString, createSkyDome, updateSkyDome } from "./render/sky.js";
import { shared, createTerrainMaterial, createDepthMaterial, createWaterMaterial } from "./render/materials.js";
import { createClouds, updateClouds } from "./render/clouds.js";
import { Debris, Motes } from "./render/effects.js";
import { Hand } from "./render/hand.js";
import { createPost } from "./render/post.js";

export const VERSION = "0.2.0";

// ---------------------------------------------------------------- settings
const settings = Object.assign({ renderDistance: 6, fov: 75, sensitivity: 1, invertY: false, graphics: "fancy", dayLength: 20 }, loadSettings());
function loadSettings() { try { return JSON.parse(localStorage.getItem("hollowstone.settings") || "{}"); } catch (e) { return {}; } }
function storeSettings() { try { localStorage.setItem("hollowstone.settings", JSON.stringify(settings)); } catch (e) { /* private mode */ } }
const fancy = () => settings.graphics === "fancy";

// ---------------------------------------------------------------- renderer + scene
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9ccbe3, 50, 90);
const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.08, 1500);
camera.rotation.order = "YXZ";
scene.add(camera);

const skyDome = createSkyDome();
scene.add(skyDome);
const clouds = createClouds();
scene.add(clouds);

const hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a4a3a, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 72, bottom: -72, near: 1, far: 420 });
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
scene.add(sun, sun.target);

const atlasCanvas = buildAtlas();
const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.generateMipmaps = false;
atlas.colorSpace = THREE.SRGBColorSpace;

const terrainMat = createTerrainMaterial(atlas);
const depthMat = createDepthMaterial(atlas);
const waterMat = createWaterMaterial(atlas);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
  new THREE.LineBasicMaterial({ color: 0x0b0f12, transparent: true, opacity: 0.6 }),
);
outline.visible = false;
scene.add(outline);

const post = createPost(renderer, scene, camera);
const debris = new Debris(scene);
const motes = new Motes(scene);
const hand = new Hand(camera, atlas);
hand.group.visible = false;

// ---------------------------------------------------------------- mesh worker pool
function createPool() {
  if (typeof Worker === "undefined") return null;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const workers = [], jobs = new Map();
  let nextId = 0;
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./mesh.worker.js", import.meta.url), { type: "module" });
      w.busy = false;
      w.onmessage = (e) => { w.busy = false; const done = jobs.get(e.data.id); jobs.delete(e.data.id); if (done) done(e.data.mesh); };
      w.onerror = (e) => console.error("mesh worker error", e.message);
      workers.push(w);
    }
  } catch (e) { return null; }
  return {
    idle: () => workers.some((w) => !w.busy),
    run(pad, top) {
      const w = workers.find((x) => !x.busy);
      w.busy = true;
      const id = nextId++;
      return new Promise((resolve) => { jobs.set(id, resolve); w.postMessage({ id, pad, top }, [pad.buffer, top.buffer]); });
    },
  };
}
const pool = createPool();

// ---------------------------------------------------------------- state
let world = null, player = null, meta = null;
let state = "title"; // title | loading | playing | paused | picker
const chunkMeshes = new Map();
let hotbar = HOTBAR.slice(0, 9), slot = 0;
const keys = new Set();
let target = null;
let breakCooldown = 0, placeCooldown = 0, mouseL = false, mouseR = false;
let lastSpace = 0, showDebug = false, saveTimer = 0;
let fps = 0, frames = 0, fpsTime = 0, elapsed = 0;
let timeOfDay = 0.3;
let bobPhase = 0, bobAmt = 0, fovKick = 0;
const sky = {};
const titleCam = { angle: 0, center: [0, 60, 0], y: 90 };

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- chunk meshes
function makeGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(d.colors, 3));
  g.setAttribute("aBlock", new THREE.BufferAttribute(d.block, 3));
  g.setAttribute("aWind", new THREE.BufferAttribute(d.wind, 1));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function disposeGroup(g) { for (const m of g.children) m.geometry.dispose(); scene.remove(g); }

function onMesh(c, data) {
  const k = chunkKey(c.cx, c.cz);
  const old = chunkMeshes.get(k);
  if (old) disposeGroup(old);
  const group = new THREE.Group();
  group.position.set(c.cx * CX, 0, c.cz * CZ);
  if (data.solid.vertexCount) {
    const m = new THREE.Mesh(makeGeometry(data.solid), terrainMat);
    m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = depthMat;
    group.add(m);
  }
  if (data.water.vertexCount) { const w = new THREE.Mesh(makeGeometry(data.water), waterMat); w.renderOrder = 1; group.add(w); }
  scene.add(group);
  chunkMeshes.set(k, group);
}

function onUnload(c) {
  const k = chunkKey(c.cx, c.cz);
  const g = chunkMeshes.get(k);
  if (g) { disposeGroup(g); chunkMeshes.delete(k); }
}

function clearMeshes() { for (const g of chunkMeshes.values()) disposeGroup(g); chunkMeshes.clear(); }

function columnTop(wx, wz) {
  const cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
  const c = world && world.chunk(cx, cz);
  return c ? c.top[(wz - cz * CZ) * CX + (wx - cx * CX)] : 0;
}

// ---------------------------------------------------------------- HUD
const icons = {};
function icon(id) { return icons[id] || (icons[id] = blockIcon(atlasCanvas, id)); }
const palettes = {};
function palette(id) { return palettes[id] || (palettes[id] = tilePalette(atlasCanvas, BLOCKS[id].tiles[1])); }

function renderHotbar() {
  $("hotbar").innerHTML = hotbar.map((id, i) =>
    `<div class="slot${i === slot ? " active" : ""}" data-i="${i}"><img src="${icon(id)}" alt="${BLOCKS[id].name}"><span>${i + 1}</span></div>`).join("");
  hand.setBlock(hotbar[slot]);
}

let toastT = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 1400);
}

function selectSlot(i) {
  slot = (i + 9) % 9;
  renderHotbar();
  toast(BLOCKS[hotbar[slot]].name);
}

function renderPicker() {
  $("picker-grid").innerHTML = HOTBAR.map((id) =>
    `<button class="pick" data-id="${id}" title="${BLOCKS[id].name}"><img src="${icon(id)}" alt=""><span>${BLOCKS[id].name}</span></button>`).join("");
}

function updateDebug() {
  if (!showDebug || !player) { $("debug").hidden = true; return; }
  const [x, y, z] = player.pos;
  const col = world.gen.column(Math.floor(x), Math.floor(z));
  $("debug").hidden = false;
  $("debug").textContent =
    `Hollowstone ${VERSION}  ${fps} fps  ${settings.graphics}\n` +
    `XYZ ${x.toFixed(1)} / ${y.toFixed(1)} / ${z.toFixed(1)}\n` +
    `Chunk ${Math.floor(x / CX)}, ${Math.floor(z / CZ)}   Biome ${BIOME_NAMES[col.biome]}\n` +
    `Time ${clockString(timeOfDay)}   Chunks ${world.chunks.size} loaded, ${chunkMeshes.size} meshed\n` +
    `Seed ${world.seed}   ${player.flying ? "Flying" : player.onGround ? "Grounded" : "Airborne"}\n` +
    (target ? `Looking at ${BLOCKS[target.id].name} (${target.pos.join(", ")})` : "");
}

// ---------------------------------------------------------------- menus
function show(id) {
  for (const s of ["title", "loading", "pause", "picker"]) $(s).hidden = s !== id;
  $("hud").hidden = !(id === null || id === "picker");
  hand.group.visible = id === null || id === "picker";
}

async function renderWorldList() {
  const worlds = await Save.listWorlds();
  $("world-list").innerHTML = worlds.length ? worlds.map((w) => `
    <div class="world-row">
      <div><strong>${esc(w.name)}</strong><span>Seed ${esc(w.seed)} · ${w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : "new"}</span></div>
      <div class="row-actions"><button class="btn primary" data-play="${w.id}">Play</button><button class="btn ghost" data-del="${w.id}" title="Delete world">✕</button></div>
    </div>`).join("") : `<p class="muted">No worlds yet. Create one below.</p>`;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

function startTitleDemo() {
  clearMeshes();
  world = new World(seedFromString("hollowstone-title"));
  world.setMeshPool(pool);
  const sp = world.findSpawn();
  titleCam.center = sp; titleCam.angle = 0.6; titleCam.y = sp[1] + 34;
  player = null;
  timeOfDay = 0.71;
}

async function startWorld(m) {
  meta = m;
  show("loading");
  state = "loading";
  $("loading-text").textContent = "Loading " + m.name + "…";
  clearMeshes();
  const edits = await Save.loadEdits(m.id);
  world = new World(seedFromString(m.seed), edits);
  world.setMeshPool(pool);
  player = new Player(world);
  if (m.player) {
    player.pos = m.player.pos.slice(); player.yaw = m.player.yaw; player.pitch = m.player.pitch; player.flying = !!m.player.flying;
  } else {
    player.pos = world.findSpawn();
  }
  timeOfDay = typeof m.time === "number" ? m.time : 0.3;
  if (m.hotbar && m.hotbar.length === 9) hotbar = m.hotbar.filter((id) => BLOCKS[id]).concat(HOTBAR).slice(0, 9);
  renderHotbar();
  camera.fov = settings.fov; camera.updateProjectionMatrix();

  const pcx = Math.floor(player.pos[0] / CX), pcz = Math.floor(player.pos[2] / CZ);
  const need = Math.min(2, settings.renderDistance);
  await new Promise((resolve) => {
    const step = () => {
      world.update(pcx, pcz, need, 30, onMesh, onUnload);
      const left = world.pendingAround(pcx, pcz, need);
      const total = (need * 2 + 1) ** 2;
      $("loading-bar").style.width = Math.round(100 * (1 - left / total)) + "%";
      if (left === 0) resolve(); else requestAnimationFrame(step);
    };
    step();
  });
  while (player.intersectsSolid(...player.pos) && player.pos[1] < H) player.pos[1] += 1;

  m.lastPlayed = Date.now();
  await Save.saveWorldMeta(m);
  state = "paused";
  resume();
}

async function saveNow() {
  if (!world || !meta || !player) return;
  meta.player = { pos: player.pos.slice(), yaw: player.yaw, pitch: player.pitch, flying: player.flying };
  meta.hotbar = hotbar.slice();
  meta.time = timeOfDay;
  meta.lastPlayed = Date.now();
  try { await Save.saveEdits(meta.id, world); await Save.saveWorldMeta(meta); } catch (e) { console.warn("Save failed", e); }
}

function lockPointer() {
  try { const r = canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* needs a click first */ }
}

function resume() { show(null); state = "playing"; lockPointer(); }

function pause() {
  if (state !== "playing") return;
  state = "paused";
  mouseL = mouseR = false;
  keys.clear();
  $("clock").textContent = clockString(timeOfDay);
  $("set-time").value = Math.round(timeOfDay * 24 * 4) / 4;
  show("pause");
  saveNow();
}

async function quitToTitle() {
  await saveNow();
  meta = null;
  outline.visible = false;
  state = "title";
  show("title");
  startTitleDemo();
  renderWorldList();
}

// ---------------------------------------------------------------- input
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas && state === "playing") pause();
});
canvas.addEventListener("click", () => { if (state === "playing" && document.pointerLockElement !== canvas) lockPointer(); });

document.addEventListener("mousemove", (e) => {
  if (state !== "playing" || document.pointerLockElement !== canvas) return;
  const s = 0.0022 * settings.sensitivity;
  player.yaw -= e.movementX * s;
  player.pitch -= e.movementY * s * (settings.invertY ? -1 : 1);
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});
document.addEventListener("mousedown", (e) => {
  if (state !== "playing" || document.pointerLockElement !== canvas) return;
  if (e.button === 0) { mouseL = true; breakCooldown = 0; }
  if (e.button === 2) { mouseR = true; placeCooldown = 0; }
  if (e.button === 1 && target) { e.preventDefault(); pickBlock(target.id); }
});
document.addEventListener("mouseup", (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
document.addEventListener("contextmenu", (e) => { if (state === "playing") e.preventDefault(); });
document.addEventListener("wheel", (e) => { if (state === "playing") selectSlot(slot + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

document.addEventListener("keydown", (e) => {
  if (state === "picker" && (e.code === "KeyE" || e.code === "Escape")) { resume(); e.preventDefault(); return; }
  if (state !== "playing") return;
  keys.add(e.code);
  if (e.code.startsWith("Digit") && e.code !== "Digit0") selectSlot(Number(e.code.slice(5)) - 1);
  if (e.code === "Space") {
    const now = performance.now();
    if (now - lastSpace < 280) { player.flying = !player.flying; player.vel[1] = 0; toast(player.flying ? "Flying" : "Walking"); }
    lastSpace = now;
  }
  if (e.code === "KeyF") { player.flying = !player.flying; player.vel[1] = 0; toast(player.flying ? "Flying" : "Walking"); }
  if (e.code === "F3") { showDebug = !showDebug; e.preventDefault(); }
  if (e.code === "KeyE") { openPicker(); e.preventDefault(); }
  if (e.code === "KeyG") { settings.graphics = fancy() ? "fast" : "fancy"; storeSettings(); syncGraphics(); toast("Graphics: " + settings.graphics); }
  if (["Space", "F3", "Tab"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); mouseL = mouseR = false; });

function pickBlock(id) {
  if (!HOTBAR.includes(id)) return;
  const at = hotbar.indexOf(id);
  if (at >= 0) selectSlot(at); else { hotbar[slot] = id; renderHotbar(); toast(BLOCKS[id].name); }
}

function openPicker() {
  state = "picker";
  keys.clear(); mouseL = mouseR = false;
  renderPicker();
  show("picker");
  document.exitPointerLock?.();
}

// ---------------------------------------------------------------- world interaction
function lightAt(x, y, z) {
  return y > columnTop(x, z) ? 0.35 + 0.65 * sky.day : 0.3;
}

function tryBreak() {
  if (!target) return;
  const def = BLOCKS[target.id];
  if (!def.breakable) { toast(def.name + " can't be broken"); return; }
  const [x, y, z] = target.pos;
  const nearWater = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => world.getBlock(x + dx, y + dy, z + dz) === B.WATER);
  world.setBlock(x, y, z, nearWater ? B.WATER : B.AIR);
  const above = world.getBlock(x, y + 1, z);
  if (KIND[above] === 4) world.setBlock(x, y + 1, z, B.AIR); // plants need something to stand on
  debris.burst(x, y, z, palette(target.id), GLOW[target.id] ? 2.5 : lightAt(x, y + 1, z), def.kind === "cross" ? 10 : 22);
  hand.doSwing();
}

function tryPlace() {
  if (!target) return;
  const [x, y, z] = target.pos.map((v, i) => v + target.normal[i]);
  if (y < 0 || y >= H) return;
  const existing = world.getBlock(x, y, z);
  if (existing !== B.AIR && existing !== B.WATER && KIND[existing] !== 4) return;
  const id = hotbar[slot];
  if (KIND[id] === 4 && KIND[world.getBlock(x, y - 1, z)] !== 1) return; // plants go on solid ground
  const p = player.pos, hw = PLAYER_W / 2;
  const overlaps = x < p[0] + hw && x + 1 > p[0] - hw && z < p[2] + hw && z + 1 > p[2] - hw && y < p[1] + PLAYER_H && y + 1 > p[1];
  if (overlaps && (KIND[id] === 1 || KIND[id] === 2)) return;
  world.setBlock(x, y, z, id);
  hand.doSwing();
}

// ---------------------------------------------------------------- environment
const fogFar = () => settings.renderDistance * 16 * 0.92;
const WATER_FOG = new THREE.Color("#0d3a5c");
let underwater = false;

function applyEnvironment(eye) {
  skyState(timeOfDay, sky);
  updateSkyDome(skyDome, sky, elapsed);
  skyDome.position.copy(eye);

  underwater = !!(player && player.headInWater);
  if (underwater) {
    scene.fog.color.copy(WATER_FOG).multiplyScalar(0.25 + 0.75 * sky.day);
    scene.fog.near = 0.5; scene.fog.far = 24;
  } else {
    scene.fog.color.copy(sky.horizon);
    scene.fog.near = fogFar() * 0.5; scene.fog.far = fogFar();
  }
  skyDome.visible = !underwater;
  $("water-tint").hidden = !underwater;

  hemi.color.copy(sky.hemiSky); hemi.groundColor.copy(sky.hemiGround); hemi.intensity = sky.hemiIntensity;
  sun.color.copy(sky.lightColor); sun.intensity = sky.lightIntensity;
  const snap = 4;
  const cx = Math.round(eye.x / snap) * snap, cy = Math.round(eye.y / snap) * snap, cz = Math.round(eye.z / snap) * snap;
  sun.target.position.set(cx, cy, cz);
  sun.position.set(cx, cy, cz).addScaledVector(sky.lightDir, 200);
  sun.target.updateMatrixWorld();

  const wu = waterMat.uniforms;
  wu.uTime.value = elapsed; wu.uSunDir.value.copy(sky.lightDir); wu.uSunColor.value.copy(sky.lightColor);
  wu.uSunI.value = Math.min(1, sky.lightIntensity / 2.5); wu.uTop.value.copy(sky.top); wu.uHorizon.value.copy(sky.horizon); wu.uDay.value = sky.day;

  clouds.visible = fancy();
  if (clouds.visible) updateClouds(clouds, eye, sky, elapsed);
  shared.uTime.value = elapsed;
}

function syncGraphics() {
  sun.castShadow = fancy();
  renderer.shadowMap.needsUpdate = true;
  $("set-gfx").value = settings.graphics;
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), shadowTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;
  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }

  let moteMode = null, handLight = 1, moveSpeed = 0;

  if (world && !player && (state === "title" || state === "loading")) {
    // cinematic flyover behind the title screen
    titleCam.angle += dt * 0.035;
    timeOfDay = 0.69 + Math.sin(elapsed * 0.02) * 0.05;
    const r = 58, c = titleCam.center;
    const px = c[0] + Math.cos(titleCam.angle) * r, pz = c[2] + Math.sin(titleCam.angle) * r;
    const groundY = world.gen.column(Math.floor(px), Math.floor(pz)).h;
    titleCam.y += (Math.max(groundY + 22, c[1] + 26) - titleCam.y) * Math.min(1, dt * 0.5);
    camera.position.set(px, titleCam.y, pz);
    camera.lookAt(c[0] + Math.cos(titleCam.angle + 1.6) * 30, c[1] + 4, c[2] + Math.sin(titleCam.angle + 1.6) * 30);
    world.update(Math.floor(px / CX), Math.floor(pz / CZ), Math.min(settings.renderDistance, 7), 5, onMesh, onUnload);
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  }

  if (world && player && (state === "playing" || state === "paused" || state === "picker")) {
    const sprintKey = keys.has("ControlLeft") || keys.has("KeyR");
    if (state === "playing") {
      const input = {
        forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
        right: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
        jump: keys.has("Space"),
        down: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        sprint: sprintKey,
      };
      player.update(dt, input);
      timeOfDay = (timeOfDay + dt / (settings.dayLength * 60)) % 1;
    }
    moveSpeed = Math.hypot(player.vel[0], player.vel[2]);

    // camera: eye + view bob + sprint FOV kick
    const walking = player.onGround && !player.flying && moveSpeed > 0.5;
    bobAmt += ((walking ? 1 : 0) - bobAmt) * Math.min(1, dt * 8);
    bobPhase += dt * moveSpeed * 2.1;
    const [ex, ey, ez] = player.eye();
    const side = Math.sin(bobPhase) * 0.035 * bobAmt;
    camera.position.set(ex + Math.cos(player.yaw) * side, ey + Math.abs(Math.sin(bobPhase)) * 0.055 * bobAmt, ez - Math.sin(player.yaw) * side);
    camera.rotation.set(player.pitch, player.yaw, Math.sin(bobPhase) * 0.006 * bobAmt);
    const kick = (sprintKey && moveSpeed > 4.6 ? 9 : 0) + (player.flying && moveSpeed > 12 ? 7 : 0);
    fovKick += (kick - fovKick) * Math.min(1, dt * 6);
    const fov = settings.fov + fovKick;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

    world.update(Math.floor(player.pos[0] / CX), Math.floor(player.pos[2] / CZ), settings.renderDistance, 6, onMesh, onUnload);

    target = raycast((x, y, z) => world.getBlock(x, y, z), player.eye(), player.lookDir(), 6);
    if (target && state === "playing") {
      outline.visible = true;
      const plant = KIND[target.id] === 4;
      outline.scale.set(plant ? 0.78 : 1, 1, plant ? 0.78 : 1);
      outline.position.set(target.pos[0] + 0.5, target.pos[1] + 0.5, target.pos[2] + 0.5);
    } else outline.visible = false;

    if (state === "playing") {
      breakCooldown -= dt; placeCooldown -= dt;
      if (mouseL && breakCooldown <= 0) { tryBreak(); breakCooldown = 0.22; }
      if (mouseR && placeCooldown <= 0) { tryPlace(); placeCooldown = 0.22; }
    }

    // ambience: fireflies at night on the surface, drifting light in the hollows
    const fx = Math.floor(player.pos[0]), fz = Math.floor(player.pos[2]), fy = Math.floor(player.pos[1] + 1.6);
    const underground = fy < columnTop(fx, fz) - 1 && fy < 56;
    handLight = underground ? 0.32 : 0.3 + 0.7 * Math.max(sky.day === undefined ? 1 : sky.day, 0.25);
    const biome = world.gen.column(fx, fz).biome;
    if (underground && fy < 46) moteMode = "hollow";
    else if (!underground && (sky.night || 0) > 0.55 && (biome === 2 || biome === 3)) moteMode = "firefly";

    saveTimer += dt;
    if (saveTimer > 8) { saveTimer = 0; saveNow(); }
    updateDebug();
  }

  applyEnvironment(camera.position);
  debris.update(dt, (x, y, z) => world && KIND[world.getBlock(x, y, z)] === 1);
  motes.update(dt, elapsed, [camera.position.x, camera.position.y, camera.position.z], fancy() ? moteMode : null, window.innerHeight * renderer.getPixelRatio());
  hand.update(dt, moveSpeed, handLight);

  if (fancy() && (shadowTick++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
  if (fancy()) post.render(); else renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  post.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
window.addEventListener("beforeunload", () => { saveNow(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

// ---------------------------------------------------------------- menu wiring
$("world-list").addEventListener("click", async (e) => {
  const play = e.target.closest("[data-play]"), del = e.target.closest("[data-del]");
  const worlds = await Save.listWorlds();
  if (play) startWorld(worlds.find((w) => w.id === play.dataset.play));
  if (del) {
    const w = worlds.find((x) => x.id === del.dataset.del);
    if (del.dataset.confirm) { await Save.deleteWorld(w.id); renderWorldList(); }
    else { del.dataset.confirm = "1"; del.textContent = "Delete?"; setTimeout(() => { if (del.isConnected) { delete del.dataset.confirm; del.textContent = "✕"; } }, 2500); }
  }
});
$("create-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("new-name").value.trim() || "New World";
  const seed = $("new-seed").value.trim() || String(Math.floor(Math.random() * 2 ** 31));
  startWorld({ id: Save.newWorldId(), name, seed, created: Date.now() });
});
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", quitToTitle);
$("picker-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (!b) return;
  hotbar[slot] = Number(b.dataset.id);
  renderHotbar();
  resume();
});
$("picker-close").addEventListener("click", resume);

function bindRange(id, keyName, fmt, onChange) {
  const el = $(id), out = $(id + "-val");
  el.value = settings[keyName];
  out.textContent = fmt(settings[keyName]);
  el.addEventListener("input", () => {
    settings[keyName] = Number(el.value);
    out.textContent = fmt(settings[keyName]);
    storeSettings();
    onChange && onChange();
  });
}
bindRange("set-rd", "renderDistance", (v) => v + " chunks");
bindRange("set-fov", "fov", (v) => v + "°");
bindRange("set-sens", "sensitivity", (v) => v.toFixed(1) + "×");
bindRange("set-day", "dayLength", (v) => v + " min");
$("set-gfx").addEventListener("change", (e) => { settings.graphics = e.target.value; storeSettings(); syncGraphics(); });
$("set-time").addEventListener("input", (e) => { timeOfDay = Number(e.target.value) / 24; $("clock").textContent = clockString(timeOfDay); });

$("version").textContent = "v" + VERSION;
syncGraphics();
show("title");
startTitleDemo();
renderWorldList();

window.__hs = {
  get world() { return world; }, get player() { return player; }, scene, camera, renderer, settings, VERSION,
  get time() { return timeOfDay; }, set time(v) { timeOfDay = v; },
  teleport(x, y, z) { if (player) { player.pos = [x, y, z]; player.vel = [0, 0, 0]; } },
};
