// PROPRIÉTAIRE : game-missions
// Suite « missions » : données des 5 missions, médailles (logique pure), chaque mission de bout en bout dans le harnais (Sim + vrais systèmes, entrées
// scriptées et téléportations), échec puis reprise au checkpoint, coop à 2-3 joueurs (départ, arrivée, mort), sauvegarde des médailles (restauration
// hostile comprise), activités taxi et justicier, messages `mission` hostiles, budget réseau.
// Lancement : npx tsx tests/missions.ts  (aucun serveur réseau : Sim + systèmes ; aucun port, aucune sauvegarde sur disque)
import { Sim } from '../shared/sim';
import { GameBus, parseGameMsg, type GameCtx, type GameSystem, type SystemFactory } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { hidingSpots } from '../shared/hiding';
import { DISTRICT_IDS, MEDAL_TIERS, type MedalTier } from '../shared/ids';
import { MISSIONS, missionById } from '../shared/missions';
import type { MissionDef } from '../shared/missions/types';
import { MEDAL_MULT, REPLAY_SHARE, accuracyOf, betterMedal, medalFor, rewardOf } from '../shared/missions/medals';
import { MISSION_VIGNETTES, hasVignettes, vignetteId } from '../shared/missions/vignettes';
import { ACTIVITIES, TAXI_LIVERY, justiceWave, taxiBudgetS, taxiFare, taxiTip } from '../shared/activities';
import { DIGI_COLS, desamorcageSpec, digicodePos, digicodeSpec, fouilleSpec, tournevisSpec } from '../shared/minigames/rules';
import type { GameServerEvent, PrivateState } from '../shared/protocol';
import type { SimPlayer } from '../shared/api';
import { createTraffic } from '../server/systems/traffic';
import { createPeds } from '../server/systems/peds';
import { createPolice, type PoliceSystem } from '../server/systems/police';
import { createEconomy, type EconomySystem } from '../server/systems/economy';
import { createMinigames } from '../server/systems/minigames';
import { createTheft } from '../server/systems/theft';
import { createMissions, type MissionsSystem, START_R, JOIN_R } from '../server/systems/missions';
import { createActivities, type ActivitiesSystem } from '../server/systems/activities';

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.log('ECHEC : ' + msg); } else console.log('ok     : ' + msg); };

// ---------- Mini-installateur (comme server/game.ts, mais avec accès aux systèmes) ----------
const LIGHT: SystemFactory[] = [createPolice, createEconomy, createMinigames, createTheft, createMissions, createActivities];
const FULL: SystemFactory[] = [createTraffic, createPeds, ...LIGHT];

async function boot(factories: SystemFactory[] = LIGHT, saved?: Record<string, unknown>) {
  const sim = await Sim.create();
  const logs: string[] = [];
  sim.log = (l) => logs.push(l);
  sim.onAnnounce = () => {};
  const bus = new GameBus();
  bus.onError = (e, err) => { fails++; console.log(`ECHEC : écouteur ${e} : ${(err as Error)?.stack ?? err}`); };
  const out: { to: string | null; ev: GameServerEvent }[] = [];
  const systems: GameSystem[] = [];
  const byId = new Map<string, GameSystem>();
  const ctx: GameCtx = {
    sim, bus, city: getCity(), mode: 'multi',
    sendTo: (to, ev) => out.push({ to, ev }), broadcast: (ev) => out.push({ to: null, ev }),
    get: ((id: string) => byId.get(id)) as GameCtx['get'],
  };
  for (const f of factories) { const s = f(ctx); systems.push(s); byId.set(s.id, s); }
  sim.hooks = {
    onInteract: (p) => { for (const s of systems) if (s.onInteract?.(p)) return true; return false; },
    canEnter: (p, v) => {
      const r = systems.map((s) => s.canEnter?.(p, v)).filter((x) => x !== undefined);
      return r.includes(false) ? false : r.includes(true) ? true : undefined;
    },
    onEnter: (p, v) => bus.emit('enteredVehicle', { p, v }),
    onVehicleDestroyed: (v, by) => bus.emit('vehicleDestroyed', { v, by }),
    onPlayerKilled: (p, by, cause) => bus.emit('playerDied', { p, by, cause }),
    onExplosion: (pos, by) => { if (by) bus.emit('crime', { kind: 'explosion', by, x: pos[0], z: pos[2] }); },
    onShot: (p, o) => bus.emit('crime', { kind: 'tir', by: p, x: o[0], z: o[2] }),
  };
  if (saved) for (const s of systems) if (s.restore && Object.prototype.hasOwnProperty.call(saved, s.id)) s.restore(saved[s.id]);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const s of systems) s.preStep?.();
      sim.step();
      for (const s of systems) s.postStep?.();
    }
  };
  const add = (id: string, name: string, x: number, z: number): SimPlayer => {
    sim.addPlayer(id, name);
    const p = sim.players.get(id)!;
    sim.teleportPlayer(p, x, 1.3, z);
    for (const s of systems) s.onJoin?.(p);
    return p;
  };
  const remove = (p: SimPlayer) => {
    for (const s of systems) s.onLeave?.(p);
    sim.removePlayer(p.id);
  };
  const msg = (p: SimPlayer, raw: unknown) => {
    const m = parseGameMsg(raw);
    if (m) for (const s of systems) s.onMessage?.(p, m);
    return m;
  };
  const priv = (p: SimPlayer): PrivateState => {
    const o: PrivateState = { money: 0, bag: {}, bagCap: 20, stars: 0, starProgress: 0, district: 'campus', marks: [], medals: {}, unread: 0 };
    for (const s of systems) s.privateView?.(p, o);
    return o;
  };
  const evs = (id: string, k?: string) => out.filter((e) => e.to === id && (!k || e.ev.k === k)).map((e) => e.ev);
  const missions = byId.get('missions') as MissionsSystem;
  const eco = byId.get('economy') as EconomySystem;
  const police = byId.get('police') as PoliceSystem;
  const acts = byId.get('activities') as ActivitiesSystem;
  return { sim, bus, out, systems, byId, ctx, logs, tick, add, remove, msg, priv, evs, missions, eco, police, acts };
}
type World = Awaited<ReturnType<typeof boot>>;

