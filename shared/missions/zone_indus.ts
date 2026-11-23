// PROPRIÉTAIRE : game-missions
// La Zone Indus (Les Clés de 12) : infiltration. Digicode, caméra, camionnette, livraison d'écrous.
import type { MissionDef } from './types';
import { cameraNear, giverPoi, nodeXZ } from './helpers';

const portail = nodeXZ(3, 8);
const camera = cameraNear(portail.x, portail.z);
const entrepot = nodeXZ(2, 6);

export const ECROUS: MissionDef = {
  id: 'ecrous',
  name: 'Écrous de 12, évidemment',
  blurb: 'Ginette des Clés a besoin de cinq cents écrous de 12 et d\'un portail qui ne voit rien. Le digicode est têtu, la caméra aussi.',
  district: 'zone_indus',
  giver: giverPoi('zone_indus').id,
  requires: 'fromage',
  steps: [
    { t: 'aller', x: portail.x, z: portail.z, r: 10, text: 'Rejoins le portail de l\'usine' },
    { t: 'minijeu', kind: 'digicode', x: portail.x, z: portail.z, r: 5, difficulty: 0.4, text: 'À pied : pirate le digicode' },
    { t: 'detruire', target: 'camera', count: 1, x: camera.x, z: camera.z, text: 'Détruis la caméra de surveillance' },
    { t: 'voler', vehicle: 'camionnette', text: 'Crochète la camionnette du chef' },
    { t: 'livrer', x: entrepot.x, z: entrepot.z, r: 10, text: 'Livre les écrous à l\'entrepôt' },
  ],
  medals: {
    bronze: { ms: 540_000, maxDamage: 350, minAccuracy: 0 },
    argent: { ms: 360_000, maxDamage: 120, minAccuracy: 0.7 },
    or: { ms: 260_000, maxDamage: 60, minAccuracy: 0.9 },
  },
  reward: 750,
};
