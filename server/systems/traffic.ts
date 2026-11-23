// PROPRIÉTAIRE : game-camera-driving
// Trafic civil : jusqu'à 24 voitures du pool (citadine / berline / camionnette) pilotées par v.ai.input (steerTo + voies de shared/city/lanes.ts)
// et des voitures GARÉES (places de stationnement le long des rues, verrouillées, immobiles tant qu'un mini-jeu ne les a pas déverrouillées via `unlock`).
// Règle Rapier : aucune référence de corps conservée entre deux ticks. On garde des VRef (+ des nombres) et on revalide
// (sim.refOf/resolveRef + bodyOk) avant chaque lecture. serialize() ne lit pas Rapier (trafic éphémère : seulement la graine).
// Coût : le travail est réparti sur les ticks (nettoyage tous les 30, apparition d'une seule voiture à la fois, IA en tiers à 20 Hz par voiture)
// et la boucle chaude n'alloue presque rien (obstacles réutilisés, waypoints et itinéraires en cache).
import * as THREE from 'three';
import type { SimVehicle, VRef } from '../../shared/api';
import { newDriveMem, steerTo, type DriveMem } from '../../shared/ai/drive';
import { laneWaypoints, nearestLane, nextLane, parkingSlots, routeLanes, turnKind, type Lane, type ParkSlot } from '../../shared/city/lanes';
import { bodyOk } from '../../shared/guard';
import type { GameSystem, SystemFactory } from '../../shared/game';
import { PED_ST, type PedState } from '../../shared/peds';

/** Civils en circulation visés au maximum (atteint avec 3 joueurs ou plus). */
export const MOVING_MAX = 24;
/** Voitures garées tenues au maximum. */
export const PARKED_MAX = 8;
/** Plafond de voitures tenues par le système (en mouvement + garées). */
export const TRAFFIC_MAX = MOVING_MAX + PARKED_MAX;
/** Emplacements du pool de civils laissés libres pour les autres systèmes (missions, vol, joueurs). */
const POOL_RESERVE = 3;
/** Population en mouvement visée selon le nombre de joueurs : min(24, 12 + 5 × joueurs). */
export const movingTarget = (players: number) => Math.min(MOVING_MAX, 12 + 5 * Math.max(0, players));
/** Garantie : au moins autant de voitures garées verrouillées à moins de PARKED_NEAR m de chaque joueur. */
export const PARKED_GUARANTEE = 2;
export const PARKED_NEAR = 90;
const PARKED_VISIBLE = 45; // on préfère faire apparaître une garée au-delà (hors champ), mais jamais au-delà de PARKED_NEAR - 2
const PARKED_TOO_CLOSE = 28;
const SPAWN_MIN = 70, SPAWN_MAX = 110, DESPAWN = 140;
const AI_EVERY = 3; // pas physiques entre deux décisions d'une même voiture (60 Hz / 3 = 20 Hz) ; les voitures sont réparties en 3 tranches
const AI_DT = AI_EVERY / 60;
const CULL_EVERY = 30; // 0,5 s : revalidation et disparition
const SPAWN_CIVIL_AT = 10, SPAWN_PARKED_AT = 15; // périodes (ticks) des essais d'apparition : une seule voiture par essai
const HALF_LEN = 2.3; // demi-longueur d'une voiture (m)

export interface TrafficSystem extends GameSystem {
  /**
   * Déverrouille une voiture garée par le trafic (appelé par le système des mini-jeux après une réussite) : `v.locked = false`,
   * la voiture reste garée (immobile) jusqu'à ce qu'un joueur la conduise. Dès qu'un joueur la conduit elle sort du trafic
   * (jamais recyclée par le trafic). Retourne true si `v` était bien une voiture garée du trafic, false sinon (aucun effet).
   */
  unlock(v: SimVehicle): boolean;
  /** Vrai si `v` est une voiture garée (verrouillée ou non) encore tenue par le trafic. */
  isParked(v: SimVehicle): boolean;
  /** Vrai si `v` est un civil en circulation tenu par le trafic. */
  isCivil(v: SimVehicle): boolean;
  /** Nombre de voitures garées tenues à moins de `r` m de (x, z). */
  parkedNear(x: number, z: number, r: number): number;
  /** Nombres de voitures tenues (tests, debug). */
  readonly counts: { moving: number; parked: number };
}

