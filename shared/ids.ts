// Identifiants partagés serveur/client (contrat de l'équipe, voir docs/ARCHITECTURE-GTA.md §3). Ajouts seulement, en fin de liste :
// l'ORDRE des listes est utilisé sur le réseau (ex : `PedKind` dans `Snapshot.peds`).

/** Véhicules de la ville. Vague 1 : seule la `citadine` existe (shared/vehicles/car.ts, temporaire) ; les 3 autres arrivent en vague 2. */
export const VEHICLE_TYPES = ['citadine', 'berline', 'camionnette', 'police'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DISTRICT_IDS = ['campus', 'docks', 'vieux_bourg', 'zone_indus', 'les_hauts'] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

export const GANG_IDS = ['agros', 'mouettes', 'fromagers', 'cles_de_12', 'golfeurs'] as const;
export type GangId = (typeof GANG_IDS)[number];

/**
 * Marchandises FICTIVES et absurdes (aucune substance réelle), clins d'œil à la vie étudiante. Noms affichés : shared/economy/goods.ts.
 * Réglable par `game-economy` (ajouts en fin de liste uniquement).
 */
export const GOOD_IDS = [
  'cafe_machine', // le café de la machine, couleur et goût incertains
  'annales_secretes', // annales d'examen « retrouvées »
  'croissant_pirate', // croissants de contrebande du matin
  'poudre_de_craie', // craie de tableau en sachet
  'cables_hdmi', // câbles HDMI d'origine douteuse
  'fromage_clandestin', // meule non déclarée
  'balles_dorees', // balles de golf plaquées or
  'ecrous_de_12', // écrous de 12, évidemment
  'sardines_de_quai', // arrivage de sardines non homologué
  'copies_blanches', // copies d'examen vierges, très recherchées
] as const;
export type GoodId = (typeof GOOD_IDS)[number];

export const MINIGAME_KINDS = ['tournevis', 'court_circuit', 'digicode', 'dosage', 'fouille', 'brise_glace', 'desamorcage', 'liasses'] as const;
export type MinigameKind = (typeof MINIGAME_KINDS)[number];

export const CRIME_KINDS = ['vol_vehicule', 'pieton_renverse', 'agression_flic', 'flic_detruit', 'deal_vu', 'camera_detruite', 'tir', 'explosion'] as const;
export type CrimeKind = (typeof CRIME_KINDS)[number];

export const MEDAL_TIERS = ['bronze', 'argent', 'or'] as const;
export type MedalTier = (typeof MEDAL_TIERS)[number];

export const SYSTEM_IDS = ['traffic', 'peds', 'police', 'economy', 'missions', 'minigames', 'activities'] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

/** L'index dans cette liste est ce qui circule dans `Snapshot.peds` (champ `kind`). */
export const PED_KINDS = ['passant', 'etudiant', 'dealer', 'flic', 'gang'] as const;
export type PedKind = (typeof PED_KINDS)[number];

export const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
