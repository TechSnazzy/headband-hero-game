import * as THREE from 'three';
import { rayBox } from '../world/Physics';

/** An axis-aligned hitbox in world space. */
export interface Hitbox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  part: 'head' | 'body';
}

/**
 * Anything bullets can interact with. Friendly targets (captives, allies,
 * civilians) are never damaged: shots pass through them, and the crosshair shows
 * a "friendly" indicator over them.
 */
export interface Targetable {
  readonly alive: boolean;
  readonly friendly: boolean;
  readonly team: 'hero' | 'enemy' | 'neutral';
  getHitboxes(out: Hitbox[]): void;
  /** Center of mass used by aim assist. */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  onHit(
    damage: number,
    part: 'head' | 'body',
    point: THREE.Vector3,
    dir: THREE.Vector3,
    silent: boolean,
  ): void;
  /** Display name for the friendly indicator. */
  readonly label?: string;
}

export interface TargetHit {
  target: Targetable;
  t: number;
  part: 'head' | 'body';
  point: THREE.Vector3;
}

const boxes: Hitbox[] = [];

/** Ray vs all hitboxes of the given targets. Returns the nearest hit (friendlies included if asked). */
export function raycastTargets(
  targets: Iterable<Targetable>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  opts: { includeFriendly: boolean; skip?: Targetable },
): TargetHit | null {
  let best: TargetHit | null = null;
  let bestT = maxDist;
  for (const t of targets) {
    if (!t.alive || t === opts.skip) continue;
    if (t.friendly && !opts.includeFriendly) continue;
    boxes.length = 0;
    t.getHitboxes(boxes);
    for (const b of boxes) {
      const r = rayBox(origin, dir, b, bestT);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = { target: t, t: r.t, part: b.part, point: origin.clone().addScaledVector(dir, r.t) };
      }
    }
  }
  return best;
}
