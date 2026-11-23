// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : 5 missions (une par quartier, shared/missions/*), checkpoints, médailles bronze/argent/or, rejouable, privateView (mission, medals).
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createMissions: SystemFactory = (_ctx) => ({
  id: 'missions',
});
