import * as THREE from 'three';
import type { LevelDef } from '../levels/types';
import { PALETTE, pickColor } from '../config/palette';
import { fbm, clamp, smoothstep, distToSegment } from './noise';

const CHUNK = 32;
const STEP = 0.5; // terrain heights are quantized to half blocks

/** Blocky heightmap terrain (1 m cells, half-block height steps). */
export class Terrain {
  readonly w: number;
  readonly d: number;
  readonly heights: Float32Array;
  readonly pathMask: Uint8Array;
  readonly group = new THREE.Group();
  private ox: number;
  private oz: number;

  constructor(private level: LevelDef) {
    this.w = level.size.w;
    this.d = level.size.d;
    this.ox = -this.w / 2;
    this.oz = -this.d / 2;
    this.heights = new Float32Array(this.w * this.d);
    this.pathMask = new Uint8Array(this.w * this.d);
    this.generate();
    this.buildMeshes();
  }

  private generate(): void {
    const t = this.level.terrain;
    const seed = this.level.seed;
    for (let iz = 0; iz < this.d; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const x = ix + this.ox + 0.5;
        const z = iz + this.oz + 0.5;
        let h = t.base + (fbm(x * t.frequency, z * t.frequency, seed) - 0.5) * 2 * t.amplitude;
        // Ridges along the outer border keep the player inside the map.
        const edge = Math.min(x - this.ox, this.ox + this.w - x, z - this.oz, this.oz + this.d - z);
        const b = 1 - smoothstep(0, t.borderWidth, edge);
        h += b * (t.border + fbm(x * 0.15, z * 0.15, seed + 9) * 4);

        for (const f of t.flats) {
          const dist = Math.hypot(x - f.x, z - f.z);
          const k = 1 - smoothstep(f.r, f.r + (f.blend ?? 6), dist);
          h = h + (f.h - h) * k;
        }
        let onPath = 0;
        for (const p of t.paths) {
          for (let i = 0; i < p.points.length - 1; i++) {
            const [ax, az] = p.points[i];
            const [bx, bz] = p.points[i + 1];
            const dd = distToSegment(x, z, ax, az, bx, bz);
            if (dd < p.width * 0.5) onPath = 1;
            const k = 1 - smoothstep(p.width * 0.5, p.width * 0.5 + 4, dd);
            const target = Math.min(h, t.base + 0.5);
            h = h + (target - h) * k * 0.8;
          }
        }
        const idx = iz * this.w + ix;
        this.heights[idx] = Math.max(0, Math.round(h / STEP) * STEP);
        this.pathMask[idx] = onPath;
      }
    }
  }

  /** Height of the top surface at world (x, z). */
  heightAt(x: number, z: number): number {
    const ix = Math.floor(x - this.ox);
    const iz = Math.floor(z - this.oz);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return 30;
    return this.heights[iz * this.w + ix];
  }

  /** Highest terrain under a circle (used so characters stand on block corners correctly). */
  maxHeightInRadius(x: number, z: number, r: number): number {
    let h = this.heightAt(x, z);
    h = Math.max(h, this.heightAt(x + r * 0.7, z), this.heightAt(x - r * 0.7, z));
    h = Math.max(h, this.heightAt(x, z + r * 0.7), this.heightAt(x, z - r * 0.7));
    return h;
  }

  isPath(x: number, z: number): boolean {
    const ix = Math.floor(x - this.ox);
    const iz = Math.floor(z - this.oz);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return false;
    return this.pathMask[iz * this.w + ix] === 1;
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return (
      x > this.ox + margin &&
      x < this.ox + this.w - margin &&
      z > this.oz + margin &&
      z < this.oz + this.d - margin
    );
  }

  /**
   * Ray vs heightfield. Marches along the ray and refines with bisection.
   * Returns hit distance or -1.
   */
  raycast(o: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const step = 0.25;
    let prev = 0;
    for (let t = step; t <= maxDist; t += step) {
      const x = o.x + dir.x * t;
      const y = o.y + dir.y * t;
      const z = o.z + dir.z * t;
      if (y < this.heightAt(x, z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const my = o.y + dir.y * mid;
          if (my < this.heightAt(o.x + dir.x * mid, o.z + dir.z * mid)) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = t;
      if (y > 40 && dir.y > 0) return -1;
    }
    return -1;
  }

  private buildMeshes(): void {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let cz = 0; cz < this.d; cz += CHUNK) {
      for (let cx = 0; cx < this.w; cx += CHUNK) {
        const geo = this.buildChunk(
          cx,
          cz,
          Math.min(CHUNK, this.w - cx),
          Math.min(CHUNK, this.d - cz),
        );
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.group.add(mesh);
      }
    }
  }

  private cellH(ix: number, iz: number): number {
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.d) return -4;
    return this.heights[iz * this.w + ix];
  }

  private buildChunk(cx: number, cz: number, cw: number, cd: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const seed = this.level.seed;

    const quad = (
      v: [number, number, number][],
      n: [number, number, number],
      color: number,
      shade: number,
    ): void => {
      const base = pos.length / 3;
      c.setHex(color);
      for (const p of v) {
        pos.push(p[0], p[1], p[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let iz = cz; iz < cz + cd; iz++) {
      for (let ix = cx; ix < cx + cw; ix++) {
        const h = this.cellH(ix, iz);
        const x0 = ix + this.ox;
        const z0 = iz + this.oz;
        const x1 = x0 + 1;
        const z1 = z0 + 1;
        const path = this.pathMask[iz * this.w + ix] === 1;
        const high = h > this.level.terrain.base + 3.5;
        const topList = path ? PALETTE.path : high ? PALETTE.grassDark : PALETTE.grassTop;
        const top = pickColor(topList, ix, iz, 0, seed);
        quad(
          [
            [x0, h, z1],
            [x1, h, z1],
            [x1, h, z0],
            [x0, h, z0],
          ],
          [0, 1, 0],
          top,
          1,
        );
        // Side faces where the neighbour is lower.
        const sides: [number, number, [number, number, number]][] = [
          [ix + 1, iz, [1, 0, 0]],
          [ix - 1, iz, [-1, 0, 0]],
          [ix, iz + 1, [0, 0, 1]],
          [ix, iz - 1, [0, 0, -1]],
        ];
        for (const [nx, nz, n] of sides) {
          const nh = this.cellH(nx, nz);
          if (nh >= h) continue;
          // Stack of half-block faces so the dirt reads as individual blocks.
          for (let y = h; y > nh; y -= STEP) {
            const y0 = Math.max(nh, y - STEP);
            const isTop = y === h;
            const steep = h - nh > 2.5;
            const list = isTop && !path ? PALETTE.grassDark : steep ? PALETTE.cliff : PALETTE.dirt;
            const color = pickColor(list, ix * 7 + n[0], Math.round(y * 2), iz * 7 + n[2], seed);
            const shade = n[0] !== 0 ? 0.82 : 0.9;
            let v: [number, number, number][];
            if (n[0] === 1)
              v = [
                [x1, y0, z1],
                [x1, y0, z0],
                [x1, y, z0],
                [x1, y, z1],
              ];
            else if (n[0] === -1)
              v = [
                [x0, y0, z0],
                [x0, y0, z1],
                [x0, y, z1],
                [x0, y, z0],
              ];
            else if (n[2] === 1)
              v = [
                [x0, y0, z1],
                [x1, y0, z1],
                [x1, y, z1],
                [x0, y, z1],
              ];
            else
              v = [
                [x1, y0, z0],
                [x0, y0, z0],
                [x0, y, z0],
                [x1, y, z0],
              ];
            quad(v, n, color, shade);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

export const clampToWorld = (v: number, half: number, margin: number): number =>
  clamp(v, -half + margin, half - margin);
