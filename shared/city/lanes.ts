// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : voies de circulation à droite (2 par tronçon) construites sur le graphe de getCity() ; lanesOf(), nextLane() (choix de la voie suivante à l'intersection).
import type { CityLayout } from './layout';

export interface Lane {
  id: number;
  edge: number; // id du tronçon (CityLayout.edges)
  from: number; // id du nœud de départ (sens de circulation)
  to: number; // id du nœud d'arrivée
  x0: number; z0: number; x1: number; z1: number; // axe de la voie (droite de la chaussée)
  yaw: number; // cap du véhicule sur cette voie
}

/** Toutes les voies de la ville. */
export function lanesOf(_city: CityLayout): Lane[] {
  return [];
}

/** Voie à prendre après `lane` (tout droit, gauche ou droite selon `rnd` ∈ [0,1[), ou null si impasse. */
export function nextLane(_city: CityLayout, _lane: Lane, _rnd: number): Lane | null {
  return null;
}
