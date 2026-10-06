import * as THREE from 'three';
import { VoxelBuilder, voxelMaterial } from '../world/voxel';
import { damp } from '../world/noise';

/**
 * Shared blocky humanoid rig used by the hero, guards and captives.
 * Front is -Z, +X is the character's right. Origin at the feet.
 *
 * Arms are driven by a two-bone IK solve so the hands stay on whatever the
 * character is holding (rifle low at the hips, rifle at the shoulder, pistol...).
 */

export const DIM = {
  hipY: 0.98,
  hipX: 0.15,
  thighLen: 0.46,
  shinLen: 0.4,
  torsoY: 1.02,
  chestH: 0.6,
  shoulderX: 0.39,
  shoulderY: 0.52,
  upperArm: 0.34,
  foreArm: 0.36,
  neckY: 0.6,
};

export interface HumanoidParts {
  /** Each decorator receives a VoxelBuilder in the part's local space. */
  pelvis(v: VoxelBuilder): void;
  thigh(v: VoxelBuilder, side: 1 | -1): void;
  shin(v: VoxelBuilder, side: 1 | -1): void;
  chest(v: VoxelBuilder): void;
  head(v: VoxelBuilder): void;
  upperArm(v: VoxelBuilder, side: 1 | -1): void;
  foreArm(v: VoxelBuilder, side: 1 | -1): void;
}

export type Pose =
  'none' | 'rifleLow' | 'rifleAim' | 'pistol' | 'throw' | 'captive' | 'handsUp' | 'carryLow';

export interface AnimInput {
  speed: number; // horizontal speed m/s
  crouch: number; // 0..1
  pose: Pose;
  aimPitch: number; // radians, positive = aim up
  airborne: boolean;
  /** 0..1 progress through a reload, or -1. */
  reload: number;
  /** 0..1 throw swing progress, or -1. */
  throwT: number;
  /** Lean for takedowns / staggering (radians). */
  lean: number;
}

export const defaultAnim = (): AnimInput => ({
  speed: 0,
  crouch: 0,
  pose: 'none',
  aimPitch: 0,
  airborne: false,
  reload: -1,
  throwT: -1,
  lean: 0,
});

const DOWN = new THREE.Vector3(0, -1, 0);

export class Humanoid {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly weaponMount = new THREE.Group();
  /** Optional extra mount on the right hand (rocks, knife). */
  readonly handR = new THREE.Group();
  private thigh: [THREE.Group, THREE.Group];
  private shin: [THREE.Group, THREE.Group];
  private upper: [THREE.Group, THREE.Group];
  private fore: [THREE.Group, THREE.Group];
  private phase = 0;
  private crouchS = 0;
  private poseBlend = new Map<Pose, number>();
  private gripR = new THREE.Vector3();
  private gripL = new THREE.Vector3();
  readonly meshes: THREE.Mesh[] = [];
  /** Hand targets in weaponMount space, set by whoever equips the weapon. */
  gripLocal = new THREE.Vector3(0, -0.07, 0.08);
  supportLocal = new THREE.Vector3(0, 0.0, -0.22);
  oneHanded = false;

  constructor(parts: HumanoidParts, seed = 1, material: THREE.Material = voxelMaterial()) {
    const mk = (fn: (v: VoxelBuilder) => void, s: number): THREE.Mesh => {
      const v = new VoxelBuilder(seed * 100 + s);
      fn(v);
      const m = v.mesh(material);
      this.meshes.push(m);
      return m;
    };

    this.root.add(this.body);
    this.body.add(mk((v) => parts.pelvis(v), 1));
    const legs = [-1, 1].map((side) => {
      const s = side as 1 | -1;
      const th = new THREE.Group();
      th.position.set(DIM.hipX * s, DIM.hipY, 0);
      th.add(mk((v) => parts.thigh(v, s), 2 + s));
      const sh = new THREE.Group();
      sh.position.set(0, -DIM.thighLen, 0);
      sh.add(mk((v) => parts.shin(v, s), 5 + s));
      th.add(sh);
      this.body.add(th);
      return [th, sh] as const;
    });
    this.thigh = [legs[0][0], legs[1][0]];
    this.shin = [legs[0][1], legs[1][1]];

    this.torso.position.set(0, DIM.torsoY, 0);
    this.body.add(this.torso);
    this.torso.add(mk((v) => parts.chest(v), 8));
    this.head.position.set(0, DIM.neckY, 0);
    this.head.add(mk((v) => parts.head(v), 9));
    this.torso.add(this.head);

    const arms = [-1, 1].map((side) => {
      const s = side as 1 | -1;
      const up = new THREE.Group();
      up.position.set(DIM.shoulderX * s, DIM.shoulderY, 0);
      up.add(mk((v) => parts.upperArm(v, s), 11 + s));
      const fo = new THREE.Group();
      fo.position.set(0, -DIM.upperArm, 0);
      fo.add(mk((v) => parts.foreArm(v, s), 14 + s));
      up.add(fo);
      this.torso.add(up);
      return [up, fo] as const;
    });
    this.upper = [arms[0][0], arms[1][0]];
    this.fore = [arms[0][1], arms[1][1]];
    this.handR.position.set(0, -DIM.foreArm, 0);
    this.fore[1].add(this.handR);

    this.torso.add(this.weaponMount);
  }

