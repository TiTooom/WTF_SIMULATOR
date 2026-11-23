// Effets visuels (FxEvent du serveur), style BD : explosions (flash, étoile de comics, onde, fumée en aplats, onomatopée « BOUM ! »), étincelles,
// débris, impacts de tir, sirène, confettis, textes flottants, ondes, rayons, secousses de caméra mesurées.
// Particules : un seul InstancedMesh (pool de MAX particules) ; sprites (étoiles, onomatopées, halos) : pool réutilisé, textures de canvas partagées.
// Les kinds inconnus sont ignorés silencieusement. Ajouter un effet : écrire un handler dans HANDLERS (en bas) : (fx, ev) => void.
// Kinds : boom smoke spark confetti text ring flash beam shake sound
//         + impact (tir : étincelles, fumée, étoile ; `s` = onomatopée) · debris (`c` couleur, `a` échelle, `b` nombre)
//         + siren (gyrophares : flashs rouge/bleu, `a` durée) · tyre (fumée de pneus, `a` taille, `b` nombre).
// Côté client (main.ts) : fx.vehicleFx(v, i, dt) pour chaque véhicule vivant (fumée de dérapage a[1], fumée/flammes de dégâts).
import * as THREE from 'three';
import type { FxEvent, Vec3 } from '../shared/protocol';
import type { GameAudio } from './audio';

const MAX = 900;
/** Plafond de la secousse de caméra (m). main.ts applique ± shake/2 par axe : 0,7 reste lisible en vue de dessus. */
export const SHAKE_MAX = 0.7;
const COLORS = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93, 0xff8fab, 0xffffff];

interface Timed {
  obj: THREE.Object3D;
  age: number;
  dur: number;
  tick(k: number, camPos: THREE.Vector3): void; // k = 0..1
  dispose?: () => void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];

// ---------- Textures de canvas partagées (créées à la demande) ----------
const INK = '#14141f';
let burstTex: THREE.CanvasTexture | null = null;
let glowTex: THREE.CanvasTexture | null = null;
const wordTex = new Map<string, THREE.CanvasTexture>();
const asTex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

/** Étoile de comics à pointes (jaune / orange / cœur clair, contour noir épais). */
function getBurstTex(): THREE.CanvasTexture {
  if (burstTex) return burstTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const spikes = 13;
  const star = (R: number, r: number, color: string, outline: number, seed: number) => {
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + seed;
      const rad = i % 2 ? r : R * (0.86 + 0.14 * Math.sin(i * 12.9898 + seed));
      if (i) g.lineTo(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad);
      else g.moveTo(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad);
    }
    g.closePath();
    g.fillStyle = color; g.fill();
    if (outline) { g.lineWidth = outline; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke(); }
  };
  star(118, 68, '#ffd23f', 11, 0);
  star(86, 50, '#ff7a1a', 0, 0.1);
  star(52, 30, '#fff6c8', 0, 0.2);
  return (burstTex = asTex(c));
}

function getGlowTex(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (glowTex = asTex(c));
}

/** Onomatopée : texte italique épais, remplissage vif, contour noir et ombre portée décalée (aplat BD). */
function getWordTex(word: string, fill: string): THREE.CanvasTexture {
  const key = word + fill;
  let t = wordTex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.font = 'italic 900 118px Impact, "Arial Black", "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 30; g.strokeStyle = INK;
  g.strokeText(word, 262, 138, 470);
  g.strokeText(word, 256, 128, 470);
  g.fillStyle = fill;
  g.fillText(word, 256, 128, 470);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,.35)';
  g.fillRect(0, 0, 512, 112);
  wordTex.set(key, (t = asTex(c)));
  return t;
}

export const WORDS = {
  boom: ['BOUM !', 'BADABOUM !', 'KABOUM !', 'BLAM !'],
  hit: ['PAF !', 'CRAC !', 'CLANG !'],
  shot: ['POW !', 'PAN !', 'PIF !'],
} as const;
const WORD_COLORS = ['#fff04d', '#ff8a3d', '#ff4d6d', '#7ee0ff'];

