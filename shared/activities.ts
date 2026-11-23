// PROPRIÉTAIRE : game-missions
// Activités annexes déclenchées par la touche d'activité (Input.act) dans le véhicule correspondant. Données et formules PURES.
//  - Taxi : berline de livrée 1 ; un client (marqueur) à prendre, puis à déposer ; pourboire selon le temps.
//  - Justicier : voiture de police ; des fuyards apparaissent sur la carte : les détruire ou les rattraper baisse l'indice et rapporte.
//  - Ambulance et pompier : plus tard (le type existe dans le protocole).
import type { VehicleType } from './ids';

export type ActivityKind = 'taxi' | 'ambulance' | 'pompier' | 'justicier';
export interface ActivityDef { kind: ActivityKind; name: string; vehicle: VehicleType | null; reward: number; blurb: string }

export const ACTIVITIES: ActivityDef[] = [
  { kind: 'taxi', name: 'Taxi', vehicle: 'berline', reward: 60, blurb: 'Dans une berline de taxi : appuie sur la touche d\'activité, prends le client puis dépose-le vite (pourboire).' },
  { kind: 'justicier', name: 'Justicier', vehicle: 'police', reward: 150, blurb: 'Dans une voiture de police : des fuyards apparaissent. Détruis-les ou colle-les, l\'indice baisse.' },
];
export const activityOf = (k: ActivityKind): ActivityDef | undefined => ACTIVITIES.find((a) => a.kind === k);

// ---------- Taxi ----------
/** Livrée (index de couleur) d'une berline de taxi. */
export const TAXI_LIVERY = 1;
export const TAXI_PICKUP_MIN = 80, TAXI_PICKUP_MAX = 190; // m : distance du client
export const TAXI_RIDE_MIN = 150, TAXI_RIDE_MAX = 330; // m : distance de la course
export const TAXI_STOP_R = 9; // m : rayon d'arrêt (prise en charge et dépose)
export const TAXI_STOP_SPEED = 6; // m/s : vitesse maximale pour s'arrêter
export const TAXI_BOARD_S = 1; // s d'arrêt pour que le client monte
/** Prix de la course (€) pour une distance à vol d'oiseau. */
export const taxiFare = (dist: number): number => 25 + Math.round(Math.max(0, dist) * 0.18);
/** Temps accordé (s) pour une course. */
export const taxiBudgetS = (dist: number): number => Math.round(Math.max(0, dist) / 9 + 20);
/** Pourboire : proportionnel au temps restant (0 si on dépasse), jusqu'à 80 % de la course. */
export function taxiTip(fare: number, budgetS: number, elapsedS: number): number {
  if (!(budgetS > 0) || !Number.isFinite(elapsedS)) return 0;
  const left = Math.max(0, Math.min(1, (budgetS - elapsedS) / budgetS));
  return Math.round(fare * 0.8 * left);
}
/** Au-delà de ce multiple du temps accordé, le client descend et la course ne paie pas. */
export const TAXI_ABANDON_FACTOR = 1.8;

// ---------- Justicier ----------
export const JUSTICE_MAX_CRIMS = 4;
export const JUSTICE_WAVE_PAUSE_S = 4;
export const JUSTICE_SPAWN_MIN = 75, JUSTICE_SPAWN_MAX = 140; // m
export const JUSTICE_ESCAPE_DIST = 230; // m : un fuyard plus loin que ça pendant JUSTICE_ESCAPE_S s s'échappe
export const JUSTICE_ESCAPE_S = 6;
export const JUSTICE_CATCH_R = 7; // m : rattraper = rester si près
export const JUSTICE_CATCH_S = 2; // s de contact continu
export const JUSTICE_SPEED = 13; // m/s : vitesse de fuite
export const JUSTICE_PAY_DESTROY = 150, JUSTICE_PAY_CATCH = 100; // €
/** Nombre de fuyards de la vague `n` (0, 1, 2…). */
export const justiceWave = (n: number): number => Math.max(2, Math.min(JUSTICE_MAX_CRIMS, 2 + Math.floor(Math.max(0, n) / 2)));
