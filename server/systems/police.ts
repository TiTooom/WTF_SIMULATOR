// PROPRIÉTAIRE : game-missions
// Police : étoiles par joueur (shared/wanted.ts), voitures de police du pool qui poursuivent et percutent, arrestation, mort.
// Règles : aucune référence de corps conservée entre deux ticks (VRef + sim.resolveRef + bodyOk) ; serialize() sans lire Rapier ;
// violence « Chinatown Wars » (explosions, voitures qui volent) mais jamais de sang.
//  - Crimes : écoute `crime` (tir filtré par témoins), `pedKnocked` (flic renversé = agression), `vehicleDestroyed`, `enteredVehicle`,
//    `cameraDestroyed`, `playerDied`, `debug` (`/debug stars <n>`).
//  - Détruire une voiture de police : `copDestroyed` (une étoile en moins toutes les COPS_PER_STAR_DROP destructions).
//  - Arrestation : à pied, avec ≥ 1 étoile, un flic (piéton `flic` du système peds, ou voiture de police près de soi) à moins de
//    BUST_R pendant BUST_S secondes -> `playerBusted` (l'économie confisque sac + part de l'argent), retour au commissariat, event `arrete`.
//  - Mort : event `mort`, puis réapparition à l'hôpital une fois que la simulation a relevé le joueur.
import type { SimPlayer, VRef } from '../../shared/api';
import { bodyOk } from '../../shared/guard';
import type { GameSystem, SystemFactory } from '../../shared/game';
import type { CrimeKind } from '../../shared/ids';
import type { Mark, PrivateState } from '../../shared/protocol';
import { newDriveMem, steerTo, type DriveMem } from '../../shared/ai/drive';
import { nearestLane } from '../../shared/city/lanes';
import { addCrime, copDestroyed, copSpeed, copsWanted, HEAT_MAX, heatOfStars, newWanted, starProgress, starsOf, tickWanted, type WantedState } from '../../shared/wanted';
import type { PedsSystem } from './peds';

export const POLICE_POOL_MAX = 10; // taille du pool de voitures de police (shared/constants VEHICLE_POOL.police)
export const BUST_R = 2; // m : distance d'un flic à pied
export const BUST_CAR_R = 3.5; // m : distance d'une voiture de police (le policier en descend)
export const BUST_S = 2; // s de contact continu
const AI_EVERY = 3; // ticks entre deux décisions de conduite (20 Hz)
const AI_DT = AI_EVERY / 60;
const SPAWN_EVERY = 30; // ticks (0,5 s) : au plus une voiture de police créée par passage
const SPAWN_MIN = 75, SPAWN_MAX = 130; // m : toujours hors du champ de vue
const FAR_RELEASE = 230; // m : une voiture trop loin de tous les joueurs est recyclée
const MARK_R = 130;
const MAX_SAVED = 64;
const DEBOUNCE_MS: Partial<Record<CrimeKind, number>> = { vol_vehicule: 1500, deal_vu: 1500, camera_detruite: 1500, explosion: 1500, agression_flic: 3000 };

export interface PoliceSystem extends GameSystem {
  /** Étoiles (0..5) d'un joueur (0 si inconnu). */
  starsOf(playerId: string): number;
  /** Chaleur brute d'un joueur. */
  heatOf(playerId: string): number;
  /** Nombre de voitures de police actuellement pilotées par ce système. */
  readonly carCount: number;
  /** Fixe l'indice d'un joueur (0..5 ; missions, activités). Sans effet si le joueur est inconnu. */
  setStars(playerId: string, stars: number): void;
}

interface PState { w: WantedState; bust: number; ws: number; last: Map<CrimeKind, number>; seenBy: boolean }
interface Car { ref: VRef; mem: DriveMem; lastHp: number; siren: boolean; x: number; z: number; speed: number }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const BAD = new Set(['__proto__', 'constructor', 'prototype']);

