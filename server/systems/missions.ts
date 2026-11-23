// PROPRIÉTAIRE : game-missions
// Missions (shared/missions) : lancées par un joueur près du donneur (message `mission` start / abort / retry), PARTAGÉES avec les joueurs à moins de
// JOIN_R m, un checkpoint à chaque étape validée, médaille bronze / argent / or (temps, dégâts subis, précision), récompense via l'économie.
//  - Coop : une « course » (Run) = un groupe ; départ ou arrivée d'un joueur en pleine mission géré ; le meneur est transféré s'il part ou tombe.
//  - Échec (mort, arrestation, voiture volée détruite, temps écoulé, abandon) : un enregistrement de reprise est gardé ; `retry` repart IMMÉDIATEMENT
//    du dernier checkpoint (position, voiture volée recréée, chronomètre et statistiques du checkpoint).
//  - Étapes : aller, livrer, voler (voiture verrouillée sur un parking POI, crochetée par le mini-jeu du vol), detruire (police / véhicules / caméra),
//    semer (l'indice baisse en détruisant des voitures de police), minijeu (système minigames), attendre.
//  - Aucun corps Rapier conservé : VRef + resolveRef (+ bodyOk avant toute lecture de corps), positions en nombres.
//  - Sauvegarde : médailles par pseudo (validées à la lecture, Map, clés dangereuses filtrées).
import type { SimPlayer, SimVehicle, VRef } from '../../shared/api';
import { bodyOk } from '../../shared/guard';
import type { GameCtx, GameSystem, SystemFactory } from '../../shared/game';
import { MEDAL_TIERS, isIn, type MedalTier } from '../../shared/ids';
import { MISSIONS, missionById } from '../../shared/missions';
import { accuracyOf, betterMedal, medalFor, medalRank, rewardOf } from '../../shared/missions/medals';
import type { MissionDef, MissionStep } from '../../shared/missions/types';
import { vignetteId } from '../../shared/missions/vignettes';
import type { GameClientMsg, Mark, PrivateState } from '../../shared/protocol';
import { obtainVehicle } from './activities';
import type { EconomySystem } from './economy';
import type { MinigameDone, MinigamesSystem } from './minigames';
import type { PoliceSystem } from './police';
import type { TrafficSystem } from './traffic';

export const START_R = 45; // m : distance maximale du donneur pour lancer
export const JOIN_R = 30; // m : les joueurs plus proches que ça du meneur partagent la mission
const EVERY = 3; // ticks entre deux traitements (20 Hz)
const MAX_PLAYERS_SAVED = 64;
const MAX_FAILS = 64;
const LINGER_MS = 60_000; // une voiture de mission abandonnée est rangée au bout de ce délai
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const MG_FAIL_REASONS = new Set(['echec', 'invalide', 'trop_rapide', 'trop_long', 'expire']);

interface Stats { dmg: number; shots: number; kills: number; mgOk: number; mgFail: number; steps: number }
interface Checkpoint { step: number; ms: number; x: number; z: number; car: string | null; stats: Stats }
interface Target { ref: VRef; own: boolean }
interface Last { hp: number; vid: number; vgen: number; vhp: number }
interface Rec { id: string; cp: Checkpoint; origin: Run | null; rerun: Run | null }
interface Run {
  key: number;
  def: MissionDef;
  leader: string;
  members: Set<string>;
  step: number;
  stepAt: number; // sim.time à l'entrée dans l'étape
  t0: number; // sim.time « virtuel » du départ (reculé du temps déjà écoulé au checkpoint lors d'une reprise)
  cp: Checkpoint;
  stats: Stats;
  car: VRef | null; // voiture volée à livrer
  carType: string | null;
  targets: Target[]; // voiture à voler ou véhicules ennemis de l'étape
  tpos: [number, number][]; // positions en cache des cibles vivantes (repères)
  killsStep: number;
  tgtDead: number;
  mgBusy: boolean;
  mgRetryAt: number;
  adv: boolean; // l'étape est accomplie : avancer au prochain traitement
  stolen: VRef | null; // voiture qu'un participant vient d'enlever (étape voler)
  own: VRef[]; // véhicules créés par la mission (rangés à la fin)
  last: Map<string, Last>;
  rec: Rec | null;
  ended: boolean;
}

export interface MissionInspect {
  id: string; step: number; steps: number; leader: string; members: string[]; car: VRef | null; targets: VRef[]; elapsed: number;
  cp: { step: number; ms: number }; stats: Stats;
}

