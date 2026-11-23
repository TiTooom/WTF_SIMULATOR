// Simulation physique autoritaire (tourne sur le serveur, sans aucun rendu). Implémente SimApi (voir api.ts).
// Contenu : ville (colliders), props, pool de véhicules (registre), joueurs, projectiles, explosions, dégâts, sauvegarde v3.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUND, PROJECTILE_KINDS, STEP, VEHICLE_POOL } from './constants';
import { CITY, getCity } from './city/layout';
import { NO_INPUT, type FxEvent, type Input, type PlayerSnap, type Snapshot, type Vec3, type VehicleSnap } from './protocol';
import {
  G, grp, type AcquireOpts, type DamageKind, type Hit, type ProjectileSpec, type SimApi, type SimHooks, type SimPlayer, type SimProp,
  type SimVehicle, type StepCtx, type VehicleDef, type VRef,
} from './api';
import { wedgeVertices, type PropKind } from './props';
import { PROP_INDEX, propKindById } from './registry';
import { VEHICLES } from './vehicles';
import { bodyOk, isPoison } from './guard';
import { ONFOOT, newRoll, rollVelocity, startRoll, type RollState } from './onfoot';

// ---------- Réglages ----------
const PLAYER_HP = 100;
const RESPAWN_PLAYER_MS = 2000;
const RESPAWN_VEHICLE_MS = 12000;
const MAX_PROPS_PER_PLAYER = 40;
const MAX_PROPS = 400;
const MAX_PROJECTILES = 300;
const MAX_FX = 256;
const MAX_SAVED_PLAYERS = 200;
const MIN_SESSION_MS = 30_000; // un joueur resté moins longtemps n'est pas mémorisé
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PARK: Vec3 = [0, -200, 0]; // où l'on range un véhicule du pool (corps désactivé, jamais lu ni simulé)
const VEH_HALF: Vec3 = [0.8, 0.5, 1.2]; // boîte (demi-dimensions, volontairement étroite) du test anti-enclavement des véhicules
const WALK = ONFOOT.walk;
const RUN = ONFOOT.run;

