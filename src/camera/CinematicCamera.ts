import * as THREE from 'three';
import type { CameraContext, CameraMode } from './CameraMode';
import { damp, DEG } from '../world/noise';
import { TUNING } from '../config/tuning';

/**
 * Scripted camera for cutscenes (helicopter intro, extraction). Not part of the
 * F9 cycle. A script sets `eye` and `target` points each frame; the camera eases
 * toward them.
 */
export class CinematicCamera implements CameraMode {
  readonly id = 'cinematic';
  readonly selectable = false;
  yaw = 0;
  readonly eye = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  smoothing = 4;
  private curEye = new THREE.Vector3();
  private curLook = new THREE.Vector3();

  enter(ctx: CameraContext): void {
    this.snap(ctx);
  }

  exit(): void {}

  look(): void {}

  addRecoil(): void {}

  state(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: TUNING.camera.defaultPitchDeg * DEG };
  }

  snap(ctx: CameraContext): void {
    this.curEye.copy(this.eye);
    this.curLook.copy(this.target);
    this.apply(ctx);
  }

  update(dt: number, ctx: CameraContext): void {
    const k = damp(this.smoothing, dt);
    this.curEye.lerp(this.eye, k);
    this.curLook.lerp(this.target, k);
    this.apply(ctx);
  }

  private apply(ctx: CameraContext): void {
    ctx.camera.position.copy(this.curEye);
    ctx.camera.lookAt(this.curLook);
    const d = this.curLook.clone().sub(this.curEye);
    this.yaw = Math.atan2(-d.x, -d.z);
    ctx.setOccluders(new Set());
  }
}
