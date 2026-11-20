// Messages échangés client <-> serveur (JSON sur WebSocket). CONTRAT : ne pas changer sans prévenir tout le monde.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Commandes du joueur envoyées 30×/s. Valeurs dans [-1, 1] sauf indication. */
export interface Input {
  f: number; // avant(+) / arrière(-). Avion : pousser(+) = piquer, tirer(-) = cabrer
  s: number; // droite(+) / gauche(-). Avion : roulis
  sw: number; // pelleteuse : pivot cabine (gauche +)
  bm: number; // pelleteuse : flèche (haut +)
  st: number; // pelleteuse : bras (sortir +)
  bk: number; // pelleteuse : godet (rentrer +)
  jump: number; // 0|1 — à pied : saut ; en véhicule : frein à main / turbo
  yaw: number; // direction du regard (radians) — utilisé à pied
  yw: number; // lacet / palonnier : droite(+)
  th: number; // gaz / altitude : monter(+) descendre(-) (avion : gaz, hélico : collectif, OVNI : altitude)
  hn: number; // 0|1 klaxon / action spéciale du véhicule
  m1: number; // 0|1 bouton principal (tirer / utiliser l'objet / saisir)
  m2: number; // 0|1 bouton secondaire (tir secondaire / geler)
  ao: Vec3; // origine de visée (caméra)
  ad: Vec3; // direction de visée (unitaire)
  item: string; // identifiant de l'objet sélectionné dans la barre ('' = aucun)
  wheel: number; // ticks de molette cumulés depuis le dernier envoi (distance du pistolet à gravité)
}
export const NO_INPUT: Input = {
  f: 0, s: 0, sw: 0, bm: 0, st: 0, bk: 0, jump: 0, yaw: 0, yw: 0, th: 0, hn: 0, m1: 0, m2: 0,
  ao: [0, 0, 0], ad: [0, 0, -1], item: '', wheel: 0,
};

export interface PlayerSnap {
  id: string;
  name: string;
  p: Vec3;
  yaw: number;
  veh: number; // index du véhicule occupé, -1 sinon
  seat: number; // 0 = conducteur, >0 passager
  hp: number; // 0..100
  item: string; // objet en main
  sc: number; // échelle du joueur (1 = normal ; effets : géant, minuscule…)
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
  dead: number; // 1 = détruit, en attente de réapparition (ne pas dessiner)
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
  fx: FxEvent[];
}
export const PROP_STRIDE = 10;
export const PROJ_STRIDE = 8;

export type ClientMsg =
  | { type: 'join'; name: string }
  | { type: 'input'; i: Input }
  | { type: 'interact' } // monter / descendre
  | { type: 'chat'; text: string };

export interface ChatMsg {
  from: string; // pseudo (vide pour un message du serveur)
  text: string;
  sys?: boolean; // message système (arrivée / départ / annonces)
}

export type ServerMsg =
  | { type: 'welcome'; id: string; mode: 'solo' | 'multi' }
  | { type: 'snap'; s: Snapshot }
  | { type: 'chat'; m: ChatMsg }
  | { type: 'error'; message: string };