export const createPolice: SystemFactory = (ctx): PoliceSystem => {
  const { sim, bus, city } = ctx;
  const states = new Map<string, PState>();
  const saved = new Map<string, { heat: number; kills: number }>(); // état restauré, appliqué à l'arrivée du joueur
  const cars = new Map<number, Car>(); // id de véhicule -> voiture pilotée par la police (VRef revalidée à chaque lecture)
  const hospitalQueue = new Set<string>(); // morts en attente de réapparition (transférés à l'hôpital)
  let tick = 0;
  let idleTicks = 0; // durée sans aucune recherche (recyclage des voitures)
  let rng = 987654;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  const commissariat = city.poisOf('commissariat')[0];
  const hopital = city.poisOf('hopital')[0];
  const pedsSys = () => ctx.get<PedsSystem>('peds');

  const ensure = (p: SimPlayer): PState => {
    let s = states.get(p.id);
    if (!s) {
      s = { w: newWanted(), bust: 0, ws: -1, last: new Map(), seenBy: false };
      const sv = saved.get(p.id);
      if (sv) { s.w = { heat: sv.heat, kills: sv.kills, calm: 0 }; saved.delete(p.id); }
      states.set(p.id, s);
    }
    return s;
  };
  const publish = (p: SimPlayer, s: PState) => {
    const n = starsOf(s.w.heat);
    if (n !== s.ws) { s.ws = n; sim.setPlayerSnap(p.id, { ws: n }); }
  };
  const alive = (p: SimPlayer) => p.hp > 0 && sim.players.get(p.id) === p;

  // ---------- Témoins ----------
  const witnessed = (x: number, z: number): boolean => {
    const peds = pedsSys()?.peds;
    if (peds) {
      for (const q of peds) {
        if (q.gone) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d <= (q.kind === 'flic' ? 60 : 25)) return true;
      }
    }
    for (const c of cars.values()) if (Math.hypot(c.x - x, c.z - z) <= 60) return true;
    return false;
  };

  // ---------- Crimes ----------
  const commit = (p: SimPlayer, kind: CrimeKind) => {
    if (!alive(p)) return;
    const s = ensure(p);
    const gap = DEBOUNCE_MS[kind];
    if (gap) { // plusieurs systèmes peuvent signaler le même crime : un seul compte
      const t = s.last.get(kind) ?? -1e9;
      if (sim.time - t < gap) return;
      s.last.set(kind, sim.time);
    }
    s.w = addCrime(s.w, kind);
    publish(p, s);
  };

  bus.on('crime', (e) => {
    if (e.kind === 'flic_detruit') return; // chaleur nulle : l'effet (baisse) est traité dans vehicleDestroyed
    if (e.kind === 'tir' && !witnessed(e.x, e.z)) return; // un tir dans le vide ne se remarque pas
    commit(e.by, e.kind);
  });

  bus.on('pedKnocked', (e) => {
    if (!e.by) return;
    const q = pedsSys()?.peds.find((x) => x.id === e.pedId);
    if (q && q.kind === 'flic') commit(e.by, 'agression_flic');
  });

  bus.on('cameraDestroyed', (e) => { if (e.by) commit(e.by, 'camera_detruite'); });

  bus.on('enteredVehicle', ({ p, v }) => {
    const mine = cars.get(v.id);
    if (mine) { cars.delete(v.id); v.ai = null; } // volée : elle n'est plus pilotée par la police
    const kept = (v as { keep?: boolean }).keep === true;
    if (!kept && (mine || v.def.type === 'police' || v.ai || v.locked)) commit(p, 'vol_vehicule');
  });

  bus.on('vehicleDestroyed', ({ v, by }) => {
    const culprit = by ?? (v.lastHitBy ? sim.players.get(v.lastHitBy) ?? null : null);
    cars.delete(v.id);
    if (v.def.type === 'police') {
      let target = culprit;
      if (!target) { // aucune attribution : le joueur recherché le plus proche (à moins de 40 m) est crédité
        const x = v.home.x, z = v.home.z;
        let best = 40;
        for (const p of sim.players.values()) {
          const s = states.get(p.id);
          if (!s || starsOf(s.w.heat) === 0) continue;
          const q = sim.playerPos(p);
          const d = Math.hypot(q[0] - x, q[2] - z);
          if (d < best) { best = d; target = p; }
        }
      }
      if (!target || !alive(target)) return;
      const s = ensure(target);
      const before = starsOf(s.w.heat);
      s.w = copDestroyed(s.w);
      publish(target, s);
      const q = sim.playerPos(target);
      bus.emit('crime', { kind: 'flic_detruit', by: target, x: q[0], z: q[2] });
      if (starsOf(s.w.heat) < before) ctx.sendTo(target.id, { k: 'toast', text: 'Une voiture de police en moins : on vous cherche moins.' });
      return;
    }
    // Voiture civile (trafic) détruite par un joueur : explosion remarquée. Sa propre voiture ne compte pas.
    if (culprit && v.ai) {
      const t = sim.playerPos(culprit);
      bus.emit('crime', { kind: 'explosion', by: culprit, x: t[0], z: t[2] });
    }
  });

  bus.on('playerDied', ({ p }) => {
    const s = states.get(p.id);
    if (s) { s.w = newWanted(); s.bust = 0; publish(p, s); }
    hospitalQueue.add(p.id);
    ctx.sendTo(p.id, { k: 'mort' });
  });

  bus.on('debug', ({ p, what, arg }) => {
    if (what !== 'stars') return;
    const n = Number.parseInt(arg, 10);
    if (!Number.isFinite(n)) return;
    const s = ensure(p);
    const stars = Math.max(0, Math.min(5, n));
    s.w = { heat: heatOfStars(stars), kills: 0, calm: 0 };
    publish(p, s);
  });

  // ---------- Arrestation ----------
  const bust = (p: SimPlayer, s: PState) => {
    s.w = newWanted();
    s.bust = 0;
    publish(p, s);
    bus.emit('playerBusted', { p }); // l'économie confisque le sac et une part de l'argent (BUST_MONEY_LOSS)
    if (commissariat && bodyOk(p.body)) {
      sim.teleportPlayer(p, commissariat.x, 1.3, commissariat.z);
      p.invulnUntil = sim.time + 3000;
      p.hp = Math.max(p.hp, 50);
    }
    ctx.sendTo(p.id, { k: 'arrete' });
  };

  // ---------- Conduite et population des voitures ----------
  const liveCar = (id: number, c: Car) => {
    const v = sim.resolveRef(c.ref);
    if (!v || v.driver) { cars.delete(id); return null; } // recyclée, détruite ou volée
    return v;
  };

  const refreshCars = () => {
    for (const [id, c] of [...cars]) {
      const v = liveCar(id, c);
      if (!v) continue;
      const b = v.behavior.body;
      if (!bodyOk(b)) { cars.delete(id); continue; }
      const t = b.translation();
      c.x = t.x; c.z = t.z;
      c.speed = sim.forwardSpeed(b);
      if (v.hp < c.lastHp - 4 && v.lastHitBy) { // un joueur abîme une voiture de police
        const by = sim.players.get(v.lastHitBy);
        if (by) commit(by, 'agression_flic');
      }
      c.lastHp = v.hp;
    }
  };

  const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));

  const driveCars = (wantedPlayers: { p: SimPlayer; s: PState; pos: [number, number, number] }[]) => {
    for (const [id, c] of [...cars]) {
      const v = liveCar(id, c);
      if (!v || !v.ai) continue;
      let tgt: (typeof wantedPlayers)[number] | null = null;
      let bd = Infinity;
      for (const w of wantedPlayers) {
        const d = Math.hypot(w.pos[0] - c.x, w.pos[2] - c.z);
        if (d < bd) { bd = d; tgt = w; }
      }
      const inp = v.ai.input;
      if (!tgt) { inp.f = 0; inp.s = 0; inp.jump = 0; inp.hn = 0; continue; }
      const b = v.behavior.body;
      if (!bodyOk(b)) { cars.delete(id); continue; }
      const out = steerTo(
        { x: c.x, z: c.z, yaw: yawOf(sim.quatOf(b)), speed: c.speed },
        { x: tgt.pos[0], z: tgt.pos[2] },
        { maxSpeed: copSpeed(starsOf(tgt.s.w.heat)), arriveRadius: 1.5, dt: AI_DT, mem: c.mem },
      );
      inp.f = out.f ?? 0; inp.s = out.s ?? 0; inp.jump = out.jump ?? 0;
      inp.hn = !c.siren ? 1 : 0; // front montant unique : allume la sirène
      c.siren = true;
    }
  };

  const release = (id: number) => {
    const c = cars.get(id);
    cars.delete(id);
    if (!c) return;
    const v = sim.resolveRef(c.ref);
    if (v) sim.releaseVehicle(v);
  };

  const spawnCar = (wantedPlayers: { pos: [number, number, number] }[]) => {
    if (cars.size >= POLICE_POOL_MAX || !wantedPlayers.length) return;
    const all: [number, number][] = [];
    for (const p of sim.players.values()) { const q = sim.playerPos(p); all.push([q[0], q[2]]); }
    for (let attempt = 0; attempt < 6; attempt++) {
      const o = wantedPlayers[Math.floor(rand() * wantedPlayers.length)].pos;
      const a = rand() * Math.PI * 2, d = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
      const near = nearestLane(city, o[0] + Math.cos(a) * d, o[2] + Math.sin(a) * d, 30);
      if (!near) continue;
      const { lane, t } = near;
      const x = lane.x0 + (lane.x1 - lane.x0) * t, z = lane.z0 + (lane.z1 - lane.z0) * t;
      if (all.some(([px, pz]) => Math.hypot(px - x, pz - z) < SPAWN_MIN - 5)) continue; // jamais en vue d'un joueur
      const v = sim.acquireVehicle('police', x, z, lane.yaw, { ai: true });
      if (!v) return; // pool vide : on réessaiera plus tard
      cars.set(v.id, { ref: sim.refOf(v), mem: newDriveMem(), lastHp: v.hp, siren: false, x, z, speed: 0 });
      return;
    }
  };

  const manageCars = (wantedPlayers: { p: SimPlayer; s: PState; pos: [number, number, number] }[]) => {
    let desired = 0;
    for (const w of wantedPlayers) desired += copsWanted(starsOf(w.s.w.heat));
    desired = Math.min(POLICE_POOL_MAX, desired);
    idleTicks = wantedPlayers.length ? 0 : idleTicks + SPAWN_EVERY;
    if (cars.size < desired) { spawnCar(wantedPlayers); return; }
    // Distances à tous les joueurs (recyclage des voitures inutiles ou perdues)
    const players: [number, number][] = [];
    for (const p of sim.players.values()) { const q = sim.playerPos(p); players.push([q[0], q[2]]); }
    const nearestPlayer = (c: Car) => {
      let d = Infinity;
      for (const [px, pz] of players) d = Math.min(d, Math.hypot(px - c.x, pz - c.z));
      return d;
    };
    for (const [id, c] of [...cars]) {
      const d = nearestPlayer(c);
      if (d > FAR_RELEASE) { release(id); return; }
      if (cars.size > desired) {
        const need = idleTicks > 7200 ? 25 : 60; // hors vue ; au bout de 2 min sans recherche, même près
        if (d > need) { release(id); return; }
      }
    }
  };

  // ---------- Pas de jeu ----------
  const fast = () => {
    refreshCars();
    const peds = pedsSys()?.peds;
    const wantedPlayers: { p: SimPlayer; s: PState; pos: [number, number, number] }[] = [];
    for (const p of sim.players.values()) {
      const s = ensure(p);
      const pos = sim.playerPos(p);
      if (!alive(p)) { publish(p, s); continue; }
      // Vu par un flic ? (voiture à 70 m, piéton flic à 40 m)
      let seen = false;
      let contact = false;
      for (const c of cars.values()) {
        const d = Math.hypot(c.x - pos[0], c.z - pos[2]);
        if (d < 70) seen = true;
        if (d < BUST_CAR_R) contact = true;
      }
      if (peds) {
        for (const q of peds) {
          if (q.kind !== 'flic' || q.gone) continue;
          const d = Math.hypot(q.x - pos[0], q.z - pos[2]);
          if (d < 40) seen = true;
          if (d < BUST_R) contact = true;
        }
      }
      s.w = tickWanted(s.w, AI_DT, seen);
      const stars = starsOf(s.w.heat);
      publish(p, s);
      s.seenBy = seen;
      if (stars > 0) wantedPlayers.push({ p, s, pos });
      // Arrestation : à pied, contact continu avec un flic
      if (stars > 0 && !p.vehicle && contact && p.hp > 0 && sim.time >= p.invulnUntil) {
        s.bust += AI_DT;
        if (s.bust >= BUST_S) bust(p, s);
      } else s.bust = Math.max(0, s.bust - AI_DT * 2);
    }
    driveCars(wantedPlayers);
    if (tick % SPAWN_EVERY < AI_EVERY) manageCars(wantedPlayers);
  };

  const hospitalTransfer = () => {
    for (const id of [...hospitalQueue]) {
      const p = sim.players.get(id);
      if (!p) { hospitalQueue.delete(id); continue; }
      if (p.hp <= 0) continue; // la simulation ne l'a pas encore relevé
      hospitalQueue.delete(id);
      if (hopital && bodyOk(p.body)) {
        sim.teleportPlayer(p, hopital.x, 1.3, hopital.z);
        p.invulnUntil = sim.time + 3000;
      }
    }
  };

  return {
    id: 'police',
    get carCount() { return cars.size; },
    starsOf: (id) => starsOf(states.get(id)?.w.heat ?? 0),
    heatOf: (id) => states.get(id)?.w.heat ?? 0,
    setStars(id, n) {
      const p = sim.players.get(id);
      if (!p || typeof n !== 'number' || !Number.isFinite(n)) return;
      const s = ensure(p);
      s.w = { heat: heatOfStars(Math.max(0, Math.min(5, n))), kills: 0, calm: 0 };
      publish(p, s);
    },
    postStep() {
      tick++;
      if (hospitalQueue.size) hospitalTransfer();
      if (tick % AI_EVERY === 0) fast();
    },
    onJoin(p) { publish(p, ensure(p)); },
    onLeave(p) {
      const s = states.get(p.id);
      if (s && s.w.heat > 0 && saved.size < MAX_SAVED) saved.set(p.id, { heat: s.w.heat, kills: s.w.kills });
      states.delete(p.id);
      hospitalQueue.delete(p.id);
    },
    privateView(p, out: PrivateState) {
      const s = states.get(p.id);
      out.stars = starsOf(s?.w.heat ?? 0);
      out.starProgress = s ? Math.round(starProgress(s.w.heat) * 100) / 100 : 0;
      if (!cars.size) return;
      const pos = sim.playerPos(p);
      const list: { d: number; m: Mark }[] = [];
      for (const c of cars.values()) { // positions mises en cache par refreshCars : aucune lecture de Rapier ici
        const d = Math.hypot(c.x - pos[0], c.z - pos[2]);
        if (d <= MARK_R) list.push({ d, m: { x: Math.round(c.x), z: Math.round(c.z), k: 'danger', label: 'flic' } });
      }
      list.sort((a, b) => a.d - b.d);
      for (const e of list.slice(0, 6)) out.marks.push(e.m);
    },
    serialize() {
      const w: Record<string, { heat: number; kills: number }> = {};
      let n = 0;
      for (const [id, s] of states) if (s.w.heat > 0 && n++ < MAX_SAVED) w[id] = { heat: Math.round(s.w.heat * 10) / 10, kills: s.w.kills };
      for (const [id, s] of saved) if (n++ < MAX_SAVED && !(id in w)) w[id] = { heat: s.heat, kills: s.kills };
      return { v: 1, w };
    },
    restore(data) {
      if (!isObj(data) || !isObj(data.w)) return;
      let n = 0;
      for (const id of Object.keys(data.w)) {
        if (BAD.has(id) || id.length > 48 || n >= MAX_SAVED) continue;
        const e = (data.w as Record<string, unknown>)[id];
        if (!isObj(e)) continue;
        const heat = typeof e.heat === 'number' && Number.isFinite(e.heat) ? Math.max(0, Math.min(HEAT_MAX, e.heat)) : 0;
        const kills = typeof e.kills === 'number' && Number.isFinite(e.kills) ? Math.max(0, Math.min(10, Math.floor(e.kills))) : 0;
        if (heat > 0) { saved.set(id, { heat, kills }); n++; }
      }
    },
  };
};