const city = getCity();
const poiOf = (id: string) => city.pois.find((p) => p.id === id)!;
const goGiver = (w: World, p: SimPlayer, def: MissionDef) => { const g = poiOf(def.giver); w.sim.teleportPlayer(p, g.x + 3, 1.3, g.z); w.tick(2); };
const money = (w: World, p: SimPlayer) => w.eco.moneyOf(p);
const lastOf = (w: World, id: string, k: string) => { const l = w.evs(id, k); return l[l.length - 1]; };
const missionEvents = (w: World, id: string) => w.evs(id, 'mission') as Extract<GameServerEvent, { k: 'mission' }>[];

/** Données de réussite d'un mini-jeu à partir de sa graine (client honnête). */
function honest(kind: string, seed: number, d: number): { data: number[]; ms: number } {
  switch (kind) {
    case 'tournevis': return { data: [tournevisSpec(seed, d).turns, 200], ms: 1500 };
    case 'court_circuit': return { data: [1000], ms: 1500 };
    case 'fouille': { const s = fouilleSpec(seed); return { data: [s.slot, s.swipes], ms: 1000 }; }
    case 'desamorcage': return { data: [desamorcageSpec(seed).wire], ms: 1000 };
    case 'digicode': {
      const s = digicodeSpec(seed, d);
      const stops: number[] = [];
      let t = 300;
      for (let i = 0; i < DIGI_COLS; i++) {
        while (Math.abs(digicodePos(s.cols[i], t) - s.cols[i].center) > s.cols[i].half * 0.5) t += 5;
        stops.push(t);
        t += 150;
      }
      return { data: stops, ms: Math.max(1200, stops[DIGI_COLS - 1] + 100) };
    }
    default: throw new Error('mini-jeu non géré par le test : ' + kind);
  }
}

/** Répond « honnêtement » au dernier mg_start du joueur (attend la durée plausible). */
function answerMinigame(w: World, p: SimPlayer, fail = false): boolean {
  const st = [...w.out].reverse().find((e) => e.to === p.id && e.ev.k === 'mg_start')?.ev as Extract<GameServerEvent, { k: 'mg_start' }> | undefined;
  if (!st) return false;
  const h = honest(st.s.kind, st.s.seed, st.s.difficulty);
  w.tick(Math.ceil((h.ms + 150) / 16.67));
  w.msg(p, { k: 'mg', r: { sid: st.s.sid, ok: !fail, ms: h.ms, data: h.data } });
  w.tick(3);
  return true;
}

const killPolice = (w: World, p: SimPlayer) => {
  let n = 0;
  for (const v of w.sim.vehicles) if (v.def.type === 'police' && !v.pooled && !v.dead && !v.driver) { w.sim.damageVehicle(v, 1e5, 'explosion', p); n++; }
  return n;
};

