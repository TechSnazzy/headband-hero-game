import * as THREE from 'three';
import { VoxelBuilder, voxelMaterial } from './voxel';
import { PALETTE } from '../config/palette';
import type { Physics } from './Physics';
import type { PropDef } from '../levels/types';
import { mulberry32 } from './noise';

/**
 * Procedural voxel props. Geometry for repeated props (trees, rocks, crates) is
 * cached per variant and shared between instances.
 */

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => VoxelBuilder): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build().build();
    geoCache.set(key, g);
  }
  return g;
}

function meshOf(g: THREE.BufferGeometry, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(g, voxelMaterial());
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- trees

function jungleTreeGeo(variant: number): {
  geo: THREE.BufferGeometry;
  height: number;
  canopyR: number;
} {
  const rnd = mulberry32(1000 + variant);
  const height = 7 + Math.floor(rnd() * 5);
  const canopyR = 2.2 + rnd() * 1.2;
  const geo = cached(`tree${variant}`, () => {
    const v = new VoxelBuilder(500 + variant);
    const tw = variant % 3 === 0 ? 1.0 : 0.8;
    v.shell(0, height / 2, 0, tw, height, tw, 0.5, PALETTE.trunk);
    // Buttress roots.
    v.box(0.55, 0.3, 0, 0.4, 0.6, 0.4, PALETTE.trunk[1]);
    v.box(-0.5, 0.25, 0.2, 0.4, 0.5, 0.4, PALETTE.trunk[2]);
    v.box(0, 0.3, -0.55, 0.4, 0.6, 0.4, PALETTE.trunk[0]);
    // Layered blocky canopy.
    const layers = [
      { y: height - 0.5, r: canopyR },
      { y: height + 0.5, r: canopyR * 0.8 },
      { y: height + 1.4, r: canopyR * 0.45 },
    ];
    for (const L of layers) {
      const r = Math.ceil(L.r);
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          const d = Math.hypot(x, z);
          if (d > L.r + 0.3) continue;
          if (d > L.r - 0.6 && rnd() < 0.35) continue;
          const col = rnd() < 0.2 ? PALETTE.leavesLight : PALETTE.leaves;
          v.box(
            x,
            L.y + (rnd() < 0.3 ? 0.25 : 0),
            z,
            1,
            1,
            1,
            col[Math.floor(rnd() * col.length)],
            0.18,
          );
        }
      }
    }
    // Hanging vines.
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const x = Math.round(Math.cos(a) * canopyR * 0.9);
      const z = Math.round(Math.sin(a) * canopyR * 0.9);
      const len = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < len; k++)
        v.box(x, height - 1.3 - k * 0.5, z, 0.25, 0.5, 0.25, PALETTE.leaves[k % 3]);
    }
    return v;
  });
  return { geo, height, canopyR };
}

function palmGeo(variant: number): THREE.BufferGeometry {
  return cached(`palm${variant}`, () => {
    const rnd = mulberry32(2000 + variant);
    const v = new VoxelBuilder(600 + variant);
    const h = 5 + Math.floor(rnd() * 3);
    let x = 0;
    for (let y = 0; y < h; y += 0.5) {
      x += 0.04;
      v.box(x, y + 0.25, 0, 0.5, 0.5, 0.5, PALETTE.trunk[Math.floor(y * 2) % 3]);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (let k = 1; k <= 4; k++) {
        v.box(
          x + Math.cos(a) * k * 0.6,
          h - k * 0.18,
          Math.sin(a) * k * 0.6,
          0.6,
          0.2,
          0.6,
          PALETTE.leaves[k % 4],
        );
      }
    }
    return v;
  });
}

// ---------------------------------------------------------------- foliage

