// PROPRIÉTAIRE : game-missions
// Les 5 missions (une par quartier, dans l'ordre de déblocage). Données pures, identiques serveur et client.
import type { MissionDef } from './types';
import { ANNALES } from './campus';
import { SARDINES } from './docks';
import { FROMAGE } from './vieux_bourg';
import { ECROUS } from './zone_indus';
import { GOLF } from './les_hauts';

export const MISSIONS: MissionDef[] = [ANNALES, SARDINES, FROMAGE, ECROUS, GOLF];
export const missionById = (id: string): MissionDef | undefined => MISSIONS.find((m) => m.id === id);

export type { MissionDef, MissionStep, MedalRule } from './types';
