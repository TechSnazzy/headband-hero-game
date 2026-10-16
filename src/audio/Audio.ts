import * as THREE from 'three';

/**
 * WebAudio sound manager.
 *
 * Gunfire, footsteps, impacts and foley are real recordings (CC0, see ASSETS.md)
 * in public/audio, with several variants per sound picked at random. Every
 * positional sound goes through distance attenuation, a distance low-pass (far
 * gunfire sounds muffled) and an outdoor convolution reverb so shots echo
 * across the valley. Sounds without a recording (helicopter, jungle bed, dog,
 * stingers) are synthesized.
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
  | 'bulletImpact'
  | 'impactWood'
  | 'impactMetal'
  | 'crate'
  | 'cage'
  | 'cloth'
  | 'reloadPistol';

export type LoopName = 'heli' | 'ambience' | 'music';

const n = (base: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${base}_${i + 1}.mp3`);

/** Recorded variants in public/audio (kept in sync with ASSETS.md). */
const SAMPLE_FILES: Partial<Record<SoundName | LoopName, string[]>> = {
  rifle: n('rifle', 2),
  enemyRifle: n('enemyRifle', 4),
  sniper: n('sniper', 2),
  pistol: n('pistol', 2),
  reload: n('reload', 1),
  reloadPistol: n('reloadPistol', 1),
  empty: n('empty', 1),
  footstep: n('footstep', 5),
  bulletImpact: n('impactDirt', 4),
  impactWood: n('impactWood', 3),
  impactMetal: n('impactMetal', 3),
  hit: n('hit', 3),
  takedown: n('takedown', 2),
  rockHit: n('rockHit', 3),
  land: n('land', 2),
  throw: n('throw', 1),
  jump: n('jump', 1),
  cloth: n('cloth', 1),
  switch: n('switch', 1),
  pickup: n('pickup', 2),
  crate: n('crate', 1),
  cage: n('cage', 1),
};

/** How much of each sound goes to the outdoor reverb (gunfire echoes, foley stays dry). */
const REVERB_SEND: Partial<Record<SoundName, number>> = {
  rifle: 0.55,
  enemyRifle: 0.7,
  sniper: 0.8,
  pistol: 0.18,
  bulletImpact: 0.2,
  rockHit: 0.3,
  bark: 0.45,
  alert: 0.2,
  hit: 0.1,
};