  setWeapon(
    obj: THREE.Object3D | null,
    grip?: THREE.Vector3,
    support?: THREE.Vector3,
    oneHanded = false,
  ): void {
    this.weaponMount.clear();
    if (obj) this.weaponMount.add(obj);
    if (grip) this.gripLocal.copy(grip);
    if (support) this.supportLocal.copy(support);
    this.oneHanded = oneHanded;
  }

  private blend(p: Pose, target: Pose, dt: number, rate = 12): number {
    const cur = this.poseBlend.get(p) ?? (p === target ? 1 : 0);
    const next = cur + ((p === target ? 1 : 0) - cur) * damp(rate, dt);
    this.poseBlend.set(p, next);
    return next;
  }

  update(dt: number, a: AnimInput): void {
    // Walk cycle.
    const moving = Math.min(1, a.speed / 3);
    this.phase += dt * (2.2 + a.speed * 1.45);
    this.crouchS += (a.crouch - this.crouchS) * damp(12, dt);
    const c = this.crouchS;
    const sw = Math.sin(this.phase);
    const swing = 0.65 * moving * (1 - c * 0.4);

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const legSwing = sw * swing * s;
      const crouchThigh = -1.05 * c;
      this.thigh[i].rotation.x = a.airborne ? -0.5 + s * 0.2 : legSwing + crouchThigh;
      const bend = Math.max(0, -Math.cos(this.phase + (s > 0 ? 0 : Math.PI))) * 0.9 * moving;
      this.shin[i].rotation.x = a.airborne ? 0.9 : bend + 1.7 * c;
    }

    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * moving;
    this.body.position.y = bob - 0.42 * c;
    this.body.rotation.x = -0.12 * moving + 0.32 * c + a.lean;
    this.torso.rotation.y = sw * 0.08 * moving;

    // Weapon placement by pose (blended).
    const poses: Pose[] = [
      'none',
      'rifleLow',
      'rifleAim',
      'pistol',
      'throw',
      'captive',
      'handsUp',
      'carryLow',
    ];
    const wPos = new THREE.Vector3();
    const wRot = new THREE.Euler();
    let total = 0;
    const tp = new THREE.Vector3();
    const tr = new THREE.Vector3();
    for (const p of poses) {
      const w = this.blend(p, a.pose, dt);
      if (w < 0.001) continue;
      total += w;
      weaponPose(p, a, tp, tr);
      wPos.addScaledVector(tp, w);
      wRot.x += tr.x * w;
      wRot.y += tr.y * w;
      wRot.z += tr.z * w;
    }
    if (total > 0) {
      wPos.divideScalar(total);
      wRot.set(wRot.x / total, wRot.y / total, wRot.z / total);
    }
    // Counter the body pitch so the aimed weapon stays level with the aim.
    this.weaponMount.position.copy(wPos);
    this.weaponMount.rotation.copy(wRot);
    this.weaponMount.rotation.x -= this.body.rotation.x * (this.poseBlend.get('rifleAim') ?? 0);
    this.head.rotation.x = -a.aimPitch * 0.5 - this.body.rotation.x * 0.6;

