// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : piétons sur rails (≤ 80, données pures sans corps Rapier, shared/peds.ts), renversés (événement pedKnocked + crime pieton_renverse), pedsFlat() pour le snapshot.
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createPeds: SystemFactory = (_ctx) => ({
  id: 'peds',
  pedsFlat: () => [], // PED_STRIDE nombres par piéton : id, kind (index de PED_KINDS), x, z, yaw, st
});
