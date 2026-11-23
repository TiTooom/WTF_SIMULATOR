// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : trafic civil (≤ 24 voitures du pool pilotées par v.ai.input via shared/ai/drive.ts et shared/city/lanes.ts), apparition/disparition autour des joueurs, fuite des civils.
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createTraffic: SystemFactory = (_ctx) => ({
  id: 'traffic',
});
