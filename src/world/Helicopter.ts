import * as THREE from 'three';
import { VoxelBuilder } from './voxel';
import { PALETTE } from '../config/palette';

/**
 * Voxel transport helicopter (neutral olive, no insignia). Front is -Z.
 * Used for the intro drop and the extraction pickup.
 */
export class Helicopter {
  readonly root = new THREE.Group();
  private rotor = new THREE.Group();
  private tailRotor = new THREE.Group();
  rotorSpeed = 28;
  /** Local position of the side door (rope / boarding point). */
  readonly door = new THREE.Vector3(1.25, 0.6, 0.2);

  constructor() {
    const b = PALETTE.heliBody;
    const d = PALETTE.heliDark;
    const v = new VoxelBuilder(77);
    // Cabin and nose.
    v.shell(0, 1.4, 0.4, 2.4, 2.0, 4.0, 0.4, b);
    v.shell(0, 1.2, -2.1, 2.0, 1.6, 1.2, 0.4, b);
    v.shell(0, 0.9, -3.0, 1.6, 1.0, 0.8, 0.4, b);
    // Canopy glass.
    v.box(0, 1.75, -2.35, 1.7, 0.75, 0.9, PALETTE.heliGlass);
    v.box(0, 1.4, -2.9, 1.3, 0.5, 0.6, PALETTE.heliGlass);
    v.box(1.02, 1.8, -1.6, 0.02, 0.6, 0.7, PALETTE.heliGlass);
    v.box(-1.02, 1.8, -1.6, 0.02, 0.6, 0.7, PALETTE.heliGlass);
    // Open side door (dark interior) on the right.
    v.box(1.21, 1.3, 0.3, 0.02, 1.4, 1.8, 0x1a1c1a);
    v.box(-1.21, 1.3, 0.3, 0.02, 1.4, 1.8, 0x1a1c1a);
    // Engine housing and rotor mast.
    v.shell(0, 2.65, 0.6, 1.4, 0.6, 2.2, 0.4, d);
    v.box(0, 3.1, 0.2, 0.3, 0.5, 0.3, d[0]);
    // Tail boom, fin and stabilizer.
    v.shell(0, 1.9, 3.6, 0.6, 0.6, 3.2, 0.3, b);
    v.shell(0, 2.3, 5.4, 0.3, 1.6, 0.8, 0.3, b);
    v.box(0, 1.9, 5.0, 2.0, 0.12, 0.6, b[1]);
    // Skids.
    for (const s of [-1, 1]) {
      v.box(s * 1.05, 0.08, 0.2, 0.16, 0.16, 4.2, d[1]);
      v.box(s * 1.05, 0.15, -1.95, 0.16, 0.16, 0.2, d[1]);
      v.box(s * 0.9, 0.35, -0.9, 0.12, 0.6, 0.12, d[0]);
      v.box(s * 0.9, 0.35, 1.3, 0.12, 0.6, 0.12, d[0]);
    }
    // Neutral identification panel (plain stripes, no insignia).
    v.box(0, 2.0, 2.6, 0.62, 0.12, 0.8, 0xd8c070);
    this.root.add(v.mesh());

    const rv = new VoxelBuilder(78);
    rv.box(0, 0, 0, 0.5, 0.15, 0.5, d[0]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      rv.box(
        Math.cos(a) * 3.3,
        0,
        Math.sin(a) * 3.3,
        Math.abs(Math.cos(a)) * 6.4 + 0.3,
        0.06,
        Math.abs(Math.sin(a)) * 6.4 + 0.3,
        d[1],
      );
    }
    const rotorMesh = rv.mesh();
    rotorMesh.castShadow = true;
    this.rotor.add(rotorMesh);
    this.rotor.position.set(0, 3.4, 0.2);
    this.root.add(this.rotor);

    const tv = new VoxelBuilder(79);
    tv.box(0, 0, 0, 0.06, 1.4, 0.18, d[1]);
    tv.box(0, 0, 0, 0.06, 0.18, 1.4, d[1]);
    this.tailRotor.add(tv.mesh());
    this.tailRotor.position.set(0.22, 2.4, 5.5);
    this.root.add(this.tailRotor);

    // Rotor blur disc (reads as spinning at speed).
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(6.6, 24),
      new THREE.MeshBasicMaterial({
        color: 0x222222,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(this.rotor.position);
    this.root.add(disc);
  }

  update(dt: number): void {
    this.rotor.rotation.y += this.rotorSpeed * dt;
    this.tailRotor.rotation.x += this.rotorSpeed * 1.5 * dt;
  }

  doorWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.root.localToWorld(out.copy(this.door));
  }
}
