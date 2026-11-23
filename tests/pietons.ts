// PROPRIÉTAIRE : game-missions
// Suite « pietons » : logique pure (rails, trottoirs, coins), perf, renversement, plafond, apparition/disparition.
// Lancement : npx tsx tests/pietons.ts  (aucun serveur réseau : Sim + système directement)
import { GameBus, type GameCtx, type GameSystem } from '../shared/game';
import { getCity, CITY } from '../shared/city/layout';
import { PED_KINDS, type PedKind } from '../shared/ids';
import { makeDealer, makePed, PED_ST, scarePed, stepPed, type PedState } from '../shared/peds';
import { PED_STRIDE } from '../shared/protocol';
import { STEP } from '../shared/constants';
import { Sim } from '../shared/sim';
import { createPeds, PEDS_HARD_CAP, PEDS_TARGET, type PedsSystem } from '../server/systems/peds';

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.log('ECHEC : ' + msg); } else console.log('ok     : ' + msg); };
const city = getCity();

const inBuilding = (x: number, z: number) => city.buildings.some((b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2);
const gridDist = (v: number) => { const m = (((v + CITY.HALF) % CITY.CELL) + CITY.CELL) % CITY.CELL; return Math.min(m, CITY.CELL - m); };
const onRoad = (x: number, z: number) => gridDist(x) < CITY.ROAD / 2 || gridDist(z) < CITY.ROAD / 2;
const inIntersection = (x: number, z: number) => gridDist(x) < CITY.ROAD / 2 && gridDist(z) < CITY.ROAD / 2;

// ---------- 1. Rails : jamais dans un bâtiment, jamais sur la chaussée sauf en traversée aux coins ----------
{
  const kinds: PedKind[] = ['passant', 'etudiant', 'flic', 'gang', 'passant', 'etudiant'];
  const list: PedState[] = [];
  for (let i = 0; i < 120; i++) list.push(makePed(i + 1, kinds[i % kinds.length], 99, city, (i * 37) % city.blocks.length));
  let bad = 0, onRoadBad = 0, crossings = 0, crossedOk = 0, nan = 0;
  for (let step = 0; step < 60 * 180; step++) {
    for (const p of list) {
      const wasCross = p.cross;
      stepPed(p, city, STEP);
      if (!Number.isFinite(p.x + p.z + p.yaw)) nan++;
      if (inBuilding(p.x, p.z)) bad++;
      if (p.cross) {
        if (!wasCross) crossings++;
        if (inIntersection(p.x, p.z)) onRoadBad++; // la traversée longe le passage piéton, pas le centre de la croisée
      } else if (onRoad(p.x, p.z)) onRoadBad++;
      if (wasCross && !p.cross) crossedOk++;
    }
    if (step === 60 * 90) for (const p of list) scarePed(p, city, p.x + 5, p.z, 5); // fuite en cours de route
  }
  ok(nan === 0, 'aucune coordonnée invalide');
  ok(bad === 0, `jamais dans un bâtiment (${bad} violations)`);
  ok(onRoadBad === 0, `jamais sur la chaussée hors traversée (${onRoadBad} violations)`);
  ok(crossings > 10 && crossedOk >= crossings - list.length, `les piétons traversent aux coins (${crossings} traversées, ${crossedOk} terminées)`);
  const d = makeDealer(1, 5, city, city.poisOf('dealer')[0].x, city.poisOf('dealer')[0].z, 0)!;
  const p0 = [d.x, d.z];
  for (let i = 0; i < 600; i++) stepPed(d, city, STEP);
  ok(Math.hypot(d.x - p0[0], d.z - p0[1]) < 0.01 && d.st === PED_ST.IDLE, 'le dealer reste immobile');
  ok(Math.hypot(d.x - city.poisOf('dealer')[0].x, d.z - city.poisOf('dealer')[0].z) < 1.5, 'le dealer est sur son POI');
  // déterminisme
  const a = makePed(7, 'etudiant', 5, city, 12), b = makePed(7, 'etudiant', 5, city, 12);
  for (let i = 0; i < 6000; i++) { stepPed(a, city, STEP); stepPed(b, city, STEP); }
  ok(a.x === b.x && a.z === b.z && a.st === b.st, 'déterministe à graine égale');
}

// ---------- Systèmes ----------
async function main() {
  const sim = await Sim.create();
  const bus = new GameBus();
  const systems = new Map<string, GameSystem>();
  const ctx: GameCtx = { sim, bus, city, mode: 'solo', sendTo() {}, broadcast() {}, get: ((id: string) => systems.get(id)) as GameCtx['get'] };
  const sys = createPeds(ctx) as PedsSystem;
  systems.set('peds', sys);
  const addPlayer = (id: string, x: number, z: number) => {
    sim.addPlayer(id, id);
    const p = sim.players.get(id)!;
    p.body.setTranslation({ x, y: 1, z }, true);
    return p;
  };
  const tickAll = (n: number) => { for (let i = 0; i < n; i++) { sim.step(); sys.postStep?.(); } };

  // ---- 2. Peuplement, plafond, perf ----
  const pl = [addPlayer('a', 0, 0), addPlayer('b', 100, 100), addPlayer('c', -100, 60), addPlayer('d', 60, -120)];
  void pl;
  tickAll(60 * 6);
  const n1 = sys.peds.length;
  ok(n1 > 0 && n1 <= PEDS_TARGET, `population ${n1} (cible ≤ ${PEDS_TARGET})`);
  ok(n1 === PEDS_TARGET, `80 piétons atteints avec 4 joueurs (${n1})`);
  let tot = 0;
  const N = 600;
  for (let i = 0; i < N; i++) { sim.step(); const t0 = performance.now(); sys.postStep?.(); tot += performance.now() - t0; }
  const avg = tot / N;
  ok(avg < 0.3, `80 piétons : ${avg.toFixed(3)} ms/pas en moyenne (< 0,3)`);
  ok(sys.peds.length <= PEDS_TARGET && sys.peds.length <= PEDS_HARD_CAP, `plafond respecté (${sys.peds.length})`);
  const flat = sys.pedsFlat!();
  ok(flat.length === sys.peds.length * PED_STRIDE && flat.every(Number.isFinite), `pedsFlat conforme (stride ${PED_STRIDE})`);
  ok(flat.every((v, i) => i % PED_STRIDE !== 1 || (v >= 0 && v < PED_KINDS.length && Number.isInteger(v))), 'kind valide dans pedsFlat');
  ok(sys.peds.every((p) => !inBuilding(p.x, p.z)), 'population du serveur : aucun piéton dans un bâtiment');
  const ser = JSON.stringify(sys.serialize!());
  ok(ser.length < 100, `serialize minimal (${ser})`);
  sys.restore!({ seed: 'x' });
  sys.restore!(JSON.parse('{"__proto__":{"a":1},"seed":77}'));
  sys.restore!(null);

  // ---- 3. Fuite devant un tir ----
  {
    const p = sys.peds.find((q) => q.kind !== 'flic' && q.st !== PED_ST.KNOCKED)!;
    bus.emit('crime', { kind: 'tir', by: sim.players.get('a')!, x: p.x + 3, z: p.z });
    ok(p.st === PED_ST.FLEE, 'un tir proche fait fuir');
  }

  // ---- 4. Renversement : une seule émission ----
  {
    const me = sim.players.get('a')!;
    const car = sim.acquireVehicle('citadine', -30, 2, -Math.PI / 2, { y: 0.6 });
    ok(!!car, 'véhicule du pool acquis');
    if (car) {
      sim.enterVehicle(me, car, 0);
      const ped = makePed(900001, 'flic', 1, city, 55);
      ped.x = -4; ped.z = 2; ped.st = PED_ST.IDLE; ped.timer = 1e9; // posé sur la chaussée devant la voiture
      (sys.peds as PedState[]).push(ped);
      const knocked: number[] = [];
      let crimes = 0;
      bus.on('pedKnocked', (e) => { if (e.pedId === ped.id) knocked.push(e.pedId); });
      bus.on('crime', (e) => { if (e.kind === 'pieton_renverse') crimes++; });
      for (let i = 0; i < 200; i++) {
        car.behavior.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
        sim.step();
        sys.postStep?.();
      }
      ok(knocked.length === 1, `pedKnocked émis exactement une fois (${knocked.length})`);
      ok(crimes === 1, `crime pieton_renverse émis une fois (${crimes})`);
      ok(ped.st === PED_ST.KNOCKED || ped.gone, 'le piéton est renversé');
      sim.leaveVehicle(me, true);
      sim.releaseVehicle(car);
    }
  }

  // ---- 5. Éloignés / rapprochés : réapparition autour des joueurs ----
  for (const id of ['b', 'c', 'd']) sim.removePlayer(id);
  const a = sim.players.get('a')!;
  a.body.setTranslation({ x: 250, y: 1, z: 250 }, true);
  tickAll(60 * 3);
  const pa = sim.playerPos(a);
  const dist = sys.peds.map((p) => Math.hypot(p.x - pa[0], p.z - pa[2]));
  ok(sys.peds.length > 20, `piétons réapparus autour du joueur téléporté (${sys.peds.length})`);
  ok(dist.every((d) => d <= 135), `aucun piéton au-delà de 135 m (max ${Math.max(...dist).toFixed(0)})`);
  const young = sys.peds.filter((p) => p.id > 900000 || p.id > 0);
  ok(young.length > 0, 'population renouvelée');
  // apparition : aucun piéton neuf à moins de 40 m (les nouveaux ids dépassent tous les anciens)
  tickAll(60 * 2);
  a.body.setTranslation({ x: -250, y: 1, z: -250 }, true);
  const before = new Set(sys.peds.map((p) => p.id));
  tickAll(60 * 3);
  const pb = sim.playerPos(a);
  const fresh = sys.peds.filter((p) => !before.has(p.id) && p.kind !== 'dealer');
  ok(fresh.length > 0 && fresh.every((p) => Math.hypot(p.x - pb[0], p.z - pb[2]) >= 39.5), `nouveaux piétons à ≥ 40 m (${fresh.length})`);
  ok(sys.peds.every((p) => before.has(p.id) ? true : Math.hypot(p.x - pb[0], p.z - pb[2]) <= 135), 'les nouveaux sont dans le rayon de 110 m');
  sim.removePlayer('a');
  tickAll(60);
  ok(sys.peds.length === 0, 'plus aucun joueur : plus de piétons');
}

main().then(() => {
  console.log(fails ? `\n${fails} échec(s)` : '\npietons : tout est vert');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
