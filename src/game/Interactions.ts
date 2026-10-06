import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { Hero } from '../player/Hero';

/** Something the hero can hold E on: free a captive, open a crate, take down a guard. */
export interface Interactable {
  /** Higher wins when several are in range. */
  priority: number;
  /** Seconds E must be held. */
  hold: number;
  range: number;
  position(out: THREE.Vector3): THREE.Vector3;
  available(hero: Hero): boolean;
  prompt(): string;
  /** Called every frame while E is held (for animation). */
  holding?(progress: number): void;
  complete(hero: Hero): void;
  /** Called if the hold is interrupted. */
  cancel?(): void;
}

/** Picks the best interactable near the hero and tracks the hold-E progress. */
export class Interactions {
  private list: Interactable[] = [];
  private current: Interactable | null = null;
  private progress = 0;
  private tmp = new THREE.Vector3();
  cooldown = 0;

  add(i: Interactable): void {
    this.list.push(i);
  }

  remove(i: Interactable): void {
    this.list = this.list.filter((x) => x !== i);
  }

  clear(): void {
    this.list = [];
    this.current = null;
    this.progress = 0;
  }

  /** Returns the prompt for the HUD (or null). */
  update(dt: number, hero: Hero, eHeld: boolean): { text: string; progress: number } | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (hero.dead || hero.frozen) {
      this.reset();
      return null;
    }
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const i of this.list) {
      const p = i.position(this.tmp);
      const d = Math.hypot(p.x - hero.position.x, p.z - hero.position.z);
      if (d > i.range || Math.abs(p.y - hero.position.y) > 2.2 || !i.available(hero)) continue;
      const score = i.priority * 10 - d;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best !== this.current) {
      this.current?.cancel?.();
      this.current = best;
      this.progress = 0;
    }
    if (!best) return null;
    if (eHeld && this.cooldown <= 0) {
      this.progress += dt / best.hold;
      best.holding?.(this.progress);
      if (this.progress >= 1) {
        best.complete(hero);
        this.cooldown = 0.25;
        this.current = null;
        this.progress = 0;
        return null;
      }
    } else if (this.progress > 0) {
      this.progress = Math.max(0, this.progress - dt * 2);
      if (this.progress === 0) best.cancel?.();
    }
    return { text: best.prompt(), progress: this.progress };
  }

  private reset(): void {
    this.current?.cancel?.();
    this.current = null;
    this.progress = 0;
  }
}

export const INTERACT_RANGE = TUNING.player.interactRange;
