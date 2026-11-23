// Dessin des projectiles. `kind` (PROJ_STRIDE[1]) est un INDEX dans PROJECTILE_KINDS (shared/constants, partagé avec le serveur).
// Ajouter une apparence : ajouter une entrée à LOOKS (nom → fabrique de mesh) et, si besoin, sa traînée dans TRAILS.
import * as THREE from 'three';
import { PROJECTILE_KINDS } from '../shared/constants';
import { PROJ_STRIDE } from '../shared/protocol';
import { outlined, toon } from './gfx';
import type { Fx } from './fx';

/** Index de kind dans le snapshot = index dans PROJECTILE_KINDS (shared/constants). */
const PROJ_KINDS: readonly string[] = PROJECTILE_KINDS;

const basic = (c: number) => new THREE.MeshBasicMaterial({ color: c });
// Géométries partagées par tous les projectiles (jamais recréées : pas de fuite GPU)
const G = {
  sphere: new THREE.SphereGeometry(0.14, 12, 8),
  rBody: new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10).rotateX(Math.PI / 2),
  rNose: new THREE.ConeGeometry(0.12, 0.3, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
  rFlame: new THREE.ConeGeometry(0.1, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0, 0.6),
  rFin: new THREE.BoxGeometry(0.4, 0.03, 0.18).translate(0, 0, 0.3),
  tracer: new THREE.BoxGeometry(0.06, 0.06, 1.3),
  bottle: new THREE.CylinderGeometry(0.09, 0.11, 0.3, 10).rotateX(Math.PI / 2),
  neck: new THREE.CylinderGeometry(0.04, 0.06, 0.14, 8).rotateX(Math.PI / 2).translate(0, 0, -0.2),
  flame: new THREE.ConeGeometry(0.1, 0.3, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.36),
};
const mat = { white: basic(0xfff1a8), core: basic(0xffffff), flame: basic(0xffa633), flame2: basic(0xffe27a) };

type Look = () => THREE.Object3D;
/** Les modèles regardent vers −z (l'objet est orienté le long de sa vitesse). */
export const LOOKS: Record<string, Look> = {
  rocket: () => {
    const g = new THREE.Group();
    g.add(outlined(new THREE.Mesh(G.rBody, toon(0xe8e8ee)), 0.03), outlined(new THREE.Mesh(G.rNose, toon(0xe74c3c)), 0.03));
    g.add(new THREE.Mesh(G.rFin, toon(0xe74c3c)), new THREE.Mesh(G.rFlame, mat.flame));
    return g;
  },
  grenade: () => {
    // l'œuf tourne sur lui-même (voir update) ; goupille jaune pour la lisibilité
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.add(outlined(new THREE.Mesh(G.sphere, toon(0x4a7a3a)), 0.03), new THREE.Mesh(G.rFlame.clone().scale(0.2, 0.2, 0.1).translate(0, 0.14, 0), mat.white));
    g.add(body);
    g.userData.spin = body;
    return g;
  },
  molotov: () => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.add(outlined(new THREE.Mesh(G.bottle, toon(0x2f9e44)), 0.025), new THREE.Mesh(G.neck, toon(0x2f9e44)), new THREE.Mesh(G.flame, mat.flame));
    g.add(body);
    g.userData.spin = body;
    return g;
  },
  bullet: () => {
    // traceur : cœur blanc, assez long pour se lire à 30 m/s sur une image
    const g = new THREE.Group();
    g.add(new THREE.Mesh(G.tracer, mat.white));
    return g;
  },
};
const unknown: Look = () => outlined(new THREE.Mesh(G.sphere, toon(0xffffff)), 0.03);

type Trail = (fx: Fx, p: THREE.Vector3, v: THREE.Vector3, dt: number) => void;
/** Traînées par nom de kind. */
export const TRAILS: Record<string, Trail> = {
  rocket: (fx, p) => {
    fx.puff(p, 0.4);
    fx.spawn(p, [0, 0.3, 0], 0.25, 0.28, 0.05, 0xffe27a, 0xff6a1a);
  },
  grenade: (fx, p) => fx.spawn(p, [0, 0.2, 0], 0.15, 0.06, 0.02, 0xfff1a8, 0xfff1a8),
  molotov: (fx, p) => {
    fx.spawn(p, [0, 0.8, 0], 0.35, 0.16, 0.03, 0xffe27a, 0xff5a1a);
    fx.puff(p, 0.25, true);
  },
  bullet: (fx, p) => fx.spawn(p, [0, 0, 0], 0.12, 0.05, 0.01, 0xfff1a8, 0xff9a3a),
};

export class ProjectilesView {
  private meshes = new Map<number, { obj: THREE.Object3D; kind: number; trail: number }>();
  count = 0;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, -1);
  private n = new THREE.Vector3();

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
        this.q.setFromUnitVectors(this.fwd, this.n.copy(this.v).normalize());
        e.obj.quaternion.copy(this.q);
      }
      const spin = e.obj.userData.spin as THREE.Object3D | undefined;
      if (spin) spin.rotation.x -= dt * 14;
      const tr = TRAILS[PROJ_KINDS[kind]];
      if (tr) {
        e.trail += dt;
        if (e.trail > (PROJ_KINDS[kind] === 'bullet' ? 0.02 : 0.04)) { e.trail = 0; tr(this.fx, this.p, this.v, dt); }
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
