// PROPRIÉTAIRE : game-minigames
// À IMPLÉMENTER : sessions de mini-jeux : démarrage (mg_start), validation du résultat (durée plausible via shared/minigames/rules.ts, sid unique, annulation si éloigné/touché), événement minigameDone, commande /debug mg.
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createMinigames: SystemFactory = (_ctx) => ({
  id: 'minigames',
});
