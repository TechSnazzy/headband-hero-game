import * as THREE from 'three';

/**
 * WebAudio sound manager. Each sound tries a generated sample from
 * public/audio/<name>.mp3 first (see ASSETS.md) and falls back to a small
 * procedural synth so the game always has audio.
 */

export type SoundName =
  | 'rifle'
  | 'pistol'
  | 'enemyRifle'
  | 'sniper'
  | 'reload'
  | 'empty'
  | 'hit'
  | 'headshot'
  | 'eliminate'
  | 'alert'
  | 'suspicious'
  | 'footstep'
  | 'jump'
  | 'land'
  | 'throw'
  | 'rockHit'
  | 'takedown'
  | 'pickup'
  | 'freed'
  | 'hurt'
  | 'bark'
  | 'ui'
  | 'switch'
  | 'win'
  | 'lose'
  | 'bulletImpact';

export type LoopName = 'heli' | 'ambience' | 'music';

/** Files present in public/audio (kept in sync with ASSETS.md). */
const SAMPLE_FILES: Partial<Record<SoundName | LoopName, string>> = {};

export function registerSamples(map: Partial<Record<SoundName | LoopName, string>>): void {
  Object.assign(SAMPLE_FILES, map);
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private noiseBuf: AudioBuffer | null = null;
  private loops = new Map<
    LoopName,
    { src: AudioBufferSourceNode | OscillatorNode[]; gain: GainNode }
  >();
  readonly listener = new THREE.Vector3();
  volume = 0.8;
  musicVolume = 0.35;
  muted = false;
  private lastPlay = new Map<string, number>();

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void this.loadSamples();
  }

  private async loadSamples(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      Object.entries(SAMPLE_FILES).map(async ([name, file]) => {
        try {
          const res = await fetch(`${base}audio/${file}`);
          if (!res.ok) return;
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, buf);
        } catch {
          // Missing or undecodable sample: synth fallback is used.
        }
      }),
    );
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** Plays a one-shot. `pos` gives distance falloff and stereo pan relative to the listener. */
  play(
    name: SoundName,
    opts: { pos?: THREE.Vector3; volume?: number; rate?: number; maxDist?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    // Avoid stacking identical sounds in the same few milliseconds.
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.025) return;
    this.lastPlay.set(name, now);

    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.pos) {
      const d = opts.pos.distanceTo(this.listener);
      const maxD = opts.maxDist ?? 60;
      if (d > maxD) return;
      vol *= Math.max(0, 1 - d / maxD) ** 1.5;
      pan = Math.max(-1, Math.min(1, (opts.pos.x - this.listener.x) / 20));
    }
    if (vol < 0.01) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.6;
    out.connect(panner).connect(this.sfx);

    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
      src.connect(out);
      src.start();
      return;
    }
    this.synth(name, out, opts.rate ?? 1);
  }

  private noise(
    dest: AudioNode,
    t0: number,
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    freq: number,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5, dur + 0.05);
  }

  private tone(
    dest: AudioNode,
    t0: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    f0: number,
    f1 = f0,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private synth(name: SoundName, out: AudioNode, rate: number): void {
    const t = this.ctx!.currentTime;
    switch (name) {
      case 'rifle':
        this.noise(out, t, 0.22, 1.0, 'lowpass', 2600 * rate);
        this.tone(out, t, 0.12, 0.8, 'square', 140, 45);
        this.noise(out, t + 0.02, 0.35, 0.25, 'bandpass', 600, 0.8);
        break;
      case 'enemyRifle':
        this.noise(out, t, 0.2, 0.8, 'lowpass', 1800);
        this.tone(out, t, 0.1, 0.5, 'square', 110, 40);
        break;
      case 'sniper':
        this.noise(out, t, 0.5, 1.0, 'lowpass', 1500);
        this.tone(out, t, 0.25, 0.8, 'sawtooth', 90, 30);
        break;
      case 'pistol':
        // Suppressed: soft thump plus a quick high "pfft".
        this.noise(out, t, 0.08, 0.55, 'bandpass', 1400, 1.5);
        this.tone(out, t, 0.06, 0.35, 'sine', 220, 80);
        break;
      case 'reload':
        this.tone(out, t, 0.04, 0.35, 'square', 900, 600);
        this.noise(out, t + 0.5, 0.05, 0.4, 'highpass', 3000);
        this.tone(out, t + 1.3, 0.05, 0.4, 'square', 700, 1100);
        this.noise(out, t + 1.6, 0.06, 0.5, 'highpass', 2500);
        break;
      case 'empty':
        this.tone(out, t, 0.03, 0.3, 'square', 1200, 900);
        break;
      case 'hit':
        this.tone(out, t, 0.08, 0.35, 'square', 1500, 1900);
        break;
      case 'headshot':
        this.tone(out, t, 0.06, 0.4, 'square', 1800, 2400);
        this.tone(out, t + 0.06, 0.1, 0.35, 'square', 2400, 3000);
        break;
      case 'eliminate':
        // Cartoon "pop" + sparkle.
        this.tone(out, t, 0.12, 0.6, 'sine', 300, 900);
        this.noise(out, t, 0.25, 0.35, 'highpass', 2000);
        this.tone(out, t + 0.08, 0.15, 0.25, 'triangle', 1400, 2200);
        break;
      case 'alert':
        this.tone(out, t, 0.12, 0.5, 'sawtooth', 600, 900);
        this.tone(out, t + 0.12, 0.25, 0.5, 'sawtooth', 900, 1300);
        break;
      case 'suspicious':
        this.tone(out, t, 0.18, 0.3, 'triangle', 500, 750);
        break;
      case 'footstep':
        this.noise(out, t, 0.07, 0.25, 'lowpass', 500 * rate);
        break;
      case 'jump':
        this.noise(out, t, 0.1, 0.3, 'lowpass', 700);
        break;
      case 'land':
        this.noise(out, t, 0.15, 0.55, 'lowpass', 400);
        this.tone(out, t, 0.1, 0.3, 'sine', 120, 50);
        break;
      case 'throw':
        this.noise(out, t, 0.18, 0.3, 'bandpass', 900, 2);
        break;
      case 'rockHit':
        this.tone(out, t, 0.06, 0.5, 'square', 380, 200);
        this.noise(out, t, 0.12, 0.45, 'bandpass', 1200, 2);
        this.tone(out, t + 0.12, 0.05, 0.25, 'square', 330, 200);
        break;
      case 'takedown':
        this.noise(out, t, 0.12, 0.5, 'lowpass', 600);
        this.tone(out, t, 0.15, 0.4, 'sine', 200, 70);
        break;
      case 'pickup':
        this.tone(out, t, 0.07, 0.3, 'square', 700, 700);
        this.tone(out, t + 0.07, 0.12, 0.3, 'square', 1050, 1050);
        break;
      case 'freed':
        this.tone(out, t, 0.12, 0.35, 'triangle', 523, 523);
        this.tone(out, t + 0.12, 0.12, 0.35, 'triangle', 659, 659);
        this.tone(out, t + 0.24, 0.25, 0.35, 'triangle', 784, 784);
        break;
      case 'hurt':
        this.tone(out, t, 0.12, 0.4, 'sawtooth', 220, 110);
        break;
      case 'bark':
        this.tone(out, t, 0.08, 0.5, 'sawtooth', 500, 260);
        this.tone(out, t + 0.16, 0.08, 0.5, 'sawtooth', 520, 270);
        break;
      case 'ui':
        this.tone(out, t, 0.05, 0.2, 'square', 880, 880);
        break;
      case 'switch':
        this.tone(out, t, 0.04, 0.25, 'square', 600, 400);
        this.noise(out, t + 0.05, 0.04, 0.3, 'highpass', 3000);
        break;
      case 'bulletImpact':
        this.noise(out, t, 0.06, 0.3, 'bandpass', 2500, 1.5);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone(out, t + i * 0.14, 0.3, 0.35, 'square', f, f),
        );
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(out, t + i * 0.18, 0.35, 0.35, 'triangle', f, f * 0.98),
        );
        break;
    }
  }

  /** Looping ambience / helicopter / music. */
  startLoop(name: LoopName, volume = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || this.loops.has(name)) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.2);
    gain.connect(name === 'music' ? this.musicGain : this.sfx);
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.loops.set(name, { src, gain });
      return;
    }
    if (name === 'heli') {
      // Rotor chop: noise through a filter, amplitude-modulated.
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      src.connect(f).connect(am).connect(gain);
      src.start();
      lfo.start();
      this.loops.set(name, { src, gain });
    } else if (name === 'ambience') {
      // Soft jungle bed: filtered noise wind + occasional chirps handled by tick().
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      src.connect(f).connect(g).connect(gain);
      src.start();
      this.loops.set(name, { src, gain });
    }
  }

  setLoopVolume(name: LoopName, v: number): void {
    const l = this.loops.get(name);
    if (l && this.ctx) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  stopLoop(name: LoopName): void {
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const src = l.src;
    setTimeout(() => {
      if (src instanceof AudioBufferSourceNode) src.stop();
    }, 1500);
    this.loops.delete(name);
  }

  private chirpTimer = 2;
  /** Occasional bird chirps for the jungle ambience when no ambience sample is loaded. */
  tick(dt: number): void {
    if (!this.ctx || !this.loops.has('ambience') || this.buffers.has('ambience')) return;
    this.chirpTimer -= dt;
    if (this.chirpTimer > 0) return;
    this.chirpTimer = 1.5 + Math.random() * 4;
    const g = this.ctx.createGain();
    g.gain.value = 0.05 + Math.random() * 0.05;
    g.connect(this.sfx);
    const f = 1800 + Math.random() * 1500;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++)
      this.tone(g, t + i * 0.11, 0.08, 1, 'sine', f, f * 1.3);
  }
}

export const audio = new Audio();
