// PROPRIÉTAIRE : game-missions
// Le Campus (Les Ingés) : mission d'initiation. Fouiller, crocheter, livrer.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const repro = nodeXZ(4, 0); // la reprographie
const biblio = nodeXZ(1, 2); // la bibliothèque

export const ANNALES: MissionDef = {
  id: 'annales',
  name: 'Les annales du jeudi',
  blurb: 'Le Délégué des Ingés jure que les annales de la semaine prochaine dorment dans une benne. Fouille, crochète, livre.',
  district: 'campus',
  giver: giverPoi('campus').id,
  steps: [
    { t: 'aller', x: repro.x, z: repro.z, r: 10, text: 'Va à la reprographie du campus' },
    { t: 'minijeu', kind: 'fouille', x: repro.x, z: repro.z, r: 5, difficulty: 0.2, text: 'À pied : fouille la benne' },
    { t: 'voler', vehicle: 'citadine', text: 'Crochète une citadine garée' },
    { t: 'livrer', x: biblio.x, z: biblio.z, r: 10, text: 'Livre les annales à la bibliothèque' },
  ],
  medals: {
    bronze: { ms: 420_000, maxDamage: 300, minAccuracy: 0 },
    argent: { ms: 240_000, maxDamage: 60, minAccuracy: 0.8 },
    or: { ms: 160_000, maxDamage: 25, minAccuracy: 0.95 },
  },
  reward: 300,
};
