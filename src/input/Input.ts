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
  forward: ['KeyW', 'ArrowUp', 'PadUp'],
  back: ['KeyS', 'ArrowDown', 'PadDown'],
  left: ['KeyA', 'ArrowLeft', 'PadLeft'],
  right: ['KeyD', 'ArrowRight', 'PadRight'],
  sprint: ['ShiftLeft', 'ShiftRight', 'Pad10'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight', 'Pad1'],
  jump: ['Space', 'Pad0'],
  interact: ['KeyE', 'Pad4', 'Pad5'],
  reload: ['KeyR', 'Pad2'],
  slot1: ['Digit1', 'Numpad1', 'Pad14'],
  slot2: ['Digit2', 'Numpad2', 'Pad12'],
  slot3: ['Digit3', 'Numpad3', 'Pad15'],
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
  /** True while a gamepad has been used recently (no pointer lock needed). */
  padActive = false;
  private padFire = false;
  private padY = false;
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

  /** Mouse/pad look and firing are live (pointer locked or using a gamepad). */
  get active(): boolean {
    return this.locked || this.padActive;
  }

  /**
   * Polls the first connected gamepad (standard mapping) and folds it into the
   * same action set as the keyboard. Call once per frame before reading input.
   */
  pollGamepad(dt: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    for (const k of [...this.down]) if (k.startsWith('Pad') && !pad) this.down.delete(k);
    if (!pad) {
      this.padActive = false;
      return;
    }
    const dead = 0.22;
    const set = (code: string, on: boolean): void => {
      if (on) {
        if (!this.down.has(code)) this.pressed.add(code);
        this.down.add(code);
        this.padActive = true;
      } else this.down.delete(code);
    };
    const [lx, ly, rx, ry] = pad.axes;
    set('PadLeft', lx < -0.35);
    set('PadRight', lx > 0.35);
    set('PadUp', ly < -0.35);
    set('PadDown', ly > 0.35);
    pad.buttons.forEach((b, i) => {
      if (i === 6 || i === 7 || i === 3) return;
      set(`Pad${i}`, b.pressed);
    });
    // Right stick looks around (scaled to feel like mouse pixels).
    const look = (v: number): number =>
      Math.abs(v) < dead ? 0 : Math.sign(v) * ((Math.abs(v) - dead) / (1 - dead)) ** 1.6;
    const lx2 = look(rx ?? 0);
    const ly2 = look(ry ?? 0);
    if (lx2 || ly2) this.padActive = true;
    this.mouseDX += lx2 * 900 * dt;
    this.mouseDY += ly2 * 600 * dt;
    // Right trigger fires, Y cycles equipment.
    const rt = (pad.buttons[7]?.value ?? 0) > 0.4;
    if (rt && !this.padFire) this.firePressed = true;
    if (rt || this.padFire) this.fireDown = rt;
    this.padFire = rt;
    const y = !!pad.buttons[3]?.pressed;
    if (y && !this.padY) this.wheel += 1;
    this.padY = y;
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

  wasPressedCode(code: string): boolean {
    return this.pressed.has(code);
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
