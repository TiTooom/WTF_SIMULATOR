// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : piétons sur rails (tour des îlots sur les trottoirs), fonction pure stepPed (aucun Rapier, aucune horloge globale).
import type { PedKind } from './ids';

export interface PedState {
  id: number;
  kind: PedKind;
  x: number;
  z: number;
  yaw: number;
  st: number; // état d'animation (0 = marche, 1 = court, 2 = renversé…)
  block: number; // îlot suivi
  t: number; // abscisse sur le rail
}

/** Avance un piéton de `dt` secondes (pur : modifie et retourne `ped`). Squelette : immobile. */
export function stepPed(ped: PedState, _dt: number): PedState {
  return ped;
}
