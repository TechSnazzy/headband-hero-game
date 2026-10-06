import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { AlertState } from './AlertSystem';
import type { AIContext } from './context';
import type { NoiseEvent } from './Noise';
import type { Dog } from '../enemies/Dog';
import { DEG, wrapAngle } from '../world/noise';

const A = TUNING.ai;

/**
 * Guard dog behavior: heel beside its handler, sniff out the hero (smell works
 * through tall grass), bark to raise the alarm, and charge in to bite.
 */
export class DogBrain {
  state: AlertState = 'unaware';
  awareness = 0;
  sniffing = false;
  private stateTime = 0;
  private biteTimer = 0;
  private barkTimer = 0;
  private readonly target = new THREE.Vector3();
  private sinceSeen = 99;
  private tmp = new THREE.Vector3();

  constructor(
    private d: Dog,
    private ctx: AIContext,
  ) {
    ctx.noise.on((e) => this.hear(e));
  }

  get visionRange(): number {
    return this.state === 'alerted' ? 20 : 13;
  }

  private setState(s: AlertState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateTime = 0;
    if (s === 'suspicious' || s === 'alerted') {
      this.d.bark();
      this.barkTimer = 1.5;
    }
  }

  alarm(at: THREE.Vector3, _known: boolean): void {
    this.awareness = 1;
    this.target.copy(at);
    this.sinceSeen = 0;
    this.setState('alerted');
  }

  private hear(e: NoiseEvent): void {
    if (!this.d.alive || this.ctx.hero.dead) return;
    if (e.pos.distanceTo(this.d.position) > e.radius * 1.2) return;
    if (!e.fromHero) {
      if (e.alarming && this.state !== 'alerted' && e.kind !== 'alarm')
        this.alarm(this.ctx.hero.position, false);
      return;
    }
    if (e.alarming) {
      this.alarm(e.pos, false);
      return;
    }
    if (this.state === 'alerted') return;
    this.target.copy(e.pos);
    this.awareness = Math.max(this.awareness, A.suspiciousThreshold + 0.05);
    this.setState('suspicious');
  }

  private perceive(dt: number): boolean {
    const hero = this.ctx.hero;
    if (hero.dead) return false;
    const d = this.d;
    const dist = hero.position.distanceTo(d.position);
    // Smell: works even when hidden, unless the hero is far.
    const smell = dist < A.dogSmellRange;
    let seen = false;
    if (dist < this.visionRange) {
      const toYaw = Math.atan2(
        -(hero.position.x - d.position.x),
        -(hero.position.z - d.position.z),
      );
      const inCone = Math.abs(wrapAngle(toYaw - d.yaw)) < 70 * DEG;
      if (
        inCone &&
        !hero.hidden &&
        this.ctx.physics.lineOfSight(d.eye(this.tmp), hero.chestPoint(new THREE.Vector3()))
      )
        seen = true;
    }
    this.sniffing = smell && !seen && this.state !== 'alerted';
    if (seen || smell) {
      const rate = seen ? 1.6 * (hero.crouching ? 0.6 : 1) : 0.7 * (hero.crouching ? 0.6 : 1);
      this.awareness = Math.min(1.2, this.awareness + rate * dt);
      this.target.copy(hero.position);
      if (this.state === 'alerted') this.sinceSeen = 0;
    }
    return seen || (smell && this.state === 'alerted');
  }

  update(dt: number): void {
    this.stateTime += dt;
    this.biteTimer -= dt;
    this.barkTimer -= dt;
    const d = this.d;
    const senses = this.perceive(dt);
    if (!senses && this.state !== 'alerted')
      this.awareness = Math.max(0, this.awareness - A.suspicionDecay * dt);
    if (this.state !== 'alerted') {
      if (this.awareness >= 1) {
        this.alarm(this.ctx.hero.position, true);
        // Alert the handler and anyone nearby.
        for (const g of this.ctx.squad())
          if (g.alive && g.position.distanceTo(d.position) < 20)
            g.alarm(this.ctx.hero.position, false);
      } else if (this.awareness >= A.suspiciousThreshold && this.state === 'unaware')
        this.setState('suspicious');
    }

    switch (this.state) {
      case 'unaware': {
        const h = d.handler;
        if (h && h.alive) {
          // Heel at the handler's left side.
          const side = new THREE.Vector3(-Math.cos(h.yaw), 0, Math.sin(h.yaw)).multiplyScalar(1.2);
          const back = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(0.4);
          const spot = h.position.clone().add(side).add(back);
          const dist = d.moveTo(spot, Math.max(1.5, h.speed * 1.15), dt);
          if (dist < 0.4) {
            d.stop();
            d.turnTo(h.yaw, dt, 4);
          }
        } else {
          d.stop();
          d.turnTo(d.yaw + dt * 0.4, dt, 1);
        }
        break;
      }
      case 'suspicious': {
        const dist = d.moveTo(this.target, 3, dt);
        if (dist < 1) d.turnTo(d.yaw + dt * 2, dt, 3);
        if (this.stateTime > 8 && this.awareness < A.suspiciousThreshold) this.setState('unaware');
        if (this.stateTime > 14) this.setState('unaware');
        break;
      }
      case 'alerted': {
        const hero = this.ctx.hero;
        if (senses) this.target.copy(hero.position);
        else this.sinceSeen += dt;
        const dist = d.moveTo(this.target, A.dogSpeed, dt);
        if (this.barkTimer <= 0) {
          this.barkTimer = 2 + Math.random() * 1.5;
          d.bark();
        }
        if (
          !hero.dead &&
          hero.position.distanceTo(d.position) < 1.4 &&
          this.biteTimer <= 0 &&
          this.ctx.combatEnabled
        ) {
          this.biteTimer = A.dogBiteInterval;
          this.ctx.damageHero(A.dogBiteDamage, d.position);
        }
        if (dist < 1 && !senses) d.turnTo(d.yaw + dt * 3, dt, 4);
        if (this.sinceSeen > A.loseSightTime * 1.5) this.setState('searching');
        break;
      }
      case 'searching': {
        d.moveTo(this.target, 2.5, dt);
        this.sniffing = true;
        if (this.stateTime > A.searchTime) {
          this.awareness = 0.2;
          this.setState('unaware');
        }
        break;
      }
    }
  }
}
