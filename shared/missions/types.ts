// PROPRIÉTAIRE : game-missions
// À IMPLÉMENTER : modèle de mission (étapes, médailles, checkpoints). Format court : 3 à 7 minutes, rejouable.
import type { DistrictId, MedalTier, MinigameKind } from '../ids';

export type MissionStep =
  | { t: 'aller'; x: number; z: number; r: number; text: string }
  | { t: 'livrer'; x: number; z: number; r: number; text: string }
  | { t: 'voler'; vehicle: string; text: string }
  | { t: 'detruire'; target: 'police' | 'vehicule' | 'camera'; count: number; text: string }
  | { t: 'semer'; stars: number; text: string }
  | { t: 'minijeu'; kind: MinigameKind; text: string }
  | { t: 'attendre'; ms: number; text: string };

export interface MissionDef {
  id: string;
  name: string;
  district: DistrictId;
  giver: string; // id du POI donneur
  steps: MissionStep[];
  /** Seuils des médailles : temps (ms), dégâts max subis, précision min. */
  medals: Record<MedalTier, { ms: number; maxDamage: number; minAccuracy: number }>;
  reward: number;
}
