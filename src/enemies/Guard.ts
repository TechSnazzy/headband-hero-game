import * as THREE from 'three';
import { Humanoid, defaultAnim, type AnimInput, type HumanoidParts } from '../characters/Humanoid';
import { gruntParts, handlerParts, sniperParts } from '../characters/looks';
import { buildRifle, buildSniperRifle, RIFLE_MUZZLE } from '../weapons/models';
import { TUNING } from '../config/tuning';
import { PALETTE } from '../config/palette';
import type { GuardDef } from '../levels/types';
import type { Hitbox, Targetable } from '../game/combat';
import type { AIContext } from '../ai/context';
import { GuardBrain } from '../ai/GuardBrain';
import { AlertIcon, VisionCone } from './VisionCone';
import { damp, DEG, wrapAngle } from '../world/noise';
import { audio } from '../audio/Audio';
import { rayBox } from '../world/Physics';

export type GunnerType = 'grunt' | 'sniper' | 'handler';

const RADIUS = 0.42;
const HEIGHT = 1.9;
const STEP_UP = 1.05; // guards may climb single blocks so they never get stuck on terrain

/** A humanoid enemy: body, weapon, health and elimination. Decisions live in GuardBrain. */
export class Guard implements Targetable {
  readonly friendly = false;
  readonly team = 'enemy' as const;
  readonly model: Humanoid;
  readonly position = new THREE.Vector3();
  readonly brain: GuardBrain;
  readonly cone: VisionCone;
  readonly icon = new AlertIcon();
  readonly stats: {
    health: number;
    damage: number;
    fireInterval: number;
    burst: number;
    burstPause: number;
    spreadDeg: number;
    range: number;
  };
  yaw = 0;
  health: number;
  alive = true;
  /** True after the elimination animation has finished and the body is gone. */
  gone = false;
  elevated: number;
  speed = 0;
  /** Aim pitch for the arms. */
  aimPitch = 0;
  aiming = false;
  silentlyEliminated = false;
  /** Seconds the guard is held in a takedown grab (brain paused). */
  grabbed = 0;
  private anim: AnimInput = defaultAnim();
  private elimT = -1;
  private lastPos = new THREE.Vector3();
  private stuckTime = 0;
  private detour: THREE.Vector3 | null = null;
  private detourTime = 0;
  private flinch = 0;
  private colors: number[];
  /** Index in the level's guard list (used for flank angle variety). */
  readonly index: number;

  constructor(
    readonly type: GunnerType,
    readonly def: GuardDef,
    index: number,
    private ctx: AIContext,
    scene: THREE.Scene,
  ) {
    this.index = index;
    const parts: HumanoidParts =
      type === 'sniper' ? sniperParts() : type === 'handler' ? handlerParts() : gruntParts(index);
    this.model = new Humanoid(parts, 50 + index);
    this.model.setWeapon(type === 'sniper' ? buildSniperRifle() : buildRifle('enemy'));
    this.stats = { ...TUNING.enemies[type] };
    this.health = this.stats.health;
    this.elevated = def.elevated ?? 0;
    this.colors =
      type === 'sniper'
        ? [...PALETTE.ghillie]
        : [...PALETTE.charcoal, ...PALETTE.rust, PALETTE.skin[0]];
    const [x, z] = def.patrol[0];
    this.position.set(x, this.groundAt(x, z), z);
    this.yaw = def.look?.[0] ?? 0;
    if (def.patrol.length > 1) {
      const [nx, nz] = def.patrol[1];
      this.yaw = Math.atan2(-(nx - x), -(nz - z));
    }
    const fov = TUNING.ai.visionFovDeg * DEG * (type === 'sniper' ? 0.7 : 1);
    this.cone = new VisionCone(fov);
    scene.add(this.model.root, this.cone.mesh, this.icon.sprite);
    this.brain = new GuardBrain(this, ctx);
    this.lastPos.copy(this.position);
  }

  get label(): string {
    return this.type;
  }

  get eyeHeight(): number {
    return 1.72;
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.eyeHeight);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  private groundAt(x: number, z: number): number {
    if (this.elevated) return this.ctx.physics.terrain.heightAt(x, z) + this.elevated;
    return this.ctx.physics.groundAt(x, z, RADIUS, 50, 0);
  }

  // ------------------------------------------------------------ movement

