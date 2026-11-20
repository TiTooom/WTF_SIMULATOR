// Messages échangés client <-> serveur (JSON sur WebSocket).

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Commandes du joueur, valeurs dans [-1, 1]. f: avant(+) · s: droite(+) · sw/bm/st/bk: bras de pelleteuse. */
export interface Input {
  f: number;
  s: number;
  sw: number; // pivot cabine (gauche +)
  bm: number; // flèche (haut +)
  st: number; // bras (sortir +)
  bk: number; // godet (rentrer +)
  jump: number; // 0 ou 1
  yaw: number; // direction du regard (à pied)
}
export const NO_INPUT: Input = { f: 0, s: 0, sw: 0, bm: 0, st: 0, bk: 0, jump: 0, yaw: 0 };

export interface PlayerSnap { id: string; name: string; p: Vec3; yaw: number; veh: number } // veh: index du véhicule conduit, -1 sinon
export interface VehicleSnap {
  type: 'car' | 'excavator';
  p: Vec3;
  q: Quat;
  drv: string; // id du conducteur ou ''
  sp: number; // vitesse avant (m/s)
  st: number; // braquage -1..1
  a: [number, number, number, number]; // bras : cabine, flèche, bras, godet
}
export interface Snapshot {
  t: number; // temps de simulation (ms)
  players: PlayerSnap[];
  vehicles: VehicleSnap[];
  crates: number[]; // à plat : x y z qx qy qz qw par caisse
}

export type ClientMsg =
  | { type: 'join'; name: string }
  | { type: 'input'; i: Input }
  | { type: 'interact' }; // monter / descendre

export type ServerMsg =
  | { type: 'welcome'; id: string; mode: 'solo' | 'multi' }
  | { type: 'snap'; s: Snapshot }
  | { type: 'error'; message: string };
