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
import { Hud } from '../ui/Hud';
import { renderWeaponIcons } from '../ui/icons';
import { audio } from '../audio/Audio';
import { TUNING } from '../config/tuning';
import { DEG } from '../world/noise';

export type GameState = 'title' | 'intro' | 'playing' | 'paused' | 'won' | 'lost';

/** Top-level game: renderer, loop, state machine and level lifecycle. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly fx: Effects;
  readonly noise = new NoiseBus();
  readonly hud: Hud;
  state: GameState = 'title';
  world!: World;
  hero!: Hero;
  rig!: CameraRig;
  weapons!: WeaponSystem;
  level: LevelDef = LEVEL_1;
  intro: Intro | null = null;
  /** Everything bullets can hit (enemies, allies). Filled by later systems. */
  readonly targets: Targetable[] = [];
  private clock = new THREE.Clock();
  private overlay: HTMLDivElement;
  private camTarget = { position: new THREE.Vector3(), height: 1.9, facingYaw: 0 };
  private cinematic = new CinematicCamera();

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

    this.overlay = document.createElement('div');
    this.overlay.className = 'click-overlay';
    this.overlay.textContent = 'Click to play';
    container.appendChild(this.overlay);
    this.overlay.addEventListener('click', () => this.onClickPlay());
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'intro') this.intro?.skip();
      this.input.requestLock();
    });

    addEventListener('resize', () => this.resize());
    this.loadLevel(this.level);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  loadLevel(level: LevelDef): void {
    this.world?.dispose(this.scene);
    this.noise.clear();
    this.targets.length = 0;
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
    this.hud.setHints(level.hints);
  }

  private onClickPlay(): void {
    this.input.requestLock();
    audio.unlock();
    if (this.state === 'title') this.startIntro();
  }

  /** Helicopter insertion cutscene. */
  startIntro(): void {
    this.intro?.dispose();
    const L = this.level;
    this.hero.spawn(L.hero.x, L.hero.z, L.hero.yaw);
    this.intro = new Intro(L, this.scene, this.hero, this.cinematic, this.world.terrain);
    this.rig.setMode('cinematic');
    this.rig.snap();
    this.state = 'intro';
    this.hud.show(true);
    this.hud.cinematic(true);
    this.hud.banner(L.subtitle.toUpperCase(), L.name);
    audio.startLoop('heli', 0.5);
    audio.startLoop('ambience', 0.6);
  }

  private endIntroControl(): void {
    this.rig.setMode('chase');
    const chase = this.rig.mode as ChaseCamera;
    chase.yaw = this.hero.facingYaw;
    this.rig.snap();
    this.state = 'playing';
    this.hud.cinematic(false);
    this.hud.setHints(this.level.hints);
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.rig.resize();
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const input = this.input;
    this.overlay.style.display = input.locked || this.state === 'intro' ? 'none' : 'flex';

    if (this.intro) {
      this.intro.update(dt);
      const d = this.intro.heli.root.position.distanceTo(this.hero.position);
      audio.setLoopVolume('heli', Math.max(0, 0.7 - d / 120));
      if (this.state === 'intro') {
        if (input.wasPressed('jump') || input.firePressed) this.intro.skip();
        this.hero.updateScripted(dt);
        if (this.intro.controlGiven) this.endIntroControl();
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
    this.fx.update(dt);
    audio.listener.copy(this.hero.position);
    audio.tick(dt);
    this.renderer.render(this.scene, this.rig.camera);
    input.endFrame();
  }

  private updatePlaying(dt: number): void {
    const input = this.input;
    if (input.locked) this.rig.look(input.mouseDX, input.mouseDY);
    if (input.wasPressed('debugCamera')) this.rig.cycle();
    const intent = {
      x: (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0),
      z: (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0),
      sprint: input.isDown('sprint'),
      crouch: input.isDown('crouch'),
      jump: input.wasPressed('jump'),
    };
    const hero = this.hero;
    const fireInput = {
      fireDown: input.locked && input.fireDown,
      firePressed: input.locked && input.firePressed,
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
    this.weapons.update(dt, fireInput, hero.crouching, hero.speed > 0.5, hero.sprinting);
    hero.aiming = this.weapons.aiming;
    hero.update(dt, intent, this.rig.yaw);
    this.emitMovementNoise();
    this.updateHud(dt);
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

  private updateHud(dt: number): void {
    const w = this.weapons;
    const gun = w.gun;
    const kind = w.kind === 'pistol' ? 'pistol' : 'rifle';
    const fovHalf = (this.rig.camera.fov / 2) * DEG;
    const spreadPx = (Math.tan(w.crosshairSpread * DEG) / Math.tan(fovHalf)) * (innerHeight / 2);
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
      alert: 0,
      alertState: 'calm',
      rescued: 0,
      totalCaptives: this.level.captives.length,
      objective: this.level.objectives.reachCamp,
      hidden: this.hero.hidden,
      crouching: this.hero.crouching,
      interact: null,
      ammoLow: !!gun && gun.reserve + gun.mag < TUNING.weapons[kind].magazine,
    });
  }
}
