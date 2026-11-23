// The block in your hand: bobs as you walk, swings when you break or place.
import * as THREE from "three";
import { BLOCKS } from "../blocks.js";
import { ATLAS_COLS, ATLAS_ROWS } from "../mesher.js";

export class Hand {
  constructor(camera, atlas) {
    this.mat = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), this.mat);
    this.flat = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), this.mat);
    this.group = new THREE.Group();
    this.group.add(this.cube, this.flat);
    for (const m of [this.cube, this.flat]) { m.renderOrder = 100; m.frustumCulled = false; }
    camera.add(this.group);
    this.swing = 0; this.bob = 0; this.id = -1; this.switchT = 0;
  }

  setBlock(id) {
    if (id === this.id) return;
    this.id = id;
    this.switchT = 1;
    const def = BLOCKS[id];
    const isFlat = def.kind === "cross";
    this.cube.visible = !isFlat; this.flat.visible = isFlat;
    const rect = (tile) => {
      const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
      return [tx / ATLAS_COLS, (tx + 1) / ATLAS_COLS, 1 - (ty + 1) / ATLAS_ROWS, 1 - ty / ATLAS_ROWS];
    };
    if (isFlat) {
      const [u0, u1, v0, v1] = rect(def.tiles[0]);
      const uv = this.flat.geometry.attributes.uv;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      uv.needsUpdate = true;
    } else {
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each: tl, tr, bl, br)
      const slots = [1, 1, 0, 2, 1, 1];
      const uv = this.cube.geometry.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const [u0, u1, v0, v1] = rect(def.tiles[slots[f]]);
        uv.setXY(f * 4, u0, v1); uv.setXY(f * 4 + 1, u1, v1); uv.setXY(f * 4 + 2, u0, v0); uv.setXY(f * 4 + 3, u1, v0);
      }
      uv.needsUpdate = true;
    }
  }

  doSwing() { this.swing = 1; }

  update(dt, moveSpeed, brightness) {
    this.swing = Math.max(0, this.swing - dt * 4.5);
    this.switchT = Math.max(0, this.switchT - dt * 5);
    this.bob += dt * moveSpeed * 1.9;
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const bobX = Math.sin(this.bob) * 0.025 * Math.min(1, moveSpeed / 4);
    const bobY = Math.abs(Math.cos(this.bob)) * 0.03 * Math.min(1, moveSpeed / 4);
    this.group.position.set(0.5 + bobX - s * 0.12, -0.46 + bobY - s * 0.1 - this.switchT * 0.35, -0.78 - s * 0.08);
    this.group.rotation.set(0.12 - s * 0.9, -0.72 + s * 0.3, s * 0.2);
    this.flat.rotation.y = 0.5;
    this.mat.color.setScalar(brightness);
  }
}
