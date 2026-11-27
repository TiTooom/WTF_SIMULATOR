// PROPRIÉTAIRE : game-missions
// Saint-Leu (Les Mouettes de Saint-Leu) : poursuite. Voler, faire baisser l'indice en détruisant la police, livrer.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const donor = giverPoi('saint_leu');
const quai = nodeXZ(9, 1);

export const SARDINES: MissionDef = {
  id: 'sardines',
  name: 'La ficelle du canal',
  blurb: 'Le Capitaine Mouette a un arrivage de ficelles picardes « périmées de peu ». La police municipale a du flair. Pousse-la dans le décor.',
  district: 'saint_leu',
  giver: donor.id,
  requires: 'annales',
  steps: [
    { t: 'voler', vehicle: 'camionnette', text: 'Crochète une camionnette garée' },
    { t: 'detruire', target: 'police', count: 2, stars: 2, text: 'Détruis 2 voitures de police' },
    { t: 'livrer', x: quai.x, z: quai.z, r: 10, text: 'Livre les ficelles au quai Bélu' },
    { t: 'aller', x: donor.x, z: donor.z, r: 14, text: 'Rapporte la facture au Capitaine' },
  ],
  medals: {
    bronze: { ms: 480_000, maxDamage: 350, minAccuracy: 0 },
    argent: { ms: 300_000, maxDamage: 120, minAccuracy: 0.75 },
    or: { ms: 200_000, maxDamage: 60, minAccuracy: 0.9 },
  },
  reward: 450,
};
