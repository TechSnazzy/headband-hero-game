import * as THREE from 'three';
import { VoxelBuilder } from '../world/voxel';
import { TUNING } from '../config/tuning';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import type { Hero } from '../player/Hero';
import { audio } from '../audio/Audio';
import { buildRock } from '../weapons/models';

export type PickupKind = 'ammo' | 'medkit' | 'rockPile';

interface Pickup {
  kind: PickupKind;
  mesh: THREE.Object3D;
  base: THREE.Vector3;
  rifle: number;
  pistol: number;
  taken: boolean;
  t: number;
}

function ammoMesh(): THREE.Mesh {
  const v = new VoxelBuilder(301);
  v.box(0, 0.16, 0, 0.5, 0.3, 0.32, 0x4a5a2c);
  v.box(0, 0.32, 0, 0.52, 0.04, 0.34, 0x3a4622);
  v.box(0, 0.18, -0.165, 0.36, 0.08, 0.01, 0xf0c040);
  v.box(0.18, 0.42, 0, 0.06, 0.16, 0.05, 0xd9a830); // a few rounds sticking out
  v.box(0.08, 0.42, 0, 0.06, 0.16, 0.05, 0xd9a830);
  return v.mesh();
}

function medkitMesh(): THREE.Mesh {
  const v = new VoxelBuilder(302);
  v.box(0, 0.18, 0, 0.52, 0.34, 0.34, 0xf1efe8);
  v.box(0, 0.37, 0, 0.2, 0.05, 0.08, 0x8a8a8a); // handle
  // Green plus (generic health symbol).
  v.box(0, 0.18, -0.175, 0.24, 0.07, 0.01, 0x3aa84a);
  v.box(0, 0.18, -0.175, 0.07, 0.24, 0.01, 0x3aa84a);
  v.box(0, 0.18, 0.175, 0.24, 0.07, 0.01, 0x3aa84a);
  v.box(0, 0.18, 0.175, 0.07, 0.24, 0.01, 0x3aa84a);
  return v.mesh();
}

function rockPileMesh(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = buildRock(1.4);
    r.position.set(Math.cos(i * 1.7) * 0.18, 0.08 + (i === 3 ? 0.12 : 0), Math.sin(i * 1.7) * 0.18);
    r.rotation.y = i;
    g.add(r);
  }
  return g;
}

/** Walk-over pickups: ammo (level placed and dropped by guards), medkits, rock piles. */
export class Pickups {
  private list: Pickup[] = [];
  private group = new THREE.Group();
  /** Fired with a message for the HUD toast. */
  onPickup: ((msg: string) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private groundAt: (x: number, z: number) => number,
  ) {
    scene.add(this.group);
  }

  spawn(kind: PickupKind, x: number, z: number, rifle = 0, pistol = 0): void {
    const mesh = kind === 'ammo' ? ammoMesh() : kind === 'medkit' ? medkitMesh() : rockPileMesh();
    const base = new THREE.Vector3(x, this.groundAt(x, z), z);
    mesh.position.copy(base);
    this.group.add(mesh);
    if (kind === 'ammo' && rifle === 0 && pistol === 0) {
      rifle = 30;
      pistol = 12;
    }
    this.list.push({ kind, mesh, base, rifle, pistol, taken: false, t: Math.random() * 6 });
  }

  /** Loot dropped by an eliminated guard. */
  drop(pos: THREE.Vector3): void {
    const E = TUNING.enemies;
    if (Math.random() < E.dropAmmoChance) {
      const [a, b] = E.dropAmmoAmount;
      const rifle = Math.round(a + Math.random() * (b - a));
      this.spawn('ammo', pos.x + 0.3, pos.z, rifle, Math.round(rifle / 3));
    }
    if (Math.random() < E.dropMedkitChance) this.spawn('medkit', pos.x - 0.4, pos.z + 0.3);
  }

  update(dt: number, hero: Hero, weapons: WeaponSystem): void {
    for (const p of this.list) {
      if (p.taken) continue;
      p.t += dt;
      p.mesh.position.y = p.base.y + 0.15 + Math.sin(p.t * 2.5) * 0.08;
      p.mesh.rotation.y += dt * 1.2;
      const d = Math.hypot(hero.position.x - p.base.x, hero.position.z - p.base.z);
      if (d > 1.1 || hero.dead || Math.abs(hero.position.y - p.base.y) > 1.5) continue;
      let msg: string;
      if (p.kind === 'ammo') {
        const r = weapons.addAmmo('rifle', p.rifle);
        const s = weapons.addAmmo('pistol', p.pistol);
        if (r + s === 0) continue;
        msg = `+${r} rifle  +${s} pistol ammo`;
      } else if (p.kind === 'medkit') {
        if (hero.health >= TUNING.player.maxHealth) continue;
        hero.heal(TUNING.player.medkitHeal);
        msg = `+${TUNING.player.medkitHeal} health`;
      } else {
        const n = weapons.addRocks(4);
        if (n === 0) continue;
        msg = `+${n} rocks`;
      }
      p.taken = true;
      this.group.remove(p.mesh);
      audio.play('pickup');
      this.onPickup?.(msg);
    }
    this.list = this.list.filter((p) => !p.taken);
  }

  clear(): void {
    this.group.clear();
    this.list = [];
  }
}
