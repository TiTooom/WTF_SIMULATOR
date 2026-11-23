// PROPRIÉTAIRE : game-camera-driving
// Suite « trafic » : 10 min simulées, pool, corps Rapier stables, VRef périmé, recyclage > 140 m, voitures garées, perf.
// Lancement : npx tsx tests/trafic.ts  (aucun réseau : Sim + systèmes directement)
import { GameBus, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { VEHICLE_POOL } from '../shared/constants';
import { Sim } from '../shared/sim';
import { createPeds } from '../server/systems/peds';
import { createTraffic, TRAFFIC_MAX, type TrafficSystem } from '../server/systems/traffic';

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.log('ECHEC : ' + msg); } else console.log('ok     : ' + msg); };

async function main() {
  const city = getCity();
  const sim = await Sim.create();
  const bus = new GameBus();
  const systems = new Map<string, GameSystem>();
  const ctx: GameCtx = { sim, bus, city, mode: 'solo', sendTo() {}, broadcast() {}, get: ((id: string) => systems.get(id)) as GameCtx['get'] };
  const peds = createPeds(ctx); systems.set('peds', peds);
  const tr = createTraffic(ctx) as TrafficSystem; systems.set('traffic', tr);
  sim.addPlayer('a', 'a');
  const a = sim.players.get('a')!;
  const put = (x: number, z: number) => a.body.setTranslation({ x, y: 1, z }, true);
  put(0, 0);
  let tTraffic = 0, tMax = 0;
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      const t0 = performance.now(); tr.preStep!(); const dt = performance.now() - t0;
      tTraffic += dt; if (dt > tMax) tMax = dt;
      sim.step(); peds.postStep?.(); tr.postStep?.();
    }
  };
  tick(60);
  const bodies0 = sim.world.bodies.len();
  const civilTypes = new Set(['citadine', 'berline', 'camionnette']);

  // ---- 10 minutes : vitesse moyenne, blocages, plafond ----
  let samples = 0, speedSum = 0, maxCount = 0, maxStill = 0, badPool = false, nanSeen = false;
  const still = new Map<string, number>();
  const TOTAL = 60 * 600;
  let ticks = 0;
  for (let sec = 0; sec < 600; sec++) {
    if (sec === 200) put(150, -120);
    if (sec === 400) put(-180, 140);
    tick(60); ticks += 60;
    const live: Record<string, number> = {};
    for (const v of sim.vehicles) if (!v.pooled) live[v.def.type] = (live[v.def.type] ?? 0) + 1;
    for (const [t, n] of Object.entries(live)) if (n > ((VEHICLE_POOL as Record<string, number>)[t] ?? 0)) badPool = true;
    const c = tr.counts; maxCount = Math.max(maxCount, c.moving + c.parked);
    for (const v of sim.vehicles) {
      if (v.pooled || v.dead || !tr.isCivil(v)) continue;
      const lv = v.behavior.body.linvel();
      const sp = Math.hypot(lv.x, lv.z);
      if (!Number.isFinite(sp)) nanSeen = true;
      speedSum += sp; samples++;
      const k = v.id + ':' + v.gen;
      const s = sp < 0.5 ? (still.get(k) ?? 0) + 1 : 0;
      still.set(k, s); maxStill = Math.max(maxStill, s);
    }
  }
  void TOTAL; void ticks;
  const avg = speedSum / Math.max(1, samples);
  console.log(`info   : ${samples} échantillons, vitesse moyenne ${avg.toFixed(1)} m/s, arrêt max ${maxStill} s, max ${maxCount} voitures`);
  ok(samples > 2000, `trafic présent pendant 10 min (${samples} échantillons)`);
  ok(avg > 5, `vitesse moyenne > 5 m/s (${avg.toFixed(1)})`);
  ok(maxStill <= 30, `aucun civil immobile plus de 30 s (${maxStill} s)`);
  ok(maxCount <= TRAFFIC_MAX, `plafond ${TRAFFIC_MAX} respecté (max ${maxCount})`);
  ok(!badPool, 'pool jamais dépassé');
  ok(!nanSeen, 'aucune vitesse invalide');
  ok(sim.world.bodies.len() === bodies0, `aucun corps retiré/ajouté (${bodies0} -> ${sim.world.bodies.len()})`);
  ok(!sim.broken, 'monde Rapier sain');
  const avgMs = tTraffic / (600 * 60 + 60);
  console.log(`info   : coût moyen ${avgMs.toFixed(3)} ms/pas, pire ${tMax.toFixed(2)} ms`);
  ok(avgMs < 1, `coût < 1 ms/pas (${avgMs.toFixed(3)})`);

  // ---- Types civils uniquement ----
  ok(sim.vehicles.filter((v) => !v.pooled && tr.isCivil(v)).every((v) => civilTypes.has(v.def.type)), 'civils : citadine/berline/camionnette seulement');

  // ---- VRef périmé ----
  {
    const v = sim.vehicles.find((q) => !q.pooled && tr.isCivil(q));
    ok(!!v, 'un civil en circulation');
    if (v) {
      const ref = sim.refOf(v);
      ok(sim.resolveRef(ref) === v, 'VRef valide tant que le civil est là');
      sim.releaseVehicle(v);
      ok(sim.resolveRef(ref) === null, 'VRef périmé -> null après recyclage');
      tick(120);
      ok(sim.resolveRef(ref) === null && !sim.broken, 'le trafic oublie un civil recyclé sans erreur');
    }
  }

  // ---- Civils à > 140 m recyclés ----
  {
    put(-300, -300);
    tick(60 * 3);
    ok(!sim.broken, 'monde sain après téléportation');
    const p = sim.playerPos(a);
    let far = 0;
    for (const v of sim.vehicles) {
      if (v.pooled || v.dead || !(tr.isCivil(v) || tr.isParked(v))) continue;
      const t = v.behavior.body.translation();
      if (Math.hypot(t.x - p[0], t.z - p[2]) > 145) far++;
    }
    ok(far === 0, `aucun civil à > 145 m du joueur après 3 s (${far})`);
    ok(tr.counts.moving > 0, `le trafic réapparaît autour du joueur (${tr.counts.moving})`);
  }

  // ---- Voitures garées ----
  {
    const pois = city.poisOf('parking');
    const poi = pois[0];
    put(Math.max(-310, Math.min(310, poi.x + 90)), poi.z); // dans la zone d'apparition des garées
    let found = false;
    for (let i = 0; i < 40 && !found; i++) { tick(90); found = tr.counts.parked > 0; }
    ok(found, 'des voitures garées apparaissent');
    tick(120);
    const list = sim.vehicles.filter((v) => !v.pooled && tr.isParked(v));
    const gens = list.map((v) => v.gen);
    const before = list.map((v) => { const t = v.behavior.body.translation(); return [t.x, t.z]; });
    tick(60 * 15);
    let moved = 0, unlocked = 0;
    list.forEach((v, i) => {
      if (!tr.isParked(v) || v.gen !== gens[i]) return; // recyclée (trop loin) : sans objet
      const t = v.behavior.body.translation();
      const dd = Math.hypot(t.x - before[i][0], t.z - before[i][1]); if (dd > 0.6) { moved++; console.log('info   : garée déplacée de', dd.toFixed(2), 'm, civils proches :', sim.vehicles.filter((q) => !q.pooled && tr.isCivil(q) && Math.hypot(q.behavior.body.translation().x - t.x, q.behavior.body.translation().z - t.z) < 15).length); }
      if (!v.locked) unlocked++;
    });
    ok(list.length > 0 && list.every((v) => v.ai === null), `voitures garées sans pilote automatique (${list.length})`);
    ok(unlocked === 0, 'voitures garées verrouillées');
    ok(moved === 0, `voitures garées immobiles (${moved} déplacées)`);
    const taxi = sim.vehicles.some((v) => !v.pooled && tr.isParked(v) && v.livery === 1);
    console.log(`info   : taxi garé présent : ${taxi}`);
    const t = list.find((v) => tr.isParked(v));
    if (t) {
      ok(tr.unlock(t) && !t.locked, 'unlock(v) déverrouille une voiture garée');
      const other = sim.vehicles.find((v) => !v.pooled && !tr.isParked(v));
      ok(!other || tr.unlock(other) === false, 'unlock(v) ignore un véhicule hors trafic');
      sim.enterVehicle(a, t, 0);
      tick(120);
      ok(!tr.isParked(t) && !tr.isCivil(t), 'un véhicule volé sort du trafic');
      sim.leaveVehicle(a, true);
      tick(60);
      ok(t.ai === null, 'véhicule volé sans pilote automatique résiduel');
    }
  }

  // ---- Fuite après un tir ----
  {
    put(0, 0);
    tick(60 * 10);
    const v = sim.vehicles.find((q) => !q.pooled && tr.isCivil(q));
    if (v) {
      const t = v.behavior.body.translation();
      bus.emit('crime', { kind: 'tir', by: a, x: t.x + 3, z: t.z });
      tick(90);
      ok(!sim.broken, 'fuite sans erreur');
    }
  }

  // ---- Sérialisation ----
  const ser = JSON.stringify(tr.serialize!());
  ok(ser.length < 60, `serialize minimal (${ser})`);
  tr.restore!(null); tr.restore!({ seed: 'x' }); tr.restore!(JSON.parse('{"__proto__":{"a":1},"seed":77}'));
  tick(60);
  ok(!sim.broken, 'restore robuste');
}

main().then(() => {
  console.log(fails ? `\n${fails} échec(s)` : '\ntrafic : tout est vert');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