  /** Walks toward a point. Returns the remaining distance. */
  moveTo(target: THREE.Vector3, speed: number, dt: number, face = true): number {
    if (this.elevated) return 0;
    let goal = target;
    if (this.detour) {
      goal = this.detour;
      this.detourTime -= dt;
      if (this.detourTime <= 0 || this.position.distanceTo(this.detour) < 0.6) this.detour = null;
    }
    const dx = goal.x - this.position.x;
    const dz = goal.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const remaining = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    if (dist < 0.15) {
      this.speed = 0;
      return remaining;
    }
    const step = Math.min(dist, speed * dt);
    const p = this.position;
    this.ctx.physics.moveCircle(p, (dx / dist) * step, (dz / dist) * step, RADIUS, HEIGHT, STEP_UP);
    const g = this.ctx.physics.groundAt(p.x, p.z, RADIUS, p.y, STEP_UP);
    p.y += (g - p.y) * Math.min(1, dt * 14);
    if (Math.abs(g - p.y) < 0.02) p.y = g;
    this.speed = speed;
    if (face) this.turnTo(Math.atan2(-dx, -dz), dt);

    // Stuck detection: if barely moving, sidestep around the obstacle.
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos.copy(p);
    if (moved < speed * dt * 0.3) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt);
    if (this.stuckTime > 0.6 && !this.detour) {
      this.stuckTime = 0;
      const side = Math.random() < 0.5 ? 1 : -1;
      const px = (-dz / dist) * side;
      const pz = (dx / dist) * side;
      this.detour = new THREE.Vector3(
        p.x + px * 3 - (dx / dist) * 1,
        p.y,
        p.z + pz * 3 - (dz / dist) * 1,
      );
      this.detourTime = 1.4;
    }
    return remaining;
  }

  stop(): void {
    this.speed = 0;
  }

  turnTo(yaw: number, dt: number, rate: number = TUNING.ai.turnSpeed): void {
    this.yaw = wrapAngle(this.yaw + wrapAngle(yaw - this.yaw) * damp(rate, dt));
  }

  faceTowards(p: THREE.Vector3, dt: number, rate?: number): void {
    this.turnTo(Math.atan2(-(p.x - this.position.x), -(p.z - this.position.z)), dt, rate);
  }

  // ------------------------------------------------------------ combat

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    this.model.root.updateMatrixWorld(true);
    return this.model.weaponMount.localToWorld(
      out.copy(RIFLE_MUZZLE).multiplyScalar(this.type === 'sniper' ? 1.35 : 1),
    );
  }

  /** Fires one round at a point with spread; hits the hero if the ray crosses them. */
  shootAt(point: THREE.Vector3): void {
    const ctx = this.ctx;
    const from = this.muzzle(new THREE.Vector3());
    const dir = point.clone().sub(from).normalize();
    const s = this.stats.spreadDeg * DEG;
    dir.x += (Math.random() - 0.5) * 2 * s;
    dir.y += (Math.random() - 0.5) * 2 * s * 0.6;
    dir.z += (Math.random() - 0.5) * 2 * s;
    dir.normalize();
    const range = this.stats.range * 1.5;
    const wh = ctx.physics.raycast(from, dir, range);
    const maxT = wh ? wh.t : range;
    const hero = ctx.hero;
    const hp = hero.position;
    const hb = {
      minX: hp.x - 0.4,
      maxX: hp.x + 0.4,
      minZ: hp.z - 0.4,
      maxZ: hp.z + 0.4,
      minY: hp.y,
      maxY: hp.y + hero.height,
    };
    const hh = rayBox(from, dir, hb, maxT);
    let end: THREE.Vector3;
    if (hh && !hero.dead) {
      end = from.clone().addScaledVector(dir, hh.t);
      ctx.damageHero(this.stats.damage, from);
      ctx.fx.hitSpark(end, dir, false);
    } else if (wh) {
      end = wh.point;
      ctx.fx.impact(wh.point, wh.normal, 0x8a7a5a);
    } else end = from.clone().addScaledVector(dir, range);
    ctx.fx.tracer(from, end, PALETTE.tracerEnemy, this.type === 'sniper' ? 0.06 : 0.045);
    ctx.fx.muzzleFlash(from, dir, this.type === 'sniper' ? 1.2 : 0.9);
    audio.play(this.type === 'sniper' ? 'sniper' : 'enemyRifle', { pos: from, maxDist: 90 });
    ctx.noise.emit(from, TUNING.noise.rifleShot * 0.8, 'enemyFire', false, true);
  }

  // ------------------------------------------------------------ Targetable

  getHitboxes(out: Hitbox[]): void {
    if (!this.alive) return;
    const p = this.position;
    const crouch = 0;
    out.push({
      minX: p.x - 0.36,
      maxX: p.x + 0.36,
      minZ: p.z - 0.36,
      maxZ: p.z + 0.36,
      minY: p.y,
      maxY: p.y + 1.6 - crouch,
      part: 'body',
    });
    const h = this.model.head.getWorldPosition(new THREE.Vector3());
    out.push({
      minX: h.x - 0.23,
      maxX: h.x + 0.23,
      minZ: h.z - 0.23,
      maxZ: h.z + 0.23,
      minY: h.y,
      maxY: h.y + 0.46,
      part: 'head',
    });
  }

  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 1.2);
  }

  onHit(
    damage: number,
    part: 'head' | 'body',
    _point: THREE.Vector3,
    dir: THREE.Vector3,
    silent: boolean,
  ): void {
    if (!this.alive) return;
    // Weapon damage already includes its headshot multiplier.
    void part;
    this.health -= damage;
    this.flinch = 0.25;
    if (this.health <= 0) {
      this.eliminate(silent, dir);
      return;
    }
    // Getting shot gives away the hero's rough position.
    this.brain.onShot(silent);
  }

  /** Starts the stagger -> fall -> voxel puff sequence. */
  eliminate(silent: boolean, _dir?: THREE.Vector3): void {
    if (!this.alive) return;
    this.alive = false;
    this.silentlyEliminated = silent;
    this.elimT = 0;
    this.cone.mesh.visible = false;
    this.icon.sprite.visible = false;
    this.brain.onEliminated(silent);
  }

  // ------------------------------------------------------------ per frame

  update(dt: number): void {
    if (this.gone) return;
    if (this.grabbed > 0) {
      this.grabbed -= dt;
      this.speed = 0;
    } else if (this.alive) this.brain.update(dt);
    this.flinch = Math.max(0, this.flinch - dt);

    const root = this.model.root;
    root.position.copy(this.position);
    root.rotation.y = this.yaw;
    this.anim.speed = this.speed;
    this.anim.pose = this.aiming ? 'rifleAim' : 'rifleLow';
    this.anim.aimPitch = this.aimPitch;
    this.anim.lean = this.flinch > 0 ? -0.25 * (this.flinch / 0.25) : 0;

    if (!this.alive) {
      this.elimT += dt;
      const t = this.elimT;
      // Stagger back, topple over, then burst into a puff of voxel cubes.
      this.anim.speed = 0;
      this.anim.pose = 'rifleLow';
      this.anim.lean = -Math.min(0.5, t * 2.5);
      if (t > 0.25) {
        const k = Math.min(1, (t - 0.25) / 0.35);
        root.rotation.x = -k * k * 1.45;
        root.position.y = this.position.y + Math.sin(k * Math.PI) * 0.15;
      }
      if (t > 0.75 && root.visible) {
        root.visible = false;
        const c = this.position.clone().setY(this.position.y + 0.4);
        this.ctx.fx.eliminate(c, this.colors, this.position.y);
        this.ctx.dropLoot(this.position);
        audio.play('eliminate', { pos: this.position, volume: 0.7 });
      }
      if (t > 1.2) this.gone = true;
    }
    this.model.update(dt, this.anim);

    if (this.alive) {
      const range = this.brain.visionRange;
      this.cone.update(
        dt,
        this.ctx.physics,
        this.position,
        this.yaw,
        range,
        this.brain.state,
        this.position.y + 1.5,
      );
      this.icon.sprite.position.copy(this.position).setY(this.position.y + 2.55);
      this.icon.set(this.brain.state, this.brain.awareness);
    }
  }

  get alertState() {
    return this.brain.state;
  }

  get awareness(): number {
    return this.brain.awareness;
  }

  alarm(at: THREE.Vector3, heroKnown: boolean): void {
    if (this.alive) this.brain.alarm(at, heroKnown);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.model.root, this.cone.mesh, this.icon.sprite);
  }
}
