import * as THREE from 'three';
import { Humanoid, defaultAnim, type AnimInput, type Pose } from '../characters/Humanoid';
import { heroParts } from '../characters/looks';
import { TUNING } from '../config/tuning';
import type { Physics, HideZone } from '../world/Physics';
import { damp, wrapAngle } from '../world/noise';

const P = TUNING.player;

export interface MoveIntent {
  x: number; // strafe (-1..1), camera-relative
  z: number; // forward (-1..1)
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

/** The player character: movement, stance, health. Weapons live in WeaponSystem. */
export class Hero {
  readonly model: Humanoid;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  facingYaw = 0;
  grounded = true;
  crouching = false;
  sprinting = false;
  height: number = P.height;
  health: number = P.maxHealth;
  timeSinceHit = 99;
  hideZone: HideZone | null = null;
  /** Set by gameplay: true while aiming/firing (hero faces the camera direction). */
  aiming = false;
  aimPitch = 0;
  pose: Pose = 'rifleLow';
  reloadT = -1;
  throwT = -1;
  /** Disables input-driven movement (intro, takedowns, death). */
  frozen = false;
  dead = false;
  /** Events consumed by the game each frame. */
  landedHard = false;
  jumped = false;
  footstep = false;
  private stepTimer = 0;
  private anim: AnimInput = defaultAnim();
  private fallStart = 0;
  lean = 0;

  constructor(private physics: Physics) {
    this.model = new Humanoid(heroParts(), 7);
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** True when crouched inside tall grass or a bush. */
  get hidden(): boolean {
    return this.crouching && this.hideZone !== null;
  }

  spawn(x: number, z: number, yaw: number): void {
    this.position.set(x, this.physics.terrain.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.facingYaw = yaw;
    this.health = P.maxHealth;
    this.dead = false;
    this.frozen = false;
    this.grounded = true;
    this.crouching = false;
    this.reloadT = -1;
    this.throwT = -1;
    this.lean = 0;
    this.model.root.rotation.set(0, yaw, 0);
    this.syncModel();
  }

  update(dt: number, intent: MoveIntent, camYaw: number): void {
    this.landedHard = false;
    this.jumped = false;
    this.footstep = false;
    this.timeSinceHit += dt;

    // Regenerate after a while without damage.
    if (!this.dead && this.timeSinceHit > P.regenDelay && this.health < P.maxHealth) {
      this.health = Math.min(P.maxHealth, this.health + P.regenRate * dt);
    }

    const canMove = !this.frozen && !this.dead;
    // Stance.
    if (canMove) {
      if (intent.crouch && this.grounded) this.crouching = true;
      else if (!intent.crouch && this.crouching) {
        // Only stand up if there is headroom (always true for now: no low ceilings).
        this.crouching = false;
      }
    }
    this.height += ((this.crouching ? P.crouchHeight : P.height) - this.height) * damp(14, dt);

    // Desired horizontal velocity, camera-relative.
    let ix = canMove ? intent.x : 0;
    let iz = canMove ? intent.z : 0;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const moving = len > 0.01;
    this.sprinting =
      canMove && intent.sprint && moving && !this.crouching && iz > -0.2 && !this.aiming;
    let speed = this.crouching ? P.crouchSpeed : this.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (this.aiming && !this.sprinting) speed *= P.aimMoveMultiplier;
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    const wantX = (fx * iz + rx * ix) * speed;
    const wantZ = (fz * iz + rz * ix) * speed;
    const accel = (this.grounded ? P.acceleration : P.acceleration * P.airControl) * dt;
    this.velocity.x += clampDelta(wantX - this.velocity.x, accel);
    this.velocity.z += clampDelta(wantZ - this.velocity.z, accel);

    // Jump.
    if (canMove && intent.jump && this.grounded) {
      this.velocity.y = P.jumpVelocity;
      this.grounded = false;
      this.crouching = false;
      this.jumped = true;
      this.fallStart = this.position.y;
    }

    // Integrate.
    this.velocity.y -= P.gravity * dt;
    this.physics.moveCircle(
      this.position,
      this.velocity.x * dt,
      this.velocity.z * dt,
      P.radius,
      this.height,
      this.grounded ? P.stepUp : 0.15,
    );
    const ground = this.physics.groundAt(
      this.position.x,
      this.position.z,
      P.radius,
      this.position.y,
      P.stepUp,
    );
    const nextY = this.position.y + this.velocity.y * dt;
    const snap = this.grounded ? 0.6 : 0; // stick to the ground when walking down small steps
    if (this.velocity.y <= 0 && nextY <= ground + snap) {
      if (!this.grounded && this.fallStart - ground > 0.3) this.landedHard = true;
      this.position.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      if (this.grounded) this.fallStart = this.position.y;
      this.position.y = nextY;
      this.grounded = false;
    }

    // Facing: aim direction while aiming, otherwise movement direction.
    let targetYaw = this.facingYaw;
    if (this.aiming) targetYaw = camYaw;
    else if (moving && canMove) targetYaw = Math.atan2(-wantX, -wantZ);
    this.facingYaw +=
      wrapAngle(targetYaw - this.facingYaw) * damp(this.aiming ? 22 : P.turnSpeed, dt);
    this.facingYaw = wrapAngle(this.facingYaw);

    // Hiding state.
    const hz = this.physics.hideZoneAt(this.position.x, this.position.z);
    this.hideZone = hz && this.position.y < hz.top ? hz : null;

    // Footsteps.
    if (this.grounded && this.speed > 0.6) {
      this.stepTimer -= dt * (this.speed / P.walkSpeed);
      if (this.stepTimer <= 0) {
        this.stepTimer = TUNING.noise.footstepInterval;
        this.footstep = true;
      }
    }

    this.syncModel();
    this.anim.speed = this.speed;
    this.anim.crouch = this.crouching ? 1 : 0;
    this.anim.pose = this.dead ? 'none' : this.pose;
    this.anim.aimPitch = this.aimPitch;
    this.anim.airborne = !this.grounded;
    this.anim.reload = this.reloadT;
    this.anim.throwT = this.throwT;
    this.anim.lean = this.lean;
    this.model.update(dt, this.anim);
  }

  damage(amount: number): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceHit = 0;
    if (this.health <= 0) this.dead = true;
  }

  heal(amount: number): void {
    this.health = Math.min(P.maxHealth, this.health + amount);
  }

  /** World position of the hero's head/chest (used for AI sight checks). */
  eyePoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.height * 0.85);
  }

  chestPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.height * 0.6);
  }

  private syncModel(): void {
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facingYaw;
  }
}

function clampDelta(d: number, max: number): number {
  return d > max ? max : d < -max ? -max : d;
}
