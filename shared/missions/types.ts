// PROPRIÉTAIRE : game-missions
// Modèle de mission (données pures, serveur ET client) : étapes, médailles, checkpoints. Format court : 3 à 7 minutes, rejouable.
// Chaque étape terminée est un checkpoint : après un échec, « rejouer » reprend à l'étape atteinte (voir server/systems/missions.ts).
// Les textes d'étape vont dans le message `me` (budget réseau serré) : 42 caractères au plus.
import type { DistrictId, MedalTier, MinigameKind } from '../ids';

export type MissionStep =
  /** Rejoindre un point (à pied ou en voiture). */
  | { t: 'aller'; x: number; z: number; r: number; text: string }
  /** Livrer : avec une voiture volée (étape `voler` précédente), il faut y être ; sinon comme `aller`. */
  | { t: 'livrer'; x: number; z: number; r: number; text: string }
  /** Voler un véhicule du type donné : une voiture verrouillée apparaît sur le parking (POI) le plus proche. */
  | { t: 'voler'; vehicle: string; text: string }
  /**
   * Détruire `count` cibles. `police` : l'indice monte à `stars` (2 par défaut) et revient à ce niveau tant qu'il en reste ;
   * `vehicule` : `count` véhicules ennemis (type `vehicle`, camionnette par défaut) apparaissent autour de (x, z) ; `camera` : une caméra de surveillance
   * (repère en x, z), détruite par un participant (tir ou explosion).
   */
  | { t: 'detruire'; target: 'police' | 'vehicule' | 'camera'; count: number; text: string; x?: number; z?: number; stars?: number; vehicle?: string }
  /** Faire tomber l'indice de recherche à zéro (il monte d'abord à `stars`) : en détruisant des voitures de police, pas en fuyant. */
  | { t: 'semer'; stars: number; text: string }
  /** Mini-jeu à pied près de (x, z) (rayon `r`, 4 m par défaut) ; relancé tant qu'il n'est pas réussi. */
  | { t: 'minijeu'; kind: MinigameKind; text: string; x: number; z: number; r?: number; difficulty?: number }
  | { t: 'attendre'; ms: number; text: string };

/** Seuils d'une médaille : temps (ms) au plus, dégâts subis (points, 100 = un joueur ou un véhicule détruit) au plus, précision (0..1) au moins. */
export interface MedalRule { ms: number; maxDamage: number; minAccuracy: number }

export interface MissionDef {
  id: string; // court (≤ 10 caractères, [a-z0-9_]) : circule dans `me.medals` et dans le message `mission`
  name: string;
  /** Résumé affiché dans le PDA. */
  blurb?: string;
  district: DistrictId;
  giver: string; // id du POI donneur
  /** Mission à terminer (au moins bronze) avant de pouvoir lancer celle-ci. */
  requires?: string;
  /** Temps total accordé (ms) : au-delà, la mission échoue. */
  timeLimitMs?: number;
  steps: MissionStep[];
  medals: Record<MedalTier, MedalRule>;
  reward: number;
}
