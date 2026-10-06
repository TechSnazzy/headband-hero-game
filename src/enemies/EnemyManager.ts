import * as THREE from 'three';
import type { LevelDef, GuardDef } from '../levels/types';
import type { AIContext } from '../ai/context';
import { Guard } from './Guard';
import { Dog } from './Dog';
import type { Targetable } from '../game/combat';
import type { AlertSource } from '../ai/AlertSystem';

/** Spawns and updates every enemy in the level. */
export class EnemyManager {
  readonly guards: Guard[] = [];
  readonly dogs: Dog[] = [];

  constructor(
    private scene: THREE.Scene,
    private ctx: AIContext,
  ) {}

  spawnLevel(level: LevelDef): void {
    level.guards.forEach((def, i) => this.spawn(def, i));
    // Link dogs to their handlers.
    for (const dog of this.dogs) {
      const h = dog.def.handler;
      if (h !== undefined) dog.handler = this.guards.find((g) => g.index === h) ?? null;
    }
  }

  spawn(def: GuardDef, index: number): Guard | Dog {
    if (def.type === 'dog') {
      const d = new Dog(def, index, this.ctx, this.scene);
      this.dogs.push(d);
      return d;
    }
    const g = new Guard(def.type, def, index, this.ctx, this.scene);
    this.guards.push(g);
    return g;
  }

  /** Reinforcement entering from a point and heading straight for the hero. */
  spawnReinforcement(x: number, z: number, index: number): Guard {
    const g = new Guard(
      'grunt',
      { type: 'grunt', patrol: [[x, z]] },
      100 + index,
      this.ctx,
      this.scene,
    );
    this.guards.push(g);
    g.alarm(this.ctx.hero.position, false);
    return g;
  }

  get all(): (Guard | Dog)[] {
    return [...this.guards, ...this.dogs];
  }

  targets(): Targetable[] {
    return this.all;
  }

  alertSources(): AlertSource[] {
    return this.all;
  }

  get aliveCount(): number {
    return this.all.filter((e) => e.alive).length;
  }

  update(dt: number): void {
    for (const g of this.guards) g.update(dt);
    for (const d of this.dogs) d.update(dt);
    // Clean up finished eliminations.
    for (let i = this.guards.length - 1; i >= 0; i--) {
      if (this.guards[i].gone) {
        this.guards[i].dispose(this.scene);
        this.guards.splice(i, 1);
      }
    }
    for (let i = this.dogs.length - 1; i >= 0; i--) {
      if (this.dogs[i].gone) {
        this.dogs[i].dispose(this.scene);
        this.dogs.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const e of this.all) e.dispose(this.scene);
    this.guards.length = 0;
    this.dogs.length = 0;
  }
}
