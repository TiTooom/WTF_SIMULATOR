// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : activités annexes (taxi, ambulance, pompier, justicier) déclenchées par la touche d'activité (Input.act) dans le véhicule correspondant (shared/activities.ts).
// Contrat : shared/game.ts (GameSystem, GameCtx). Jamais de corps Rapier gardé entre deux ticks (VRef + ctx.sim.resolveRef) ; serialize() sans lire Rapier.
import type { SystemFactory } from '../../shared/game';

export const createActivities: SystemFactory = (_ctx) => ({
  id: 'activities',
});