export function registerSamples(map: Partial<Record<SoundName | LoopName, string[]>>): void {
  Object.assign(SAMPLE_FILES, map);
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicGain!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private reverb!: ConvolverNode;
  /** Camera yaw, so stereo panning follows where the player is looking. */
  listenerYaw = 0;
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
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.9;
    this.reverb.connect(wet).connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void this.loadSamples();
    this.renderSynthLoops();
  }

  /**
   * Outdoor impulse response: a few discrete early reflections (tree line, ridge)
   * followed by a diffuse, darkening tail.
   */
  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        // Low-passed noise that gets darker as it decays.
        const k = 0.35 + 0.6 * Math.exp(-t * 3);
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.exp(-t * 2.6) * 0.55;
      }
      // Early reflections (slightly different per ear for width).
      for (const [ms, g] of [
        [37, 0.5],
        [81, 0.35],
        [143, 0.3],
        [260, 0.22],
        [410, 0.16],
      ]) {
        const at = Math.floor(((ms + (ch ? 9 : 0)) / 1000) * rate);
        for (let j = 0; j < 220 && at + j < len; j++)
          d[at + j] += (Math.random() * 2 - 1) * g * Math.exp(-j / 60);
      }
    }
    return buf;
  }

  private async loadSamples(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      Object.entries(SAMPLE_FILES).map(async ([name, files]) => {
        const list: AudioBuffer[] = [];
        for (const file of files ?? []) {
          try {
            const res = await fetch(`${base}audio/${file}`);
            if (!res.ok) continue;
            list.push(await this.ctx!.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // Missing or undecodable sample: synth fallback is used.
          }
        }
        if (list.length) this.buffers.set(name, list);
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
    let dist = 0;
    if (opts.pos) {
      dist = opts.pos.distanceTo(this.listener);
      const maxD = opts.maxDist ?? 60;
      if (dist > maxD) return;
      // Inverse-distance with a soft edge at maxDist.
      vol *= (1 / (1 + dist * 0.08)) * Math.min(1, (maxD - dist) / (maxD * 0.25));
      // Pan relative to where the camera faces.
      const dx = opts.pos.x - this.listener.x;
      const dz = opts.pos.z - this.listener.z;
      const rel = Math.atan2(-dx, -dz) - this.listenerYaw;
      pan = -Math.sin(rel) * Math.min(1, dist / 4);
    }
    if (vol < 0.005) return;
    const out = ctx.createGain();
    out.gain.value = vol;
    // Distance low-pass: far shots lose their crack and sound muffled.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, 18000 / (1 + dist * 0.09));
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.75;
    out.connect(lp).connect(panner).connect(this.sfx);
    const send = (REVERB_SEND[name] ?? 0.08) * (0.6 + Math.min(1, dist / 40));
    if (send > 0.01) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      panner.connect(sg).connect(this.reverb);
    }

    const bufs = this.buffers.get(name);
    if (bufs) {
      const src = ctx.createBufferSource();
      src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
      src.playbackRate.value = (opts.rate ?? 1) * (0.95 + Math.random() * 0.1);
      src.connect(out);
      src.start();
      // A little synthesized sweetener on top of some recordings.
      if (name === 'hit') this.tone(out, ctx.currentTime, 0.05, 0.12, 'triangle', 1900, 2300);
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
        // Body hitting the ground, then the soft "poof" of voxel cubes.
        this.tone(out, t, 0.18, 0.5, 'sine', 90, 45);
        this.noise(out, t, 0.12, 0.45, 'lowpass', 500);
        this.noise(out, t + 0.05, 0.45, 0.18, 'bandpass', 1400, 0.7);
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
        // Short pained grunt: voiced buzz through a vowel-like formant + breath.
        this.voice(out, t, 0.2, 150, 105, [600, 1100], 0.5);
        this.noise(out, t, 0.12, 0.08, 'bandpass', 1800, 1);
        break;
      case 'bark': {
        // Two "woofs": a voiced burst with mouth formants and a breathy edge.
        for (const dt of [0, 0.22]) {
          this.voice(out, t + dt, 0.13, 420, 240, [700, 1350, 2600], 0.9);
          this.noise(out, t + dt, 0.07, 0.35, 'bandpass', 1500, 1.2);
        }
        break;
      }
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
    if (name === 'music' && !this.buffers.has('music')) {
      // Procedural music bed (see tickMusic).
      this.musicOn = true;
      this.musicIntensity = volume;
      return;
    }
    const buf = this.buffers.get(name)?.[0];
    if (!buf) {
      // Synthesized loops are rendered offline right after unlock; start when ready.
      this.wantedLoops.set(name, volume);
      void this.loopsReady?.then(() => {
        if (this.wantedLoops.has(name)) this.startLoop(name, this.wantedLoops.get(name)!);
      });
      return;
    }
    this.wantedLoops.delete(name);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.2);
    gain.connect(name === 'music' ? this.musicGain : this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    if (name === 'heli') {
      const sg = ctx.createGain();
      sg.gain.value = 0.35;
      gain.connect(sg).connect(this.reverb);
    }
    src.start(0, Math.random() * buf.duration);
    this.loops.set(name, { src, gain });
  }

  private wantedLoops = new Map<LoopName, number>();
  private loopsReady: Promise<void> | null = null;

  /** Renders a mono buffer offline with a small node graph. */
  private async renderOffline(
    seconds: number,
    build: (c: OfflineAudioContext, noise: AudioBuffer) => void,
  ): Promise<AudioBuffer> {
    const rate = 44100;
    const c = new OfflineAudioContext(1, Math.floor(seconds * rate), rate);
    const noise = c.createBuffer(1, Math.floor(seconds * rate), rate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    build(c, noise);
    return c.startRendering();
  }

  /**
   * Helicopter: rotor blade slaps (whup-whup at ~11 Hz) with a low thump each,
   * turbine whine and a rumble bed. Jungle: cicada swell, distant insects, wind.
   * Both are seamless loops (all modulation periods divide the loop length).
   */
  private renderSynthLoops(): void {
    const heli = this.renderOffline(2, (c, noise) => {
      const out = c.createGain();
      out.connect(c.destination);
      const src = (): AudioBufferSourceNode => {
        const n = c.createBufferSource();
        n.buffer = noise;
        n.loop = true;
        return n;
      };
      const slaps = 22;
      for (let i = 0; i < slaps; i++) {
        const t = (i / slaps) * 2;
        const n = src();
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 520;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1.1, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.02, t + 0.075);
        n.connect(f).connect(g).connect(out);
        n.start(t, (i * 0.37) % 1.5, 0.09);
        const o = c.createOscillator();
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(38, t + 0.08);
        const og = c.createGain();
        og.gain.setValueAtTime(0.45, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 0.1);
      }
      const rumble = src();
      const rf = c.createBiquadFilter();
      rf.type = 'lowpass';
      rf.frequency.value = 140;
      const rg = c.createGain();
      rg.gain.value = 0.55;
      rumble.connect(rf).connect(rg).connect(out);
      rumble.start();
      const whine = c.createOscillator();
      whine.type = 'sawtooth';
      whine.frequency.value = 1500;
      const wf = c.createBiquadFilter();
      wf.type = 'bandpass';
      wf.frequency.value = 1500;
      wf.Q.value = 12;
      const wg = c.createGain();
      wg.gain.value = 0.05;
      whine.connect(wf).connect(wg).connect(out);
      whine.start();
      const hiss = src();
      const hf = c.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 3500;
      const hg = c.createGain();
      hg.gain.value = 0.035;
      hiss.connect(hf).connect(hg).connect(out);
      hiss.start(0, 0.7);
    });
    const jungle = this.renderOffline(8, (c, noise) => {
      const out = c.createGain();
      out.connect(c.destination);
      const src = (offset: number): AudioBufferSourceNode => {
        const n = c.createBufferSource();
        n.buffer = noise;
        n.loop = true;
        n.start(0, offset);
        return n;
      };
      // Cicada: narrow band of noise, buzzing at 32 Hz, swelling once per loop.
      const cic = src(0);
      const cf = c.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 5200;
      cf.Q.value = 7;
      const buzz = c.createGain();
      buzz.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = 32;
      const lfoG = c.createGain();
      lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(buzz.gain);
      lfo.start();
      const swell = c.createGain();
      const curve = new Float32Array(64).map(
        (_, i) => 0.06 + 0.16 * Math.pow(Math.sin((i / 63) * Math.PI), 2),
      );
      swell.gain.setValueCurveAtTime(curve, 0, 8);
      cic.connect(cf).connect(buzz).connect(swell).connect(out);
      // A second, lower insect layer.
      const ins = src(2.1);
      const inf = c.createBiquadFilter();
      inf.type = 'bandpass';
      inf.frequency.value = 3100;
      inf.Q.value = 10;
      const ing = c.createGain();
      ing.gain.value = 0.05;
      const lfo2 = c.createOscillator();
      lfo2.frequency.value = 4;
      const l2g = c.createGain();
      l2g.gain.value = 0.045;
      lfo2.connect(l2g).connect(ing.gain);
      lfo2.start();
      ins.connect(inf).connect(ing).connect(out);
      // Wind through the canopy.
      const wind = src(4.3);
      const wf = c.createBiquadFilter();
      wf.type = 'lowpass';
      wf.frequency.value = 420;
      const wg = c.createGain();
      const wcurve = new Float32Array(64).map(
        (_, i) => 0.12 + 0.1 * Math.sin((i / 63) * Math.PI * 2 + 1),
      );
      wg.gain.setValueCurveAtTime(wcurve, 0, 8);
      wind.connect(wf).connect(wg).connect(out);
    });
    this.loopsReady = Promise.all([heli, jungle]).then(([h, j]) => {
      this.buffers.set('heli', [h]);
      this.buffers.set('ambience', [j]);
    });
  }

  setLoopVolume(name: LoopName, v: number): void {
    if (name === 'music' && this.musicOn) this.musicIntensity = v;
    const l = this.loops.get(name);
    if (l && this.ctx) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  stopLoop(name: LoopName): void {
    if (name === 'music') this.musicOn = false;
    this.wantedLoops.delete(name);
    const l = this.loops.get(name);
    if (!l || !this.ctx) return;
    l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const src = l.src;
    setTimeout(() => {
      if (src instanceof AudioBufferSourceNode) src.stop();
    }, 1500);
    this.loops.delete(name);
  }

  private musicOn = false;
  private musicIntensity = 0.5;
  private nextBeat = 0;
  private beat = 0;

  /**
   * Tiny step sequencer: a soft pentatonic marimba line while sneaking; when the
   * camp is alerted (intensity > 0.7) it adds a driving bass and drums.
   */
  private tickMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    const bpm = this.musicIntensity > 0.7 ? 132 : 96;
    const step = 60 / bpm / 2;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat;
      const b = this.beat++;
      const out = this.musicGain;
      const scale = [110, 130.8, 146.8, 164.8, 196, 220, 261.6];
      const hot = this.musicIntensity > 0.7;
      if (b % 4 === 0 || (b % 8 === 6 && Math.random() < 0.5)) {
        const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
        this.tone(out, t, 0.35, 0.09, 'triangle', f, f);
      }
      if (b % 8 === 0) this.tone(out, t, 0.9, hot ? 0.16 : 0.07, 'sine', 55, 55);
      if (hot) {
        if (b % 2 === 0) this.tone(out, t, 0.12, 0.28, 'sine', 120, 40); // kick
        if (b % 4 === 2) this.noise(out, t, 0.1, 0.12, 'highpass', 1800); // snare-ish
        this.noise(out, t, 0.03, 0.04, 'highpass', 7000); // hat
        if (b % 2 === 1) this.tone(out, t, 0.14, 0.1, 'square', scale[b % 3] / 2, scale[b % 3] / 2);
      } else if (b % 4 === 2) this.noise(out, t, 0.05, 0.025, 'highpass', 6000);
      this.nextBeat += step;
    }
  }

  private chirpTimer = 2;
  /** Voiced sound: sawtooth with a pitch glide through parallel formant filters. */
  private voice(
    dest: AudioNode,
    t0: number,
    dur: number,
    f0: number,
    f1: number,
    formants: number[],
    gain: number,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    for (const [i, f] of formants.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 5;
      const fg = ctx.createGain();
      fg.gain.value = 1 / (i + 1);
      o.connect(bp).connect(fg).connect(g);
    }
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Jungle birds on top of the ambience loop: varied FM calls, positioned around you. */
  tick(dt: number): void {
    this.tickMusic();
    if (!this.ctx || !this.loops.has('ambience')) return;
    this.chirpTimer -= dt;
    if (this.chirpTimer > 0) return;
    this.chirpTimer = 0.8 + Math.random() * 3;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.025 + Math.random() * 0.035;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.connect(pan).connect(this.sfx);
    const sg = ctx.createGain();
    sg.gain.value = 0.6;
    pan.connect(sg).connect(this.reverb);
    const t = ctx.currentTime;
    const kind = Math.floor(Math.random() * 3);
    const f = 1600 + Math.random() * 2200;
    if (kind === 0) {
      // Quick descending trill.
      for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++)
        this.fmChirp(g, t + i * 0.07, 0.06, f * (1 - i * 0.04), f * 0.85);
    } else if (kind === 1) {
      // Two-note whistle.
      this.fmChirp(g, t, 0.22, f, f * 1.05);
      this.fmChirp(g, t + 0.3, 0.3, f * 0.8, f * 0.75);
    } else {
      // Rising "whoop" call.
      this.fmChirp(g, t, 0.35, f * 0.5, f * 1.1);
    }
  }

  private fmChirp(dest: AudioNode, t0: number, dur: number, f0: number, f1: number): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    car.frequency.setValueAtTime(f0, t0);
    car.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const mod = ctx.createOscillator();
    mod.frequency.value = 35 + Math.random() * 40;
    const mg = ctx.createGain();
    mg.gain.value = f0 * 0.06;
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1, t0 + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    car.connect(g).connect(dest);
    car.start(t0);
    mod.start(t0);
    car.stop(t0 + dur + 0.02);
    mod.stop(t0 + dur + 0.02);
  }
}

export const audio = new Audio();
