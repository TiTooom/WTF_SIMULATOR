// PROPRIÉTAIRE : game-missions
// Activités annexes : touche d'activité (Input.act, front montant) au volant du bon véhicule (shared/activities.ts).
//  - Taxi (berline de livrée 1) : un client (marqueur) à prendre puis à déposer ; pourboire selon le temps ; courses enchaînées jusqu'à l'arrêt.
//  - Justicier (voiture de police) : des fuyards apparaissent et roulent vers des carrefours ; les détruire ou les coller 2 s fait baisser l'indice et rapporte.
// Arrêt : nouvelle pression, sortie du véhicule, véhicule détruit, mort, départ. Aucun corps conservé entre deux ticks (VRef + resolveRef + bodyOk).
import type { AcquireOpts, SimPlayer, SimVehicle, VRef } from '../../shared/api';
import { newDriveMem, steerTo, type DriveMem } from '../../shared/ai/drive';
import {
  JUSTICE_CATCH_R, JUSTICE_CATCH_S, JUSTICE_ESCAPE_DIST, JUSTICE_ESCAPE_S, JUSTICE_PAY_CATCH, JUSTICE_PAY_DESTROY, JUSTICE_SPAWN_MAX, JUSTICE_SPAWN_MIN,
  JUSTICE_SPEED, JUSTICE_WAVE_PAUSE_S, TAXI_ABANDON_FACTOR, TAXI_BOARD_S, TAXI_LIVERY, TAXI_PICKUP_MAX, TAXI_PICKUP_MIN, TAXI_RIDE_MAX, TAXI_RIDE_MIN,
  TAXI_STOP_R, TAXI_STOP_SPEED, justiceWave, taxiBudgetS, taxiFare, taxiTip, type ActivityKind,
} from '../../shared/activities';
import { bodyOk } from '../../shared/guard';
import type { GameCtx, GameSystem, SystemFactory } from '../../shared/game';
import type { Mark, PrivateState } from '../../shared/protocol';
import type { EconomySystem } from './economy';
import type { MissionsSystem } from './missions';
import type { PoliceSystem } from './police';
import type { TrafficSystem } from './traffic';

const AI_EVERY = 3; // ticks entre deux décisions (20 Hz)
const AI_DT = AI_EVERY / 60;

/** Un véhicule du pool pour une mission ou une activité ; si le pool de ce type est vide, recycle un civil du trafic loin de tous les joueurs. */
export function obtainVehicle(ctx: GameCtx, type: string, x: number, z: number, yaw: number, opts: AcquireOpts = {}): SimVehicle | null {
  const { sim } = ctx;
  const v = sim.acquireVehicle(type, x, z, yaw, opts);
  if (v) return v;
  const traffic = ctx.get<TrafficSystem>('traffic');
  if (!traffic) return null;
  const pts: [number, number][] = [];
  for (const p of sim.players.values()) { const q = sim.playerPos(p); pts.push([q[0], q[2]]); }
  for (const c of sim.vehicles) {
    if (c.def.type !== type || c.pooled || c.dead || c.driver || c.passengers.length) continue;
    if (!traffic.isCivil(c) && !traffic.isParked(c)) continue;
    const r = sim.resolveRef(sim.refOf(c));
    if (!r || !bodyOk(r.behavior.body)) continue;
    const t = r.behavior.body.translation();
    if (pts.some(([px, pz]) => Math.hypot(px - t.x, pz - t.z) < 50)) continue;
    sim.releaseVehicle(r);
    const n = sim.acquireVehicle(type, x, z, yaw, opts);
    if (n) return n;
  }
  return null;
}

interface Crim {
  ref: VRef;
  mem: DriveMem;
  node: number; // carrefour visé
  prev: number;
  x: number; z: number; // dernière position connue (nombres)
  far: number; // s passées trop loin
  catchT: number; // s de contact continu
  state: 'run' | 'caught';
  until: number; // sim.time : retrait après capture
  kill: boolean; // détruit par le joueur (renseigné par l'événement vehicleDestroyed)
}
interface Sess {
  kind: ActivityKind;
  car: VRef;
  score: number;
  lastStars: number;
  // taxi
  phase: 'pickup' | 'ride';
  tx: number; tz: number; // cible courante
  t0: number; budget: number; fare: number; board: number; rides: number;
  // justicier
  crims: Crim[];
  wave: number;
  nextWave: number;
}

