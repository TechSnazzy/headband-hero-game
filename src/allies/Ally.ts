import * as THREE from 'three';
import { Humanoid, defaultAnim, type AnimInput } from '../characters/Humanoid';
import { allyParts } from '../characters/looks';
import type { CaptiveDef } from '../levels/types';
import type { Hitbox, Targetable } from '../game/combat';
import type { Physics } from '../world/Physics';
import type { Hero } from '../player/Hero';
import { TUNING } from '../config/tuning';
import { damp, wrapAngle } from '../world/noise';

export type AllyState = 'caged' | 'freed' | 'following' | 'boarding' | 'aboard';

const RADIUS = 0.38;

/**
 * A captured soldier. Friendly: bullets pass straight through and the crosshair
 * shows a "friendly" tag. Once freed they follow the hero to the extraction point.
 */
export class Ally implements Targetable {
  readonly friendly = true;
  readonly team = 'hero' as const;
  readonly alive = true;
  readonly model: Humanoid;
  readonly position = new THREE.Vector3();
  state: AllyState = 'caged';
  yaw: number;
  private anim: AnimInput = defaultAnim();
  private speed = 0;
  private stateTime = 0;
  private lastPos = new THREE.Vector3();
  private stuck = 0;
  private detour: THREE.Vector3 | null = null;
  private detourT = 0;
  /** Where to walk when boarding the chopper. */
  boardTarget: THREE.Vector3 | null = null;

  constructor(
    readonly def: CaptiveDef,
    readonly index: number,
    private physics: Physics,
    scene: THREE.Scene,
  ) {
    this.model = new Humanoid(allyParts(def.kind), 200 + index);
    this.position.set(def.x, physics.terrain.heightAt(def.x, def.z), def.z);
    this.yaw = def.rot ?? Math.PI; // face the cage door (south) by default
    scene.add(this.model.root);
    this.lastPos.copy(this.position);
  }

  get label(): string {
    return this.def.name;
  }

  getHitboxes(out: Hitbox[]): void {
    if (this.state === 'aboard') return;
    const p = this.position;
    out.push({
      minX: p.x - 0.35,
      maxX: p.x + 0.35,
      minZ: p.z - 0.35,
      maxZ: p.z + 0.35,
      minY: p.y,
      maxY: p.y + 1.9,
      part: 'body',
    });
  }

  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 1.1);
  }

  onHit(): void {
    // Friendlies cannot be damaged.
  }

  free(): void {
    if (this.state !== 'caged') return;
    this.state = 'freed';
    this.stateTime = 0;
  }

  private walk(target: THREE.Vector3, speed: number, dt: number): number {
    let goal = target;
    if (this.detour) {
      goal = this.detour;
      this.detourT -= dt;
      if (this.detourT <= 0) this.detour = null;
    }
    const dx = goal.x - this.position.x;
    const dz = goal.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const remaining = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    if (dist < 0.1) {
      this.speed = 0;
      return remaining;
    }
    const step = Math.min(dist, speed * dt);
    const p = this.position;
    this.physics.moveCircle(p, (dx / dist) * step, (dz / dist) * step, RADIUS, 1.9, 1.05);
    const g = this.physics.groundAt(p.x, p.z, RADIUS, p.y, 1.05);
    p.y += (g - p.y) * Math.min(1, dt * 14);
    this.speed = step / Math.max(dt, 1e-4);
    this.yaw = wrapAngle(this.yaw + wrapAngle(Math.atan2(-dx, -dz) - this.yaw) * damp(10, dt));
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos.copy(p);
    if (moved < step * 0.3) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 0.5 && !this.detour) {
      this.stuck = 0;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.detour = new THREE.Vector3(
        p.x + (-dz / dist) * side * 2.5,
        p.y,
        p.z + (dx / dist) * side * 2.5,
      );
      this.detourT = 1;
    }
    return remaining;
  }

  update(dt: number, hero: Hero, slot: number): void {
    this.stateTime += dt;
    const T = TUNING.allies;
    this.anim.pose = 'none';
    this.anim.crouch = 0;
    this.speed = 0;
    switch (this.state) {
      case 'caged':
        this.anim.pose = 'captive';
        this.anim.crouch = 0.55;
        break;
      case 'freed':
        // Brief celebration, then fall in.
        this.anim.pose = this.stateTime < 1.1 ? 'handsUp' : 'none';
        this.yaw = wrapAngle(
          this.yaw +
            wrapAngle(
              Math.atan2(
                -(hero.position.x - this.position.x),
                -(hero.position.z - this.position.z),
              ) - this.yaw,
            ) *
              damp(6, dt),
        );
        if (this.stateTime > 1.3) this.state = 'following';
        break;
      case 'following': {
        // Trail behind the hero in a loose line.
        const back = new THREE.Vector3(Math.sin(hero.facingYaw), 0, Math.cos(hero.facingYaw));
        const side = new THREE.Vector3(Math.cos(hero.facingYaw), 0, -Math.sin(hero.facingYaw));
        const spot = hero.position
          .clone()
          .addScaledVector(back, T.followDistance + slot * 1.4)
          .addScaledVector(side, (slot % 2 === 0 ? 1 : -1) * 0.9);
        const d = Math.hypot(spot.x - this.position.x, spot.z - this.position.z);
        const run = d > 8 ? T.followSpeed * 1.4 : T.followSpeed;
        if (d > 0.8) this.walk(spot, Math.min(run, d * 2.5), dt);
        else this.yaw = wrapAngle(this.yaw + wrapAngle(hero.facingYaw - this.yaw) * damp(4, dt));
        // Sneak along when the hero sneaks.
        this.anim.crouch = hero.crouching ? 1 : 0;
        // Teleport catch-up if left far behind (e.g. after a long sprint).
        if (Math.hypot(hero.position.x - this.position.x, hero.position.z - this.position.z) > 45) {
          this.position.copy(spot).setY(this.physics.terrain.heightAt(spot.x, spot.z));
        }
        break;
      }
      case 'boarding':
        if (this.boardTarget) {
          const d = this.walk(this.boardTarget, T.runToExtractSpeed, dt);
          if (d < 0.6) {
            this.state = 'aboard';
            this.model.root.visible = false;
          }
        }
        break;
      case 'aboard':
        break;
    }
    this.anim.speed = this.speed;
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, this.anim);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.model.root);
  }
}
