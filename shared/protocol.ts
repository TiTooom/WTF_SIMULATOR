// Messages échangés client <-> serveur (JSON sur WebSocket). CONTRAT : ne pas changer sans prévenir tout le monde.

import type { DistrictId, GangId, GoodId, MedalTier, MinigameKind } from './ids';
import type { WireMe } from './me';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Commandes du joueur envoyées 30×/s. Valeurs dans [-1, 1] sauf indication. */
export interface Input {
  f: number; // avant(+) / arrière(-)
  s: number; // droite(+) / gauche(-)
  jump: number; // 0|1 — à pied : saut (roulade plus tard) ; en véhicule : frein à main
  run: number; // 0|1 — à pied : sprint
  yaw: number; // direction du regard (radians) — utilisé à pied
  hn: number; // 0|1 klaxon / sirène
  act: number; // 0|1 touche d'activité (taxi, justicier…)
  m1: number; // 0|1 bouton principal (tirer)
  m2: number; // 0|1 bouton secondaire (viser / tir secondaire)
  ao: Vec3; // origine de visée (caméra)
  ad: Vec3; // direction de visée (unitaire)
}
export const NO_INPUT: Input = {
  f: 0, s: 0, jump: 0, run: 0, yaw: 0, hn: 0, act: 0, m1: 0, m2: 0,
  ao: [0, 0, 0], ad: [0, 0, -1],
};

export interface PlayerSnap {
  id: string;
  name: string;
  p: Vec3;
  yaw: number;
  veh: number; // index du véhicule occupé, -1 sinon
  seat: number; // 0 = conducteur, >0 passager
  hp: number; // 0..100
  ws?: number; // étoiles de recherche 0..5 (absent = 0)
  an?: number; // état d'animation du personnage (absent = 0 ; valeurs définies par le client art-toon)
}

export interface VehicleSnap {
  type: string; // identifiant du type (voir shared/vehicles)
  p: Vec3;
  q: Quat;
  drv: string; // id du conducteur ou ''
  sp: number; // vitesse avant (m/s)
  st: number; // braquage −1..1
  a: number[]; // animations propres au véhicule (bras, hélice, tourelle, train d'atterrissage…)
  hp: number; // points de vie 0..1
  dead: number; // 1 = détruit (ne pas dessiner, fumée), 2 = rangé dans le pool (ne pas dessiner, pas d'effet)
  lv?: number; // livrée (variante de couleur, index défini par la vue ; absent = 0)
  lk?: 1; // verrouillé (absent = ouvert)
  ai?: 1; // piloté par une IA (trafic, police) : pas de conducteur humain
}

/** Événement visuel/sonore éphémère, diffusé une fois (explosions, confettis, textes flottants…). */
export interface FxEvent {
  k: string; // 'boom' | 'smoke' | 'spark' | 'confetti' | 'text' | 'ring' | 'flash' | 'sound' | 'beam' | …
  p: Vec3;
  a?: number; // paramètre numérique (rayon, intensité…)
  b?: number;
  s?: string; // texte ou nom de son
  c?: number; // couleur 0xRRGGBB
  t?: Vec3; // point d'arrivée (rayons)
}

export interface Snapshot {
  t: number; // temps de simulation (ms)
  players: PlayerSnap[];
  vehicles: VehicleSnap[];
  /** Props (caisses, objets construits…) à plat, 10 nombres chacun : id, kind, x, y, z, qx, qy, qz, qw, flags (1 = gelé, 2 = tenu). */
  props: number[];
  /** Projectiles à plat, 8 nombres chacun : id, kind, x, y, z, vx, vy, vz. */
  proj: number[];
  fx: FxEvent[]; // peut être absent du JSON réseau quand il est vide (le client lit `fx?.`)
  // --- Mode différentiel (additif, rétrocompatible : un snapshot sans `d` est complet) ---
  /** 1 = delta : `props` ne contient que les props modifiés, `vehicles` que ceux listés dans `vi` ; le client fusionne avec l'état précédent (voir src/net.ts). */
  d?: 1;
  /** Delta : ids des props supprimés depuis le dernier snapshot. */
  rm?: number[];
  /** Delta : indices (dans la liste complète) des véhicules présents dans `vehicles`. */
  vi?: number[];
  /** Delta : nombre total de véhicules. */
  vn?: number;
  /** Piétons à plat, PED_STRIDE nombres chacun : id, kind (index de PED_KINDS), x, z, yaw, st (état d'animation). Toujours la liste complète ; absent = aucun. */
  peds?: number[];
  // Delta : `players[i].name` est omis quand le client le connaît déjà (mémorisé par id).
}
export const PROP_STRIDE = 10;
export const PROJ_STRIDE = 8;
export const PED_STRIDE = 6;