export interface ActivitiesSystem extends GameSystem {
  /** Activité en cours de `p` (tests, HUD) : type, phase, score, cible, fuyards. */
  inspect(p: SimPlayer): { kind: ActivityKind; phase: string; score: number; target: { x: number; z: number } | null; crims: { ref: VRef; x: number; z: number }[] } | null;
  /** Arrête l'activité de `p` (true s'il y en avait une). */
  stop(p: SimPlayer, why?: string): boolean;
}

export const createActivities: SystemFactory = (ctx): ActivitiesSystem => {
  const { sim, bus, city } = ctx;
  const sessions = new Map<string, Sess>();
  const lastAct = new Map<string, number>();
  let tick = 0;
  let rng = 31337;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  const eco = () => ctx.get<EconomySystem>('economy');
  const police = () => ctx.get<PoliceSystem>('police');
  const missions = () => ctx.get<MissionsSystem>('missions');
  const toast = (p: SimPlayer, text: string) => ctx.sendTo(p.id, { k: 'toast', text });
  const pay = (p: SimPlayer, amount: number) => { if (amount > 0) eco()?.addMoney(p, amount); };

  const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
  const playerPoints = (): [number, number][] => {
    const out: [number, number][] = [];
    for (const q of sim.players.values()) { const t = sim.playerPos(q); out.push([t[0], t[2]]); }
    return out;
  };
  /** Carrefour à une distance donnée (m) d'un point ; null si introuvable. */
  const pickNode = (x: number, z: number, lo: number, hi: number, avoid: [number, number][] = [], keep = 0) => {
    for (let k = 0; k < 40; k++) {
      const n = city.nodes[Math.floor(rand() * city.nodes.length)];
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < lo || d > hi || avoid.some(([ax, az]) => Math.hypot(ax - n.x, az - n.z) < keep)) continue;
      return n;
    }
    return null;
  };

  const end = (p: SimPlayer | undefined, id: string, text: string | null) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    for (const c of s.crims) { const v = sim.resolveRef(c.ref); if (v) sim.releaseVehicle(v); }
    if (p && text) toast(p, s.score > 0 ? `${text} Gains : ${s.score} €.` : text);
  };

  // ---------- Démarrage ----------
  const beginTaxi = (p: SimPlayer, v: SimVehicle, s: Sess) => {
    const at = sim.playerPos(p);
    const n = pickNode(at[0], at[2], TAXI_PICKUP_MIN, TAXI_PICKUP_MAX) ?? pickNode(at[0], at[2], 30, 400);
    if (!n) { toast(p, 'Aucun client en vue. Réessaie ailleurs.'); return false; }
    s.phase = 'pickup'; s.tx = n.x; s.tz = n.z; s.board = 0;
    return true;
  };

  const press = (p: SimPlayer) => {
    if (sessions.has(p.id)) { end(p, p.id, 'Tu raccroches.'); return; }
    const v = p.vehicle;
    if (!v || p.seat !== 0 || p.hp <= 0) return;
    if (missions()?.inMission(p)) { toast(p, 'Pas d\'activité annexe pendant une mission.'); return; }
    const type = v.def.type;
    let kind: ActivityKind | null = null;
    if (type === 'berline' && v.livery === TAXI_LIVERY) kind = 'taxi';
    else if (type === 'police') kind = 'justicier';
    if (!kind) { toast(p, 'Cette voiture ne sert à rien d\'officiel. Trouve un taxi (berline jaune) ou une voiture de police.'); return; }
    const s: Sess = {
      kind, car: sim.refOf(v), score: 0, lastStars: police()?.starsOf(p.id) ?? 0, phase: 'pickup', tx: 0, tz: 0, t0: sim.time, budget: 0, fare: 0, board: 0, rides: 0,
      crims: [], wave: 0, nextWave: sim.time + 1500,
    };
    if (kind === 'taxi' && !beginTaxi(p, v, s)) return;
    sessions.set(p.id, s);
    toast(p, kind === 'taxi' ? 'Taxi : va chercher le client (repère sur la carte).' : 'Justicier : des fuyards arrivent. Détruis-les ou colle-les.');
  };

  // ---------- Taxi ----------
  const stepTaxi = (p: SimPlayer, s: Sess, pos: [number, number, number], speed: number) => {
    const d = Math.hypot(s.tx - pos[0], s.tz - pos[2]);
    const stopped = d <= TAXI_STOP_R && speed <= TAXI_STOP_SPEED;
    if (s.phase === 'pickup') {
      s.board = stopped ? s.board + AI_DT : 0;
      if (s.board < TAXI_BOARD_S) return;
      const n = pickNode(s.tx, s.tz, TAXI_RIDE_MIN, TAXI_RIDE_MAX) ?? pickNode(s.tx, s.tz, 40, 500);
      if (!n) { end(p, p.id, 'Plus de course pour l\'instant.'); return; }
      const dist = Math.hypot(n.x - s.tx, n.z - s.tz);
      s.fare = taxiFare(dist);
      s.budget = taxiBudgetS(dist);
      s.t0 = sim.time;
      s.tx = n.x; s.tz = n.z; s.phase = 'ride'; s.board = 0;
      toast(p, 'Client à bord. Dépose-le vite : le pourboire fond avec le temps.');
      return;
    }
    const elapsed = (sim.time - s.t0) / 1000;
    if (stopped) {
      const tip = taxiTip(s.fare, s.budget, elapsed);
      pay(p, s.fare + tip);
      s.score += s.fare + tip;
      s.rides++;
      toast(p, `Course : ${s.fare} € + ${tip} € de pourboire.`);
    } else if (elapsed > s.budget * TAXI_ABANDON_FACTOR) {
      toast(p, 'Le client est descendu en grommelant. Course non payée.');
    } else return;
    const from = stopped ? [s.tx, s.tz] : [pos[0], pos[2]];
    const n = pickNode(from[0], from[1], TAXI_PICKUP_MIN, TAXI_PICKUP_MAX);
    if (!n) { end(p, p.id, 'Fin de service.'); return; }
    s.phase = 'pickup'; s.tx = n.x; s.tz = n.z; s.board = 0;
  };

  // ---------- Justicier ----------
  const spawnWave = (p: SimPlayer, s: Sess, pos: [number, number, number]) => {
    const want = justiceWave(s.wave);
    const avoid = playerPoints();
    for (let i = 0; i < want; i++) {
      const n = pickNode(pos[0], pos[2], JUSTICE_SPAWN_MIN, JUSTICE_SPAWN_MAX, avoid, 60);
      if (!n) continue;
      const nb = city.neighbors[n.id] ?? [];
      const dest = nb.length ? nb[Math.floor(rand() * nb.length)] : n.id;
      const dn = city.nodes[dest];
      const yaw = Math.atan2(-(dn.x - n.x), -(dn.z - n.z));
      const v = obtainVehicle(ctx, i % 2 ? 'camionnette' : 'citadine', n.x, n.z, Number.isFinite(yaw) ? yaw : 0, { ai: true, y: 0.7 });
      if (!v) continue;
      s.crims.push({ ref: sim.refOf(v), mem: newDriveMem(), node: dest, prev: n.id, x: n.x, z: n.z, far: 0, catchT: 0, state: 'run', until: 0, kill: false });
    }
    s.wave++;
    if (!s.crims.length) s.nextWave = sim.time + 2500; // pool vide : on réessaie
    else toast(p, `Vague ${s.wave} : ${s.crims.length} fuyard(s) sur la carte.`);
  };

  const reward = (p: SimPlayer, s: Sess, amount: number, text: string) => {
    pay(p, amount);
    s.score += amount;
    const pol = police();
    if (pol) pol.setStars(p.id, Math.max(0, s.lastStars - 1));
    s.lastStars = Math.max(0, s.lastStars - 1);
    toast(p, `${text} +${amount} €`);
  };

  const stepJustice = (p: SimPlayer, s: Sess, pos: [number, number, number]) => {
    if (!s.crims.length && sim.time >= s.nextWave) { spawnWave(p, s, pos); return; }
    for (const c of [...s.crims]) {
      const v = sim.resolveRef(c.ref);
      const drop = () => { s.crims.splice(s.crims.indexOf(c), 1); if (!s.crims.length) s.nextWave = sim.time + JUSTICE_WAVE_PAUSE_S * 1000; };
      if (!v) { // détruit (ou recyclé)
        if (c.kill) reward(p, s, JUSTICE_PAY_DESTROY, 'Fuyard détruit !');
        drop();
        continue;
      }
      const b = v.behavior.body;
      if (!bodyOk(b)) { sim.releaseVehicle(v); drop(); continue; }
      const t = b.translation();
      c.x = t.x; c.z = t.z;
      const d = Math.hypot(t.x - pos[0], t.z - pos[2]);
      if (c.state === 'caught') {
        if (v.ai) { v.ai.input.f = 0; v.ai.input.s = 0; v.ai.input.jump = 1; }
        if (sim.time >= c.until) { sim.releaseVehicle(v); drop(); }
        continue;
      }
      c.far = d > JUSTICE_ESCAPE_DIST ? c.far + AI_DT : 0;
      if (c.far >= JUSTICE_ESCAPE_S) { sim.releaseVehicle(v); toast(p, 'Un fuyard s\'est échappé.'); drop(); continue; }
      c.catchT = d <= JUSTICE_CATCH_R ? c.catchT + AI_DT : Math.max(0, c.catchT - AI_DT);
      if (c.catchT >= JUSTICE_CATCH_S) {
        c.state = 'caught';
        c.until = sim.time + 1200;
        reward(p, s, JUSTICE_PAY_CATCH, 'Fuyard coincé !');
        continue;
      }
      const wp = city.nodes[c.node];
      if (Math.hypot(wp.x - t.x, wp.z - t.z) < 14) {
        const nb = (city.neighbors[c.node] ?? []).filter((n) => n !== c.prev);
        const next = nb.length ? nb[Math.floor(rand() * nb.length)] : c.prev;
        c.prev = c.node;
        c.node = next;
      }
      if (v.ai) {
        const tg = city.nodes[c.node];
        const out = steerTo({ x: t.x, z: t.z, yaw: yawOf(sim.quatOf(b)), speed: sim.forwardSpeed(b) }, tg, { maxSpeed: JUSTICE_SPEED, arriveRadius: 4, dt: AI_DT, mem: c.mem });
        v.ai.input.f = out.f ?? 0; v.ai.input.s = out.s ?? 0; v.ai.input.jump = out.jump ?? 0; v.ai.input.hn = 0;
      }
    }
  };

  bus.on('vehicleDestroyed', ({ v, by }) => {
    for (const [id, s] of sessions) {
      for (const c of s.crims) {
        if (c.ref.id !== v.id || c.ref.gen !== v.gen) continue;
        c.kill = (by?.id === id) || v.lastHitBy === id;
      }
    }
  });

  const fast = () => {
    for (const [id, s] of [...sessions]) {
      const p = sim.players.get(id);
      if (!p || p.hp <= 0) { end(p, id, null); continue; }
      const v = sim.resolveRef(s.car);
      if (!v || p.vehicle !== v || p.seat !== 0) { end(p, id, v ? 'Tu as quitté le véhicule.' : 'Le véhicule est hors service.'); continue; }
      const b = v.behavior.body;
      const lv = bodyOk(b) ? b.linvel() : { x: 0, z: 0 };
      const speed = Math.hypot(lv.x, lv.z);
      const pos = sim.playerPos(p);
      if (s.kind === 'taxi') stepTaxi(p, s, pos, speed);
      else stepJustice(p, s, pos);
      if (sessions.get(id) === s) s.lastStars = police()?.starsOf(id) ?? s.lastStars;
    }
  };

  return {
    id: 'activities',
    inspect(p) {
      const s = sessions.get(p.id);
      if (!s) return null;
      return {
        kind: s.kind, phase: s.kind === 'taxi' ? s.phase : s.crims.length ? 'chasse' : 'pause', score: s.score,
        target: s.kind === 'taxi' ? { x: s.tx, z: s.tz } : null,
        crims: s.crims.map((c) => ({ ref: c.ref, x: c.x, z: c.z })),
      };
    },
    stop(p, why) {
      if (!sessions.has(p.id)) return false;
      end(p, p.id, why ?? 'Tu raccroches.');
      return true;
    },
    postStep() {
      tick++;
      for (const p of sim.players.values()) {
        const a = p.input?.act ? 1 : 0;
        const was = lastAct.get(p.id) ?? 0;
        lastAct.set(p.id, a);
        if (a && !was) press(p);
      }
      if (sessions.size && tick % AI_EVERY === 0) fast();
    },
    onLeave(p) { end(p, p.id, null); lastAct.delete(p.id); },
    privateView(p, out: PrivateState) {
      const s = sessions.get(p.id);
      if (!s) return;
      const marks: Mark[] = out.marks;
      if (s.kind === 'taxi') {
        const left = Math.max(0, Math.ceil((s.budget - (sim.time - s.t0) / 1000) / 5) * 5);
        out.activity = { kind: 'taxi', text: s.phase === 'pickup' ? 'Va chercher le client' : `Dépose-le : ${left} s`, score: s.score };
        marks.push({ x: Math.round(s.tx), z: Math.round(s.tz), k: 'cible', label: s.phase === 'pickup' ? 'client' : 'dépose' });
      } else {
        const alive = s.crims.filter((c) => c.state === 'run').length;
        out.activity = { kind: 'justicier', text: alive ? `Fuyards : ${alive}` : 'Prochaine vague...', score: s.score };
        for (const c of s.crims.slice(0, 3)) marks.push({ x: Math.round(c.x), z: Math.round(c.z), k: 'cible', label: 'fuyard' });
      }
    },
    serialize: () => ({ v: 1 }),
    restore: () => {},
  };
};
