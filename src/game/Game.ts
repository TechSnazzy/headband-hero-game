import * as THREE from 'three';
import { Input } from '../input/Input';
import { CameraRig } from '../camera/CameraRig';
import { ChaseCamera } from '../camera/ChaseCamera';
import { CinematicCamera } from '../camera/CinematicCamera';
import { World } from '../world/World';
import { Hero } from '../player/Hero';
import type { LevelDef } from '../levels/types';
import { LEVEL_1 } from '../levels/level1';
import { Intro } from './Intro';
import { Effects } from '../fx/Effects';
import { NoiseBus } from '../ai/Noise';
import { WeaponSystem } from '../weapons/WeaponSystem';
import type { Targetable } from './combat';
import { Hud, type HudState } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { renderWeaponIcons } from '../ui/icons';
import { audio } from '../audio/Audio';
import { TUNING } from '../config/tuning';
import { settings } from '../config/settings';
import { PALETTE } from '../config/palette';
import { DEG } from '../world/noise';
import { AlertSystem } from '../ai/AlertSystem';
import type { AIContext } from '../ai/context';
import { EnemyManager } from '../enemies/EnemyManager';
import { Pickups } from './Pickups';
import { Interactions } from './Interactions';
import { takedownFor } from '../player/Takedown';
import type { Guard } from '../enemies/Guard';
import type { BuiltProp } from '../world/props';
import { Captives } from '../allies/Captives';
import { Extraction } from './Extraction';
import type { Collider } from '../world/Physics';

export type GameState = 'title' | 'intro' | 'playing' | 'paused' | 'won' | 'lost';
type Phase = 'approach' | 'rescue' | 'extract' | 'holdout' | 'done';

/** What a checkpoint restores. Guards reset; freed captives and ammo carry over. */
interface Checkpoint {
  id: string;
  x: number;
  z: number;
  yaw: number;
  weapons: ReturnType<WeaponSystem['snapshot']>;
  freed: string[];
  phase: Phase;
  health: number;
}

