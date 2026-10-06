import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { AlertState } from './AlertSystem';
import type { AIContext } from './context';
import type { NoiseEvent } from './Noise';
import type { Guard } from '../enemies/Guard';
import { DEG, lerp, wrapAngle } from '../world/noise';
import { audio } from '../audio/Audio';

const A = TUNING.ai;

/**
 * Guard decision making: patrol, perceive (vision cone + hearing), and move
 * through the alert states unaware -> suspicious -> alerted -> searching -> unaware.
 */
export class GuardBrain {
  state: AlertState = 'unaware';
  awareness = 0;
  /** True while the guard can currently see the hero. */
  seeing = false;
  private patrolIdx = 0;
  private waitTimer = 0;
  private lookIdx = 0;
  private lookTimer = 3;
  private stateTime = 0;
  private sinceSeen = 99;
  private readonly lastKnown = new THREE.Vector3();
  private readonly investigatePoint = new THREE.Vector3();
  private searchPoints: THREE.Vector3[] = [];
  private burstLeft = 0;
  private fireTimer = 0.7;
  private flankTarget: THREE.Vector3 | null = null;
  private flankTimer = 0;
  private reaction = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private patrol: THREE.Vector3[];

  constructor(
    private g: Guard,
    private ctx: AIContext,
  ) {
    this.patrol = g.def.patrol.map(([x, z]) => new THREE.Vector3(x, 0, z));
    ctx.noise.on((e) => this.hear(e));
  }

  get visionRange(): number {
    const base =
      this.state === 'alerted'
        ? A.visionRangeAlerted
        : this.state === 'unaware'
          ? A.visionRange
          : A.visionRangeSuspicious;
    return this.g.type === 'sniper' ? base * 1.6 : base;
  }

  private setState(s: AlertState): void {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    if (s === 'suspicious' && prev === 'unaware')
      audio.play('suspicious', { pos: this.g.position, maxDist: 40, volume: 0.6 });
    if (s === 'alerted') {
      audio.play('alert', { pos: this.g.position, maxDist: 60, volume: 0.8 });
      this.burstLeft = 0;
      this.fireTimer = A.firstShotDelay * (this.g.type === 'sniper' ? 1.6 : 1);
    }
    if (s === 'searching') this.makeSearchPoints();
  }

  // ---------------------------------------------------------------- perception

  private perceive(dt: number): void {
    const hero = this.ctx.hero;
    const g = this.g;
    this.seeing = false;
    if (hero.dead) return;
    const eye = g.eye(this.tmp);
    const chest = hero.chestPoint(this.tmp2);
    const dx = chest.x - eye.x;
    const dz = chest.z - eye.z;
    const d = Math.hypot(dx, dz);
    const range = this.visionRange;
    if (d > range) return;
    const fwdYaw = g.yaw;
    const toYaw = Math.atan2(-dx, -dz);
    const fov = A.visionFovDeg * DEG * (g.type === 'sniper' ? 0.7 : 1);
    const inCone = Math.abs(wrapAngle(toYaw - fwdYaw)) < fov / 2;
    const near = d < A.peripheralRange;
    if (!inCone && !near) return;
    const phys = this.ctx.physics;
    const head = hero.eyePoint(new THREE.Vector3());
    if (!phys.lineOfSight(eye, chest) && !phys.lineOfSight(eye, head)) return;

    // How visible is the hero right now?
    const S = TUNING.stealth;
    let vis = 1;
    if (hero.hidden) vis = d < 2.2 ? 0.5 : this.state === 'alerted' && d < 6 ? 0.25 : 0.04;
    else {
      if (hero.hideZone) vis *= 1 - S.grassHideStanding;
      if (hero.crouching) vis *= S.crouchVisibility;
      if (hero.sprinting) vis *= S.sprintVisibility;
    }
    if (near && !hero.hidden) vis *= 1.6;
    const rate = lerp(A.detectRateNear, A.detectRateFar, d / range) * vis;
    if (this.state === 'alerted') {
      // Already hunting: anything but deep cover keeps them locked on.
      if (vis > 0.2) {
        this.seeing = true;
        this.awareness = 1;
      }
    } else {
      this.awareness = Math.min(
        1.2,
        this.awareness + rate * dt * (this.state === 'searching' ? 1.6 : 1),
      );
      if (this.awareness >= A.alertThreshold) this.seeing = true;
    }
    if (vis > 0.1 && this.awareness > 0.1) this.investigatePoint.copy(hero.position);
    if (this.seeing) this.lastKnown.copy(hero.position);
  }

