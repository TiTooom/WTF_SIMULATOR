// Dessin des projectiles. `kind` (PROJ_STRIDE[1]) est un INDEX dans PROJ_KINDS (tableau ordonné, partagé avec le serveur
// uniquement par convention) ; pour rester indépendant du serveur, on reconnaît aussi le kind par son nom : voir kindName().
// Ajouter une apparence : ajouter une entrée à LOOKS (nom → fabrique de mesh) et, si besoin, sa traînée dans TRAILS.
import * as THREE from 'three';
import { PROJ_STRIDE } from '../shared/protocol';
import { outlined, toon } from './gfx';
import type { Fx } from './fx';

/** Ordre conventionnel des kinds de projectiles dans le snapshot (le serveur numérote dans cet ordre ; kind inconnu = sphère blanche). */
export const PROJ_KINDS = [
  'rocket', 'grenade', 'bullet', 'chicken', 'tomato', 'watermelon', 'confetti', 'cushion', 'cone', 'cannonball', 'sucker', 'mine',
];

const basic = (c: number) => new THREE.MeshBasicMaterial({ color: c });
const sphere = (r: number, c: number, o = true) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), toon(c));
  return o ? outlined(m, 0.03) : m;
};

type Look = () => THREE.Object3D;
/** Les modèles regardent vers −z (l'objet est orienté le long de sa vitesse). */
export const LOOKS: Record<string, Look> = {
  rocket: () => {
    const g = new THREE.Group();
    const body = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10).rotateX(Math.PI / 2), toon(0xe8e8ee)), 0.03);
    const nose = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5), toon(0xe74c3c)), 0.03);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.55), basic(0xffa633));
    g.add(body, nose, flame);
    return g;
  },
  grenade: () => sphere(0.14, 0x4a7a3a),
  bullet: () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.1), basic(0xfff1a8));
    return m;
  },
  chicken: () => {
    const g = new THREE.Group();
    g.add(sphere(0.25, 0xffffff), sphere(0.13, 0xffffff).translateZ(-0.26).translateY(0.12));
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6).rotateX(-Math.PI / 2), toon(0xff9f1c));
    beak.position.set(0, 0.12, -0.42);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.12), toon(0xe63946));
    comb.position.set(0, 0.3, -0.26);
    g.add(beak, comb);
    return g;
  },
  tomato: () => sphere(0.17, 0xe63946),
  watermelon: () => sphere(0.38, 0x2d9b4a),
  confetti: () => sphere(0.12, 0xff8fab, false),
  cushion: () => outlined(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), toon(0xf4a6c0)), 0.03),
  cone: () => outlined(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 10), toon(0xff7f11)), 0.03),
  cannonball: () => sphere(0.2, 0x2b2b35),
  sucker: () => {
    const g = new THREE.Group();
    g.add(outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8).rotateX(Math.PI / 2), toon(0xd4a76a)), 0.02));
    g.add(outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, -0.22), toon(0xe63946)), 0.02));
    return g;
  },
  mine: () => outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 12), toon(0x555a66)), 0.03),
};
const unknown: Look = () => sphere(0.12, 0xffffff, false);

type Trail = (fx: Fx, p: THREE.Vector3, v: THREE.Vector3, dt: number) => void;
/** Traînées par nom de kind. */
export const TRAILS: Record<string, Trail> = {
  rocket: (fx, p) => {
    fx.puff(p, 0.3);
    fx.spawn(p, [0, 0.3, 0], 0.25, 0.25, 0.05, 0xffe27a, 0xff6a1a);
  },
  chicken: () => {},
  confetti: (fx, p) => fx.spawn(p, [0, 0, 0], 0.5, 0.1, 0.02, 0xffca3a, 0xff8fab, -3),
};

export class ProjectilesView {
  private meshes = new Map<number, { obj: THREE.Object3D; kind: number; trail: number }>();
  count = 0;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, -1);

  constructor(private scene: THREE.Scene, private fx: Fx) {}

  update(data: Float32Array, dt: number) {
    const n = Math.floor(data.length / PROJ_STRIDE);
    const seen = new Set<number>();
    for (let c = 0; c < n; c++) {
      const o = c * PROJ_STRIDE;
      const id = data[o], kind = data[o + 1];
      seen.add(id);
      let e = this.meshes.get(id);
      if (!e) {
        const obj = (LOOKS[PROJ_KINDS[kind]] ?? unknown)();
        e = { obj, kind, trail: 0 };
        this.meshes.set(id, e);
        this.scene.add(obj);
      }
      this.p.set(data[o + 2], data[o + 3], data[o + 4]);
      this.v.set(data[o + 5], data[o + 6], data[o + 7]);
      e.obj.position.copy(this.p);
      if (this.v.lengthSq() > 0.01) {
        this.q.setFromUnitVectors(this.fwd, this.v.clone().normalize());
        e.obj.quaternion.copy(this.q);
      }
      const tr = TRAILS[PROJ_KINDS[kind]];
      if (tr) {
        e.trail += dt;
        if (e.trail > 0.04) { e.trail = 0; tr(this.fx, this.p, this.v, dt); }
      }
    }
    for (const [id, e] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(e.obj);
        this.meshes.delete(id);
      }
    }
    this.count = this.meshes.size;
  }
}
