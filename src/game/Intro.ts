import * as THREE from 'three';
import { Helicopter } from '../world/Helicopter';
import type { CinematicCamera } from '../camera/CinematicCamera';
import type { Hero } from '../player/Hero';
import type { LevelDef } from '../levels/types';
import type { Terrain } from '../world/Terrain';
import { clamp, smoothstep } from '../world/noise';

/**
 * Helicopter insertion: the chopper flies in over the misty ridge, hovers over the
 * landing zone, the hero fast-ropes down, and the chopper peels away.
 */
const T_ARRIVE = 7;
const T_ROPE = 7.8;
const T_LAND = 10;
const T_CONTROL = 10.8;
const T_GONE = 18;

export class Intro {
  readonly heli = new Helicopter();
  time = 0;
  /** True once the player has control (the chopper may still be flying away). */
  controlGiven = false;
  finished = false;
  private rope: THREE.Mesh;
  private from: THREE.Vector3;
  private drop: THREE.Vector3;
  private exit: THREE.Vector3;
  private ground: number;
  private tmp = new THREE.Vector3();
  private dropYaw: number;

  constructor(
    private level: LevelDef,
    private scene: THREE.Scene,
    private hero: Hero,
    private cam: CinematicCamera,
    terrain: Terrain,
  ) {
    this.from = new THREE.Vector3(...level.intro.from);
    this.drop = new THREE.Vector3(...level.intro.drop);
    this.exit = new THREE.Vector3(...level.intro.exit);
    this.ground = terrain.heightAt(level.hero.x, level.hero.z);
    scene.add(this.heli.root);
    const d = this.drop.clone().sub(this.from);
    this.dropYaw = Math.atan2(-d.x, -d.z);
    // Hover so the side door (right side) sits above the landing spot.
    this.rope = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 1, 0.06),
      new THREE.MeshLambertMaterial({ color: 0x5a4a30 }),
    );
    this.rope.visible = false;
    scene.add(this.rope);
    hero.frozen = true;
    hero.model.root.visible = false;
    this.place(0);
    cam.eye.copy(this.camEye(0));
    cam.target.copy(this.heli.root.position);
  }

  skip(): void {
    if (this.time < T_CONTROL) this.time = T_CONTROL - 0.01;
  }

  update(dt: number): void {
    this.time += dt;
    this.heli.update(dt);
    this.place(this.time);
    if (!this.controlGiven && this.time >= T_CONTROL) {
      this.controlGiven = true;
      this.hero.frozen = false;
      this.hero.model.root.visible = true;
      this.hero.pose = 'rifleLow';
      this.rope.visible = false;
    }
    if (this.time >= T_GONE && !this.finished) {
      this.finished = true;
      this.scene.remove(this.heli.root, this.rope);
    }
  }

  private camEye(t: number): THREE.Vector3 {
    const L = this.level.hero;
    const g = this.ground;
    // Start low on the ridge looking up at the chopper, end behind the hero.
    const start = new THREE.Vector3(L.x + 7, g + 1.6, L.z - 7);
    const end = new THREE.Vector3(L.x + 1.5, g + 4.2, L.z + 6.5);
    return start.lerp(end, smoothstep(T_ROPE, T_CONTROL, t));
  }

  private place(t: number): void {
    const heli = this.heli.root;
    const L = this.level.hero;
    // The door is on the chopper's right; offset so it is above the landing spot.
    const yaw = this.dropYaw;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const hover = this.drop.clone().addScaledVector(right, -this.heli.door.x);
    if (t < T_ARRIVE) {
      const k = smoothstep(0, T_ARRIVE, t);
      const e = 1 - Math.pow(1 - k, 2);
      heli.position.lerpVectors(this.from, hover, e);
      heli.rotation.set(
        -0.18 * (1 - k) + 0.12 * Math.sin(k * Math.PI) * (k > 0.8 ? 1 : 0),
        yaw,
        0.08 * Math.sin(t * 0.8),
      );
    } else if (t < T_CONTROL + 0.4) {
      heli.position.copy(hover);
      heli.position.y += Math.sin(t * 2) * 0.12;
      heli.rotation.set(0.04, yaw, Math.sin(t * 1.3) * 0.03);
    } else {
      const k = clamp((t - T_CONTROL - 0.4) / (T_GONE - T_CONTROL), 0, 1);
      const e = k * k;
      heli.position.lerpVectors(hover, this.exit, e);
      const d = this.exit.clone().sub(hover);
      const exitYaw = Math.atan2(-d.x, -d.z);
      heli.rotation.set(
        -0.25 * Math.min(1, k * 4),
        yaw + (exitYaw - yaw) * Math.min(1, k * 3),
        -0.2 * Math.min(1, k * 4),
      );
    }
    heli.updateMatrixWorld(true);

    // Hero: inside until the rope drops, slides down, lands.
    const door = this.heli.doorWorld(this.tmp);
    const heroModel = this.hero.model.root;
    if (t >= T_ROPE && t < T_CONTROL) {
      heroModel.visible = true;
      const k = smoothstep(T_ROPE, T_LAND, t);
      const y = door.y - 0.6 + (this.ground - (door.y - 0.6)) * k;
      this.hero.position.set(L.x, Math.max(this.ground, y), L.z);
      this.hero.facingYaw = L.yaw;
      this.hero.pose = t < T_LAND ? 'carryLow' : 'rifleLow';
      // Rope from the door to the ground.
      this.rope.visible = t < T_LAND + 0.4;
      const top = door.y;
      const bottom = this.ground;
      this.rope.position.set(L.x + 0.25, (top + bottom) / 2, L.z);
      this.rope.scale.y = Math.max(0.1, top - bottom);
    }

    // Camera script.
    if (!this.controlGiven) {
      this.cam.eye.copy(this.camEye(t));
      const lookHeli = heli.position.clone().add(new THREE.Vector3(0, 1.5, 0));
      const lookHero = new THREE.Vector3(L.x, this.ground + 1.4, L.z - 4);
      this.cam.target.lerpVectors(lookHeli, lookHero, smoothstep(T_ROPE + 0.5, T_CONTROL, t));
    }
  }

  get ropeActive(): boolean {
    return this.time >= T_ROPE && this.time < T_LAND;
  }

  dispose(): void {
    this.scene.remove(this.heli.root, this.rope);
  }
}
