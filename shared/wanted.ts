// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : indice de recherche en étoiles (0..5) : chaleur par crime, seuils d'étoiles, effectifs de police demandés ; détruire une voiture de police FAIT BAISSER l'indice.
import type { CrimeKind } from './ids';

/** Chaleur ajoutée par crime. À équilibrer. */
export const CRIME_HEAT: Record<CrimeKind, number> = {
  vol_vehicule: 0, pieton_renverse: 0, agression_flic: 0, flic_detruit: 0, deal_vu: 0, camera_detruite: 0, tir: 0, explosion: 0,
};

/** Nouvelle chaleur après un crime. */
export function addCrime(heat: number, kind: CrimeKind): number {
  return heat + CRIME_HEAT[kind];
}

/** Nouvelle chaleur après destruction d'une voiture de police (baisse d'une étoile). */
export function copDestroyed(heat: number): number {
  return heat;
}

/** Nombre de policiers à maintenir pour ce nombre d'étoiles. */
export function copsWanted(_stars: number): number {
  return 0;
}
