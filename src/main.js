import * as THREE from "three";
import { World } from "./world.js";
import { Player, PLAYER_W, PLAYER_H, EYE } from "./player.js";
import { raycast } from "./raycast.js";
import { buildAtlas, blockIcon } from "./textures.js";
import { BLOCKS, HOTBAR, KIND, B } from "./blocks.js";
import { CX, CZ, H } from "./chunk.js";
import { seedFromString } from "./noise.js";
import { BIOME_NAMES } from "./worldgen.js";
import * as Save from "./save.js";

export const VERSION = "0.1.0";

// ---------------------------------------------------------------- settings
const settings = Object.assign({ renderDistance: 6, fov: 75, sensitivity: 1, invertY: false }, loadSettings());
function loadSettings() { try { return JSON.parse(localStorage.getItem("hollowstone.settings") || "{}"); } catch (e) { return {}; } }
function storeSettings() { try { localStorage.setItem("hollowstone.settings", JSON.stringify(settings)); } catch (e) { /* private mode */ } }

// ---------------------------------------------------------------- three.js setup
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const SKY = new THREE.Color("#9ccbe3"), WATER_FOG = new THREE.Color("#1c4a73");
const scene = new THREE.Scene();
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY.clone(), 50, 90);
const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.08, 1000);
camera.rotation.order = "YXZ";

const atlasCanvas = buildAtlas();
const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.generateMipmaps = false;
atlas.colorSpace = THREE.SRGBColorSpace;

const solidMat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
const waterMat = new THREE.MeshBasicMaterial({
  map: atlas, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false, side: THREE.DoubleSide,
});

// block selection outline
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x0b0f12, transparent: true, opacity: 0.55 }),
);
outline.visible = false;
scene.add(outline);

