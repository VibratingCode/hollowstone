// Post-processing: HDR render -> bloom -> ACES tone mapping + sRGB output.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.5, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer, bloom,
    setSize(w, h) { composer.setSize(w, h); bloom.resolution.set(w / 2, h / 2); },
    render() { composer.render(); },
  };
}
