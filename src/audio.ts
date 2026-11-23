// Son synthétisé en direct (Web Audio) : aucun fichier audio à embarquer, donc un jeu léger.
// Ajouter un son nommé : une entrée dans SOUNDS (fonction qui appelle a.tone / a.burst). Il est alors utilisable
// par `api.fx({k:'sound', s:'<nom>', p})` côté serveur et par audio.fx('<nom>', position) côté client.
import type { Vec3 } from '../shared/protocol';
import type { EngineParams } from './vehicles/types';

interface Voice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  hydroGain: GainNode;
  prevArm: number[];
  key: string;
}

export interface VehicleAudio {
  type: string;
  engine?: EngineParams; // paramètres de la vue du véhicule
  p: Vec3;
  speed: number; // m/s
  driven: boolean;
  mine: boolean; // le joueur est dedans : son plein, sans atténuation
  arm: number[];
}

const DEFAULT_ENGINE: EngineParams = { base: 40, speedK: 3, level: 0.14 };
const NOTE = (n: number) => 261.63 * 2 ** (n / 12); // n = demi-tons depuis le do central

export interface SoundOpts { size?: number }
export type SoundFn = (a: GameAudio, o: SoundOpts) => void;

/** Sons nommés (fx `sound`). Les horn_1..5 sont des klaxons de caractères différents. */
export const SOUNDS: Record<string, SoundFn> = {
  boom: (a, o) => {
    const s = Math.min(2, 0.6 + (o.size ?? 6) / 10);
    a.tone(110, 28, 0.9 * s, 0.9, 'sine');
    a.tone(60, 22, 1.1 * s, 0.6, 'triangle', 0.02);
    a.burst(0.9 * s, 0.7, 1100, 'lowpass', 120);
    a.burst(0.15, 0.4, 5000, 'highpass');
  },
  rocket: (a) => { a.burst(0.7, 0.3, 700, 'bandpass', 2600); a.tone(180, 70, 0.5, 0.12, 'sawtooth'); },
  boing: (a) => { a.tone(160, 520, 0.14, 0.3, 'sine'); a.tone(520, 200, 0.28, 0.3, 'sine', 0.13); a.tone(300, 150, 0.2, 0.15, 'triangle', 0.3); },
  pop: (a) => { a.tone(700, 140, 0.09, 0.35, 'sine'); a.burst(0.04, 0.25, 4000); },
  zap: (a) => { a.tone(1600, 140, 0.2, 0.22, 'sawtooth'); a.tone(900, 90, 0.2, 0.1, 'square', 0.02); },
  whoosh: (a) => a.burst(0.5, 0.35, 400, 'bandpass', 2200),
  bloop: (a) => { a.tone(260, 740, 0.09, 0.3); a.tone(740, 380, 0.14, 0.3, 'sine', 0.09); },
  honk: (a) => SOUNDS.horn_1(a, {}),
  horn_1: (a) => { a.tone(420, 415, 0.32, 0.18, 'square'); a.tone(530, 525, 0.32, 0.14, 'square'); },
  horn_2: (a) => { a.tone(190, 85, 0.45, 0.3, 'sawtooth'); a.burst(0.4, 0.1, 500); }, // prout de clown
  horn_3: (a) => { for (let i = 0; i < 2; i++) { a.tone(311, 311, 0.28, 0.16, 'sawtooth', i * 0.34); a.tone(392, 392, 0.28, 0.14, 'sawtooth', i * 0.34); } },
  horn_4: (a) => { a.tone(280, 640, 0.28, 0.22, 'square'); a.tone(640, 300, 0.4, 0.22, 'square', 0.28); }, // « a-ou-ga »
  horn_5: (a) => { for (let i = 0; i < 3; i++) a.tone(900 - i * 90, 700 - i * 90, 0.1, 0.18, 'square', i * 0.13); },
  jingle: (a) => {
    // « Pour Élise », version camion de glaces
    const mel = [16, 15, 16, 15, 16, 11, 14, 12, 9];
    mel.forEach((n, i) => a.tone(NOTE(n), NOTE(n), 0.18, 0.16, 'triangle', i * 0.2));
  },
  quack: (a) => { for (let i = 0; i < 2; i++) { a.tone(720, 380, 0.13, 0.22, 'sawtooth', i * 0.2); a.burst(0.1, 0.06, 2500, 'bandpass', undefined, i * 0.2); } },
  meow: (a) => { a.tone(480, 900, 0.17, 0.2, 'triangle'); a.tone(900, 420, 0.3, 0.2, 'triangle', 0.17); },
  fanfare: (a) => {
    [[0, 0], [4, 0.15], [7, 0.3], [12, 0.45]].forEach(([n, t], i) => a.tone(NOTE(n), NOTE(n), i === 3 ? 0.55 : 0.14, 0.18, 'sawtooth', t));
  },
  splat: (a) => { a.burst(0.14, 0.4, 1200, 'lowpass', 300); a.tone(260, 60, 0.16, 0.3, 'sine'); },
  chicken: (a) => { for (let i = 0; i < 4; i++) a.tone(760 - i * 40, 420, 0.07, 0.18, 'square', i * 0.09); a.tone(500, 900, 0.18, 0.15, 'sawtooth', 0.45); },
  // --- sons ajoutés pour les véhicules et objets WTF ---
  squeal: (a) => { a.tone(1900, 1500, 0.35, 0.12, 'sawtooth'); a.burst(0.3, 0.1, 3500, 'highpass'); },
  glou: (a) => { for (let i = 0; i < 3; i++) a.tone(320 - i * 40, 140, 0.1, 0.25, 'sine', i * 0.11); },
  bip: (a) => { a.tone(1250, 1250, 0.08, 0.2, 'square'); },
  brrrt: (a) => { for (let i = 0; i < 6; i++) a.tone(95 + (i % 2) * 12, 80, 0.07, 0.25, 'sawtooth', i * 0.06); },
  pfffff: (a) => { a.burst(1.2, 0.25, 4000, 'highpass'); a.tone(900, 120, 1.1, 0.06, 'sine'); },
  pschitt: (a) => { a.burst(0.5, 0.3, 5000, 'highpass'); a.tone(2000, 600, 0.15, 0.1, 'sine'); },
  tole: (a) => { a.burst(0.45, 0.3, 1600, 'bandpass', 2400); a.tone(220, 110, 0.4, 0.12, 'sawtooth'); },
  moo: (a) => { a.tone(150, 110, 0.7, 0.22, 'sawtooth'); a.tone(300, 220, 0.7, 0.08, 'triangle'); },
  cluck: (a) => { for (let i = 0; i < 3; i++) a.tone(520 + i * 30, 380, 0.05, 0.18, 'square', i * 0.07); },
  note: (a) => { const f = [523, 587, 659, 784, 880][Math.floor(Math.random() * 5)]; a.tone(f, f, 0.5, 0.22, 'triangle'); a.tone(f * 2, f * 2, 0.3, 0.06, 'sine'); },
};

