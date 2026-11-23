// Registre des véhicules. L'ORDRE est un contrat : l'index d'un véhicule dans le monde est stable (sauvegardes, snapshots).
// Les 4 véhicules de la ville (ids.ts). Le pool (VEHICLE_POOL) n'est alloué que pour les types présents ici.
import type { VehicleDef } from '../api';
import { def as citadine } from './citadine';
import { def as berline } from './berline';
import { def as camionnette } from './camionnette';
import { def as police } from './police';

export { VEHICLE_TYPES, type VehicleType } from '../ids';

export const VEHICLES: VehicleDef[] = [citadine, berline, camionnette, police];
export const VEHICLE_BY_TYPE = new Map(VEHICLES.map((d) => [d.type, d]));
