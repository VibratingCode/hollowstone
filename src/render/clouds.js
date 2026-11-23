// A high layer of chunky, pixel-edged clouds drifting with the wind. Lit by the sun, tinted at dusk.
import * as THREE from "three";

export const CLOUD_Y = 150;

export function createClouds() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: {
      uTime: { value: 0 }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uCam: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uLit, uShade, uCam, uHorizon;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        vec2 drift = vec2(uTime * 1.4, uTime * 0.5);
        vec2 cell = floor((vWorld.xz + drift) / 6.0);          // 6-block pixels
        float n = fbm(cell * 0.045);
        float c = smoothstep(0.53, 0.56, n);
        if (c < 0.01) discard;
        float inner = smoothstep(0.56, 0.72, n);
        vec3 col = mix(uLit, uShade, inner * 0.7);
        float dist = length(vWorld.xz - uCam.xz);
        float fade = 1.0 - smoothstep(380.0, 900.0, dist);
        col = mix(col, uHorizon, smoothstep(150.0, 900.0, dist) * 0.8);
        gl_FragColor = vec4(col, c * fade * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

export function updateClouds(mesh, cam, s, time) {
  mesh.position.set(Math.round(cam.x / 6) * 6, CLOUD_Y, Math.round(cam.z / 6) * 6);
  const u = mesh.material.uniforms;
  u.uTime.value = time;
  u.uCam.value.copy(cam);
  u.uHorizon.value.copy(s.horizon);
  u.uLit.value.setRGB(0.09, 0.11, 0.17).lerp(new THREE.Color(1, 1, 1), s.day);
  u.uLit.value.lerp(new THREE.Color("#ffb27a"), s.sunset * 0.55);
  u.uShade.value.copy(u.uLit.value).multiplyScalar(0.68).lerp(s.top, 0.15);
}
