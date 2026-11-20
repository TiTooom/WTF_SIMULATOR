// CONTRAT D'EXTENSION DU SERVEUR : ce que les véhicules et les objets d'inventaire ont le droit d'appeler.
// Le cœur (shared/sim.ts) implémente SimApi. Les véhicules (shared/vehicles/*) et les objets (shared/packs/*)
// ne dépendent QUE de ce fichier, de protocol.ts, props.ts et constants.ts.
import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FxEvent, Input, Vec3 } from './protocol';
import type { PropKind } from './props';

/** Groupes de collision Rapier : (appartenance << 16) | filtre. Voir grp(). */
export const G = {
  WORLD: 0x0001, // sol, arbres, décor fixe
  VEHICLE: 0x0002, // châssis de véhicule
  PART: 0x0004, // pièces mobiles d'un véhicule (bras, godet…) : ne heurtent pas leur propre châssis
  PLAYER: 0x0008,
  PROP: 0x0010,
  ALL: 0xffff,
} as const;
export const grp = (member: number, filter: number = G.ALL) => ((member << 16) | filter) >>> 0;

export interface Mods { speed: number; gravity: number; jump: number; scale: number } // 1 = normal

export interface SimPlayer {
  id: string;
  name: string;
  body: RAPIER.RigidBody;
  input: Input;
  prevInput: Input; // entrée du tick précédent (détection des fronts montants m1/m2)
  vehicle: SimVehicle | null;
  seat: number; // 0 = conducteur
  hp: number; // 0..100
  invulnUntil: number; // temps de simulation (ms)
  item: string; // objet sélectionné
  mods: Mods;
  modsUntil: Record<keyof Mods, number>; // expiration (ms) de chaque modificateur
  cooldowns: Record<string, number>; // id objet -> temps (ms) où il sera de nouveau utilisable
  scratch: Record<string, unknown>; // mémoire libre pour les objets (saisie du pistolet à gravité, etc.)
}

export interface SimProp {
  id: number;
  kind: PropKind;
  body: RAPIER.RigidBody;
  owner: string; // id du joueur qui l'a créé ('' = monde)
  frozen: boolean;
  held: boolean;
  hp: number;
  bornAt: number; // ms de simulation
}

export interface SimVehicle {
  id: number; // index stable
  def: VehicleDef;
  behavior: VehicleBehavior;
  driver: SimPlayer | null;
  passengers: SimPlayer[];
  hp: number;
  dead: boolean;
  deadAt: number;
  home: { x: number; z: number; yaw: number };
}

export type HitKind = 'static' | 'prop' | 'vehicle' | 'player';
export interface Hit {
  kind: HitKind;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  body: RAPIER.RigidBody | null;
  prop?: SimProp;
  vehicle?: SimVehicle;
  player?: SimPlayer;
}

export type DamageKind = 'impact' | 'explosion' | 'bullet';

export interface ProjectileSpec {
  kind: string; // 'rocket' | 'grenade' | 'bullet' | 'chicken'… (le client choisit l'apparence)
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: SimPlayer | null;
  gravity?: number; // m/s² appliqués (0 = vol droit, défaut 0)
  life?: number; // secondes (défaut 6)
  fuse?: boolean; // true : n'explose qu'à la fin de life (grenade) au lieu de l'impact
  bounce?: boolean; // rebondit au lieu d'exploser à l'impact (si fuse)
  radius?: number; // rayon d'explosion (0 = pas d'explosion : balle)
  power?: number; // intensité de l'explosion (impulsion)
  damage?: number; // dégâts maximum (explosion) ou dégâts directs (balle)
  trail?: boolean;
  onHit?: (hit: Hit | null, at: THREE.Vector3) => void; // remplace l'explosion par défaut si fourni
}

/** Ce que le serveur met à disposition des véhicules et des objets. */
export interface SimApi {
  readonly world: RAPIER.World;
  readonly time: number; // temps de simulation (ms)
  readonly players: Map<string, SimPlayer>;
  readonly vehicles: SimVehicle[];
  readonly props: Map<number, SimProp>;

  /** Rayon contre tout (sol, props, véhicules, joueurs) en ignorant éventuellement un corps. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.RigidBody | null): Hit | null;
  /** Corps proches d'un point (aimants, ondes de choc…). */
  nearby(pos: THREE.Vector3, radius: number): Hit[];

  /** Explosion : impulsion radiale sur props/véhicules/joueurs, dégâts, effets. Les blindages comptent. */
  explode(pos: THREE.Vector3, radius: number, power: number, damage: number, by?: SimPlayer | null): void;
  damageVehicle(v: SimVehicle, amount: number, kind: DamageKind, by?: SimPlayer | null): void;
  damagePlayer(p: SimPlayer, amount: number, by?: SimPlayer | null, cause?: string): void;
  damageProp(p: SimProp, amount: number, by?: SimPlayer | null): void;