/** Top-level game: renderer, loop, state machine and the level-1 mission flow. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly fx: Effects;
  readonly noise = new NoiseBus();
  readonly hud: Hud;
  readonly menus: Menus;
  readonly alert = new AlertSystem();
  readonly interactions = new Interactions();
  /** Everything bullets can hit (enemies) plus friendlies for the crosshair tag. */
  readonly targets: Targetable[] = [];
  state: GameState = 'title';
  phase: Phase = 'approach';
  level: LevelDef = LEVEL_1;
  world!: World;
  hero!: Hero;
  rig!: CameraRig;
  weapons!: WeaponSystem;
  enemies!: EnemyManager;
  pickups!: Pickups;
  captives!: Captives;
  extraction!: Extraction;
  aiCtx!: AIContext;
  intro: Intro | null = null;
  private clock = new THREE.Clock();
  private camTarget = { position: new THREE.Vector3(), height: 1.9, facingYaw: 0 };
  private cinematic = new CinematicCamera();
  private interactPrompt: { text: string; progress: number } | null = null;
  private takedownT = 0;
  private heroDownT = -1;
  private holdT = 0;
  private reinforcementsSent = 0;
  private winT = -1;
  private pausedFrom: GameState = 'playing';
  private checkpoint: Checkpoint | null = null;
  private reached = new Set<string>();
  private heliCollider: Collider | null = null;
  private counted = new Set<object>();
  private stats = { start: 0, elapsed: 0, eliminations: 0, takedowns: 0, spotted: 0 };
  private lastAlertState = 'calm';
  private hintsShown = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
    this.fx = new Effects(this.scene);
    this.hud = new Hud(container, renderWeaponIcons(this.renderer));
    this.menus = new Menus(container, {
      play: () => this.play(),
      resume: () => this.resume(),
      retryCheckpoint: () => this.restart(true),
      restartLevel: () => this.restart(false),
      quitToTitle: () => this.quitToTitle(),
      settingsChanged: () => this.applySettings(),
    });
    this.input.onUnlock = () => {
      if (this.state === 'playing' || this.state === 'intro') this.pause();
    };
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'intro') this.intro?.skip();
      if (this.state === 'playing' || this.state === 'intro') this.input.requestLock();
    });
    addEventListener('resize', () => this.resize());
    this.loadLevel(this.level);
    this.applySettings();
    this.menus.show('title');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ================================================================ level lifecycle

  loadLevel(level: LevelDef): void {
    this.intro?.dispose();
    this.intro = null;
    this.extraction?.dispose();
    this.captives?.dispose();
    this.enemies?.clear();
    this.pickups?.clear();
    if (this.hero) this.scene.remove(this.hero.model.root);
    this.weapons?.reset();
    this.world?.dispose(this.scene);
    this.fx.clear();
    this.noise.clear();
    this.interactions.clear();
    this.targets.length = 0;
    this.counted.clear();
    this.heliCollider = null;

    this.world = new World(level, this.scene);
    this.fx.groundAt = (x, z) => this.world.terrain.heightAt(x, z);
    this.hero = new Hero(this.world.physics);
    this.scene.add(this.hero.model.root);
    this.hero.spawn(level.hero.x, level.hero.z, level.hero.yaw);

    this.camTarget.position = this.hero.position;
    this.rig = new CameraRig(this.world.physics, this.camTarget);
    this.rig.register(new ChaseCamera());
    this.rig.register(this.cinematic);
    this.rig.setMode('chase');
    this.rig.onModeChange = (id) => {
      if (this.state === 'playing') this.hud.toast(`Camera: ${id}`, 1.2);
    };

    this.weapons = new WeaponSystem({
      hero: this.hero,
      rig: this.rig,
      physics: this.world.physics,
      fx: this.fx,
      noise: this.noise,
      scene: this.scene,
      targets: () => this.targets,
      onHitMarker: (k) => this.hud.hitMarker(k),
    });

    this.pickups = new Pickups(this.scene, (x, z) => this.world.terrain.heightAt(x, z));
    this.pickups.onPickup = (m) => this.hud.toast(m, 1.8);
    for (const p of level.props) {
      if (p.type === 'ammo' || p.type === 'medkit' || p.type === 'rockPile')
        this.pickups.spawn(p.type, p.x, p.z);
    }

    this.alert.reset();
    this.aiCtx = {
      hero: this.hero,
      physics: this.world.physics,
      fx: this.fx,
      noise: this.noise,
      alert: this.alert,
      squad: () => this.enemies.all,
      damageHero: (amount, from) => this.damageHero(amount, from),
      dropLoot: (pos) => this.pickups.drop(pos),
      combatEnabled: true,
    };
    this.enemies = new EnemyManager(this.scene, this.aiCtx);
    this.enemies.spawnLevel(level);
    for (const g of this.enemies.guards) this.addTakedown(g);
    for (const p of this.world.props) if (p.def.type === 'ammoCrate') this.addCrate(p);

    this.captives = new Captives(level, this.scene, this.world.physics, this.world.grass);
    for (const i of this.captives.interactables()) this.interactions.add(i);
    this.captives.onFreed = (a) => {
      const n = this.captives.freedCount;
      this.hud.toast(`${a.def.name} freed! (${n}/${this.captives.total})`, 2.4);
      if (n >= this.captives.total) {
        this.phase = 'extract';
        this.extraction.call();
        this.hud.banner('ALL CAPTIVES FREED', 'Get to the chopper!');
        this.saveCheckpoint('freed');
      } else this.phase = 'rescue';
    };
    this.extraction = new Extraction(level, this.scene, this.world.terrain);

    this.phase = 'approach';
    this.holdT = TUNING.extraction.holdOutTime;
    this.reinforcementsSent = 0;
    this.winT = -1;
    this.heroDownT = -1;
    this.takedownT = 0;
    this.reached.clear();
    this.stats = { start: 0, elapsed: 0, eliminations: 0, takedowns: 0, spotted: 0 };
    this.lastAlertState = 'calm';
    this.hud.setCaptives(level.captives.map((c) => c.kind));
    this.rebuildTargets();
  }

  private addTakedown(g: Guard): void {
    this.interactions.add(
      takedownFor(g, this.noise, (hero, guard) => {
        // Short takedown animation: hero lunges at the guard.
        hero.frozen = true;
        hero.facingYaw = Math.atan2(
          -(guard.position.x - hero.position.x),
          -(guard.position.z - hero.position.z),
        );
        this.takedownT = 0.55;
        this.interactions.cooldown = TUNING.stealth.takedownCooldown;
        this.stats.takedowns++;
        this.hud.toast('Silent takedown', 1.4);
      }),
    );
  }

  /** Hold E to open an ammo crate (one use). */
  private addCrate(p: BuiltProp): void {
    let used = false;
    const pos = p.object.position.clone();
    const C = TUNING.crates;
    this.interactions.add({
      priority: 1,
      hold: C.openHold,
      range: 1.9,
      position: (out) => out.copy(pos),
      available: () => !used,
      prompt: () => 'Open ammo crate',
      complete: () => {
        used = true;
        const r = this.weapons.addAmmo('rifle', C.ammoRifle);
        const s = this.weapons.addAmmo('pistol', C.ammoPistol);
        const k = this.weapons.addRocks(C.rocks);
        audio.play('pickup');
        this.hud.toast(`Crate: +${r} rifle  +${s} pistol  +${k} rocks`, 2.2);
        const lid = p.object.children[0];
        if (lid) lid.scale.y = 0.75;
        this.fx.dust(pos.clone().setY(pos.y + 0.9), 5, 0xa07a48);
      },
    });
  }

  /** Bullets can hit enemies; allies are listed so the friendly indicator works. */
  private rebuildTargets(): void {
    this.targets.length = 0;
    this.targets.push(...this.enemies.targets());
    if (this.captives) this.targets.push(...this.captives.allies);
  }

  // ================================================================ state transitions

  private play(): void {
    audio.unlock();
    this.applySettings();
    this.input.requestLock();
    this.menus.show(null);
    this.startIntro();
  }

  /** Helicopter insertion cutscene. */
  startIntro(): void {
    const L = this.level;
    this.hero.spawn(L.hero.x, L.hero.z, L.hero.yaw);
    this.intro = new Intro(L, this.scene, this.hero, this.cinematic, this.world.terrain);
    this.rig.setMode('cinematic');
    this.rig.snap();
    this.state = 'intro';
    this.aiCtx.combatEnabled = false;
    this.hud.show(true);
    this.hud.cinematic(true);
    this.hud.banner(L.subtitle.toUpperCase(), L.name);
    audio.startLoop('heli', 0.5);
    audio.startLoop('ambience', 0.6);
    audio.startLoop('music', 0.5);
  }

  private beginPlay(): void {
    this.rig.setMode('chase');
    const chase = this.rig.mode as ChaseCamera;
    chase.yaw = this.hero.facingYaw;
    this.rig.snap();
    this.state = 'playing';
    this.aiCtx.combatEnabled = true;
    this.hud.show(true);
    this.hud.cinematic(false);
    if (!this.hintsShown && settings.showHints) {
      this.hud.setHints(this.level.hints);
      this.hintsShown = true;
    }
    if (!this.checkpoint) this.saveCheckpoint('lz');
  }

  private pause(): void {
    if (this.state !== 'playing' && this.state !== 'intro') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.menus.show('pause');
    audio.setLoopVolume('heli', 0);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.menus.show(null);
    this.state = this.pausedFrom;
    this.input.requestLock();
    this.clock.getDelta();
  }

  /** Reload the level; optionally continue from the last checkpoint. */
  private restart(fromCheckpoint: boolean): void {
    const cp = fromCheckpoint ? this.checkpoint : null;
    this.loadLevel(this.level);
    this.menus.show(null);
    this.input.requestLock();
    audio.unlock();
    if (cp) {
      this.hero.spawn(cp.x, cp.z, cp.yaw);
      this.weapons.restore(cp.weapons);
      this.hero.health = Math.max(60, cp.health);
      this.captives.restoreFreed(cp.freed, this.hero);
      this.phase = cp.phase;
      for (const id of this.level.checkpoints.map((c) => c.id)) {
        this.reached.add(id);
        if (id === cp.id) break;
      }
      if (cp.phase === 'extract' || cp.phase === 'holdout') {
        this.phase = 'extract';
        this.extraction.call();
      }
      this.checkpoint = cp;
      this.hud.toast(`Checkpoint: ${this.checkpointLabel(cp.id)}`, 2);
    } else {
      this.checkpoint = null;
    }
    audio.startLoop('ambience', 0.6);
    audio.startLoop('music', 0.5);
    this.beginPlay();
  }

  private quitToTitle(): void {
    this.input.exitLock();
    this.checkpoint = null;
    this.hintsShown = false;
    this.loadLevel(this.level);
    this.state = 'title';
    this.hud.show(false);
    this.menus.show('title');
    audio.stopLoop('heli');
    audio.stopLoop('music');
  }

  private applySettings(): void {
    audio.setVolume(settings.volume);
    audio.setMusicVolume(settings.music);
  }

  private checkpointLabel(id: string): string {
    if (id === 'freed') return 'Captives freed';
    return this.level.checkpoints.find((c) => c.id === id)?.label ?? id;
  }

  private saveCheckpoint(id: string): void {
    this.checkpoint = {
      id,
      x: this.hero.position.x,
      z: this.hero.position.z,
      yaw: this.hero.facingYaw,
      weapons: this.weapons.snapshot(),
      freed: this.captives.allies.filter((a) => a.state !== 'caged').map((a) => a.def.name),
      phase: this.phase,
      health: this.hero.health,
    };
    if (id !== 'lz') this.hud.toast(`Checkpoint: ${this.checkpointLabel(id)}`, 2);
  }

  // ================================================================ damage / death / win

  damageHero(amount: number, _from: THREE.Vector3): void {
    if (this.hero.dead || this.state !== 'playing' || this.winT >= 0) return;
    this.hero.damage(amount);
    this.hud.damageFlash();
    audio.play('hurt', { volume: 0.6 });
    if (this.hero.dead) {
      this.heroDownT = 0;
      this.hero.frozen = true;
    }
  }

  /** Stagger, topple, voxel puff, then the lose screen. */
  private updateHeroDown(dt: number): void {
    this.heroDownT += dt;
    const t = this.heroDownT;
    const root = this.hero.model.root;
    this.hero.lean = -Math.min(0.5, t * 2.5);
    if (t > 0.25) root.rotation.x = -(Math.min(1, (t - 0.25) / 0.35) ** 2) * 1.45;
    if (t > 0.8 && root.visible) {
      root.visible = false;
      this.fx.eliminate(
        this.hero.position.clone().setY(this.hero.position.y + 0.5),
        [...PALETTE.tankTop, ...PALETTE.pantsCamo, ...PALETTE.skin, ...PALETTE.headband],
        this.hero.position.y,
      );
      audio.play('eliminate');
    }
    if (t > 2.2) {
      this.heroDownT = -1;
      this.state = 'lost';
      this.aiCtx.combatEnabled = false;
      this.input.exitLock();
      this.hud.show(false);
      this.menus.show('lost');
      audio.play('lose');
      audio.stopLoop('music');
    }
  }

  private win(): void {
    this.phase = 'done';
    this.winT = 0;
    this.aiCtx.combatEnabled = false;
    this.hero.frozen = true;
    this.hero.model.root.visible = false;
    for (const a of this.captives.allies) {
      a.state = 'aboard';
      a.model.root.visible = false;
    }
    if (this.heliCollider) this.world.physics.remove(this.heliCollider);
    this.extraction.depart();
    this.rig.setMode('cinematic');
    const L = this.extraction.landPos;
    this.cinematic.eye.set(L.x + 14, L.y + 4, L.z + 12);
    this.cinematic.target.copy(L).setY(L.y + 2);
    this.rig.snap();
    this.hud.cinematic(true);
    this.hud.banner('MISSION COMPLETE', 'Extraction successful');
    audio.startLoop('heli', 0.7);
  }

  // ================================================================ frame

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.rig.resize();
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const input = this.input;
    input.pollGamepad(dt);
    // Gamepad Start toggles pause (keyboard Esc releases pointer lock, which pauses).
    if (input.wasPressedCode('Pad9')) {
      if (this.state === 'playing' || this.state === 'intro') this.pause();
      else if (this.state === 'paused') this.resume();
    }

    if (
      this.state === 'title' ||
      this.state === 'won' ||
      this.state === 'lost' ||
      this.state === 'paused'
    ) {
      // Menus are up: keep the world alive behind the panels but freeze gameplay.
      if (this.state !== 'paused') this.world.update(dt, this.hero.position);
      this.renderer.render(this.scene, this.rig.camera);
      input.endFrame();
      return;
    }

    if (this.intro) {
      this.intro.update(dt);
      const d = this.intro.heli.root.position.distanceTo(this.hero.position);
      audio.setLoopVolume('heli', Math.max(0, 0.7 - d / 120));
      if (this.state === 'intro') {
        if (input.wasPressed('jump') || input.firePressed) this.intro.skip();
        this.hero.updateScripted(dt);
        this.enemies.update(dt);
        if (this.intro.controlGiven) this.beginPlay();
      }
      if (this.intro.finished) {
        this.intro = null;
        audio.stopLoop('heli');
      }
    }

    if (this.state === 'playing') this.updatePlaying(dt);

    this.camTarget.height = this.hero.height;
    this.camTarget.facingYaw = this.hero.facingYaw;
    this.rig.aiming = this.hero.aiming;
    this.rig.update(dt);
    this.world.update(dt, this.hero.position);
    this.extraction.update(dt);
    this.fx.update(dt);
    audio.listener.copy(this.hero.position);
    audio.tick(dt);
    this.renderer.render(this.scene, this.rig.camera);
    input.endFrame();
  }

  private updatePlaying(dt: number): void {
    const input = this.input;
    const hero = this.hero;
    this.stats.elapsed += dt;

    // Win cinematic: chopper lifts off, then the end screen.
    if (this.winT >= 0) {
      this.winT += dt;
      const h = this.extraction.heli.root.position;
      this.cinematic.target.lerp(h.clone().setY(h.y + 1.5), 0.05);
      this.captives.update(dt, hero);
      this.enemies.update(dt);
      if (this.winT > 5.5) {
        this.state = 'won';
        this.input.exitLock();
        this.hud.show(false);
        this.menus.showWin({
          time: this.stats.elapsed,
          eliminations: this.stats.eliminations,
          takedowns: this.stats.takedowns,
          shots: this.weapons.stats.shots,
          hits: this.weapons.stats.hits,
          headshots: this.weapons.stats.headshots,
          timesSpotted: this.stats.spotted,
          rescued: this.captives.freedCount,
          total: this.captives.total,
          ghost: !this.alert.everAlerted,
        });
        audio.play('win');
        audio.stopLoop('heli');
        audio.stopLoop('music');
      }
      return;
    }

    if (input.active) this.rig.look(input.mouseDX, input.mouseDY);
    if (input.wasPressed('debugCamera')) this.rig.cycle();
    const intent = {
      x: (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0),
      z: (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0),
      sprint: input.isDown('sprint'),
      crouch: input.isDown('crouch'),
      jump: input.wasPressed('jump'),
    };
    const canFire = input.active && !hero.frozen;
    const fireInput = {
      fireDown: canFire && input.fireDown,
      firePressed: canFire && input.firePressed,
      reload: input.wasPressed('reload') || input.rightPressed,
      slot: input.wasPressed('slot1')
        ? 0
        : input.wasPressed('slot2')
          ? 1
          : input.wasPressed('slot3')
            ? 2
            : null,
      wheel: input.wheel,
    };
    this.rebuildTargets();
    if (this.takedownT > 0) {
      this.takedownT -= dt;
      hero.lean = 0.35 * Math.sin(Math.min(1, 1 - this.takedownT / 0.55) * Math.PI);
      if (this.takedownT <= 0) {
        hero.frozen = false;
        hero.lean = 0;
      }
    }
    if (this.heroDownT >= 0) this.updateHeroDown(dt);
    this.interactPrompt = this.interactions.update(dt, hero, input.isDown('interact'));
    if (!hero.dead)
      this.weapons.update(dt, fireInput, hero.crouching, hero.speed > 0.5, hero.sprinting);
    hero.aiming = this.weapons.aiming && !hero.dead;
    hero.update(dt, intent, this.rig.yaw);
    this.emitMovementNoise();
    this.enemies.update(dt);
    this.alert.update(dt, this.enemies.alertSources());
    this.pickups.update(dt, hero, this.weapons);
    this.captives.update(dt, hero);
    this.updateStats();
    this.updateMission(dt);
    this.updateHud(dt);
    audio.setLoopVolume('music', this.alert.state === 'alerted' ? 0.9 : 0.45);
  }

  private updateStats(): void {
    for (const e of this.enemies.all) {
      if (!e.alive && !this.counted.has(e)) {
        this.counted.add(e);
        this.stats.eliminations++;
      }
    }
    if (this.alert.state === 'alerted' && this.lastAlertState !== 'alerted') {
      this.stats.spotted++;
      this.hud.toast('You have been spotted!', 1.6);
    }
    this.lastAlertState = this.alert.state;
  }

  /** Objectives, checkpoints, extraction hold-out and reinforcements. */
  private updateMission(dt: number): void {
    const hero = this.hero;
    if (hero.dead) return;
    // Checkpoints along the route.
    for (const c of this.level.checkpoints) {
      if (this.reached.has(c.id)) continue;
      if (Math.hypot(hero.position.x - c.x, hero.position.z - c.z) < c.r) {
        this.reached.add(c.id);
        if (c.id !== 'lz') this.saveCheckpoint(c.id);
      }
    }
    if (this.phase === 'approach') {
      const near = this.captives.allies.some((a) => a.position.distanceTo(hero.position) < 30);
      if (near) {
        this.phase = 'rescue';
        this.hud.toast('Find the cages and free the captives', 2.5);
      }
    }

    const ex = this.extraction;
    const R = this.level.extraction.r;
    const dHero = Math.hypot(hero.position.x - ex.landPos.x, hero.position.z - ex.landPos.z);
    if (ex.state === 'landed' && !this.heliCollider) {
      const L = ex.landPos;
      this.heliCollider = this.world.physics.addBox(L.x, L.y, L.z, 2.6, 2.6, 2.6, { tag: 'heli' });
    }
    if (this.phase === 'extract') {
      const followers = this.captives.allies.filter(
        (a) => a.state === 'following' || a.state === 'freed',
      );
      const allHere = followers.every(
        (a) => Math.hypot(a.position.x - ex.landPos.x, a.position.z - ex.landPos.z) < R * 3,
      );
      if (dHero < R && (allHere || !TUNING.extraction.requireAllCaptives)) {
        this.phase = 'holdout';
        this.holdT = TUNING.extraction.holdOutTime;
        this.hud.banner('HOLD OUT', 'The chopper is warming up');
        // Allies board right away; the hero covers them.
        for (const a of followers) {
          a.state = 'boarding';
          a.boardTarget = ex.doorPoint(new THREE.Vector3());
        }
        // The chopper is loud: the camp comes running.
        for (const g of this.enemies.all) g.alarm(hero.position, false);
      }
    } else if (this.phase === 'holdout') {
      const near = dHero < R * 2.2;
      if (near && ex.state === 'landed') this.holdT -= dt;
      // Reinforcement waves.
      const H = TUNING.extraction.holdOutTime;
      const waves = [0.05, 0.35, 0.65];
      while (
        this.reinforcementsSent < waves.length &&
        this.holdT < H * (1 - waves[this.reinforcementsSent])
      ) {
        const spawns = this.level.reinforcements;
        for (let i = 0; i < 2; i++) {
          const [x, z] = spawns[(this.reinforcementsSent * 2 + i) % spawns.length];
          const g = this.enemies.spawnReinforcement(x + i, z, this.reinforcementsSent * 2 + i);
          this.addTakedown(g);
        }
        this.reinforcementsSent++;
        this.hud.toast('Enemy reinforcements incoming!', 1.8);
      }
      if (this.holdT <= 0 && near) this.win();
    }
  }

  private emitMovementNoise(): void {
    const h = this.hero;
    const N = TUNING.noise;
    if (h.footstep) {
      const r = h.crouching ? N.crouch : h.sprinting ? N.sprint : N.walk;
      this.noise.emit(h.position, r, h.sprinting ? 'sprint' : 'footstep');
      audio.play('footstep', {
        volume: h.crouching ? 0.15 : h.sprinting ? 0.5 : 0.3,
        rate: h.sprinting ? 1.2 : 1,
      });
    }
    if (h.jumped) audio.play('jump', { volume: 0.5 });
    if (h.landedHard) {
      this.noise.emit(h.position, N.jumpLand, 'jump');
      audio.play('land', { volume: 0.6 });
      this.fx.dust(h.position, 6);
    }
  }

  private objectiveText(): string {
    const O = this.level.objectives;
    switch (this.phase) {
      case 'approach':
        return O.reachCamp;
      case 'rescue':
        return O.freeCaptives
          .replace('{n}', String(this.captives.freedCount))
          .replace('{total}', String(this.captives.total));
      case 'holdout': {
        const R = this.level.extraction.r;
        const d = this.hero.position.distanceTo(this.extraction.landPos);
        if (this.extraction.state !== 'landed')
          return 'Hold the landing zone: the chopper is coming in';
        if (d > R * 2.2) return 'Get back to the chopper!';
        return O.holdOut.replace('{t}', String(Math.ceil(Math.max(0, this.holdT))));
      }
      case 'done':
        return 'Extraction successful';
      default:
        return O.extract;
    }
  }

  /** World point the HUD waypoint marker points at. */
  private waypointTarget(): THREE.Vector3 | null {
    switch (this.phase) {
      case 'approach':
        return new THREE.Vector3(0, 3, -32);
      case 'rescue': {
        const caged = this.captives.allies.filter((a) => a.state === 'caged');
        if (!caged.length) return null;
        caged.sort(
          (a, b) =>
            a.position.distanceTo(this.hero.position) - b.position.distanceTo(this.hero.position),
        );
        return caged[0].position.clone().setY(caged[0].position.y + 2.6);
      }
      case 'extract':
      case 'holdout':
        return this.extraction.landPos.clone().setY(this.extraction.landPos.y + 3);
      default:
        return null;
    }
  }

  private updateHud(dt: number): void {
    const w = this.weapons;
    const gun = w.gun;
    const kind = w.kind === 'pistol' ? 'pistol' : 'rifle';
    const fovHalf = (this.rig.camera.fov / 2) * DEG;
    const spreadPx = (Math.tan(w.crosshairSpread * DEG) / Math.tan(fovHalf)) * (innerHeight / 2);
    let waypoint: HudState['waypoint'] = null;
    const wt = this.waypointTarget();
    if (wt) {
      const p = wt.clone().project(this.rig.camera);
      const behind = p.z > 1;
      waypoint = {
        x: ((behind ? -p.x : p.x) * 0.5 + 0.5) * innerWidth,
        y: (-(behind ? -1 : p.y) * 0.5 + 0.5) * innerHeight,
        dist: Math.round(wt.distanceTo(this.hero.position)),
        behind,
      };
    }
    this.hud.update(dt, {
      health: this.hero.health,
      maxHealth: TUNING.player.maxHealth,
      slot: w.slot,
      mag: gun?.mag ?? 0,
      reserve: gun?.reserve ?? 0,
      magSize: TUNING.weapons[kind].magazine,
      rocks: w.rocks,
      isGun: w.isGun,
      reload: w.reloadProgress,
      spreadPx,
      friendly: w.friendlyUnderCrosshair,
      alert: this.alert.level,
      alertState: this.alert.state,
      rescued: this.captives.freedCount,
      freedMask: this.captives.allies.map((a) => a.state !== 'caged'),
      totalCaptives: this.captives.total,
      objective: this.objectiveText(),
      hidden: this.hero.hidden,
      crouching: this.hero.crouching,
      interact: this.interactPrompt,
      ammoLow: !!gun && gun.reserve + gun.mag < TUNING.weapons[kind].magazine,
      waypoint,
    });
  }
}
