import * as THREE from 'three';
import { pickColor, type ColorList } from '../config/palette';

/**
 * Builds a single merged BufferGeometry out of colored boxes (vertex colors).
 * All voxel characters, props and weapons are made with this.
 */
export class VoxelBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];
  private tmp = new THREE.Color();
  private seed: number;
  private boxCount = 0;

  constructor(seed = 1) {
    this.seed = seed;
  }

  /**
   * Adds an axis-aligned box centered at (x, y, z) with size (w, h, d).
   * `shade` darkens the bottom faces slightly for a baked-light look.
   */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    shade = 0.12,
  ): this {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const c = this.tmp.setHex(color);
    // Faces: +x, -x, +y, -y, +z, -z
    const faces: [number[], number[][]][] = [
      [
        [1, 0, 0],
        [
          [hx, -hy, hz],
          [hx, -hy, -hz],
          [hx, hy, -hz],
          [hx, hy, hz],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [-hx, -hy, -hz],
          [-hx, -hy, hz],
          [-hx, hy, hz],
          [-hx, hy, -hz],
        ],
      ],
      [
        [0, 1, 0],
        [
          [-hx, hy, hz],
          [hx, hy, hz],
          [hx, hy, -hz],
          [-hx, hy, -hz],
        ],
      ],
      [
        [0, -1, 0],
        [
          [-hx, -hy, -hz],
          [hx, -hy, -hz],
          [hx, -hy, hz],
          [-hx, -hy, hz],
        ],
      ],
      [
        [0, 0, 1],
        [
          [-hx, -hy, hz],
          [hx, -hy, hz],
          [hx, hy, hz],
          [-hx, hy, hz],
        ],
      ],
      [
        [0, 0, -1],
        [
          [hx, -hy, -hz],
          [-hx, -hy, -hz],
          [-hx, hy, -hz],
          [hx, hy, -hz],
        ],
      ],
    ];
    for (const [n, verts] of faces) {
      const base = this.positions.length / 3;
      const k = n[1] < 0 ? 1 - shade * 2 : n[1] > 0 ? 1 : 1 - shade * (n[0] !== 0 ? 0.6 : 1);
      for (const v of verts) {
        this.positions.push(x + v[0], y + v[1], z + v[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.colors.push(c.r * k, c.g * k, c.b * k);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.boxCount++;
    return this;
  }

  /**
   * Fills the box (center x,y,z, size w,h,d) with voxels of size `v`, only emitting
   * the shell. Each voxel picks a color from `colors` (deterministic), giving the
   * pixel-camo look from the concept art.
   */
  shell(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    v: number,
    colors: ColorList | number | ((ix: number, iy: number, iz: number) => number),
  ): this {
    const nx = Math.max(1, Math.round(w / v));
    const ny = Math.max(1, Math.round(h / v));
    const nz = Math.max(1, Math.round(d / v));
    const sx = w / nx;
    const sy = h / ny;
    const sz = d / nz;
    const x0 = x - w / 2 + sx / 2;
    const y0 = y - h / 2 + sy / 2;
    const z0 = z - d / 2 + sz / 2;
    const s = this.seed + this.boxCount;
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++) {
          const surface =
            ix === 0 || iy === 0 || iz === 0 || ix === nx - 1 || iy === ny - 1 || iz === nz - 1;
          if (!surface) continue;
          const col =
            typeof colors === 'function' ? colors(ix, iy, iz) : pickColor(colors, ix, iy, iz, s);
          this.box(
            x0 + ix * sx,
            y0 + iy * sy,
            z0 + iz * sz,
            sx * 1.001,
            sy * 1.001,
            sz * 1.001,
            col,
            0.06,
          );
        }
      }
    }
    return this;
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  mesh(material: THREE.Material = voxelMaterial()): THREE.Mesh {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

let sharedMat: THREE.MeshLambertMaterial | null = null;

/** The shared vertex-colored material used by all voxel meshes. */
export function voxelMaterial(): THREE.MeshLambertMaterial {
  if (!sharedMat) sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return sharedMat;
}

/** A per-object clone of the voxel material so it can fade independently. */
export function fadeableVoxelMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, transparent: false });
}