export class Fx {
  /** Secousse de caméra courante (m, 0..SHAKE_MAX) ; le jeu l'applique à la caméra (amplitude ± shake/2 par axe). */
  shake = 0;
  /** Multiplicateur d'accessibilité (0 = pas de secousse). */
  shakeScale = 1;
  /** Onomatopées à l'écran (plafonnées à 2 pour ne pas surcharger l'image). */
  words = 0;
  private listener: Vec3 = [0, 0, 0];
  private timeds: Timed[] = [];
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private nextLight = 0;
  private spritePool: THREE.Sprite[] = [];
  private vstate: { drift: number; dmg: number }[] = [];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  sphereGeo = new THREE.SphereGeometry(1, 14, 10);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  /** Statistiques pour les tests. */
  handled: Record<string, number> = {};

  // Particules (SoA)
  private n = 0;
  private px = new Float32Array(MAX); private py = new Float32Array(MAX); private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX); private vy = new Float32Array(MAX); private vz = new Float32Array(MAX);
  private age = new Float32Array(MAX); private life = new Float32Array(MAX);
  private s0 = new Float32Array(MAX); private s1 = new Float32Array(MAX);
  private grav = new Float32Array(MAX); private drag = new Float32Array(MAX);
  private c0 = new Float32Array(MAX * 3); private c1 = new Float32Array(MAX * 3);
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();
  private camPos = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private audio: GameAudio) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.col.set(0xffffff));
    scene.add(this.mesh);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 40, 1.5);
      scene.add(l);
      this.lights.push(l);
      this.lightT.push(0);
    }
  }

  get active() {
    return this.n + this.timeds.length;
  }

  /** Nombre de particules vivantes (tests). */
  get particles() {
    return this.n;
  }

  /** Crée une particule : position, vitesse, durée, taille début/fin, couleur début/fin, gravité (m/s²), frottement (1/s). */
  spawn(p: Vec3 | THREE.Vector3Like | number[], v: Vec3, life: number, size0: number, size1: number, color0: number, color1 = color0, grav = 0, drag = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    const P = p as number[];
    const isArr = Array.isArray(p);
    this.px[i] = isArr ? P[0] : (p as THREE.Vector3Like).x; this.py[i] = isArr ? P[1] : (p as THREE.Vector3Like).y; this.pz[i] = isArr ? P[2] : (p as THREE.Vector3Like).z;
    this.vx[i] = v[0]; this.vy[i] = v[1]; this.vz[i] = v[2];
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size0; this.s1[i] = size1; this.grav[i] = grav; this.drag[i] = drag;
    this.col.set(color0); this.c0[i * 3] = this.col.r; this.c0[i * 3 + 1] = this.col.g; this.c0[i * 3 + 2] = this.col.b;
    this.col.set(color1); this.c1[i * 3] = this.col.r; this.c1[i * 3 + 1] = this.col.g; this.c1[i * 3 + 2] = this.col.b;
  }

  /** Bouffée de fumée (traînées, véhicules en feu). */
  puff(p: Vec3 | THREE.Vector3Like, size = 0.6, dark = false) {
    this.spawn(p, [rnd(-0.4, 0.4), rnd(0.8, 1.8), rnd(-0.4, 0.4)], rnd(0.9, 1.5), size * 0.35, size * 1.1, dark ? 0x3a3a40 : 0xcfcfd6, dark ? 0x222226 : 0x8a8a92, -0.2, 1);
  }

  timed(t: Timed) {
    this.scene.add(t.obj);
    this.timeds.push(t);
  }

  light(p: Vec3, color: number, intensity: number) {
    const i = this.nextLight++ % this.lights.length;
    const l = this.lights[i];
    l.position.set(...p);
    l.color.set(color);
    l.intensity = intensity;
    this.lightT[i] = 0.4;
  }

  /** Mesh à matériau propre, qui grossit/s'efface : base des boules de feu, ondes et flashs. */
  blob(geo: THREE.BufferGeometry, p: Vec3, color: number, dur: number, tick: (m: THREE.Mesh, mat: THREE.MeshBasicMaterial, k: number) => void, additive = false) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, fog: true, ...(additive ? { blending: THREE.AdditiveBlending } : {}) });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p);
    this.timed({ obj: m, age: 0, dur, tick: (k) => tick(m, mat, k), dispose: () => mat.dispose() });
  }

  ring(p: Vec3, radius: number, color = 0xffffff, dur = 0.5) {
    this.blob(this.ringGeo, p, color, dur, (m, mat, k) => {
      m.scale.setScalar(Math.max(0.01, radius * (1 - (1 - k) ** 2)));
      mat.opacity = 0.9 * (1 - k);
    });
  }

  fireball(p: Vec3, radius: number, color = 0xffa633, dur = 0.45) {
    this.blob(this.sphereGeo, p, color, dur, (m, mat, k) => {
      m.scale.setScalar(Math.max(0.01, radius * (0.25 + 0.75 * (1 - (1 - k) ** 2))));
      mat.opacity = 0.95 * (1 - k * k);
      mat.color.setHex(k < 0.4 ? 0xffe27a : 0xff7a1a);
    });
  }

  text(p: Vec3, s: string, color = 0xffe066) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d')!;
    g.font = 'bold 68px "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = '#1b1b2b';
    g.strokeText(s, 256, 66, 496);
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.fillText(s, 256, 66, 496);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(...p);
    sp.renderOrder = 10;
    const y0 = p[1];
    this.timed({
      obj: sp, age: 0, dur: 1.8,
      tick: (k, cam) => {
        const d = Math.max(1, cam.distanceTo(sp.position));
        const sc = 0.9 * Math.max(1, d / 12);
        sp.scale.set(4 * sc, 1 * sc, 1);
        sp.position.y = y0 + 2.2 * (1 - (1 - k) ** 2);
        mat.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      },
      dispose: () => { tex.dispose(); mat.dispose(); },
    });
  }

  /** Sprite du pool (revient au pool à la fin de l'effet). */
  private spriteOf(tex: THREE.Texture, additive = false): THREE.Sprite {
    let sp = this.spritePool.pop();
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false }));
      sp.renderOrder = 12;
    }
    const m = sp.material;
    m.map = tex;
    m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.opacity = 1; m.rotation = 0; m.color.set(0xffffff);
    sp.scale.set(1, 1, 1);
    return sp;
  }

  private timedSprite(sp: THREE.Sprite, p: Vec3, dur: number, tick: (k: number, sp: THREE.Sprite, d: number) => void, onEnd?: () => void) {
    sp.position.set(...p);
    this.timed({
      obj: sp, age: 0, dur,
      tick: (k, cam) => tick(k, sp, Math.max(1, cam.distanceTo(sp.position))),
      dispose: () => { this.spritePool.push(sp); onEnd?.(); },
    });
  }

  /** Étoile de comics qui « claque » (pop rapide, grossit un peu, disparaît). */
  burst(p: Vec3, size: number, dur = 0.5, additive = false) {
    const sp = this.spriteOf(getBurstTex(), additive);
    const rot = rnd(-0.5, 0.5);
    this.timedSprite(sp, p, dur, (k, s, d) => {
      const pop = 1 - (1 - Math.min(1, k * 5)) ** 3;
      const sc = size * Math.max(1, d / 28) * pop * (1 + 0.18 * k);
      s.scale.set(sc, sc, 1);
      s.material.rotation = rot + k * 0.15;
      s.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    });
  }

  /** Onomatopée (« BOUM ! ») : pop avec rebond, légère inclinaison, plafonnée à 2 à la fois. */
  word(p: Vec3, word: string, size = 3, dur = 1.1) {
    if (this.words >= 2) return;
    this.words++;
    const sp = this.spriteOf(getWordTex(word, pick(WORD_COLORS)));
    const tilt = rnd(-0.25, 0.25);
    const y0 = p[1];
    this.timedSprite(sp, p, dur, (k, s, d) => {
      const t = Math.min(1, k * 6);
      const back = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // sortie avec rebond
      const sc = size * Math.max(1, d / 26) * Math.max(0.05, back);
      s.scale.set(sc * 2, sc, 1);
      s.position.y = y0 + k * 1.4;
      s.material.rotation = tilt;
      s.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    }, () => { this.words--; });
  }

  /** Halo lumineux additif (flash de gyrophare, bouche de canon). */
  glow(p: Vec3, color: number, size: number, dur = 0.2) {
    const sp = this.spriteOf(getGlowTex(), true);
    sp.material.color.set(color);
    this.timedSprite(sp, p, dur, (k, s) => { s.scale.set(size * (0.6 + 0.6 * k), size * (0.6 + 0.6 * k), 1); s.material.opacity = 1 - k; });
  }

  /** Gyrophares : halo rouge/bleu en alternance (6 Hz) pendant `dur` secondes. */
  siren(p: Vec3, dur = 1) {
    const sp = this.spriteOf(getGlowTex(), true);
    this.timedSprite(sp, p, dur, (k, s) => {
      const red = Math.floor(k * dur * 6) % 2 === 0;
      s.material.color.setHex(red ? 0xff2a2a : 0x2a6bff);
      const sc = 5 + 1.2 * Math.sin(k * dur * 38);
      s.scale.set(sc, sc, 1);
      s.material.opacity = 0.9 * (k > 0.8 ? (1 - k) / 0.2 : 1);
    });
  }

  /** Débris solides qui rebondissent : `color` ou palette de décombres. */
  debris(p: Vec3, n: number, speed = 6, color?: number, scale = 1) {
    const pal = [0x3a3a44, 0x7a5a3a, 0xc9c9d4, 0xe63946];
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(0.4, 1) * speed, c = color ?? pick(pal);
      this.spawn(p, [Math.cos(a) * sp, rnd(3, 5 + speed * 0.7), Math.sin(a) * sp], rnd(1.1, 2), 0.2 * scale * rnd(0.6, 1.3), 0.14 * scale, c, c, -20, 0.3);
    }
  }

  /**
   * Effets continus d'un véhicule, à appeler à chaque image pour chaque véhicule vivant (i = index dans le snapshot) :
   * fumée de pneus en dérapage (a[1]), fumée noire sous 30 % de vie, flammes sous 15 %. Remplace le code équivalent de main.ts.
   */
  vehicleFx(v: { p: Vec3; q: [number, number, number, number]; sp: number; hp: number; a: number[]; dead: number }, i: number, dt: number) {
    if (v.dead) return;
    const st = (this.vstate[i] ??= { drift: 0, dmg: 0 });
    if (v.a[1] > 0.5 && Math.abs(v.sp) > 4) {
      st.drift -= dt;
      if (st.drift <= 0) {
        st.drift = 0.06;
        this.tmpQ.set(v.q[0], v.q[1], v.q[2], v.q[3]);
        const back = this.tmpV.set(0, 0, 1).applyQuaternion(this.tmpQ);
        for (const side of [-0.8, 0.8]) {
          this.puff([v.p[0] + back.x * 1.4 - back.z * side, v.p[1] - 0.2, v.p[2] + back.z * 1.4 + back.x * side], rnd(0.55, 0.9), false);
        }
      }
    }
    if (v.hp < 0.3) {
      st.dmg -= dt;
      if (st.dmg <= 0) {
        st.dmg = 0.06 + v.hp * 0.3;
        this.puff([v.p[0] + rnd(-0.5, 0.5), v.p[1] + 1.1, v.p[2] + rnd(-0.5, 0.5)], 0.9, true);
        if (v.hp < 0.15) this.spawn([v.p[0] + rnd(-0.4, 0.4), v.p[1] + 1, v.p[2] + rnd(-0.4, 0.4)], [rnd(-0.7, 0.7), 2.5, rnd(-0.7, 0.7)], 0.5, 0.35, 0.05, 0xffe27a, 0xff5a1a);
      }
    }
  }

  beam(p: Vec3, t: Vec3, color = 0xffffff, width = 0.12, dur = 0.18) {
    const dir = new THREE.Vector3(t[0] - p[0], t[1] - p[1], t[2] - p[2]);
    const len = dir.length();
    if (len < 0.01) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(this.beamGeo, mat);
    m.position.set(...p);
    m.lookAt(new THREE.Vector3(...t));
    m.scale.set(width, width, len);
    this.timed({ obj: m, age: 0, dur, tick: (k) => { mat.opacity = 1 - k; m.scale.x = m.scale.y = width * (1 - 0.6 * k); }, dispose: () => mat.dispose() });
  }

  /** Secousse de caméra atténuée par la distance, plafonnée à SHAKE_MAX (au-delà, l'image devient illisible en vue de dessus). */
  addShake(p: Vec3, intensity: number) {
    const d = Math.hypot(p[0] - this.listener[0], p[1] - this.listener[1], p[2] - this.listener[2]);
    this.shake = Math.min(SHAKE_MAX, this.shake + (intensity * this.shakeScale) / (1 + d / 10));
  }

  distanceTo(p: Vec3) {
    return Math.hypot(p[0] - this.listener[0], p[1] - this.listener[1], p[2] - this.listener[2]);
  }

  /** Rejoue un événement (une seule fois : déduplication faite par Net). */
  handle(ev: FxEvent) {
    const h = HANDLERS[ev.k];
    if (!h || !Array.isArray(ev.p)) return;
    this.handled[ev.k] = (this.handled[ev.k] ?? 0) + 1;
    try { h(this, ev, this.audio); } catch { /* un effet raté ne doit jamais casser le jeu */ }
  }

  update(dt: number, camera: THREE.Camera) {
    camera.getWorldPosition(this.camPos);
    this.listener = [this.camPos.x, this.camPos.y, this.camPos.z];
    this.shake *= Math.exp(-dt * 6);
    if (this.shake < 0.004) this.shake = 0;

    // Particules
    for (let i = 0; i < this.n;) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.n; // retrait par échange avec la dernière
        if (i !== l) {
          for (const a of [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.grav, this.drag]) a[i] = a[l];
          for (let j = 0; j < 3; j++) { this.c0[i * 3 + j] = this.c0[l * 3 + j]; this.c1[i * 3 + j] = this.c1[l * 3 + j]; }
        }
        continue;
      }
      const k = this.age[i] / this.life[i];
      const damp = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= damp; this.vz[i] *= damp; this.vy[i] = this.vy[i] * damp + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05 && this.grav[i] < -1) { this.py[i] = 0.05; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      // fin de vie : rétrécit pour disparaître sans transparence
      const sc = Math.max(0.001, size * (k > 0.7 ? (1 - k) / 0.3 : 1));
      this.m4.makeScale(sc, sc, sc).setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(i, this.m4);
      this.col.setRGB(
        this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * k,
        this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * k,
        this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * k,
      );
      this.mesh.setColorAt(i, this.col);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Effets temporisés
    for (let i = this.timeds.length - 1; i >= 0; i--) {
      const t = this.timeds[i];
      t.age += dt;
      const k = Math.min(1, t.age / t.dur);
      t.tick(k, this.camPos);
      if (t.age >= t.dur) {
        this.scene.remove(t.obj);
        t.dispose?.();
        this.timeds.splice(i, 1);
      }
    }
    // Lumières
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightT[i] > 0) {
        this.lightT[i] -= dt;
        this.lights[i].intensity *= Math.exp(-dt * 7);
        if (this.lightT[i] <= 0) this.lights[i].intensity = 0;
      }
    }
  }
}

