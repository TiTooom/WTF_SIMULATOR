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
const SNAP_DIST = 25; // téléportation (réapparition, entrée en jeu) : on saute sans traverser la ville ; à 28 m/s le ressort accuse ~7 m de retard seulement
/** Réglages de la caméra à pied et des réactions aux commandes (tout est borné et lissé : pas de mal de mer). */
export const FOOT = {
  intentLead: 3.2, // m : décalage vers la direction demandée (touches enfoncées), plein régime
  velLead: 0.2, // s : décalage proportionnel à la vitesse réelle (course : un peu plus)
  velLeadMax: 2, // m
  aimFrac: 0.25, // part de la distance sol du curseur au centre de l'écran
  aimMax: 8, // m
  aimDead: 0.12, // zone morte autour du centre (NDC) : pas de dérive quand le curseur est au repos
  rate: 3.2, // 1/s : lissage de tout le décalage à pied
};
export const DRIVE = {
  steerLean: 0.6, // part du pivot maximal donnée instantanément par le volant (à pleine vitesse)
  handLean: 0.35, // pivot additionnel au frein à main en glissade
  gasZoom: 0.06, // +6 % de distance au gaz franc, -6 % au freinage
  slipBlend: 0.6, // part du cap de glissement (direction réelle du mouvement) dans la direction d'avance
};
const Y_UP = new THREE.Vector3(0, 1, 0);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface CamFollow {
  /** Position suivie (le joueur à pied, ou le véhicule). */
  pos: Vec3;
  /** Présent quand le joueur conduit. */
  veh?: {
    q: Quat; sp: number; camDistance: number; /** Vitesse de pointe du véhicule (m/s), défaut 25 : règle le zoom et l'avance. */ vmax?: number;
    /** Commandes du joueur : f avant(+)/arrière(-), s droite(+)/gauche(-), hb frein à main (0|1). Réaction immédiate de la caméra. */
    ctl?: { f: number; s: number; hb?: number };
  };
  /** À pied : intention de déplacement en axes écran (x droite, z bas), norme <= 1 (touches enfoncées). */
  intent?: { x: number; z: number };
  /** À pied : curseur virtuel en coordonnées normalisées (x -1..1 vers la droite, y -1..1 vers le HAUT). Le décalage ne dépend que de l'écran, jamais du point visé : pas de boucle de rétroaction. */
  cursor?: { x: number; y: number };
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
  private turnSmooth = 0; // vitesse de lacet filtrée (rad/s) : pas de tremblement du pivot
  private hadVeh = false;
  private slipW = 0; // glissade lissée (0..1)
  private gasSmooth = 0; // gaz(+)/frein(-) lissé
  private handSmooth = 0;
  private steerSmooth = 0;
  private prevPos: [number, number] | null = null;
  private prevMode = false;
  private modeAge = 0; // temps depuis le dernier passage à pied <-> véhicule (s)
  private readonly velEst: [number, number] = [0, 0];
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
  onEnterVehicle() { this.yaw = 0; this.hadVeh = false; }

  // Lecture seule (tests, debug)
  get lead() { return Math.hypot(this.lookAhead[0], this.lookAhead[1]); }
  /** Décalage horizontal courant du point regardé (m), tests. */
  get panX() { return this.lookAhead[0]; }
  get panZ() { return this.lookAhead[1]; }
  get distance() { return this.dist; }
  get pitchDeg() { return (this.pitch * 180) / Math.PI; }
  /** Point suivi par le ressort (sans l'avance). */
  get focusX() { return this.pos.x; }
  get focusZ() { return this.pos.z; }

  /** Téléportation connue de l'appelant (réapparition, hôpital) : le prochain `update` saute directement sur la cible, sans balayage ni avance résiduelle. */
  teleported() { this.started = false; }

  /** Place la caméra. À appeler une fois par image, avant tout calcul de visée. */
  update(rawDt: number, f: CamFollow) {
    const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.1);
    let dist = CAM_FOOT_DIST * Math.min(this.zoom, 1.6);
    let pitch = PITCH_FOOT;
    let ahead: [number, number] = [0, 0];
    let leanTarget = 0;
    let omega = SPRING_FOOT;
    let rate = 4; // lissage de l'avance et du pivot
    // Vitesse réelle du point suivi (différence de positions, filtrée) : sert à l'avance à pied et au cap de glissement
    const mode = !!f.veh;
    if (this.prevPos === null || mode !== this.prevMode || !this.started || dt <= 0) { this.velEst[0] = this.velEst[1] = 0; }
    else {
      const ex = (f.pos[0] - this.prevPos[0]) / dt, ez = (f.pos[2] - this.prevPos[1]) / dt;
      if (Math.hypot(ex, ez) < 80) { const kv = 1 - Math.exp(-6 * dt); this.velEst[0] += (ex - this.velEst[0]) * kv; this.velEst[1] += (ez - this.velEst[1]) * kv; }
    }
    this.prevPos = [f.pos[0], f.pos[2]];
    if (mode !== this.prevMode) this.modeAge = 0; else this.modeAge += dt;
    this.prevMode = mode;
    if (f.veh) {
      this.q.set(...f.veh.q);
      const vy = this.euler.setFromQuaternion(this.q, 'YXZ').y;
      if (!this.hadVeh) { this.lastVehYaw = vy; this.turnSmooth = 0; this.hadVeh = true; } // 1re image au volant : pas de pic de lacet
      let dy = vy - this.lastVehYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.lastVehYaw = vy;
      const turnRate = dt > 0 ? dy / dt : 0;
      this.turnSmooth += (turnRate - this.turnSmooth) * (1 - Math.exp(-7 * dt)); // filtre : le lacet interpolé à 30 Hz ne fait pas trembler l'image
      const sp = f.veh.sp;
      this.spSmooth += (sp - this.spSmooth) * (1 - Math.exp(-3 * dt));
      const kl = clamp(Math.abs(this.spSmooth) / (f.veh.vmax && f.veh.vmax > 5 ? f.veh.vmax : 25), 0, 1);
      const k = kl * kl * (3 - 2 * kl); // zoom progressif : peu de recul en dessous de ~40 % de la pointe
      // Commandes : réaction immédiate (le volant penche la caméra avant que la voiture n'ait tourné)
      const ctl = f.veh.ctl;
      const kk = 1 - Math.exp(-6 * dt);
      this.steerSmooth += (clamp(ctl?.s ?? 0, -1, 1) - this.steerSmooth) * kk;
      this.handSmooth += ((ctl?.hb ? 1 : 0) - this.handSmooth) * kk;
      const throttle = clamp(ctl?.f ?? 0, -1, 1);
      // gaz = avant en marche avant ; en marche arrière (sp < -1) l'arrière est le gaz
      const gas = this.spSmooth < -1 ? -throttle : throttle;
      this.gasSmooth += (gas - this.gasSmooth) * (1 - Math.exp(-3 * dt));
      const steerLean = -this.steerSmooth * DRIVE.steerLean * CAM_LEAN_MAX * Math.min(1, 0.25 + kl * 1.5) * (this.spSmooth < -1 ? -1 : 1);
      const handLean = this.handSmooth * Math.sign(this.turnSmooth || -this.steerSmooth) * DRIVE.handLean * CAM_LEAN_MAX * Math.min(1, kl * 2);
      leanTarget = clamp(this.turnSmooth * 0.2 + steerLean + handLean, -CAM_LEAN_MAX, CAM_LEAN_MAX);
      // Cap de glissement : l'avance suit la direction réelle du mouvement quand elle s'écarte du cap
      const lead = clamp(this.spSmooth * 0.6, -9, 15);
      const dirSign = this.spSmooth < -0.5 ? -1 : 1;
      let hx = -Math.sin(vy) * dirSign, hz = -Math.cos(vy) * dirSign;
      const vs = Math.hypot(this.velEst[0], this.velEst[1]);
      const slipTarget = vs > 5 ? clamp(1 - (hx * this.velEst[0] + hz * this.velEst[1]) / vs, 0, 1) * 2 : 0; // 0 aligné .. 1 à 60°+
      this.slipW += (clamp(slipTarget, 0, 1) - this.slipW) * (1 - Math.exp(-4 * dt));
      if (vs > 5 && this.slipW > 0.01) {
        const w = this.slipW * DRIVE.slipBlend;
        hx = hx * (1 - w) + (this.velEst[0] / vs) * w; hz = hz * (1 - w) + (this.velEst[1] / vs) * w;
        const n = Math.hypot(hx, hz) || 1; hx /= n; hz /= n;
      }
      ahead = [hx * Math.abs(lead), hz * Math.abs(lead)];
      dist = (clamp(CAM_FOOT_DIST + 2 + (f.veh.camDistance - 9), 15, 21) + k * 12) * this.zoom * (1 + DRIVE.gasZoom * this.gasSmooth * (0.4 + 0.6 * (1 - kl))); // toujours plus loin qu'à pied (15 m), jusqu'à ~29 m à pleine vitesse ; +-6 % au gaz / freinage
      pitch = PITCH_SLOW + (PITCH_FAST - PITCH_SLOW) * k;
      omega = SPRING_VEH;
    } else {
      this.spSmooth = 0;
      this.turnSmooth = 0;
      this.hadVeh = false;
      this.slipW = this.gasSmooth = this.handSmooth = this.steerSmooth = 0;
      // À pied : décalage vers l'intention (touches) et la vitesse réelle, puis légèrement vers le curseur
      rate = FOOT.rate;
      const it = f.intent;
      let ix = 0, iz = 0;
      if (it && Number.isFinite(it.x) && Number.isFinite(it.z)) { const n = Math.hypot(it.x, it.z); const m = n > 1 ? 1 / n : 1; ix = it.x * m; iz = it.z * m; }
      let vx = this.velEst[0] * FOOT.velLead, vz = this.velEst[1] * FOOT.velLead;
      const vn = Math.hypot(vx, vz);
      if (vn > FOOT.velLeadMax) { vx *= FOOT.velLeadMax / vn; vz *= FOOT.velLeadMax / vn; }
      ahead = [ix * FOOT.intentLead + vx, iz * FOOT.intentLead + vz];
      const c = f.cursor;
      if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
        // étendue au sol visible (m) approchée avec la distance lissée : ne dépend ni du point visé ni du décalage
        const halfH = (this.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.sin(PITCH_FOOT);
        const halfW = halfH * (this.camera.aspect || 16 / 9);
        const dead = (v: number) => { const a = Math.abs(v); return a < FOOT.aimDead ? 0 : Math.sign(v) * Math.min(1, (a - FOOT.aimDead) / (1 - FOOT.aimDead)); };
        let ox = dead(c.x) * halfW * FOOT.aimFrac, oz = -dead(c.y) * halfH * FOOT.aimFrac;
        const on = Math.hypot(ox, oz);
        if (on > FOOT.aimMax) { ox *= FOOT.aimMax / on; oz *= FOOT.aimMax / on; }
        ahead[0] += ox; ahead[1] += oz;
      }
    }

    // Réglages lissés
    rate *= clamp(this.modeAge / 0.8, 0.35, 1); // changement véhicule / à pied : le décalage se résorbe en douceur
    const kc = 1 - Math.exp(-rate * dt);
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
      this.lookAhead[0] = this.lookAhead[1] = 0; // l'avance de l'ancien endroit n'a plus de sens
      this.yaw = 0;
      this.dist = dist;
      this.pitch = pitch;
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