interface Civil {
  ref: VRef;
  mem: DriveMem;
  route: Lane[]; // voies à suivre ; waypoint i = bout (ou coin) de route[i]
  wps: { x: number; z: number }[] | null; // waypoints de `route` (cache, null = à recalculer)
  wpi: number;
  cruise: number; // vitesse de croisière (m/s)
  fleeUntil: number; // temps de simulation (ms)
  honk: boolean;
  still: number; // secondes presque à l'arrêt
  x: number; z: number; // dernière position connue (nombres : jamais de corps)
  lastSp: number;
  lastHp: number;
  age: number; // secondes
  shift: number; // décalage latéral courant vers la gauche (m) pour dépasser une voiture garée
  slice: number; // tranche d'IA (0..2)
  n: number; // décisions prises (le rayon d'obstacle n'est lancé qu'une fois sur deux)
  rayGap: number; // dernier résultat du rayon d'obstacle (m, Infinity = rien) : le rayon n'est lancé qu'une décision sur deux
}
interface Parked { ref: VRef; slot: string; x: number; z: number }

/** État d'un véhicule vivant lu une fois par cycle d'IA (objets réutilisés). kind : 0 autre (joueur, police…), 1 civil, 2 garé. */
interface Obs { id: number; x: number; z: number; fx: number; fz: number; vx: number; vz: number; sp: number; kind: 0 | 1 | 2 }
const newObs = (): Obs => ({ id: 0, x: 0, z: 0, fx: 0, fz: 0, vx: 0, vz: 0, sp: 0, kind: 0 });

