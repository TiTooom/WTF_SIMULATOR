// Effets visuels (FxEvent du serveur) : explosions, fumée, étincelles, confettis, textes flottants, ondes, rayons, secousses.
// Particules : un seul InstancedMesh (pool de MAX particules). Les kinds inconnus sont ignorés silencieusement.
// Ajouter un effet : écrire un handler dans HANDLERS (en bas) : (fx, ev) => void, et utiliser fx.spawn / fx.timed.
import * as THREE from 'three';
import type { FxEvent, Vec3 } from '../shared/protocol';
import type { GameAudio } from './audio';

const MAX = 900;
const COLORS = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93, 0xff8fab, 0xffffff];

interface Timed {
  obj: THREE.Object3D;
  age: number;
  dur: number;
  tick(k: number, camPos: THREE.Vector3): void; // k = 0..1
  dispose?: () => void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  /** Secousse de caméra courante (m) ; le jeu l'applique à la caméra. */
  shake = 0;
  private listener: Vec3 = [0, 0, 0];
  private timeds: Timed[] = [];
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private nextLight = 0;
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

  /** Secousse de caméra atténuée par la distance. */
  addShake(p: Vec3, intensity: number) {
    const d = Math.hypot(p[0] - this.listener[0], p[1] - this.listener[1], p[2] - this.listener[2]);
    this.shake = Math.min(1.2, this.shake + intensity / (1 + d / 12));
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
    this.shake *= Math.exp(-dt * 5);
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
    fx.fireball(p, r * 0.7);
    fx.fireball([p[0], p[1] + r * 0.15, p[2]], r * 0.45, 0xffe27a, 0.3);
    fx.ring([p[0], Math.max(0.1, p[1] - r * 0.2), p[2]], r * 1.6, 0xfff1c0, 0.55);
    for (let i = 0; i < Math.min(40, 10 + r * 3); i++) {
      const a = rnd(0, Math.PI * 2), e = rnd(-0.2, 1), sp = rnd(4, 9 + r);
      fx.spawn(p, [Math.cos(a) * sp, e * sp + 3, Math.sin(a) * sp], rnd(0.5, 1.1), 0.12, 0.05, 0xffe27a, 0xff6a1a, -14, 0.5);
    }
    for (let i = 0; i < Math.min(26, 6 + r * 2); i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(1, 3.5 + r * 0.3);
      fx.spawn([p[0] + rnd(-1, 1) * r * 0.3, p[1], p[2] + rnd(-1, 1) * r * 0.3], [Math.cos(a) * sp, rnd(2, 5 + r * 0.3), Math.sin(a) * sp], rnd(1.6, 2.8), r * 0.12, r * 0.36, 0x55555c, 0x1e1e22, -0.3, 1.2);
    }
    fx.light(p, 0xffa040, 6 + r * 1.5);
    fx.addShake(p, 0.25 + r * 0.06);
    audio.fx('boom', p, { size: r });
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
