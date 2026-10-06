import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { Hero } from '../player/Hero';
import type { CameraRig } from '../camera/CameraRig';
import type { Physics } from '../world/Physics';
import type { Effects } from '../fx/Effects';
import type { NoiseBus } from '../ai/Noise';
import { raycastTargets, type Targetable } from '../game/combat';
import {
  buildPistol,
  buildRifle,
  buildRock,
  PISTOL_MUZZLE,
  RIFLE_EJECT,
  RIFLE_MUZZLE,
} from './models';
import { audio } from '../audio/Audio';
import { DEG, clamp } from '../world/noise';
import { PALETTE } from '../config/palette';
import { settings } from '../config/settings';

export type WeaponKind = 'rifle' | 'pistol' | 'rocks';
export const SLOTS: WeaponKind[] = ['rifle', 'pistol', 'rocks'];

type GunKind = 'rifle' | 'pistol';

interface GunState {
  mag: number;
  reserve: number;
}

export interface WeaponDeps {
  hero: Hero;
  rig: CameraRig;
  physics: Physics;
  fx: Effects;
  noise: NoiseBus;
  scene: THREE.Scene;
  targets: () => Iterable<Targetable>;
  onHitMarker: (kind: 'body' | 'head' | 'kill') => void;
}

export interface FireInput {
  fireDown: boolean;
  firePressed: boolean;
  reload: boolean;
  slot: number | null; // explicit slot request (0..2)
  wheel: number;
}

interface Rock {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  landed: boolean;
}

/** Hero weapons: rifle, suppressed pistol, throwable rocks. */
export class WeaponSystem {
  slot = 0;
  guns: Record<GunKind, GunState> = {
    rifle: { mag: TUNING.weapons.rifle.magazine, reserve: TUNING.weapons.rifle.reserveStart },
    pistol: { mag: TUNING.weapons.pistol.magazine, reserve: TUNING.weapons.pistol.reserveStart },
  };
  rocks: number = TUNING.weapons.rocks.count;
  reloading = 0; // seconds remaining
  reloadTotal = 0;
  spread = 0; // current extra spread in degrees (from firing)
  /** Last computed crosshair spread in degrees (for the HUD). */
  crosshairSpread = 1;
  /** Name of the friendly under the crosshair (or null). */
  friendlyUnderCrosshair: string | null = null;
  /** Seconds since the hero last fired (hero stays aimed for a moment). */
  sinceFire = 99;
  private cooldown = 0;
  private switchTime = 0;
  private throwTime = -1;
  private thrown = false;
  private rockList: Rock[] = [];
  private models: Record<WeaponKind, THREE.Object3D>;
  private backRifle: THREE.Object3D;
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  /** Shot statistics for the end screen. */
  readonly stats = { shots: 0, hits: 0, headshots: 0, rocks: 0 };
  /** Current aim point under the crosshair (world). */
  readonly aimPoint = new THREE.Vector3();

  constructor(private d: WeaponDeps) {
    this.models = { rifle: buildRifle('hero'), pistol: buildPistol(), rocks: buildRock(1.3) };
    this.backRifle = buildRifle('hero', false);
    // Slung diagonally across the back when another slot is equipped.
    this.backRifle.position.set(0, 0.32, 0.27);
    this.backRifle.rotation.set(0, Math.PI, 0.9);
    d.hero.model.torso.add(this.backRifle);
    this.equip(0, true);
  }

  get kind(): WeaponKind {
    return SLOTS[this.slot];
  }

  get isGun(): boolean {
    return this.kind !== 'rocks';
  }

  get gun(): GunState | null {
    return this.kind === 'rocks' ? null : this.guns[this.kind];
  }

  get reloadProgress(): number {
    return this.reloading > 0 ? 1 - this.reloading / this.reloadTotal : -1;
  }

  /** True while the hero should hold the weapon up and face the aim direction. */
  get aiming(): boolean {
    return this.sinceFire < 0.9 || this.throwTime >= 0;
  }

  equip(slot: number, force = false): void {
    if (!force && slot === this.slot) return;
    this.slot = slot;
    this.reloading = 0;
    this.d.hero.reloadT = -1;
    this.switchTime = force ? 0 : 0.3;
    const m = this.d.hero.model;
    m.handR.clear();
    if (this.kind === 'rifle') {
      m.setWeapon(
        this.models.rifle,
        new THREE.Vector3(0, -0.07, 0.08),
        new THREE.Vector3(0, -0.005, -0.22),
      );
    } else if (this.kind === 'pistol') {
      m.setWeapon(
        this.models.pistol,
        new THREE.Vector3(0, -0.04, 0.04),
        new THREE.Vector3(-0.04, -0.07, 0.02),
      );
    } else {
      m.setWeapon(null);
      const rock = this.models.rocks;
      rock.position.set(0, -0.05, -0.05);
      m.handR.add(rock);
    }
    this.backRifle.visible = this.kind !== 'rifle';
    if (!force) audio.play('switch');
  }

