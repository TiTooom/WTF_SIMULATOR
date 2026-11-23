// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : étoiles de recherche (shared/wanted.ts), voitures de police du pool, arrestation (playerBusted) et mort, destruction d'un véhicule de police = baisse de l'indice ; sim.setPlayerSnap(id, {ws}).
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createPolice: SystemFactory = (_ctx) => ({
  id: 'police',
});
