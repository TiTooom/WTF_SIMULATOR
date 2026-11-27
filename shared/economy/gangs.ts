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
  inges: {
    id: 'inges', district: 'campus', produces: ['cafe_machine', 'croissant_pirate'], wants: ['copies_blanches', 'ficelles_picardes'],
    produceMult: 0.6, wantMult: 1.5, policePressure: 0.25,
    dealer: { name: 'Gaston « Mi-Temps » Lebrun', trait: 'Éternel élève-ingénieur en 7e année, parle de ses partiels comme d\'une guerre.',
      greeting: 'Psst ! Tu as ta carte d\'étudiant ? Non ? Tant mieux, moi non plus. Ch\'est pas grave, ch\'ti.', farewell: 'Bonne chance pour tes rattrapages !' },
  },
  mouettes: {
    id: 'mouettes', district: 'saint_leu', produces: ['ficelles_picardes', 'cables_hdmi'], wants: ['croissant_pirate', 'balles_dorees'],
    produceMult: 0.55, wantMult: 1.6, policePressure: 0.45,
    dealer: { name: 'Capitaine Mouette', trait: 'Crie à chaque phrase, rôde sur les canaux de Saint-Leu et vole la moitié de ce que tu lui montres.',
      greeting: 'CRIIII ! Ah, un client. Ne regarde pas ma ficelle picarde.', farewell: 'CRIIII ! Reviens avec des frites, et ne tombe pas dans le canal !' },
  },
  macarons: {
    id: 'macarons', district: 'cathedrale', produces: ['macarons_contrebande', 'annales_secretes'], wants: ['cafe_machine', 'cables_hdmi'],
    produceMult: 0.65, wantMult: 1.45, policePressure: 0.3,
    dealer: { name: 'Tonton Macaron', trait: 'Solennel et sucré, ne se déplace jamais sans sa boîte à macarons et jure sur les tours de la cathédrale.',
      greeting: 'Approche, petit. Ici, on ne vend pas : on déguste, à l\'ombre de la cathédrale.', farewell: 'Que la Vierge Dorée te garde (et tes macarons aussi).' },
  },
  cles_de_12: {
    id: 'cles_de_12', district: 'amiens_nord', produces: ['ecrous_de_12', 'poudre_de_craie'], wants: ['macarons_contrebande', 'annales_secretes'],
    produceMult: 0.5, wantMult: 1.7, policePressure: 0.4,
    dealer: { name: 'Jojo la Clé', trait: 'Taciturne, ne compte qu\'en millimètres et vit entre l\'usine et le rond-point, et trouve toujours le 12 qui manque.',
      greeting: 'Un 12 ? J\'en ai. Un 13 ? Jamais entendu parler, ch\'est pas d\'ici.', farewell: 'Serre bien. Pas trop.' },
  },
  club_citadelle: {
    id: 'club_citadelle', district: 'citadelle', produces: ['balles_dorees', 'copies_blanches'], wants: ['poudre_de_craie', 'ecrous_de_12'],
    produceMult: 0.7, wantMult: 1.8, policePressure: 0.6,
    dealer: { name: 'Comte Rempart de la Citadelle', trait: 'Snob au blazer repassé, se croit seigneur des remparts, appelle tout le monde « manant ».',
      greeting: 'Ah, un manant. Essuie tes pieds, les pelouses de la Citadelle valent plus cher que toi.', farewell: 'Retourne à ta Tour Perret, manant. Je veux dire : au revoir.' },
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