  addAmmo(kind: GunKind, amount: number): number {
    const max = TUNING.weapons[kind].reserveMax;
    const g = this.guns[kind];
    const before = g.reserve;
    g.reserve = Math.min(max, g.reserve + amount);
    return g.reserve - before;
  }

  addRocks(n: number): number {
    const before = this.rocks;
    this.rocks = Math.min(TUNING.weapons.rocks.max, this.rocks + n);
    return this.rocks - before;
  }

  /** Called every frame while playing. */
  update(
    dt: number,
    inp: FireInput,
    crouching: boolean,
    moving: boolean,
    sprinting: boolean,
  ): void {
    const hero = this.d.hero;
    this.cooldown -= dt;
    this.switchTime -= dt;
    this.sinceFire += dt;

    // Slot switching.
    let want: number | null = inp.slot;
    if (inp.wheel !== 0)
      want = (this.slot + (inp.wheel > 0 ? 1 : -1) + SLOTS.length) % SLOTS.length;
    if (want !== null && want !== this.slot && this.throwTime < 0) this.equip(want);

    this.updateAim();

    // Spread.
    const def = this.kind === 'pistol' ? TUNING.weapons.pistol : TUNING.weapons.rifle;
    this.spread = Math.max(0, this.spread - def.spreadRecover * dt);
    let base: number = def.spreadDeg;
    if (sprinting) base = def.spreadSprintDeg;
    else if (moving) base = def.spreadMoveDeg;
    if (crouching) base *= def.spreadCrouchMul;
    if (!hero.grounded) base = def.spreadSprintDeg;
    this.crosshairSpread = Math.min(def.spreadMaxDeg, base + this.spread);

    // Reload.
    if (this.reloading > 0) {
      this.reloading -= dt;
      hero.reloadT = this.reloadProgress;
      if (this.reloading <= 0) this.finishReload();
    } else hero.reloadT = -1;
    if (inp.reload) this.startReload();

    // Fire.
    if (this.kind === 'rocks') this.updateThrow(dt, inp);
    else if (this.switchTime <= 0 && this.reloading <= 0) {
      const auto = this.kind === 'rifle';
      if ((auto && inp.fireDown) || inp.firePressed) this.tryFire();
    }

    // Pose.
    if (this.kind === 'rifle') hero.pose = this.aiming && !sprinting ? 'rifleAim' : 'rifleLow';
    else if (this.kind === 'pistol') hero.pose = this.aiming && !sprinting ? 'pistol' : 'carryLow';
    else hero.pose = this.throwTime >= 0 ? 'throw' : 'none';

    this.updateRocks(dt);
  }

