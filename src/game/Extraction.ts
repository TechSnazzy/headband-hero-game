import * as THREE from 'three';
import { Helicopter } from '../world/Helicopter';
import type { LevelDef } from '../levels/types';
import type { Terrain } from '../world/Terrain';
import { smoothstep } from '../world/noise';

export type ChopperState = 'away' | 'arriving' | 'landed' | 'departing' | 'gone';

/**
 * Extraction chopper: flies in to the extraction clearing once everyone is free,
 * waits on the ground (with a green smoke marker), then lifts off with the team.
 */
export class Extraction {
  readonly heli = new Helicopter();
  state: ChopperState = 'away';
  readonly landPos: THREE.Vector3;
  private t = 0;
  private from: THREE.Vector3;
  private exit: THREE.Vector3;
  private smoke: THREE.Group;
  private puffs: { m: THREE.Mesh; t: number }[] = [];
  private puffGeo = new THREE.BoxGeometry(1, 1, 1);
  private puffMat = new THREE.MeshBasicMaterial({
    color: 0x7cff6a,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private ring: THREE.Mesh;
  private yaw: number;

  constructor(
    level: LevelDef,
    private scene: THREE.Scene,
    terrain: Terrain,
  ) {
    const e = level.extraction;
    this.landPos = new THREE.Vector3(e.x, terrain.heightAt(e.x, e.z), e.z);
    this.from = new THREE.Vector3(e.x - 70, this.landPos.y + 35, e.z - 50);
    this.exit = new THREE.Vector3(e.x - 30, this.landPos.y + 60, e.z - 120);
    const d = this.landPos.clone().sub(this.from);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.heli.root.visible = false;
    scene.add(this.heli.root);

    // Green smoke marker and a ground ring marking the extraction zone.
    this.smoke = new THREE.Group();
    this.smoke.position.copy(this.landPos);
    this.smoke.visible = false;
    scene.add(this.smoke);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(e.r - 0.3, e.r, 40),
      new THREE.MeshBasicMaterial({
        color: 0x8dff6a,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.1;
    this.smoke.add(this.ring);
  }

  /** Show the smoke marker and call the chopper in. */
  call(): void {
    if (this.state !== 'away') return;
    this.state = 'arriving';
    this.t = 0;
    this.heli.root.visible = true;
    this.smoke.visible = true;
  }

  depart(): void {
    if (this.state !== 'landed') return;
    this.state = 'departing';
    this.t = 0;
  }

  get markerVisible(): boolean {
    return this.smoke.visible;
  }

  /** World position of the side door (allies run here to board). */
  doorPoint(out: THREE.Vector3): THREE.Vector3 {
    this.heli.root.updateMatrixWorld(true);
    return this.heli.doorWorld(out).setY(this.landPos.y);
  }

  update(dt: number): void {
    this.t += dt;
    const h = this.heli.root;
    if (this.state !== 'away') this.heli.update(dt);
    if (this.state === 'arriving') {
      const T = 9;
      const k = smoothstep(0, T, this.t);
      const e = 1 - Math.pow(1 - k, 3);
      h.position.lerpVectors(this.from, this.landPos, e);
      h.rotation.set(-0.2 * (1 - k), this.yaw, 0);
      if (this.t >= T) {
        this.state = 'landed';
        h.position.copy(this.landPos);
      }
    } else if (this.state === 'landed') {
      h.position.copy(this.landPos);
      h.rotation.set(0, this.yaw, 0);
    } else if (this.state === 'departing') {
      const k = Math.min(1, this.t / 8);
      const up = this.landPos.clone().setY(this.landPos.y + 6);
      if (this.t < 2) h.position.lerpVectors(this.landPos, up, smoothstep(0, 2, this.t));
      else h.position.lerpVectors(up, this.exit, smoothstep(2, 8, this.t));
      h.rotation.set(-0.25 * Math.min(1, k * 3), this.yaw, 0);
      if (this.t > 8) this.state = 'gone';
    }

    // Smoke puffs.
    if (this.smoke.visible) {
      if (Math.random() < dt * 14) {
        const m = new THREE.Mesh(this.puffGeo, this.puffMat);
        m.position.set((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6);
        m.scale.setScalar(0.5);
        this.smoke.add(m);
        this.puffs.push({ m, t: 0 });
      }
      this.puffs = this.puffs.filter((p) => {
        p.t += dt;
        p.m.position.y += dt * 1.8;
        p.m.position.x += dt * 0.6;
        p.m.scale.setScalar(0.5 + p.t * 0.9);
        p.m.rotation.y += dt;
        if (p.t > 3.5) {
          this.smoke.remove(p.m);
          return false;
        }
        return true;
      });
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(this.t * 4) * 0.2;
    }
  }

  dispose(): void {
    this.scene.remove(this.heli.root, this.smoke);
  }
}
