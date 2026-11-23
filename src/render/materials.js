// Materials: lit terrain (sun/sky light + shadows, emissive block light, wind sway) and animated water.
import * as THREE from "three";

export const shared = { uTime: { value: 0 } };

export function createTerrainMaterial(atlas) {
  const mat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 aBlock;
        attribute float aWind;
        uniform float uTime;
        varying vec3 vBlock;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vBlock = aBlock;
        if (aWind > 0.0) {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float t = uTime;
          float sway = sin(t * 1.7 + wp.x * 0.55 + wp.z * 0.35) * 0.055 + sin(t * 3.3 + wp.z * 0.9) * 0.022;
          transformed.x += aWind * sway;
          transformed.z += aWind * sin(t * 1.3 + wp.x * 0.45) * 0.045;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vBlock;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        #ifdef USE_MAP
          totalEmissiveRadiance += sampledDiffuseColor.rgb * vBlock * 1.25;
        #endif
        totalEmissiveRadiance += diffuseColor.rgb * 0.018;`);
  };
  mat.customProgramCacheKey = () => "hollowstone-terrain";
  return mat;
}

// Depth material so leaf and glass holes don't cast solid shadows.
export function createDepthMaterial(atlas) {
  return new THREE.MeshDepthMaterial({ map: atlas, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
}

export function createWaterMaterial(atlas) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, vertexColors: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, map: { value: atlas },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunI: { value: 1 }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uDay: { value: 1 },
    }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 aBlock;
      uniform float uTime;
      varying vec3 vWorld; varying vec3 vN; varying float vSky; varying vec3 vBlock; varying vec2 vUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        if (normal.y > 0.5) wp.y += (sin(wp.x * 0.8 + uTime * 1.3) + sin(wp.z * 0.65 + uTime * 1.05)) * 0.025;
        vWorld = wp.xyz; vN = normal; vSky = color.r; vBlock = aBlock; vUv = uv;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uSunI, uDay;
      uniform vec3 uSunDir, uSunColor, uTop, uHorizon;
      uniform sampler2D map;
      varying vec3 vWorld; varying vec3 vN; varying float vSky; varying vec3 vBlock; varying vec2 vUv;
      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.0) * cos(p.x * 0.8 + t * 1.3) * 0.5;
        g += vec2(0.0, 0.65) * cos(p.y * 0.65 + t * 1.05) * 0.5;
        g += vec2(1.7, 1.1) * cos(dot(p, vec2(1.7, 1.1)) + t * 2.1) * 0.18;
        g += vec2(-2.3, 2.9) * cos(dot(p, vec2(-2.3, 2.9)) - t * 2.7) * 0.08;
        g += vec2(4.1, -3.7) * cos(dot(p, vec2(4.1, -3.7)) + t * 3.9) * 0.035;
        return g;
      }
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vN);
        if (vN.y > 0.5) { vec2 g = waveGrad(vWorld.xz, uTime); N = normalize(vec3(-g.x * 0.12, 1.0, -g.y * 0.12)); }
        if (dot(N, V) < 0.0) N = -N; // seen from below
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHorizon, uTop, pow(clamp(R.y, 0.0, 1.0), 0.5));
        vec3 deep = vec3(0.025, 0.11, 0.2) * (0.18 + 0.82 * uDay) * (0.35 + 0.65 * vSky);
        vec3 tex = texture2D(map, vUv).rgb;
        vec3 col = mix(deep + tex * 0.05 * uDay, sky * vSky, fres);
        float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * uSunI * vSky;
        col += uSunColor * spec * 4.0;
        col += vBlock * 0.35;
        float alpha = mix(0.78, 0.97, fres);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
