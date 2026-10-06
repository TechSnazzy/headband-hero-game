import * as THREE from 'three';
import type { CameraContext, CameraMode } from './CameraMode';
import type { Physics } from '../world/Physics';
import { TUNING } from '../config/tuning';
import { damp } from '../world/noise';

/**
 * Owns the Three.js camera and the active CameraMode. Gameplay code only uses
 * `yaw`, `aimRay()` and `addRecoil()`, never a specific mode.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private modes = new Map<string, CameraMode>();
  private active: CameraMode | null = null;
  private faded = new Map<THREE.Object3D, number>(); // object -> current opacity
  private wantFaded = new Set<THREE.Object3D>();
  private ctx: CameraContext;
  /** Optional callback when the mode changes (debug toast). */
  onModeChange: ((id: string) => void) | null = null;

  constructor(physics: Physics, target: CameraContext['target']) {
    this.camera = new THREE.PerspectiveCamera(
      TUNING.camera.fov,
      innerWidth / innerHeight,
      0.1,
      400,
    );
    this.ctx = {
      camera: this.camera,
      physics,
      target,
      aiming: false,
      setOccluders: (objs) => {
        this.wantFaded = new Set(objs);
      },
    };
  }

  register(mode: CameraMode): void {
    this.modes.set(mode.id, mode);
  }

  get mode(): CameraMode {
    return this.active!;
  }

  setMode(id: string): void {
    const next = this.modes.get(id);
    if (!next || next === this.active) return;
    const prev = this.active?.state();
    this.active?.exit();
    this.active = next;
    next.enter(this.ctx, prev);
    this.onModeChange?.(id);
  }

  /** F9: cycle through the selectable gameplay modes. */
  cycle(): void {
    const list = [...this.modes.values()].filter((m) => m.selectable);
    if (list.length < 2 || !this.active) return;
    const i = list.indexOf(this.active);
    this.setMode(list[(i + 1) % list.length].id);
  }

  get yaw(): number {
    return this.active?.yaw ?? 0;
  }

  set aiming(v: boolean) {
    this.ctx.aiming = v;
  }

  look(dx: number, dy: number): void {
    this.active?.look(dx, dy);
  }

  addRecoil(pitch: number, yaw: number): void {
    this.active?.addRecoil(pitch, yaw);
  }

  snap(): void {
    this.active?.snap(this.ctx);
  }

  update(dt: number): void {
    this.active?.update(dt, this.ctx);
    this.updateFades(dt);
  }

  /** Ray from the camera through the screen center (the crosshair). */
  aimRay(origin: THREE.Vector3, dir: THREE.Vector3): void {
    origin.copy(this.camera.position);
    this.camera.getWorldDirection(dir);
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private updateFades(dt: number): void {
    const k = damp(10, dt);
    for (const obj of this.wantFaded) if (!this.faded.has(obj)) this.faded.set(obj, 1);
    for (const [obj, op] of this.faded) {
      const target = this.wantFaded.has(obj) ? TUNING.camera.fadeOpacity : 1;
      const next = op + (target - op) * k;
      if (target === 1 && next > 0.98) {
        setOpacity(obj, 1);
        this.faded.delete(obj);
        continue;
      }
      this.faded.set(obj, next);
      setOpacity(obj, next);
    }
  }
}

function setOpacity(obj: THREE.Object3D, op: number): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.Material | undefined;
    if (!m || Array.isArray(m)) return;
    // Materials are shared between props; clone lazily the first time one fades.
    if (!mesh.userData.ownMaterial) {
      mesh.material = m.clone();
      mesh.userData.ownMaterial = true;
    }
    const own = mesh.material as THREE.Material;
    own.transparent = op < 1;
    own.opacity = op;
    own.depthWrite = op >= 1;
  });
}
