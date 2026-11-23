// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : argent et sac individuels, dealers (POI), achat/revente validés côté serveur (prix de shared/economy/prices.ts), planque, tuyaux par SMS, caméras de surveillance, privateView (money, bag, shop, stash, unread).
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createEconomy: SystemFactory = (_ctx) => ({
  id: 'economy',
});
