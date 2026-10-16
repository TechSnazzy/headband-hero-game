import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-processing chain for the "high" graphics setting:
 * ambient occlusion (grounds the blocks and adds contact shadows in corners),
 * bloom on bright things only (muzzle flashes, fire, torches), and a light
 * color grade + vignette. The "low" setting renders straight to the screen.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: 0.16 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    warmth: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, saturation, contrast, warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      // Warm highlights, slightly cool shadows.
      c.rgb += vec3(warmth, warmth * 0.4, -warmth) * (l - 0.35);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d) * 2.2;
      gl_FragColor = c;
    }`,
};

export class PostFX {
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {}

  /** (Re)builds the chain for a camera. Called on level load. */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.composer?.dispose();
    const w = innerWidth;
    const h = innerHeight;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, camera));
    // Half-resolution AO keeps the cost down.
    this.gtao = new GTAOPass(this.scene, camera, Math.ceil(w / 2), Math.ceil(h / 2));
    this.gtao.updateGtaoMaterial({
      radius: 0.9,
      distanceExponent: 1.4,
      thickness: 1.2,
      scale: 1.1,
    });
    this.gtao.blendIntensity = 0.7;
    composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.5, 0.88);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    this.composer = composer;
    this.resize();
  }

  resize(): void {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
    this.gtao?.setSize(Math.ceil(innerWidth / 2), Math.ceil(innerHeight / 2));
  }

  render(camera: THREE.Camera): void {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, camera);
  }
}
