// PROPRIÉTAIRE : game-camera-driving
// Trafic civil : jusqu'à 24 voitures du pool (citadine / berline / camionnette) pilotées par v.ai.input (steerTo + voies de shared/city/lanes.ts)
// et des voitures GARÉES (POI `parking`, verrouillées, immobiles tant qu'un mini-jeu ne les a pas déverrouillées via `unlock`).
// Règle Rapier : aucune référence de corps conservée entre deux ticks. On garde des VRef (+ des nombres) et on revalide
// (sim.refOf/resolveRef + bodyOk) avant chaque lecture. serialize() ne lit pas Rapier (trafic éphémère : seulement la graine).
import * as THREE from 'three';
import type { SimVehicle, VRef } from '../../shared/api';
import { newDriveMem, steerTo, type DriveMem } from '../../shared/ai/drive';
import { laneWaypoints, nearestLane, nextLane, routeLanes, turnKind, type Lane } from '../../shared/city/lanes';
import { bodyOk } from '../../shared/guard';
import type { GameSystem, SystemFactory } from '../../shared/game';
import { PED_ST, type PedState } from '../../shared/peds';

/** Plafond de voitures civiles tenues par le système (en mouvement + garées). */
export const TRAFFIC_MAX = 24;
/** Dont au plus autant de voitures garées. */
export const PARKED_MAX = 6;
const SPAWN_MIN = 70, SPAWN_MAX = 110, DESPAWN = 140;
const PARKED_SPAWN_MIN = 60, PARKED_SPAWN_MAX = 118;
const AI_EVERY = 3; // pas physiques entre deux décisions (60 Hz / 3 = 20 Hz)
const AI_DT = AI_EVERY / 60;
const MANAGE_EVERY = 30; // 0,5 s
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
  /** Nombres de voitures tenues (tests, debug). */
  readonly counts: { moving: number; parked: number };
}

interface Civil {
  ref: VRef;
  mem: DriveMem;
  route: Lane[]; // voies à suivre ; waypoint i = bout (ou coin) de route[i]
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
}
interface Parked { ref: VRef; poi: string; x: number; z: number }

/** État d'un véhicule vivant lu une fois par cycle d'IA. kind : 0 autre (joueur, police…), 1 civil, 2 garé. */
interface Obs { id: number; x: number; z: number; fx: number; fz: number; vx: number; vz: number; sp: number; kind: 0 | 1 | 2 }

