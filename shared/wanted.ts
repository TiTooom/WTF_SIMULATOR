// PROPRIÉTAIRE : game-missions
// Indice de recherche (0..5 étoiles) : PUR (aucun Rapier, aucune horloge). Règles :
//  - chaque crime ajoute de la « chaleur » (CRIME_HEAT) ; les étoiles sont des seuils de chaleur (STAR_AT) ;
//  - détruire des voitures de police FAIT BAISSER l'indice (règle de Chinatown Wars) : COPS_PER_STAR_DROP destructions = une étoile en moins ;
//  - fuir ne suffit pas : aucune perte par simple éloignement. Seule exception, très lente et discrète : si AUCUN flic ne voit le joueur
//    pendant UNSEEN_DELAY_S secondes, la chaleur d'un joueur à 1 ou 2 étoiles (jamais plus) s'évapore à HEAT_DECAY_PER_S par seconde.
import type { CrimeKind } from './ids';

/** Chaleur ajoutée par crime. `flic_detruit` vaut 0 : c'est un signal pour les autres systèmes, l'effet est `copDestroyed` (baisse). */
export const CRIME_HEAT: Record<CrimeKind, number> = {
  vol_vehicule: 12,
  pieton_renverse: 14,
  agression_flic: 30,
  flic_detruit: 0,
  deal_vu: 20,
  camera_detruite: 25,
  tir: 8,
  explosion: 18,
};

/** Chaleur minimale pour 1, 2, 3, 4 et 5 étoiles. */
export const STAR_AT: readonly number[] = [10, 30, 60, 100, 150];
export const HEAT_MAX = 200;
/** Voitures de police à détruire pour perdre une étoile. */
export const COPS_PER_STAR_DROP = 2;
/** Secondes sans qu'aucun flic ne voie le joueur avant que la chaleur (≤ 2 étoiles) ne s'évapore. */
export const UNSEEN_DELAY_S = 45;
/** Chaleur perdue par seconde pendant l'évaporation (très lent : 60 de chaleur = 5 minutes). */
export const HEAT_DECAY_PER_S = 0.2;
/** Part de l'argent perdue à l'arrestation (le sac est entièrement confisqué) : le système d'économie l'applique sur `playerBusted`. */
export const BUST_MONEY_LOSS = 0.25;

export interface WantedState {
  heat: number; // 0..HEAT_MAX
  kills: number; // voitures de police détruites depuis la dernière baisse d'étoile
  calm: number; // secondes écoulées sans qu'un flic voie le joueur
}

export const newWanted = (): WantedState => ({ heat: 0, kills: 0, calm: 0 });

const clampHeat = (h: number) => (Number.isFinite(h) ? Math.max(0, Math.min(HEAT_MAX, h)) : 0);

/** Étoiles (0..5) pour une chaleur. */
export function starsOf(heat: number): number {
  let s = 0;
  for (let i = 0; i < STAR_AT.length; i++) if (heat >= STAR_AT[i]) s = i + 1;
  return s;
}

/** Chaleur d'entrée dans le palier de `stars` étoiles (0 pour 0). */
export function heatOfStars(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return s === 0 ? 0 : STAR_AT[s - 1];
}

/** Progression 0..1 dans le palier courant (vers l'étoile suivante). */
export function starProgress(heat: number): number {
  const s = starsOf(heat);
  const lo = s === 0 ? 0 : STAR_AT[s - 1];
  const hi = s >= 5 ? HEAT_MAX : STAR_AT[s];
  return Math.max(0, Math.min(1, (heat - lo) / (hi - lo)));
}

/** Nouvel état après un crime. */
export function addCrime(w: WantedState, kind: CrimeKind): WantedState {
  return { heat: clampHeat(w.heat + CRIME_HEAT[kind]), kills: w.kills, calm: 0 };
}

/**
 * Nouvel état après la destruction d'une voiture de police : toutes les COPS_PER_STAR_DROP destructions, l'indice baisse d'une étoile
 * (le joueur atterrit au tiers du palier inférieur). Sans étoile, rien à baisser : le compteur reste à 0.
 */
export function copDestroyed(w: WantedState): WantedState {
  const stars = starsOf(w.heat);
  if (stars === 0) return { heat: w.heat, kills: 0, calm: w.calm };
  const kills = w.kills + 1;
  if (kills < COPS_PER_STAR_DROP) return { heat: w.heat, kills, calm: w.calm };
  const lower = stars - 1;
  const heat = lower === 0 ? 0 : STAR_AT[lower - 1] + 0.3 * (STAR_AT[lower] - STAR_AT[lower - 1]);
  return { heat, kills: 0, calm: w.calm };
}

/** Avance le temps de `dt` s ; `seen` = au moins un flic voit le joueur. Évaporation très lente seulement à 1-2 étoiles. */
export function tickWanted(w: WantedState, dt: number, seen: boolean): WantedState {
  if (!(dt > 0)) return w;
  if (seen || w.heat <= 0) return w.calm === 0 ? w : { ...w, calm: 0 };
  const calm = w.calm + dt;
  if (calm <= UNSEEN_DELAY_S || starsOf(w.heat) > 2) return { ...w, calm };
  return { heat: Math.max(0, w.heat - HEAT_DECAY_PER_S * dt), kills: w.kills, calm };
}

/** Nombre de voitures de police à maintenir par joueur recherché (le serveur plafonne à la taille du pool, 10). */
export function copsWanted(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return [0, 1, 2, 3, 5, 7][s];
}

/** Vitesse maximale (m/s) des voitures de police à la poursuite. */
export function copSpeed(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return [0, 22, 25, 28, 30, 31][s];
}
