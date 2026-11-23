// First-person player physics: walking, jumping, swimming, flying and voxel collision.

import { SOLID, KIND, B } from "./blocks.js";

export const PLAYER_W = 0.6, PLAYER_H = 1.8, EYE = 1.62;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = [0, 80, 0];   // feet position (centre of the bottom of the box)
    this.vel = [0, 0, 0];
    this.yaw = 0;            // radians, 0 = looking toward -z
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
  }

  eye() { return [this.pos[0], this.pos[1] + EYE, this.pos[2]]; }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  // unloaded chunks count as solid so the player never falls out of the world
  solidAt(x, y, z) { return SOLID[this.world.getBlock(x, y, z, B.DEEPCORE)] === 1; }

  intersectsSolid(px, py, pz) {
    const hw = PLAYER_W / 2;
    const x0 = Math.floor(px - hw), x1 = Math.floor(px + hw - 1e-6);
    const y0 = Math.floor(py), y1 = Math.floor(py + PLAYER_H - 1e-6);
    const z0 = Math.floor(pz - hw), z1 = Math.floor(pz + hw - 1e-6);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (this.solidAt(x, y, z)) return true;
    }
    return false;
  }

  /** input: {forward, right, jump, down, sprint} each -1..1 / bool */
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    const w = this.world;
    const feetBlock = w.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.2), Math.floor(this.pos[2]));
    const headBlock = w.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + EYE), Math.floor(this.pos[2]));
    this.inWater = KIND[feetBlock] === 3;
    this.headInWater = KIND[headBlock] === 3;

    // desired horizontal velocity
    let speed = this.flying ? (input.sprint ? 22 : 11) : input.sprint ? 5.8 : 4.3;
    if (this.inWater && !this.flying) speed *= 0.55;
    if (input.down && !this.flying && this.onGround) speed *= 0.4; // sneak
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = -sin * input.forward + cos * input.right;
    let mz = -cos * input.forward - sin * input.right;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const accel = this.onGround || this.flying ? 14 : this.inWater ? 6 : 3.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel[0] += (mx * speed - this.vel[0]) * k;
    this.vel[2] += (mz * speed - this.vel[2]) * k;

    // vertical
    if (this.flying) {
      const vy = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vel[1] += (vy * speed * 0.8 - this.vel[1]) * (1 - Math.exp(-12 * dt));
    } else if (this.inWater) {
      this.vel[1] -= 9 * dt;
      this.vel[1] *= Math.exp(-3.5 * dt);
      if (input.jump) this.vel[1] = Math.min(this.vel[1] + 26 * dt, 3.6);
      this.vel[1] = Math.max(this.vel[1], -4);
    } else {
      this.vel[1] -= 28 * dt;
      this.vel[1] = Math.max(this.vel[1], -55);
      if (input.jump && this.onGround) this.vel[1] = 8.6;
    }

    // move axis by axis and resolve collisions
    this.onGround = false;
    for (let axis = 0; axis < 3; axis++) {
      const delta = this.vel[axis] * dt;
      if (delta === 0) continue;
      const next = this.pos.slice();
      next[axis] += delta;
      if (!this.intersectsSolid(next[0], next[1], next[2])) {
        // sneaking keeps you from walking off edges
        if (axis !== 1 && input.down && !this.flying && this.wasOnGround &&
          !this.intersectsSolid(next[0], next[1] - 0.6, next[2])) { this.vel[axis] = 0; continue; }
        this.pos[axis] = next[axis];
      } else {
        // step to the boundary
        const hw = PLAYER_W / 2;
        if (axis === 1) {
          this.pos[1] = delta < 0 ? Math.floor(this.pos[1] + delta) + 1 : Math.ceil(this.pos[1] + PLAYER_H + delta) - 1 - PLAYER_H;
          if (this.intersectsSolid(this.pos[0], this.pos[1], this.pos[2])) this.pos[1] = next[1] - delta;
          if (delta < 0) this.onGround = true;
        } else {
          const edge = delta > 0 ? Math.floor(this.pos[axis] + hw + delta) - hw - 1e-4 : Math.floor(this.pos[axis] - hw + delta) + 1 + hw + 1e-4;
          if (!this.intersectsSolid(...replace(this.pos, axis, edge))) this.pos[axis] = edge;
        }
        this.vel[axis] = 0;
      }
    }
    if (this.onGround && this.flying) this.flying = false;
    this.wasOnGround = this.onGround;
  }
}

function replace(arr, i, v) { const a = arr.slice(); a[i] = v; return a; }