const TYPES: Array<{ type: string; w: number; lo: number; hi: number }> = [
  { type: 'citadine', w: 0.42, lo: 11.5, hi: 15.5 },
  { type: 'berline', w: 0.38, lo: 12, hi: 16 },
  { type: 'camionnette', w: 0.2, lo: 10, hi: 13 },
];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const createTraffic: SystemFactory = (ctx): TrafficSystem => {
  const { sim, bus, city } = ctx;
  let rng = 20260611;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  let tick = 0;
  let civils: Civil[] = [];
  let parked: Parked[] = [];
  const parkingPois = city.poisOf('parking');
  const org = new THREE.Vector3(), dir = new THREE.Vector3();

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
    let d = Infinity;
    for (const [px, pz] of pl) d = Math.min(d, Math.hypot(px - x, pz - z));
    return d;
  };

  /** Lit un véhicule (revalidé) : pose et vitesse, ou null. */
  const read = (v0: SimVehicle): { v: SimVehicle; x: number; z: number; fx: number; fz: number; vx: number; vz: number; sp: number } | null => {
    const v = sim.resolveRef(sim.refOf(v0));
    if (!v || !bodyOk(v.behavior.body)) return null;
    const b = v.behavior.body;
    const t = b.translation(), q = b.rotation(), lv = b.linvel();
    const h = 2 * Math.atan2(q.y, q.w);
    const fx = -Math.sin(h), fz = -Math.cos(h);
    if (!Number.isFinite(t.x + t.z + h + lv.x + lv.z)) return null;
    return { v, x: t.x, z: t.z, fx, fz, vx: lv.x, vz: lv.z, sp: lv.x * fx + lv.z * fz };
  };

  // ---------- Itinéraires ----------
  const extendRoute = (c: Civil) => {
    const last = c.route[c.route.length - 1];
    for (let k = 0; k < 6; k++) {
      const dest = city.nodes[Math.floor(rand() * city.nodes.length)];
      if (!dest || dest.id === last.to) continue;
      if (Math.hypot(dest.x - city.nodes[last.to].x, dest.z - city.nodes[last.to].z) < 100) continue;
      const r = routeLanes(city, last.to, dest.id, last);
      if (r && r.length) { c.route.push(...r); return; }
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

  const clearAround = (x: number, z: number, r: number) => {
    for (const v of sim.vehicles) {
      if (v.pooled || v.dead) continue;
      const o = read(v);
      if (o && Math.hypot(o.x - x, o.z - z) < r) return false;
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
        ref: sim.refOf(v), mem: newDriveMem(), route: [lane], wpi: 0, cruise, fleeUntil: 0, honk: false, still: 0,
        x, z, lastSp: 0, lastHp: v.hp, age: 0, shift: 0,
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

  const trySpawnParked = (players: [number, number][]): boolean => {
    if (!players.length || !parkingPois.length) return false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const poi = parkingPois[Math.floor(rand() * parkingPois.length)];
      if (parked.some((p) => p.poi === poi.id)) continue;
      const d = nearestPlayerDist(poi.x, poi.z, players);
      if (d < PARKED_SPAWN_MIN || d > PARKED_SPAWN_MAX) continue;
      if (!clearAround(poi.x, poi.z, 6)) continue;
      const r = rand();
      const taxi = r < 0.3; // livrée taxi : berline livrée 1
      const type = taxi ? 'berline' : r < 0.7 ? 'citadine' : r < 0.85 ? 'berline' : 'camionnette';
      let v = sim.acquireVehicle(type, poi.x, poi.z, poi.yaw + (rand() < 0.5 ? 0 : Math.PI), { locked: true, y: 0.7, livery: taxi && type === 'berline' ? 1 : 0 });
      if (!v) v = sim.acquireVehicle(type === 'citadine' ? 'berline' : 'citadine', poi.x, poi.z, poi.yaw, { locked: true, y: 0.7 });
      if (!v) return false;
      parked.push({ ref: sim.refOf(v), poi: poi.id, x: poi.x, z: poi.z });
      return true;
    }
    return false;
  };

  const forgetDriven = (v: SimVehicle) => { v.ai = null; }; // un joueur au volant : plus de pilote automatique résiduel

  const manage = () => {
    const players = playerPositions();
    // Revalidation, disparition (> 140 m de tous les joueurs, sans conducteur), sortie du trafic (volé)
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

    if (!players.length) return;
    const room = TRAFFIC_MAX - civils.length - parked.length;
    const target = Math.min(TRAFFIC_MAX - PARKED_MAX, 12 + 5 * players.length);
    let spawned = 0;
    for (let n = 0; n < 3 && civils.length < target && spawned < room; n++) if (trySpawnCivil(players)) spawned++; else break;
    if (parked.length < PARKED_MAX && civils.length + parked.length < TRAFFIC_MAX && tick % 90 === 0) trySpawnParked(players);
  };

  // ---------- IA ----------
  const buildObs = (): Obs[] => {
    const out: Obs[] = [];
    const civilIds = new Set<number>(), parkedIds = new Set<number>();
    for (const c of civils) civilIds.add(c.ref.id);
    for (const p of parked) parkedIds.add(p.ref.id);
    for (const v0 of sim.vehicles) {
      if (v0.pooled || v0.dead) continue;
      const o = read(v0);
      if (!o) continue;
      out.push({ id: o.v.id, x: o.x, z: o.z, fx: o.fx, fz: o.fz, vx: o.vx, vz: o.vz, sp: o.sp, kind: parkedIds.has(o.v.id) ? 2 : civilIds.has(o.v.id) ? 1 : 0 });
    }
    return out;
  };

  const pedsOf = (): readonly PedState[] => {
    const s = ctx.get('peds') as unknown as { peds?: readonly PedState[] } | undefined;
    return s && Array.isArray(s.peds) ? s.peds : [];
  };

  const driveCivil = (c: Civil, v: SimVehicle, obs: Obs[], peds: readonly PedState[], time: number) => {
    const o = read(v);
    if (!o || !v.ai) return;
    const { x, z, fx, fz, sp } = o;
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
    if (c.wpi > 8) { c.route.splice(0, 6); c.wpi -= 6; }
    const wps = laneWaypoints(c.route);
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

    // ---- Obstacles : voitures devant (liste + raycast), piétons, intersections ----
    const Lmax = clamp(10 + Math.max(0, sp) * 1.6, 12, 38);
    let gap = Infinity, leadSp = 0, shiftWant = 0;
    const consider = (g: number, ls: number) => { if (g < gap) { gap = Math.max(0, g); leadSp = Math.max(0, ls); } };
    for (const q of obs) {
      if (q.id === v.id) continue;
      const dx = q.x - x, dz = q.z - z;
      if (dx * dx + dz * dz > 1700) continue;
      const ahead = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      const latLane = lat - c.shift; // écart à l'axe de MA voie (sans mon décalage)
      if (q.kind === 2 && ahead > -5 && ahead < Lmax + 6 && latLane >= -0.4 && latLane < 2.6) { // voiture garée sur le bord de ma voie : on se décale
        shiftWant = Math.max(shiftWant, clamp(3.0 - Math.abs(latLane), 0, 1.7));
        const need = clamp(3.0 - Math.abs(latLane), 0, 1.7);
        if (ahead > 0 && c.shift < need - 0.35) consider(ahead - 2 * HALF_LEN + 1, 0); // pas encore assez décalé : on ralentit
        continue;
      }
      if (ahead <= 0 || ahead > Lmax + 3 || Math.abs(lat) > 2.0) continue;
      consider(ahead - 2 * HALF_LEN, q.vx * fx + q.vz * fz);
    }
    org.set(x + fx * (HALF_LEN + 0.1), 0.7, z + fz * (HALF_LEN + 0.1));
    dir.set(fx, 0, fz);
    const hit = sim.raycast(org, dir, Lmax, v.behavior.body);
    if (hit) {
      if (hit.kind === 'player' || (hit.kind === 'prop' && hit.dist < 12)) consider(hit.dist, 0);
      else if (hit.kind === 'vehicle' && hit.vehicle && !parked.some((p) => p.ref.id === hit.vehicle!.id)) consider(hit.dist, 0);
    }
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
        for (const q of obs) {
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
    // Coincé plus de 4 s : marche arrière (le recyclage hors champ est dans manage)
    if (c.still > 4 && c.mem.rev <= 0 && c.still < 4 + AI_DT * 1.5) c.mem.rev = 1.5;
    const inp = v.ai.input;
    inp.f = f; inp.s = clamp(s, -1, 1); inp.jump = 0;
    inp.hn = c.honk ? 1 : 0;
    c.honk = false;
  };

  const preStep = () => {
    tick++;
    if (tick % MANAGE_EVERY === 0) manage();
    if (tick % AI_EVERY !== 0 || !civils.length) return;
    const obs = buildObs();
    const peds = pedsOf();
    const time = sim.time;
    for (const c of civils) {
      const v = sim.resolveRef(c.ref);
      if (v && !v.driver) driveCivil(c, v, obs, peds, time);
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
    const r = read(e.v);
    if (r) scare(r.x, r.z, 40, 9);
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
    serialize() { return { v: 1, seed: rng }; },
    restore(data) {
      const d = data as { seed?: unknown } | null;
      const s = d && typeof d === 'object' && typeof d.seed === 'number' && Number.isFinite(d.seed) ? Math.floor(d.seed) : NaN;
      if (s >= 1 && s < 2147483647) rng = s;
    },
  };
};
