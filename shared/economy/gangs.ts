// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : goûts des gangs (produits vendus bon marché / très demandés), pression policière de base par quartier.
import type { DistrictId, GangId, GoodId } from '../ids';

export interface GangDef { id: GangId; district: DistrictId; produces: GoodId[]; wants: GoodId[]; policePressure: number }

export const GANGS: Record<GangId, GangDef> = {
  agros: { id: 'agros', district: 'campus', produces: [], wants: [], policePressure: 0.3 },
  mouettes: { id: 'mouettes', district: 'docks', produces: [], wants: [], policePressure: 0.3 },
  fromagers: { id: 'fromagers', district: 'vieux_bourg', produces: [], wants: [], policePressure: 0.3 },
  cles_de_12: { id: 'cles_de_12', district: 'zone_indus', produces: [], wants: [], policePressure: 0.3 },
  golfeurs: { id: 'golfeurs', district: 'les_hauts', produces: [], wants: [], policePressure: 0.3 },
};
