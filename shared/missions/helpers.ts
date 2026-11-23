// PROPRIÉTAIRE : game-missions
// Aides de description des missions : points de passage sur les intersections (toujours à ciel ouvert, jamais dans un bâtiment)
// et POI de la ville (donneur, caméras). Déterministe : identique serveur et client.
import type { DistrictId } from '../ids';
import { CITY, getCity, type Poi } from '../city/layout';

/** Intersection (i vers l'est, j vers le sud, 0..10). */
export const nodeXZ = (i: number, j: number): { x: number; z: number } => ({ x: -CITY.HALF + i * CITY.CELL, z: -CITY.HALF + j * CITY.CELL });

export const giverPoi = (d: DistrictId): Poi => {
  const p = getCity().poisOf('donneur').find((q) => q.district === d);
  if (!p) throw new Error(`Pas de donneur dans le quartier ${d}`);
  return p;
};

/** Caméra de surveillance la plus proche d'un point. */
export const cameraNear = (x: number, z: number): Poi => {
  let best: Poi | null = null, bd = Infinity;
  for (const c of getCity().poisOf('camera')) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
  if (!best) throw new Error('Aucune caméra');
  return best;
};
