// Registre des véhicules. L'ORDRE est un contrat : l'index d'un véhicule dans le monde est stable (sauvegardes, snapshots).
// Vague 1 : une seule définition, la `citadine` (ex-`car`, TEMPORAIRE). Les 4 véhicules de la ville (ids.ts) arrivent en vague 2.
// Le pool (VEHICLE_POOL) n'est alloué que pour les types présents ici.
import type { VehicleDef } from '../api';
import { def as citadine } from './car';

export { VEHICLE_TYPES, type VehicleType } from '../ids';

export const VEHICLES: VehicleDef[] = [citadine];
export const VEHICLE_BY_TYPE = new Map(VEHICLES.map((d) => [d.type, d]));
