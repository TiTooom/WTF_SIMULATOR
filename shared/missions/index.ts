// PROPRIÉTAIRE : game-missions
// Les 5 missions (une par quartier, dans l'ordre de déblocage). Données pures, identiques serveur et client.
import type { MissionDef } from './types';
import { ANNALES } from './campus';
import { SARDINES } from './saint_leu';
import { FROMAGE } from './cathedrale';
import { ECROUS } from './amiens_nord';
import { GOLF } from './citadelle';

export const MISSIONS: MissionDef[] = [ANNALES, SARDINES, FROMAGE, ECROUS, GOLF];
export const missionById = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);

export type { MissionDef, MissionStep, MedalRule } from './types';
