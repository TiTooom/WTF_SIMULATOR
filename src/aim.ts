// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : visée (curseur virtuel projeté sur le sol, verrouillage automatique sur la cible la plus proche) ; extraire de main.ts le calcul de visée.
import type { Vec3 } from '../shared/protocol';

export interface AimResult { origin: Vec3; dir: Vec3; yaw: number; lockedOn: boolean }

/** Squelette : pas de verrouillage, visée vers l'avant du personnage. */
export function computeAim(from: Vec3, yaw: number): AimResult {
  return { origin: [from[0], from[1] + 1.2, from[2]], dir: [-Math.sin(yaw), 0, -Math.cos(yaw)], yaw, lockedOn: false };
}
