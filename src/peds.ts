// Piétons (PROPRIÉTAIRE : art-toon) : jusqu'à 160, dessinés en InstancedMesh par pièce (torse, tête, jambes, bras, couvre-chef, sac) + coques de contour.
// Entrée : `Sampled.peds` (PED_STRIDE = 6 : id, kind = index de PED_KINDS, x, z, yaw, st).
// États `st` : 0 marche · 1 court / fuit · 2 renversé (au sol, face au ciel) · 3 immobile (attend). Un piéton qui ne bouge pas est figé dans la pose neutre.
// Silhouettes : passant (neutre, couleurs vives), etudiant (sac à dos), dealer (capuche sombre, plus voûté), flic (casquette, bleu marine, plus grand), gang (large, couleur du quartier).
import * as THREE from 'three';
import { DISTRICTS } from '../shared/city/districts';
import { getCity } from '../shared/city/layout';
import { PED_KINDS } from '../shared/ids';
import { PED_STRIDE } from '../shared/protocol';
import { boxGeo, hullGeometry, outlineMat, toonRaw } from './gfx';

export const MAX_PEDS = 160;
const SKIN = [0xf1c27d, 0xe0a370, 0xc68642, 0x8d5524, 0xffdbac];
const PASSANT = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xff8fc8, 0xffa94d, 0xb197fc, 0x3bc9db];
const ETUDIANT = [0x2f9e44, 0xe8590c, 0x1c7ed6, 0xc2255c, 0x7048e8, 0xf08c00];
const PANTS = [0x364fc7, 0x495057, 0x5c3d2e, 0x2b2b3a, 0x7a6a4f];

const pedMat = toonRaw({}); // couleur = instanceColor
const hash = (n: number) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; return h >>> 0; };

interface Part { mesh: THREE.InstancedMesh; hull: THREE.InstancedMesh | null }
interface Rec { ph: number; ph0: number; x: number; z: number; fall: number; moving: number; shirt: number; pants: number; skin: number; hat: number; pack: number; seen: number; kind: number }

const tmpM = new THREE.Matrix4(), root = new THREE.Matrix4(), local = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);

