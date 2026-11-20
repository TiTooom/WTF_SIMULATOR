// Son synthétisé en direct (Web Audio) : aucun fichier audio à embarquer, donc un jeu léger.
import type { Vec3 } from '../shared/protocol';

interface Voice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  hydroGain: GainNode;
  prevArm: number[];
}

export interface VehicleAudio {
  type: 'car' | 'excavator';
  p: Vec3;
  speed: number; // m/s
  driven: boolean;
  mine: boolean; // le joueur est dedans : son plein, sans atténuation
  arm: number[];
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private noise!: AudioBuffer;
  private voices: Voice[] = [];
  private windGain!: GainNode;
  private stepTimer = 0;
  private t = 0;
  private volumes = { master: 0.7, effects: 1 };

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
    this.fx.gain.setTargetAtTime(effects, this.ctx.currentTime, 0.03);
  }

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.master.connect(ctx.destination);
    this.setVolumes(this.volumes.master, this.volumes.effects);

    // 2 s de bruit blanc, réutilisé pour le vent, les pas et l'hydraulique
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
    wind.connect(lp).connect(this.windGain).connect(this.fx);
    wind.start();
  }

  private makeVoice(type: 'car' | 'excavator'): Voice {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = type === 'car' ? 'square' : 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.fx);
    osc1.start();
    osc2.start();

    // Vérins hydrauliques (pelleteuse) : bruit filtré qui s'ouvre quand le bras bouge
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 3;
    const hydroGain = ctx.createGain();
    hydroGain.gain.value = 0;
    src.connect(bp).connect(hydroGain).connect(this.fx);
    src.start();
    return { osc1, osc2, filter, gain, hydroGain, prevArm: [] };
  }

  /** Mise à jour à chaque image : moteurs selon la vitesse et la distance, pas, vent. */
  update(dt: number, listener: Vec3, vehicles: VehicleAudio[], onFootMoving: boolean) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.t += dt;
    const now = ctx.currentTime;

    vehicles.forEach((v, i) => {
      const voice = (this.voices[i] ??= this.makeVoice(v.type));
      const dx = v.p[0] - listener[0], dy = v.p[1] - listener[1], dz = v.p[2] - listener[2];
      const dist = Math.hypot(dx, dy, dz);
      const att = v.mine ? 1 : 1 / (1 + (dist / 14) ** 2);
      const speed = Math.abs(v.speed);
      const on = v.driven ? 1 : 0;

      const base = v.type === 'car' ? 38 : 28;
      const freq = base + speed * (v.type === 'car' ? 4.4 : 6);
      voice.osc1.frequency.setTargetAtTime(freq, now, 0.08);
      voice.osc2.frequency.setTargetAtTime(freq * 2.01, now, 0.08);
      voice.filter.frequency.setTargetAtTime(380 + speed * 45, now, 0.1);
      const level = v.type === 'car' ? 0.16 : 0.22;
      voice.gain.gain.setTargetAtTime(on * att * level * (0.6 + Math.min(speed / 12, 0.4)), now, 0.12);

      // Hydraulique : vitesse de rotation du bras (rad/s)
      let armSpeed = 0;
      if (voice.prevArm.length === v.arm.length)
        for (let k = 0; k < v.arm.length; k++) armSpeed = Math.max(armSpeed, Math.abs(v.arm[k] - voice.prevArm[k]) / Math.max(dt, 0.001));
      voice.prevArm = [...v.arm];
      const hydro = v.type === 'excavator' && armSpeed > 0.05 ? 0.14 : 0;
      voice.hydroGain.gain.setTargetAtTime(hydro * att, now, 0.06);
    });

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

  /** Petit bruit filtré (pas, claquement). */
  private burst(duration: number, volume: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.fx);
    src.start(t, Math.random(), duration + 0.05);
  }

  private tone(freq: number, freqEnd: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
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
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  play(kind: 'click' | 'enter' | 'exit' | 'chat' | 'jump') {
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
