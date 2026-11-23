// Constantes partagées par le serveur (physique) et le client (rendu). La ville est dans shared/city/.
import type { VehicleType } from './ids';

export const STEP = 1 / 60; // pas physique du serveur
export const SNAP_HZ = 30; // fréquence d'envoi des états aux joueurs
export const DEFAULT_PORT = 3000;
export const MAX_PLAYERS = 16;

/** Demi-taille du monde jouable = CITY.BORDER (shared/city/layout.ts ; égalité vérifiée par tests/smoke.ts). */
export const GROUND = 330;
export function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Apparences de projectiles : `Snapshot.proj[i*8 + 1]` = index dans cette liste (ProjectileSpec.kind).
 * Un kind inconnu est envoyé avec l'index `PROJECTILE_KINDS.length` (apparence générique). Liste additive : ajouter à la fin.
 */
export const PROJECTILE_KINDS = ['bullet', 'grenade', 'rocket'] as const;

/**
 * Taille du pool de véhicules par type (corps créés une fois pour toutes, jamais retirés du monde Rapier).
 * Le pool n'est alloué que pour les types réellement définis dans VEHICLES (vague 1 : seule la `citadine`).
 */
export const VEHICLE_POOL: Record<VehicleType, number> = { citadine: 14, berline: 12, camionnette: 6, police: 10 };
