import './hud.css';

/**
 * DOM HUD layered over the canvas: crosshair, hit markers, ammo, reload ring,
 * hotbar, health, alert meter, rescued count, objective, prompts, hints, toasts.
 */

export interface HudState {
  health: number;
  maxHealth: number;
  slot: number;
  mag: number;
  reserve: number;
  magSize: number;
  rocks: number;
  isGun: boolean;
  reload: number; // -1 or 0..1
  spreadPx: number;
  friendly: string | null;
  alert: number; // 0..1 overall camp alert
  alertState: 'calm' | 'suspicious' | 'alerted' | 'searching';
  rescued: number;
  /** Which captives (in level order) are freed, for the portraits. */
  freedMask: boolean[];
  totalCaptives: number;
  objective: string;
  hidden: boolean;
  crouching: boolean;
  interact: { text: string; progress: number } | null;
  ammoLow: boolean;
  /** Objective marker in screen pixels (clamped to the screen edge when off-screen). */
  waypoint: { x: number; y: number; dist: number; behind: boolean } | null;
}

const BASE = import.meta.env.BASE_URL;

export class Hud {
  readonly root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private hitTimer = 0;
  private dmgTimer = 0;
  private toastTimer = 0;
  private hintIndex = -1;
  private hintTimer = 0;
  private hints: string[] = [];
  private lastSlot = -1;

