// PROPRIÉTAIRE : game-missions
// Indice de recherche (0..5 étoiles) : PUR (aucun Rapier, aucune horloge). Règles :
//  - chaque crime ajoute de la « chaleur » (CRIME_HEAT) ; les étoiles sont des seuils de chaleur (STAR_AT) ;
//  - détruire des voitures de police FAIT BAISSER l'indice (règle de Chinatown Wars) : COPS_PER_STAR_DROP destructions = une étoile en moins ;
//  - SE FAIRE OUBLIER : si AUCUN flic ni caméra ne voit le joueur (cônes de vision + ligne de vue : shared/hiding.ts) pendant LOSE_DELAY_S[étoiles - 1]
//    secondes, une étoile tombe ; le compteur repart de zéro et le délai de l'étoile suivante s'applique, jusqu'à 0. Être revu remet le compteur à 0.
//  - états de recherche (WS) : 0 libre, 1 repéré (vu maintenant), 2 recherche (plus vu : les flics vont à la dernière position connue puis quadrillent),
//    3 caché (dans une cachette, invisible aux cônes).
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
/** OBSOLÈTES (ancienne évaporation lente, gardées pour les tests de l'économie) : plus utilisées par `tickWanted`. */
export const UNSEEN_DELAY_S = 45;
export const HEAT_DECAY_PER_S = 0.2;
/** Secondes passées sans être vu pour perdre UNE étoile, selon l'indice courant (1★ … 5★). */
export const LOSE_DELAY_S: readonly number[] = [8, 12, 18, 25, 35];
/** États de recherche publiés au HUD (champ `ws` de l'état privé). */
export const WS = { LIBRE: 0, REPERE: 1, RECHERCHE: 2, CACHE: 3 } as const;
/** Vitesse de pointe de la citadine du joueur (m/s) : référence des voitures de police. */
export const PLAYER_TOP_SPEED = 24.5;
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

/** Chaleur après la perte d'une étoile (même atterrissage que `copDestroyed` : un tiers du palier inférieur). */
function dropped(stars: number): number {
  const lower = stars - 1;
  return lower <= 0 ? 0 : STAR_AT[lower - 1] + 0.3 * (STAR_AT[lower] - STAR_AT[lower - 1]);
}

/**
 * Avance le temps de `dt` s ; `seen` = au moins un flic (cône + ligne de vue) ou une caméra voit le joueur.
 * Vu : le compteur `calm` repart à 0. Non vu : il croît, et quand il atteint LOSE_DELAY_S[étoiles - 1] une étoile tombe (calm remis à 0).
 */
export function tickWanted(w: WantedState, dt: number, seen: boolean): WantedState {
  if (!(dt > 0)) return w;
  if (seen || w.heat <= 0) return w.calm === 0 ? w : { ...w, calm: 0 };
  const calm = w.calm + dt;
  const stars = starsOf(w.heat);
  if (calm < LOSE_DELAY_S[Math.max(0, stars - 1)]) return { ...w, calm };
  return { heat: dropped(stars), kills: 0, calm: 0 };
}

/** Secondes restantes avant la prochaine étoile perdue si le joueur reste non vu (Infinity sans étoile). */
export function unseenLeft(w: WantedState): number {
  const stars = starsOf(w.heat);
  return w.heat <= 0 ? Infinity : Math.max(0, LOSE_DELAY_S[Math.max(0, stars - 1)] - w.calm);
}

/** État de recherche (WS) : 0 sans recherche, 1 repéré, 3 caché (et non vu), 2 recherche sinon. */
export function searchPhase(stars: number, seen: boolean, hidden: boolean): 0 | 1 | 2 | 3 {
  if (!(stars > 0)) return WS.LIBRE;
  if (seen) return WS.REPERE;
  return hidden ? WS.CACHE : WS.RECHERCHE;
}

/** Nombre de voitures de police à maintenir par joueur recherché : 1★ = 1, 2★ = 2, 3★ = 3, 4★ = 4, 5★ = 6 (le serveur plafonne à la taille du pool, 10). */
export function copsWanted(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return [0, 1, 2, 3, 4, 6][s];
}

/** Part de la vitesse de pointe du joueur (24,5 m/s) atteinte par la police : 1★ 55 %, 2★ 65 %, 3★ 75 %, 4★ 88 %, 5★ 100 %. */
const COP_SPEED_PART = [0, 0.55, 0.65, 0.75, 0.88, 1];
/** Vitesse maximale (m/s) des voitures de police à la poursuite (13,5 / 15,9 / 18,4 / 21,6 / 24,5). */
export function copSpeed(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return Math.round(PLAYER_TOP_SPEED * COP_SPEED_PART[s] * 10) / 10;
}

/** Facteurs de poussée et de braquage des voitures de police (moins vifs que le joueur : 0,60 → 0,90 de l'accélération, 0,75 → 0,95 du braquage). */
export function copAccelFactor(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return [0, 0.6, 0.65, 0.72, 0.8, 0.9][s];
}
export function copTurnFactor(stars: number): number {
  const s = Math.max(0, Math.min(5, Math.round(Number.isFinite(stars) ? stars : 0)));
  return [0, 0.75, 0.8, 0.85, 0.9, 0.95][s];
}
