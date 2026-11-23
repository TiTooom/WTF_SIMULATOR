// PROPRIÉTAIRE : game-camera-driving (extrait de main.ts par l'intégrateur, comportement identique)
// À IMPLÉMENTER (spécialiste) : caméra à ressort amorti, look-ahead vectoriel, yaw dans les virages, zoom selon la vitesse.
// Caméra de dessus inclinée : suit la cible avec avance (look-ahead), pivote un peu en virage, s'éloigne avec la vitesse.
import * as THREE from 'three';
import type { Quat, Vec3 } from '../shared/protocol';

const CAM_PITCH = (58 * Math.PI) / 180; // inclinaison par rapport à l'horizontale
const CAM_FOOT_DIST = 16;
const CAM_LEAN_MAX = (15 * Math.PI) / 180; // pivot maximal en virage
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5; // zoom au choix du joueur (molette), mémorisé entre les parties
const Y_UP = new THREE.Vector3(0, 1, 0);

export interface CamFollow {
  /** Position suivie (le joueur à pied, ou le véhicule). */
  pos: Vec3;
  /** Présent quand le joueur conduit. */
  veh?: { q: Quat; sp: number; camDistance: number };
}

export class CameraRig {
  /** Pivot de la caméra autour de la verticale (0 = nord en haut de l'écran) : sert aussi à convertir les commandes à pied. */
  yaw = 0;
  /** Dernier cap du véhicule conduit (le joueur à pied repart de là en descendant). */
  lastVehYaw = 0;
  zoom = 1;
  private lookAhead: [number, number] = [0, 0];
  private dist = CAM_FOOT_DIST;
  private readonly target = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(readonly camera: THREE.PerspectiveCamera) {
    try {
      this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(localStorage.getItem('zoom')) || 1));
    } catch { /* stockage indisponible : zoom par défaut */ }
  }

  /** Molette : zoom multiplicatif, mémorisé. */
  zoomBy(deltaY: number) {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * Math.exp(deltaY * 0.001)));
    try { localStorage.setItem('zoom', String(this.zoom)); } catch { /* ignoré */ }
  }

  /** Le joueur monte dans un véhicule : la caméra se redresse. */
  onEnterVehicle() { this.yaw = 0; }

  /** Place la caméra. À appeler une fois par image, avant tout calcul de visée. */
  update(dt: number, f: CamFollow) {
    let dist = CAM_FOOT_DIST;
    let ahead: [number, number] = [0, 0];
    let leanTarget = 0;
    if (f.veh) {
      this.q.set(...f.veh.q);
      const vy = this.euler.setFromQuaternion(this.q, 'YXZ').y;
      let dy = vy - this.lastVehYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.lastVehYaw = vy;
      const turnRate = dt > 0 ? dy / dt : 0;
      leanTarget = Math.max(-CAM_LEAN_MAX, Math.min(CAM_LEAN_MAX, turnRate * 0.2));
      const sp = Math.abs(f.veh.sp);
      const lead = Math.min(14, sp * 0.45) * Math.sign(f.veh.sp || 1);
      ahead = [-Math.sin(vy) * lead, -Math.cos(vy) * lead];
      dist = Math.max(f.veh.camDistance * 0.9, 12) + Math.min(24, sp * 0.6);
      dist *= this.zoom;
    } else {
      dist *= Math.min(this.zoom, 1.6);
    }
    const kc = 1 - Math.exp(-4 * dt);
    this.yaw += (leanTarget - this.yaw) * kc;
    this.lookAhead[0] += (ahead[0] - this.lookAhead[0]) * kc;
    this.lookAhead[1] += (ahead[1] - this.lookAhead[1]) * kc;
    this.dist += (dist - this.dist) * (1 - Math.exp(-2.5 * dt));
    this.target.set(f.pos[0] + this.lookAhead[0], f.pos[1], f.pos[2] + this.lookAhead[1]);
    this.offset.set(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH)).multiplyScalar(this.dist).applyAxisAngle(Y_UP, this.yaw);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