  spawnProp(kindId: string, pos: THREE.Vector3, rot?: THREE.Quaternion, vel?: THREE.Vector3, owner?: SimPlayer | null): SimProp | null;
  removeProp(p: SimProp): void;
  freezeProp(p: SimProp, frozen: boolean): void;
  spawnProjectile(spec: ProjectileSpec): void;

  fx(ev: FxEvent): void;
  /** Message système dans le chat de tout le monde. */
  announce(text: string): void;
  /** Applique un modificateur temporaire (vitesse, gravité, saut, taille) à un joueur. */
  applyMod(p: SimPlayer, mod: Partial<Mods>, seconds: number): void;
  setGravity(y: number): void; // gravité globale (-9.81 par défaut)
  respawnPlayer(p: SimPlayer): void;

  forwardSpeed(body: RAPIER.RigidBody): number;
  quatOf(body: RAPIER.RigidBody): THREE.Quaternion;
  /** Conduite arcade commune (poussée, adhérence latérale, frottement de roulement, lacet). */
  driveArcade(body: RAPIER.RigidBody, mass: number, accel: number, throttle: number, turn: number): void;
  /** Collider à friction nulle (sinon le frottement du châssis bloque le véhicule). */
  sliding(desc: RAPIER.ColliderDesc): RAPIER.ColliderDesc;
}

// ---------- Véhicules ----------

export interface StepCtx {
  input: Input; // commandes du conducteur (NO_INPUT s'il n'y en a pas)
  driver: SimPlayer | null;
  dt: number; // 1/60
  api: SimApi;
  self: SimVehicle;
}

export interface VehicleAnim {
  sp: number; // vitesse avant (m/s), pour le son et les roues
  st: number; // braquage -1..1
  a: number[]; // valeurs d'animation libres, lues par le modèle client (src/vehicles/<type>.ts)
}

export interface VehicleBehavior {
  body: RAPIER.RigidBody;
  /** Appelé à chaque pas physique, avant world.step(). */
  step(ctx: StepCtx): void;
  anim(): VehicleAnim;
  /** Retire du monde tous les corps créés (châssis, pièces mobiles…). */
  dispose(): void;
  /** Sauvegarde / restauration de l'état propre (ex : angles du bras). Facultatif. */
  state?(): number[];
  restore?(state: number[]): void;
  /** Appelé quand le véhicule subit un choc (Δv en m/s). Permet une réaction propre (ex : avion qui explose). Facultatif. */
  onImpact?(dv: number, ctx: StepCtx): void;
}

export interface VehicleDef {
  type: string; // snake_case ASCII, unique
  name: string; // « le tank », « l'hélicoptère »… (avec article, pour « E : monter dans … »)
  emoji: string;
  enterRadius: number;
  exitOffset: number;
  seats: number; // 1 = conducteur seul
  maxHp: number;
  /** Multiplicateurs de dégâts : 1 normal, 0.1 très résistant, 0 insensible (le tank ignore presque les roquettes). */
  armor: { impact: number; explosion: number; bullet: number };
  /** Choc : en dessous de `threshold` (m/s de Δv en un pas) aucun dégât ; au-delà, dégâts = (Δv − threshold) × scale. */
  impact: { threshold: number; scale: number };
  /** Positions de départ (x, z, lacet en radians) : une instance du véhicule par entrée. */
  spawns: Array<[number, number, number]>;
  create(api: SimApi, x: number, y: number, z: number, yaw: number): VehicleBehavior;
}

// ---------- Objets d'inventaire ----------

export type ItemCategory = 'build' | 'weapon' | 'wtf' | 'move' | 'tool';

export interface ItemDef {
  id: string; // snake_case ASCII, unique
  name: string; // nom français
  emoji: string;
  cat: ItemCategory;
  desc: string; // une phrase : ce que ça fait et comment l'utiliser
  cooldown: number; // secondes entre deux utilisations (0 = aucune limite)
  hold?: boolean; // true : utilisable en continu tant que le bouton est maintenu (sinon une fois par clic)
}

export interface UseCtx {
  api: SimApi;
  player: SimPlayer;
  origin: THREE.Vector3; // caméra du joueur
  dir: THREE.Vector3; // visée (unitaire)
  /** Front montant du bouton principal / secondaire ce tick. */
  pressed1: boolean;
  pressed2: boolean;
  /** Boutons maintenus. */
  held1: boolean;
  held2: boolean;
  wheel: number; // ticks de molette depuis le dernier tick
  dt: number;
}

export interface ItemHandler {
  /** Clic : appelé selon cooldown/hold. */
  use?(ctx: UseCtx): void;
  /** Chaque tick tant que l'objet est en main (saisie continue, visée laser…). */
  tick?(ctx: UseCtx): void;
  /** Le joueur range l'objet ou change d'objet (relâcher une saisie, etc.). */
  holster?(player: SimPlayer, api: SimApi): void;
}

/** Un paquet de contenu : objets + props qu'ils créent + comportements. Un fichier shared/packs/<nom>.ts par paquet. */
export interface Pack {
  items: ItemDef[];
  props: PropKind[];
  handlers: Record<string, ItemHandler>;
}