export interface MissionsSystem extends GameSystem {
  /** Le joueur participe-t-il à une mission ? */
  inMission(p: SimPlayer): boolean;
  /** État détaillé de la mission du joueur (tests, outils), ou null. */
  inspect(p: SimPlayer): MissionInspect | null;
  /** Meilleures médailles d'un joueur (par pseudo). */
  medalsOf(p: SimPlayer): Record<string, MedalTier>;
  /** Identifiant de la mission rejouable (dernier échec) du joueur, ou null. */
  retryOf(p: SimPlayer): string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const newStats = (): Stats => ({ dmg: 0, shots: 0, kills: 0, mgOk: 0, mgFail: 0, steps: 0 });
const copyStats = (s: Stats): Stats => ({ ...s });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const createMissions: SystemFactory = (ctx: GameCtx): MissionsSystem => {
  const { sim, bus, city } = ctx;
  const runs = new Map<number, Run>();
  const fails = new Map<string, Rec>(); // id de joueur -> mission rejouable
  const progress = new Map<string, Map<string, MedalTier>>(); // pseudo -> médailles
  const linger: { ref: VRef; at: number }[] = [];
  let keyN = 0;
  let tick = 0;
  const parking = city.poisOf('parking');
  const giverOf = new Map(city.poisOf('donneur').map((p) => [p.id, p]));

  const eco = () => ctx.get<EconomySystem>('economy');
  const mgs = () => ctx.get<MinigamesSystem>('minigames');
  const police = () => ctx.get<PoliceSystem>('police');
  const traffic = () => ctx.get<TrafficSystem>('traffic');
  const toast = (p: SimPlayer, text: string) => ctx.sendTo(p.id, { k: 'toast', text });
  const playerOf = (id: string) => sim.players.get(id);
  const alive = (p: SimPlayer) => p.hp > 0 && sim.players.get(p.id) === p;
  const runOf = (id: string): Run | null => { for (const r of runs.values()) if (r.members.has(id)) return r; return null; };
  const medalsFor = (name: string): Map<string, MedalTier> => {
    let m = progress.get(name);
    if (!m) {
      m = new Map();
      if (progress.size >= MAX_PLAYERS_SAVED) { // purge du plus ancien joueur hors ligne
        const online = new Set([...sim.players.values()].map((q) => q.name));
        for (const k of progress.keys()) if (!online.has(k)) { progress.delete(k); break; }
      }
      progress.set(name, m);
    }
    return m;
  };
  const unlocked = (p: SimPlayer, def: MissionDef) => !def.requires || medalRank(medalsFor(p.name).get(def.requires)) > 0;

  const leaderOf = (run: Run): SimPlayer | undefined => {
    const l = playerOf(run.leader);
    if (l) return l;
    for (const id of run.members) { const q = playerOf(id); if (q) return q; }
    return undefined;
  };
  const near = (p: SimPlayer, x: number, z: number, r: number) => { const q = sim.playerPos(p); return Math.hypot(q[0] - x, q[2] - z) <= r; };
  const nearP = (p: SimPlayer, other: SimPlayer, r: number) => { const q = sim.playerPos(other); return near(p, q[0], q[2], r); };
  const deferred: (() => void)[] = []; // actions déclenchées pendant sim.step() (morts) : exécutées au postStep, jamais au milieu de la physique
  const send = (run: Run, ev: Parameters<GameCtx['sendTo']>[1]) => { for (const id of run.members) ctx.sendTo(id, ev); };
  const stepText = (run: Run) => {
    const st = run.def.steps[run.step];
    return st.t === 'detruire' ? `${st.text} (${Math.min(st.count, run.killsStep + run.tgtDead)}/${st.count})` : st.text;
  };
  const elapsedOf = (run: Run) => Math.max(0, sim.time - run.t0);

  // ---------- Véhicules de mission ----------
  const track = (run: Run, v: SimVehicle, own: boolean): Target => {
    const ref = sim.refOf(v);
    if (own) run.own.push(ref);
    return { ref, own };
  };
  const releaseLater = (ref: VRef) => { if (linger.length < 64) linger.push({ ref, at: sim.time + LINGER_MS }); };
  const readXZ = (v: SimVehicle): [number, number] | null => {
    const b = v.behavior.body;
    if (!bodyOk(b)) return null;
    const t = b.translation();
    return Number.isFinite(t.x + t.z) ? [t.x, t.z] : null;
  };
  const freeParking = (x: number, z: number) => {
    const list = parking.map((p) => ({ p, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d);
    for (const { p } of list) {
      let busy = false;
      for (const v0 of sim.vehicles) {
        if (v0.pooled || v0.dead) continue;
        const v = sim.resolveRef(sim.refOf(v0));
        const q = v && readXZ(v);
        if (q && Math.hypot(q[0] - p.x, q[1] - p.z) < 5) { busy = true; break; }
      }
      if (!busy) return p;
    }
    return null;
  };

  // ---------- Fin de course ----------
  const cleanup = (run: Run, keepCar: boolean) => {
    if (run.ended) return;
    run.ended = true;
    runs.delete(run.key);
    for (const id of run.members) {
      const p = playerOf(id);
      const a = p && mgs()?.activeOf(p);
      if (p && a && a.tag.startsWith('mission:')) mgs()?.cancel(p, 'mission');
    }
    for (const ref of run.own) {
      const v = sim.resolveRef(ref);
      if (!v) continue;
      const mine = run.car && run.car.id === ref.id && run.car.gen === ref.gen;
      if (mine && keepCar) { releaseLater(ref); continue; }
      if (v.driver || v.passengers.length) { releaseLater(ref); continue; }
      sim.releaseVehicle(v);
    }
  };

  const mkRec = (run: Run): Rec => {
    if (!run.rec) run.rec = { id: run.def.id, cp: run.cp, origin: run, rerun: null };
    run.rec.cp = run.cp;
    return run.rec;
  };
  const remember = (id: string, rec: Rec) => {
    if (fails.size >= MAX_FAILS && !fails.has(id)) fails.delete(fails.keys().next().value as string);
    fails.set(id, rec);
  };

  const failRun = (run: Run, text: string) => {
    if (run.ended) return;
    const rec = mkRec(run);
    for (const id of run.members) { remember(id, rec); ctx.sendTo(id, { k: 'mission', ev: 'fail', id: run.def.id, text: clip(text, 60) }); }
    cleanup(run, false);
  };

  const finish = (run: Run) => {
    if (run.ended) return;
    const def = run.def;
    const ms = elapsedOf(run);
    const acc = accuracyOf({ steps: run.stats.steps, kills: run.stats.kills, mgOk: run.stats.mgOk, mgFail: run.stats.mgFail, shots: run.stats.shots });
    const tier = medalFor(def, { ms, damage: run.stats.dmg, accuracy: acc });
    // Objectifs de la médaille visée : la suivante (ou l'or s'il est déjà obtenu)
    const par = { ...def.medals[MEDAL_TIERS[Math.min(MEDAL_TIERS.length - 1, MEDAL_TIERS.indexOf(tier) + 1)]] };
    for (const id of run.members) {
      const p = playerOf(id);
      if (!p) continue;
      const med =medalsFor(p.name);
      const prev = med.get(def.id);
      const improved = medalRank(tier) > medalRank(prev);
      const gain = rewardOf(def, tier, improved);
      const best = betterMedal(prev, tier);
      if (best) med.set(def.id, best);
      eco()?.addMoney(p, gain);
      fails.delete(id);
      ctx.sendTo(id, { k: 'mission', ev: 'done', id: def.id, medal: tier, ms: Math.round(ms), text: `+${gain} €`, damage: Math.round(run.stats.dmg), accuracy: Math.round(acc * 100) / 100, reward: gain, par });
      ctx.sendTo(id, { k: 'vignettes', id: vignetteId(def.id, 'fin') });
    }
    cleanup(run, true);
  };

  /** Retire un participant. Dernier restant : la mission échoue. `text` : raison montrée à celui qui sort. */
  const dropMember = (run: Run, p: SimPlayer, text: string) => {
    if (!run.members.has(p.id)) return;
    if (run.members.size <= 1) { failRun(run, text); return; }
    const rec = mkRec(run);
    run.members.delete(p.id);
    run.last.delete(p.id);
    remember(p.id, rec);
    const a = mgs()?.activeOf(p);
    if (a && a.tag.startsWith('mission:')) mgs()?.cancel(p, 'mission');
    ctx.sendTo(p.id, { k: 'mission', ev: 'fail', id: run.def.id, text: clip(text, 60) });
    if (run.leader === p.id) {
      run.leader = run.members.values().next().value as string;
      const nl = playerOf(run.leader);
      if (nl) toast(nl, 'Tu mènes la mission.');
    }
  };

  // ---------- Étapes ----------
  const setStars = (run: Run, n: number) => {
    const pol = police();
    if (!pol) return;
    for (const id of run.members) { const p = playerOf(id); if (p && alive(p)) pol.setStars(id, Math.max(n, pol.starsOf(id))); }
  };

  const enterStep = (run: Run, i: number) => {
    for (const t of run.targets) {
      if (!t.own || (run.car && run.car.id === t.ref.id && run.car.gen === t.ref.gen)) continue; // la voiture volée reste en jeu
      const v = sim.resolveRef(t.ref);
      if (v && !v.driver) sim.releaseVehicle(v);
    }
    run.targets = [];
    run.tpos = [];
    run.step = i;
    run.stepAt = sim.time;
    run.killsStep = 0;
    run.tgtDead = 0;
    run.mgBusy = false;
    run.mgRetryAt = 0;
    run.adv = false;
    run.stolen = null;
    const st = run.def.steps[i];
    const lead = leaderOf(run);
    const at = lead ? sim.playerPos(lead) : [0, 0, 0];
    switch (st.t) {
      case 'voler': {
        // Une voiture garée du trafic du bon type tout près ? sinon on en pose une, verrouillée, sur le parking libre le plus proche.
        let adopted: SimVehicle | null = null, bd = 90;
        const tr = traffic();
        if (tr) {
          for (const v0 of sim.vehicles) {
            if (v0.pooled || v0.dead || v0.def.type !== st.vehicle || v0.driver) continue;
            const v = sim.resolveRef(sim.refOf(v0));
            if (!v || !v.locked || !tr.isParked(v)) continue;
            const q = readXZ(v);
            if (!q) continue;
            const d = Math.hypot(q[0] - at[0], q[1] - at[2]);
            if (d < bd) { bd = d; adopted = v; }
          }
        }
        if (adopted) { run.targets.push(track(run, adopted, false)); break; }
        const spot = freeParking(at[0], at[2]);
        const v = spot && obtainVehicle(ctx, st.vehicle, spot.x, spot.z, spot.yaw, { locked: true, y: 0.7 });
        if (!v) { failRun(run, 'Plus de voiture à voler : réessaie.'); return; }
        run.targets.push(track(run, v, true));
        break;
      }
      case 'detruire':
        if (st.target === 'police') setStars(run, st.stars ?? 2);
        else if (st.target === 'vehicule') {
          const cx = st.x ?? at[0], cz = st.z ?? at[2];
          for (let k = 0; k < st.count; k++) {
            const v = obtainVehicle(ctx, st.vehicle ?? 'camionnette', cx + (k - (st.count - 1) / 2) * 9, cz, Math.PI / 2, { locked: true, y: 0.7 });
            if (v) run.targets.push(track(run, v, true));
          }
          if (!run.targets.length) { failRun(run, 'Plus de véhicule libre : réessaie.'); return; }
        }
        break;
      case 'semer':
        setStars(run, st.stars);
        break;
      default:
        break;
    }
  };

  const saveCheckpoint = (run: Run, step: number) => {
    const lead = leaderOf(run);
    const at = lead ? sim.playerPos(lead) : [0, 0, 0];
    run.cp = { step, ms: elapsedOf(run), x: Math.round(at[0] * 10) / 10, z: Math.round(at[2] * 10) / 10, car: run.car ? run.carType : null, stats: copyStats(run.stats) };
    if (run.rec) run.rec.cp = run.cp;
  };

  const advance = (run: Run) => {
    if (run.ended) return;
    const st = run.def.steps[run.step];
    run.stats.steps++;
    if (st.t === 'livrer') { run.car = null; run.carType = null; }
    const lead = leaderOf(run);
    if (lead) { const at = sim.playerPos(lead); sim.fx({ k: 'confetti', p: [at[0], at[1] + 1, at[2]], c: 0xffd23f }); }
    if (run.step + 1 >= run.def.steps.length) { finish(run); return; }
    const next = run.step + 1;
    saveCheckpoint(run, next);
    enterStep(run, next);
    if (!run.ended) send(run, { k: 'mission', ev: 'checkpoint', id: run.def.id, text: clip(stepText(run), 60) });
  };

  const onMinigame = (run: Run, step: number, e: MinigameDone) => {
    run.mgBusy = false;
    if (run.ended || run.step !== step) return;
    if (e.ok) { run.stats.mgOk++; run.adv = true; return; }
    if (MG_FAIL_REASONS.has(e.reason)) run.stats.mgFail++;
    run.mgRetryAt = sim.time + 1500;
  };

  const processStep = (run: Run) => {
    const st: MissionStep = run.def.steps[run.step];
    const members: SimPlayer[] = [];
    for (const id of run.members) { const p = playerOf(id); if (p && alive(p)) members.push(p); }
    switch (st.t) {
      case 'aller':
        if (members.some((p) => near(p, st.x, st.z, st.r))) run.adv = true;
        break;
      case 'livrer': {
        if (run.car) {
          const v = sim.resolveRef(run.car);
          if (v && members.some((p) => p.vehicle === v && near(p, st.x, st.z, st.r))) run.adv = true;
        } else if (members.some((p) => near(p, st.x, st.z, st.r))) run.adv = true;
        break;
      }
      case 'voler': {
        run.tpos = [];
        for (const t of run.targets) { const v = sim.resolveRef(t.ref); const q = v && readXZ(v); if (q) run.tpos.push(q); }
        if (run.stolen) { run.adv = true; }
        else if (!run.tpos.length && run.targets.length && sim.time - run.stepAt > 1000) failRun(run, 'La voiture a disparu : rejoue.');
        break;
      }
      case 'detruire': {
        if (st.target === 'vehicule') {
          let dead = 0;
          run.tpos = [];
          for (const t of run.targets) {
            const v = sim.resolveRef(t.ref);
            const q = v && readXZ(v);
            if (q) run.tpos.push(q); else dead++;
          }
          if (dead > run.tgtDead) { run.stats.kills += dead - run.tgtDead; run.tgtDead = dead; }
          if (run.tgtDead >= st.count) run.adv = true;
        } else if (st.target === 'camera') {
          run.tpos = [[st.x ?? 0, st.z ?? 0]];
        }
        if (run.killsStep >= st.count) run.adv = true;
        break;
      }
      case 'semer': {
        const pol = police();
        if (!pol || members.every((p) => pol.starsOf(p.id) === 0)) run.adv = true;
        break;
      }
      case 'minijeu': {
        if (run.mgBusy || sim.time < run.mgRetryAt || !mgs()) break;
        for (const p of members) {
          if (p.vehicle || mgs()!.activeOf(p) || !near(p, st.x, st.z, st.r ?? 4)) continue;
          const step = run.step;
          const sid = mgs()!.startMinigame(p, st.kind, `mission:${run.def.id}:${step}`, st.difficulty ?? 0.3, (e) => onMinigame(run, step, e));
          if (sid !== null) { run.mgBusy = true; break; }
        }
        break;
      }
      case 'attendre':
        if (sim.time - run.stepAt >= st.ms) run.adv = true;
        break;
    }
  };

  const trackDamage = (run: Run) => {
    const n = Math.max(1, run.members.size);
    for (const id of run.members) {
      const p = playerOf(id);
      if (!p) continue;
      let m = run.last.get(id);
      if (!m) { m = { hp: p.hp, vid: -1, vgen: -1, vhp: 0 }; run.last.set(id, m); }
      let d = Math.max(0, m.hp - p.hp);
      m.hp = p.hp;
      const v = p.vehicle;
      if (v && !v.pooled) {
        if (m.vid === v.id && m.vgen === v.gen) d += Math.max(0, ((m.vhp - v.hp) / Math.max(1, v.def.maxHp)) * 100);
        m.vid = v.id; m.vgen = v.gen; m.vhp = v.hp;
      } else m.vid = -1;
      run.stats.dmg += d / n;
    }
  };

  const runTick = (run: Run) => {
    if (run.ended) return;
    // départs silencieux : joueurs disparus
    for (const id of [...run.members]) if (!playerOf(id)) { run.members.delete(id); run.last.delete(id); }
    if (!run.members.size) { cleanup(run, false); return; }
    if (!run.members.has(run.leader)) run.leader = run.members.values().next().value as string;
    trackDamage(run);
    if (run.def.timeLimitMs && elapsedOf(run) > run.def.timeLimitMs) { failRun(run, 'Temps écoulé.'); return; }
    if (run.car && !sim.resolveRef(run.car)) { failRun(run, 'Le véhicule est hors service.'); return; }
    if (!run.adv) processStep(run);
    if (run.ended) return;
    if (run.adv) advance(run);
  };

  // ---------- Lancement, reprise, jointure ----------
  const nearbyMates = (leader: SimPlayer): SimPlayer[] => {
    const out: SimPlayer[] = [];
    for (const q of sim.players.values()) if (q !== leader && alive(q) && !runOf(q.id) && nearP(q, leader, JOIN_R)) out.push(q);
    return out;
  };

  const newRun = (def: MissionDef, leader: SimPlayer, cp?: Checkpoint): Run => {
    const at = sim.playerPos(leader);
    const base: Checkpoint = cp ?? { step: 0, ms: 0, x: at[0], z: at[2], car: null, stats: newStats() };
    const run: Run = {
      key: ++keyN, def, leader: leader.id, members: new Set([leader.id]), step: base.step, stepAt: sim.time, t0: sim.time - base.ms,
      cp: base, stats: copyStats(base.stats), car: null, carType: null, targets: [], tpos: [], killsStep: 0, tgtDead: 0, mgBusy: false, mgRetryAt: 0,
      adv: false, stolen: null, own: [], last: new Map(), rec: null, ended: false,
    };
    runs.set(run.key, run);
    return run;
  };

  const joinRun = (run: Run, p: SimPlayer, teleport: boolean) => {
    run.members.add(p.id);
    fails.delete(p.id);
    if (teleport) {
      const lead = leaderOf(run);
      if (lead && lead !== p) {
        const at = sim.playerPos(lead);
        sim.teleportPlayer(p, at[0] + 1.5, 1.3, at[2]);
        p.invulnUntil = Math.max(p.invulnUntil, sim.time + 2000);
        const v = run.car && sim.resolveRef(run.car);
        if (v && v.driver !== p && !v.passengers.includes(p)) sim.enterVehicle(p, v, undefined, true);
      }
    }
    ctx.sendTo(p.id, { k: 'mission', ev: 'start', id: run.def.id, text: clip(stepText(run), 60) });
  };

  const startNew = (p: SimPlayer, def: MissionDef) => {
    fails.delete(p.id);
    const run = newRun(def, p);
    for (const q of nearbyMates(p)) joinRun(run, q, false);
    for (const id of run.members) ctx.sendTo(id, { k: 'vignettes', id: vignetteId(def.id, 'intro') });
    enterStep(run, 0);
    if (run.ended) return;
    for (const id of run.members) ctx.sendTo(id, { k: 'mission', ev: 'start', id: def.id, text: clip(stepText(run), 60) });
  };

  const restart = (p: SimPlayer, rec: Rec, def: MissionDef) => {
    const cp = rec.cp;
    const run = newRun(def, p, cp);
    rec.rerun = run;
    run.rec = rec;
    fails.delete(p.id);
    sim.teleportPlayer(p, cp.x, 1.3, cp.z);
    p.invulnUntil = Math.max(p.invulnUntil, sim.time + 2500);
    police()?.setStars(p.id, 0);
    if (cp.car) {
      const v = obtainVehicle(ctx, cp.car, cp.x, cp.z, 0, { y: 0.7 });
      if (v) {
        sim.enterVehicle(p, v, 0, true);
        run.car = sim.refOf(v);
        run.carType = cp.car;
        run.own.push(run.car);
      }
    }
    enterStep(run, cp.step);
    if (!run.ended) ctx.sendTo(p.id, { k: 'mission', ev: 'start', id: def.id, text: clip(stepText(run), 60) });
  };

  const onStart = (p: SimPlayer, id: string) => {
    const def = missionById(id);
    if (!def || !alive(p) || runOf(p.id)) return;
    if (!unlocked(p, def)) { toast(p, `Termine d'abord « ${missionById(def.requires!)?.name ?? '?'} ».`); return; }
    // Une mission du même nom est en cours près de moi : je la rejoins.
    for (const r of runs.values()) {
      const lead = r.def.id === id ? leaderOf(r) : undefined;
      if (lead && nearP(p, lead, JOIN_R)) { joinRun(r, p, false); return; }
    }
    const giver = giverOf.get(def.giver);
    if (!giver || !near(p, giver.x, giver.z, START_R)) { toast(p, 'Va voir le donneur (repère sur la carte) pour lancer cette mission.'); return; }
    if (mgs()?.activeOf(p)) return;
    startNew(p, def);
  };

  const onRetry = (p: SimPlayer, id: string) => {
    const rec = fails.get(p.id);
    const def = missionById(id);
    if (!rec || !def || rec.id !== id) { toast(p, 'Rien à rejouer pour cette mission.'); return; }
    if (runOf(p.id)) return;
    if (!alive(p)) { toast(p, 'Reviens d\'abord de l\'hôpital.'); return; }
    const live = [rec.origin, rec.rerun].find((r): r is Run => !!r && !r.ended && runs.get(r.key) === r);
    if (live) { joinRun(live, p, true); return; }
    restart(p, rec, def);
  };

  const onAbort = (p: SimPlayer, id: string) => {
    const run = runOf(p.id);
    if (!run || run.def.id !== id) return;
    dropMember(run, p, 'Mission abandonnée.');
  };

  // ---------- Événements du jeu ----------
  bus.on('enteredVehicle', ({ p, v }) => {
    const run = runOf(p.id);
    if (!run || run.ended) return;
    const st = run.def.steps[run.step];
    if (st.t !== 'voler' || p.seat !== 0 || v.def.type !== st.vehicle || run.stolen) return;
    const mine = run.targets.some((t) => t.ref.id === v.id && t.ref.gen === v.gen);
    if (!mine && !traffic()?.isParked(v)) return;
    run.stolen = sim.refOf(v);
    run.car = run.stolen;
    run.carType = v.def.type;
  });

  bus.on('crime', (e) => {
    if (e.kind !== 'tir') return;
    const run = runOf(e.by.id);
    if (run) run.stats.shots++;
  });

  bus.on('vehicleDestroyed', ({ v, by }) => {
    if (v.def.type !== 'police') return;
    const pos = readXZ(v) ?? [v.home.x, v.home.z];
    for (const run of [...runs.values()]) {
      const st = run.def.steps[run.step];
      if (run.ended || st.t !== 'detruire' || st.target !== 'police') continue;
      const mine = (by && run.members.has(by.id)) || (v.lastHitBy !== null && run.members.has(v.lastHitBy))
        || [...run.members].some((id) => { const p = playerOf(id); return !!p && near(p, pos[0], pos[1], 90); });
      if (!mine) continue;
      run.killsStep++;
      run.stats.kills++;
      if (run.killsStep < st.count) setStars(run, st.stars ?? 2); // la police revient tant qu'il en reste à détruire
    }
  });

  bus.on('cameraDestroyed', ({ by }) => {
    if (!by) return;
    const run = runOf(by.id);
    if (!run || run.ended) return;
    const st = run.def.steps[run.step];
    if (st.t !== 'detruire' || st.target !== 'camera') return;
    run.killsStep++;
    run.stats.kills++;
  });

  const lose = (p: SimPlayer, text: string) => {
    deferred.push(() => { const run = runOf(p.id); if (run && !run.ended) dropMember(run, p, text); });
  };
  bus.on('playerDied', ({ p }) => lose(p, 'K.O. : tu peux rejouer depuis le dernier checkpoint.'));
  bus.on('playerBusted', ({ p }) => lose(p, 'Arrêté ! Rejoue depuis le dernier checkpoint.'));

  // ---------- Système ----------
  return {
    id: 'missions',
    inMission: (p) => !!runOf(p.id),
    retryOf: (p) => fails.get(p.id)?.id ?? null,
    medalsOf(p) {
      const out: Record<string, MedalTier> = {};
      for (const [k, v] of medalsFor(p.name)) out[k] = v;
      return out;
    },
    inspect(p) {
      const r = runOf(p.id);
      if (!r) return null;
      return {
        id: r.def.id, step: r.step, steps: r.def.steps.length, leader: r.leader, members: [...r.members], car: r.car, targets: r.targets.map((t) => t.ref),
        elapsed: elapsedOf(r), cp: { step: r.cp.step, ms: r.cp.ms }, stats: copyStats(r.stats),
      };
    },

    postStep() {
      tick++;
      while (deferred.length) { try { deferred.shift()!(); } catch (e) { if (sim.noteError(e)) throw e; sim.log(`[missions] ${(e as Error)?.stack ?? e}`); } }
      if (tick % EVERY !== 0) return;
      for (const run of [...runs.values()]) {
        try { runTick(run); } catch (e) {
          sim.log(`[missions] ${run.def.id} : ${(e as Error)?.stack ?? e}`);
          if (sim.noteError(e)) throw e;
          failRun(run, 'Erreur interne : rejoue.');
        }
      }
      for (let i = linger.length - 1; i >= 0; i--) {
        const l = linger[i];
        if (sim.time < l.at) continue;
        const v = sim.resolveRef(l.ref);
        if (!v) { linger.splice(i, 1); continue; }
        if (!v.driver && !v.passengers.length) { sim.releaseVehicle(v); linger.splice(i, 1); } else l.at = sim.time + LINGER_MS;
      }
    },

    onLeave(p) {
      fails.delete(p.id);
      const run = runOf(p.id);
      if (!run) return;
      run.members.delete(p.id);
      run.last.delete(p.id);
      if (!run.members.size) { cleanup(run, false); return; }
      if (run.leader === p.id) {
        run.leader = run.members.values().next().value as string;
        const nl = playerOf(run.leader);
        if (nl) toast(nl, 'Tu mènes la mission.');
      }
    },

    onMessage(p, m: GameClientMsg) {
      if (m.k !== 'mission') return;
      if (m.op === 'start') onStart(p, m.id);
      else if (m.op === 'retry') onRetry(p, m.id);
      else if (m.op === 'abort') onAbort(p, m.id);
    },

    privateView(p, out: PrivateState) {
      const med = medalsFor(p.name);
      const medals: Record<string, MedalTier> = {};
      for (const [k, v] of med) medals[k] = v;
      out.medals = medals;
      const run = runOf(p.id);
      const marks: Mark[] = out.marks;
      if (run) {
        const st = run.def.steps[run.step];
        out.mission = {
          id: run.def.id, step: run.step + 1, steps: run.def.steps.length, text: clip(stepText(run), 48),
          ms: Math.floor(elapsedOf(run) / 1000) * 1000, ...(run.def.timeLimitMs ? { timeLimitMs: run.def.timeLimitMs } : {}),
        };
        if (st.t === 'aller' || st.t === 'livrer' || st.t === 'minijeu') marks.push({ x: Math.round(st.x), z: Math.round(st.z), k: 'mission', label: st.t === 'minijeu' ? 'ici' : 'objectif' });
        else if (st.t === 'voler' && run.tpos[0]) marks.push({ x: Math.round(run.tpos[0][0]), z: Math.round(run.tpos[0][1]), k: 'cible', label: 'voiture' });
        else if (st.t === 'detruire' && run.tpos[0]) marks.push({ x: Math.round(run.tpos[0][0]), z: Math.round(run.tpos[0][1]), k: 'cible', label: st.target === 'camera' ? 'caméra' : 'cible' });
        return;
      }
      // Pas de mission : le donneur de la prochaine mission accessible (au plus un repère)
      const at = sim.playerPos(p);
      let best: { d: number; m: Mark } | null = null;
      for (const def of MISSIONS) {
        if (!unlocked(p, def) || med.has(def.id)) continue;
        const g = giverOf.get(def.giver);
        if (!g) continue;
        const d = Math.hypot(g.x - at[0], g.z - at[2]);
        if (!best || d < best.d) best = { d, m: { x: Math.round(g.x), z: Math.round(g.z), k: 'donneur', label: clip(def.name, 14) } };
      }
      if (best) marks.push(best.m);
    },

    serialize() {
      const medals: Record<string, Record<string, string>> = {};
      let n = 0;
      for (const [name, m] of progress) {
        if (BAD.has(name) || name.length > 48 || n >= MAX_PLAYERS_SAVED || !m.size) continue;
        const o: Record<string, string> = {};
        for (const [id, t] of m) o[id] = t;
        medals[name] = o;
        n++;
      }
      return { v: 1, medals };
    },

    restore(data) {
      if (!isObj(data) || !isObj(data.medals)) return;
      let n = 0;
      for (const name of Object.keys(data.medals)) {
        if (BAD.has(name) || name.length === 0 || name.length > 48 || n >= MAX_PLAYERS_SAVED) continue;
        const e = (data.medals as Record<string, unknown>)[name];
        if (!isObj(e)) continue;
        const m = new Map<string, MedalTier>();
        for (const id of Object.keys(e)) {
          const t = (e as Record<string, unknown>)[id];
          if (BAD.has(id) || !missionById(id) || !isIn(MEDAL_TIERS, t)) continue;
          m.set(id, t);
        }
        if (m.size) { progress.set(name, m); n++; }
      }
    },
  };
};
