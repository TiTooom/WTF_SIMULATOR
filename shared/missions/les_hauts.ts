// PROPRIÉTAIRE : game-missions
// Les Hauts (Le Club des Golfeurs) : course contre la montre. Désamorcer une « bombe » (à confettis) dans l'amphi du club, puis fuir.
import type { MissionDef } from './types';
import { giverPoi, nodeXZ } from './helpers';

const amphi = nodeXZ(8, 8);
const green = nodeXZ(9, 6);

export const GOLF: MissionDef = {
  id: 'golf',
  name: 'Trou en un',
  blurb: 'Monsieur Birdie a perdu patience et une bombe à confettis dans l\'amphi du club. Six minutes pour tout régler, café compris.',
  district: 'les_hauts',
  giver: giverPoi('les_hauts').id,
  requires: 'ecrous',
  timeLimitMs: 360_000,
  steps: [
    { t: 'aller', x: amphi.x, z: amphi.z, r: 10, text: 'Cours à l\'amphi du club' },
    { t: 'minijeu', kind: 'desamorcage', x: amphi.x, z: amphi.z, r: 5, difficulty: 0.5, text: 'À pied : désamorce la bombe' },
    { t: 'voler', vehicle: 'berline', text: 'Crochète une berline garée' },
    { t: 'semer', stars: 2, text: 'Fais tomber l\'indice à zéro' },
    { t: 'livrer', x: green.x, z: green.z, r: 10, text: 'Livre la berline au dernier trou' },
  ],
  medals: {
    bronze: { ms: 360_000, maxDamage: 400, minAccuracy: 0 },
    argent: { ms: 270_000, maxDamage: 150, minAccuracy: 0.7 },
    or: { ms: 200_000, maxDamage: 70, minAccuracy: 0.9 },
  },
  reward: 1000,
};