const civilLivery = (id: number) => 1 + ((Math.imul(id + 1, 2654435761) >>> 16) % 250);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const fin = (n: unknown, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
const clamp1 = (n: unknown) => Math.max(-1, Math.min(1, fin(n)));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, p = 100) => Math.round(n * p) / p;
const vec3 = (v: unknown, d: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : d;
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Vue interne d'un véhicule : SimVehicle + état propre au cœur. */
interface VX extends SimVehicle {
  pv: THREE.Vector3; // vitesse au pas précédent (détection des chocs)
  grace: number; // pas de dégâts de choc avant ce temps (ms)
  fails: number;
  disabled: boolean;
  pose: { p: Vec3; q: [number, number, number, number] };
  keep: boolean; // véhicule du monde de départ : réapparaît à son point d'origine quand il est détruit
}
interface PX extends SimProp { base: boolean; sentAsleep?: boolean; sent?: number[] /* dernier état envoyé (delta réseau) */ }
interface PI { // état interne d'un joueur
  col: RAPIER.Collider; deadAt: number; start: Vec3; runAt: number;
  last: Vec3; // dernière position connue (lue sans toucher Rapier : sert à reconstruire un monde empoisonné)
  joinedAt: number;
  ws: number; // étoiles (publié dans PlayerSnap.ws)
  an: number; // animation (publié dans PlayerSnap.an)
}
interface Proj {
  id: number; kind: number; pos: THREE.Vector3; vel: THREE.Vector3; owner: SimPlayer | null; gravity: number; life: number;
  age: number; fuse: boolean; bounce: boolean; radius: number; power: number; damage: number;
  onHit?: ProjectileSpec['onHit']; stuck: boolean;
}
type Owner = { prop?: PX; vehicle?: VX; player?: SimPlayer };

/** Sauvegarde v3 : positions des joueurs + état de chaque système de jeu (rempli par server/game.ts). Le pool de véhicules n'est PAS sauvegardé. */
export interface SaveData {
  version: 3;
  players: Record<string, [number, number, number]>;
  systems: Record<string, unknown>;
}

let rapierReady: Promise<void> | null = null;

const DEATH = {
  explosion: ['{n} a été pulvérisé par {k}', '{n} s\'est envolé en confettis grâce à {k}', '{n} a pris le feu d\'artifice de {k} en pleine figure'],
  explosionAlone: ['{n} a explosé tout seul. Bravo.', '{n} est parti en fumée', '{n} a confondu explosif et oreiller'],
  bullet: ['{n} a été transformé en gruyère par {k}', '{n} a pris une rafale de {k}'],
  bulletAlone: ['{n} s\'est tiré dessus. Comment ?!'],
  impact: ['{n} a été aplati par {k}', '{n} a servi de paillasson à {k}'],
  impactAlone: ['{n} a embrassé un mur à pleine vitesse', '{n} a testé la dureté du sol'],
  void: ['{n} a découvert que le monde avait une fin', '{n} est tombé dans le grand rien'],
  generic: ['{n} a été éliminé par {k}', '{n} a connu une fin tragique, signée {k}'],
  genericAlone: ['{n} a rendu l\'âme', '{n} est mort. Mystère.'],
} as const;

export class Sim implements SimApi {
  readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  readonly players = new Map<string, SimPlayer>();
  readonly vehicles: VX[] = [];
  readonly props = new Map<number, PX>();
  time = 0;
  /** Vrai dès qu'une panique Rapier a empoisonné le monde : le serveur doit reconstruire une simulation (voir server.ts). */
  broken = false;
  /** Gouvernance (multi) : id du chef de la bande. Vide = tout est permis (tests, solo). */
  hostId = '';
  soloMode = false;
  /** Branchements du jeu (server/game.ts) : appelés sous try/catch, jamais obligatoires. */
  hooks: SimHooks = {};
  /** Branché par le serveur : annonce affichée dans le chat de tout le monde. */
  onAnnounce: ((text: string) => void) | null = null;
  log: (line: string) => void = (l) => console.warn(l);

  private owners = new Map<number, Owner>(); // handle de corps -> propriétaire
  private pinfo = new Map<string, PI>();
  private projs: Proj[] = [];
  private fxQueue: FxEvent[] = [];
  private pending: { at: number; pos: THREE.Vector3; e: NonNullable<PropKind['explosive']>; by: SimPlayer | null }[] = [];
  private savedPlayers = new Map<string, Vec3>(); // jamais un objet simple : un pseudo « constructor » / « __proto__ » ne doit rien casser
  private groundCol: RAPIER.Collider | null = null;
  private stepped = false;
  private freed = false;
  private nextPropId = 1;
  private nextProjId = 1;
  private spawnCount = 0;
  private removedIds: number[] = []; // props retirés depuis le dernier snapshot delta (déjà connus des clients)
  private vSent: string[] = []; // dernier état envoyé de chaque véhicule (delta réseau)
  private pSent = new Map<string, string>();

  static async create(): Promise<Sim> {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    const sim = new Sim();
    return sim;
  }

  private constructor() {
    this.buildCityColliders();
    this.buildPool();
    // Voitures du monde de départ : prises dans le pool, aux points d'apparition « car » de la ville (réapparaissent si détruites)
    const carSpawns = getCity().pois.filter((q) => q.kind === 'spawn' && q.tag === 'car');
    const startDef = VEHICLES[0];
    if (startDef) for (const q of carSpawns.slice(0, 2)) this.acquireVehicle(startDef.type, q.x, q.z, q.yaw, { keep: true });
  }

  /** Sol, bâtiments (cuboïdes fixes) et 4 murs de bordure : la ville de shared/city. Aucun de ces corps ne sera jamais retiré. */
  private buildCityColliders() {
    const w = this.world;
    const B = CITY.BORDER;
    this.groundCol = w.createCollider(RAPIER.ColliderDesc.cuboid(B + 2, 0.5, B + 2).setTranslation(0, -0.5, 0).setFriction(1).setCollisionGroups(grp(G.WORLD)));
    for (const b of getCity().buildings)
      w.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z).setFriction(0.9).setCollisionGroups(grp(G.WORLD)));
    const wallH = 15, t = 1;
    for (const [x, z, hx, hz] of [[0, -(B + t), B + 2 * t, t], [0, B + t, B + 2 * t, t], [-(B + t), 0, t, B], [B + t, 0, t, B]] as const)
      w.createCollider(RAPIER.ColliderDesc.cuboid(hx, wallH, hz).setTranslation(x, wallH, z).setFriction(0.2).setCollisionGroups(grp(G.WORLD)));
  }

  /** Crée une fois pour toutes les véhicules du pool (types définis dans VEHICLES), rangés (désactivés, hors du monde). */
  private buildPool() {
    for (const def of VEHICLES) {
      const n = (VEHICLE_POOL as Record<string, number>)[def.type] ?? 0;
      for (let k = 0; k < n; k++) this.makePooled(def, k);
    }
  }

  // =====================================================================================================================
  // Outils communs (SimApi)
  // =====================================================================================================================
  fx(ev: FxEvent) {
    if (this.fxQueue.length >= MAX_FX) this.fxQueue.shift();
    this.fxQueue.push(ev);
  }
  clearFx() { this.fxQueue.length = 0; this.removedIds.length = 0; }
  announce(text: string) {
    try { this.onAnnounce?.(text); } catch { /* le chat ne doit jamais casser la simulation */ }
  }
  quatOf(b: RAPIER.RigidBody) {
    const r = b.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }
  forwardSpeed(b: RAPIER.RigidBody) {
    const v = b.linvel();
    return new THREE.Vector3(v.x, v.y, v.z).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(this.quatOf(b)));
  }
  driveArcade(body: RAPIER.RigidBody, mass: number, accel: number, throttle: number, turn: number) {
    const q = this.quatOf(body);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const v = body.linvel();
    const lateral = v.x * right.x + v.z * right.z;
    if (throttle) body.applyImpulse(fwd.clone().multiplyScalar(throttle * accel * mass * STEP), true);
    else body.applyImpulse(fwd.clone().multiplyScalar(-(v.x * fwd.x + v.z * fwd.z) * mass * 1.5 * STEP), true); // frottement de roulement
    body.applyImpulse(right.multiplyScalar(-lateral * mass * 0.9), true);
    body.setAngvel({ x: 0, y: turn, z: 0 }, true);
  }
  sliding(desc: RAPIER.ColliderDesc) {
    return desc.setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
  }

  /**
   * Signale une erreur attrapée : si c'est une panique Rapier (monde empoisonné), pose `broken` et retourne true
   * (l'appelant ne doit alors ni la compter comme une défaillance d'objet/véhicule, ni réutiliser le monde).
   */
  noteError(e: unknown): boolean {
    if (!isPoison(e)) return false;
    if (!this.broken) this.log(`[sim] monde Rapier empoisonné (${String((e as Error)?.message ?? e).slice(0, 80)}) : reconstruction demandée`);
    this.broken = true;
    return true;
  }

  private safe(fn: () => void, label: string) {
    try { fn(); } catch (e) {
      if (this.noteError(e)) return;
      this.log(`[sim] erreur dans ${label} : ${(e as Error)?.stack ?? e}`);
    }
  }

  /** Libère la mémoire WASM du monde (arrêt du serveur, ancienne simulation remplacée). */
  dispose() {
    if (this.freed) return;
    this.freed = true;
    this.broken = true;
    try { this.world.free(); } catch { /* monde déjà empoisonné */ }
  }

  /** Joueurs connectés avec leur dernière position connue (sans toucher à Rapier : utilisable même si le monde est empoisonné). */
  knownPlayers(): { id: string; name: string; pos: Vec3 }[] {
    const out: { id: string; name: string; pos: Vec3 }[] = [];
    for (const p of this.players.values()) {
      const px = this.pinfo.get(p.id);
      if (px) out.push({ id: p.id, name: p.name, pos: [...px.last] as Vec3 });
    }
    return out;
  }

  /** Véhicule en jeu : ni rangé dans le pool, ni détruit, avec un corps. */
  private live(v: SimVehicle): boolean { return !v.pooled && !v.dead && !!v.behavior.body; }

  isHost(p: SimPlayer) { return this.soloMode || !this.hostId || this.hostId === p.id; }

  /**
   * Anti-enclavement : retourne un y libre (≥ y, jusqu'à +30 m) où la boîte donnée ne touche aucun solide fixe du décor
   * (arbres, bâtiments…), ou null s'il n'y en a pas. Un point sous le sol (y < 0) est d'abord remonté.
   */
  clearSpot(x: number, y: number, z: number, half: Vec3, q?: { x: number; y: number; z: number; w: number }): number | null {
    if (![x, y, z].every(Number.isFinite)) return null;
    if (!this.stepped) { try { this.world.step(); this.stepped = true; } catch (e) { this.noteError(e); return null; } } // les requêtes de scène n'existent qu'après un pas
    const shape = new RAPIER.Cuboid(half[0], half[1], half[2]);
    const rot = q ?? { x: 0, y: 0, z: 0, w: 1 };
    const base = y < 0 ? Math.max(1.5, half[1] + 0.1) : y;
    for (let dy = 0; dy <= 30; dy += 0.5) {
      const hit = this.world.intersectionWithShape({ x, y: base + dy, z }, rot, shape, undefined, undefined, this.groundCol ?? undefined, undefined,
        (c) => ((c.collisionGroups() >>> 16) & G.WORLD) !== 0 && (!c.parent() || c.parent()!.isFixed()));
      if (!hit) return base + dy;
    }
    return null;
  }

  // =====================================================================================================================
  // Props
  // =====================================================================================================================
  spawnProp(kindId: string, pos: THREE.Vector3, rot?: THREE.Quaternion, vel?: THREE.Vector3, owner?: SimPlayer | null): SimProp | null {
    const kind = propKindById(kindId);
    if (!kind) return null;
    const ownerId = owner?.id ?? '';
    if (ownerId) {
      const mine: PX[] = [];
      for (const p of this.props.values()) if (p.owner === ownerId && !p.base) mine.push(p);
      for (let i = 0; i <= mine.length - MAX_PROPS_PER_PLAYER; i++) this.removeProp(mine[i]);
    }
    while (this.props.size >= MAX_PROPS) {
      let oldest: PX | null = null;
      for (const p of this.props.values()) if (!p.base) { oldest = p; break; }
      if (!oldest) return null;
      this.removeProp(oldest);
    }
    return this.createProp(kindId, pos, rot, vel, ownerId);
  }

  private createProp(kindId: string, pos: THREE.Vector3, rot?: THREE.Quaternion, vel?: THREE.Vector3, ownerId = ''): PX | null {
    const kind = propKindById(kindId);
    if (!kind) return null;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.05).setAngularDamping(0.15);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    if (vel) desc.setLinvel(vel.x, vel.y, vel.z);
    if (kind.gravityScale !== undefined) desc.setGravityScale(kind.gravityScale);
    const body = this.world.createRigidBody(desc);
    const [a, b, c] = kind.size;
    let cd: RAPIER.ColliderDesc;
    switch (kind.shape) {
      case 'sphere': cd = RAPIER.ColliderDesc.ball(a / 2); break;
      case 'cylinder': cd = RAPIER.ColliderDesc.cylinder((b ?? a) / 2, a / 2); break;
      case 'wedge':
        cd = RAPIER.ColliderDesc.convexHull(new Float32Array(wedgeVertices(a, b ?? a, c ?? a)))
          ?? RAPIER.ColliderDesc.cuboid(a / 2, (b ?? a) / 2, (c ?? a) / 2);
        break;
      default: cd = RAPIER.ColliderDesc.cuboid(a / 2, (b ?? a) / 2, (c ?? a) / 2);
    }
    cd.setMass(Math.max(0.05, kind.mass)).setFriction(kind.friction ?? 0.8).setRestitution(kind.bounce ?? 0).setCollisionGroups(grp(G.PROP));
    this.world.createCollider(cd, body);
    const prop: PX = {
      id: this.nextPropId++, kind, body, owner: ownerId, frozen: false, held: false,
      hp: kind.hp ?? (kind.explosive ? 20 : 0), bornAt: this.time, base: false,
    };
    this.props.set(prop.id, prop);
    this.owners.set(body.handle, { prop });
    return prop;
  }

  removeProp(p: SimProp) {
    if (!this.props.has(p.id)) return;
    this.props.delete(p.id);
    if ((p as PX).sent) this.removedIds.push(p.id);
    this.owners.delete(p.body.handle);
    p.held = false;
    try { this.world.removeRigidBody(p.body); } catch { /* déjà retiré */ } // retire aussi les joints (soudures)
  }

  freezeProp(p: SimProp, frozen: boolean) {
    if (!this.props.has(p.id)) return;
    p.frozen = frozen;
    p.body.setBodyType(frozen ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    if (!frozen) p.body.wakeUp();
  }

  damageProp(p: SimProp, amount: number, by: SimPlayer | null = null) {
    const k = p.kind;
    if ((k.hp === undefined && !k.explosive) || !(amount > 0) || !this.props.has(p.id)) return;
    p.hp -= amount;
    if (p.hp > 0) return;
    const t = p.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    this.removeProp(p);
    if (k.explosive) this.pending.push({ at: this.time + 80 + Math.random() * 120, pos, e: k.explosive, by });
    else this.fx({ k: 'smoke', p: [t.x, t.y, t.z], a: 1 });
  }

  // =====================================================================================================================
  // Raycast / proximité
  // =====================================================================================================================
  private resolve(col: RAPIER.Collider): { kind: Hit['kind']; o?: Owner; body: RAPIER.RigidBody | null } {
    const rb = col.parent();
    if (!rb) return { kind: 'static', body: null };
    const o = this.owners.get(rb.handle);
    if (o) return { kind: o.prop ? 'prop' : o.vehicle ? 'vehicle' : 'player', o, body: rb };
    if ((col.collisionGroups() >>> 16) & (G.PART | G.VEHICLE)) {
      // pièce mobile d'un véhicule (bras, tourelle…) : véhicule vivant le plus proche
      const t = rb.translation();
      let best: VX | null = null;
      let bd = 12;
      for (const v of this.vehicles) {
        if (!this.live(v)) continue;
        const vt = v.behavior.body.translation();
        const d = Math.hypot(vt.x - t.x, vt.y - t.y, vt.z - t.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) return { kind: 'vehicle', o: { vehicle: best }, body: rb };
    }
    return { kind: 'static', body: rb };
  }

  private cast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude: RAPIER.RigidBody | null | undefined,
    pred?: (c: RAPIER.Collider) => boolean): Hit | null {
    const d = dir.clone();
    if (!(d.lengthSq() > 1e-9) || !Number.isFinite(maxDist) || maxDist <= 0) return null;
    d.normalize();
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: d.x, y: d.y, z: d.z });
    const h = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, exclude ?? undefined,
      (c) => !c.isSensor() && (!pred || pred(c)));
    if (!h) return null;
    const r = this.resolve(h.collider);
    const n = new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z);
    if (n.lengthSq() < 1e-6) n.copy(d).negate();
    return {
      kind: r.kind, point: origin.clone().addScaledVector(d, h.timeOfImpact), normal: n, dist: h.timeOfImpact, body: r.body,
      prop: r.o?.prop, vehicle: r.o?.vehicle, player: r.o?.player,
    };
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.RigidBody | null): Hit | null {
    return this.cast(origin, dir, maxDist, exclude);
  }

  nearby(pos: THREE.Vector3, radius: number): Hit[] {
    const out: Hit[] = [];
    const add = (kind: Hit['kind'], body: RAPIER.RigidBody, extra: Partial<Hit>) => {
      const t = body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (d > radius) return;
      const point = new THREE.Vector3(t.x, t.y, t.z);
      const normal = point.clone().sub(pos);
      if (normal.lengthSq() > 1e-9) normal.normalize(); else normal.set(0, 1, 0);
      out.push({ kind, point, normal, dist: d, body, ...extra });
    };
    for (const p of this.props.values()) add('prop', p.body, { prop: p });
    for (const v of this.vehicles) if (this.live(v)) add('vehicle', v.behavior.body, { vehicle: v });
    for (const p of this.players.values()) if (!p.vehicle && !this.isDead(p)) add('player', p.body, { player: p });
    return out.sort((a, b) => a.dist - b.dist);
  }

  // =====================================================================================================================
  // Explosions et dégâts
  // =====================================================================================================================
  /**
   * `power` ≈ vitesse (m/s) communiquée au centre à un objet léger ; les corps lourds sont moins projetés
   * (Δv = power × atténuation / (1 + masse/400)). `damage` = dégâts au centre (décroissants avec la distance, blindage inclus).
   */
  explode(pos: THREE.Vector3, radius: number, power: number, damage: number, by: SimPlayer | null = null) {
    radius = Math.max(0.5, fin(radius, 5));
    power = fin(power, 10);
    damage = fin(damage, 0);
    this.fx({ k: 'boom', p: [pos.x, pos.y, pos.z], a: radius });
    this.fx({ k: 'shake', p: [pos.x, pos.y, pos.z], a: clamp(radius / 8, 0.2, 1.5) });
    const dirTo = (x: number, y: number, z: number) => {
      const d = new THREE.Vector3(x - pos.x, y - pos.y + 0.4, z - pos.z);
      return d.lengthSq() > 1e-9 ? d.normalize() : new THREE.Vector3(0, 1, 0);
    };
    for (const p of [...this.props.values()]) {
      const t = p.body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (d > radius + 0.5) continue;
      const f = clamp(1 - d / radius, 0, 1);
      if (!p.frozen && f > 0) {
        const dv = (power * f) / (1 + p.body.mass() / 400);
        const dir = dirTo(t.x, t.y, t.z);
        p.body.applyImpulse({ x: dir.x * dv * p.body.mass(), y: dir.y * dv * p.body.mass(), z: dir.z * dv * p.body.mass() }, true);
        p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * dv * p.body.mass() * 0.3, y: 0, z: (Math.random() - 0.5) * dv * p.body.mass() * 0.3 }, true);
      }
      if (damage > 0) this.damageProp(p, damage * Math.max(f, 0.2), by);
    }
    for (const v of this.vehicles) {
      if (!this.live(v)) continue;
      const t = v.behavior.body.translation();
      const d = Math.max(0, Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z) - 1.5);
      if (d > radius) continue;
      const f = clamp(1 - d / radius, 0, 1);
      const b = v.behavior.body;
      const dv = (power * f) / (1 + b.mass() / 400);
      const dir = dirTo(t.x, t.y, t.z);
      b.applyImpulse({ x: dir.x * dv * b.mass(), y: dir.y * dv * b.mass(), z: dir.z * dv * b.mass() }, true);
      const lv = b.linvel();
      v.pv.set(lv.x, lv.y, lv.z); // l'explosion n'est pas un choc : elle a déjà ses propres dégâts
      if (damage > 0) this.damageVehicle(v, damage * f, 'explosion', by);
    }
    for (const p of [...this.players.values()]) {
      if (p.vehicle || this.isDead(p)) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      if (d > radius) continue;
      const f = clamp(1 - d / radius, 0, 1);
      const dir = dirTo(t.x, t.y, t.z);
      const v = power * f * 0.8;
      const kb = (p.scratch.kb as [number, number] | undefined) ?? [0, 0];
      kb[0] += dir.x * v;
      kb[1] += dir.z * v;
      p.scratch.kb = kb;
      const lv = p.body.linvel();
      p.body.setLinvel({ x: lv.x, y: Math.max(lv.y, dir.y * v * 0.9), z: lv.z }, true);
      if (damage > 0) this.damagePlayer(p, damage * f, by, 'explosion');
    }
  }

  damageVehicle(v0: SimVehicle, amount: number, kind: DamageKind, by: SimPlayer | null = null) {
    const v = v0 as VX;
    if (v.dead || v.pooled || !(amount > 0)) return;
    if (by) v.lastHitBy = by.id;
    const mult = v.def.armor[kind] ?? 1;
    v.hp -= amount * mult;
    if (v.hp <= 0) this.destroyVehicle(v, by);
  }

  damagePlayer(p: SimPlayer, amount: number, by: SimPlayer | null = null, cause = '') {
    if (this.isDead(p) || !Number.isFinite(amount)) return;
    if (amount < 0) { p.hp = Math.min(PLAYER_HP, p.hp - amount); return; }
    if (this.time < p.invulnUntil) return;
    p.hp -= amount;
    if (p.hp <= 0) this.killPlayer(p, by, cause);
  }

  private isDead(p: SimPlayer) { return (this.pinfo.get(p.id)?.deadAt ?? 0) > 0; }

  private killPlayer(p: SimPlayer, by: SimPlayer | null, cause: string) {
    const px = this.pinfo.get(p.id);
    if (!px || px.deadAt > 0) return;
    if (p.vehicle) this.leaveVehicle(p, false);
    p.hp = 0;
    px.deadAt = Math.max(1, this.time);
    const t = p.body.translation();
    this.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: '💀' });
    this.fx({ k: 'confetti', p: [t.x, t.y + 0.5, t.z], c: 0xff3355 });
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setEnabled(false);
    const c = cause === 'explosion' || cause === 'bullet' || cause === 'impact' || cause === 'void' ? cause : 'generic';
    const alone = !by || by === p;
    const key = (c === 'void' ? 'void' : alone ? `${c}Alone` : c) as keyof typeof DEATH;
    const list = (DEATH[key] ?? DEATH.generic) as readonly string[];
    this.announce(pick([...list]).replace('{n}', p.name).replace('{k}', by?.name ?? ''));
    this.callHook('onPlayerKilled', p, by, cause);
  }

  /** Appelle un crochet du jeu sans jamais laisser une exception remonter dans la simulation. */
  private callHook<K extends keyof SimHooks>(k: K, ...args: Parameters<NonNullable<SimHooks[K]>>): ReturnType<NonNullable<SimHooks[K]>> | undefined {
    const fn = this.hooks[k] as ((...a: unknown[]) => unknown) | undefined;
    if (!fn) return undefined;
    try { return fn(...args) as ReturnType<NonNullable<SimHooks[K]>>; } catch (e) {
      if (!this.noteError(e)) this.log(`[sim] crochet ${k} : ${(e as Error)?.stack ?? e}`);
      return undefined;
    }
  }

  respawnPlayer(p: SimPlayer) {
    const px = this.pinfo.get(p.id);
    if (!px) return;
    if (p.vehicle) this.leaveVehicle(p, false);
    p.hp = PLAYER_HP;
    p.scratch = {};
    px.deadAt = 0;
    p.body.setEnabled(true);
    p.body.setTranslation({ x: px.start[0], y: px.start[1], z: px.start[2] }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.invulnUntil = this.time + 3000;
  }

  // =====================================================================================================================
  // Projectiles
  // =====================================================================================================================
  spawnProjectile(spec: ProjectileSpec) {
    if (this.projs.length >= MAX_PROJECTILES) this.projs.shift();
    const idx = (PROJECTILE_KINDS as readonly string[]).indexOf(spec.kind);
    this.projs.push({
      id: this.nextProjId++, kind: idx >= 0 ? idx : PROJECTILE_KINDS.length, pos: spec.pos.clone(), vel: spec.vel.clone(), owner: spec.owner,
      gravity: fin(spec.gravity, 0), life: fin(spec.life, 6), age: 0, fuse: !!spec.fuse, bounce: !!spec.bounce,
      radius: fin(spec.radius, 0), power: fin(spec.power, 0), damage: fin(spec.damage, 0), onHit: spec.onHit, stuck: false,
    });
  }

  private stepProjectiles() {
    const keep: Proj[] = [];
    for (const pr of this.projs) {
      let alive = true;
      try { alive = this.stepProjectile(pr); } catch (e) { if (!this.noteError(e)) this.log(`[sim] projectile : ${e}`); alive = false; }
      if (alive) keep.push(pr);
    }
    this.projs = keep;
  }

  private detonate(pr: Proj, hit: Hit | null, at: THREE.Vector3) {
    if (pr.onHit) { pr.onHit(hit, at); return; }
    if (pr.radius > 0) { this.explode(at, pr.radius, pr.power, pr.damage, pr.owner); return; }
    if (!hit) return;
    if (hit.vehicle) this.damageVehicle(hit.vehicle, pr.damage, 'bullet', pr.owner);
    else if (hit.player) this.damagePlayer(hit.player, pr.damage, pr.owner, 'bullet');
    else if (hit.prop) {
      this.damageProp(hit.prop, pr.damage, pr.owner);
      if (this.props.has(hit.prop.id) && !hit.prop.frozen) {
        const m = hit.prop.body.mass();
        const d = pr.vel.clone().multiplyScalar(0.02 * Math.min(m, 20));
        hit.prop.body.applyImpulseAtPoint({ x: d.x, y: d.y, z: d.z }, { x: at.x, y: at.y, z: at.z }, true);
      }
    } else this.fx({ k: 'spark', p: [at.x, at.y, at.z] });
  }

  private stepProjectile(pr: Proj): boolean {
    pr.age += STEP;
    pr.life -= STEP;
    if (!pr.stuck) {
      pr.vel.y -= pr.gravity * STEP;
      const len = pr.vel.length() * STEP;
      if (len > 1e-6) {
        const owner = pr.owner && this.players.get(pr.owner.id) === pr.owner ? pr.owner : null; // propriétaire déconnecté : son corps n'existe plus
        const ownerVeh = owner?.vehicle ?? null;
        const hit = this.cast(pr.pos, pr.vel, len, owner?.body ?? null, (c) => {
          if (pr.age >= 0.25 || !ownerVeh) return true;
          const r = this.resolve(c);
          return r.o?.vehicle !== ownerVeh;
        });
        if (hit) {
          const at = hit.point;
          if (pr.fuse) {
            if (pr.bounce) {
              pr.vel.reflect(hit.normal).multiplyScalar(0.55);
              pr.pos.copy(at).addScaledVector(hit.normal, 0.05);
            } else { pr.stuck = true; pr.vel.set(0, 0, 0); pr.pos.copy(at); }
          } else {
            this.detonate(pr, hit, at);
            return false;
          }
        } else pr.pos.addScaledVector(pr.vel, STEP);
      }
    }
    if (pr.life <= 0) {
      if (pr.fuse) this.detonate(pr, null, pr.pos);
      return false;
    }
    return pr.pos.y > -60;
  }

  // =====================================================================================================================
  // Joueurs
  // =====================================================================================================================
  /** `at` : position imposée (reconstruction du monde) ; sinon position sauvegardée sous ce pseudo, sinon point de départ. */
  addPlayer(id: string, name: string, at?: Vec3) {
    if (this.players.has(id)) return;
    let saved: Vec3 | undefined = at ? vec3(at, [0, 0, 0]) : this.savedPlayers.get(name);
    if (!at && [...this.players.values()].some((q) => q.name === name)) saved = undefined; // pseudo déjà pris : pas de position partagée
    const spawns = getCity().pois.filter((q) => q.kind === 'spawn' && q.tag === 'player'); // rues dégagées, un point différent par joueur
    const sp = spawns[this.spawnCount % spawns.length];
    const wrap = Math.floor(this.spawnCount / spawns.length);
    this.spawnCount++;
    const start: Vec3 = [sp.x + (wrap % 2 ? 1.5 : -1.5) * Math.min(wrap, 1), 1.5, sp.z + wrap * 1.5];
    let [x, y, z] = saved ?? start;
    if (saved) {
      y += 0.5;
      const ny = this.clearSpot(x, y, z, [0.4, 0.9, 0.4]); // pas enterré dans le décor ni sous le sol
      if (ny === null) { [x, y, z] = start; saved = undefined; } else y = ny;
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).lockRotations().setLinearDamping(0),
    );
    const col = this.world.createCollider(this.playerCollider(), body);
    const p: SimPlayer = {
      id, name, body, input: { ...NO_INPUT }, prevInput: { ...NO_INPUT }, vehicle: null, seat: 0, hp: PLAYER_HP,
      invulnUntil: this.time + 2000, scratch: {},
    };
    this.players.set(id, p);
    this.pinfo.set(id, { col, deadAt: 0, start, runAt: 0, last: [x, y, z], joinedAt: this.time, ws: 0, an: 0 });
    this.owners.set(body.handle, { player: p });
  }

  private playerCollider() {
    return RAPIER.ColliderDesc.capsule(0.5, 0.35).setFriction(0).setMass(40).setCollisionGroups(grp(G.PLAYER));
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.rememberPlayer(p);
    if (p.vehicle) this.leaveVehicle(p, true);
    this.owners.delete(p.body.handle);
    this.players.delete(id);
    this.pinfo.delete(id);
    if (bodyOk(p.body)) this.world.removeRigidBody(p.body);
    if (this.hostId === id) this.hostId = '';
  }

  private rememberPlayer(p: SimPlayer) {
    const px = this.pinfo.get(p.id);
    if (!px || this.time - px.joinedAt < MIN_SESSION_MS) return; // passage éclair : on ne pollue pas la sauvegarde
    const vb = p.vehicle?.behavior.body;
    const b = vb && this.live(p.vehicle!) && bodyOk(vb) ? vb : p.body;
    if (!bodyOk(b)) return;
    const t = b.translation();
    if (![t.x, t.y, t.z].every(Number.isFinite)) return;
    this.savedPlayers.delete(p.name); // refresh de l'ordre : les plus anciens sortent en premier (FIFO)
    this.savedPlayers.set(p.name, [round(t.x), round(Math.max(t.y, 1)), round(t.z)]);
    while (this.savedPlayers.size > MAX_SAVED_PLAYERS) this.savedPlayers.delete(this.savedPlayers.keys().next().value as string);
  }

  setInput(id: string, raw: Partial<Input>) {
    const p = this.players.get(id);
    if (!p || !raw || typeof raw !== 'object') return;
    const ad = new THREE.Vector3(...vec3(raw.ad, [0, 0, -1]));
    if (ad.lengthSq() < 1e-6) ad.set(0, 0, -1);
    ad.normalize();
    // Origine de visée : bornée près du joueur (12 m de la tête ; 40 m du véhicule, la caméra de véhicule est plus reculée).
    const ao = vec3(raw.ao, [0, 0, 0]);
    if (ao[0] || ao[1] || ao[2]) {
      const veh = p.vehicle as VX | null;
      const vb = veh && this.live(veh) ? veh.behavior.body : null;
      const inVeh = bodyOk(vb);
      const rb = inVeh ? vb! : p.body;
      if (bodyOk(rb)) {
        const t = rb.translation();
        const ref = new THREE.Vector3(t.x, t.y + (inVeh ? 0 : 0.7), t.z);
        const d = new THREE.Vector3(ao[0], ao[1], ao[2]).sub(ref);
        const max = inVeh ? 40 : 12;
        if (d.length() > max) { d.setLength(max).add(ref); ao[0] = d.x; ao[1] = d.y; ao[2] = d.z; }
      } else { ao[0] = ao[1] = ao[2] = 0; }
    }
    p.input = {
      f: clamp1(raw.f), s: clamp1(raw.s), jump: raw.jump ? 1 : 0, run: raw.run ? 1 : 0, yaw: fin(raw.yaw), hn: raw.hn ? 1 : 0,
      act: raw.act ? 1 : 0, m1: raw.m1 ? 1 : 0, m2: raw.m2 ? 1 : 0, ao, ad: [ad.x, ad.y, ad.z],
    };
  }

  teleportPlayer(p: SimPlayer, x: number, y: number, z: number) {
    if (p.vehicle) this.leaveVehicle(p, false);
    p.body.setTranslation({ x, y, z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.scratch.kb = undefined;
  }

  // ---------- Véhicules : montée / descente ----------
  /** Monter dans le véhicule le plus proche (conducteur sinon passager), ou descendre. Un système de jeu peut préempter l'action (SimHooks.onInteract). */
  interact(id: string) {
    const p = this.players.get(id);
    if (!p || this.isDead(p)) return;
    if (p.vehicle) { this.leaveVehicle(p, true); return; }
    if (this.callHook('onInteract', p)) return;
    const t = p.body.translation();
    let best: VX | null = null;
    let bd = Infinity;
    for (const v of this.vehicles) {
      if (!this.live(v) || v.locked || this.freeSeat(v) < 0) continue;
      const vt = v.behavior.body.translation();
      const d = Math.hypot(t.x - vt.x, t.z - vt.z);
      if (d < v.def.enterRadius && Math.abs(t.y - vt.y) < v.def.enterRadius && d < bd) { best = v; bd = d; }
    }
    if (best) this.enterVehicle(p, best);
  }

  private freeSeat(v: SimVehicle): number {
    if (!v.driver) return 0;
    for (let s = 1; s < v.def.seats; s++) if (!v.passengers.some((q) => q.seat === s)) return s;
    return -1;
  }

  /** `force` : ignore verrouillage et refus du jeu (commandes de debug, scènes scénarisées). */
  enterVehicle(p: SimPlayer, v0: SimVehicle, seat?: number, force = false): boolean {
    const v = v0 as VX;
    if (this.isDead(p) || !this.live(v)) return false;
    if (p.vehicle === v) return true;
    if (!force) {
      const c = this.callHook('canEnter', p, v);
      if (c === false || (v.locked && c !== true)) return false;
    }
    const s = seat ?? this.freeSeat(v);
    if (s < 0 || s >= v.def.seats || (s === 0 ? v.driver : v.passengers.some((q) => q.seat === s))) return false;
    if (p.vehicle) this.leaveVehicle(p, false);
    p.vehicle = v;
    p.seat = s;
    if (s === 0) v.driver = p; else v.passengers.push(p);
    p.scratch.kb = undefined;
    p.body.setEnabled(false);
    this.callHook('onEnter', p, v);
    return true;
  }

  /** `place` : pose le joueur à côté du véhicule ; sinon (mort, éjection) sa position est laissée à l'appelant. */
  private leaveVehicle(p: SimPlayer, place: boolean) {
    const v = p.vehicle as VX | null;
    if (!v) return;
    const seat = p.seat;
    if (v.driver === p) v.driver = null;
    v.passengers = v.passengers.filter((q) => q !== p);
    p.vehicle = null;
    p.seat = 0;
    const b = v.behavior.body;
    let c = { x: v.home.x, y: 1, z: v.home.z };
    let side = new THREE.Vector3(v.def.exitOffset, 0, 0);
    if (b && this.live(v)) {
      c = b.translation();
      side.applyQuaternion(this.quatOf(b));
      if (seat % 2 === 1) side.negate();
      if (seat >= 2) side.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.quatOf(b)), 1.5 * Math.floor(seat / 2));
    } else side = new THREE.Vector3(0, 0, 0);
    p.body.setEnabled(true);
    if (place || this.live(v)) p.body.setTranslation({ x: c.x + side.x, y: c.y + 1.5, z: c.z + side.z }, true);
    else p.body.setTranslation({ x: c.x, y: c.y + 1, z: c.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.invulnUntil = Math.max(p.invulnUntil, this.time + 500);
  }

  // ---------- Véhicules : pool (création unique, jamais de removeRigidBody) ----------
  private dummyBehavior(): VX['behavior'] {
    return { body: null as unknown as RAPIER.RigidBody, step() {}, anim: () => ({ sp: 0, st: 0, a: [] }), dispose() {} };
  }

  /** Crée un véhicule rangé dans le pool. Son corps existe pour toute la vie du monde : on ne fait que l'activer / le désactiver. */
  private makePooled(def: VehicleDef, k: number): VX | null {
    const v: VX = {
      id: this.vehicles.length, def, behavior: this.dummyBehavior(), driver: null, passengers: [], hp: def.maxHp, dead: false,
      deadAt: 0, home: { x: PARK[0], z: PARK[2], yaw: 0 }, pv: new THREE.Vector3(), grace: 0, fails: 0, disabled: false,
      pose: { p: [...PARK] as Vec3, q: [0, 0, 0, 1] }, keep: false,
      gen: 0, pooled: true, locked: false, livery: 0, ai: null, lastHitBy: null,
    };
    try {
      const b = def.create(this, PARK[0] + k * 6, PARK[1], PARK[2], 0);
      v.behavior = b;
      this.owners.set(b.body.handle, { vehicle: v });
      b.body.setEnabled(false);
    } catch (e) {
      if (this.noteError(e)) throw e;
      this.log(`[sim] création du véhicule ${def.type} (pool ${k}) impossible : ${(e as Error)?.stack ?? e}`);
      return null; // pas de trou dans les index : le véhicule n'existe simplement pas
    }
    this.vehicles.push(v);
    return v;
  }

  /** Active le corps du véhicule à la pose donnée (corps remis à zéro). */
  private placeVehicle(v: VX, x: number, y: number, z: number, yaw: number) {
    const b = v.behavior.body;
    b.setEnabled(true);
    b.setTranslation({ x, y, z }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.wakeUp();
    v.pose = { p: [x, y, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
    v.pv.set(0, 0, 0);
    v.grace = this.time + 1500;
    v.fails = 0;
    v.disabled = false;
  }

  acquireVehicle(type: string, x: number, z: number, yaw: number, opts: AcquireOpts = {}): SimVehicle | null {
    if (![x, z, yaw].every(Number.isFinite)) return null;
    const v = this.vehicles.find((q) => q.pooled && q.def.type === type);
    if (!v) return null;
    v.pooled = false;
    v.dead = false;
    v.hp = v.def.maxHp;
    v.driver = null;
    v.passengers = [];
    v.locked = !!opts.locked;
    v.livery = Math.max(0, Math.floor(fin(opts.livery)));
    v.ai = opts.ai ? { input: { ...NO_INPUT } } : null;
    v.lastHitBy = null;
    v.keep = !!opts.keep;
    v.noImpactUntil = undefined;
    v.home = { x, z, yaw };
    this.placeVehicle(v, x, opts.y ?? 1.2, z, yaw);
    return v;
  }

  releaseVehicle(v0: SimVehicle) {
    const v = v0 as VX;
    if (v.pooled || this.vehicles[v.id] !== v) return;
    for (const p of [v.driver, ...v.passengers]) if (p && this.players.get(p.id) === p) this.leaveVehicle(p, this.live(v));
    v.driver = null;
    v.passengers = [];
    v.pooled = true;
    v.dead = false;
    v.hp = v.def.maxHp;
    v.gen++; // toute VRef conservée devient invalide
    v.locked = false;
    v.livery = 0;
    v.ai = null;
    v.lastHitBy = null;
    v.keep = false;
    v.disabled = false;
    v.fails = 0;
    v.pose = { p: [...PARK] as Vec3, q: [0, 0, 0, 1] };
    const b = v.behavior.body;
    if (bodyOk(b)) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.setTranslation({ x: PARK[0] + v.id * 6, y: PARK[1], z: PARK[2] }, true);
      b.setEnabled(false);
    }
  }

  refOf(v: SimVehicle): VRef { return { id: v.id, gen: v.gen }; }

  resolveRef(r: VRef | null | undefined): SimVehicle | null {
    if (!r || !Number.isInteger(r.id) || !Number.isInteger(r.gen)) return null;
    const v = this.vehicles[r.id];
    if (!v || v.gen !== r.gen || !this.live(v) || !bodyOk(v.behavior.body)) return null;
    return v;
  }

  playerPos(p: SimPlayer): Vec3 {
    const v = p.vehicle as VX | null;
    if (v && this.live(v)) return [...v.pose.p] as Vec3;
    if (bodyOk(p.body)) {
      const t = p.body.translation();
      if (Number.isFinite(t.x + t.y + t.z)) return [t.x, t.y, t.z];
    }
    return [...(this.pinfo.get(p.id)?.last ?? [0, 0, 0])] as Vec3;
  }

  /** Publié dans le snapshot (PlayerSnap.ws / an) : étoiles de recherche et animation, fixés par les systèmes de jeu. */
  setPlayerSnap(id: string, patch: { ws?: number; an?: number }) {
    const px = this.pinfo.get(id);
    if (!px) return;
    if (patch.ws !== undefined) px.ws = clamp(Math.round(fin(patch.ws)), 0, 5);
    if (patch.an !== undefined) px.an = clamp(Math.round(fin(patch.an)), 0, 255);
  }

  private destroyVehicle(v: VX, by: SimPlayer | null) {
    if (v.dead || v.pooled) return;
    let pos = new THREE.Vector3(v.home.x, 1, v.home.z);
    if (bodyOk(v.behavior.body)) {
      const t = v.behavior.body.translation();
      pos = new THREE.Vector3(t.x, t.y, t.z);
    }
    v.hp = 0;
    v.dead = true;
    v.deadAt = this.time;
    for (const p of [v.driver, ...v.passengers]) {
      if (!p) continue;
      this.leaveVehicle(p, false);
      p.body.setTranslation({ x: pos.x, y: pos.y + 1.5, z: pos.z }, true);
      p.scratch.kb = [(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10];
      p.body.setLinvel({ x: 0, y: 8, z: 0 }, true);
      p.invulnUntil = 0;
      this.damagePlayer(p, 70, by, 'explosion');
    }
    v.pose.p = [pos.x, pos.y, pos.z];
    const b = v.behavior.body;
    if (bodyOk(b)) { // le corps reste dans le monde (pool) : on le désactive
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.setEnabled(false);
    }
    const radius = clamp(4 + v.def.maxHp / 50, 5, 9);
    this.explode(pos, radius, 14, 50, by);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 5 + Math.random() * 9;
      this.createProp('debris', new THREE.Vector3(pos.x + (Math.random() - 0.5), pos.y + 0.5, pos.z + (Math.random() - 0.5)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
        new THREE.Vector3(Math.cos(a) * s, 4 + Math.random() * 8, Math.sin(a) * s), '');
    }
    this.callHook('onVehicleDestroyed', v, by);
  }

  /** Fin de l'attente après destruction : retour au point d'origine (véhicule du monde) ou au pool (trafic, police…). */
  private recycleDead(v: VX) {
    if (!v.keep) { this.releaseVehicle(v); return; }
    v.gen++;
    v.hp = v.def.maxHp;
    v.dead = false;
    v.lastHitBy = null;
    this.placeVehicle(v, v.home.x, 1.2, v.home.z, v.home.yaw);
  }

  // =====================================================================================================================
  // Pas de simulation
  // =====================================================================================================================
  step() {
    if (this.broken) return; // monde empoisonné : plus rien ne doit toucher Rapier, le serveur va reconstruire
    this.safe(() => this.stepPlayers(), 'joueurs');
    this.safe(() => this.stepVehicles(), 'véhicules');
    this.safe(() => this.stepProjectiles(), 'projectiles');
    this.safe(() => this.stepProps(), 'props');
    if (this.broken) return;
    try {
      this.world.step();
      this.stepped = true;
    } catch (e) {
      if (this.noteError(e)) return;
      throw e;
    }
    this.safe(() => this.postStep(), 'post-pas');
    this.time += STEP * 1000;
  }

  private stepPlayers() {
    for (const p of this.players.values()) {
      const px = this.pinfo.get(p.id);
      if (!px) continue;
      if (px.deadAt > 0) {
        if (this.time - px.deadAt >= RESPAWN_PLAYER_MS) this.respawnPlayer(p);
        p.prevInput = p.input;
        continue;
      }
      this.safe(() => {
        if (!p.vehicle) {
          this.walk(p);
          if (p.input.m1 && !p.prevInput.m1) {
            const t = p.body.translation();
            this.callHook('onShot', p, [t.x, t.y + 0.7, t.z], [...p.input.ad] as Vec3);
          }
        }
      }, `joueur ${p.name}`);
      p.prevInput = p.input;
    }
  }

  private grounded(p: SimPlayer) {
    const t = p.body.translation();
    const len = 0.85 + 0.2;
    return !!this.world.castRay(new RAPIER.Ray(t, { x: 0, y: -1, z: 0 }), len, true, undefined, undefined, undefined, p.body, (c) => !c.isSensor());
  }

  private walk(p: SimPlayer) {
    const i = p.input;
    const dir = new THREE.Vector3(i.s, 0, -i.f).applyAxisAngle(Y_AXIS, i.yaw);
    if (dir.lengthSq() > 1) dir.normalize();
    dir.multiplyScalar(i.run ? RUN : WALK);
    const v = p.body.linvel();
    const ground = this.grounded(p);
    const vy = v.y;
    // Roulade d'esquive : `jump` à pied (front montant, au sol), courte invulnérabilité ; `an` = 2 dans le snapshot pendant la roulade
    const roll = (p.scratch.roll ??= newRoll()) as RollState;
    if (i.jump && !p.prevInput.jump && ground && startRoll(roll, this.time, i.f, i.s, i.yaw))
      p.invulnUntil = Math.max(p.invulnUntil, this.time + ONFOOT.rollMs * 0.8);
    const rv = rollVelocity(roll, this.time);
    const px = this.pinfo.get(p.id);
    if (px) px.an = rv ? 2 : px.an === 2 ? 0 : px.an;
    const kb = p.scratch.kb as [number, number] | undefined;
    let kx = 0, kz = 0;
    if (kb) {
      kx = kb[0];
      kz = kb[1];
      const decay = ground ? 0.88 : 0.992;
      kb[0] *= decay;
      kb[1] *= decay;
      if (Math.hypot(kb[0], kb[1]) < 0.2) p.scratch.kb = undefined;
    }
    p.body.setLinvel({ x: (rv ? rv[0] : dir.x) + kx, y: vy, z: (rv ? rv[1] : dir.z) + kz }, true);
  }

  // ---------- Véhicules ----------
  private stepVehicles() {
    for (const v of this.vehicles) {
      if (v.pooled) continue;
      if (v.dead) {
        if (this.time - v.deadAt >= RESPAWN_VEHICLE_MS) this.recycleDead(v);
        continue;
      }
      if (v.disabled) continue;
      // Un conducteur humain a toujours priorité sur le pilote automatique
      const ctx: StepCtx = { input: this.inputOf(v), driver: v.driver, dt: STEP, api: this, self: v };
      try {
        v.behavior.step(ctx);
        v.fails = 0;
      } catch (e) {
        if (this.noteError(e)) return;
        this.log(`[sim] véhicule ${v.def.type}#${v.id} step : ${(e as Error)?.stack ?? e}`);
        if (++v.fails >= 5) { v.disabled = true; this.log(`[sim] véhicule ${v.def.type}#${v.id} désactivé`); }
      }
    }
  }

  private inputOf(v: VX): Input { return v.driver ? v.driver.input : v.ai ? v.ai.input : NO_INPUT; }

  private stepProps() {
    const dead: PX[] = [];
    for (const p of this.props.values()) {
      const life = p.kind.life;
      if (life !== undefined && this.time - p.bornAt > life * 1000) { dead.push(p); continue; }
      if (p.body.isSleeping()) continue; // endormi : ne bouge pas, ne tombe pas
      const y = p.body.translation().y;
      if (y < -60 || !Number.isFinite(y)) dead.push(p);
    }
    for (const p of dead) this.removeProp(p);
  }

  private postStep() {
    const g = this.world.gravity.y;
    for (const v of this.vehicles) {
      if (v.pooled || v.dead || v.disabled || !v.behavior.body) continue;
      const b = v.behavior.body;
      const t = b.translation();
      if (!Number.isFinite(t.x + t.y + t.z)) { this.destroyVehicle(v, null); continue; }
      if (t.y < -40) { // tombé hors du monde : retour au point d'origine
        b.setTranslation({ x: v.home.x, y: 1.5, z: v.home.z }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        v.grace = this.time + 1500;
      }
      const r = b.rotation();
      v.pose = { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
      const lv = b.linvel();
      if (this.time < v.grace || this.time < (v.noImpactUntil ?? 0)) { v.pv.set(lv.x, lv.y, lv.z); continue; }
      const dv = Math.hypot(lv.x - v.pv.x, lv.y - v.pv.y - g * STEP * b.gravityScale(), lv.z - v.pv.z);
      v.pv.set(lv.x, lv.y, lv.z);
      if (dv > v.def.impact.threshold) {
        const by = v.driver;
        this.damageVehicle(v, (dv - v.def.impact.threshold) * v.def.impact.scale, 'impact', by);
        if (v.behavior.onImpact && !v.dead) {
          const ctx: StepCtx = { input: this.inputOf(v), driver: v.driver, dt: STEP, api: this, self: v };
          this.safe(() => v.behavior.onImpact!(dv, ctx), `onImpact ${v.def.type}`);
        }
      }
      if (!v.dead) this.runOver(v, lv);
    }
    for (const p of this.players.values()) {
      const px = this.pinfo.get(p.id);
      if (p.vehicle) { if (px) px.last = [...(p.vehicle as VX).pose.p] as Vec3; continue; }
      if (this.isDead(p)) continue;
      const pt = p.body.translation();
      if (px && Number.isFinite(pt.x + pt.y + pt.z)) px.last = [pt.x, pt.y, pt.z];
      if (pt.y < -30) this.killPlayer(p, null, 'void');
    }
    // explosions en chaîne différées
    if (this.pending.length) {
      const due = this.pending.filter((e) => e.at <= this.time);
      this.pending = this.pending.filter((e) => e.at > this.time);
      for (const e of due) this.explode(e.pos, e.e.radius, e.e.power, e.e.damage, e.by);
    }
  }

  /** Un véhicule rapide qui fonce sur un joueur à pied lui fait mal et l'envoie valser. */
  private runOver(v: VX, lv: { x: number; y: number; z: number }) {
    const sp = Math.hypot(lv.x, lv.z);
    if (sp < 7) return;
    const t = v.behavior.body.translation();
    for (const p of this.players.values()) {
      if (p.vehicle || this.isDead(p) || p === v.driver) continue;
      const px = this.pinfo.get(p.id);
      const pt = p.body.translation();
      if (!px || this.time < px.runAt || Math.hypot(pt.x - t.x, pt.z - t.z) > 2.3 || Math.abs(pt.y - t.y) > 2) continue;
      px.runAt = this.time + 600;
      p.scratch.kb = [lv.x * 0.9, lv.z * 0.9];
      p.body.setLinvel({ x: 0, y: 5, z: 0 }, true);
      this.damagePlayer(p, (sp - 5) * 4, v.driver, 'impact');
    }
  }

  // =====================================================================================================================
  // État envoyé aux clients
  // =====================================================================================================================
  /** Snapshot complet (tests, nouveaux arrivants). Vide la file d'effets. */
  snapshot(): Snapshot {
    const s = this.buildSnapshot(false);
    s.fx = this.fxQueue;
    this.fxQueue = [];
    return s;
  }

  /** À appeler quand plus personne n'est connecté : le prochain client reçoit un snapshot complet puis des deltas cohérents. */
  resetDelta() {
    this.vSent.length = 0;
    this.pSent.clear();
    this.removedIds.length = 0;
    for (const p of this.props.values()) (p as PX).sent = undefined;
  }

  /** Snapshot complet sans toucher à la file d'effets ni à l'état delta : pour un client qui vient de rejoindre. */
  snapshotFull(): Snapshot {
    return this.buildSnapshot(false);
  }

  /**
   * Snapshot différentiel (additif, voir Snapshot.d) : seuls les props / véhicules qui ont changé depuis le dernier appel.
   * Doit être appelé à chaque envoi ; les clients qui rejoignent reçoivent snapshotFull() à la place pour CE tick.
   */
  snapshotDelta(): Snapshot {
    const s = this.buildSnapshot(true);
    if (this.fxQueue.length) s.fx = this.fxQueue;
    this.fxQueue = [];
    return s;
  }

  private buildSnapshot(delta: boolean): Snapshot {
    const players: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      const b = p.vehicle && this.live(p.vehicle) ? p.vehicle.behavior.body : p.body;
      const t = b.translation();
      const ps: PlayerSnap = {
        id: p.id, name: p.name, p: [round(t.x), round(t.y), round(t.z)], yaw: round(p.input.yaw, 1000),
        veh: p.vehicle ? this.vehicles.indexOf(p.vehicle as VX) : -1, seat: p.seat, hp: Math.max(0, Math.round(p.hp)),
      };
      const pxi = this.pinfo.get(p.id);
      if (pxi?.ws) ps.ws = pxi.ws;
      if (pxi?.an) ps.an = pxi.an;
      if (delta) { // le nom n'est envoyé qu'une fois par joueur et par client (le client le mémorise par id)
        if (this.pSent.get(p.id) === p.name) delete (ps as Partial<PlayerSnap>).name;
        else this.pSent.set(p.id, p.name);
      }
      players.push(ps);
    }
    if (delta && this.pSent.size > this.players.size) for (const id of this.pSent.keys()) if (!this.players.has(id)) this.pSent.delete(id);
    const vehicles: VehicleSnap[] = [];
    const vi: number[] = [];
    this.vehicles.forEach((v, idx) => {
      let a = { sp: 0, st: 0, a: [] as number[] };
      let pp = v.pose.p, qq = v.pose.q;
      if (!v.dead && !v.pooled && v.behavior.body) {
        try {
          const t = v.behavior.body.translation();
          const r = v.behavior.body.rotation();
          pp = [t.x, t.y, t.z];
          qq = [r.x, r.y, r.z, r.w];
          a = v.behavior.anim();
        } catch { /* corps retiré par le véhicule lui-même */ }
      }
      const vs: VehicleSnap = {
        type: v.def.type, p: [round(pp[0]), round(pp[1]), round(pp[2])], q: [round(qq[0], 1000), round(qq[1], 1000), round(qq[2], 1000), round(qq[3], 1000)],
        drv: v.driver?.id ?? '', sp: round(fin(a.sp)), st: round(fin(a.st)), a: (a.a ?? []).map((n) => round(fin(n), 1000)),
        hp: round(clamp(v.hp / v.def.maxHp, 0, 1)), dead: v.pooled ? 2 : v.dead ? 1 : 0,
      };
      const lvy = v.livery || (v.def.type === 'police' ? 0 : civilLivery(v.id)); // civils : couleur déterminée par l'id, identique chez tous les clients
      if (lvy) vs.lv = lvy;
      if (v.locked) vs.lk = 1;
      if (v.ai) vs.ai = 1;
      if (delta) {
        const str = JSON.stringify(vs);
        if (this.vSent[idx] === str) return;
        this.vSent[idx] = str;
        vi.push(idx);
      }
      vehicles.push(vs);
    });
    const props: number[] = [];
    for (const p of this.props.values()) {
      const flags = (p.frozen ? 1 : 0) | (p.held ? 2 : 0);
      const last = delta ? p.sent : undefined;
      const asleep = delta && p.body.isSleeping();
      if (last && last[9] === flags && asleep && (p as PX).sentAsleep) continue; // endormi et déjà connu : rien à renvoyer
      if (delta) (p as PX).sentAsleep = asleep; // (la 1re lecture endormie est comparée : l'arrondi du dernier mouvement)
      const t = p.body.translation();
      const r = p.body.rotation();
      const x = round(t.x), y = round(t.y), z = round(t.z), qx = round(r.x, 1000), qy = round(r.y, 1000), qz = round(r.z, 1000), qw = round(r.w, 1000);
      if (delta) {
        if (last && last[2] === x && last[3] === y && last[4] === z && last[5] === qx && last[6] === qy && last[7] === qz && last[8] === qw && last[9] === flags) continue;
        p.sent = [p.id, 0, x, y, z, qx, qy, qz, qw, flags];
      }
      props.push(p.id, PROP_INDEX.get(p.kind.id) ?? 0, x, y, z, qx, qy, qz, qw, flags);
    }
    const proj: number[] = [];
    for (const pr of this.projs) proj.push(pr.id, pr.kind, round(pr.pos.x), round(pr.pos.y), round(pr.pos.z), round(pr.vel.x, 10), round(pr.vel.y, 10), round(pr.vel.z, 10));
    const snap: Snapshot = { t: Math.round(this.time), players, vehicles, props, proj, fx: [] };
    if (delta) {
      snap.d = 1;
      snap.vn = this.vehicles.length;
      snap.vi = vi;
      if (this.removedIds.length) { snap.rm = this.removedIds; this.removedIds = []; }
    }
    return snap;
  }

  // =====================================================================================================================
  // Sauvegarde v3 : positions des joueurs (les systèmes de jeu ajoutent leur état dans `systems`, voir server/game.ts)
  // =====================================================================================================================
  serialize(): SaveData {
    for (const p of this.players.values()) this.rememberPlayer(p);
    return { version: 3, players: Object.fromEntries(this.savedPlayers) as SaveData['players'], systems: {} };
  }

  restore(data: SaveData) {
    if (!data || typeof data !== 'object' || (data as { version?: number }).version !== 3) return; // v1, v2 ou inconnue : ignorée sans erreur
    const okVec = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (data.players && typeof data.players === 'object' && !Array.isArray(data.players)) {
      const m = new Map<string, Vec3>();
      for (const [name, pos] of Object.entries(data.players)) {
        if (BAD_KEYS.has(name) || name.length === 0 || name.length > 16 || !okVec(pos, 3)) continue;
        m.set(name, [clamp(pos[0], -GROUND, GROUND), clamp(pos[1], -5, 400), clamp(pos[2], -GROUND, GROUND)]);
      }
      this.savedPlayers = new Map([...m].slice(-MAX_SAVED_PLAYERS)); // plafond : on garde les 200 dernières entrées (FIFO)
    }
  }
}