// ---------------------------------------------------------------- state
let world = null, player = null, meta = null;
let state = "title"; // title | loading | playing | paused | picker
const chunkMeshes = new Map();
let hotbar = HOTBAR.slice(0, 9), slot = 0;
const keys = new Set();
let target = null;
let breakCooldown = 0, placeCooldown = 0, mouseL = false, mouseR = false;
let lastSpace = 0, showDebug = false, saveTimer = 0;
let fps = 0, frames = 0, fpsTime = 0;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- chunk meshes
function makeGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute("color", new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function onMesh(c, data) {
  const k = c.cx + "," + c.cz;
  const old = chunkMeshes.get(k);
  if (old) { for (const m of old.children) m.geometry.dispose(); scene.remove(old); }
  const group = new THREE.Group();
  group.position.set(c.cx * CX, 0, c.cz * CZ);
  if (data.solid.vertexCount) group.add(new THREE.Mesh(makeGeometry(data.solid), solidMat));
  if (data.water.vertexCount) { const w = new THREE.Mesh(makeGeometry(data.water), waterMat); w.renderOrder = 1; group.add(w); }
  scene.add(group);
  chunkMeshes.set(k, group);
}

function onUnload(c) {
  const k = c.cx + "," + c.cz;
  const g = chunkMeshes.get(k);
  if (g) { for (const m of g.children) m.geometry.dispose(); scene.remove(g); chunkMeshes.delete(k); }
}

function clearMeshes() {
  for (const g of chunkMeshes.values()) { for (const m of g.children) m.geometry.dispose(); scene.remove(g); }
  chunkMeshes.clear();
}

// ---------------------------------------------------------------- HUD
const icons = {};
function icon(id) { return icons[id] || (icons[id] = blockIcon(atlasCanvas, id)); }

function renderHotbar() {
  $("hotbar").innerHTML = hotbar.map((id, i) =>
    `<div class="slot${i === slot ? " active" : ""}" data-i="${i}"><img src="${icon(id)}" alt="${BLOCKS[id].name}"><span>${i + 1}</span></div>`).join("");
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
    `Hollowstone ${VERSION}  ${fps} fps\n` +
    `XYZ ${x.toFixed(1)} / ${y.toFixed(1)} / ${z.toFixed(1)}\n` +
    `Chunk ${Math.floor(x / CX)}, ${Math.floor(z / CZ)}   Biome ${BIOME_NAMES[col.biome]}\n` +
    `Chunks ${world.chunks.size} loaded, ${chunkMeshes.size} meshed\n` +
    `Seed ${world.seed}   ${player.flying ? "Flying" : player.onGround ? "Grounded" : "Airborne"}\n` +
    (target ? `Looking at ${BLOCKS[target.id].name} (${target.pos.join(", ")})` : "");
}

// ---------------------------------------------------------------- menus
function show(id) {
  for (const s of ["title", "loading", "pause", "picker"]) $(s).hidden = s !== id;
  $("hud").hidden = !(id === null || id === "picker");
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

async function startWorld(m) {
  meta = m;
  show("loading");
  state = "loading";
  $("loading-text").textContent = "Loading " + m.name + "…";
  clearMeshes();
  const edits = await Save.loadEdits(m.id);
  world = new World(seedFromString(m.seed), edits);
  player = new Player(world);
  if (m.player) {
    player.pos = m.player.pos.slice(); player.yaw = m.player.yaw; player.pitch = m.player.pitch; player.flying = !!m.player.flying;
  } else {
    player.pos = world.findSpawn();
  }
  if (m.hotbar && m.hotbar.length === 9) hotbar = m.hotbar.slice();
  renderHotbar();
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  applyFog(false);

  // pre-load the area around the player before letting them move
  const pcx = Math.floor(player.pos[0] / CX), pcz = Math.floor(player.pos[2] / CZ);
  const need = Math.min(2, settings.renderDistance);
  await new Promise((resolve) => {
    const step = () => {
      world.update(pcx, pcz, need, 40, onMesh, onUnload);
      const left = world.pendingAround(pcx, pcz, need);
      const total = (need * 2 + 1) ** 2;
      $("loading-bar").style.width = Math.round(100 * (1 - left / total)) + "%";
      if (left === 0) resolve(); else requestAnimationFrame(step);
    };
    step();
  });
  // never spawn inside blocks (e.g. a tree on a new world)
  while (player.intersectsSolid(...player.pos) && player.pos[1] < H) player.pos[1] += 1;

  m.lastPlayed = Date.now();
  await Save.saveWorldMeta(m);
  state = "paused";
  resume();
}

async function saveNow() {
  if (!world || !meta) return;
  meta.player = { pos: player.pos.slice(), yaw: player.yaw, pitch: player.pitch, flying: player.flying };
  meta.hotbar = hotbar.slice();
  meta.lastPlayed = Date.now();
  try { await Save.saveEdits(meta.id, world); await Save.saveWorldMeta(meta); } catch (e) { console.warn("Save failed", e); }
}

function resume() {
  show(null);
  state = "playing";
  canvas.requestPointerLock?.();
}

function pause() {
  if (state !== "playing") return;
  state = "paused";
  mouseL = mouseR = false;
  keys.clear();
  show("pause");
  saveNow();
}

async function quitToTitle() {
  await saveNow();
  clearMeshes();
  world = null; player = null; meta = null;
  outline.visible = false;
  state = "title";
  show("title");
  renderWorldList();
}

// ---------------------------------------------------------------- input
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas && state === "playing") pause();
});

