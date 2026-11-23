// PROPRIÉTAIRE : game-economy
// Les 5 gangs / quartiers : ce qu'ils produisent (offre forte, prix x0,5-0,7), ce qu'ils demandent (prix x1,4-1,8), pression policière de base
// et dealer (nom, personnalité, répliques). Chaque marchandise est produite par exactement un gang et demandée par exactement un autre :
// la route la plus rentable est toujours « acheter chez le producteur, revendre chez le demandeur » (x2,3 à x3,4 avant marge de 10 % par côté).
import { DISTRICT_IDS, GANG_IDS, type DistrictId, type GangId, type GoodId } from '../ids';

export interface DealerDef {
  name: string; // nom du dealer
  trait: string; // personnalité en une phrase
  greeting: string; // à l'ouverture du magasin
  farewell: string; // à la fermeture
}

export interface GangDef {
  id: GangId;
  district: DistrictId;
  produces: GoodId[];
  wants: GoodId[];
  produceMult: number; // dans [0.5, 0.7]
  wantMult: number; // dans [1.4, 1.8]
  policePressure: number; // pression policière de base R ∈ [0, 1] (entre dans (1 + 0,3·R))
  dealer: DealerDef;
}

export const GANGS: Record<GangId, GangDef> = {
  agros: {
    id: 'agros', district: 'campus', produces: ['cafe_machine', 'croissant_pirate'], wants: ['copies_blanches', 'sardines_de_quai'],
    produceMult: 0.6, wantMult: 1.5, policePressure: 0.25,
    dealer: { name: 'Gaston « Mi-Temps » Lebrun', trait: 'Éternel étudiant en 7e année, parle de ses partiels comme d\'une guerre.',
      greeting: 'Psst ! Tu as ta carte étudiante ? Non ? Tant mieux, moi non plus.', farewell: 'Bonne chance pour tes rattrapages !' },
  },
  mouettes: {
    id: 'mouettes', district: 'docks', produces: ['sardines_de_quai', 'cables_hdmi'], wants: ['croissant_pirate', 'balles_dorees'],
    produceMult: 0.55, wantMult: 1.6, policePressure: 0.45,
    dealer: { name: 'Capitaine Mouette', trait: 'Crie à chaque phrase, vole la moitié de ce que tu lui montres.',
      greeting: 'CRIIII ! Ah, un client. Ne regarde pas mon sandwich.', farewell: 'CRIIII ! Reviens avec des frites !' },
  },
  fromagers: {
    id: 'fromagers', district: 'vieux_bourg', produces: ['fromage_clandestin', 'annales_secretes'], wants: ['cafe_machine', 'cables_hdmi'],
    produceMult: 0.65, wantMult: 1.45, policePressure: 0.3,
    dealer: { name: 'Tonton Munster', trait: 'Solennel, affiné, ne se déplace jamais sans sa cave portative.',
      greeting: 'Approche, petit. Ici, on ne vend pas : on affine.', farewell: 'Que le bon goût soit avec toi.' },
  },
  cles_de_12: {
    id: 'cles_de_12', district: 'zone_indus', produces: ['ecrous_de_12', 'poudre_de_craie'], wants: ['fromage_clandestin', 'annales_secretes'],
    produceMult: 0.5, wantMult: 1.7, policePressure: 0.4,
    dealer: { name: 'Jojo la Clé', trait: 'Taciturne, ne compte qu\'en millimètres et trouve toujours le 12 qui manque.',
      greeting: 'Un 12 ? J\'en ai. Un 13 ? Jamais entendu parler.', farewell: 'Serre bien. Pas trop.' },
  },
  golfeurs: {
    id: 'golfeurs', district: 'les_hauts', produces: ['balles_dorees', 'copies_blanches'], wants: ['poudre_de_craie', 'ecrous_de_12'],
    produceMult: 0.7, wantMult: 1.8, policePressure: 0.6,
    dealer: { name: 'Sir Bogey Von Green', trait: 'Snob au polo repassé, appelle tout le monde « caddie ».',
      greeting: 'Ah, un caddie. Essuie tes pieds, la moquette vaut plus cher que toi.', farewell: 'Fore ! Je veux dire : au revoir.' },
  },
};

/** Quartier -> gang dominant (inverse de GANGS[].district). */
export const GANG_OF_DISTRICT = Object.fromEntries(GANG_IDS.map((g) => [GANGS[g].district, g])) as Record<DistrictId, GangId>;

/** Multiplicateur de territoire Mterritoire(p, q) : 0,5-0,7 si le gang local produit, 1,4-1,8 s'il demande, 1,0 sinon. */
export function territoryMult(good: GoodId, district: DistrictId): number {
  const g = GANGS[GANG_OF_DISTRICT[district]];
  if (!g) return 1;
  if (g.produces.includes(good)) return g.produceMult;
  if (g.wants.includes(good)) return g.wantMult;
  return 1;
}

/** Pression policière de base de chaque quartier (valeur initiale de MarketState.police). */
export const BASE_POLICE: Record<DistrictId, number> = Object.fromEntries(
  DISTRICT_IDS.map((d) => [d, GANGS[GANG_OF_DISTRICT[d]].policePressure]),
) as Record<DistrictId, number>;