interface PlayOpts { realTheft?: boolean; stopAtStep?: number; extraWaitMs?: number; damage?: number }
/** Joue la mission avec des entrées scriptées jusqu'à la fin (ou `stopAtStep` atteint). Retourne le nombre d'itérations. */
function playMission(w: World, p: SimPlayer, def: MissionDef, o: PlayOpts = {}): void {
  let waited = false;
  for (let guard = 0; guard < 600; guard++) {
    const info = w.missions.inspect(p);
    if (!info) return;
    if (o.stopAtStep !== undefined && info.step >= o.stopAtStep) return;
    const st = def.steps[info.step];
    if (o.extraWaitMs && !waited) { waited = true; w.tick(Math.round(o.extraWaitMs / 16.67)); if (o.damage) { p.invulnUntil = 0; w.sim.damagePlayer(p, o.damage, null, 'generic'); } continue; }
    switch (st.t) {
      case 'aller':
        w.sim.teleportPlayer(p, st.x, 1.3, st.z);
        w.tick(8);
        break;
      case 'minijeu': {
        w.sim.teleportPlayer(p, st.x, 1.3, st.z);
        w.tick(5);
        if (!answerMinigame(w, p)) w.tick(30);
        break;
      }
      case 'voler': {
        const v = w.sim.resolveRef(info.targets[0]);
        if (!v) { w.tick(10); break; }
        const b = v.behavior.body;
        const t = b.translation();
        w.sim.teleportPlayer(p, t.x + 2, 1.3, t.z);
        if (o.realTheft) {
          w.tick(3);
          w.sim.interact(p.id);
          answerMinigame(w, p);
        } else {
          v.locked = false;
          w.sim.enterVehicle(p, v, 0, true);
        }
        w.tick(8);
        break;
      }
      case 'livrer': {
        if (info.car) {
          const v = w.sim.resolveRef(info.car);
          if (v) {
            if (p.vehicle !== v) w.sim.enterVehicle(p, v, 0, true);
            v.behavior.body.setTranslation({ x: st.x, y: 0.7, z: st.z }, true);
            v.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        } else w.sim.teleportPlayer(p, st.x, 1.3, st.z);
        w.tick(8);
        break;
      }
      case 'detruire': {
        if (st.target === 'police') { killPolice(w, p); w.tick(30); }
        else if (st.target === 'vehicule') {
          for (const r of info.targets) { const v = w.sim.resolveRef(r); if (v) w.sim.damageVehicle(v, 1e5, 'explosion', p); }
          w.tick(10);
        } else { w.bus.emit('cameraDestroyed', { by: p, id: 'cam_test' }); w.tick(10); }
        break;
      }
      case 'semer': { // semer la police : se cacher, hors de vue, jusqu'à ce que l'indice tombe
        if (!w.police.hiddenIn(p.id)) {
          const spots = hidingSpots(city);
          const sp = spots[(guard * 37) % spots.length];
          w.sim.teleportPlayer(p, sp.x, 1.3, sp.z);
          w.tick(3);
          w.sim.interact(p.id);
        }
        w.tick(120);
        break;
      }
      case 'attendre': w.tick(60); break;
    }
  }
  fails++;
  console.log(`ECHEC : la mission ${def.id} ne se termine pas (bloquée à l'étape ${w.missions.inspect(p)?.step})`);
}

// ---------- 1. Données et logique pure ----------
function dataTests() {
  ok(MISSIONS.length === 5 && new Set(MISSIONS.map((m) => m.district)).size === 5 && MISSIONS.every((m) => DISTRICT_IDS.includes(m.district)), '5 missions, une par quartier');
  ok(MISSIONS.every((m) => /^[a-z0-9_]{1,10}$/.test(m.id)) && new Set(MISSIONS.map((m) => m.id)).size === 5, 'identifiants courts et uniques');
  ok(MISSIONS.every((m) => { const g = city.pois.find((p) => p.id === m.giver); return !!g && g.kind === 'donneur' && g.district === m.district; }), 'chaque donneur est un POI `donneur` de son quartier');
  ok(MISSIONS.every((m, i) => !m.requires || MISSIONS.findIndex((q) => q.id === m.requires) >= 0 && MISSIONS.findIndex((q) => q.id === m.requires) < i) && !MISSIONS[0].requires, 'déblocage dans l\'ordre (requires)');
  const types = new Set(MISSIONS.flatMap((m) => m.steps.map((s) => s.t)));
  ok(['aller', 'livrer', 'voler', 'detruire', 'semer', 'minijeu', 'attendre'].every((t) => types.has(t as never)), 'les 7 types d\'étape sont utilisés');
  ok(MISSIONS.every((m) => m.steps.length >= 4 && m.steps.every((s) => s.text.length > 0 && s.text.length <= 42)), 'étapes : 4 à 5, textes ≤ 42 caractères (budget réseau)');
  ok(MISSIONS.every((m) => m.steps.every((s) => !('x' in s) || (Number.isFinite(s.x) && Math.abs(s.x) <= 320 && Math.abs(s.z) <= 320))), 'objectifs dans la ville');
  ok(MISSIONS.every((m) => m.steps.every((s) => s.t !== 'minijeu' || (s.r ?? 4) <= 5)), 'mini-jeux : rayon ≤ 5 m');
  ok(MISSIONS.every((m) => m.steps.every((s) => s.t !== 'livrer' || s.r >= 8)), 'livraison : rayon ≥ 8 m');
  ok(MISSIONS.every((m) => m.medals.or.ms < m.medals.argent.ms && m.medals.argent.ms < m.medals.bronze.ms
    && m.medals.or.maxDamage <= m.medals.argent.maxDamage && m.medals.argent.maxDamage <= m.medals.bronze.maxDamage
    && m.medals.or.minAccuracy >= m.medals.argent.minAccuracy && m.medals.argent.minAccuracy >= m.medals.bronze.minAccuracy), 'seuils de médailles cohérents (or plus exigeant que argent que bronze)');
  ok(MISSIONS.every((m) => m.reward > 0) && MISSIONS.every((m, i) => i === 0 || m.reward > MISSIONS[i - 1].reward), 'récompenses croissantes');
  ok(MISSIONS.every((m) => !m.timeLimitMs || m.timeLimitMs >= m.medals.bronze.ms) && MISSIONS.some((m) => m.timeLimitMs), 'une mission chronométrée (limite ≥ bronze)');
  ok(MISSIONS.every(hasVignettes), 'planches BD d\'intro et de fin pour chaque mission');
  const allPanels = Object.values(MISSION_VIGNETTES).flat();
  const imgs = ['ville_aube', 'rue_nuit', 'voiture', 'poursuite', 'ruelle', 'amphi', 'liasses', 'explosion'];
  ok(allPanels.every((pn) => imgs.includes(pn.img) && pn.text.length > 0 && pn.text.length < 200), 'planches : images connues, textes courts');
  const bannedWords = /sang|saign|cadavre|cocaïne|héroïne|crack/i;
  ok(allPanels.every((pn) => !bannedWords.test(pn.text)) && MISSIONS.every((m) => !bannedWords.test(m.name + (m.blurb ?? '') + m.steps.map((s) => s.text).join(' '))), 'aucun sang ni drogue réelle dans les textes');
  ok(vignetteId('x', 'intro') === 'm_x_intro' && !!missionById('golf') && !missionById('nope'), 'ids de planches, missionById');

  // médailles
  const m = missionById('annales')!;
  ok(medalFor(m, { ms: 100_000, damage: 0, accuracy: 1 }) === 'or', 'médaille d\'or : rapide, propre, précis');
  ok(medalFor(m, { ms: 200_000, damage: 0, accuracy: 1 }) === 'argent', 'trop lent pour l\'or : argent');
  ok(medalFor(m, { ms: 100_000, damage: 50, accuracy: 1 }) === 'argent', 'trop de dégâts pour l\'or : argent');
  ok(medalFor(m, { ms: 100_000, damage: 0, accuracy: 0.85 }) === 'argent', 'précision insuffisante pour l\'or : argent');
  ok(medalFor(m, { ms: 100_000, damage: 200, accuracy: 1 }) === 'bronze' && medalFor(m, { ms: 9e9, damage: 9e9, accuracy: 0 }) === 'bronze', 'terminer donne au moins le bronze');
  ok(medalFor(m, { ms: NaN, damage: NaN, accuracy: NaN }) === 'bronze', 'mesures absurdes : bronze');
  ok(accuracyOf({ steps: 4, kills: 0, mgOk: 1, mgFail: 0, shots: 0 }) === 1 && accuracyOf({ steps: 0, kills: 0, mgOk: 0, mgFail: 0, shots: 0 }) === 1, 'précision 1 sans raté');
  ok(accuracyOf({ steps: 4, kills: 0, mgOk: 1, mgFail: 5, shots: 0 }) === 0.5, 'les mini-jeux ratés baissent la précision');
  ok(accuracyOf({ steps: 4, kills: 2, mgOk: 0, mgFail: 0, shots: 10 }) === 1 && accuracyOf({ steps: 4, kills: 2, mgOk: 0, mgFail: 0, shots: 60 }) < 0.8, 'tirer dans le vide baisse la précision');
  ok(rewardOf(m, 'bronze', true) === m.reward && rewardOf(m, 'or', true) === Math.round(m.reward * MEDAL_MULT.or) && rewardOf(m, 'or', false) === Math.round(m.reward * MEDAL_MULT.or * REPLAY_SHARE), 'récompense : médaille et rejeu');
  ok(betterMedal('argent', 'bronze') === 'argent' && betterMedal(undefined, 'bronze') === 'bronze' && betterMedal('bronze', 'or') === 'or' && betterMedal(undefined, undefined) === undefined, 'betterMedal');

  // activités (pures)
  ok(ACTIVITIES.some((a) => a.kind === 'taxi' && a.vehicle === 'berline') && ACTIVITIES.some((a) => a.kind === 'justicier' && a.vehicle === 'police'), 'activités taxi (berline) et justicier (police)');
  const fare = taxiFare(300), bud = taxiBudgetS(300);
  ok(fare > taxiFare(100) && bud > taxiBudgetS(100) && taxiTip(fare, bud, 0) > taxiTip(fare, bud, bud / 2) && taxiTip(fare, bud, bud * 2) === 0 && taxiTip(fare, 0, 5) === 0 && taxiTip(fare, bud, NaN) === 0, 'taxi : tarif, budget, pourboire décroissant avec le temps');
  ok(justiceWave(0) === 2 && justiceWave(100) === 4 && justiceWave(-3) === 2, 'justicier : taille des vagues bornée');
}

// ---------- 2. Missions de bout en bout ----------
async function missionsTests() {
  const w = await boot();
  const base = new Set(w.sim.vehicles.filter((v) => !v.pooled).map((v) => v.id)); // voitures du monde de départ
  const p = w.add('p1', 'Alice', 0, 0);
  w.tick(200);

  // refus : trop loin du donneur, mission verrouillée
  w.msg(p, { k: 'mission', op: 'start', id: 'annales' });
  ok(!w.missions.inMission(p) && w.evs('p1', 'toast').length > 0, 'trop loin du donneur : refus avec un message');
  goGiver(w, p, MISSIONS[1]);
  w.msg(p, { k: 'mission', op: 'start', id: 'sardines' });
  ok(!w.missions.inMission(p), 'mission verrouillée (requires) : refusée');
  const far = poiOf(MISSIONS[0].giver);
  w.sim.teleportPlayer(p, far.x + START_R + 10, 1.3, far.z);
  w.tick(2);
  w.msg(p, { k: 'mission', op: 'start', id: 'annales' });
  ok(!w.missions.inMission(p), `à ${START_R + 10} m du donneur : refus`);
  ok(w.priv(p).marks.some((m) => m.k === 'donneur'), 'repère `donneur` affiché tant qu\'aucune mission n\'est lancée');

  let prevMoney = money(w, p);
  for (let i = 0; i < MISSIONS.length; i++) {
    const def = MISSIONS[i];
    goGiver(w, p, def);
    const t0 = w.out.length;
    w.msg(p, { k: 'mission', op: 'start', id: def.id });
    ok(w.missions.inMission(p), `${def.id} : lancée près du donneur`);
    const pv = w.priv(p);
    ok(pv.mission?.id === def.id && pv.mission.step === 1 && pv.mission.steps === def.steps.length && pv.mission.text.length > 0, `${def.id} : privateView.mission (étape 1/${def.steps.length})`);
    ok(w.out.slice(t0).some((e) => e.ev.k === 'vignettes' && e.ev.id === vignetteId(def.id, 'intro')) && w.out.slice(t0).some((e) => e.ev.k === 'mission' && e.ev.ev === 'start'), `${def.id} : vignettes d'intro et événement start`);
    // une 2e mission en cours est ignorée
    w.msg(p, { k: 'mission', op: 'start', id: MISSIONS[(i + 1) % 5].id });
    ok(w.missions.inspect(p)?.id === def.id, `${def.id} : démarrer une autre mission en pleine mission est ignoré`);
    playMission(w, p, def, { realTheft: i === 0 });
    ok(!w.missions.inMission(p), `${def.id} : terminée`);
    const done = lastOf(w, 'p1', 'mission') as Extract<GameServerEvent, { k: 'mission' }>;
    ok(done?.ev === 'done' && !!done.medal && (done.ms ?? 0) > 0, `${def.id} : événement done avec médaille (${done?.medal}) et temps (${((done?.ms ?? 0) / 1000).toFixed(0)} s)`);
    ok(missionEvents(w, 'p1').filter((e) => e.ev === 'checkpoint' && e.id === def.id).length >= def.steps.length - 1 - 0, `${def.id} : un checkpoint par étape validée`);
    ok(w.evs('p1', 'vignettes').some((e) => e.k === 'vignettes' && e.id === vignetteId(def.id, 'fin')), `${def.id} : vignettes de fin`);
    const gain = money(w, p) - prevMoney;
    prevMoney = money(w, p);
    ok(gain === rewardOf(def, done.medal as MedalTier, true), `${def.id} : récompense ${gain} € = ${def.reward} × médaille`);
    ok(w.priv(p).medals[def.id] === done.medal, `${def.id} : médaille dans privateView.medals`);
    ok(!w.priv(p).mission, `${def.id} : plus de mission dans privateView après la fin`);
  }
  ok(w.priv(p).medals.annales === 'or', 'mission 1 jouée vite et propre : médaille d\'or');

  // rejouer : meilleure médaille conservée, récompense réduite
  {
    const def = MISSIONS[0];
    goGiver(w, p, def);
    const before = money(w, p);
    w.msg(p, { k: 'mission', op: 'start', id: def.id });
    playMission(w, p, def, { extraWaitMs: 200_000 });
    const done = lastOf(w, 'p1', 'mission') as Extract<GameServerEvent, { k: 'mission' }>;
    ok(done.medal === 'argent', `rejeu lent (200 s) : médaille du jour argent (${done.medal})`);
    ok(w.priv(p).medals.annales === 'or', 'la meilleure médaille (or) est conservée');
    ok(money(w, p) - before === rewardOf(def, 'argent', false), `rejeu sans amélioration : ${money(w, p) - before} € (part réduite)`);
    // dégâts subis
    goGiver(w, p, def);
    w.msg(p, { k: 'mission', op: 'start', id: def.id });
    playMission(w, p, def, { extraWaitMs: 100, damage: 80 });
    const d2 = lastOf(w, 'p1', 'mission') as Extract<GameServerEvent, { k: 'mission' }>;
    ok(d2.medal === 'bronze', `80 points de dégâts subis : bronze (${d2.medal})`);
  }

  // temps limite (mission 5)
  {
    const def = MISSIONS[4];
    goGiver(w, p, def);
    w.msg(p, { k: 'mission', op: 'start', id: def.id });
    ok(w.priv(p).mission?.timeLimitMs === def.timeLimitMs, 'privateView.mission.timeLimitMs');
    w.tick(Math.round((def.timeLimitMs! + 3000) / 16.67));
    ok(!w.missions.inMission(p) && missionEvents(w, 'p1').some((e) => e.ev === 'fail' && /Temps/.test(e.text ?? '')), 'temps limite dépassé : échec « Temps écoulé »');
    ok(w.missions.retryOf(p) === def.id, 'l\'échec laisse une reprise disponible');
    w.msg(p, { k: 'mission', op: 'abort', id: def.id }); // sans mission : ignoré
  }

  // nettoyage : plus de véhicule de mission après un moment
  w.tick(60 * 70);
  const left = w.sim.vehicles.filter((v) => !v.pooled && v.def.type !== 'police' && !base.has(v.id));
  ok(left.length === 0, `véhicules de mission rangés (${left.length} restants)`);
  ok(w.logs.length === 0, `aucune erreur journalisée${w.logs.length ? ' : ' + w.logs[0] : ''}`);
}

// ---------- 3. Échec puis reprise au checkpoint ----------
async function retryTests() {
  const w = await boot();
  const p = w.add('p1', 'Bob', 0, 0);
  w.tick(200);
  w.missions.restore!({ v: 1, medals: { Bob: { annales: 'bronze', sardines: 'bronze' } } });
  const def = missionById('fromage')!;
  goGiver(w, p, def);
  w.msg(p, { k: 'mission', op: 'start', id: def.id });
  // voler la berline, livrer, puis mourir pendant l'attente (étape 2 : checkpoint après la livraison)
  playMission(w, p, def, { stopAtStep: 2 });
  w.tick(30);
  const info = w.missions.inspect(p)!;
  ok(info.step === 2 && info.cp.step === 2 && info.cp.ms > 0, `checkpoint à l'étape 3/5 (cp.step ${info.cp.step}, ${info.cp.ms.toFixed(0)} ms)`);
  w.tick(120);
  w.sim.damagePlayer(p, 1e4, null, 'generic');
  w.tick(3);
  ok(!w.missions.inMission(p), 'mort du seul joueur : mission échouée');
  ok(missionEvents(w, 'p1').some((e) => e.ev === 'fail' && e.id === 'fromage'), 'événement fail envoyé');
  ok(w.missions.retryOf(p) === 'fromage', 'reprise disponible');
  w.msg(p, { k: 'mission', op: 'retry', id: 'fromage' });
  ok(!w.missions.inMission(p), 'rejouer pendant que le joueur est mort : refusé');
  w.tick(60 * 5); // réapparition à l'hôpital
  ok(p.hp > 0, 'joueur relevé');
  w.msg(p, { k: 'mission', op: 'retry', id: 'sardines' });
  ok(!w.missions.inMission(p), 'rejouer une autre mission que celle qui a échoué : refusé');
  w.msg(p, { k: 'mission', op: 'retry', id: 'fromage' });
  const again = w.missions.inspect(p);
  ok(!!again && again.step === 2 && again.id === 'fromage', `reprise immédiate à l'étape ${again?.step} (checkpoint)`);
  ok(!!again && again.elapsed >= info.cp.ms - 50 && again.elapsed < info.cp.ms + 3000, `chronomètre repris au checkpoint (${again?.elapsed.toFixed(0)} ms ≥ ${info.cp.ms.toFixed(0)})`);
  const pos = w.sim.playerPos(p);
  ok(w.priv(p).mission?.step === 3, 'HUD : étape 3');
  void pos;
  playMission(w, p, def);
  ok(!w.missions.inMission(p) && (lastOf(w, 'p1', 'mission') as { ev: string }).ev === 'done', 'mission terminée après la reprise');
  ok(w.missions.retryOf(p) === null, 'plus de reprise après la réussite');

  // reprise AVEC la voiture : échec pendant la livraison (étape 1), la berline est recréée
  const def2 = missionById('fromage')!;
  goGiver(w, p, def2);
  w.msg(p, { k: 'mission', op: 'start', id: def2.id });
  playMission(w, p, def2, { stopAtStep: 1 });
  w.tick(10);
  ok(w.missions.inspect(p)?.step === 1 && !!w.missions.inspect(p)?.car, 'voiture volée en main, étape 2');
  const stolen = w.sim.resolveRef(w.missions.inspect(p)!.car);
  ok(!!stolen && stolen.def.type === 'berline', 'la voiture à livrer est une berline');
  w.sim.interact(p.id); // le joueur descend : la voiture explose sans lui
  w.tick(3);
  w.sim.damageVehicle(stolen!, 1e5, 'explosion', null);
  w.tick(6);
  ok(!w.missions.inMission(p) && missionEvents(w, 'p1').some((e) => e.ev === 'fail' && /hors service/.test(e.text ?? '')), 'voiture volée détruite : échec');
  w.tick(60 * 5);
  w.msg(p, { k: 'mission', op: 'retry', id: 'fromage' });
  const i3 = w.missions.inspect(p);
  ok(!!i3 && i3.step === 1 && !!i3.car, `reprise à l'étape 2 avec une voiture`);
  ok(p.vehicle?.def.type === 'berline' && w.sim.resolveRef(i3!.car) === p.vehicle, 'le joueur est au volant d\'une berline recréée');
  playMission(w, p, def2);
  ok(!w.missions.inMission(p), 'mission terminée après reprise avec voiture');
}

// ---------- 4. Coop ----------
async function coopTests() {
  const w = await boot();
  const def = MISSIONS[0];
  const g = poiOf(def.giver);
  const a = w.add('a', 'Alice', g.x + 2, g.z);
  const b = w.add('b', 'Bob', g.x + 8, g.z);
  const c = w.add('c', 'Chloé', g.x + JOIN_R + 25, g.z + 3);
  w.tick(200);
  for (const q of [a, b, c]) { w.sim.teleportPlayer(q, q === a ? g.x + 2 : q === b ? g.x + 8 : g.x + JOIN_R + 25, 1.3, g.z + (q === c ? 3 : 0)); }
  w.tick(3);
  w.msg(a, { k: 'mission', op: 'start', id: def.id });
  const ia = w.missions.inspect(a)!;
  ok(!!ia && ia.members.length === 2 && ia.members.includes('b') && !ia.members.includes('c'), `mission partagée avec les joueurs à moins de ${JOIN_R} m (membres : ${ia?.members.join(',')})`);
  ok(w.priv(b).mission?.id === def.id && !w.priv(c).mission, 'privateView : B voit la mission, C non');
  ok(ia.leader === 'a', 'le lanceur mène');
  // C arrive en pleine mission : trop loin -> refus ; proche du meneur -> rejoint
  w.msg(c, { k: 'mission', op: 'start', id: def.id });
  ok(!w.missions.inMission(c), 'C trop loin du meneur : ne rejoint pas');
  const st0 = def.steps[0];
  if (st0.t === 'aller') w.sim.teleportPlayer(a, st0.x, 1.3, st0.z);
  w.tick(10);
  ok(w.missions.inspect(b)?.step === 1, 'checkpoint partagé : l\'étape avance pour tout le groupe');
  ok(missionEvents(w, 'b').some((e) => e.ev === 'checkpoint') && missionEvents(w, 'a').some((e) => e.ev === 'checkpoint'), 'événement checkpoint reçu par A et B');
  w.sim.teleportPlayer(c, st0.x + 5, 1.3, st0.z + 2);
  w.sim.teleportPlayer(b, st0.x - 4, 1.3, st0.z);
  w.tick(3);
  w.msg(c, { k: 'mission', op: 'start', id: def.id });
  ok(w.missions.inMission(c) && w.missions.inspect(c)?.step === 1 && w.missions.inspect(a)!.members.length === 3, 'C arrive près du meneur en pleine mission : il rejoint à l\'étape en cours');
  // A part en pleine mission : meneur transféré
  w.remove(a);
  const ib = w.missions.inspect(b)!;
  ok(!!ib && ib.leader !== 'a' && ib.members.length === 2 && ib.step === 1, `départ du meneur : mission continue, meneur ${ib?.leader}`);
  ok(w.evs(ib.leader, 'toast').some((e) => e.k === 'toast' && /mènes/.test(e.text)), 'le nouveau meneur est prévenu');
  // mort d'un non-meneur : il sort, l'autre continue, il peut rejoindre
  const nonLeader = ib.leader === 'b' ? c : b;
  const leader = ib.leader === 'b' ? b : c;
  w.sim.damagePlayer(nonLeader, 1e4, null, 'generic');
  w.tick(4);
  ok(!w.missions.inMission(nonLeader) && w.missions.inMission(leader), 'un coéquipier K.O. sort de la mission, l\'autre continue');
  ok(w.missions.retryOf(nonLeader) === def.id, 'le coéquipier K.O. peut revenir');
  w.tick(60 * 5);
  w.msg(nonLeader, { k: 'mission', op: 'retry', id: def.id });
  ok(w.missions.inMission(nonLeader) && w.missions.inspect(nonLeader)!.members.length === 2, 'rejouer : il rejoint la mission en cours du meneur');
  const lp = w.sim.playerPos(leader), np = w.sim.playerPos(nonLeader);
  ok(Math.hypot(lp[0] - np[0], lp[2] - np[2]) < 6, 'et réapparaît à côté du meneur');
  // abandon d'un seul : l'autre continue
  w.msg(nonLeader, { k: 'mission', op: 'abort', id: def.id });
  ok(!w.missions.inMission(nonLeader) && w.missions.inMission(leader), 'abandon d\'un participant : le groupe continue');
  // fin : récompense et médaille par joueur
  const before = money(w, leader);
  playMission(w, leader, def);
  ok(!w.missions.inMission(leader) && money(w, leader) > before && !!w.priv(leader).medals[def.id], 'fin de mission : récompense et médaille du joueur restant');
  ok(w.logs.length === 0, 'coop : aucune erreur journalisée');

  // deux joueurs terminent ensemble : les deux ont récompense et médaille
  const g2 = poiOf(MISSIONS[0].giver);
  const x = w.add('x', 'Xavier', g2.x + 1, g2.z), y = w.add('y', 'Yann', g2.x + 5, g2.z + 1);
  w.tick(200);
  w.sim.teleportPlayer(x, g2.x + 1, 1.3, g2.z); w.sim.teleportPlayer(y, g2.x + 5, 1.3, g2.z + 1);
  w.tick(3);
  const mx = money(w, x), my = money(w, y);
  w.msg(x, { k: 'mission', op: 'start', id: def.id });
  ok(w.missions.inspect(y)?.members.length === 2, 'X et Y partent ensemble');
  playMission(w, x, def);
  ok(!w.missions.inMission(y) && money(w, x) > mx && money(w, y) > my && !!w.priv(x).medals.annales && !!w.priv(y).medals.annales, 'les deux joueurs touchent la récompense et la médaille');
}

// ---------- 5. Sauvegarde ----------
async function saveTests() {
  const w = await boot();
  const p = w.add('p1', 'Zoé', 0, 0);
  w.tick(100);
  const def = MISSIONS[0];
  goGiver(w, p, def);
  w.msg(p, { k: 'mission', op: 'start', id: def.id });
  playMission(w, p, def);
  const medal = w.priv(p).medals.annales;
  ok(!!medal, `médaille obtenue (${medal})`);
  const ser = JSON.parse(JSON.stringify(w.missions.serialize!()));
  ok(ser.medals?.Zoé?.annales === medal && JSON.stringify(ser).length < 400, `serialize : ${JSON.stringify(ser)}`);
  const w2 = await boot(LIGHT, { missions: ser });
  const p2 = w2.add('q', 'Zoé', 0, 0);
  const p3 = w2.add('r', 'Autre', 5, 5);
  ok(w2.priv(p2).medals.annales === medal && !w2.priv(p3).medals.annales, 'restauration : médailles par pseudo');
  goGiver(w2, p2, MISSIONS[1]);
  w2.msg(p2, { k: 'mission', op: 'start', id: 'sardines' });
  ok(w2.missions.inMission(p2), 'la mission suivante est débloquée après restauration');
  // restauration hostile
  const w3 = await boot();
  const sys = w3.missions;
  sys.restore!(null); sys.restore!(5); sys.restore!({ medals: 7 }); sys.restore!({ medals: [] });
  sys.restore!(JSON.parse('{"medals":{"__proto__":{"annales":"or"},"constructor":{"annales":"or"},"x":{"annales":"platine","__proto__":"or","golf":"or","nope":"or"},"y":5,"z":{"annales":"bronze"},"":{"annales":"or"}}}'));
  ok(({} as Record<string, unknown>).annales === undefined && ({} as Record<string, unknown>).golf === undefined, 'restauration hostile : prototype intact');
  const px = w3.add('i', 'x', 0, 0), pz = w3.add('j', 'z', 4, 4), pc = w3.add('k', 'constructor', 8, 8);
  ok(JSON.stringify(w3.priv(px).medals) === '{"golf":"or"}', 'clé valide gardée, médaille inconnue et identifiants inconnus ignorés');
  ok(JSON.stringify(w3.priv(pz).medals) === '{"annales":"bronze"}' && Object.keys(w3.priv(pc).medals).length === 0, 'pseudo dangereux ignoré, autres valides');
  const big: Record<string, unknown> = {};
  for (let i = 0; i < 500; i++) big['j' + i] = { annales: 'or' };
  sys.restore!({ medals: big });
  ok(((sys.serialize!() as { medals: object }).medals && Object.keys((sys.serialize!() as { medals: object }).medals).length) <= 64, 'restauration : au plus 64 joueurs');
}

// ---------- 6. Messages hostiles ----------
async function hostileTests() {
  ok(parseGameMsg({ k: 'mission', op: 'start', id: '../../etc' }) === null && parseGameMsg({ k: 'mission', op: 'hack', id: 'annales' }) === null
    && parseGameMsg(JSON.parse('{"k":"mission","op":"start","id":"annales","__proto__":{"x":1}}')) === null && parseGameMsg({ k: 'mission', op: 'start', id: 5 }) === null
    && parseGameMsg({ k: 'mission', op: 'start', id: 'a'.repeat(80) }) === null, 'parseGameMsg : messages mission malformés refusés');
  const w = await boot();
  const base = new Set(w.sim.vehicles.filter((v) => !v.pooled).map((v) => v.id));
  const p = w.add('p1', 'Mallory', 0, 0);
  w.tick(200);
  const bad: unknown[] = [
    { k: 'mission', op: 'start', id: 'zzz' }, { k: 'mission', op: 'retry', id: 'annales' }, { k: 'mission', op: 'abort', id: 'annales' },
    { k: 'mission', op: 'start', id: 'golf' }, { k: 'mission', op: 'start', id: '__proto__' }, { k: 'mission', op: 'start' }, null, 5, 'mission',
    { k: 'mission', op: 'start', id: 'constructor' }, { k: 'mission', op: 'retry', id: 'toString' },
  ];
  for (const m of bad) w.msg(p, m);
  w.tick(30);
  ok(!w.missions.inMission(p) && w.missions.retryOf(p) === null && w.logs.length === 0, 'messages hostiles : aucun effet, aucune erreur');
  // mort : impossible de lancer
  goGiver(w, p, MISSIONS[0]);
  w.sim.damagePlayer(p, 1e4, null, 'generic');
  w.tick(2);
  w.msg(p, { k: 'mission', op: 'start', id: 'annales' });
  ok(!w.missions.inMission(p), 'un joueur mort ne peut pas lancer de mission');
  w.tick(60 * 5);
  // spam de start/abort : un seul run, aucune fuite
  goGiver(w, p, MISSIONS[0]);
  for (let i = 0; i < 50; i++) { w.msg(p, { k: 'mission', op: 'start', id: 'annales' }); if (i % 7 === 0) w.msg(p, { k: 'mission', op: 'abort', id: 'annales' }); w.tick(1); }
  ok(w.logs.length === 0, 'spam start/abort : aucune erreur');
  w.msg(p, { k: 'mission', op: 'abort', id: 'annales' });
  w.tick(60 * 70);
  ok(w.sim.vehicles.every((v) => v.pooled || base.has(v.id)), 'après abandons répétés : tous les véhicules sont rangés');
  // budget réseau
  goGiver(w, p, MISSIONS[1]);
  w.missions.restore!({ medals: { Mallory: { annales: 'or' } } });
  w.msg(p, { k: 'mission', op: 'start', id: 'sardines' });
  const pv = w.priv(p);
  const size = JSON.stringify({ mission: pv.mission, medals: pv.medals, marks: pv.marks }).length;
  ok(!!pv.mission && JSON.stringify(pv.mission).length <= 150 && pv.marks.length <= 2, `budget réseau : mission ${JSON.stringify(pv.mission).length} o, ${pv.marks.length} repère(s), total ${size} o`);
  const allDone = Object.fromEntries(MISSIONS.map((m) => [m.id, 'or']));
  w.missions.restore!({ medals: { Mallory: allDone } });
  ok(JSON.stringify(w.priv(p).medals).length <= 100, `medals (5 entrées) ${JSON.stringify(w.priv(p).medals).length} o`);
}

// ---------- 7. Activités ----------
async function activityTests() {
  const w = await boot();
  const base = new Set(w.sim.vehicles.filter((v) => !v.pooled).map((v) => v.id));
  const p = w.add('p1', 'Taxi', 0, 0);
  w.tick(200);
  const press = () => { w.sim.setInput('p1', { act: 1 }); w.tick(2); w.sim.setInput('p1', { act: 0 }); w.tick(2); };

  // mauvaise voiture : rien
  const cit = w.sim.acquireVehicle('citadine', 0, 20, 0)!;
  w.sim.enterVehicle(p, cit, 0, true);
  press();
  ok(!w.acts.inspect(p) && !w.priv(p).activity, 'citadine : pas d\'activité (toast d\'aide)');
  w.sim.interact(p.id);
  w.sim.releaseVehicle(cit);
  w.tick(5);

  // taxi
  const cab = w.sim.acquireVehicle('berline', 0, 30, 0, { livery: TAXI_LIVERY, y: 0.7 })!;
  const plain = w.sim.acquireVehicle('berline', 20, 30, 0, { y: 0.7 })!;
  w.tick(30);
  w.sim.enterVehicle(p, plain, 0, true);
  press();
  ok(!w.acts.inspect(p), 'berline sans livrée de taxi : pas de taxi');
  w.sim.interact(p.id);
  w.sim.enterVehicle(p, cab, 0, true);
  press();
  let s = w.acts.inspect(p);
  ok(s?.kind === 'taxi' && s.phase === 'pickup' && !!s.target, 'taxi : touche d\'activité dans une berline de livrée 1 -> course démarrée');
  ok(w.priv(p).activity?.kind === 'taxi' && /client/.test(w.priv(p).activity!.text) && w.priv(p).marks.some((m) => m.k === 'cible'), 'privateView.activity + repère du client');
  ok(w.priv(p).activity!.text.length <= 40, 'texte d\'activité compact');
  const moveCab = (x: number, z: number) => { cab.behavior.body.setTranslation({ x, y: 0.7, z }, true); cab.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };
  const m0 = money(w, p);
  w.tick(30);
  ok(w.acts.inspect(p)?.phase === 'pickup', 'le client attend : pas de prise en charge à distance');
  moveCab(s!.target!.x, s!.target!.z);
  w.tick(90);
  s = w.acts.inspect(p);
  ok(s?.phase === 'ride', 'client pris en charge (arrêt 1 s sur le marqueur)');
  const drop = s!.target!;
  ok(w.priv(p).activity!.text.startsWith('Dépose'), 'HUD : dépose le client');
  moveCab(drop.x, drop.z);
  w.tick(30);
  ok(money(w, p) > m0 && (w.acts.inspect(p)?.score ?? 0) > 0, `course payée avec pourboire (+${money(w, p) - m0} €)`);
  ok(w.acts.inspect(p)?.phase === 'pickup', 'une nouvelle course est proposée');
  // client trop lent
  const t0 = money(w, p);
  s = w.acts.inspect(p)!;
  moveCab(s.target!.x, s.target!.z); w.tick(90);
  s = w.acts.inspect(p)!;
  w.tick(Math.round((taxiBudgetS(1000) * 3) * 60)); // bien au-delà du temps accordé
  ok(w.acts.inspect(p)?.phase === 'pickup' && money(w, p) === t0, 'client parti sans payer si on le fait trop attendre');
  // arrêt
  press();
  ok(!w.acts.inspect(p) && !w.priv(p).activity, 'nouvelle pression : fin du service');
  press();
  ok(!!w.acts.inspect(p), 'redémarre');
  w.sim.interact(p.id); // sort de la voiture
  w.tick(8);
  ok(!w.acts.inspect(p), 'sortir du taxi termine l\'activité');
  w.sim.releaseVehicle(cab); w.sim.releaseVehicle(plain);

  // justicier
  const cop = w.sim.acquireVehicle('police', 0, 60, 0, { y: 0.7 })!;
  w.tick(30);
  w.sim.enterVehicle(p, cop, 0, true);
  w.police.setStars('p1', 2);
  press();
  ok(w.acts.inspect(p)?.kind === 'justicier', 'justicier : touche dans une voiture de police');
  w.tick(150);
  let j = w.acts.inspect(p)!;
  ok(j.crims.length >= 2 && w.priv(p).marks.filter((m) => m.label === 'fuyard').length >= 2 && /Fuyards/.test(w.priv(p).activity!.text), `fuyards apparus (${j.crims.length}) avec repères`);
  ok(w.priv(p).marks.filter((m) => m.k === 'cible').length <= 3, 'au plus 3 repères de fuyards');
  // ils bougent
  const p0 = j.crims.map((c) => [c.x, c.z]);
  w.tick(180);
  j = w.acts.inspect(p)!;
  ok(j.crims.some((c, i) => p0[i] && Math.hypot(c.x - p0[i][0], c.z - p0[i][1]) > 15), 'les fuyards roulent');
  // détruire un fuyard : gain + baisse d'étoile
  const before = money(w, p);
  const stars0 = w.police.starsOf('p1');
  const v1 = w.sim.resolveRef(j.crims[0].ref)!;
  w.sim.damageVehicle(v1, 1e5, 'explosion', p);
  w.tick(20);
  ok(money(w, p) - before === 150, `fuyard détruit : +${money(w, p) - before} €`);
  ok(w.police.starsOf('p1') === Math.max(0, stars0 - 1), `l'indice baisse (${stars0} -> ${w.police.starsOf('p1')})`);
  // rattraper l'autre : rester collé 2 s
  const b2 = money(w, p);
  for (let i = 0; i < 200; i++) {
    const jj = w.acts.inspect(p);
    const c = jj?.crims[0];
    const v = c && w.sim.resolveRef(c.ref);
    if (v) { const t = v.behavior.body.translation(); cop.behavior.body.setTranslation({ x: t.x + 3, y: 0.7, z: t.z }, true); cop.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    w.tick(3);
    if (money(w, p) > b2) break;
  }
  ok(money(w, p) - b2 === 100, `fuyard rattrapé : +${money(w, p) - b2} €`);
  w.tick(300);
  ok((w.acts.inspect(p)?.score ?? 0) >= 250, `score cumulé ${w.acts.inspect(p)?.score}`);
  // en mission : refusé
  ok(w.acts.stop(p), 'stop() termine la session');
  w.sim.interact(p.id);
  w.sim.releaseVehicle(cop);
  w.tick(10);
  const def = MISSIONS[0];
  goGiver(w, p, def);
  w.msg(p, { k: 'mission', op: 'start', id: def.id });
  const cab2 = w.sim.acquireVehicle('berline', 0, 30, 0, { livery: TAXI_LIVERY, y: 0.7 })!;
  w.tick(20);
  w.sim.enterVehicle(p, cab2, 0, true);
  press();
  ok(!w.acts.inspect(p), 'pas d\'activité annexe pendant une mission');
  // fuyards rangés à la fin
  w.sim.interact(p.id);
  w.msg(p, { k: 'mission', op: 'abort', id: def.id });
  w.sim.releaseVehicle(cab2);
  w.tick(60 * 70);
  ok(w.sim.vehicles.every((v) => v.pooled || base.has(v.id) || v.def.type === 'police'), 'aucun véhicule d\'activité ne reste hors du pool');
  ok(w.logs.length === 0, `activités : aucune erreur journalisée${w.logs.length ? ' : ' + w.logs[0] : ''}`);
}

// ---------- 8. Intégration avec trafic et piétons ----------
async function fullTests() {
  const w = await boot(FULL);
  const p = w.add('p1', 'Intégral', 0, 0);
  w.tick(300);
  const def = MISSIONS[0];
  goGiver(w, p, def);
  w.tick(120);
  w.msg(p, { k: 'mission', op: 'start', id: def.id });
  ok(w.missions.inMission(p), 'avec trafic et piétons : mission lancée');
  const t0 = performance.now();
  playMission(w, p, def, { realTheft: true });
  ok(!w.missions.inMission(p) && (lastOf(w, 'p1', 'mission') as { ev: string }).ev === 'done', `avec trafic et piétons : mission 1 terminée (${(performance.now() - t0).toFixed(0)} ms réels)`);
  w.tick(60 * 70);
  ok(w.logs.length === 0, `intégration : aucune erreur journalisée${w.logs.length ? ' : ' + w.logs[0] : ''}`);
}

async function main() {
  dataTests();
  await missionsTests();
  await retryTests();
  await coopTests();
  await saveTests();
  await hostileTests();
  await activityTests();
  await fullTests();
  void MEDAL_TIERS;
}

main().then(() => {
  console.log(fails ? `\n${fails} échec(s)` : '\nmissions : tout est vert');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });

