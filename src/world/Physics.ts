import * as THREE from 'three';
import type { Terrain } from './Terrain';

export interface Collider {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Characters cannot walk through it. */
  solid: boolean;
  /** Blocks bullets and line of sight. */
  blocksRays: boolean;
  /** Object to fade when it sits between the camera and the hero. */
  fade?: THREE.Object3D;
  tag?: string;
}

/** A soft hiding area (tall grass or bush). Crouching inside makes the hero hard to see. */
export interface HideZone {
  x: number;
  z: number;
  r: number;
  top: number;
  kind: 'grass' | 'bush';
}

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: Collider | null; // null = terrain
}

const GRID = 8;

/** Static world collision: terrain + axis-aligned boxes, analytic ray casts. */
export class Physics {
  readonly colliders: Collider[] = [];
  readonly hideZones: HideZone[] = [];
  private grid = new Map<number, Collider[]>();
  private tmpBoxes: Collider[] = [];

  constructor(readonly terrain: Terrain) {}

  private key(gx: number, gz: number): number {
    return (gx + 512) * 4096 + (gz + 512);
  }

  add(c: Collider): Collider {
    this.colliders.push(c);
    const gx0 = Math.floor(c.minX / GRID);
    const gx1 = Math.floor(c.maxX / GRID);
    const gz0 = Math.floor(c.minZ / GRID);
    const gz1 = Math.floor(c.maxZ / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const k = this.key(gx, gz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
    return c;
  }

  /** Convenience: box from center/size. */
  addBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    opts: Partial<Pick<Collider, 'solid' | 'blocksRays' | 'fade' | 'tag'>> = {},
  ): Collider {
    return this.add({
      minX: x - w / 2,
      maxX: x + w / 2,
      minY: y,
      maxY: y + h,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      solid: opts.solid ?? true,
      blocksRays: opts.blocksRays ?? true,
      fade: opts.fade,
      tag: opts.tag,
    });
  }

  remove(c: Collider): void {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    for (const list of this.grid.values()) {
      const j = list.indexOf(c);
      if (j >= 0) list.splice(j, 1);
    }
  }

  addHideZone(z: HideZone): void {
    this.hideZones.push(z);
  }

  /** Colliders whose grid cells overlap the given XZ rectangle. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): Collider[] {
    const out = this.tmpBoxes;
    out.length = 0;
    const gx0 = Math.floor(minX / GRID);
    const gx1 = Math.floor(maxX / GRID);
    const gz0 = Math.floor(minZ / GRID);
    const gz1 = Math.floor(maxZ / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const list = this.grid.get(this.key(gx, gz));
        if (!list) continue;
        for (const c of list) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }

  /**
   * Ground height under a character circle: highest terrain cell or box top that the
   * character can stand on (top <= feetY + stepUp).
   */
  groundAt(x: number, z: number, r: number, feetY: number, stepUp: number): number {
    const limit = feetY + stepUp;
    let g = -10;
    const rr = r * 0.6;
    const samples: [number, number][] = [
      [x, z],
      [x + rr, z],
      [x - rr, z],
      [x, z + rr],
      [x, z - rr],
    ];
    for (const [sx, sz] of samples) {
      const h = this.terrain.heightAt(sx, sz);
      if (h <= limit && h > g) g = h;
    }
    for (const c of this.query(x - r, z - r, x + r, z + r)) {
      if (!c.solid) continue;
      if (x + rr < c.minX || x - rr > c.maxX || z + rr < c.minZ || z - rr > c.maxZ) continue;
      if (c.maxY <= limit && c.maxY > g) g = c.maxY;
    }
    return g;
  }

  /**
   * Moves a character circle by (dx, dz) and pushes it out of terrain ledges taller than
   * stepUp and solid boxes. Mutates and returns pos.
   */
  moveCircle(
    pos: THREE.Vector3,
    dx: number,
    dz: number,
    r: number,
    height: number,
    stepUp: number,
  ): THREE.Vector3 {
    // Sub-step large moves so we never tunnel through thin walls.
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    for (let s = 0; s < steps; s++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      this.resolve(pos, r, height, stepUp);
    }
    return pos;
  }

  private resolve(pos: THREE.Vector3, r: number, height: number, stepUp: number): void {
    const feet = pos.y;
    const limit = feet + stepUp;
    for (let iter = 0; iter < 3; iter++) {
      // Terrain cells as boxes.
      const x0 = Math.floor(pos.x - r);
      const x1 = Math.floor(pos.x + r);
      const z0 = Math.floor(pos.z - r);
      const z1 = Math.floor(pos.z + r);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const h = this.terrain.heightAt(cx + 0.5, cz + 0.5);
          if (h <= limit) continue;
          pushCircleOutOfRect(pos, r, cx, cz, cx + 1, cz + 1);
        }
      }
      for (const c of this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r)) {
        if (!c.solid) continue;
        if (c.maxY <= limit || c.minY >= feet + height) continue;
        pushCircleOutOfRect(pos, r, c.minX, c.minZ, c.maxX, c.maxZ);
      }
    }
  }

  /** Ray cast against terrain and ray-blocking boxes. dir must be normalized. */
  raycast(
    o: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    ignore?: (c: Collider) => boolean,
  ): RayHit | null {
    let best = maxDist;
    let bestC: Collider | null = null;
    let bestAxis = -1;
    let bestSign = 1;
    const ex = o.x + dir.x * maxDist;
    const ez = o.z + dir.z * maxDist;
    const cands = this.query(
      Math.min(o.x, ex),
      Math.min(o.z, ez),
      Math.max(o.x, ex),
      Math.max(o.z, ez),
    );
    for (const c of cands) {
      if (!c.blocksRays || (ignore && ignore(c))) continue;
      const res = rayBox(o, dir, c, best);
      if (res) {
        best = res.t;
        bestC = c;
        bestAxis = res.axis;
        bestSign = res.sign;
      }
    }
    const tt = this.terrain.raycast(o, dir, best);
    if (tt >= 0 && tt < best) {
      const p = o.clone().addScaledVector(dir, tt);
      return { t: tt, point: p, normal: new THREE.Vector3(0, 1, 0), collider: null };
    }
    if (bestC) {
      const n = new THREE.Vector3();
      n.setComponent(bestAxis, bestSign);
      return { t: best, point: o.clone().addScaledVector(dir, best), normal: n, collider: bestC };
    }
    return null;
  }

  /** True if nothing blocks the straight line between a and b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.divideScalar(len);
    return this.raycast(a, dir, len - 0.05) === null;
  }

  /** Returns the hide zone the point is inside of (if any). */
  hideZoneAt(x: number, z: number): HideZone | null {
    for (const h of this.hideZones) {
      const dx = x - h.x;
      const dz = z - h.z;
      if (dx * dx + dz * dz < h.r * h.r) return h;
    }
    return null;
  }
}