export type ClientMsg =
  | { type: 'join'; name: string; secret?: string } // secret : aléatoire propre au client, lie le pseudo à son compte (le serveur n'en garde que le sha256)
  | { type: 'input'; i: Input }
  | { type: 'interact' } // monter / descendre
  | { type: 'chat'; text: string }
  | { type: 'game'; m: GameClientMsg }; // actions de jeu (commerce, missions, mini-jeux…) : TOUT champ est revalidé côté serveur

export interface ChatMsg {
  from: string; // pseudo (vide pour un message du serveur)
  text: string;
  sys?: boolean; // message système (arrivée / départ / annonces)
}

export type ServerMsg =
  | { type: 'welcome'; id: string; mode: 'solo' | 'multi' }
  | { type: 'snap'; s: Snapshot }
  | { type: 'chat'; m: ChatMsg }
  | { type: 'error'; message: string }
  | { type: 'me'; s: WireMe } // état privé du joueur (format compact de shared/me.ts ; 10 Hz max, envoyé seulement s'il change)
  | { type: 'game'; e: GameServerEvent }; // événement de jeu ponctuel destiné à ce joueur

// ---------- Jeu : état privé, messages, événements (vague 1) ----------
export const PDA_PANELS = ['carte', 'sms', 'marche', 'missions', 'stats'] as const;
/** Onglet du PDA. */
export type Panel = (typeof PDA_PANELS)[number];

/** Message reçu sur le téléphone du joueur. Un « tuyau » (tip) annonce un événement de prix. */
export interface Sms {
  id: number; // unique par joueur, croissant
  from: string;
  text: string;
  at: number; // temps de simulation (ms)
  tip?: { good: GoodId; district: DistrictId; mult: number; until: number }; // until : temps de simulation (ms)
}

/** Repère affiché sur la carte et dans le monde (au plus 16 par joueur). */
export interface Mark {
  x: number;
  z: number;
  k: 'mission' | 'dealer' | 'planque' | 'camera' | 'donneur' | 'hopital' | 'commissariat' | 'cible' | 'danger' | 'autre';
  label?: string;
}

/** Étal ouvert chez un dealer proche : prix calculés par le serveur (jamais crus du client). */
export interface ShopView {
  dealer: string; // id du POI
  district: DistrictId;
  gang: GangId;
  goods: { good: GoodId; buy: number; sell: number }[]; // prix unitaires que paie / reçoit le joueur
}

export interface MinigameStart {
  sid: number; // identifiant de session, unique, croissant
  kind: MinigameKind;
  seed: number;
  difficulty: number; // 0..1
  maxMs: number;
}
export interface MinigameResult {
  sid: number;
  ok: boolean;
  ms: number; // durée mesurée par le client (le serveur vérifie qu'elle est plausible)
  data?: number[]; // données propres au jeu (validées par minigames/rules.ts)
}

/** État privé d'un joueur (message `me`). Construit par `server/game.ts` : le cœur remplit les champs de base, chaque système complète les siens. */
export interface PrivateState {
  money: number;
  bag: Partial<Record<GoodId, number>>;
  bagCap: number;
  stars: number; // 0..5
  starProgress: number; // 0..1 vers l'étoile suivante / précédente
  ws?: number; // état de recherche (shared/wanted.ts WS) : 0 libre, 1 repéré, 2 recherche, 3 caché
  wl?: number; // secondes avant la prochaine étoile perdue (absent : vu ou sans étoile)
  district: DistrictId;
  shop?: ShopView;
  stash?: Partial<Record<GoodId, number>>; // contenu de la planque proche
  mission?: { id: string; step: number; steps: number; text: string; ms: number; timeLimitMs?: number };
  activity?: { kind: 'taxi' | 'ambulance' | 'pompier' | 'justicier'; text: string; score: number };
  marks: Mark[];
  medals: Record<string, MedalTier>; // id de mission -> meilleure médaille
  unread: number; // SMS non lus
}

export type GameClientMsg =
  | { k: 'trade'; dealer: string; good: GoodId; qty: number; side: 'buy' | 'sell' }
  | { k: 'stash'; op: 'put' | 'take'; good: GoodId; qty: number }
  | { k: 'mission'; op: 'start' | 'abort' | 'retry'; id: string }
  | { k: 'mg'; r: MinigameResult }
  | { k: 'sms_lu'; id: number };

export type GameServerEvent =
  | { k: 'sms'; sms: Sms }
  | { k: 'mg_start'; s: MinigameStart }
  | { k: 'mg_end'; sid: number; ok: boolean }
  | { k: 'mission'; ev: 'start' | 'checkpoint' | 'done' | 'fail'; id: string; medal?: MedalTier; ms?: number; text?: string; damage?: number; accuracy?: number; reward?: number; par?: { ms: number; maxDamage: number; minAccuracy: number } }
  | { k: 'vignettes'; id: string } // planches BD (narration)
  | { k: 'arrete' } // arrêté par la police
  | { k: 'mort' }
  | { k: 'monde'; camsDown: number; down?: string[] } // caméras de surveillance détruites : nombre et ids (POI)
  | { k: 'toast'; text: string };
