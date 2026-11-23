// Day/night cycle: sun, moon, sky colours, stars and the lighting they imply.
import * as THREE from "three";

const C = (h) => new THREE.Color(h);
// sky keyframes by sun elevation (y of the sun direction)
const KEYS = [
  { e: -1.0, top: C("#02040a"), hor: C("#070d1c") },
  { e: -0.22, top: C("#040816"), hor: C("#0e1730") },
  { e: -0.08, top: C("#111d42"), hor: C("#3b3054") },
  { e: 0.02, top: C("#29508f"), hor: C("#f0915a") },
  { e: 0.14, top: C("#2f6cb8"), hor: C("#e9c39a") },
  { e: 0.35, top: C("#2c74c6"), hor: C("#a7d1ea") },
  { e: 1.0, top: C("#2466b8"), hor: C("#9ccbe6") },
];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** t in [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset */
export function skyState(t, out = {}) {
  const a = (t - 0.25) * Math.PI * 2;
  const sunDir = (out.sunDir || new THREE.Vector3()).set(Math.cos(a), Math.sin(a), 0.32).normalize();
  const e = sunDir.y;
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const f = Math.min(1, Math.max(0, (e - k0.e) / (k1.e - k0.e)));
  out.top = (out.top || new THREE.Color()).copy(k0.top).lerp(k1.top, f);
  out.horizon = (out.horizon || new THREE.Color()).copy(k0.hor).lerp(k1.hor, f);
  out.sunDir = sunDir;
  out.day = smooth(-0.1, 0.25, e);
  out.night = 1 - smooth(-0.18, 0.02, e);
  out.sunset = Math.exp(-Math.pow((e - 0.02) / 0.14, 2));

  const sunI = smooth(-0.03, 0.22, e) * 2.9;
  const moonI = smooth(0.02, -0.25, e) * 0.42;
  out.sunColor = (out.sunColor || new THREE.Color()).set("#ffae66").lerp(C("#fff4e2"), smooth(0.0, 0.4, e));
  out.lightDir = (out.lightDir || new THREE.Vector3());
  out.lightColor = (out.lightColor || new THREE.Color());
  if (sunI >= moonI) { out.lightDir.copy(sunDir); out.lightColor.copy(out.sunColor); out.lightIntensity = sunI; }
  else { out.lightDir.copy(sunDir).negate(); out.lightColor.set("#9db4ff"); out.lightIntensity = moonI; }

  out.hemiSky = (out.hemiSky || new THREE.Color()).copy(out.top).lerp(out.horizon, 0.45);
  out.hemiGround = (out.hemiGround || new THREE.Color()).set("#5a4a3a").multiplyScalar(0.35 + 0.65 * out.day);
  out.hemiIntensity = 0.16 + 1.05 * out.day;
  return out;
}

export function clockString(t) {
  const mins = Math.floor(t * 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function createSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uSunset: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
      uniform float uSunset, uNight, uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.48));
        if (h < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-h * 3.0, 0.0, 1.0));
        float sd = dot(d, uSunDir);
        col += uSunColor * pow(max(sd, 0.0), 5.0) * (0.12 + 0.55 * uSunset);
        col += uSunColor * pow(max(sd, 0.0), 90.0) * 0.8;
        col += uSunColor * smoothstep(0.99935, 0.99965, sd) * 24.0;
        float md = dot(d, -uSunDir);
        col += vec3(0.8, 0.86, 1.0) * smoothstep(0.99905, 0.99935, md) * 3.0 * uNight;
        col += vec3(0.25, 0.35, 0.7) * pow(max(md, 0.0), 60.0) * 0.35 * uNight;
        vec3 p = floor(d * 260.0);
        float s = fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        float star = step(0.9978, s) * smoothstep(-0.02, 0.25, h) * uNight;
        star *= 0.55 + 0.45 * sin(uTime * 2.2 + s * 400.0);
        col += vec3(0.85, 0.9, 1.0) * star * 2.2;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function updateSkyDome(mesh, s, time) {
  const u = mesh.material.uniforms;
  u.uTop.value.copy(s.top); u.uHorizon.value.copy(s.horizon);
  u.uSunDir.value.copy(s.sunDir); u.uSunColor.value.copy(s.sunColor);
  u.uSunset.value = s.sunset; u.uNight.value = s.night; u.uTime.value = time;
}
