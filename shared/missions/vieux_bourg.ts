// PROPRIÉTAIRE : game-missions
// Le Vieux Bourg (La Confrérie du Fromage) : voler une berline, livrer, attendre l'affinage, détruire des camionnettes rivales.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const cave = nodeXZ(4, 4);
const rivals = nodeXZ(5, 8);
const fromagerie = nodeXZ(6, 6);

export const FROMAGE: MissionDef = {
  id: 'fromage',
  name: 'Le cheddar de minuit',
  blurb: 'Frère Brie veut une meule à l\'abri dans la cave. Puis il faudra expliquer aux camionnettes rivales ce qu\'est un fromage fini.',
  district: 'vieux_bourg',
  giver: giverPoi('vieux_bourg').id,
  requires: 'sardines',
  steps: [
    { t: 'voler', vehicle: 'berline', text: 'Crochète la berline garée' },
    { t: 'livrer', x: cave.x, z: cave.z, r: 10, text: 'Livre la meule à la cave' },
    { t: 'attendre', ms: 10_000, text: 'Laisse affiner le fromage...' },
    { t: 'detruire', target: 'vehicule', count: 3, x: rivals.x, z: rivals.z, vehicle: 'camionnette', text: 'Détruis les 3 camionnettes rivales' },
    { t: 'livrer', x: fromagerie.x, z: fromagerie.z, r: 10, text: 'Rapporte le butin à la fromagerie' },
  ],
  medals: {
    bronze: { ms: 540_000, maxDamage: 350, minAccuracy: 0 },
    argent: { ms: 360_000, maxDamage: 120, minAccuracy: 0.75 },
    or: { ms: 250_000, maxDamage: 60, minAccuracy: 0.9 },
  },
  reward: 600,
};