  private hear(e: NoiseEvent): void {
    const g = this.g;
    if (!g.alive || this.ctx.hero.dead) return;
    const d = e.pos.distanceTo(g.position);
    if (d > e.radius) return;
    if (!e.fromHero) {
      // A teammate opened fire: join the fight.
      if (e.alarming && this.state !== 'alerted') this.alarm(this.ctx.hero.position, false);
      return;
    }
    if (e.alarming) {
      this.alarm(e.pos, d < e.radius * 0.4);
      return;
    }
    if (this.state === 'alerted') {
      if (e.kind !== 'rock' && e.kind !== 'impact') this.lastKnown.copy(e.pos);
      return;
    }
    // Quiet noises make them suspicious and come to look.
    this.investigatePoint.copy(e.pos);
    this.awareness = Math.max(this.awareness, A.suspiciousThreshold + 0.05);
    if (this.state === 'unaware' || this.state === 'searching') this.setState('suspicious');
    else this.stateTime = Math.min(this.stateTime, 0.8);
  }

  /** Become alerted (from a call for help, gunfire, or getting shot). */
  alarm(at: THREE.Vector3, heroKnown: boolean): void {
    if (!this.g.alive) return;
    this.awareness = 1;
    this.lastKnown.copy(at);
    this.sinceSeen = heroKnown ? 0 : A.loseSightTime * 0.4;
    this.setState('alerted');
  }

  private callForHelp(radius: number): void {
    for (const other of this.ctx.squad()) {
      if (other === (this.g as unknown) || !other.alive) continue;
      if (other.position.distanceTo(this.g.position) < radius)
        other.alarm(this.ctx.hero.position, false);
    }
  }

  onShot(silent: boolean): void {
    const wasAlerted = this.state === 'alerted';
    this.alarm(this.ctx.hero.position, false);
    // Turn toward the shooter right away.
    this.reaction = 0.3;
    if (!wasAlerted) this.callForHelp(silent ? 10 : A.callForHelpRadius);
  }

  onEliminated(silent: boolean): void {
    if (!silent) return;
    // Nearby guards who see a teammate go down get suspicious.
    for (const other of this.ctx.squad()) {
      if (other === (this.g as unknown) || !other.alive) continue;
      const d = other.position.distanceTo(this.g.position);
      if (d < 9) {
        const o = other as unknown as Guard;
        if (
          o.brain &&
          this.ctx.physics.lineOfSight(o.eye(new THREE.Vector3()), this.g.eye(new THREE.Vector3()))
        ) {
          o.brain.investigate(this.g.position);
        }
      }
    }
  }

  investigate(p: THREE.Vector3): void {
    if (this.state === 'alerted') return;
    this.investigatePoint.copy(p);
    this.awareness = Math.max(this.awareness, A.suspiciousThreshold + 0.1);
    this.setState('suspicious');
  }

  // ---------------------------------------------------------------- behavior

  update(dt: number): void {
    this.stateTime += dt;
    this.reaction = Math.max(0, this.reaction - dt);
    const before = this.state;
    this.perceive(dt);

    // Thresholds.
    if (this.state !== 'alerted') {
      if (this.awareness >= A.alertThreshold) {
        this.setState('alerted');
        this.lastKnown.copy(this.ctx.hero.position);
        this.sinceSeen = 0;
        this.callForHelp(A.callForHelpRadius);
      } else if (this.awareness >= A.suspiciousThreshold && this.state === 'unaware') {
        this.setState('suspicious');
      }
    }
    if (!this.seeing && this.state !== 'alerted') {
      const decay = this.state === 'searching' ? A.alertDecay : A.suspicionDecay;
      this.awareness = Math.max(0, this.awareness - decay * dt);
    }
    if (before !== this.state && this.state === 'alerted') this.flankTarget = null;

    this.g.aiming = false;
    switch (this.state) {
      case 'unaware':
        this.doPatrol(dt);
        break;
      case 'suspicious':
        this.doSuspicious(dt);
        break;
      case 'alerted':
        this.doAlerted(dt);
        break;
      case 'searching':
        this.doSearch(dt);
        break;
    }
  }

