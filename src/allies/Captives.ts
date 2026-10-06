import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import type { Physics } from '../world/Physics';
import type { Hero } from '../player/Hero';
import { Ally } from './Ally';
import { buildProp, type BuiltProp, type GrassField } from '../world/props';
import type { Interactable } from '../game/Interactions';
import { TUNING } from '../config/tuning';
import { audio } from '../audio/Audio';
import type { Collider } from '../world/Physics';

interface Cage {
  prop: BuiltProp;
  ally: Ally;
  doorOpen: number; // 0..1 animation
  opening: boolean;
}

/** Captive soldiers in bamboo cages, their rescue, and the followers. */
export class Captives {
  readonly allies: Ally[] = [];
  private cages: Cage[] = [];
  onFreed: ((ally: Ally) => void) | null = null;

  constructor(
    level: LevelDef,
    private scene: THREE.Scene,
    private physics: Physics,
    grass: GrassField,
  ) {
    level.captives.forEach((def, i) => {
      const prop = buildProp(
        { type: 'cage', x: def.x, z: def.z, rot: def.rot ?? Math.PI },
        { scene, physics, ground: (x, z) => physics.terrain.heightAt(x, z), grass },
      );
      const ally = new Ally(def, i, physics, scene);
      this.allies.push(ally);
      this.cages.push({ prop, ally, doorOpen: 0, opening: false });
    });
  }

  get freedCount(): number {
    return this.allies.filter((a) => a.state !== 'caged').length;
  }

  get total(): number {
    return this.allies.length;
  }

  /** One hold-E interactable per cage door. */
  interactables(): Interactable[] {
    return this.cages.map((c) => {
      // Door is on the cage's local -Z face.
      const rot = c.ally.def.rot ?? Math.PI;
      const doorPos = new THREE.Vector3(
        c.ally.def.x - 1.6 * Math.sin(rot),
        0,
        c.ally.def.z - 1.6 * Math.cos(rot),
      );
      doorPos.y = this.physics.terrain.heightAt(doorPos.x, doorPos.z);
      return {
        priority: 2,
        hold: TUNING.allies.freeHoldTime,
        range: 2.0,
        position: (out: THREE.Vector3) => out.copy(doorPos),
        available: () => c.ally.state === 'caged',
        prompt: () => `Free ${c.ally.def.name}`,
        complete: () => this.free(c),
      } satisfies Interactable;
    });
  }

  private free(c: Cage): void {
    c.opening = true;
    c.ally.free();
    // Remove the door collider so the captive can walk out.
    const door = this.physics.colliders.filter(
      (col: Collider) =>
        col.tag === 'cageDoor' &&
        Math.abs((col.minX + col.maxX) / 2 - c.ally.def.x) < 1.5 &&
        Math.abs((col.minZ + col.maxZ) / 2 - c.ally.def.z) < 2,
    );
    for (const d of door) this.physics.remove(d);
    audio.play('freed', { volume: 0.7 });
    this.onFreed?.(c.ally);
  }

  /** Ordering of followers: by freeing order. */
  private followSlot(a: Ally): number {
    return this.allies.filter((x) => x.state === 'following' || x.state === 'freed').indexOf(a);
  }

  update(dt: number, hero: Hero): void {
    for (const c of this.cages) {
      if (c.opening && c.doorOpen < 1) {
        c.doorOpen = Math.min(1, c.doorOpen + dt * 1.8);
        if (c.prop.door) c.prop.door.rotation.y = c.doorOpen * 1.9;
      }
    }
    for (const a of this.allies) a.update(dt, hero, Math.max(0, this.followSlot(a)));
  }

  /** Restore freed state (checkpoint restarts). */
  restoreFreed(names: string[], hero: Hero): void {
    for (const c of this.cages) {
      if (!names.includes(c.ally.def.name)) continue;
      this.free(c);
      c.doorOpen = 1;
      if (c.prop.door) c.prop.door.rotation.y = 1.9;
      c.ally.state = 'following';
      c.ally.position.copy(hero.position).add(new THREE.Vector3(Math.random() * 2 - 1, 0, 2));
    }
  }

  dispose(): void {
    for (const a of this.allies) a.dispose(this.scene);
    for (const c of this.cages) this.scene.remove(c.prop.object);
  }
}
