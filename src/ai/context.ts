import type * as THREE from 'three';
import type { Hero } from '../player/Hero';
import type { Physics } from '../world/Physics';
import type { Effects } from '../fx/Effects';
import type { NoiseBus } from './Noise';
import type { AlertSystem } from './AlertSystem';

/** Everything the AI is allowed to read or poke in the world. */
export interface AIContext {
  hero: Hero;
  physics: Physics;
  fx: Effects;
  noise: NoiseBus;
  alert: AlertSystem;
  /** All guards (for calling for help). */
  squad(): Iterable<Alertable>;
  damageHero(amount: number, from: THREE.Vector3): void;
  dropLoot(pos: THREE.Vector3): void;
  /** False during cutscenes / after the level ends: guards stop shooting. */
  combatEnabled: boolean;
}

/** Something that can be told to become alerted (by a teammate's call for help). */
export interface Alertable {
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  alarm(at: THREE.Vector3, heroKnown: boolean): void;
}