    // Arms: IK to grip/support, or free swing for unarmed poses.
    this.weaponMount.updateMatrix();
    const armed =
      a.pose === 'rifleLow' ||
      a.pose === 'rifleAim' ||
      a.pose === 'pistol' ||
      a.pose === 'carryLow';
    if (armed) {
      this.gripR.copy(this.gripLocal).applyMatrix4(this.weaponMount.matrix);
      this.gripL.copy(this.supportLocal).applyMatrix4(this.weaponMount.matrix);
      if (a.reload >= 0) {
        // Support hand drops to the magazine and back.
        const k = Math.sin(a.reload * Math.PI);
        this.gripL.y -= 0.22 * k;
        this.gripL.x += 0.05 * k;
        this.gripL.z += 0.12 * k;
      }
      this.solveArm(1, this.gripR, -1);
      if (this.oneHanded) this.freeArm(0, sw, moving, dt);
      else this.solveArm(0, this.gripL, 1);
    } else if (a.pose === 'captive') {
      // Hands tied behind the back.
      this.solveArm(1, new THREE.Vector3(0.12, 0.05, 0.25), -1);
      this.solveArm(0, new THREE.Vector3(-0.12, 0.05, 0.25), 1);
    } else if (a.pose === 'handsUp') {
      this.solveArm(1, new THREE.Vector3(0.35, 1.05, -0.1), -1);
      this.solveArm(0, new THREE.Vector3(-0.35, 1.05, -0.1), 1);
    } else if (a.pose === 'throw') {
      const t = a.throwT < 0 ? 0 : a.throwT;
      // Wind up behind the head, then whip forward.
      const back = new THREE.Vector3(0.42, 0.85, 0.35);
      const front = new THREE.Vector3(0.25, 0.55, -0.6);
      const p = t < 0.45 ? back : back.clone().lerp(front, Math.min(1, (t - 0.45) / 0.3));
      this.solveArm(1, p, -1);
      this.freeArm(0, sw, moving, dt);
    } else {
      this.freeArm(0, sw, moving, dt);
      this.freeArm(1, -sw, moving, dt);
    }
  }

  private freeArm(i: number, sw: number, moving: number, _dt: number): void {
    const s = i === 0 ? -1 : 1;
    this.upper[i].quaternion.setFromEuler(new THREE.Euler(sw * 0.6 * moving, 0, 0.12 * s));
    this.fore[i].quaternion.setFromEuler(new THREE.Euler(-0.3 - 0.4 * moving, 0, 0));
  }

  /**
   * Two-bone IK in torso space. `pole` pushes the elbow outward (-1 right arm
   * bends out to the right/down, +1 left arm).
   */
  private solveArm(i: number, target: THREE.Vector3, pole: number): void {
    const up = this.upper[i];
    const fo = this.fore[i];
    const S = up.position;
    const a = DIM.upperArm;
    const b = DIM.foreArm;
    const toT = target.clone().sub(S);
    let d = toT.length();
    d = Math.min(Math.max(d, 0.05), a + b - 0.001);
    const dir = toT.normalize();
    // Elbow: law of cosines, bent toward a pole (down + outward + slightly back).
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const angA = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const poleV = new THREE.Vector3(-pole * 0.8, -1, 0.35).normalize();
    const n = new THREE.Vector3().crossVectors(dir, poleV).normalize();
    const elbowDir = dir.clone().applyAxisAngle(n, angA);
    if (!isFinite(elbowDir.x)) elbowDir.copy(dir);
    const E = S.clone().addScaledVector(elbowDir, a);
    up.quaternion.setFromUnitVectors(DOWN, elbowDir);
    const foreDir = S.clone().addScaledVector(dir, d).sub(E).normalize();
    const inv = up.quaternion.clone().invert();
    fo.quaternion.setFromUnitVectors(DOWN, foreDir.applyQuaternion(inv));
  }
}

/** Weapon mount position/rotation (torso space) for each pose. */
function weaponPose(p: Pose, a: AnimInput, pos: THREE.Vector3, rot: THREE.Vector3): void {
  switch (p) {
    case 'rifleLow':
      // Held low across the hips, barrel angled forward-left and slightly down.
      pos.set(0.24, -0.04, -0.3);
      rot.set(-0.18, 0.4, 0.12);
      break;
    case 'carryLow':
      pos.set(0.2, 0.0, -0.28);
      rot.set(-0.35, 0.3, 0.1);
      break;
    case 'rifleAim':
      // Stock to the right shoulder, pitched with the aim.
      pos.set(0.17, 0.46, -0.36);
      rot.set(a.aimPitch, 0, 0);
      break;
    case 'pistol':
      pos.set(0.08, 0.42, -0.55);
      rot.set(a.aimPitch, 0, 0);
      break;
    default:
      pos.set(0.25, -0.1, -0.15);
      rot.set(0, 0, 0);
  }
}

/** Utility: deterministic random from a seed for per-character variation. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
