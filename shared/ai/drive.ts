// PROPRIÉTAIRE : game-camera-driving
// steerTo : contrôleur d'IA qui produit un Input (f, s, jump) pour rejoindre une cible (trafic, police, missions) ; v.ai.input le reçoit.
// Pur et déterministe. Le seul état est `opts.mem`, fourni et conservé par l'appelant (détection « coincé » -> marche arrière).
import type { Input } from '../protocol';

export interface Pose { x: number; z: number; yaw: number; speed: number }

/** Mémoire de conduite d'un véhicule d'IA (un objet par véhicule, à conserver entre les appels). */
export interface DriveMem {
  stuck: number; // secondes passées presque à l'arrêt alors qu'on voulait avancer
  rev: number; // secondes de marche arrière restantes
}
export const newDriveMem = (): DriveMem => ({ stuck: 0, rev: 0 });

export interface DriveOpts {
  maxSpeed: number; // m/s
  arriveRadius?: number; // défaut 3 m : à l'intérieur, on s'arrête
  brakeFor?: number; // distance d'un obstacle devant (m), Infinity = rien
  /** Temps écoulé depuis l'appel précédent (s), défaut 1/20. Nécessaire avec `mem`. */
  dt?: number;
  mem?: DriveMem;
  /** Freinage confortable (m/s²), défaut 9. */
  decel?: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Retourne les commandes pour aller de `pose` vers `target` : braquage proportionnel à l'écart de cap, vitesse limitée dans les virages
 * serrés, freinage anticipé (v² = 2·a·d) vers la cible et devant un obstacle, frein à main pour les très gros écarts à vitesse élevée,
 * marche arrière si la voiture est coincée ou si la cible est juste derrière.
 */
export function steerTo(pose: Pose, target: { x: number; z: number }, opts: DriveOpts): Partial<Input> {
  const dx = target.x - pose.x, dz = target.z - pose.z;
  const dist = Math.hypot(dx, dz);
  const arrive = opts.arriveRadius ?? 3;
  const dt = opts.dt ?? 0.05;
  const decel = opts.decel ?? 9;
  const mem = opts.mem;
  if (!(dist === dist) || !Number.isFinite(pose.yaw)) return { f: 0, s: 0, jump: 0 };

  if (dist <= arrive) {
    if (mem) { mem.stuck = 0; mem.rev = 0; }
    return { f: pose.speed > 1 ? -0.6 : pose.speed < -1 ? 0.6 : 0, s: 0, jump: 0 };
  }

  const want = Math.atan2(-dx, -dz); // cap vers la cible (l'avant d'un véhicule de lacet y est (-sin y, -cos y))
  const err = wrap(want - pose.yaw);

  // Marche arrière en cours (coincé) : on recule en braquant à l'opposé pour dégager le nez
  if (mem && mem.rev > 0) {
    mem.rev -= dt;
    return { f: -1, s: clamp(err * 2, -1, 1), jump: 0 };
  }
  // Cible juste derrière et proche : demi-tour en marche arrière plutôt qu'en tournant en rond
  if (Math.abs(err) > 2.2 && dist < 14 && pose.speed < 3) {
    return { f: -1, s: clamp(wrap(err - Math.PI) * 2, -1, 1), jump: 0 };
  }

  // Cap : braquage franc, saturé
  const s = clamp(-err * 2.2, -1, 1);

  // Vitesse cible : plafond, virage serré (on ralentit), freinage anticipé vers la cible, obstacle
  let vt = opts.maxSpeed;
  vt *= 1 - 0.65 * clamp(Math.abs(err) / 1.3, 0, 1);
  vt = Math.min(vt, Math.sqrt(2 * decel * Math.max(0, dist - arrive * 0.5)));
  const obstacle = opts.brakeFor ?? Infinity;
  if (Number.isFinite(obstacle)) vt = Math.min(vt, Math.sqrt(2 * decel * Math.max(0, obstacle - 5)));
  vt = Math.max(vt, dist > 12 && !(obstacle < 8) ? 4 : 0); // jamais de vitesse nulle loin de la cible, sauf obstacle proche

  const f = clamp((vt - pose.speed) * 0.6, -1, 1);
  const hard = pose.speed > 12 && Math.abs(err) > 1.1 && dist > 15 ? 1 : 0; // grosse erreur de cap à vitesse élevée : on dérape pour tourner

  // Coincé : on voulait avancer et on ne bouge pas
  if (mem) {
    if (f > 0.3 && Math.abs(pose.speed) < 0.6) mem.stuck += dt;
    else mem.stuck = Math.max(0, mem.stuck - dt * 2);
    if (mem.stuck > 1.2) { mem.stuck = 0; mem.rev = 1.4; }
  }
  return { f, s, jump: hard };
}

/**
 * Avance sur une liste de points de passage : retourne l'indice courant mis à jour. Un point est considéré atteint dès qu'on est à
 * moins de `reach + vitesse × 0,35` m (on coupe les coins à grande vitesse).
 */
export function advanceWaypoint(pose: Pose, pts: { x: number; z: number }[], index: number, reach = 6): number {
  let i = index;
  while (i < pts.length - 1) {
    const d = Math.hypot(pts[i].x - pose.x, pts[i].z - pose.z);
    if (d < reach + Math.abs(pose.speed) * 0.35) i++;
    else break;
  }
  return i;
}
