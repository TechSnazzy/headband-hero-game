import type * as THREE from 'three';
import type { Physics } from '../world/Physics';

/** What every camera mode is allowed to read about the world. */
export interface CameraContext {
  camera: THREE.PerspectiveCamera;
  physics: Physics;
  /** Hero feet position, body height, and current facing. */
  target: { position: THREE.Vector3; height: number; facingYaw: number };
  aiming: boolean;
  /** Fades objects between the camera and the hero. */
  setOccluders(objects: Set<THREE.Object3D>): void;
}

/**
 * A swappable camera behavior. Gameplay never talks to a mode directly: it asks
 * the CameraRig for the movement yaw and the aim ray, so new modes (top-down,
 * isometric, first-person, ...) can be added without touching gameplay code.
 */
export interface CameraMode {
  readonly id: string;
  /** Shown in the F9 debug cycle. Cinematic/internal modes set this false. */
  readonly selectable: boolean;
  /** Yaw used to make WASD camera-relative (radians, 0 = looking toward -Z). */
  readonly yaw: number;
  enter(ctx: CameraContext, from?: { yaw: number; pitch: number }): void;
  exit(): void;
  /** Mouse look in pixels. */
  look(dx: number, dy: number): void;
  addRecoil(pitch: number, yaw: number): void;
  update(dt: number, ctx: CameraContext): void;
  /** Jump straight to the resting position (after teleports / respawns). */
  snap(ctx: CameraContext): void;
  /** Orientation snapshot passed to the next mode on switch. */
  state(): { yaw: number; pitch: number };
}