/**
 * Enregistre (ou remplace) un son nommé, utilisable ensuite par `api.fx({k:'sound', s:name})` et `audio.fx(name, pos)`.
 * Chaque système/mini-jeu déclare ses sons ainsi, sans toucher à SOUNDS. Noms : lettres, chiffres, « _ », 40 max.
 */
export function registerSound(name: string, fn: SoundFn): void {
  if (!/^[a-z0-9_]{1,40}$/i.test(name) || name === '__proto__' || name === 'constructor' || name === 'prototype') return;
  SOUNDS[name] = fn;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fxBus!: GainNode;
  private noise!: AudioBuffer;
  private voices: Voice[] = [];
  private windGain!: GainNode;
  private stepTimer = 0;
  private t = 0;
  private volumes = { master: 0.7, effects: 1 };
  private dest: AudioNode | null = null; // sortie courante des sons (atténuée par distance pour les fx)
  private listener: Vec3 = [0, 0, 0];
  /** Sons nommés joués (pour les tests) : nom → nombre. */
  played: Record<string, number> = {};

  /** À appeler lors d'un geste du joueur (clic, touche) : les navigateurs interdisent le son avant. */
  resume() {
    try {
      if (!this.ctx) this.init();
      void this.ctx?.resume();
    } catch { /* pas de son : le jeu continue */ }
  }

  get ready() {
    return this.ctx?.state === 'running';
  }

  setVolumes(master: number, effects: number) {
    this.volumes = { master, effects };
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(master, this.ctx.currentTime, 0.03);
    this.fxBus.gain.setTargetAtTime(effects, this.ctx.currentTime, 0.03);
  }

  getVolumes() {
    return { ...this.volumes };
  }

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.setVolumes(this.volumes.master, this.volumes.effects);

    // 2 s de bruit blanc, réutilisé pour le vent, les pas, l'hydraulique et les explosions
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Vent léger en fond
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.04;
    wind.connect(lp).connect(this.windGain).connect(this.fxBus);
    wind.start();
  }

  private makeVoice(key: string, e: EngineParams): Voice {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = e.osc1 ?? 'sawtooth';
    osc2.type = e.osc2 ?? 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.fxBus);
    osc1.start();
    osc2.start();

    // Vérins hydrauliques : bruit filtré qui s'ouvre quand `a` change
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 3;
    const hydroGain = ctx.createGain();
    hydroGain.gain.value = 0;
    src.connect(bp).connect(hydroGain).connect(this.fxBus);
    src.start();
    return { osc1, osc2, filter, gain, hydroGain, prevArm: [], key };
  }

  private killVoice(v: Voice) {
    try { v.osc1.stop(); v.osc2.stop(); v.gain.disconnect(); v.hydroGain.disconnect(); } catch { /* déjà arrêtée */ }
  }

  /** Mise à jour à chaque image : moteurs selon la vitesse et la distance, pas, vent. */
  update(dt: number, listener: Vec3, vehicles: VehicleAudio[], onFootMoving: boolean) {
    this.listener = listener;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.t += dt;
    const now = ctx.currentTime;

    vehicles.forEach((v, i) => {
      const e = v.engine ?? DEFAULT_ENGINE;
      let voice = this.voices[i];
      if (voice && voice.key !== v.type) { this.killVoice(voice); voice = undefined as unknown as Voice; }
      voice ??= (this.voices[i] = this.makeVoice(v.type, e));
      const dx = v.p[0] - listener[0], dy = v.p[1] - listener[1], dz = v.p[2] - listener[2];
      const dist = Math.hypot(dx, dy, dz);
      const att = v.mine ? 1 : 1 / (1 + (dist / 14) ** 2);
      const speed = Math.abs(v.speed);
      const on = v.driven && !e.silent ? 1 : 0;

      const freq = e.base + speed * e.speedK;
      voice.osc1.frequency.setTargetAtTime(freq, now, 0.08);
      voice.osc2.frequency.setTargetAtTime(freq * (e.ratio ?? 2.01), now, 0.08);
      voice.filter.frequency.setTargetAtTime((e.cutoff ?? 380) + speed * (e.cutoffK ?? 45), now, 0.1);
      voice.gain.gain.setTargetAtTime(on * att * e.level * (0.6 + Math.min(speed / 12, 0.4)), now, 0.12);

      // Hydraulique : vitesse de variation des animations (rad/s)
      let armSpeed = 0;
      if (voice.prevArm.length === v.arm.length)
        for (let k = 0; k < v.arm.length; k++) armSpeed = Math.max(armSpeed, Math.abs(v.arm[k] - voice.prevArm[k]) / Math.max(dt, 0.001));
      voice.prevArm = [...v.arm];
      const hydro = e.hydro && armSpeed > 0.05 ? 0.14 : 0;
      voice.hydroGain.gain.setTargetAtTime(hydro * att, now, 0.06);
    });
    // véhicules disparus de la liste : on coupe les voix en trop
    while (this.voices.length > vehicles.length) this.killVoice(this.voices.pop()!);

    // Pas : un petit bruit grave à chaque foulée
    if (onFootMoving) {
      this.stepTimer += dt;
      if (this.stepTimer > 0.36) {
        this.stepTimer = 0;
        this.burst(0.07, 0.09, 260);
      }
    } else {
      this.stepTimer = 0.3;
    }
    this.windGain.gain.setTargetAtTime(0.035 + 0.015 * Math.sin(this.t * 0.4), now, 0.5);
  }

  /** Petit bruit filtré (pas, claquement, souffle). `sweepTo` : le filtre glisse vers cette fréquence. */
  burst(duration: number, volume: number, freq: number, type: BiquadFilterType = 'lowpass', sweepTo?: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.dest ?? this.fxBus);
    src.start(t, Math.random(), Math.min(duration + 0.05, 1.9));
  }

  tone(freq: number, freqEnd: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + duration);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.dest ?? this.fxBus);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  /** Joue un son nommé à une position du monde ; volume atténué par la distance à la caméra. Nom inconnu : ignoré. */
  fx(name: string, p: Vec3, o: SoundOpts = {}) {
    this.played[name] = (this.played[name] ?? 0) + 1;
    const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : undefined;
    const ctx = this.ctx;
    if (!fn || !ctx || !this.ready) return;
    const d = Math.hypot(p[0] - this.listener[0], p[1] - this.listener[1], p[2] - this.listener[2]);
    const far = name === 'boom' ? 40 : 18;
    const att = 1 / (1 + (d / far) ** 2);
    if (att < 0.02) return;
    const out = ctx.createGain();
    out.gain.value = att;
    out.connect(this.fxBus);
    this.dest = out;
    try { fn(this, o); } finally { this.dest = null; }
    setTimeout(() => out.disconnect(), 3000);
  }

  /** Sons d'interface / du joueur (sans position). */
  play(kind: 'click' | 'enter' | 'exit' | 'chat' | 'jump') {
    this.played[kind] = (this.played[kind] ?? 0) + 1;
    if (!this.ready) return;
    switch (kind) {
      case 'click': this.tone(880, 620, 0.07, 0.12); break;
      case 'enter': this.tone(170, 60, 0.16, 0.3, 'triangle'); this.burst(0.05, 0.15, 1200); break;
      case 'exit': this.burst(0.05, 0.15, 1200); this.tone(120, 50, 0.14, 0.25, 'triangle', 0.04); break;
      case 'chat': this.tone(660, 660, 0.09, 0.1); this.tone(880, 880, 0.12, 0.1, 'sine', 0.09); break;
      case 'jump': this.burst(0.09, 0.1, 500); break;
    }
  }
}