export class PedsView {
  private parts: Record<'torso' | 'head' | 'legL' | 'legR' | 'armL' | 'armR' | 'hat' | 'pack', Part>;
  private recs = new Map<number, Rec>();
  private n = 0;
  private frame = 0;
  private col = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    const make = (w: number, h: number, d: number, dy: number, hull: boolean, max = MAX_PEDS): Part => {
      const geo = boxGeo(w, h, d).clone().translate(0, dy, 0); // origine = articulation (haut du membre)
      const mesh = new THREE.InstancedMesh(geo, pedMat, max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, this.col.set(0xffffff));
      scene.add(mesh);
      let h2: THREE.InstancedMesh | null = null;
      if (hull) {
        h2 = new THREE.InstancedMesh(hullGeometry(geo, 0.035), outlineMat, max);
        h2.instanceMatrix = mesh.instanceMatrix;
        h2.count = 0;
        h2.frustumCulled = false;
        scene.add(h2);
      }
      return { mesh, hull: h2 };
    };
    this.parts = {
      torso: make(0.5, 0.62, 0.28, -0.31, true), // origine : haut du torse
      head: make(0.3, 0.3, 0.3, 0.15, true),
      legL: make(0.2, 0.82, 0.22, -0.41, true),
      legR: make(0.2, 0.82, 0.22, -0.41, true),
      armL: make(0.13, 0.55, 0.14, -0.27, false),
      armR: make(0.13, 0.55, 0.14, -0.27, false),
      hat: make(0.36, 0.14, 0.36, 0.07, true),
      pack: make(0.36, 0.42, 0.18, -0.21, true),
    };
  }

  /** Nombre de piétons dessinés (pour `__wtf.peds`). */
  get count(): number { return this.n; }
  /** Appels de dessin occupés par les piétons (pour les tests). */
  get drawCalls(): number { return this.n ? 15 : 0; }

  private rec(id: number, kind: number, x: number, z: number): Rec {
    let r = this.recs.get(id);
    if (r) return r;
    const k = PED_KINDS[kind] ?? 'passant';
    const h = hash(id + 1);
    const skin = SKIN[h % SKIN.length];
    const pants = PANTS[(h >> 3) % PANTS.length];
    let shirt = PASSANT[(h >> 5) % PASSANT.length], hat = 0, pack = 0;
    if (k === 'etudiant') { shirt = ETUDIANT[(h >> 5) % ETUDIANT.length]; pack = PASSANT[(h >> 9) % PASSANT.length]; }
    else if (k === 'dealer') { shirt = 0x2a2438; hat = 0x2a2438; }
    else if (k === 'flic') { shirt = 0x2a4a9a; hat = 0x1a2a66; }
    else if (k === 'gang') {
      const d = DISTRICTS[getCity().districtAt(x, z)].color;
      shirt = d; hat = d;
    }
    r = { ph: (h % 628) / 100, ph0: (h % 628) / 100, x, z, fall: 0, moving: 0, shirt, pants: k === 'flic' ? 0x1f2f66 : k === 'dealer' ? 0x1b1b24 : pants, skin, hat, pack, seen: this.frame, kind };
    this.recs.set(id, r);
    return r;
  }

  update(peds: Float32Array | readonly number[], dt: number): void {
    this.frame++;
    const total = Math.min(Math.floor(peds.length / PED_STRIDE), MAX_PEDS);
    const P = this.parts;
    let nHat = 0, nPack = 0;
    for (let i = 0; i < total; i++) {
      const o = i * PED_STRIDE;
      const id = peds[o], kindIx = peds[o + 1], x = peds[o + 2], z = peds[o + 3], yaw = peds[o + 4], st = peds[o + 5];
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const r = this.rec(id, kindIx, x, z);
      r.seen = this.frame;
      const kind = PED_KINDS[kindIx] ?? 'passant';
      const speed = Math.hypot(x - r.x, z - r.z) / Math.max(dt, 0.001);
      r.x = x; r.z = z;
      const down = st === 2;
      const run = st === 1;
      const target = down || st === 3 || speed < 0.15 ? 0 : 1;
      r.moving += (target - r.moving) * Math.min(1, dt * 10);
      r.fall += ((down ? 1 : 0) - r.fall) * Math.min(1, dt * 9);
      // Cadence liée à la vitesse réelle (les pieds ne patinent pas), amplitude nette : marche posée, fuite très ample
      r.ph += dt * (run ? 15 : Math.max(5.5, Math.min(12, speed * 3.8))) * (0.4 + 0.6 * r.moving);
      const sw = Math.sin(r.ph) * (run ? 1.25 : 0.85) * r.moving;
      const bob = Math.abs(Math.cos(r.ph)) * (run ? 0.1 : 0.05) * r.moving;
      const idle = Math.sin(this.frame * 0.04 + r.ph0) * 0.06 * (1 - r.moving) * (1 - r.fall); // respiration à l'arrêt
      const size = kind === 'flic' ? 1.06 : kind === 'gang' ? 1.0 : kind === 'etudiant' ? 0.97 : 1;
      const wide = kind === 'gang' ? 1.22 : 1;
      const lean = (run ? 0.35 : kind === 'dealer' ? 0.22 : kind === 'flic' ? 0 : 0.07) * (1 - r.fall);
      const armK = kind === 'dealer' ? 0.35 : kind === 'flic' ? 1.1 : kind === 'gang' ? 0.8 : 1; // dealer : mains dans les poches ; flic : pas décidé

      // Racine : position, cap, chute (face au ciel, tête vers l'arrière)
      tmpQ.setFromAxisAngle(AY, yaw);
      tmpQ2.setFromAxisAngle(AX, r.fall * (Math.PI / 2) - lean);
      tmpQ.multiply(tmpQ2);
      root.compose(tmpP.set(x, 0.01 + r.fall * 0.24 + bob, z), tmpQ, tmpS.set(size * wide, size, size));

      const put = (part: Part, idx: number, px: number, py: number, pz: number, rx: number, color: number) => {
        local.compose(tmpP.set(px, py, pz), tmpQ.setFromAxisAngle(AX, rx), tmpS.set(1, 1, 1));
        tmpM.multiplyMatrices(root, local);
        part.mesh.setMatrixAt(idx, tmpM);
        this.col.setHex(color);
        part.mesh.setColorAt(idx, this.col);
      };
      const armUp = run ? -2.5 * (1 - r.fall) + r.fall * 1.2 : 0; // fuite : bras en l'air
      put(P.torso, i, 0, 1.44, 0, 0, r.shirt);
      put(P.head, i, 0, 1.44 + idle * 0.2, 0, Math.sin(r.ph * 2) * 0.06 * r.moving + idle, r.skin);
      put(P.legL, i, -0.12, 0.82, 0, sw + r.fall * 0.5, r.pants);
      put(P.legR, i, 0.12, 0.82, 0, -sw - r.fall * 0.3, r.pants);
      put(P.armL, i, -0.33, 1.4, 0, -sw * armK + idle + (run ? armUp * 0.7 : 0) + r.fall * 2.3, r.shirt);
      put(P.armR, i, 0.33, 1.4, 0, sw * armK - idle + (run ? armUp * 0.7 : 0) - r.fall * 1.6, r.shirt);
      if (r.hat) put(P.hat, nHat++, 0, 1.73, 0, 0, r.hat);
      if (r.pack) put(P.pack, nPack++, 0, 1.4, 0.2, 0, r.pack);
    }
    this.n = total;
    for (const key of ['torso', 'head', 'legL', 'legR', 'armL', 'armR'] as const) this.flush(P[key], total);
    this.flush(P.hat, nHat);
    this.flush(P.pack, nPack);
    // Oublie les piétons disparus
    if (this.frame % 120 === 0) for (const [id, r] of this.recs) if (this.frame - r.seen > 240) this.recs.delete(id);
  }

  private flush(p: Part, n: number) {
    p.mesh.count = n;
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    if (p.hull) p.hull.count = n;
  }

  dispose(): void {
    for (const p of Object.values(this.parts)) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.dispose();
      if (p.hull) { this.scene.remove(p.hull); p.hull.dispose(); }
    }
  }
}
