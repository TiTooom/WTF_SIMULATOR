// PROPRIÉTAIRE : game-missions
// La Cathédrale (La Confrérie du Macaron) : voler une berline, livrer, laisser reposer, détruire des camionnettes rivales.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const crypte = nodeXZ(4, 4);
const rivals = nodeXZ(5, 8);
const patisserie = nodeXZ(6, 6);

export const FROMAGE: MissionDef = {
  id: 'fromage',
  name: 'Les macarons de minuit',
  blurb: 'Frère Amandin veut sa cargaison à l\'abri dans la crypte. Puis il faudra expliquer aux camionnettes rivales qui détient la vraie recette.',
  district: 'cathedrale',
  giver: giverPoi('cathedrale').id,
  requires: 'sardines',
  steps: [
    { t: 'voler', vehicle: 'berline', text: 'Crochète la berline garée' },
    { t: 'livrer', x: crypte.x, z: crypte.z, r: 10, text: 'Livre les macarons à la crypte' },
    { t: 'attendre', ms: 10_000, text: 'Laisse reposer les macarons...' },
    { t: 'detruire', target: 'vehicule', count: 3, x: rivals.x, z: rivals.z, vehicle: 'camionnette', text: 'Détruis les 3 camionnettes rivales' },
    { t: 'livrer', x: patisserie.x, z: patisserie.z, r: 10, text: 'Rapporte le butin à la pâtisserie' },
  ],
  medals: {
    bronze: { ms: 540_000, maxDamage: 350, minAccuracy: 0 },
    argent: { ms: 360_000, maxDamage: 120, minAccuracy: 0.75 },
    or: { ms: 250_000, maxDamage: 60, minAccuracy: 0.9 },
  },
  reward: 600,
};
