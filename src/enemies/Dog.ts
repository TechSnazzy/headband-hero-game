import * as THREE from 'three';
import { VoxelBuilder } from '../world/voxel';
import { PALETTE } from '../config/palette';
import { TUNING } from '../config/tuning';
import type { GuardDef } from '../levels/types';
import type { Hitbox, Targetable } from '../game/combat';
import type { AIContext } from '../ai/context';
import { DogBrain } from '../ai/DogBrain';
import { AlertIcon, VisionCone } from './VisionCone';
import { damp, DEG, wrapAngle } from '../world/noise';
import { audio } from '../audio/Audio';
import type { Guard } from './Guard';

const RADIUS = 0.4;

/** Guard dog: fast, short-sighted, but can smell the hero even in tall grass. */
export class Dog implements Targetable {
  readonly friendly = false;
  readonly team = 'enemy' as const;
  readonly type = 'dog' as const;
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly brain: DogBrain;
  readonly cone: VisionCone;
  readonly icon = new AlertIcon();
  yaw = 0;
  health: number = TUNING.enemies.dog.health;
  alive = true;
  gone = false;
  speed = 0;
  handler: Guard | null = null;
  private legs: THREE.Group[] = [];
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private phase = 0;
  private elimT = -1;
  private flinch = 0;

  constructor(
    readonly def: GuardDef,
    readonly index: number,
    private ctx: AIContext,
    scene: THREE.Scene,
  ) {
    this.buildModel();
    const [x, z] = def.patrol[0];
    this.position.set(x + 1.2, ctx.physics.terrain.heightAt(x + 1.2, z), z + 1);
    this.cone = new VisionCone(140 * DEG);
    scene.add(this.root, this.cone.mesh, this.icon.sprite);
    this.brain = new DogBrain(this, ctx);
  }

  readonly label = 'dog';

  private buildModel(): void {
    const fur = PALETTE.dogFur;
    const dark = PALETTE.dogDark;
    const v = new VoxelBuilder(91);
    // Body with a dark saddle.
    v.shell(0, 0.62, 0, 0.42, 0.4, 1.0, 0.1, fur);
    v.shell(0, 0.84, 0.05, 0.44, 0.08, 0.7, 0.1, dark);
    v.shell(0, 0.72, -0.5, 0.4, 0.4, 0.25, 0.1, fur); // chest
    v.box(0, 0.86, -0.5, 0.46, 0.08, 0.2, PALETTE.rust[0]); // collar
    this.root.add(v.mesh());

    const hv = new VoxelBuilder(92);
    hv.shell(0, 0.0, 0, 0.36, 0.34, 0.36, 0.09, fur);
    hv.shell(0, -0.06, -0.26, 0.22, 0.18, 0.22, 0.07, fur); // snout
    hv.box(0, -0.0, -0.37, 0.08, 0.07, 0.03, 0x111111); // nose
    hv.box(-0.1, 0.06, -0.181, 0.06, 0.05, 0.01, 0x1a120c); // eyes
    hv.box(0.1, 0.06, -0.181, 0.06, 0.05, 0.01, 0x1a120c);
    hv.box(-0.12, 0.25, 0.02, 0.09, 0.17, 0.07, dark[0]); // ears
    hv.box(0.12, 0.25, 0.02, 0.09, 0.17, 0.07, dark[0]);
    hv.box(0, -0.16, -0.27, 0.12, 0.03, 0.12, 0xb03a3a); // tongue
    this.head.add(hv.mesh());
    this.head.position.set(0, 0.95, -0.62);
    this.root.add(this.head);

    const tv = new VoxelBuilder(93);
    tv.shell(0, 0, 0.2, 0.1, 0.1, 0.4, 0.1, fur);
    this.tail.add(tv.mesh());
    this.tail.position.set(0, 0.76, 0.48);
    this.tail.rotation.x = 0.6;
    this.root.add(this.tail);

    for (const [x, z] of [
      [-0.14, -0.38],
      [0.14, -0.38],
      [-0.14, 0.36],
      [0.14, 0.36],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.48, z);
      const lv = new VoxelBuilder(94);
      lv.shell(0, -0.23, 0, 0.12, 0.46, 0.13, 0.06, fur);
      lv.box(0, -0.45, -0.03, 0.13, 0.06, 0.17, dark[1]);
      leg.add(lv.mesh());
      this.root.add(leg);
      this.legs.push(leg);
    }
  }

  get alertState() {
    return this.brain.state;
  }

