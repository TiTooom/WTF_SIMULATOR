// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : steerTo — contrôleur d'IA qui produit un Input (f, s, jump) pour suivre une cible (trafic, police, missions) ; v.ai.input le reçoit.
import type { Input } from '../protocol';

export interface Pose { x: number; z: number; yaw: number; speed: number }
export interface DriveOpts {
  maxSpeed: number; // m/s
  arriveRadius?: number;
  brakeFor?: number; // distance d'un obstacle devant (m), Infinity = rien
}

/** Retourne les commandes pour aller de `pose` vers `target`. Squelette : n'avance pas. */
export function steerTo(_pose: Pose, _target: { x: number; z: number }, _opts: DriveOpts): Partial<Input> {
  return { f: 0, s: 0, jump: 0 };
}
