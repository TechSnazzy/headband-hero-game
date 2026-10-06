import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { Interactable } from '../game/Interactions';
import type { Guard } from '../enemies/Guard';
import type { Hero } from './Hero';
import type { NoiseBus } from '../ai/Noise';
import { audio } from '../audio/Audio';
import { DEG } from '../world/noise';

const S = TUNING.stealth;

/**
 * Silent takedown: hold E behind a guard who has not spotted you. The guard is
 * eliminated without gunfire; only a tiny noise radius.
 */
export function takedownFor(
  guard: Guard,
  noise: NoiseBus,
  onDone: (hero: Hero, guard: Guard) => void,
): Interactable {
  return {
    priority: 3,
    hold: S.takedownHold,
    range: S.takedownRange,
    position: (out) => out.copy(guard.position),
    available: (hero) => {
      if (!guard.alive || guard.elevated || guard.alertState === 'alerted') return false;
      if (hero.crouching === false && hero.sprinting) return false;
      // Must be within the cone behind the guard.
      const toHero = new THREE.Vector3(
        hero.position.x - guard.position.x,
        0,
        hero.position.z - guard.position.z,
      ).normalize();
      const back = guard.forward(new THREE.Vector3()).negate();
      return toHero.dot(back) > Math.cos(S.takedownAngleDeg * DEG);
    },
    prompt: () => 'Silent takedown',
    holding: () => {
      // Guard is grabbed: stop them turning around mid-takedown.
      guard.grabbed = 0.15;
    },
    complete: (hero) => {
      guard.eliminate(true);
      noise.emit(guard.position, TUNING.noise.takedown, 'takedown', true, false);
      audio.play('takedown', { volume: 0.8 });
      onDone(hero, guard);
    },
  };
}
