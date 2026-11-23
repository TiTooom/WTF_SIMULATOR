// CONTRAT D'EXTENSION DU SERVEUR : ce que les véhicules (et plus tard les systèmes de jeu) ont le droit d'appeler.
// Le cœur (shared/sim.ts) implémente SimApi. Les véhicules (shared/vehicles/*)
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
  scratch: Record<string, unknown>; // mémoire libre (recul d'explosion…)
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
  /** Optionnel : jusqu'à ce temps (ms) les variations de vitesse ne comptent pas comme un choc (saisie du pistolet à gravité, téléportation…). */
  noImpactUntil?: number;
  // ---- Pool (vague 1) : les véhicules sont créés une fois pour toutes, jamais retirés du monde Rapier ----
  /** Incrémenté à chaque recyclage (releaseVehicle) : une `VRef` conservée entre deux ticks se revalide avec `resolveRef`. */
  gen: number;
  /** Vrai tant que le véhicule est rangé dans le pool (corps désactivé, hors du monde, invisible). */
  pooled: boolean;
  /** Verrouillé : on ne monte pas avec E (vol par mini-jeu, voir SimHooks.canEnter). */
  locked: boolean;
  /** Variante de couleur (index défini par la vue client). */
  livery: number;
  /** Pilote automatique : `input` est lu à la place de celui d'un conducteur (un conducteur humain a toujours priorité). */
  ai: { input: Input } | null;
  /** Id du dernier joueur ayant endommagé le véhicule (attribution des crimes). */
  lastHitBy: string | null;
}

/** Référence à un véhicule gardée entre deux ticks : valide tant que `gen` correspond (voir SimApi.resolveRef). */
export interface VRef { id: number; gen: number }

/** Branchements de la logique de jeu (server/game.ts) sur le moteur : chacun est facultatif et protégé par try/catch dans le cœur. */
export interface SimHooks {
  /** Touche d'interaction : retourne true si un système a traité l'action (le cœur n'essaie alors pas de monter dans un véhicule). */
  onInteract?(p: SimPlayer): boolean;
  /** Montée dans un véhicule : false = refusé ; true = autorisé même s'il est verrouillé ; undefined = règle par défaut (refusé si verrouillé). */
  canEnter?(p: SimPlayer, v: SimVehicle): boolean | undefined;
  onEnter?(p: SimPlayer, v: SimVehicle): void;
  onVehicleDestroyed?(v: SimVehicle, by: SimPlayer | null): void;
  onPlayerKilled?(p: SimPlayer, by: SimPlayer | null, cause: string): void;
  /** Un joueur à pied appuie sur le bouton de tir (front montant de m1). */
  /** Une explosion vient d'avoir lieu en `pos` (`by` = responsable, s'il est connu). */
  onExplosion?(pos: Vec3, by: SimPlayer | null): void;
  onShot?(p: SimPlayer, origin: Vec3, dir: Vec3): void;
}

export interface AcquireOpts {
  y?: number;
  livery?: number;
  locked?: boolean;
  /** Piloté par une IA (`v.ai = { input }`). */
  ai?: boolean;
  /** Réapparaît à son point d'origine quand il est détruit au lieu de retourner au pool (véhicules du monde de départ). */
  keep?: boolean;
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
  respawnPlayer(p: SimPlayer): void;

  forwardSpeed(body: RAPIER.RigidBody): number;
  quatOf(body: RAPIER.RigidBody): THREE.Quaternion;
  /** Conduite arcade commune (poussée, adhérence latérale, frottement de roulement, lacet). */
  driveArcade(body: RAPIER.RigidBody, mass: number, accel: number, throttle: number, turn: number): void;
  /** Prend un véhicule libre du pool pour ce type et le place ; null si le pool de ce type est vide. Jamais de création de corps. */
  acquireVehicle(type: string, x: number, z: number, yaw: number, opts?: AcquireOpts): SimVehicle | null;
  /** Range le véhicule dans le pool (éjecte les occupants, désactive le corps, gen+1). Idempotent. */
  releaseVehicle(v: SimVehicle): void;
  refOf(v: SimVehicle): VRef;
  /** Le véhicule si la référence est encore valable (même `gen`, ni rangé ni détruit, corps valide), sinon null. */
  resolveRef(r: VRef | null | undefined): SimVehicle | null;
  /** Position sûre d'un joueur (véhicule ou corps ; dernière position connue si le corps est invalide). */
  playerPos(p: SimPlayer): Vec3;
  /** Branchements du jeu sur le moteur. */
  hooks: SimHooks;
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
