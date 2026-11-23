// Particles: block-break debris, plus ambient motes (fireflies at night, drifting light in the hollows).
import * as THREE from "three";

const MAX_DEBRIS = 600;

export class Debris {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.parts = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  burst(x, y, z, palette, brightness = 1, count = 22) {
    for (let i = 0; i < count && this.parts.length < MAX_DEBRIS; i++) {
      const col = palette[(Math.random() * palette.length) | 0];
      this.parts.push({
        p: [x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6],
        v: [(Math.random() - 0.5) * 4, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 4],
        r: [Math.random() * 6, Math.random() * 6], size: 0.07 + Math.random() * 0.09,
        life: 0.7 + Math.random() * 0.7, age: 0, color: [col[0] * brightness, col[1] * brightness, col[2] * brightness],
      });
    }
  }

  update(dt, isSolid) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const d = this.parts[i];
      d.age += dt;
      if (d.age >= d.life) { this.parts.splice(i, 1); continue; }
      d.v[1] -= 16 * dt;
      const nx = d.p[0] + d.v[0] * dt, ny = d.p[1] + d.v[1] * dt, nz = d.p[2] + d.v[2] * dt;
      if (isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        d.v[0] *= 0.4; d.v[2] *= 0.4; d.v[1] = Math.abs(d.v[1]) * 0.25;
      } else { d.p[0] = nx; d.p[1] = ny; d.p[2] = nz; }
    }
    for (const d of this.parts) {
      const k = 1 - Math.pow(d.age / d.life, 3);
      this._p.set(d.p[0], d.p[1], d.p[2]);
      this._q.setFromEuler(new THREE.Euler(d.r[0] + d.age * 5, d.r[1] + d.age * 3, 0));
      this._s.setScalar(d.size * k);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this._c.setRGB(d.color[0], d.color[1], d.color[2]));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const MOTES = 220, RANGE = 26;

export class Motes {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.base = new Float32Array(MOTES * 3);
    this.phase = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      this.base[i * 3] = (Math.random() - 0.5) * RANGE * 2;
      this.base[i * 3 + 1] = (Math.random() - 0.5) * RANGE;
      this.base[i * 3 + 2] = (Math.random() - 0.5) * RANGE * 2;
      this.phase[i] = Math.random() * 100;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(this.phase, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uScale: { value: 300 } },
      vertexShader: /* glsl */`
        attribute float aPhase; uniform float uTime, uScale; varying float vTw;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.3 + fract(aPhase) * 1.7) + aPhase), 3.0);
          gl_PointSize = uScale * 0.11 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAlpha; varying float vTw;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor * (1.0 + 2.0 * a * a), a * uAlpha * vTw);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.alpha = 0;
  }

  /** mode: "firefly" | "hollow" | null */
  update(dt, time, center, mode, viewportH) {
    const target = mode ? 1 : 0;
    this.alpha += (target - this.alpha) * Math.min(1, dt * 1.5);
    this.mat.uniforms.uAlpha.value = this.alpha;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = viewportH;
    this.points.visible = this.alpha > 0.01;
    if (!this.points.visible) return;
    if (mode) this.mat.uniforms.uColor.value.set(mode === "hollow" ? "#58ffe0" : "#d9ff72");
    const pos = this.points.geometry.attributes.position.array;
    for (let i = 0; i < MOTES; i++) {
      const ph = this.phase[i];
      // wrap each mote into a box around the player so they're always nearby
      for (let k = 0; k < 3; k++) {
        const span = k === 1 ? RANGE : RANGE * 2;
        const w = this.base[i * 3 + k] + Math.sin(time * 0.3 + ph * (k + 1)) * 2.5;  // world-anchored
        const rel = (((w - center[k] + span / 2) % span) + span) % span - span / 2;
        pos[i * 3 + k] = center[k] + rel;
      }
      if (mode === "firefly") pos[i * 3 + 1] = center[1] - 2 + ((this.base[i * 3 + 1] + RANGE / 2) / RANGE) * 7 + Math.sin(time + ph) * 0.6;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
