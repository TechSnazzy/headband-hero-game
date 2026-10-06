import * as THREE from 'three';
import { PALETTE } from '../config/palette';

/**
 * Cartoon effects: voxel particles (sparks, debris, puffs, shells), tracers and
 * muzzle flashes. No blood or gore anywhere: hits produce sparks and cubes.
 */

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  size: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  grow: number; // size multiplier over life (puffs grow, sparks shrink)
  bounce: boolean;
  ground: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 2500;

export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private inst: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  private flashes: { obj: THREE.Object3D; life: number }[] = [];
  private flashLight = new THREE.PointLight(0xffc060, 0, 9, 2);
  private flashGeo = new THREE.BoxGeometry(1, 1, 1);
  private flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe08a,
    transparent: true,
    opacity: 0.95,
  });
  private flashMat2 = new THREE.MeshBasicMaterial({
    color: 0xff9a2a,
    transparent: true,
    opacity: 0.9,
  });
  private markers: { mesh: THREE.Mesh; life: number }[] = [];
  /** Ground height lookup so debris lands on the terrain. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const mat = new THREE.MeshLambertMaterial({ transparent: true });
    this.inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_PARTICLES);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    this.inst.castShadow = false;
    this.group.add(this.inst);
    this.group.add(this.flashLight);
  }

  private spawn(
    p: Partial<Omit<Particle, 'color' | 'pos'>> & { pos: THREE.Vector3; color: number },
  ): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      pos: p.pos.clone(),
      vel: p.vel ?? new THREE.Vector3(),
      rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      spin: p.spin ?? new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 0),
      size: p.size ?? 0.1,
      life: p.maxLife ?? 0.5,
      maxLife: p.maxLife ?? 0.5,
      color: new THREE.Color(p.color),
      gravity: p.gravity ?? 9.8,
      drag: p.drag ?? 0.5,
      grow: p.grow ?? 0,
      bounce: p.bounce ?? false,
      ground: p.ground ?? -1000,
    });
  }

  private rv(scale: number): THREE.Vector3 {
    return new THREE.Vector3(
      (Math.random() - 0.5) * scale,
      (Math.random() - 0.5) * scale,
      (Math.random() - 0.5) * scale,
    );
  }

  /** Cartoon hit sparks + a few voxel chips in the surface color. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, surfaceColor = 0x8a7a5a): void {
    for (let i = 0; i < 7; i++) {
      const v = normal
        .clone()
        .multiplyScalar(3 + Math.random() * 3)
        .add(this.rv(4));
      this.spawn({
        pos: point,
        vel: v,
        color: PALETTE.spark[i % 3],
        size: 0.06,
        maxLife: 0.22,
        gravity: 4,
        drag: 3,
      });
    }
    for (let i = 0; i < 4; i++) {
      const v = normal
        .clone()
        .multiplyScalar(2 + Math.random() * 2)
        .add(this.rv(3));
      v.y += 2;
      this.spawn({
        pos: point,
        vel: v,
        color: surfaceColor,
        size: 0.09 + Math.random() * 0.05,
        maxLife: 0.9,
        gravity: 14,
        drag: 0.6,
        bounce: true,
        ground: this.groundAt(point.x, point.z),
      });
    }
    this.spawn({
      pos: point,
      color: 0xd8d0c0,
      size: 0.25,
      maxLife: 0.45,
      gravity: -0.5,
      drag: 2,
      grow: 2.5,
    });
  }

  /** Character hit: bright cartoon spark star (no blood). */
  hitSpark(point: THREE.Vector3, dir: THREE.Vector3, headshot: boolean): void {
    const n = headshot ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(-2).add(this.rv(7));
      this.spawn({
        pos: point,
        vel: v,
        color: headshot ? 0xffffff : PALETTE.spark[i % 3],
        size: headshot ? 0.09 : 0.07,
        maxLife: 0.25,
        gravity: 2,
        drag: 4,
      });
    }
  }

  /** Elimination: a burst of voxel cubes in the character's colors + a white puff. */
  eliminate(center: THREE.Vector3, colors: number[], ground: number): void {
    for (let i = 0; i < 46; i++) {
      const v = this.rv(7);
      v.y = Math.abs(v.y) + 2.5;
      this.spawn({
        pos: center.clone().add(this.rv(0.8)),
        vel: v,
        color: colors[i % colors.length],
        size: 0.12 + Math.random() * 0.12,
        maxLife: 1.4 + Math.random() * 0.6,
        gravity: 13,
        drag: 0.6,
        bounce: true,
        ground,
      });
    }
    for (let i = 0; i < 14; i++) {
      const v = this.rv(3);
      v.y = Math.abs(v.y) * 0.6 + 0.5;
      this.spawn({
        pos: center.clone().add(this.rv(0.9)),
        vel: v,
        color: PALETTE.puff[i % 3],
        size: 0.35 + Math.random() * 0.25,
        maxLife: 0.8 + Math.random() * 0.4,
        gravity: -0.6,
        drag: 1.8,
        grow: 2.2,
      });
    }
  }

  /** Small dust puff (footfalls, rock impacts, landings). */
  dust(point: THREE.Vector3, amount = 6, color = 0xc8b48a): void {
    for (let i = 0; i < amount; i++) {
      const v = this.rv(2.5);
      v.y = Math.abs(v.y) * 0.8;
      this.spawn({
        pos: point,
        vel: v,
        color,
        size: 0.18,
        maxLife: 0.6,
        gravity: -0.3,
        drag: 2.5,
        grow: 2,
      });
    }
  }

  /** Ejected brass shell casing. */
  shell(pos: THREE.Vector3, right: THREE.Vector3): void {
    const v = right
      .clone()
      .multiplyScalar(2.2 + Math.random())
      .add(new THREE.Vector3(0, 2.4, 0))
      .add(this.rv(0.8));
    this.spawn({
      pos,
      vel: v,
      color: 0xd9a830,
      size: 0.045,
      maxLife: 1.2,
      gravity: 16,
      drag: 0.3,
      bounce: true,
      ground: this.groundAt(pos.x, pos.z),
    });
  }

  /** Thin glowing tracer from a to b. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, width = 0.035): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    const d = b.clone().sub(a);
    const len = d.length();
    // Short streak near the far end so it reads as a moving bullet.
    const streak = Math.min(len, 6);
    mesh.position.copy(a).addScaledVector(d, 1 - streak / len / 2);
    mesh.scale.set(width, width, streak);
    mesh.lookAt(b);
    this.group.add(mesh);
    this.tracers.push({ mesh, life: 0.07, maxLife: 0.07 });
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size = 1): void {
    const g = new THREE.Group();
    const a = new THREE.Mesh(this.flashGeo, this.flashMat);
    a.scale.set(0.16 * size, 0.16 * size, 0.38 * size);
    a.position.z = 0.15 * size;
    const b = new THREE.Mesh(this.flashGeo, this.flashMat2);
    b.scale.set(0.3 * size, 0.06 * size, 0.06 * size);
    b.rotation.z = Math.random() * Math.PI;
    g.add(a, b);
    g.position.copy(pos);
    g.lookAt(pos.clone().add(dir));
    this.group.add(g);
    this.flashes.push({ obj: g, life: 0.05 });
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 14 * size;
  }

  /** A floating marker (e.g. thrown rock target or noise ring). */
  ring(pos: THREE.Vector3, radius: number, color: number, life = 0.6): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.92, radius, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos).setY(pos.y + 0.08);
    this.group.add(mesh);
    this.markers.push({ mesh, life });
  }

  update(dt: number): void {
    const parts = this.particles;
    let w = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.bounce && p.pos.y < p.ground + p.size / 2) {
        p.pos.y = p.ground + p.size / 2;
        p.vel.y = Math.abs(p.vel.y) * 0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.spin.multiplyScalar(0.6);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      parts[w++] = p;
    }
    parts.length = w;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const t = 1 - p.life / p.maxLife;
      let s = p.size * (1 + p.grow * t);
      if (p.grow === 0 && t > 0.7) s *= 1 - (t - 0.7) / 0.3; // shrink out
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.setScalar(Math.max(0.001, s));
      this.dummy.updateMatrix();
      this.inst.setMatrixAt(i, this.dummy.matrix);
      this.inst.setColorAt(i, p.color);
    }
    this.inst.count = parts.length;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;

    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        this.group.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.obj);
        return false;
      }
      return true;
    });
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 300);
    this.markers = this.markers.filter((m) => {
      m.life -= dt;
      const mat = m.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, m.life) * 0.8;
      m.mesh.scale.multiplyScalar(1 + dt * 0.8);
      if (m.life <= 0) {
        this.group.remove(m.mesh);
        m.mesh.geometry.dispose();
        mat.dispose();
        return false;
      }
      return true;
    });
  }

  clear(): void {
    this.particles.length = 0;
    for (const t of this.tracers) this.group.remove(t.mesh);
    this.tracers.length = 0;
  }
}
