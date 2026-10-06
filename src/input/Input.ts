/**
 * Keyboard + mouse input with pointer lock. Gameplay code asks for actions
 * (isDown('sprint')) rather than raw keys so bindings live in one place.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'jump'
  | 'interact'
  | 'reload'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'pause'
  | 'debugCamera';

const BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  jump: ['Space'],
  interact: ['KeyE'],
  reload: ['KeyR'],
  slot1: ['Digit1', 'Numpad1'],
  slot2: ['Digit2', 'Numpad2'],
  slot3: ['Digit3', 'Numpad3'],
  pause: ['Escape', 'KeyP'],
  debugCamera: ['F9'],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  fireDown = false;
  firePressed = false;
  rightPressed = false;
  locked = false;
  /** Called when pointer lock is lost (used to open the pause menu). */
  onUnlock: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F9' || e.code === 'Space' || e.ctrlKey)
        e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => {
      this.down.clear();
      this.fireDown = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.fireDown = true;
        this.firePressed = true;
      } else if (e.button === 2) {
        this.rightPressed = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) {
        this.fireDown = false;
        this.onUnlock?.();
      }
    });
  }

  requestLock(): void {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Test/debug hook: press or release a key code programmatically. */
  simulate(code: string, down: boolean): void {
    if (down) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }

  isDown(a: Action): boolean {
    return BINDINGS[a].some((k) => this.down.has(k));
  }

  wasPressed(a: Action): boolean {
    return BINDINGS[a].some((k) => this.pressed.has(k));
  }

  /** Clears per-frame state. Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.firePressed = false;
    this.rightPressed = false;
  }
}