function pushCircleOutOfRect(
  pos: THREE.Vector3,
  r: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): void {
  const cx = Math.max(minX, Math.min(pos.x, maxX));
  const cz = Math.max(minZ, Math.min(pos.z, maxZ));
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = r - d;
    pos.x += (dx / d) * push;
    pos.z += (dz / d) * push;
    return;
  }
  // Center inside the rectangle: push out along the shallowest axis.
  const l = pos.x - minX;
  const rr = maxX - pos.x;
  const t = pos.z - minZ;
  const b = maxZ - pos.z;
  const m = Math.min(l, rr, t, b);
  if (m === l) pos.x = minX - r;
  else if (m === rr) pos.x = maxX + r;
  else if (m === t) pos.z = minZ - r;
  else pos.z = maxZ + r;
}

/** Slab test. Returns entry distance, hit axis and normal sign. */
export function rayBox(
  o: THREE.Vector3,
  d: THREE.Vector3,
  b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
  maxT: number,
): { t: number; axis: number; sign: number } | null {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 1;
  const mins = [b.minX, b.minY, b.minZ];
  const maxs = [b.maxX, b.maxY, b.maxZ];
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < mins[i] || os[i] > maxs[i]) return null;
      continue;
    }
    const inv = 1 / ds[i];
    let t1 = (mins[i] - os[i]) * inv;
    let t2 = (maxs[i] - os[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === -1) return null; // origin inside the box
  return { t: tmin, axis, sign };
}
