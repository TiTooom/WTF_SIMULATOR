// Registre des véhicules. L'ORDRE est un contrat : l'index d'un véhicule dans le monde est stable (sauvegardes, snapshots).
import type { VehicleDef } from '../api';
import { def as car } from './car';
import { def as excavator } from './excavator';
import { def as tank } from './tank';
import { def as camion_articule } from './camion_articule';
import { def as caddie_turbo } from './caddie_turbo';
import { def as camion_glaces } from './camion_glaces';
import { def as toilettes_roulettes } from './toilettes_roulettes';
import { def as avion_chasse } from './avion_chasse';
import { def as helicoptere } from './helicoptere';
import { def as ovni } from './ovni';
import { def as canape_fusee } from './canape_fusee';
import { def as dirigeable_pedales } from './dirigeable_pedales';

/** Tous les types dans l'ordre du contrat ; les types pas encore écrits (null) sont ignorés. */
export const VEHICLE_TYPES = [
  'car', 'excavator', 'tank', 'camion_articule', 'caddie_turbo', 'camion_glaces', 'toilettes_roulettes',
  'avion_chasse', 'helicoptere', 'ovni', 'canape_fusee', 'dirigeable_pedales',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

const ALL: Array<VehicleDef | null> = [
  car, excavator, tank, camion_articule, caddie_turbo, camion_glaces, toilettes_roulettes,
  avion_chasse, helicoptere, ovni, canape_fusee, dirigeable_pedales,
];
export const VEHICLES: VehicleDef[] = ALL.filter((d): d is VehicleDef => d !== null);
export const VEHICLE_BY_TYPE = new Map(VEHICLES.map((d) => [d.type, d]));