const TYPES: Array<{ type: string; w: number; lo: number; hi: number }> = [
  { type: 'citadine', w: 0.42, lo: 11.5, hi: 15.5 },
  { type: 'berline', w: 0.38, lo: 12, hi: 16 },
  { type: 'camionnette', w: 0.2, lo: 10, hi: 13 },
];
const CIVIL_TYPES = new Set(TYPES.map((t) => t.type));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const createTraffic: SystemFactory = (ctx): TrafficSystem => {
  const { sim, bus, city } = ctx;
  let rng = 20260611;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  let tick = 0;
  let civils: Civil[] = [];
  let parked: Parked[] = [];
  let sliceCounter = 0;
  const slots = parkingSlots(city);
  const slotHash = slots.map((_, i) => ((i * 2654435761) >>> 0) % 1009);
  const org = new THREE.Vector3(), dir = new THREE.Vector3();
  const kinds = new Map<number, 1 | 2>(); // id de véhicule -> civil / garé
  const obs: Obs[] = [];
  let obsN = 0;
  const rd = newObs(); // lecture réutilisée

  const playerPositions = (): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of sim.players.values()) {
      try {
        const q = sim.playerPos(p);
        if (Number.isFinite(q[0]) && Number.isFinite(q[2])) out.push([q[0], q[2]]);
      } catch { /* joueur en cours de retrait */ }
    }
    return out;
  };
  const nearestPlayerDist = (x: number, z: number, pl: [number, number][]) => {
    let d2 = Infinity;
    for (const [px, pz] of pl) { const dx = px - x, dz = pz - z; d2 = Math.min(d2, dx * dx + dz * dz); }
    return Math.sqrt(d2);
  };

  /** Lit un véhicule (revalidé) dans l'objet réutilisé `rd` : pose et vitesse. Retourne le véhicule valide ou null. */
  const read = (v0: SimVehicle): SimVehicle | null => {
    const v = sim.resolveRef(sim.refOf(v0));
    if (!v || !bodyOk(v.behavior.body)) return null;
    const b = v.behavior.body;
    const t = b.translation(), q = b.rotation(), lv = b.linvel();
    const h = 2 * Math.atan2(q.y, q.w);
    const fx = -Math.sin(h), fz = -Math.cos(h);
    if (!Number.isFinite(t.x + t.z + h + lv.x + lv.z)) return null;
    rd.id = v.id; rd.x = t.x; rd.z = t.z; rd.fx = fx; rd.fz = fz; rd.vx = lv.x; rd.vz = lv.z; rd.sp = lv.x * fx + lv.z * fz;
    return v;
  };

  // ---------- Itinéraires ----------
  const extendRoute = (c: Civil) => {
    c.wps = null;
    const last = c.route[c.route.length - 1];
    for (let k = 0; k < 6; k++) {
      const dest = city.nodes[Math.floor(rand() * city.nodes.length)];
      if (!dest || dest.id === last.to) continue;
      if (Math.hypot(dest.x - city.nodes[last.to].x, dest.z - city.nodes[last.to].z) < 100) continue;
      const r = routeLanes(city, last.to, dest.id, last); // en cache après la première demande
      if (r && r.length) { for (const l of r) c.route.push(l); return; }
    }
    const nl = nextLane(city, last, rand());
    if (nl) c.route.push(nl);
  };

  // ---------- Population ----------
  const pickType = () => {
    let r = rand();
    for (const t of TYPES) { r -= t.w; if (r < 0) return t; }
    return TYPES[0];
  };

  /** Emplacements du pool de civils encore libres (rangés). */
  const freeCivilSlots = () => {
    let n = 0;
    for (const v of sim.vehicles) if (v.pooled && CIVIL_TYPES.has(v.def.type)) n++;
    return n;
  };

  const clearAround = (x: number, z: number, r: number) => {
    const r2 = r * r;
    for (const v of sim.vehicles) {
      if (v.pooled || v.dead || !bodyOk(v.behavior.body)) continue;
      const t = v.behavior.body.translation();
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < r2) return false;
    }
    return true;
  };

  const trySpawnCivil = (players: [number, number][]): boolean => {
    if (!players.length) return false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const o = players[Math.floor(rand() * players.length)];
      const a = rand() * Math.PI * 2, d = SPAWN_MIN + 3 + rand() * (SPAWN_MAX - SPAWN_MIN - 6);
      const nl = nearestLane(city, o[0] + Math.cos(a) * d, o[1] + Math.sin(a) * d, 10);
      if (!nl) continue;
      const lane = nl.lane, t = clamp(nl.t, 0.22, 0.78);
      const x = lane.x0 + (lane.x1 - lane.x0) * t, z = lane.z0 + (lane.z1 - lane.z0) * t;
      if (nearestPlayerDist(x, z, players) < SPAWN_MIN - 2) continue;
      if (!clearAround(x, z, 11)) continue;
      const first = pickType();
      const order = [first, ...TYPES.filter((q) => q !== first)];
      let v: SimVehicle | null = null, spec = first;
      for (const q of order) {
        v = sim.acquireVehicle(q.type, x, z, lane.yaw, { ai: true, y: 0.7 });
        if (v) { spec = q; break; }
      }
      if (!v) return false; // pool vide : on réessaiera plus tard
      const cruise = spec.lo + rand() * (spec.hi - spec.lo);
      const c: Civil = {
        ref: sim.refOf(v), mem: newDriveMem(), route: [lane], wps: null, wpi: 0, cruise, fleeUntil: 0, honk: false, still: 0,
        x, z, lastSp: 0, lastHp: v.hp, age: 0, shift: 0, slice: sliceCounter++ % AI_EVERY, n: 0, rayGap: Infinity,
      };
      extendRoute(c);
      civils.push(c);
      const b = v.behavior.body;
      if (bodyOk(b)) { // part déjà lancée (sinon tout le monde démarre à l'arrêt)
        const s = cruise * 0.6;
        b.setLinvel({ x: -Math.sin(lane.yaw) * s, y: 0, z: -Math.cos(lane.yaw) * s }, true);
      }
      return true;
    }
    return false;
  };

  /** Fait apparaître une voiture garée verrouillée sur la place `s` (livrée taxi pour ~30 % des berlines). */
  const spawnParkedAt = (s: ParkSlot, h: number): boolean => {
    const r = (h % 100) / 100;
    const taxi = r < 0.28;
    const type = taxi ? 'berline' : r < 0.65 ? 'citadine' : r < 0.85 ? 'berline' : 'camionnette';
    let v = sim.acquireVehicle(type, s.x, s.z, s.yaw, { locked: true, y: 0.7, livery: taxi ? 1 : 0 });
    if (!v) v = sim.acquireVehicle(type === 'citadine' ? 'berline' : 'citadine', s.x, s.z, s.yaw, { locked: true, y: 0.7 });
    if (!v) return false;
    parked.push({ ref: sim.refOf(v), slot: s.id, x: s.x, z: s.z });
    return true;
  };

  /**
   * Garantie de stationnement : pour le premier joueur qui a moins de PARKED_GUARANTEE voitures garées à moins de PARKED_NEAR m,
   * fait apparaître une garée sur la meilleure place libre (d'abord les POI parking, hors champ de préférence, ni trop près d'un joueur).
   * Déterministe : le choix ne dépend que de la position des joueurs et des places (une seule voiture par appel).
   */
  const ensureParked = (players: [number, number][]) => {
    for (const [px, pz] of players) {
      let near = 0;
      for (const p of parked) { const dx = p.x - px, dz = p.z - pz; if (dx * dx + dz * dz < PARKED_NEAR * PARKED_NEAR) near++; }
      if (near >= PARKED_GUARANTEE) continue;
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d > PARKED_NEAR - 2 || d < PARKED_TOO_CLOSE) continue;
        if (nearestPlayerDist(s.x, s.z, players) < PARKED_TOO_CLOSE) continue;
        let taken = false;
        for (const p of parked) if (p.slot === s.id) { taken = true; break; }
        if (taken) continue;
        const score = (s.poi ? 0 : 1000) + (d >= PARKED_VISIBLE ? 0 : 500) + slotHash[i] % 400;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      // les 3 meilleures places pourraient être occupées par un civil de passage : on essaie la meilleure puis la suivante par score
      if (best < 0) continue;
      if (parked.length >= PARKED_MAX && !dropFarthestParked(players)) return;
      if (freeCivilSlots() < 1) return;
      const s = slots[best];
      if (!clearAround(s.x, s.z, 6)) continue; // un civil passe là : au prochain essai (la place reste la meilleure)
      if (spawnParkedAt(s, slotHash[best])) return; // une seule par appel
    }
  };

  /** Libère la voiture garée la plus éloignée de tous les joueurs (> PARKED_NEAR) pour faire de la place. */
  const dropFarthestParked = (players: [number, number][]): boolean => {
    let bi = -1, bd = PARKED_NEAR;
    for (let i = 0; i < parked.length; i++) {
      const d = nearestPlayerDist(parked[i].x, parked[i].z, players);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi < 0) return false;
    const v = sim.resolveRef(parked[bi].ref);
    if (v && !v.driver) sim.releaseVehicle(v);
    parked.splice(bi, 1);
    return true;
  };

  const forgetDriven = (v: SimVehicle) => { v.ai = null; }; // un joueur au volant : plus de pilote automatique résiduel

  /** Revalidation, disparition (> 140 m de tous les joueurs, sans conducteur), sortie du trafic (volé). Toutes les 0,5 s. */
  const cull = (players: [number, number][]) => {
    const keepC: Civil[] = [];
    for (const c of civils) {
      const v = sim.resolveRef(c.ref);
      if (!v) continue; // détruit ou recyclé ailleurs
      if (v.driver) { forgetDriven(v); continue; } // volé : sort du trafic
      const d = nearestPlayerDist(c.x, c.z, players);
      if (d > DESPAWN || c.still > 25 && d > 30 || c.still > 10 && d > 60) { sim.releaseVehicle(v); continue; }
      keepC.push(c);
    }
    civils = keepC;
    const keepP: Parked[] = [];
    for (const p of parked) {
      const v = sim.resolveRef(p.ref);
      if (!v) continue;
      if (v.driver) continue; // volée : sort du trafic
      if (nearestPlayerDist(p.x, p.z, players) > DESPAWN) { sim.releaseVehicle(v); continue; }
      keepP.push(p);
    }
    parked = keepP;
  };

  // ---------- IA ----------
  const buildObs = () => {
    kinds.clear();
    for (const c of civils) kinds.set(c.ref.id, 1);
    for (const p of parked) kinds.set(p.ref.id, 2);
    obsN = 0;
    for (const v0 of sim.vehicles) {
      if (v0.pooled || v0.dead) continue;
      const v = read(v0);
      if (!v) continue;
      const o = obs[obsN] ?? (obs[obsN] = newObs());
      obsN++;
      o.id = rd.id; o.x = rd.x; o.z = rd.z; o.fx = rd.fx; o.fz = rd.fz; o.vx = rd.vx; o.vz = rd.vz; o.sp = rd.sp;
      o.kind = kinds.get(v.id) ?? 0;
    }
  };

  const pedsOf = (): readonly PedState[] => {
    const s = ctx.get('peds') as unknown as { peds?: readonly PedState[] } | undefined;
    return s && Array.isArray(s.peds) ? s.peds : [];
  };

  const driveCivil = (c: Civil, v: SimVehicle, peds: readonly PedState[], time: number, doRay: boolean) => {
    if (!read(v) || !v.ai) return;
    const x = rd.x, z = rd.z, fx = rd.fx, fz = rd.fz, sp = rd.sp;
    const rx = -fz, rz = fx; // droite
    c.x = x; c.z = z; c.age += AI_DT;

    // ---- Choc ou dégâts : on panique ----
    if (c.age > 2.5 && (c.lastSp - sp > 5.5 || v.hp < c.lastHp - 0.5 || v.lastHitBy)) {
      if (time >= c.fleeUntil) c.honk = true;
      c.fleeUntil = time + 9000;
      v.lastHitBy = null;
    }
    c.lastSp = sp; c.lastHp = v.hp;
    const flee = time < c.fleeUntil;

    // ---- Immobilité (coincé) ----
    c.still = Math.abs(sp) < 0.8 ? c.still + AI_DT : Math.max(0, c.still - AI_DT * 2);

    // ---- Itinéraire ----
    if (c.route.length - c.wpi < 3) extendRoute(c);
    if (c.wpi > 8) { c.route.splice(0, 6); c.wpi -= 6; c.wps = null; }
    const wps = c.wps ?? (c.wps = laneWaypoints(c.route));
    while (c.wpi < wps.length - 1) {
      const turn = turnKind(c.route[c.wpi], c.route[c.wpi + 1]) !== 'straight';
      const reach = turn ? 3.5 : 2.5 + 0.1 * Math.max(0, sp);
      if (Math.hypot(wps[c.wpi].x - x, wps[c.wpi].z - z) < reach) c.wpi++; else break;
    }
    const lane = c.route[c.wpi], wp = wps[c.wpi];
    const turnAhead = c.wpi + 1 < c.route.length && turnKind(lane, c.route[c.wpi + 1]) !== 'straight';
    let ux = lane.x1 - lane.x0, uz = lane.z1 - lane.z0;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    const along = (x - lane.x0) * ux + (z - lane.z0) * uz;
    const remaining = (wp.x - x) * ux + (wp.z - z) * uz;
    const la = 6 + Math.max(0, sp) * 0.7;
    let tx: number, tz: number;
    if (remaining > la) { tx = lane.x0 + ux * (along + la); tz = lane.z0 + uz * (along + la); } else { tx = wp.x; tz = wp.z; }

    // ---- Vitesse de croisière, virages, fuite ----
    let maxSpeed = flee ? Math.min(c.cruise * 1.5, 21) : c.cruise;
    const dw = Math.hypot(wp.x - x, wp.z - z);
    if (turnAhead && dw < 40) maxSpeed = Math.min(maxSpeed, (flee ? 7 : 5) + (flee ? 0.7 : 0.55) * dw);

    // ---- Obstacles : voitures devant (liste + rayon), piétons, intersections ----
    const Lmax = clamp(10 + Math.max(0, sp) * 1.6, 12, 38);
    let gap = Infinity, leadSp = 0, shiftWant = 0;
    const consider = (g: number, ls: number) => { if (g < gap) { gap = Math.max(0, g); leadSp = Math.max(0, ls); } };
    for (let i = 0; i < obsN; i++) {
      const q = obs[i];
      if (q.id === v.id) continue;
      const dx = q.x - x, dz = q.z - z;
      if (dx * dx + dz * dz > 1700) continue;
      const ahead = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      const latLane = lat - c.shift; // écart à l'axe de MA voie (sans mon décalage)
      if (q.kind === 2 && ahead > -5 && ahead < Lmax + 6 && latLane >= -0.6 && latLane < 3.4) { // voiture garée au bord de ma voie : on se décale si besoin
        const need = clamp(0.5 - (latLane - 2.1), 0, 1.7); // jeu latéral voulu 0,5 m entre les carrosseries (demi-largeurs ~1,05 chacune)
        shiftWant = Math.max(shiftWant, need);
        if (ahead > 0 && c.shift < need - 0.35) consider(ahead - 2 * HALF_LEN + 1, 0); // pas encore assez décalé : on ralentit
        continue;
      }
      if (ahead <= 0 || ahead > Lmax + 3 || Math.abs(lat) > 2.0) continue;
      consider(ahead - 2 * HALF_LEN, q.vx * fx + q.vz * fz);
    }
    if (doRay) {
      c.rayGap = Infinity;
      org.set(x + fx * (HALF_LEN + 0.1), 0.7, z + fz * (HALF_LEN + 0.1));
      const hit = sim.raycastProbe(org.x, org.y, org.z, fx, 0, fz, Lmax, v.behavior.body);
      if (hit) {
        if (hit.kind === 'player' || (hit.kind === 'prop' && hit.dist < 12)) c.rayGap = hit.dist;
        else if (hit.kind === 'vehicle' && hit.vehicle && kinds.get(hit.vehicle.id) !== 2) c.rayGap = hit.dist;
      }
    } else if (c.rayGap < Infinity) c.rayGap = Math.max(0, c.rayGap - Math.max(0, sp) * AI_DT); // résultat précédent, rapproché
    if (c.rayGap < Infinity) consider(c.rayGap, 0);
    for (const p of peds) {
      if (p.st === PED_ST.KNOCKED || p.gone) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx > 18 || dx < -18 || dz > 18 || dz < -18) continue;
      const ahead = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (ahead > 0.5 && ahead < 16 && Math.abs(lat) < 2.0) consider(ahead - 2.6, 0);
    }
    // Intersection : on laisse passer les véhicules qui la traversent (sauf en fuite)
    if (!flee) {
      const node = city.nodes[lane.to];
      const nx = node.x - x, nz = node.z - z, dn = Math.hypot(nx, nz);
      if (nx * fx + nz * fz > 0 && dn < 24 && dn > 7) {
        for (let i = 0; i < obsN; i++) {
          const q = obs[i];
          if (q.id === v.id || q.kind === 2) continue;
          const ox = q.x - node.x, oz = q.z - node.z, od = Math.hypot(ox, oz);
          if (od > 20 || Math.abs(q.fx * fx + q.fz * fz) > 0.7) continue; // pas perpendiculaire
          const inBox = Math.abs(ox) < 5.5 && Math.abs(oz) < 5.5;
          const toward = -ox * q.vx - oz * q.vz > 0 && Math.hypot(q.vx, q.vz) > 1.5;
          if (inBox || (toward && od < 17 && (od < dn - 2 || (Math.abs(od - dn) <= 2 && q.id < v.id)))) { consider(dn - 7.5, 0); break; }
        }
      }
    }
    c.shift += clamp(shiftWant - c.shift, -AI_DT * 2.5, AI_DT * 2.5);
    tx += uz * c.shift; tz -= ux * c.shift; // gauche = (uz, -ux)

    let brakeFor = Infinity;
    if (gap < Infinity) {
      maxSpeed = Math.min(maxSpeed, leadSp + Math.sqrt(2 * 7 * Math.max(0, gap - 3)));
      brakeFor = gap + 4;
    }

    // ---- Commandes ----
    const out = steerTo({ x, z, yaw: Math.atan2(-fx, -fz), speed: sp }, { x: tx, z: tz }, {
      maxSpeed, arriveRadius: 0.5, brakeFor, dt: AI_DT, mem: c.mem, decel: 9,
    });
    let f = Number.isFinite(out.f) ? out.f! : 0;
    const s = Number.isFinite(out.s) ? out.s! : 0;
    if (f > 0) f = Math.min(f, flee ? 1 : 0.55); // accélération douce
    if (gap < 6 && Math.abs(sp) < 1 && !(c.mem.rev > 0)) f = Math.min(f, 0); // à l'arrêt derrière un obstacle : pas de reculade
    if (maxSpeed < 0.5 && Math.abs(sp) < 1 && !(c.mem.rev > 0)) f = 0;
    // Coincé plus de 4 s : marche arrière (le recyclage hors champ est dans cull)
    if (c.still > 4 && c.mem.rev <= 0 && c.still < 4 + AI_DT * 1.5) c.mem.rev = 1.5;
    const inp = v.ai.input;
    inp.f = f; inp.s = clamp(s, -1, 1); inp.jump = 0;
    inp.hn = c.honk ? 1 : 0;
    c.honk = false;
  };

  const preStep = () => {
    tick++;
    const players = (tick % CULL_EVERY === 0 || tick % SPAWN_CIVIL_AT === 3 || tick % SPAWN_PARKED_AT === 7) ? playerPositions() : null;
    if (players) {
      if (tick % CULL_EVERY === 0) cull(players);
      if (players.length) {
        // Apparition : une voiture par essai, jamais plusieurs dans le même tick (pas de pic) ; le pool garde POOL_RESERVE places libres
        if (tick % SPAWN_CIVIL_AT === 3 && civils.length < movingTarget(players.length) && freeCivilSlots() > POOL_RESERVE) trySpawnCivil(players);
        if (tick % SPAWN_PARKED_AT === 7) ensureParked(players);
      }
    }
    if (!civils.length) return;
    const phase = tick % AI_EVERY;
    if (phase === 0) buildObs();
    const peds = pedsOf();
    const time = sim.time;
    for (const c of civils) {
      if (c.slice !== phase) continue;
      const v = sim.resolveRef(c.ref);
      if (v && !v.driver) driveCivil(c, v, peds, time, (c.n++ & 1) === 0);
    }
  };

  // ---------- Réactions aux événements ----------
  const scare = (x: number, z: number, r: number, secs: number) => {
    const t = sim.time + secs * 1000;
    for (const c of civils) {
      if (Math.hypot(c.x - x, c.z - z) <= r && c.fleeUntil < t) { if (sim.time >= c.fleeUntil) c.honk = true; c.fleeUntil = t; }
    }
  };
  bus.on('crime', (e) => {
    if (e.kind === 'tir') scare(e.x, e.z, 35, 8);
    else if (e.kind === 'explosion') scare(e.x, e.z, 60, 10);
    else if (e.kind === 'agression_flic' || e.kind === 'pieton_renverse') scare(e.x, e.z, 25, 7);
  });
  bus.on('pedKnocked', (e) => scare(e.x, e.z, 22, 6));
  bus.on('vehicleDestroyed', (e) => {
    if (read(e.v)) scare(rd.x, rd.z, 40, 9);
  });

  return {
    id: 'traffic',
    preStep,
    get counts() { return { moving: civils.length, parked: parked.length }; },
    unlock(v) {
      const p = parked.find((q) => q.ref.id === v.id && q.ref.gen === v.gen);
      if (!p || !sim.resolveRef(p.ref)) return false;
      v.locked = false;
      return true;
    },
    isParked: (v) => parked.some((q) => q.ref.id === v.id && q.ref.gen === v.gen),
    isCivil: (v) => civils.some((q) => q.ref.id === v.id && q.ref.gen === v.gen),
    parkedNear(x, z, r) {
      let n = 0;
      for (const p of parked) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < r * r) n++; }
      return n;
    },
    serialize() { return { v: 1, seed: rng }; },
    restore(data) {
      const d = data as { seed?: unknown } | null;
      const s = d && typeof d === 'object' && typeof d.seed === 'number' && Number.isFinite(d.seed) ? Math.floor(d.seed) : NaN;
      if (s >= 1 && s < 2147483647) rng = s;
    },
  };
};