  get awareness(): number {
    return this.brain.awareness;
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 0.95);
  }

  moveTo(target: THREE.Vector3, speed: number, dt: number, face = true): number {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) {
      this.speed = 0;
      return dist;
    }
    const step = Math.min(dist, speed * dt);
    const p = this.position;
    this.ctx.physics.moveCircle(p, (dx / dist) * step, (dz / dist) * step, RADIUS, 1, 1.05);
    const g = this.ctx.physics.groundAt(p.x, p.z, RADIUS, p.y, 1.05);
    p.y += (g - p.y) * Math.min(1, dt * 14);
    this.speed = speed;
    if (face) this.turnTo(Math.atan2(-dx, -dz), dt);
    return dist;
  }

  turnTo(yaw: number, dt: number, rate = 8): void {
    this.yaw = wrapAngle(this.yaw + wrapAngle(yaw - this.yaw) * damp(rate, dt));
  }

  stop(): void {
    this.speed = 0;
  }

  bark(): void {
    audio.play('bark', { pos: this.position, maxDist: 50 });
    this.ctx.noise.emit(this.position, 22, 'alarm', false, this.brain.state === 'alerted');
  }

  getHitboxes(out: Hitbox[]): void {
    if (!this.alive) return;
    const p = this.position;
    out.push({
      minX: p.x - 0.4,
      maxX: p.x + 0.4,
      minZ: p.z - 0.4,
      maxZ: p.z + 0.4,
      minY: p.y + 0.3,
      maxY: p.y + 0.95,
      part: 'body',
    });
    const h = this.head.getWorldPosition(new THREE.Vector3());
    out.push({
      minX: h.x - 0.2,
      maxX: h.x + 0.2,
      minZ: h.z - 0.2,
      maxZ: h.z + 0.2,
      minY: h.y - 0.2,
      maxY: h.y + 0.2,
      part: 'head',
    });
  }

  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 0.65);
  }

  onHit(
    damage: number,
    _part: 'head' | 'body',
    _p: THREE.Vector3,
    _d: THREE.Vector3,
    _silent: boolean,
  ): void {
    if (!this.alive) return;
    this.health -= damage;
    this.flinch = 0.2;
    if (this.health <= 0) {
      this.alive = false;
      this.elimT = 0;
      this.cone.mesh.visible = false;
      this.icon.sprite.visible = false;
      return;
    }
    this.brain.alarm(this.ctx.hero.position, true);
  }

  alarm(at: THREE.Vector3, heroKnown: boolean): void {
    if (this.alive) this.brain.alarm(at, heroKnown);
  }

  update(dt: number): void {
    if (this.gone) return;
    if (this.alive) this.brain.update(dt);
    this.flinch = Math.max(0, this.flinch - dt);
    this.phase += dt * (3 + this.speed * 2.2);
    const run = Math.min(1, this.speed / 3);
    const s = Math.sin(this.phase);
    this.legs[0].rotation.x = s * 0.7 * run;
    this.legs[3].rotation.x = s * 0.7 * run;
    this.legs[1].rotation.x = -s * 0.7 * run;
    this.legs[2].rotation.x = -s * 0.7 * run;
    this.tail.rotation.y = Math.sin(this.phase * 2) * (this.brain.state === 'unaware' ? 0.5 : 0.15);
    this.head.rotation.x = this.brain.sniffing ? 0.5 + Math.sin(this.phase * 3) * 0.1 : 0;
    this.root.position.copy(this.position);
    this.root.position.y += Math.abs(Math.cos(this.phase)) * 0.05 * run;
    this.root.rotation.y = this.yaw;
    this.root.rotation.z = this.flinch > 0 ? 0.2 : 0;

    if (!this.alive) {
      this.elimT += dt;
      const t = this.elimT;
      this.root.rotation.z = Math.min(1.5, t * 4);
      if (t > 0.45 && this.root.visible) {
        this.root.visible = false;
        this.ctx.fx.eliminate(
          this.position.clone().setY(this.position.y + 0.5),
          [...PALETTE.dogFur, ...PALETTE.dogDark],
          this.position.y,
        );
        audio.play('eliminate', { pos: this.position, volume: 0.6 });
      }
      if (t > 1) this.gone = true;
      return;
    }
    this.cone.update(
      dt,
      this.ctx.physics,
      this.position,
      this.yaw,
      this.brain.visionRange,
      this.brain.state,
      this.position.y + 0.9,
    );
    this.icon.sprite.position.copy(this.position).setY(this.position.y + 1.6);
    this.icon.set(this.brain.state, this.brain.awareness);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root, this.cone.mesh, this.icon.sprite);
  }
}
