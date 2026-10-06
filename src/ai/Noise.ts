import * as THREE from 'three';

export type NoiseKind =
  | 'footstep'
  | 'sprint'
  | 'jump'
  | 'rifle'
  | 'pistol'
  | 'rock'
  | 'impact'
  | 'takedown'
  | 'enemyFire'
  | 'alarm';

export interface NoiseEvent {
  pos: THREE.Vector3;
  radius: number;
  kind: NoiseKind;
  /** True if the hero made the noise (guards hear it and investigate). */
  fromHero: boolean;
  /** Loud combat noise: guards in range go straight to alerted. */
  alarming: boolean;
}

/** Simple broadcast bus: anything that makes noise emits; guards listen. */
export class NoiseBus {
  private listeners: ((e: NoiseEvent) => void)[] = [];
  /** The last few events (used by the HUD to draw noise rings). */
  readonly recent: NoiseEvent[] = [];

  on(fn: (e: NoiseEvent) => void): void {
    this.listeners.push(fn);
  }

  emit(
    pos: THREE.Vector3,
    radius: number,
    kind: NoiseKind,
    fromHero = true,
    alarming = false,
  ): void {
    const e: NoiseEvent = { pos: pos.clone(), radius, kind, fromHero, alarming };
    this.recent.push(e);
    if (this.recent.length > 8) this.recent.shift();
    for (const l of this.listeners) l(e);
  }

  clear(): void {
    this.listeners.length = 0;
    this.recent.length = 0;
  }
}
