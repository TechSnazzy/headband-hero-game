import * as THREE from 'three';
import type { LevelDef, PropDef } from '../levels/types';
import { Terrain } from './Terrain';
import { Physics } from './Physics';
import { buildProp, GrassField, type BuiltProp } from './props';
import { mulberry32, distToSegment } from './noise';

/** Builds and owns everything static in a level: terrain, sky, lights, props, foliage. */
export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly physics: Physics;
  readonly props: BuiltProp[] = [];
  readonly sun: THREE.DirectionalLight;
  private flames: THREE.Object3D[] = [];
  private lights: THREE.PointLight[] = [];
  private mist: THREE.Sprite[] = [];
  readonly grass: GrassField;
  private time = 0;

  constructor(
    readonly level: LevelDef,
    scene: THREE.Scene,
  ) {
    scene.add(this.group);
    this.terrain = new Terrain(level);
    this.group.add(this.terrain.group);
    this.physics = new Physics(this.terrain);

    const m = level.mood;
    scene.background = new THREE.Color(m.skyHorizon);
    scene.fog = new THREE.Fog(m.fog, m.fogNear, m.fogFar);
    this.group.add(skyDome(m.skyTop, m.skyHorizon));

    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x4a6a2a, m.ambient);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight(m.sun, m.sunIntensity);
    this.sun.position.set(30, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun, this.sun.target);

    this.grass = new GrassField(9000);
    this.group.add(this.grass.mesh);
    const ctx = {
      scene: this.group,
      physics: this.physics,
      ground: (x: number, z: number) => this.terrain.heightAt(x, z),
      grass: this.grass,
    };
    for (const def of [...level.props, ...this.scatterForest()]) {
      const built = buildProp(def, ctx);
      this.props.push(built);
      if (built.flame) this.flames.push(built.flame);
      if (built.light) this.lights.push(built.light);
    }
    if (m.mist) this.addMist();
  }

  /** Procedural jungle: trees, bushes and grass, kept away from paths and clear zones. */
  private scatterForest(): PropDef[] {
    const L = this.level;
    const rnd = mulberry32(L.seed * 3 + 7);
    const out: PropDef[] = [];
    const area = L.size.w * L.size.d;
    const blocked = (x: number, z: number, pad: number): boolean => {
      for (const k of L.forest.keepClear) if (Math.hypot(x - k.x, z - k.z) < k.r + pad) return true;
      for (const p of L.terrain.paths) {
        for (let i = 0; i < p.points.length - 1; i++) {
          const [ax, az] = p.points[i];
          const [bx, bz] = p.points[i + 1];
          if (distToSegment(x, z, ax, az, bx, bz) < p.width / 2 + pad) return true;
        }
      }
      for (const d of L.props) if (Math.hypot(x - d.x, z - d.z) < pad + 2.5) return true;
      return false;
    };
    const place = (type: PropDef['type'], count: number, pad: number, minSpacing: number): void => {
      const placed: [number, number][] = [];
      let tries = 0;
      while (placed.length < count && tries++ < count * 20) {
        const x = (rnd() - 0.5) * (L.size.w - 6);
        const z = (rnd() - 0.5) * (L.size.d - 6);
        if (blocked(x, z, pad)) continue;
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < minSpacing)) continue;
        if (out.some((o) => o.type === 'tree' && Math.hypot(o.x - x, o.z - z) < 2.5)) continue;
        placed.push([x, z]);
        out.push({
          type,
          x,
          z,
          rot: Math.floor(rnd() * 4) * (Math.PI / 2),
          scale: 0.85 + rnd() * 0.35,
        });
      }
    };
    place('tree', Math.floor((area / 100) * L.forest.treeDensity), 3, 4.2);
    place('bush', Math.floor((area / 100) * L.forest.bushDensity), 1.5, 3);
    place('grass', Math.floor((area / 100) * L.forest.grassDensity), 1, 4);
    return out;
  }

  private addMist(): void {
    const tex = mistTexture();
    const rnd = mulberry32(this.level.seed + 99);
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.32 + rnd() * 0.2,
        depthWrite: false,
        fog: true,
      });
      const s = new THREE.Sprite(mat);
      const x = (rnd() - 0.5) * this.level.size.w;
      const z = (rnd() - 0.5) * this.level.size.d;
      s.position.set(x, this.terrain.heightAt(x, z) + 2 + rnd() * 5, z);
      const size = 16 + rnd() * 18;
      s.scale.set(size, size * 0.45, 1);
      s.userData.drift = (rnd() - 0.5) * 0.8;
      this.mist.push(s);
      this.group.add(s);
    }
  }

  /** Keeps the shadow camera centered on the hero and animates fire and mist. */
  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    this.sun.position.set(focus.x + 30, focus.y + 60, focus.z + 20);
    this.sun.target.position.copy(focus);
    for (const f of this.flames) {
      const t = this.time * 9 + f.userData.flicker;
      f.scale.set(
        1 + Math.sin(t) * 0.12,
        1 + Math.sin(t * 1.7) * 0.2,
        1 + Math.cos(t * 1.3) * 0.12,
      );
      f.rotation.y += dt * 2;
    }
    for (const l of this.lights)
      l.intensity = 16 + Math.sin(this.time * 13) * 2 + Math.sin(this.time * 7.3) * 2;
    for (const s of this.mist) {
      s.position.x += s.userData.drift * dt;
      const half = this.level.size.w / 2;
      if (s.position.x > half) s.position.x = -half;
      if (s.position.x < -half) s.position.x = half;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose?.();
    });
  }
}

function skyDome(top: number, horizon: number): THREE.Mesh {
  const g = new THREE.SphereGeometry(300, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      horizon: { value: new THREE.Color(horizon) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main(){ float h = clamp(normalize(vPos).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  m.onBeforeRender = (_r, _s, cam) => m.position.copy(cam.position);
  return m;
}

function mistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(240,248,248,0.35)');
  grad.addColorStop(1, 'rgba(240,248,248,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
