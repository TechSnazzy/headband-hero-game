import * as THREE from 'three';
import { VoxelBuilder } from '../world/voxel';
import { PALETTE } from '../config/palette';

/**
 * Voxel weapon models. Local space: origin at the pistol grip / trigger,
 * barrel points toward -Z, +Y up. The same builders are used for the weapon in
 * the hero's hands, world pickups and the HUD hotbar icons.
 */

export const RIFLE_MUZZLE = new THREE.Vector3(0, 0.045, -0.66);
export const PISTOL_MUZZLE = new THREE.Vector3(0, 0.05, -0.4);
export const RIFLE_EJECT = new THREE.Vector3(0.05, 0.06, 0.05);

export type RifleVariant = 'hero' | 'enemy';

/**
 * The hero's signature rifle, matched to the concept art: warm brown wooden stock
 * and handguard, dark metal receiver and barrel, long curved black magazine that
 * angles forward, a small front sight post and a dark olive canvas sling hanging
 * in a loose arc. Colors are jittered per voxel for a worn, scuffed look.
 * The enemy variant swaps in darker wood with charcoal and rust-red accents.
 */
export function buildRifle(variant: RifleVariant = 'hero', withSling = true): THREE.Mesh {
  const hero = variant === 'hero';
  const wood = hero ? PALETTE.wood : PALETTE.enemyWood;
  const metal = hero ? PALETTE.metal : PALETTE.enemyMetal;
  const v = new VoxelBuilder(hero ? 11 : 23);
  const s = 0.026; // voxel size for the scuffed look

  // Stock: tapered toward the butt, slightly dropped like the reference.
  v.shell(0, -0.005, 0.25, 0.05, 0.075, 0.16, s, wood);
  v.shell(0, -0.025, 0.39, 0.055, 0.11, 0.13, s, wood);
  // Butt plate.
  v.box(0, -0.025, 0.462, 0.058, 0.12, 0.014, hero ? 0x2a2522 : PALETTE.rust[0]);
  // Wrist joining stock to receiver.
  v.shell(0, 0.015, 0.14, 0.048, 0.06, 0.07, s, wood);

  // Receiver (dark metal) with top cover and rear sight block.
  v.shell(0, 0.035, 0.0, 0.062, 0.085, 0.22, s, metal);
  v.box(0, 0.085, 0.01, 0.05, 0.018, 0.2, metal[1]);
  v.box(0, 0.1, -0.1, 0.03, 0.022, 0.03, metal[2]);
  // Charging handle on the right side.
  v.box(0.04, 0.05, -0.02, 0.02, 0.016, 0.03, metal[0]);
  // Trigger guard.
  v.box(0, -0.035, 0.03, 0.012, 0.012, 0.07, metal[0]);
  v.box(0, -0.025, 0.065, 0.012, 0.03, 0.012, metal[0]);

  // Pistol grip (angled back).
  v.box(0, -0.06, 0.08, 0.045, 0.07, 0.045, hero ? wood[2] : PALETTE.charcoal[0]);
  v.box(0, -0.11, 0.1, 0.045, 0.05, 0.045, hero ? wood[0] : PALETTE.charcoal[1]);

  // Long curved high-capacity magazine angling forward.
  const magColors = PALETTE.magazine;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const y = -0.03 - i * 0.042;
    const z = -0.04 - t * t * 0.13 - i * 0.012;
    v.box(0, y, z, 0.044, 0.05, 0.075, magColors[i % magColors.length]);
    // Ribs on the magazine.
    if (i % 2 === 1) v.box(0, y, z, 0.05, 0.012, 0.078, 0x111214);
  }
  if (!hero) v.box(0, -0.29, -0.2, 0.05, 0.02, 0.07, PALETTE.rust[1]);

  // Lower handguard (wood) and upper handguard over the gas tube.
  v.shell(0, 0.02, -0.215, 0.06, 0.07, 0.19, s, wood);
  v.shell(0, 0.08, -0.2, 0.044, 0.035, 0.16, s, wood);
  // Handguard retaining bands.
  v.box(0, 0.035, -0.115, 0.064, 0.09, 0.012, metal[0]);
  v.box(0, 0.035, -0.31, 0.064, 0.09, 0.012, metal[0]);

  // Gas tube and barrel.
  v.box(0, 0.085, -0.34, 0.03, 0.03, 0.08, metal[1]);
  v.box(0, 0.04, -0.47, 0.028, 0.028, 0.34, metal[2]);
  // Front sight block with a small post.
  v.box(0, 0.075, -0.57, 0.036, 0.05, 0.03, metal[0]);
  v.box(0, 0.11, -0.57, 0.01, 0.03, 0.01, metal[1]);
  v.box(-0.015, 0.105, -0.57, 0.006, 0.025, 0.012, metal[0]);
  v.box(0.015, 0.105, -0.57, 0.006, 0.025, 0.012, metal[0]);
  // Slant muzzle brake.
  v.box(0, 0.045, -0.63, 0.034, 0.034, 0.05, metal[0]);
  if (!hero) {
    v.box(0, 0.045, -0.6, 0.038, 0.038, 0.012, PALETTE.rust[0]);
    v.box(0, 0.035, 0.32, 0.06, 0.02, 0.05, PALETTE.rust[2]);
  }

  if (withSling) addSling(v, hero);
  return v.mesh();
}

