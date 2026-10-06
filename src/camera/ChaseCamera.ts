import * as THREE from 'three';
import type { CameraContext, CameraMode } from './CameraMode';
import { TUNING } from '../config/tuning';
import { clamp, damp, DEG } from '../world/noise';
import { rayBox, type Collider } from '../world/Physics';

const C = TUNING.camera;

/**
 * Angled 3/4 chase camera (Zelda / Diablo style) with a slight over-the-shoulder
 * offset. Mouse X orbits, mouse Y tilts within a limited range. The view looks a
 * little shallower than its orbit angle so the crosshair reaches ahead of the
 * hero while the hero's full body stays in the lower part of the frame.
 */
export class ChaseCamera implements CameraMode {
  readonly id = 'chase';
  readonly selectable = true;
  yaw = 0;
  private orbit = C.defaultPitchDeg * DEG;
  private pivot = new THREE.Vector3();
  private dist: number = C.distance;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private tmpDir = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  private occluders = new Set<THREE.Object3D>();

  enter(ctx: CameraContext, from?: { yaw: number; pitch: number }): void {
    if (from) {
      this.yaw = from.yaw;
      this.orbit = clamp(from.pitch, C.minPitchDeg * DEG, C.maxPitchDeg * DEG);
    }
    this.snap(ctx);
  }

  exit(): void {
    this.recoilPitch = 0;
    this.recoilYaw = 0;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * C.sensitivity;
    this.orbit = clamp(this.orbit + dy * C.sensitivity, C.minPitchDeg * DEG, C.maxPitchDeg * DEG);
  }

  addRecoil(pitch: number, yaw: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  state(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.orbit };
  }

  snap(ctx: CameraContext): void {
    this.computePivot(ctx, this.pivot);
    this.dist = C.distance;
    this.place(ctx, 1);
  }

  update(dt: number, ctx: CameraContext): void {
    // Recoil springs back.
    const back = damp(C.recoilReturn, dt);
    this.recoilPitch -= this.recoilPitch * back;
    this.recoilYaw -= this.recoilYaw * back;
    const target = this.computePivot(ctx, this.tmpPos);
    this.pivot.lerp(target, damp(C.followLerp, dt));
    this.place(ctx, damp(10, dt));
  }

  private computePivot(ctx: CameraContext, out: THREE.Vector3): THREE.Vector3 {
    const t = ctx.target;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return out
      .copy(t.position)
      .setY(t.position.y + Math.min(C.height, t.height * 0.85))
      .addScaledVector(right, C.shoulderOffset);
  }

  private place(ctx: CameraContext, distLerp: number): void {
    const cam = ctx.camera;
    const yaw = this.yaw + this.recoilYaw;
    // Direction from pivot back toward the camera.
    const back = this.tmpDir.set(
      Math.sin(yaw) * Math.cos(this.orbit),
      Math.sin(this.orbit),
      Math.cos(yaw) * Math.cos(this.orbit),
    );
    let want = C.distance * (ctx.aiming ? C.aimZoom : 1);

    // Pull in when solid walls / terrain would block the view. Trees and props that
    // can fade are ignored here and faded instead.
    const hit = ctx.physics.raycast(this.pivot, back, want + C.collisionPadding, (c) => !!c.fade);
    if (hit) want = Math.max(C.minDistance, hit.t - C.collisionPadding);
    this.dist += (want - this.dist) * (want < this.dist ? 1 : distLerp);

    cam.position.copy(this.pivot).addScaledVector(back, this.dist);
    // Never dip under the terrain.
    const ground = ctx.physics.terrain.heightAt(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < ground) cam.position.y = ground;

    const lookPitch = this.orbit - C.aimTiltDeg * DEG - this.recoilPitch;
    const fwd = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(lookPitch),
      -Math.sin(lookPitch),
      -Math.cos(yaw) * Math.cos(lookPitch),
    );
    cam.lookAt(cam.position.clone().add(fwd));

    this.updateOccluders(ctx);
  }

  /** Fade anything fadeable between the camera and the hero's body. */
  private updateOccluders(ctx: CameraContext): void {
    this.occluders.clear();
    const cam = ctx.camera.position;
    const t = ctx.target.position;
    const points = [
      new THREE.Vector3(t.x, t.y + 0.4, t.z),
      new THREE.Vector3(t.x, t.y + ctx.target.height, t.z),
      this.pivot,
    ];
    const minX = Math.min(cam.x, t.x) - 1;
    const maxX = Math.max(cam.x, t.x) + 1;
    const minZ = Math.min(cam.z, t.z) - 1;
    const maxZ = Math.max(cam.z, t.z) + 1;
    const cands = ctx.physics.query(minX, minZ, maxX, maxZ).filter((c: Collider) => !!c.fade);
    for (const p of points) {
      const dir = p.clone().sub(cam);
      const len = dir.length();
      dir.divideScalar(len);
      for (const c of cands) {
        // Inflate a bit so canopies fade before they fully cover the hero.
        const box = {
          minX: c.minX - 0.4,
          minY: c.minY,
          minZ: c.minZ - 0.4,
          maxX: c.maxX + 0.4,
          maxY: c.maxY + 0.5,
          maxZ: c.maxZ + 0.4,
        };
        if (rayBox(cam, dir, box, len - 0.3)) this.occluders.add(c.fade!);
      }
    }
    ctx.setOccluders(this.occluders);
  }
}