  private doPatrol(dt: number): void {
    const g = this.g;
    if (this.patrol.length === 1 || g.elevated) {
      // Stationary: return to post and scan between look directions.
      const post = this.patrol[0];
      const dist = g.elevated ? 0 : g.moveTo(post, A.patrolSpeed, dt);
      if (dist < 0.3) {
        g.stop();
        const looks = g.def.look ?? [g.yaw];
        this.lookTimer -= dt;
        if (this.lookTimer <= 0) {
          this.lookIdx = (this.lookIdx + 1) % looks.length;
          this.lookTimer = 2.5 + Math.random() * 2;
        }
        g.turnTo(looks[this.lookIdx], dt, 1.6);
      }
      return;
    }
    const wp = this.patrol[this.patrolIdx];
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      g.stop();
      g.turnTo(g.yaw + Math.sin(this.waitTimer * 1.3) * 0.02, dt);
      if (this.waitTimer <= 0) this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
      return;
    }
    const dist = g.moveTo(wp, A.patrolSpeed, dt);
    if (dist < 0.4) this.waitTimer = g.def.waitTime ?? 2;
  }

  private doSuspicious(dt: number): void {
    const g = this.g;
    const p = this.investigatePoint;
    if (this.stateTime < 0.9 || g.elevated) {
      // Stop and look toward the disturbance.
      g.stop();
      g.faceTowards(p, dt, 4);
    } else {
      const d = g.moveTo(p, A.investigateSpeed, dt);
      if (d < 1.2) {
        g.stop();
        g.turnTo(g.yaw + dt * 1.6, dt, 3);
      }
    }
    if (this.stateTime > A.investigateTime + 2 && this.awareness < A.suspiciousThreshold)
      this.returnToPatrol();
    if (this.stateTime > A.investigateTime * 2.5) this.returnToPatrol();
  }

  private doAlerted(dt: number): void {
    const g = this.g;
    const hero = this.ctx.hero;
    if (this.seeing) this.sinceSeen = 0;
    else this.sinceSeen += dt;

    if (this.seeing && this.ctx.combatEnabled) {
      // Face and fire in bursts.
      const target = hero.chestPoint(this.tmp);
      g.faceTowards(target, dt, 8);
      g.aiming = true;
      const eye = g.eye(this.tmp2);
      g.aimPitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
      const facing =
        Math.abs(
          wrapAngle(Math.atan2(-(target.x - g.position.x), -(target.z - g.position.z)) - g.yaw),
        ) < 0.35;
      this.fireTimer -= dt;
      const dist = g.position.distanceTo(hero.position);
      if (this.fireTimer <= 0 && facing && this.reaction <= 0 && dist < g.stats.range * 1.4) {
        if (this.burstLeft <= 0) this.burstLeft = g.stats.burst;
        g.shootAt(target);
        this.burstLeft--;
        this.fireTimer =
          this.burstLeft > 0
            ? g.stats.fireInterval
            : g.stats.burstPause * (0.8 + Math.random() * 0.5);
      }
      // Between bursts, reposition (flank) unless pinned to a tower.
      if (!g.elevated && g.type !== 'sniper' && this.burstLeft <= 0) this.reposition(dt, dist);
      else g.stop();
      return;
    }

    // Lost sight: chase to the last known position.
    if (!g.elevated) {
      const d = g.moveTo(this.lastKnown, A.chaseSpeed, dt);
      if (d < 1.5) {
        g.stop();
        g.turnTo(g.yaw + dt * 2.5, dt, 3);
      }
    } else {
      g.faceTowards(this.lastKnown, dt, 3);
    }
    if (this.sinceSeen > A.loseSightTime) this.setState('searching');
  }

  /** Moves to a flanking spot around the hero at the preferred range. */
  private reposition(dt: number, dist: number): void {
    const g = this.g;
    const hero = this.ctx.hero;
    this.flankTimer -= dt;
    if (!this.flankTarget || this.flankTimer <= 0) {
      this.flankTimer = 2.5 + Math.random() * 2;
      const away = Math.atan2(g.position.x - hero.position.x, g.position.z - hero.position.z);
      const side = g.index % 2 === 0 ? 1 : -1;
      const ang = away + side * (0.5 + Math.random() * 0.6);
      const r = Math.min(A.preferredRange, Math.max(6, dist * 0.8));
      this.flankTarget = new THREE.Vector3(
        hero.position.x + Math.sin(ang) * r,
        0,
        hero.position.z + Math.cos(ang) * r,
      );
      if (!this.ctx.physics.terrain.inBounds(this.flankTarget.x, this.flankTarget.z, 8))
        this.flankTarget.copy(g.position);
    }
    const d = g.moveTo(this.flankTarget, A.chaseSpeed * 0.75, dt, false);
    g.faceTowards(hero.position, dt, 8);
    if (d < 0.6) g.stop();
  }

  private makeSearchPoints(): void {
    this.searchPoints = [this.lastKnown.clone()];
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 5;
      this.searchPoints.push(
        new THREE.Vector3(
          this.lastKnown.x + Math.sin(a) * r,
          0,
          this.lastKnown.z + Math.cos(a) * r,
        ),
      );
    }
  }

  private doSearch(dt: number): void {
    const g = this.g;
    if (g.elevated) {
      g.turnTo(g.yaw + dt * 0.8, dt, 2);
    } else if (this.searchPoints.length) {
      const p = this.searchPoints[0];
      const d = g.moveTo(p, A.investigateSpeed, dt);
      if (d < 1 || this.stateTime > A.searchTime * 0.6 * (5 - this.searchPoints.length)) {
        this.searchPoints.shift();
        g.stop();
      }
    } else {
      g.stop();
      g.turnTo(g.yaw + dt * 1.8, dt, 3);
    }
    if (this.stateTime > A.searchTime) this.returnToPatrol();
  }

  private returnToPatrol(): void {
    this.awareness = Math.min(this.awareness, 0.2);
    // Resume from the nearest waypoint.
    let best = 0;
    let bd = Infinity;
    this.patrol.forEach((p, i) => {
      const d = p.distanceTo(this.g.position);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.patrolIdx = best;
    this.waitTimer = 0;
    this.setState('unaware');
  }
}
