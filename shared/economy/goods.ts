// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : équilibrage des marchandises (prix de base, encombrement, risque). Noms et ids fictifs : aucune substance réelle.
import type { GoodId } from '../ids';

export interface GoodDef { id: GoodId; name: string; base: number; weight: number }

export const GOODS: Record<GoodId, GoodDef> = {
  cafe_machine: { id: 'cafe_machine', name: 'Café de la machine', base: 100, weight: 1 },
  annales_secretes: { id: 'annales_secretes', name: 'Annales secrètes', base: 100, weight: 1 },
  croissant_pirate: { id: 'croissant_pirate', name: 'Croissants de contrebande', base: 100, weight: 1 },
  poudre_de_craie: { id: 'poudre_de_craie', name: 'Poudre de craie', base: 100, weight: 1 },
  cables_hdmi: { id: 'cables_hdmi', name: 'Câbles HDMI douteux', base: 100, weight: 1 },
  fromage_clandestin: { id: 'fromage_clandestin', name: 'Fromage clandestin', base: 100, weight: 1 },
  balles_dorees: { id: 'balles_dorees', name: 'Balles de golf dorées', base: 100, weight: 1 },
  ecrous_de_12: { id: 'ecrous_de_12', name: 'Écrous de 12', base: 100, weight: 1 },
  sardines_de_quai: { id: 'sardines_de_quai', name: 'Sardines de quai', base: 100, weight: 1 },
  copies_blanches: { id: 'copies_blanches', name: 'Copies blanches', base: 100, weight: 1 },
};