type Handler = (fx: Fx, ev: FxEvent, audio: GameAudio) => void;
const col = (ev: FxEvent, d: number) => (typeof ev.c === 'number' ? ev.c : d);

/** Table des effets : clé = FxEvent.k. Ajoute ici un nouvel effet. */
export const HANDLERS: Record<string, Handler> = {
  boom(fx, ev, audio) {
    const r = Math.max(1.5, ev.a ?? 6);
    const p = ev.p;
    const near = fx.distanceTo(p) < 100;
    // flash blanc sec (1 à 2 images), puis boule de feu, onde, étoile de comics et onomatopée
    fx.blob(fx.sphereGeo, [p[0], p[1] + 0.5, p[2]], 0xffffff, 0.12, (m, mat, k) => { m.scale.setScalar(r * (0.9 + k)); mat.opacity = 1 - k; }, true);
    fx.fireball(p, r * 0.7);
    fx.fireball([p[0], p[1] + r * 0.15, p[2]], r * 0.45, 0xffe27a, 0.3);
    fx.ring([p[0], Math.max(0.1, p[1] - r * 0.2), p[2]], r * 1.6, 0xfff1c0, 0.55);
    if (near) {
      fx.burst([p[0], p[1] + r * 0.45 + 0.8, p[2]], Math.min(13, r * 1.9 + 2), 0.55);
      if (r >= 3.5) fx.word([p[0], p[1] + r * 0.9 + 2.2, p[2]], pick(WORDS.boom), Math.min(4.4, 1.6 + r * 0.35));
    }
    for (let i = 0; i < Math.min(30, 8 + r * 2.5); i++) {
      const a = rnd(0, Math.PI * 2), e = rnd(-0.2, 1), sp = rnd(4, 9 + r);
      fx.spawn(p, [Math.cos(a) * sp, e * sp + 3, Math.sin(a) * sp], rnd(0.5, 1.1), 0.12, 0.05, 0xffe27a, 0xff6a1a, -14, 0.5);
    }
    fx.debris(p, Math.min(16, Math.round(4 + r * 1.4)), 5 + r * 0.6);
    // fumée en aplats : deux gris francs, gros volumes lents
    for (let i = 0; i < Math.min(20, 5 + r * 1.6); i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(1, 3.5 + r * 0.3);
      fx.spawn([p[0] + rnd(-1, 1) * r * 0.3, p[1], p[2] + rnd(-1, 1) * r * 0.3], [Math.cos(a) * sp, rnd(2, 5 + r * 0.3), Math.sin(a) * sp], rnd(1.6, 2.8), r * 0.12, r * 0.36, i % 2 ? 0x55555c : 0x3a3a40, 0x1e1e22, -0.3, 1.2);
    }
    fx.light(p, 0xffa040, 6 + r * 1.5);
    fx.addShake(p, 0.15 + r * 0.04);
    audio.fx('boom', p, { size: r });
  },
  impact(fx, ev) {
    // Impact de tir : gerbe d'étincelles, petite fumée, étoile minuscule ; `s` = onomatopée facultative
    const sc = ev.a ?? 1;
    const p = ev.p;
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(2, 6) * sc;
      fx.spawn(p, [Math.cos(a) * sp, rnd(1, 5), Math.sin(a) * sp], rnd(0.2, 0.45), 0.09, 0.02, 0xfff1a8, 0xff8a2a, -12, 0.5);
    }
    fx.puff(p, 0.45 * sc);
    if (fx.distanceTo(p) < 60) fx.burst([p[0], p[1] + 0.2, p[2]], 1.1 * sc, 0.18);
    if (ev.s && fx.distanceTo(p) < 40) fx.word([p[0], p[1] + 1.6, p[2]], ev.s.slice(0, 12), 1.1);
  },
  debris(fx, ev) {
    fx.debris(ev.p, Math.min(24, Math.round(ev.b ?? 8)), 5, typeof ev.c === 'number' ? ev.c : undefined, ev.a ?? 1);
  },
  siren(fx, ev) {
    fx.siren(ev.p, ev.a ?? 1);
  },
  tyre(fx, ev) {
    for (let i = 0; i < Math.max(1, Math.round(ev.b ?? 3)); i++) fx.puff([ev.p[0] + rnd(-0.4, 0.4), ev.p[1], ev.p[2] + rnd(-0.4, 0.4)], ev.a ?? 0.8);
  },
  smoke(fx, ev) {
    const n = Math.max(1, Math.round(ev.b ?? 3));
    for (let i = 0; i < n; i++) fx.puff([ev.p[0] + rnd(-0.3, 0.3), ev.p[1], ev.p[2] + rnd(-0.3, 0.3)], ev.a ?? 0.8, false);
  },
  spark(fx, ev) {
    const n = Math.max(3, Math.round(ev.b ?? 12));
    const sc = col(ev, 0xffe27a);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(2, 7) * (ev.a ?? 1);
      fx.spawn(ev.p, [Math.cos(a) * sp, rnd(1, 6), Math.sin(a) * sp], rnd(0.3, 0.7), 0.1, 0.03, sc, 0xff6a1a, -12, 0.4);
    }
    if (n >= 10 && fx.distanceTo(ev.p) < 50) fx.burst([ev.p[0], ev.p[1] + 0.3, ev.p[2]], 1.6 * (ev.a ?? 1), 0.2);
    if (n >= 16 && fx.distanceTo(ev.p) < 40) fx.word([ev.p[0], ev.p[1] + 1.8, ev.p[2]], pick(WORDS.hit), 1.2);
  },
  confetti(fx, ev) {
    const n = Math.round(ev.b ?? 45);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(2, 9) * (ev.a ?? 1);
      const c = typeof ev.c === 'number' && ev.c > 0 ? ev.c : COLORS[(Math.random() * COLORS.length) | 0];
      fx.spawn(ev.p, [Math.cos(a) * sp, rnd(3, 10), Math.sin(a) * sp], rnd(1.4, 2.6), 0.14, 0.14, c, c, -7, 1.3);
    }
  },
  text(fx, ev) {
    if (ev.s) fx.text(ev.p, ev.s.slice(0, 40), col(ev, 0xffe066));
  },
  ring(fx, ev) {
    fx.ring(ev.p, ev.a ?? 4, col(ev, 0xffffff), 0.5);
  },
  flash(fx, ev) {
    const r = ev.a ?? 3;
    const c = col(ev, 0xffffff);
    fx.blob(fx.sphereGeo, ev.p, c, 0.25, (m, mat, k) => { m.scale.setScalar(r * (0.4 + k)); mat.opacity = 1 - k; }, true);
  },
  beam(fx, ev) {
    if (ev.t) fx.beam(ev.p, ev.t, col(ev, 0xfff1a8), ev.a ?? 0.12);
  },
  shake(fx, ev) {
    fx.addShake(ev.p, ev.a ?? 0.5);
  },
  sound(_fx, ev, audio) {
    if (ev.s) audio.fx(ev.s, ev.p, { size: ev.a });
  },
};