/** Dark olive canvas sling hanging in a loose arc from stock to front band. */
function addSling(v: VoxelBuilder, hero: boolean): void {
  const a = new THREE.Vector3(-0.03, -0.06, 0.4);
  const b = new THREE.Vector3(-0.035, 0.0, -0.3);
  const sag = 0.3;
  const n = 18;
  const cols = hero ? PALETTE.sling : PALETTE.charcoal;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    p.x -= Math.sin(t * Math.PI) * 0.03;
    v.box(p.x, p.y, p.z, 0.012, 0.03, 0.045, cols[i % cols.length]);
  }
  // Swivels.
  v.box(a.x, a.y + 0.015, a.z, 0.02, 0.02, 0.02, 0x3a3a36);
  v.box(b.x, b.y + 0.01, b.z, 0.02, 0.02, 0.02, 0x3a3a36);
}

/** Compact suppressed pistol. */
export function buildPistol(): THREE.Mesh {
  const v = new VoxelBuilder(31);
  const m = PALETTE.metal;
  v.shell(0, 0.045, -0.04, 0.04, 0.055, 0.2, 0.02, m);
  v.box(0, -0.03, 0.03, 0.036, 0.11, 0.045, PALETTE.wood[2]);
  v.box(0, -0.015, -0.02, 0.01, 0.01, 0.04, m[0]);
  // Suppressor.
  v.shell(0, 0.045, -0.27, 0.042, 0.042, 0.24, 0.021, [0x1c1d1f, 0x242527]);
  v.box(0, 0.08, -0.12, 0.008, 0.016, 0.01, m[1]);
  return v.mesh();
}

/** A throwable rock. */
export function buildRock(scale = 1): THREE.Mesh {
  const v = new VoxelBuilder(41);
  const s = 0.07 * scale;
  v.box(0, 0, 0, s * 2, s * 1.6, s * 1.8, PALETTE.stone[0]);
  v.box(s * 0.6, s * 0.4, 0, s, s, s, PALETTE.stone[2]);
  v.box(-s * 0.5, -s * 0.2, s * 0.5, s, s, s, PALETTE.stone[1]);
  return v.mesh();
}

/** Sniper's long rifle: enemy wood and metal, scope, ghillie wraps. */
export function buildSniperRifle(): THREE.Mesh {
  const v = new VoxelBuilder(51);
  const m = PALETTE.enemyMetal;
  v.shell(0, -0.01, 0.3, 0.05, 0.09, 0.26, 0.026, PALETTE.enemyWood);
  v.shell(0, 0.03, 0.02, 0.06, 0.08, 0.3, 0.026, m);
  v.box(0, -0.07, 0.1, 0.045, 0.08, 0.045, PALETTE.enemyWood[1]);
  v.box(0, -0.05, -0.04, 0.04, 0.07, 0.06, 0x1b1c1e);
  v.shell(0, 0.02, -0.28, 0.055, 0.06, 0.3, 0.026, PALETTE.enemyWood);
  v.box(0, 0.035, -0.6, 0.026, 0.026, 0.5, m[1]);
  v.box(0, 0.035, -0.86, 0.04, 0.04, 0.06, m[0]);
  // Scope.
  v.box(0, 0.11, 0.0, 0.045, 0.045, 0.28, 0x1a1a1a);
  v.box(0, 0.11, -0.15, 0.055, 0.055, 0.04, 0x1a1a1a);
  v.box(0, 0.11, 0.15, 0.055, 0.055, 0.04, 0x1a1a1a);
  v.box(0, 0.075, 0.0, 0.02, 0.03, 0.04, m[0]);
  // Ghillie wraps and a rust band.
  v.box(0, 0.035, -0.45, 0.05, 0.05, 0.05, PALETTE.ghillie[0]);
  v.box(0, 0.035, -0.7, 0.05, 0.05, 0.05, PALETTE.ghillie[2]);
  v.box(0, 0.02, -0.2, 0.065, 0.07, 0.02, PALETTE.rust[0]);
  return v.mesh();
}
