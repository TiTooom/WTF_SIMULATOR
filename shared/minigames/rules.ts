// PROPRIÉTAIRE : game-minigames
// À IMPLÉMENTER : règles de chaque mini-jeu (durées plausibles, distance d'annulation, validation du résultat par le serveur à partir de la graine et de la difficulté).
import type { MinigameKind } from '../ids';
import type { MinigameResult } from '../protocol';

export interface MinigameRule {
  minMs: number; // durée minimale plausible (un résultat plus rapide est refusé)
  maxMs: number; // durée maximale (au-delà : échec)
  cancelDist: number; // m : annulé si le joueur s'éloigne de plus que ça
  validate(seed: number, difficulty: number, result: MinigameResult): boolean;
}

const rule = (minMs: number, maxMs: number): MinigameRule => ({ minMs, maxMs, cancelDist: 4, validate: (_seed, _d, r) => r.ok });

/** Squelette : toute réussite plausible en durée est acceptée. À durcir par jeu. */
export const RULES: Record<MinigameKind, MinigameRule> = {
  tournevis: rule(800, 6000),
  court_circuit: rule(800, 6000),
  digicode: rule(900, 6000),
  dosage: rule(900, 6000),
  fouille: rule(800, 6000),
  brise_glace: rule(600, 6000),
  desamorcage: rule(700, 6000),
  liasses: rule(800, 6000),
};
