// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : activités annexes (taxi, ambulance, pompier, justicier) : véhicule requis, récompense, durée.
import type { VehicleType } from './ids';

export type ActivityKind = 'taxi' | 'ambulance' | 'pompier' | 'justicier';
export interface ActivityDef { kind: ActivityKind; name: string; vehicle: VehicleType | null; reward: number }

export const ACTIVITIES: ActivityDef[] = [];