function bushGeo(variant: number): THREE.BufferGeometry {
  return cached(`bush${variant}`, () => {
    const rnd = mulberry32(3000 + variant);
    const v = new VoxelBuilder(700 + variant);
    const s = 0.5;
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        const d = Math.hypot(x, z);
        if (d > 3.2) continue;
        const h = Math.max(1, Math.round((3.4 - d) * 0.9 + rnd() * 1.2));
        for (let y = 0; y < h; y++) {
          if (y < h - 1 && d < 2) continue;
          const col = rnd() < 0.25 ? PALETTE.leavesLight : PALETTE.leaves;
          v.box(x * s, y * s + s / 2, z * s, s, s, s, col[Math.floor(rnd() * col.length)], 0.15);
        }
      }
    }
    return v;
  });
}

/** Tall grass field: one InstancedMesh of voxel blades for the whole level. */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(max: number) {
    const g = new THREE.BoxGeometry(0.16, 1, 0.16);
    g.translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial(), max);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
  }

  addPatch(
    x: number,
    z: number,
    r: number,
    groundAt: (x: number, z: number) => number,
    seed: number,
  ): void {
    const rnd = mulberry32(seed);
    const n = Math.floor(r * r * 7);
    for (let i = 0; i < n && this.count < this.mesh.instanceMatrix.count; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r;
      const bx = x + Math.cos(a) * d;
      const bz = z + Math.sin(a) * d;
      const h = 0.8 + rnd() * 0.75 - (d / r) * 0.35;
      this.dummy.position.set(bx, groundAt(bx, bz), bz);
      this.dummy.rotation.set((rnd() - 0.5) * 0.25, rnd() * Math.PI, (rnd() - 0.5) * 0.25);
      this.dummy.scale.set(1, h, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(this.count, this.dummy.matrix);
      this.col.setHex(PALETTE.tallGrass[Math.floor(rnd() * PALETTE.tallGrass.length)]);
      this.mesh.setColorAt(this.count, this.col);
      this.count++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- camp props

function tentGeo(): THREE.BufferGeometry {
  return cached('tent', () => {
    const v = new VoxelBuilder(801);
    // Stepped A-frame canvas tent, 4 x 3 footprint.
    for (let i = 0; i < 5; i++) {
      const w = 4 - i * 0.8;
      v.shell(0, i * 0.5 + 0.25, 0, w, 0.5, 5, 0.5, PALETTE.canvas);
    }
    v.box(0, 1, -2.52, 1.2, 2, 0.06, 0x2a2a1e); // dark doorway
    v.box(0, 2.7, 0, 0.2, 0.2, 5.4, PALETTE.plankDark[0]);
    return v;
  });
}

function crateGeo(kind: 'crate' | 'ammo'): THREE.BufferGeometry {
  return cached(`crate-${kind}`, () => {
    const v = new VoxelBuilder(kind === 'ammo' ? 802 : 803);
    const s = kind === 'ammo' ? 0.9 : 1;
    v.shell(0, s / 2, 0, s, s, s, s / 4, PALETTE.crate);
    // Plank edges.
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      v.box((x * s) / 2, s / 2, (z * s) / 2, 0.1, s + 0.02, 0.1, PALETTE.plankDark[0]);
    }
    if (kind === 'ammo') {
      v.box(0, s / 2, -s / 2 - 0.01, s * 0.7, 0.18, 0.02, 0x3f4a2a);
      v.box(0, s / 2, -s / 2 - 0.02, 0.18, 0.18, 0.02, 0xf0c040);
    }
    return v;
  });
}

function barrelGeo(): THREE.BufferGeometry {
  return cached('barrel', () => {
    const v = new VoxelBuilder(804);
    v.shell(0, 0.6, 0, 0.8, 1.2, 0.8, 0.2, [0x4c5a34, 0x56643c, 0x444f2e]);
    v.box(0, 0.3, 0, 0.84, 0.08, 0.84, 0x2e2e2e);
    v.box(0, 0.9, 0, 0.84, 0.08, 0.84, 0x2e2e2e);
    return v;
  });
}

function rockGeo(variant: number, big: boolean): THREE.BufferGeometry {
  return cached(`rock${variant}${big}`, () => {
    const rnd = mulberry32(4000 + variant);
    const v = new VoxelBuilder(900 + variant);
    const n = big ? 4 : 2;
    const s = big ? 0.75 : 0.5;
    for (let x = -n; x <= n; x++) {
      for (let z = -n; z <= n; z++) {
        const d = Math.hypot(x, z) / n;
        if (d > 1.05) continue;
        const h = Math.max(1, Math.round((1.15 - d) * (big ? 5 : 2.5) + rnd()));
        for (let y = 0; y < h; y++) {
          const col = y === h - 1 && rnd() < 0.3 ? PALETTE.grassDark : PALETTE.stone;
          v.box(x * s, y * s + s / 2, z * s, s, s, s, col[Math.floor(rnd() * col.length)]);
        }
      }
    }
    return v;
  });
}

function logGeo(): THREE.BufferGeometry {
  return cached('log', () => {
    const v = new VoxelBuilder(805);
    v.shell(0, 0.35, 0, 0.7, 0.7, 4, 0.35, PALETTE.trunk);
    v.box(0, 0.72, 1.2, 0.4, 0.1, 0.6, PALETTE.leaves[0]);
    return v;
  });
}

function sandbagGeo(): THREE.BufferGeometry {
  return cached('sandbags', () => {
    const v = new VoxelBuilder(806);
    const cols = [0xb8a070, 0xa89060, 0xc4ad7c];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - (row % 2); i++) {
        v.box(
          -1.6 + i * 0.8 + (row % 2) * 0.4,
          row * 0.32 + 0.16,
          0,
          0.76,
          0.3,
          0.6,
          cols[(i + row) % 3],
        );
      }
    }
    return v;
  });
}

