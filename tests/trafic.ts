// PROPRIÉTAIRE : game-camera-driving
// Suite « trafic » : 10 min simulées, pool, corps Rapier stables, VRef périmé, recyclage > 140 m, voitures garées, perf.
// Lancement : npx tsx tests/trafic.ts  (aucun réseau : Sim + systèmes directement)
import { GameBus, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { VEHICLE_POOL } from '../shared/constants';
import { Sim } from '../shared/sim';
import { createPeds } from '../server/systems/peds';
import { createTraffic, movingTarget, PARKED_GUARANTEE, PARKED_NEAR, TRAFFIC_MAX, type TrafficSystem } from '../server/systems/traffic';
import { parkingSlots, nearestLane, PARK_OFFSET } from '../shared/city/lanes';
import { CITY } from '../shared/city/layout';

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
  const dts: number[] = [];
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      const t0 = performance.now(); tr.preStep!(); const dt = performance.now() - t0;
      tTraffic += dt; if (dt > tMax) tMax = dt; dts.push(dt);
      sim.step(); peds.postStep?.(); tr.postStep?.();
    }
  };
  tick(60);
  const bodies0 = sim.world.bodies.len();
  const civilTypes = new Set(['citadine', 'berline', 'camionnette']);

  // ---- 10 minutes : vitesse moyenne, blocages, plafond ----
  let samples = 0, speedSum = 0, maxCount = 0, maxStill = 0, badPool = false, nanSeen = false;
  const still = new Map<string, number>();
  const damaged = new Set<string>();
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
      if (v.hp < v.def.maxHp) damaged.add(k);
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
  ok(damaged.size === 0, `aucun civil endommagé en 10 min (dépassement des voitures garées compris) : ${damaged.size}`);
  ok(!badPool, 'pool jamais dépassé');
  ok(!nanSeen, 'aucune vitesse invalide');
  ok(sim.world.bodies.len() === bodies0, `aucun corps retiré/ajouté (${bodies0} -> ${sim.world.bodies.len()})`);
  ok(!sim.broken, 'monde Rapier sain');
  const avgMs = tTraffic / (600 * 60 + 60);
  dts.sort((x, y) => x - y);
  const p999 = dts[Math.floor(dts.length * 0.999)], p99 = dts[Math.floor(dts.length * 0.99)];
  console.log(`info   : coût moyen ${avgMs.toFixed(3)} ms/pas, p99 ${p99.toFixed(3)}, p99,9 ${p999.toFixed(3)}, pire ${tMax.toFixed(2)} ms (le pire mesure surtout l'ordonnanceur de l'OS : voir tests/charge)`);
  ok(avgMs < 0.5, `coût moyen < 0,5 ms/pas (${avgMs.toFixed(3)})`);
  ok(p99 < 1, `p99 < 1 ms/pas (${p99.toFixed(3)}) : le travail est réparti, aucun pic d'apparition`);

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

  // ---- Formule de population ----
  ok([1, 2, 3, 4, 6].map(movingTarget).join() === '17,22,24,24,24', `population visée min(24, 12 + 5 × joueurs) : ${[1, 2, 3, 4, 6].map(movingTarget).join(', ')}`);
  ok(TRAFFIC_MAX <= (VEHICLE_POOL.citadine + VEHICLE_POOL.berline + VEHICLE_POOL.camionnette), `plafond ${TRAFFIC_MAX} <= pool civil`);

  // ---- Places de stationnement : décalage, cap, hors bâtiments ----
  {
    const slots = parkingSlots(city);
    const ids = new Set(slots.map((q) => q.id));
    ok(slots.length === city.edges.length * 2 && ids.size === slots.length, `une place de chaque côté de chaque tronçon, ids uniques (${slots.length})`);
    ok(slots.filter((q) => q.poi).length === city.poisOf('parking').length, `tous les POI parking sont des places (${slots.filter((q) => q.poi).length})`);
    const off = slots.map((q) => { const n = nearestLane(city, q.x, q.z, 6)!; return n; });
    const lateralOk = slots.every((q) => { const ax = (c: number) => Math.abs(((c + CITY.HALF) % CITY.CELL + CITY.CELL) % CITY.CELL); const a = ax(q.x), b = ax(q.z); const d = Math.min(a, CITY.CELL - a), e = Math.min(b, CITY.CELL - b); return Math.abs(Math.min(d, e) - PARK_OFFSET) < 1e-6; });
    ok(lateralOk, `chaque place est à ${PARK_OFFSET} m de l'axe de la rue (hors voie de droite : voie à 2 m, voiture 1,1 m de demi-largeur)`);
    ok(off.every((n, i) => n && Math.abs(Math.atan2(Math.sin(n.lane.yaw - slots[i].yaw), Math.cos(n.lane.yaw - slots[i].yaw))) < 1e-6), 'le cap de chaque place suit la voie voisine (nez dans le sens de circulation)');
    const inside = slots.filter((q) => city.buildings.some((b) => Math.abs(q.x - b.x) < b.w / 2 + 1.2 && Math.abs(q.z - b.z) < b.d / 2 + 1.2));
    ok(inside.length === 0, `aucune place dans un bâtiment (${inside.length})`);
  }

  // ---- 4 joueurs : 24 civils en mouvement, au moins 2 garées près de chacun, pool préservé ----
  {
    const sim4 = await Sim.create();
    const bus4 = new GameBus(); const sys4 = new Map<string, GameSystem>();
    const ctx4: GameCtx = { sim: sim4, bus: bus4, city, mode: 'solo', sendTo() {}, broadcast() {}, get: ((id: string) => sys4.get(id)) as GameCtx['get'] };
    const peds4 = createPeds(ctx4); sys4.set('peds', peds4);
    const tr4 = createTraffic(ctx4) as TrafficSystem; sys4.set('traffic', tr4);
    const spots: [number, number][] = [[-200, -200], [200, -200], [-200, 200], [200, 200]];
    spots.forEach(([x, z], i) => { sim4.addPlayer('p' + i, 'p' + i); sim4.players.get('p' + i)!.body.setTranslation({ x, y: 1, z }, true); });
    let minNear = 99, maxMoving = 0, maxTotal = 0, minFree = 99;
    for (let sec = 0; sec < 60; sec++) {
      for (let i = 0; i < 60; i++) { tr4.preStep!(); sim4.step(); peds4.postStep?.(); }
      if (sec >= 20) {
        for (const [x, z] of spots) minNear = Math.min(minNear, tr4.parkedNear(x, z, PARKED_NEAR));
        const c = tr4.counts; maxMoving = Math.max(maxMoving, c.moving); maxTotal = Math.max(maxTotal, c.moving + c.parked);
        minFree = Math.min(minFree, sim4.vehicles.filter((v) => v.pooled && civilTypes.has(v.def.type)).length);
      }
    }
    console.log(`info   : 4 joueurs : civils ${tr4.counts.moving}, garées ${tr4.counts.parked}, min garées à ${PARKED_NEAR} m d'un joueur ${minNear}, pool civil libre min ${minFree}`);
    const poolCivil = VEHICLE_POOL.citadine + VEHICLE_POOL.berline + VEHICLE_POOL.camionnette;
    const expected = Math.min(movingTarget(4), poolCivil - 2 - tr4.counts.parked - 3); // 2 voitures de départ, 3 emplacements de réserve
    ok(tr4.counts.moving >= expected - 3 && maxMoving <= 24, `4 joueurs : civils en mouvement = min(24, pool ${poolCivil} - 2 départ - ${tr4.counts.parked} garées - 3 réserve) = ${expected} (${tr4.counts.moving}, max ${maxMoving})`);
    ok(minNear >= PARKED_GUARANTEE, `au moins ${PARKED_GUARANTEE} voitures garées à moins de ${PARKED_NEAR} m de chaque joueur, en permanence (min ${minNear})`);
    ok(maxTotal <= TRAFFIC_MAX && minFree >= 2, `plafond total ${TRAFFIC_MAX} et pool civil jamais vidé (max ${maxTotal}, libre min ${minFree})`);
    ok(sim4.vehicles.filter((v) => !v.pooled && tr4.isParked(v)).every((v) => v.locked), 'toutes les garées sont verrouillées');
    ok(!sim4.broken, 'monde Rapier sain (4 joueurs)');
    sim4.dispose();
  }

  // ---- Garantie en marchant (téléportations) : 2 garées à moins de 90 m, déterministe ----
  {
    const spotsW: [number, number][] = [[0, 0], [-250, -90], [130, 260], [-60, 200], [280, -200], [-300, 300], [90, -140], [0, 150]];
    const found: string[] = [];
    for (const [x, z] of spotsW) {
      put(x, z);
      let t = 0, okN = false;
      while (t < 12 && !okN) { tick(30); t += 0.5; okN = tr.parkedNear(x, z, PARKED_NEAR) >= PARKED_GUARANTEE; }
      found.push(`${okN ? t.toFixed(1) : 'NON'}s`);
      if (!okN) ok(false, `garantie de stationnement en (${x}, ${z})`);
    }
    console.log(`info   : délai pour avoir 2 garées à < ${PARKED_NEAR} m après téléportation : ${found.join(' ')}`);
    ok(found.every((f) => f !== 'NONs'), 'garantie : 2 voitures garées à moins de 90 m après chaque téléportation (< 12 s)');
    const parkedNow = sim.vehicles.filter((v) => !v.pooled && tr.isParked(v));
    const axisDist = (c: number) => { const m = ((c + CITY.HALF) % CITY.CELL + CITY.CELL) % CITY.CELL; return Math.min(m, CITY.CELL - m); };
    ok(parkedNow.every((v) => { const t = v.behavior.body.translation(); return Math.abs(Math.min(axisDist(t.x), axisDist(t.z)) - PARK_OFFSET) < 0.4; }), `voitures garées à ${PARK_OFFSET} m de l'axe (contre le trottoir)`);
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