  /** Finds what is under the crosshair; sets aimPoint and the friendly indicator. */
  private updateAim(): void {
    const o = this.tmpO;
    const dir = this.tmpD;
    this.d.rig.aimRay(o, dir);
    // Start the ray at the hero's depth so things between camera and hero are ignored.
    const chest = this.d.hero.chestPoint(new THREE.Vector3());
    const tStart = Math.max(0, chest.clone().sub(o).dot(dir) - 0.6);
    const start = o.clone().addScaledVector(dir, tStart);
    const range = TUNING.weapons.rifle.range;
    const wh = this.d.physics.raycast(start, dir, range);
    const worldT = wh ? wh.t : range;
    const th = raycastTargets(this.d.targets(), start, dir, worldT, { includeFriendly: true });
    this.friendlyUnderCrosshair =
      th && th.target.friendly && th.t < TUNING.aimAssist.friendlyIndicatorRange
        ? (th.target.label ?? 'Friendly')
        : null;
    const enemyHit = raycastTargets(this.d.targets(), start, dir, worldT, {
      includeFriendly: false,
    });
    this.aimPoint.copy(start).addScaledVector(dir, enemyHit ? enemyHit.t : worldT);

    // Aim pitch for the arms (from shoulder height to the aim point).
    const hero = this.d.hero;
    const sh = hero.position.clone().setY(hero.position.y + 1.5);
    const to = this.aimPoint.clone().sub(sh);
    hero.aimPitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.9, 0.9);
  }

  private aimDirFromMuzzle(muzzle: THREE.Vector3, spreadDeg: number): THREE.Vector3 {
    const target = this.aimPoint.clone();
    // Aim assist: bend toward the nearest enemy near the crosshair.
    const A = TUNING.aimAssist;
    if (A.enabled && settings.aimAssist) {
      const o = new THREE.Vector3();
      const cd = new THREE.Vector3();
      this.d.rig.aimRay(o, cd);
      let best: THREE.Vector3 | null = null;
      let bestAng = A.radiusDeg * DEG;
      const p = new THREE.Vector3();
      for (const t of this.d.targets()) {
        if (!t.alive || t.friendly) continue;
        t.aimPoint(p);
        if (p.distanceTo(muzzle) > A.maxRange) continue;
        const ang = p.clone().sub(o).normalize().angleTo(cd);
        if (ang < bestAng && this.d.physics.lineOfSight(muzzle, p)) {
          bestAng = ang;
          best = p.clone();
        }
      }
      if (best) target.lerp(best, A.strength);
    }
    const dir = target.sub(muzzle).normalize();
    if (spreadDeg > 0) {
      // Random point in a cone.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spreadDeg * DEG;
      const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(dir, up).normalize();
      const v = new THREE.Vector3().crossVectors(dir, u).normalize();
      dir
        .addScaledVector(u, Math.cos(a) * r)
        .addScaledVector(v, Math.sin(a) * r)
        .normalize();
    }
    return dir;
  }

  private startReload(): void {
    const g = this.gun;
    if (!g || this.reloading > 0) return;
    const kind = this.kind as GunKind;
    if (g.mag >= TUNING.weapons[kind].magazine || g.reserve <= 0) return;
    this.reloadTotal = TUNING.weapons[kind].reloadTime;
    this.reloading = this.reloadTotal;
    audio.play('reload', { rate: 2.0 / this.reloadTotal });
  }

  private finishReload(): void {
    const g = this.gun;
    if (!g) return;
    const kind = this.kind as GunKind;
    const need = TUNING.weapons[kind].magazine - g.mag;
    const take = Math.min(need, g.reserve);
    g.mag += take;
    g.reserve -= take;
    this.reloading = 0;
  }

  private tryFire(): void {
    const g = this.gun!;
    const kind = this.kind as GunKind;
    const def = TUNING.weapons[kind];
    if (this.cooldown > 0) return;
    if (g.mag <= 0) {
      this.cooldown = 0.25;
      audio.play('empty');
      this.startReload();
      return;
    }
    // Hero turns to face the aim before the shot leaves.
    this.sinceFire = 0;
    this.d.hero.aiming = true;
    g.mag--;
    this.stats.shots++;
    this.cooldown = def.fireInterval;
    const hero = this.d.hero;
    hero.model.root.updateMatrixWorld(true);
    const mount = hero.model.weaponMount;
    const muzzle = mount.localToWorld((kind === 'rifle' ? RIFLE_MUZZLE : PISTOL_MUZZLE).clone());
    const dir = this.aimDirFromMuzzle(muzzle, this.crosshairSpread);
    this.spread = Math.min(def.spreadMaxDeg, this.spread + def.spreadPerShotDeg);

    const fx = this.d.fx;
    fx.muzzleFlash(muzzle, dir, kind === 'rifle' ? 1 : 0.45);
    if (kind === 'rifle') {
      const right = new THREE.Vector3(Math.cos(hero.facingYaw), 0, -Math.sin(hero.facingYaw));
      fx.shell(mount.localToWorld(RIFLE_EJECT.clone()), right);
    }
    this.d.rig.addRecoil(def.recoilPitch, (Math.random() - 0.5) * 2 * def.recoilYaw);
    audio.play(kind === 'rifle' ? 'rifle' : 'pistol', { volume: kind === 'rifle' ? 0.9 : 0.7 });
    const loud = kind === 'rifle';
    this.d.noise.emit(hero.position, TUNING.noise[def.noise], kind, true, loud);

    // Resolve the hit: world vs enemies (friendlies are ignored: bullets pass through).
    const range = def.range;
    const wh = this.d.physics.raycast(muzzle, dir, range);
    const worldT = wh ? wh.t : range;
    const th = raycastTargets(this.d.targets(), muzzle, dir, worldT, { includeFriendly: false });
    let end: THREE.Vector3;
    if (th) {
      end = th.point;
      const head = th.part === 'head';
      const dmg = def.damage * (head ? def.headshotMultiplier : 1);
      const wasAlive = th.target.alive;
      th.target.onHit(dmg, th.part, th.point, dir, !loud);
      fx.hitSpark(th.point, dir, head);
      const killed = wasAlive && !th.target.alive;
      this.stats.hits++;
      if (head) this.stats.headshots++;
      this.d.onHitMarker(killed ? 'kill' : head ? 'head' : 'body');
      audio.play(killed ? 'eliminate' : head ? 'headshot' : 'hit', { volume: 0.6 });
    } else if (wh) {
      end = wh.point;
      const surface = wh.collider ? 0x8a6238 : PALETTE.dirt[0];
      fx.impact(wh.point, wh.normal, surface);
      audio.play('bulletImpact', { pos: wh.point, volume: 0.5, maxDist: 30 });
      this.d.noise.emit(wh.point, TUNING.noise.bulletImpact, 'impact', true, false);
    } else {
      end = muzzle.clone().addScaledVector(dir, range);
    }
    if (kind === 'rifle' || Math.random() < 0.5)
      fx.tracer(muzzle, end, PALETTE.tracerHero, kind === 'rifle' ? 0.04 : 0.025);
  }

  private updateThrow(dt: number, inp: FireInput): void {
    const hero = this.d.hero;
    if (this.throwTime < 0) {
      hero.throwT = -1;
      if (inp.firePressed && this.rocks > 0 && this.cooldown <= 0 && this.switchTime <= 0) {
        this.throwTime = 0;
        this.thrown = false;
        this.sinceFire = 0;
      }
      return;
    }
    this.throwTime += dt;
    const T = 0.55;
    hero.throwT = Math.min(1, this.throwTime / T);
    this.sinceFire = 0;
    if (!this.thrown && this.throwTime > T * 0.6) {
      this.thrown = true;
      this.rocks--;
      this.stats.rocks++;
      this.spawnRock();
      audio.play('throw');
      if (this.rocks <= 0) hero.model.handR.clear();
    }
    if (this.throwTime > T) {
      this.throwTime = -1;
      hero.throwT = -1;
      this.cooldown = TUNING.weapons.rocks.cooldown;
      if (this.rocks > 0 && hero.model.handR.children.length === 0)
        hero.model.handR.add(this.models.rocks);
    }
  }

  private spawnRock(): void {
    const R = TUNING.weapons.rocks;
    const hero = this.d.hero;
    hero.model.root.updateMatrixWorld(true);
    const from = hero.model.handR.getWorldPosition(new THREE.Vector3());
    // Throw toward the aim point with a fixed arc speed.
    const to = this.aimPoint.clone().sub(from);
    const flat = new THREE.Vector3(to.x, 0, to.z);
    const dist = flat.length();
    flat.normalize();
    const speed = Math.min(R.throwSpeed, 6 + dist * 0.55);
    const vel = flat.multiplyScalar(speed);
    // Solve vertical speed so the rock lands near the target height.
    const tFlight = Math.max(0.3, dist / speed);
    vel.y = clamp((to.y + 0.5 * 18 * tFlight * tFlight) / tFlight, 1, 16);
    const mesh = buildRock(1.3);
    mesh.position.copy(from);
    this.d.scene.add(mesh);
    this.rockList.push({ mesh, vel, life: 8, landed: false });
  }

  private updateRocks(dt: number): void {
    const phys = this.d.physics;
    this.rockList = this.rockList.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        this.d.scene.remove(r.mesh);
        return false;
      }
      if (r.landed) return true;
      r.vel.y -= 18 * dt;
      const step = r.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit =
        len > 0 ? phys.raycast(r.mesh.position, step.clone().divideScalar(len), len) : null;
      if (hit) {
        r.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.08);
        r.landed = true;
        this.d.noise.emit(hit.point, TUNING.noise.rockImpact, 'rock', true, false);
        this.d.fx.dust(hit.point, 8);
        this.d.fx.ring(hit.point, TUNING.noise.rockImpact, 0xffffff, 0.8);
        audio.play('rockHit', { pos: hit.point, maxDist: 45 });
      } else {
        r.mesh.position.add(step);
        r.mesh.rotation.x += dt * 9;
        r.mesh.rotation.z += dt * 7;
      }
      return true;
    });
  }

  reset(): void {
    for (const r of this.rockList) this.d.scene.remove(r.mesh);
    this.rockList = [];
    this.reloading = 0;
    this.throwTime = -1;
    this.spread = 0;
    this.sinceFire = 99;
  }

  /** Snapshot for checkpoints. */
  snapshot(): { rifle: GunState; pistol: GunState; rocks: number } {
    return { rifle: { ...this.guns.rifle }, pistol: { ...this.guns.pistol }, rocks: this.rocks };
  }

  restore(s: { rifle: GunState; pistol: GunState; rocks: number }): void {
    this.guns.rifle = { ...s.rifle };
    this.guns.pistol = { ...s.pistol };
    this.rocks = s.rocks;
    this.reset();
    this.equip(0, true);
  }
}