function hutGeo(): THREE.BufferGeometry {
  return cached('hut', () => {
    const v = new VoxelBuilder(807);
    v.shell(0, 1.3, 0, 4, 2.6, 4, 0.5, PALETTE.plank);
    v.box(0, 1, -2.02, 1.1, 2, 0.06, 0x2a1e14);
    for (let i = 0; i < 4; i++)
      v.shell(0, 2.85 + i * 0.4, 0, 5 - i * 1.1, 0.4, 5, 0.5, [0xb09050, 0x9a7c44, 0xa88a4c]);
    return v;
  });
}

// ---------------------------------------------------------------- builders

export interface PropContext {
  scene: THREE.Object3D;
  physics: Physics;
  ground(x: number, z: number): number;
  grass: GrassField;
}

/** Interactive prop info returned for things gameplay needs to track. */
export interface BuiltProp {
  def: PropDef;
  object: THREE.Object3D;
  /** Cage door (animated when the captive is freed). */
  door?: THREE.Object3D;
  light?: THREE.PointLight;
  flame?: THREE.Object3D;
}

export function buildProp(def: PropDef, ctx: PropContext): BuiltProp {
  const { physics } = ctx;
  const rot = def.rot ?? 0;
  const sc = def.scale ?? 1;
  const y = ctx.ground(def.x, def.z);
  const root = new THREE.Group();
  root.position.set(def.x, y, def.z);
  root.rotation.y = rot;
  root.scale.setScalar(sc);
  ctx.scene.add(root);
  const out: BuiltProp = { def, object: root };
  const swap = Math.abs(Math.sin(rot)) > 0.7; // rotated ~90 degrees: swap footprint
  const fp = (w: number, d: number): [number, number] =>
    swap ? [d * sc, w * sc] : [w * sc, d * sc];
  const seed = Math.abs(Math.floor(def.x * 73 + def.z * 37));

  switch (def.type) {
    case 'tree': {
      const t = jungleTreeGeo(seed % 6);
      root.add(meshOf(t.geo));
      physics.addBox(def.x, y, def.z, 0.9 * sc, t.height * sc, 0.9 * sc, {
        fade: root,
        tag: 'tree',
      });
      const r = t.canopyR * sc * 2;
      physics.addBox(def.x, y + (t.height - 1.2) * sc, def.z, r, 3 * sc, r, {
        solid: false,
        blocksRays: false,
        fade: root,
      });
      break;
    }
    case 'palm': {
      root.add(meshOf(palmGeo(seed % 3)));
      physics.addBox(def.x, y, def.z, 0.6, 6, 0.6, { fade: root, tag: 'tree' });
      break;
    }
    case 'bush': {
      const m = meshOf(bushGeo(seed % 4), false);
      root.add(m);
      physics.addHideZone({ x: def.x, z: def.z, r: 1.5 * sc, top: y + 1.4 * sc, kind: 'bush' });
      physics.addBox(def.x, y, def.z, 2.6 * sc, 1.6 * sc, 2.6 * sc, {
        solid: false,
        blocksRays: false,
        fade: root,
      });
      break;
    }
    case 'grass': {
      ctx.grass.addPatch(def.x, def.z, 2.2 * sc, ctx.ground, seed);
      physics.addHideZone({ x: def.x, z: def.z, r: 2.1 * sc, top: y + 1.2, kind: 'grass' });
      root.removeFromParent();
      break;
    }
    case 'rock':
    case 'boulder': {
      const big = def.type === 'boulder';
      root.add(meshOf(rockGeo(seed % 4, big)));
      const s = (big ? 6.5 : 2.4) * sc;
      physics.addBox(def.x, y, def.z, s * 0.85, (big ? 3.2 : 1.1) * sc, s * 0.85, { tag: 'rock' });
      break;
    }
    case 'log': {
      root.add(meshOf(logGeo()));
      const [w, d] = fp(0.7, 4);
      physics.addBox(def.x, y, def.z, w, 0.7 * sc, d);
      break;
    }
    case 'tent': {
      root.add(meshOf(tentGeo()));
      const [w, d] = fp(4, 5);
      physics.addBox(def.x, y, def.z, w, 2.6 * sc, d, { fade: root, tag: 'tent' });
      break;
    }
    case 'hut': {
      root.add(meshOf(hutGeo()));
      const [w, d] = fp(4, 4);
      physics.addBox(def.x, y, def.z, w, 4 * sc, d, { fade: root, tag: 'hut' });
      break;
    }
    case 'crate':
    case 'ammoCrate': {
      root.add(meshOf(crateGeo(def.type === 'ammoCrate' ? 'ammo' : 'crate')));
      const s = def.type === 'ammoCrate' ? 0.9 : 1;
      physics.addBox(def.x, y, def.z, s * sc, s * sc, s * sc, { tag: def.type });
      break;
    }
    case 'barrel': {
      root.add(meshOf(barrelGeo()));
      physics.addBox(def.x, y, def.z, 0.8 * sc, 1.2 * sc, 0.8 * sc);
      break;
    }
    case 'sandbags': {
      root.add(meshOf(sandbagGeo()));
      const [w, d] = fp(4, 0.6);
      physics.addBox(def.x, y, def.z, w, 0.96 * sc, d);
      break;
    }
    case 'fence': {
      const len = def.len ?? 4;
      const v = new VoxelBuilder(seed);
      for (let i = 0; i <= Math.round(len / 1.5); i++) {
        const z = -len / 2 + Math.min(len, i * 1.5);
        v.box(0, 0.7, z, 0.2, 1.4, 0.2, PALETTE.plankDark[i % 2]);
      }
      v.box(0, 0.45, 0, 0.12, 0.2, len, PALETTE.plank[0]);
      v.box(0, 1.05, 0, 0.12, 0.2, len, PALETTE.plank[1]);
      root.add(v.mesh());
      const [w, d] = fp(0.3, len);
      physics.addBox(def.x, y, def.z, w, 1.3, d, { blocksRays: false });
      break;
    }
    case 'watchtower': {
      const v = new VoxelBuilder(seed);
      const H = 4.5;
      for (const [x, z] of [
        [-1.2, -1.2],
        [1.2, -1.2],
        [-1.2, 1.2],
        [1.2, 1.2],
      ]) {
        v.shell(x, H / 2, z, 0.3, H, 0.3, 0.3, PALETTE.trunk);
        physics.addBox(def.x + x * sc, y, def.z + z * sc, 0.32, H, 0.32, { tag: 'towerLeg' });
      }
      // Cross bracing.
      v.box(0, 1.6, -1.2, 2.4, 0.15, 0.15, PALETTE.plankDark[0]);
      v.box(0, 1.6, 1.2, 2.4, 0.15, 0.15, PALETTE.plankDark[0]);
      v.box(-1.2, 1.6, 0, 0.15, 0.15, 2.4, PALETTE.plankDark[1]);
      v.box(1.2, 1.6, 0, 0.15, 0.15, 2.4, PALETTE.plankDark[1]);
      // Platform, rails and roof.
      v.shell(0, H + 0.1, 0, 3.2, 0.2, 3.2, 0.4, PALETTE.plank);
      for (const s of [-1, 1]) {
        v.box(0, H + 0.6, s * 1.55, 3.2, 0.7, 0.12, PALETTE.plank[1]);
        v.box(s * 1.55, H + 0.6, 0, 0.12, 0.7, 3.2, PALETTE.plank[2]);
      }
      for (const [x, z] of [
        [-1.45, -1.45],
        [1.45, -1.45],
        [-1.45, 1.45],
        [1.45, 1.45],
      ])
        v.box(x, H + 1.4, z, 0.15, 2.2, 0.15, PALETTE.trunk[0]);
      v.shell(0, H + 2.6, 0, 3.8, 0.3, 3.8, 0.5, [0xb09050, 0x9a7c44, 0xa88a4c]);
      v.shell(0, H + 2.9, 0, 2.4, 0.3, 2.4, 0.5, [0xb09050, 0x9a7c44]);
      // Ladder.
      for (let i = 0; i < 9; i++)
        v.box(0, 0.3 + i * 0.5, 1.45, 0.8, 0.08, 0.08, PALETTE.plankDark[0]);
      v.box(-0.4, H / 2, 1.45, 0.08, H, 0.08, PALETTE.plankDark[1]);
      v.box(0.4, H / 2, 1.45, 0.08, H, 0.08, PALETTE.plankDark[1]);
      root.add(v.mesh());
      // Platform rails block shots at the sniper's legs.
      physics.addBox(def.x, y + H, def.z, 3.2, 0.95, 3.2, {
        solid: false,
        fade: root,
        tag: 'towerTop',
      });
      break;
    }
    case 'cage': {
      const v = new VoxelBuilder(seed);
      const W = 2.6;
      const H = 2.3;
      v.shell(0, 0.1, 0, W + 0.2, 0.2, W + 0.2, 0.4, PALETTE.stone);
      v.shell(0, H, 0, W + 0.2, 0.2, W + 0.2, 0.4, PALETTE.plankDark);
      for (let i = 0; i <= 6; i++) {
        const t = -W / 2 + (i / 6) * W;
        // Back and side bars (front has the door).
        v.box(t, H / 2, W / 2, 0.12, H, 0.12, PALETTE.trunk[i % 3]);
        v.box(-W / 2, H / 2, t, 0.12, H, 0.12, PALETTE.trunk[(i + 1) % 3]);
        v.box(W / 2, H / 2, t, 0.12, H, 0.12, PALETTE.trunk[(i + 2) % 3]);
      }
      v.box(0, H * 0.55, W / 2, W, 0.12, 0.12, PALETTE.plankDark[0]);
      root.add(v.mesh());
      // Door on the front (-Z), hinged at its left edge.
      const door = new THREE.Group();
      door.position.set(-W / 2, 0, -W / 2);
      const dv = new VoxelBuilder(seed + 1);
      for (let i = 0; i <= 6; i++)
        dv.box((i / 6) * W, H / 2, 0, 0.12, H, 0.12, PALETTE.trunk[i % 3]);
      dv.box(W / 2, H * 0.55, 0, W, 0.12, 0.12, PALETTE.plankDark[1]);
      dv.box(W * 0.85, H * 0.5, -0.08, 0.16, 0.24, 0.1, 0x3a3a3a); // padlock
      door.add(dv.mesh());
      root.add(door);
      out.door = door;
      // Four wall colliders so bullets/guards can't pass but it reads as a cage.
      const half = (W / 2) * sc;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const wall = (lx: number, lz: number, w: number, d: number, tag: string): void => {
        const wx = def.x + lx * cos + lz * sin;
        const wz = def.z - lx * sin + lz * cos;
        const [ww, dd] = swap ? [d, w] : [w, d];
        physics.addBox(wx, y, wz, ww, H, dd, { blocksRays: false, tag });
      };
      wall(0, half, W, 0.2, 'cage');
      wall(-half, 0, 0.2, W, 'cage');
      wall(half, 0, 0.2, W, 'cage');
      wall(0, -half, W, 0.2, 'cageDoor');
      break;
    }
    case 'torch': {
      const v = new VoxelBuilder(seed);
      v.box(0, 0.9, 0, 0.14, 1.8, 0.14, PALETTE.trunk[0]);
      v.box(0, 1.85, 0, 0.26, 0.16, 0.26, PALETTE.plankDark[0]);
      root.add(v.mesh());
      const flame = flameMesh(0.35);
      flame.position.y = 2.1;
      root.add(flame);
      out.flame = flame;
      physics.addBox(def.x, y, def.z, 0.2, 1.9, 0.2, { blocksRays: false });
      break;
    }
    case 'campfire': {
      const v = new VoxelBuilder(seed);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        v.box(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, 0.3, 0.24, 0.3, PALETTE.stone[i % 4]);
      }
      v.box(0, 0.15, 0, 1.0, 0.16, 0.2, PALETTE.trunk[0]);
      v.box(0, 0.2, 0, 0.2, 0.16, 1.0, PALETTE.trunk[1]);
      root.add(v.mesh());
      const flame = flameMesh(0.7);
      flame.position.y = 0.45;
      root.add(flame);
      out.flame = flame;
      const light = new THREE.PointLight(0xffa040, 18, 14, 1.6);
      light.position.y = 1.2;
      root.add(light);
      out.light = light;
      physics.addBox(def.x, y, def.z, 1.4, 0.4, 1.4, { blocksRays: false });
      break;
    }
    case 'banner': {
      const v = new VoxelBuilder(seed);
      v.box(-0.7, 1.5, 0, 0.14, 3, 0.14, PALETTE.trunk[0]);
      v.box(0.7, 1.5, 0, 0.14, 3, 0.14, PALETTE.trunk[0]);
      v.box(0, 2.9, 0, 1.6, 0.1, 0.1, PALETTE.trunk[1]);
      v.shell(0, 2.1, 0, 1.2, 1.5, 0.06, 0.15, [PALETTE.bannerRed, 0x8e2620, 0xa83028]);
      // Plain abstract emblem (not a real-world flag or insignia).
      v.box(0, 2.2, -0.04, 0.4, 0.4, 0.02, 0x1e1e1e);
      v.box(0, 2.2, -0.05, 0.2, 0.2, 0.02, PALETTE.bannerRed);
      root.add(v.mesh());
      physics.addBox(def.x, y, def.z, 0.2, 3, 0.2, { blocksRays: false });
      break;
    }
    case 'medkit':
    case 'ammo':
    case 'rockPile':
      // Pickups are spawned by the pickup system, not as static props.
      root.removeFromParent();
      break;
  }
  return out;
}

/** Simple animated voxel flame (scaled by the level's fire flicker). */
export function flameMesh(size: number): THREE.Group {
  const g = new THREE.Group();
  const mats = PALETTE.torchFlame.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const parts: [number, number, number, number, number][] = [
    [0, 0, 0, 1, 0],
    [0.15, 0.45, 0.1, 0.65, 1],
    [-0.1, 0.8, -0.05, 0.4, 2],
  ];
  for (const [x, y, z, s, m] of parts) {
    const mesh = new THREE.Mesh(box, mats[m]);
    mesh.position.set(x * size, y * size, z * size);
    mesh.scale.setScalar(s * size);
    g.add(mesh);
  }
  g.userData.flicker = Math.random() * 10;
  return g;
}