  constructor(container: HTMLElement, icons: Record<'rifle' | 'pistol' | 'rocks', string>) {
    const r = document.createElement('div');
    r.className = 'hud hidden';
    r.innerHTML = `
      <div class="hud-vignette" data-el="vignette"></div>
      <div class="hud-dmg" data-el="dmg"></div>
      <div class="hud-top-left">
        <img class="hud-portrait" src="${BASE}ui/portrait-hero.png" alt="" />
        <div class="hud-health"><div class="hud-health-fill" data-el="healthFill"></div><span data-el="healthText">100</span></div>
        <div class="hud-stance" data-el="stance"></div>
      </div>
      <div class="hud-objective" data-el="objective"></div>
      <div class="hud-alert" data-el="alertBox">
        <div class="hud-alert-label" data-el="alertLabel">CALM</div>
        <div class="hud-alert-bar">${'<i></i>'.repeat(10)}</div>
      </div>
      <div class="hud-crosshair" data-el="crosshair">
        <i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i>
        <div class="hud-hitmarker" data-el="hitmarker"><i></i><i></i><i></i><i></i></div>
        <svg class="hud-reload" data-el="reload" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" /></svg>
      </div>
      <div class="hud-friendly" data-el="friendly"></div>
      <div class="hud-interact" data-el="interact"><span class="key">E</span><span data-el="interactText"></span><div class="hud-interact-bar"><div data-el="interactFill"></div></div></div>
      <div class="hud-hotbar" data-el="hotbar">
        ${(['rifle', 'pistol', 'rocks'] as const)
          .map(
            (k, i) =>
              `<div class="hud-slot" data-slot="${i}"><span class="key">${i + 1}</span><img src="${icons[k]}" alt="${k}" /><span class="count" data-el="count${i}"></span></div>`,
          )
          .join('')}
      </div>
      <div class="hud-ammo" data-el="ammo"><span class="mag" data-el="mag">30</span><span class="sep">/</span><span class="reserve" data-el="reserve">90</span><div class="hud-ammo-label" data-el="ammoLabel">RELOAD</div></div>
      <div class="hud-rescued" data-el="rescued">
        <span data-el="portraits"></span>
        <div><div class="label">RESCUED</div><div class="value" data-el="rescuedText">0 / 3</div></div>
      </div>
      <div class="hud-waypoint" data-el="waypoint"><i></i><span data-el="waypointText"></span></div>
      <div class="hud-hint" data-el="hint"></div>
      <div class="hud-toast" data-el="toast"></div>
      <div class="hud-banner" data-el="banner"><div class="t1" data-el="bannerT1"></div><div class="t2" data-el="bannerT2"></div></div>
    `;
    container.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.el[e.dataset.el!] = e));
  }

  /** Portraits for the rescued panel, in level captive order. */
  setCaptives(kinds: string[]): void {
    this.el.portraits.innerHTML = kinds
      .map((k) => `<img src="${BASE}ui/portrait-${k}.png" alt="" />`)
      .join('');
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Shows only the cinematic banner (intro) without the gameplay HUD. */
  cinematic(v: boolean): void {
    this.root.classList.toggle('cinematic', v);
  }

  setHints(h: string[]): void {
    this.hints = h;
    this.hintIndex = -1;
    this.hintTimer = 0.5;
  }

  hitMarker(kind: 'body' | 'head' | 'kill'): void {
    const m = this.el.hitmarker;
    m.className = `hud-hitmarker on ${kind}`;
    this.hitTimer = kind === 'kill' ? 0.35 : 0.18;
  }

  damageFlash(): void {
    this.dmgTimer = 0.4;
  }

  toast(text: string, seconds = 2.5): void {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastTimer = seconds;
  }

  banner(t1: string, t2: string): void {
    this.el.bannerT1.textContent = t1;
    this.el.bannerT2.textContent = t2;
    const b = this.el.banner;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  }

  update(dt: number, s: HudState): void {
    const e = this.el;
    // Health.
    const hp = Math.max(0, s.health / s.maxHealth);
    e.healthFill.style.width = `${hp * 100}%`;
    e.healthFill.className = `hud-health-fill ${hp < 0.3 ? 'low' : hp < 0.6 ? 'mid' : ''}`;
    e.healthText.textContent = String(Math.ceil(s.health));
    e.vignette.style.opacity = String(hp < 0.35 ? (0.35 - hp) * 2.4 : 0);
    e.stance.textContent = s.hidden ? 'HIDDEN' : s.crouching ? 'SNEAKING' : '';
    e.stance.className = `hud-stance ${s.hidden ? 'hidden-state' : ''}`;

    // Crosshair spread and friendly indicator.
    const sp = Math.round(4 + s.spreadPx);
    e.crosshair.style.setProperty('--spread', `${sp}px`);
    e.crosshair.classList.toggle('friendly', !!s.friendly);
    e.crosshair.classList.toggle('rocks', !s.isGun);
    e.friendly.textContent = s.friendly ? `FRIENDLY: ${s.friendly}` : '';
    e.friendly.classList.toggle('on', !!s.friendly);

    // Reload ring.
    const ring = e.reload as unknown as SVGElement;
    if (s.reload >= 0) {
      ring.classList.add('on');
      ring.style.setProperty('--p', String(s.reload));
    } else ring.classList.remove('on');

    // Ammo.
    if (s.isGun) {
      e.mag.textContent = String(s.mag);
      e.reserve.textContent = String(s.reserve);
      e.ammo.classList.remove('rocks');
    } else {
      e.mag.textContent = String(s.rocks);
      e.reserve.textContent = 'ROCKS';
      e.ammo.classList.add('rocks');
    }
    e.ammo.classList.toggle('low', s.isGun && s.mag <= Math.ceil(s.magSize * 0.25));
    e.ammoLabel.textContent =
      s.reload >= 0
        ? 'RELOADING'
        : s.isGun && s.mag === 0
          ? s.reserve > 0
            ? 'RELOAD [R]'
            : 'NO AMMO'
          : s.ammoLow
            ? 'LOW AMMO'
            : '';

    // Hotbar.
    if (s.slot !== this.lastSlot) {
      this.lastSlot = s.slot;
      e.hotbar
        .querySelectorAll('.hud-slot')
        .forEach((n, i) => n.classList.toggle('active', i === s.slot));
    }
    e.count2.textContent = String(s.rocks);

    // Alert meter.
    const lit = Math.round(s.alert * 10);
    e.alertBox.querySelectorAll('i').forEach((n, i) => n.classList.toggle('lit', i < lit));
    e.alertBox.className = `hud-alert ${s.alertState}`;
    e.alertLabel.textContent =
      s.alertState === 'alerted'
        ? 'ALERT'
        : s.alertState === 'suspicious'
          ? 'SUSPICIOUS'
          : s.alertState === 'searching'
            ? 'SEARCHING'
            : 'CALM';

    e.rescuedText.textContent = `${s.rescued} / ${s.totalCaptives}`;
    e.rescued
      .querySelectorAll('img')
      .forEach((img, i) => img.classList.toggle('freed', i < s.rescued));
    if (e.objective.textContent !== s.objective) e.objective.textContent = s.objective;

    // Objective waypoint.
    if (s.waypoint) {
      const m = 46;
      let { x, y } = s.waypoint;
      const off =
        s.waypoint.behind || x < m || x > innerWidth - m || y < m + 40 || y > innerHeight - m - 70;
      x = Math.min(innerWidth - m, Math.max(m, x));
      y = Math.min(innerHeight - m - 70, Math.max(m + 40, y));
      e.waypoint.style.transform = `translate(${x}px, ${y}px)`;
      e.waypoint.classList.add('on');
      e.waypoint.classList.toggle('edge', off);
      e.waypointText.textContent = `${s.waypoint.dist} m`;
    } else e.waypoint.classList.remove('on');

    // Interact prompt.
    if (s.interact) {
      e.interact.classList.add('on');
      e.interactText.textContent = s.interact.text;
      e.interactFill.style.width = `${Math.min(1, s.interact.progress) * 100}%`;
    } else e.interact.classList.remove('on');

    // Timers.
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) e.hitmarker.classList.remove('on');
    }
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      e.dmg.style.opacity = String(Math.max(0, this.dmgTimer / 0.4) * 0.7);
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) e.toast.classList.remove('on');
    }
    if (this.hints.length && this.hintIndex < this.hints.length) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.hintIndex++;
        if (this.hintIndex < this.hints.length) {
          e.hint.textContent = this.hints[this.hintIndex];
          e.hint.classList.add('on');
          this.hintTimer = 7;
        } else e.hint.classList.remove('on');
      }
    }
  }
}
