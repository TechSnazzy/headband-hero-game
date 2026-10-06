import * as THREE from 'three';
import { Input } from '../input/Input';
import { CameraRig } from '../camera/CameraRig';
import { ChaseCamera } from '../camera/ChaseCamera';
import { World } from '../world/World';
import { Hero } from '../player/Hero';
import type { LevelDef } from '../levels/types';
import { LEVEL_1 } from '../levels/level1';
import { buildRifle } from '../weapons/models';
import { CinematicCamera } from '../camera/CinematicCamera';
import { Intro } from './Intro';

export type GameState = 'title' | 'intro' | 'playing' | 'paused' | 'won' | 'lost';

/** Top-level game: renderer, loop, state machine and level lifecycle. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  state: GameState = 'title';
  world!: World;
  hero!: Hero;
  rig!: CameraRig;
  level: LevelDef = LEVEL_1;
  private clock = new THREE.Clock();
  private overlay: HTMLDivElement;
  private camTarget = { position: new THREE.Vector3(), height: 1.9, facingYaw: 0 };
  private cinematic = new CinematicCamera();
  intro: Intro | null = null;

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
    this.world = new World(level, this.scene);
    this.hero = new Hero(this.world.physics);
    this.hero.model.setWeapon(buildRifle('hero'));
    this.scene.add(this.hero.model.root);
    this.hero.spawn(level.hero.x, level.hero.z, level.hero.yaw);

    this.camTarget.position = this.hero.position;
    this.rig = new CameraRig(this.world.physics, this.camTarget);
    this.rig.register(new ChaseCamera());
    this.rig.register(this.cinematic);
    this.rig.setMode('chase');
  }

  private onClickPlay(): void {
    this.input.requestLock();
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
  }

  private endIntroControl(): void {
    this.rig.setMode('chase');
    const chase = this.rig.mode as ChaseCamera;
    chase.yaw = this.hero.facingYaw;
    this.rig.snap();
    this.state = 'playing';
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
      if (this.state === 'intro') {
        if (input.wasPressed('jump') || input.firePressed) this.intro.skip();
        this.hero.updateScripted(dt);
        if (this.intro.controlGiven) this.endIntroControl();
      }
      if (this.intro.finished) this.intro = null;
    }

    if (this.state === 'playing') {
      if (input.locked) this.rig.look(input.mouseDX, input.mouseDY);
      if (input.wasPressed('debugCamera')) this.rig.cycle();
      const intent = {
        x: (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0),
        z: (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0),
        sprint: input.isDown('sprint'),
        crouch: input.isDown('crouch'),
        jump: input.wasPressed('jump'),
      };
      this.hero.aiming = input.fireDown;
      this.hero.pose = this.hero.aiming ? 'rifleAim' : 'rifleLow';
      this.hero.update(dt, intent, this.rig.yaw);
    }

    this.camTarget.height = this.hero.height;
    this.camTarget.facingYaw = this.hero.facingYaw;
    this.rig.aiming = this.hero.aiming;
    this.rig.update(dt);
    this.world.update(dt, this.hero.position);
    this.renderer.render(this.scene, this.rig.camera);
    input.endFrame();
  }
}
