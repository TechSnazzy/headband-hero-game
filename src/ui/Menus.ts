import { BASE_URL as BASE } from '../assets/loader';
import './menus.css';
import { settings, saveSettings } from '../config/settings';

export interface MenuActions {
  play(): void;
  resume(): void;
  retryCheckpoint(): void;
  restartLevel(): void;
  quitToTitle(): void;
  settingsChanged(): void;
}

export interface EndStats {
  time: number;
  eliminations: number;
  takedowns: number;
  shots: number;
  hits: number;
  headshots: number;
  timesSpotted: number;
  rescued: number;
  total: number;
  ghost: boolean;
}

const CONTROLS: [string, string][] = [
  ['Mouse', 'Look and aim'],
  ['W A S D', 'Move'],
  ['Left click', 'Fire / throw rock (hold for full auto)'],
  ['Right click / R', 'Reload'],
  ['Shift', 'Sprint (noisy)'],
  ['C / Ctrl', 'Crouch and sneak (quiet, hide in grass)'],
  ['Space', 'Hop (noisy)'],
  ['E (hold)', 'Free captives, open crates, silent takedown'],
  ['1 2 3 / wheel', 'Rifle, suppressed pistol, rocks'],
  ['Esc', 'Pause'],
];

/** Title, pause (with controls and settings), win and lose screens. */
export class Menus {
  private root: HTMLDivElement;
  private screens: Record<string, HTMLElement> = {};
  current: string | null = null;

  constructor(container: HTMLElement, actions: MenuActions) {
    const r = document.createElement('div');
    r.className = 'menus';
    const controlsTable = `<table class="controls">${CONTROLS.map(([k, v]) => `<tr><td><span class="key">${k}</span></td><td>${v}</td></tr>`).join('')}</table>`;
    const settingsHtml = `
      <div class="settings">
        <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-set="sensitivity" /></label>
        <label>Volume <input type="range" min="0" max="1" step="0.05" data-set="volume" /></label>
        <label>Music <input type="range" min="0" max="1" step="0.05" data-set="music" /></label>
        <label class="check"><input type="checkbox" data-set="invertY" /> Invert mouse Y</label>
        <label class="check"><input type="checkbox" data-set="aimAssist" /> Aim assist</label>
      </div>`;
    r.innerHTML = `
      <section class="screen title" data-screen="title">
        <div class="title-bg" style="background-image:url('${BASE}ui/key-art.jpg')"></div>
        <div class="title-panel">
          <img class="logo" src="${BASE}ui/logo.png" alt="Headband Hero" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />
          <h1 class="logo-text" style="display:none">HEADBAND<br/>HERO</h1>
          <p class="tagline">Sneak in. Free the captives. Get to the chopper.</p>
          <button data-act="play" class="primary">Play</button>
          <button data-act="controls">Controls</button>
          <button data-act="settings">Settings</button>
          <p class="small">Mouse + keyboard. Click Play to lock the pointer.</p>
        </div>
      </section>
      <section class="screen panel" data-screen="pause">
        <h2>Paused</h2>
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="controls">Controls</button>
        <button data-act="settings">Settings</button>
        <button data-act="retry">Restart from checkpoint</button>
        <button data-act="restart">Restart level</button>
        <button data-act="quit">Quit to title</button>
      </section>
      <section class="screen panel" data-screen="controls">
        <h2>Controls</h2>
        ${controlsTable}
        <button data-act="back" class="primary">Back</button>
      </section>
      <section class="screen panel" data-screen="settings">
        <h2>Settings</h2>
        ${settingsHtml}
        <button data-act="back" class="primary">Back</button>
      </section>
      <section class="screen panel end won" data-screen="won">
        <h2>Mission Complete</h2>
        <p class="sub" data-el="wonSub"></p>
        <div class="stats" data-el="wonStats"></div>
        <button data-act="restart" class="primary">Play again</button>
        <button data-act="quit">Title screen</button>
      </section>
      <section class="screen panel end lost" data-screen="lost">
        <h2>Eliminated</h2>
        <p class="sub">The hero burst into a puff of cubes. Try a quieter approach?</p>
        <button data-act="retry" class="primary">Retry from checkpoint</button>
        <button data-act="restart">Restart level</button>
        <button data-act="quit">Title screen</button>
      </section>
    `;
    container.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-screen]').forEach(
      (s) => (this.screens[s.dataset.screen!] = s),
    );
    let back = 'title';
    r.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      e.stopPropagation();
      switch (btn.dataset.act) {
        case 'play':
          actions.play();
          break;
        case 'resume':
          actions.resume();
          break;
        case 'retry':
          actions.retryCheckpoint();
          break;
        case 'restart':
          actions.restartLevel();
          break;
        case 'quit':
          actions.quitToTitle();
          break;
        case 'controls':
        case 'settings':
          back = this.current ?? 'title';
          this.show(btn.dataset.act);
          break;
        case 'back':
          this.show(back);
          break;
      }
    });
    // Settings inputs.
    r.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => {
      const key = inp.dataset.set as keyof typeof settings;
      if (inp.type === 'checkbox') inp.checked = settings[key] as boolean;
      else inp.value = String(settings[key]);
      inp.addEventListener('input', () => {
        (settings as unknown as Record<string, number | boolean>)[key] =
          inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        saveSettings();
        actions.settingsChanged();
      });
    });
  }

  show(name: string | null): void {
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('on', k === name);
    this.root.classList.toggle('on', name !== null);
  }

  showWin(s: EndStats): void {
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60)
      .toString()
      .padStart(2, '0');
    const rows: [string, string][] = [
      ['Time', `${m}:${sec}`],
      ['Soldiers rescued', `${s.rescued} / ${s.total}`],
      ['Eliminations', String(s.eliminations)],
      ['Silent takedowns', String(s.takedowns)],
      ['Accuracy', s.shots ? `${acc}% (${s.headshots} headshots)` : 'No shots fired'],
      ['Times spotted', String(s.timesSpotted)],
    ];
    this.screens.won.querySelector('[data-el="wonStats"]')!.innerHTML = rows
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    this.screens.won.querySelector('[data-el="wonSub"]')!.textContent = s.ghost
      ? 'GHOST: in and out without the camp ever raising the alarm.'
      : 'Everyone made it out. The jungle will remember this one.';
    this.show('won');
  }
}
