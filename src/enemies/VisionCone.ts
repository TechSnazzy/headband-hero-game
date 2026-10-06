import * as THREE from 'three';
import type { Physics } from '../world/Physics';
import type { AlertState } from '../ai/AlertSystem';

const RAYS = 14;

/**
 * Translucent vision fan drawn on the ground in front of a guard. Its edge is
 * clipped by walls/tents/rocks (a handful of rays, refreshed a few times a second).
 */
export class VisionCone {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private lengths = new Float32Array(RAYS + 1);
  private refresh = Math.random() * 0.2;
  private mat: THREE.MeshBasicMaterial;

  constructor(private fov: number) {
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array((RAYS + 2) * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Alpha fades from the guard toward the edge of the cone.
    const col = new Float32Array((RAYS + 2) * 4);
    for (let i = 0; i < RAYS + 2; i++) col.set(i === 0 ? [1, 1, 1, 0.75] : [1, 1, 1, 0.08], i * 4);
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const idx: number[] = [];
    for (let i = 0; i < RAYS; i++) idx.push(0, i + 2, i + 1);
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(
    dt: number,
    physics: Physics,
    origin: THREE.Vector3,
    yaw: number,
    range: number,
    state: AlertState,
    eyeY: number,
  ): void {
    this.refresh -= dt;
    const half = this.fov / 2;
    if (this.refresh <= 0) {
      this.refresh = 0.2;
      const o = new THREE.Vector3(origin.x, eyeY, origin.z);
      const d = new THREE.Vector3();
      for (let i = 0; i <= RAYS; i++) {
        const a = yaw - half + (i / RAYS) * this.fov;
        d.set(-Math.sin(a), 0, -Math.cos(a));
        const hit = physics.raycast(o, d, range);
        this.lengths[i] = hit ? hit.t : range;
      }
    }
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const y = 0.12;
    pos.setXYZ(0, origin.x, origin.y + y, origin.z);
    for (let i = 0; i <= RAYS; i++) {
      const a = yaw - half + (i / RAYS) * this.fov;
      const L = Math.min(this.lengths[i], range);
      pos.setXYZ(i + 1, origin.x - Math.sin(a) * L, origin.y + y, origin.z - Math.cos(a) * L);
    }
    pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
    const color =
      state === 'alerted'
        ? 0xff3a2a
        : state === 'suspicious' || state === 'searching'
          ? 0xffd23e
          : 0xffffff;
    this.mat.color.setHex(color);
    this.mat.opacity = state === 'alerted' ? 0.34 : state === 'unaware' ? 0.28 : 0.34;
  }
}

/** "?" / "!" icon floating above a guard. */
export class AlertIcon {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private last = '';

  constructor() {
    this.canvas.width = this.canvas.height = 64;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }),
    );
    this.sprite.scale.set(0.7, 0.7, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  set(state: AlertState, awareness: number): void {
    const key =
      state === 'unaware'
        ? awareness > 0.05
          ? `u${Math.round(awareness * 8)}`
          : ''
        : `${state}${state === 'suspicious' ? Math.round(awareness * 8) : ''}`;
    this.sprite.visible = key !== '';
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 64, 64);
    const alerted = state === 'alerted';
    const glyph = alerted ? '!' : '?';
    const col = alerted ? '#ff3a2a' : '#ffd23e';
    // Fill the glyph from the bottom by awareness while not yet alerted.
    g.font = '900 56px Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#1a1a1a';
    g.strokeText(glyph, 32, 34);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillText(glyph, 32, 34);
    const fill = alerted || state === 'searching' ? 1 : Math.min(1, awareness);
    g.save();
    g.beginPath();
    g.rect(0, 64 - 64 * fill, 64, 64 * fill);
    g.clip();
    g.fillStyle = col;
    g.fillText(glyph, 32, 34);
    g.restore();
    this.tex.needsUpdate = true;
  }
}
