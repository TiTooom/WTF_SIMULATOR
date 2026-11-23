// PROPRIÉTAIRE : game-missions
// Médailles et récompenses : fonctions PURES (serveur : calcul réel ; client : affichage des seuils).
import { MEDAL_TIERS, type MedalTier } from '../ids';
import type { MissionDef } from './types';

/** Mesures d'une mission terminée. */
export interface RunStats { ms: number; damage: number; accuracy: number }

/** Multiplicateur de la récompense selon la médaille. */
export const MEDAL_MULT: Record<MedalTier, number> = { bronze: 1, argent: 1.25, or: 1.5 };
/** Part de la récompense versée quand on rejoue sans améliorer sa médaille (anti-ferme). */
export const REPLAY_SHARE = 0.4;

export const medalRank = (t: MedalTier | undefined | null): number => (t ? MEDAL_TIERS.indexOf(t) + 1 : 0);
export const betterMedal = (a: MedalTier | undefined, b: MedalTier | undefined): MedalTier | undefined => (medalRank(b) > medalRank(a) ? b : a);

const finite = (n: number, d: number) => (Number.isFinite(n) ? n : d);

/** La meilleure médaille dont TOUS les seuils sont respectés ; terminer la mission donne toujours au moins le bronze. */
export function medalFor(def: Pick<MissionDef, 'medals'>, s: RunStats): MedalTier {
  const ms = finite(s.ms, Infinity), dmg = finite(s.damage, Infinity), acc = finite(s.accuracy, 0);
  for (let i = MEDAL_TIERS.length - 1; i >= 1; i--) {
    const r = def.medals[MEDAL_TIERS[i]];
    if (ms <= r.ms && dmg <= r.maxDamage && acc >= r.minAccuracy) return MEDAL_TIERS[i];
  }
  return 'bronze';
}

/**
 * Précision (0..1) : actions réussies / (réussies + ratées). Réussies : étapes validées + cibles détruites + mini-jeux réussis ;
 * ratées : mini-jeux échoués + un tir par tranche de 5 au-delà de 5 tirs par cible détruite (tirer dans le vide coûte).
 */
export function accuracyOf(a: { steps: number; kills: number; mgOk: number; mgFail: number; shots: number }): number {
  const good = a.steps + a.kills + a.mgOk;
  const wasted = Math.floor(Math.max(0, a.shots - 5 * a.kills) / 5);
  const bad = a.mgFail + wasted;
  return good + bad <= 0 ? 1 : good / (good + bad);
}

/** Argent versé : `improved` = médaille meilleure que la précédente (ou première fois) -> récompense pleine ; sinon REPLAY_SHARE. */
export function rewardOf(def: Pick<MissionDef, 'reward'>, tier: MedalTier, improved: boolean): number {
  const full = Math.round(def.reward * MEDAL_MULT[tier]);
  return improved ? full : Math.round(full * REPLAY_SHARE);
}
