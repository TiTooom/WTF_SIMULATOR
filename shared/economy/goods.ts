// PROPRIÉTAIRE : game-economy
// Table des marchandises FICTIVES et absurdes (aucune substance réelle, aucun nom de drogue). Clins d'oeil à la vie étudiante.
// Données pures : aucune logique ici. Les prix réels se calculent dans prices.ts à partir de `base`.
// Équilibrage : `base` en euros (entier) ; `weight` = volume dans le sac (le sac du joueur a une capacité `bagCap` = 14, voir trade.ts ; les marchandises précieuses sont lourdes pour borner le gain par voyage : tests/economie-sim.ts) ;
// `rarity` 1 (commun) .. 3 (précieux) : pondère le tirage des tuyaux (les produits communs reviennent plus souvent).
import { GOOD_IDS, type GoodId } from '../ids';

export interface GoodDef {
  id: GoodId;
  name: string; // nom affiché (pluriel de vente)
  emoji: string;
  blurb: string; // description humoristique (une ligne)
  base: number; // prix de base Pbase (entier >= 1)
  weight: number; // volume dans le sac (entier >= 1)
  rarity: 1 | 2 | 3;
}

export const GOODS: Record<GoodId, GoodDef> = {
  cafe_machine: { id: 'cafe_machine', name: 'Café de la machine', emoji: '☕', blurb: 'Couleur incertaine, goût de gobelet. Réveille quand même.', base: 14, weight: 2, rarity: 1 },
  annales_secretes: { id: 'annales_secretes', name: 'Annales secrètes', emoji: '📜', blurb: '« Retrouvées » dans un tiroir. Le corrigé est faux, mais avec aplomb.', base: 180, weight: 4, rarity: 3 },
  croissant_pirate: { id: 'croissant_pirate', name: 'Croissants de contrebande', emoji: '🥐', blurb: 'Livrés avant 7 h, sans ticket de caisse.', base: 22, weight: 2, rarity: 1 },
  poudre_de_craie: { id: 'poudre_de_craie', name: 'Poudre de craie', emoji: '🖍️', blurb: 'De la craie de tableau noir. Rien d\'autre, le prof insiste.', base: 45, weight: 2, rarity: 2 },
  cables_hdmi: { id: 'cables_hdmi', name: 'Câbles HDMI douteux', emoji: '🔌', blurb: 'Marchent un jour sur deux, juste avant la soutenance.', base: 85, weight: 3, rarity: 2 },
  fromage_clandestin: { id: 'fromage_clandestin', name: 'Fromage clandestin', emoji: '🧀', blurb: 'Une meule non déclarée. On la sent avant de la voir.', base: 160, weight: 5, rarity: 2 },
  balles_dorees: { id: 'balles_dorees', name: 'Balles de golf dorées', emoji: '⛳', blurb: 'Plaquées or, donc plus chères que le green.', base: 320, weight: 4, rarity: 3 },
  ecrous_de_12: { id: 'ecrous_de_12', name: 'Écrous de 12', emoji: '🔩', blurb: 'Évidemment. Il en manque toujours un.', base: 18, weight: 1, rarity: 1 },
  sardines_de_quai: { id: 'sardines_de_quai', name: 'Sardines de quai', emoji: '🐟', blurb: 'Arrivage non homologué. Ne pas laisser dans la voiture.', base: 30, weight: 3, rarity: 1 },
  copies_blanches: { id: 'copies_blanches', name: 'Copies blanches', emoji: '📄', blurb: 'Vierges, signées d\'avance. Très recherchées en juin.', base: 240, weight: 4, rarity: 3 },
};

/** Liste ordonnée (suit GOOD_IDS). */
export const GOOD_LIST: GoodDef[] = GOOD_IDS.map((id) => GOODS[id]);
