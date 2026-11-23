// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : les 5 missions (une par quartier).
import type { MissionDef } from './types';

export const MISSIONS: MissionDef[] = [];
export const missionById = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);