canvas.addEventListener("click", () => { if (state === "playing" && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });

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
document.addEventListener("wheel", (e) => {
  if (state !== "playing") return;
  selectSlot(slot + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });

document.addEventListener("keydown", (e) => {
  if (state === "picker" && (e.code === "KeyE" || e.code === "Escape")) { closePicker(); e.preventDefault(); return; }
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
function closePicker() { resume(); }

// ---------------------------------------------------------------- world interaction
function tryBreak() {
  if (!target) return;
  const def = BLOCKS[target.id];
  if (!def.breakable) { toast(def.name + " can't be broken"); return; }
  const [x, y, z] = target.pos;
  // let water flow into the gap if it borders water (simple, one step)
  const nearWater = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => world.getBlock(x + dx, y + dy, z + dz) === B.WATER);
  world.setBlock(x, y, z, nearWater ? B.WATER : B.AIR);
}

function tryPlace() {
  if (!target) return;
  const [x, y, z] = target.pos.map((v, i) => v + target.normal[i]);
  if (y < 0 || y >= H) return;
  const existing = world.getBlock(x, y, z);
  if (existing !== B.AIR && existing !== B.WATER) return;
  const id = hotbar[slot];
  // don't place a solid block inside the player
  const p = player.pos, hw = PLAYER_W / 2;
  const overlaps = x < p[0] + hw && x + 1 > p[0] - hw && z < p[2] + hw && z + 1 > p[2] - hw && y < p[1] + PLAYER_H && y + 1 > p[1];
  if (overlaps && KIND[id] !== 3) return;
  world.setBlock(x, y, z, id);
}

// ---------------------------------------------------------------- fog / underwater
let underwater = null;
function applyFog(isUnder) {
  if (underwater === isUnder && (isUnder || scene.fog.far === fogFar())) return;
  underwater = isUnder;
  if (isUnder) {
    scene.fog.color.copy(WATER_FOG); scene.background.copy(WATER_FOG);
    scene.fog.near = 0.5; scene.fog.far = 22;
  } else {
    scene.fog.color.copy(SKY); scene.background.copy(SKY);
    scene.fog.near = fogFar() * 0.55; scene.fog.far = fogFar();
  }
  $("water-tint").hidden = !isUnder;
}
const fogFar = () => settings.renderDistance * 16 * 0.92;

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }

  if (world && player && (state === "playing" || state === "paused" || state === "picker")) {
    if (state === "playing") {
      const input = {
        forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
        right: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
        jump: keys.has("Space"),
        down: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        sprint: keys.has("ControlLeft") || keys.has("KeyR"),
      };
      player.update(dt, input);
    }

    const [ex, ey, ez] = player.eye();
    camera.position.set(ex, ey, ez);
    camera.rotation.set(player.pitch, player.yaw, 0);

    // stream chunks around the player
    world.update(Math.floor(player.pos[0] / CX), Math.floor(player.pos[2] / CZ), settings.renderDistance, 7, onMesh, onUnload);

    // targeting
    target = raycast((x, y, z) => world.getBlock(x, y, z), player.eye(), player.lookDir(), 6);
    if (target && state === "playing") {
      outline.visible = true;
      outline.position.set(target.pos[0] + 0.5, target.pos[1] + 0.5, target.pos[2] + 0.5);
    } else outline.visible = false;

    if (state === "playing") {
      breakCooldown -= dt; placeCooldown -= dt;
      if (mouseL && breakCooldown <= 0) { tryBreak(); breakCooldown = 0.25; }
      if (mouseR && placeCooldown <= 0) { tryPlace(); placeCooldown = 0.25; }
    }

    applyFog(player.headInWater);

    saveTimer += dt;
    if (saveTimer > 8) { saveTimer = 0; saveNow(); }
    updateDebug();
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
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
  closePicker();
});
$("picker-close").addEventListener("click", closePicker);

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
bindRange("set-rd", "renderDistance", (v) => v + " chunks", () => applyFog(underwater));
bindRange("set-fov", "fov", (v) => v + "°", () => { camera.fov = settings.fov; camera.updateProjectionMatrix(); });
bindRange("set-sens", "sensitivity", (v) => v.toFixed(1) + "×");

$("version").textContent = "v" + VERSION;
show("title");
renderWorldList();

// Debug handle for testing from the console.
window.__hs = { get world() { return world; }, get player() { return player; }, scene, camera, renderer, settings, VERSION,
  teleport(x, y, z) { if (player) { player.pos = [x, y, z]; player.vel = [0, 0, 0]; } } };
