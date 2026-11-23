// PROPRIÉTAIRE : game-camera-driving
// Caméra de dessus inclinée (style Chinatown Wars) : ressort amorti sur la cible, avance (look-ahead) proportionnelle à la vitesse,
// lacet léger (±15°) en virage, zoom et inclinaison selon la vitesse (plus proche à pied, plus éloignée et plus rasante à haute vitesse).
// Entièrement côté client ; aucune physique.
import * as THREE from 'three';
import type { Quat, Vec3 } from '../shared/protocol';

const PITCH_FOOT = (64 * Math.PI) / 180; // à pied : plus vertical (50-65° au total)
const PITCH_SLOW = (58 * Math.PI) / 180; // en véhicule à l'arrêt
const PITCH_FAST = (51 * Math.PI) / 180; // en véhicule à pleine vitesse : plus rasant, on voit plus loin
const CAM_FOOT_DIST = 15;
const CAM_LEAN_MAX = (15 * Math.PI) / 180; // pivot maximal en virage
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5; // zoom au choix du joueur (molette), mémorisé entre les parties
const SPRING_FOOT = 12; // pulsation propre du ressort (rad/s), amortissement critique
const SPRING_VEH = 8;
const SNAP_DIST = 40; // téléportation (réapparition, entrée en jeu) : on saute sans traverser la ville
const Y_UP = new THREE.Vector3(0, 1, 0);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  private pitch = PITCH_FOOT;
  private spSmooth = 0;
  private readonly pos = new THREE.Vector3(); // position du ressort
  private readonly vel = new THREE.Vector3();
  private started = false;
  private readonly target = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(readonly camera: THREE.PerspectiveCamera) {
    try {
      this.zoom = clamp(Number(localStorage.getItem('zoom')) || 1, ZOOM_MIN, ZOOM_MAX);
    } catch { /* stockage indisponible : zoom par défaut */ }
  }

  /** Molette : zoom multiplicatif, mémorisé. */
  zoomBy(deltaY: number) {
    this.zoom = clamp(this.zoom * Math.exp(deltaY * 0.001), ZOOM_MIN, ZOOM_MAX);
    try { localStorage.setItem('zoom', String(this.zoom)); } catch { /* ignoré */ }
  }

  /** Le joueur monte dans un véhicule : la caméra se redresse. */
  onEnterVehicle() { this.yaw = 0; }

  /** Place la caméra. À appeler une fois par image, avant tout calcul de visée. */
  update(rawDt: number, f: CamFollow) {
    const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.1);
    let dist = CAM_FOOT_DIST * Math.min(this.zoom, 1.6);
    let pitch = PITCH_FOOT;
    let ahead: [number, number] = [0, 0];
    let leanTarget = 0;
    let omega = SPRING_FOOT;
    if (f.veh) {
      this.q.set(...f.veh.q);
      const vy = this.euler.setFromQuaternion(this.q, 'YXZ').y;
      let dy = vy - this.lastVehYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.lastVehYaw = vy;
      const turnRate = dt > 0 ? dy / dt : 0;
      leanTarget = clamp(turnRate * 0.2, -CAM_LEAN_MAX, CAM_LEAN_MAX);
      const sp = f.veh.sp;
      this.spSmooth += (sp - this.spSmooth) * (1 - Math.exp(-3 * dt));
      const k = clamp(Math.abs(this.spSmooth) / 25, 0, 1); // 25 m/s = vitesse de pointe de la citadine
      const lead = clamp(this.spSmooth * 0.6, -9, 15);
      ahead = [-Math.sin(vy) * lead, -Math.cos(vy) * lead];
      dist = (Math.max(f.veh.camDistance * 0.9, 12) + k * 14) * this.zoom;
      pitch = PITCH_SLOW + (PITCH_FAST - PITCH_SLOW) * k;
      omega = SPRING_VEH;
    } else {
      this.spSmooth = 0;
    }

    // Réglages lissés
    const kc = 1 - Math.exp(-4 * dt);
    this.yaw += (leanTarget - this.yaw) * kc;
    this.lookAhead[0] += (ahead[0] - this.lookAhead[0]) * kc;
    this.lookAhead[1] += (ahead[1] - this.lookAhead[1]) * kc;
    this.dist += (dist - this.dist) * (1 - Math.exp(-2.5 * dt));
    this.pitch += (pitch - this.pitch) * (1 - Math.exp(-2 * dt));

    // Ressort amorti critique vers la cible suivie
    const tx = f.pos[0], ty = f.pos[1], tz = f.pos[2];
    if (!this.started || Math.hypot(tx - this.pos.x, tz - this.pos.z) > SNAP_DIST) {
      this.pos.set(tx, ty, tz);
      this.vel.set(0, 0, 0);
      this.started = true;
    } else {
      const n = Math.max(1, Math.ceil(dt / 0.016));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.vel.x += (omega * omega * (tx - this.pos.x) - 2 * omega * this.vel.x) * h;
        this.vel.y += (omega * omega * (ty - this.pos.y) - 2 * omega * this.vel.y) * h;
        this.vel.z += (omega * omega * (tz - this.pos.z) - 2 * omega * this.vel.z) * h;
        this.pos.addScaledVector(this.vel, h);
      }
    }

    this.target.set(this.pos.x + this.lookAhead[0], this.pos.y, this.pos.z + this.lookAhead[1]);
    this.offset.set(0, Math.sin(this.pitch), Math.cos(this.pitch)).multiplyScalar(this.dist).applyAxisAngle(Y_UP, this.yaw);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
