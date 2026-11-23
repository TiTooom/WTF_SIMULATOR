// PROPRIÉTAIRE : game-missions
// Les Docks (La Bande des Mouettes) : poursuite. Voler, faire baisser l'indice en détruisant la police, livrer.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const donor = giverPoi('docks');
const quai = nodeXZ(9, 1);

export const SARDINES: MissionDef = {
  id: 'sardines',
  name: 'Sardines à la criée',
  blurb: 'Le Capitaine Mouette a un arrivage de sardines « non homologué ». La police municipale a du flair. Pousse-la dans le décor.',
  district: 'docks',
  giver: donor.id,
  requires: 'annales',
  steps: [
    { t: 'voler', vehicle: 'camionnette', text: 'Crochète une camionnette garée' },
    { t: 'detruire', target: 'police', count: 2, stars: 2, text: 'Détruis 2 voitures de police' },
    { t: 'livrer', x: quai.x, z: quai.z, r: 10, text: 'Livre les sardines au quai 4' },
    { t: 'aller', x: donor.x, z: donor.z, r: 14, text: 'Rapporte la facture au Capitaine' },
  ],
  medals: {
    bronze: { ms: 480_000, maxDamage: 350, minAccuracy: 0 },
    argent: { ms: 300_000, maxDamage: 120, minAccuracy: 0.75 },
    or: { ms: 200_000, maxDamage: 60, minAccuracy: 0.9 },
  },
  reward: 450,
};
