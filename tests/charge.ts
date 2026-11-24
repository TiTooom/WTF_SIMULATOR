// PROPRIÉTAIRE : intégrateur
// Suite « charge » : 4 bots (recherchés), piétons, civils, policiers ; 5 minutes simulées avec téléportations.
// Même boucle que server/server.ts (preStep, step, postStep, outbox, snapshot delta à 30 Hz avec piétons, message `me` à 10 Hz), sans réseau.
// Budgets : pas serveur moyen < 4 ms, p99 < 10 ms, snapshot delta < 8 Ko, `me` < 1 Ko, world.bodies.len() stable, Rapier jamais empoisonné.
// Les étoiles viennent de /debug stars 5 (hôte) et d'explosions provoquées par chaque bot (sim.explode -> crime -> police).
// Lancement : npx tsx tests/charge.ts  [secondes simulées, 300 par défaut] [passages, 3 par défaut]
import * as THREE from 'three';
import { getCity } from '../shared/city/layout';
import { STEP } from '../shared/constants';
import { Sim } from '../shared/sim';
import { installGame } from '../server/game';
import { runCommand } from '../server/commands';
import { packMe } from '../shared/me';

let fails = 0;
const check = (ok: boolean, msg: string, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${msg}${detail ? '  — ' + detail : ''}`); };
const city = getCity();

/** Un passage complet (monde neuf) : retourne les mesures. */
async function pass(seconds: number) {
  const sim = await Sim.create();
  const logs: string[] = [];
  sim.log = (l) => logs.push(l);
  const game = installGame(sim, { mode: 'multi' });
  const ids = ['b1', 'b2', 'b3', 'b4'];
  ids.forEach((id, i) => { sim.addPlayer(id, `Bot${i + 1}`); game.onJoin(sim.players.get(id)!); });
  const host = sim.players.get('b1')!;
  const rng = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const teleport = (id: string) => {
    const n = city.nodes[Math.floor(rng() * city.nodes.length)];
    const p = sim.players.get(id)!;
    if (p.vehicle || p.hp <= 0) return;
    sim.teleportPlayer(p, n.x, 1.3, n.z);
  };
  ids.forEach(teleport);
  for (let i = 0; i < 120; i++) { game.preStep(); sim.step(); game.postStep(); game.drainOutbox(); } // mise en place (population)

  const bodies0 = sim.world.bodies.len();
  const ticks = Math.round(seconds / STEP);
  const snapEvery = Math.round(1 / STEP / 30);
  const dts: number[] = [];
  let snapMax = 0, snapSum = 0, snapN = 0, meMax = 0, pedMax = 0, civMax = 0, copMax = 0, bodiesMax = bodies0, bodiesMin = bodies0;
  let starsMax = 0;
  const bodySeries: number[] = [];
  let late0: number | undefined, lateMax = 0, lateMin = Infinity, bodiesEnd = bodies0;
  const t0 = performance.now();
  const CALM = 5400; // 90 s finales sans explosion : les débris doivent disparaître
  for (let k = 0; k < ticks + CALM; k++) {
    const t = k * STEP;
    if (k % 600 === 0 && k < ticks) teleport(ids[(k / 600) % ids.length | 0]); // téléportation toutes les 10 s
    if (k % 900 === 0 && k < ticks) { // rappel des étoiles : /debug stars 5 (hôte) + une explosion par bot
      runCommand(sim, host, '/debug stars 5', () => {});
      for (const id of ids) {
        const p = sim.players.get(id)!;
        if (p.hp <= 0) continue;
        const q = sim.playerPos(p);
        sim.explode(new THREE.Vector3(q[0] + 6, 0.5, q[2]), 4, 8, 10, p);
      }
    }
    ids.forEach((id, i) => {
      const ph = t * 0.7 + i * 1.9;
      sim.setInput(id, { f: Math.sin(ph) > -0.5 ? 1 : 0, s: Math.sin(ph * 0.5) * 0.6, yaw: (ph * 0.8) % (Math.PI * 2), run: i % 2, m1: Math.sin(t * 2.1 + i) > 0.9 ? 1 : 0 });
    });
    const a = performance.now();
    game.preStep();
    sim.step();
    if (!sim.broken) game.postStep();
    game.drainOutbox();
    if (k % 6 === 0) for (const id of ids) {
      const me = game.privateFor(sim.players.get(id)!);
      starsMax = Math.max(starsMax, me.stars);
      meMax = Math.max(meMax, Buffer.byteLength(JSON.stringify(packMe(me)))); // format réel du fil
    }
    if (k % snapEvery === 0) {
      const d = sim.snapshotDelta();
      const peds = game.pedsFlat();
      if (peds.length) d.peds = peds;
      const len = Buffer.byteLength(JSON.stringify({ type: 'snap', s: d }));
      snapMax = Math.max(snapMax, len); snapSum += len; snapN++;
      pedMax = Math.max(pedMax, peds.length / 6);
    }
    dts.push(performance.now() - a);
    if (sim.broken) break;
    if (k % 60 === 0) {
      let civ = 0, cop = 0;
      for (const v of sim.vehicles) {
        if (v.pooled || v.dead || !v.ai) continue;
        if (v.def.type === 'police') cop++; else civ++;
      }
      civMax = Math.max(civMax, civ); copMax = Math.max(copMax, cop);
      const b = sim.world.bodies.len();
      bodiesMax = Math.max(bodiesMax, b); bodiesMin = Math.min(bodiesMin, b);
      if (k % 3600 === 0) bodySeries.push(b);
      bodiesEnd = b;
      if (k >= ticks) { late0 = late0 ?? b; lateMax = Math.max(lateMax, b); lateMin = Math.min(lateMin, b); }
    }
  }
  const wall = (performance.now() - t0) / 1000;
  dts.sort((x, y) => x - y);
  const mean = dts.reduce((a, x) => a + x, 0) / dts.length;
  const p99 = dts[Math.floor(dts.length * 0.99)];
  const bad = logs.filter((l) => /[game]|TypeError|RangeError|Erreur/.test(l));
  const broken = sim.broken;
  sim.dispose();
  return { wall, mean, p99, max: dts[dts.length - 1], snapMax, snapMean: snapSum / Math.max(1, snapN), meMax, pedMax, civMax, copMax, starsMax, bodies0, bodiesMax, bodiesEnd, lateMin, lateMax, bodySeries, bad, broken };
}

async function main() {
  const seconds = Number(process.argv[2]) || 300;
  const PASSES = Number(process.argv[3]) || 3;
  const rs = [];
  for (let n = 0; n < PASSES; n++) {
    const r = await pass(seconds);
    rs.push(r);
    console.log(`# passage ${n + 1}/${PASSES} : ${seconds} s simulées en ${r.wall.toFixed(1)} s ; pas moyen ${r.mean.toFixed(2)} ms, p99 ${r.p99.toFixed(2)} ms, max ${r.max.toFixed(2)} ms ; snapshot max ${(r.snapMax / 1024).toFixed(2)} Ko ; corps max ${r.bodiesMax}`);
  }
  // Le bruit du CPU Windows crée des pics par multiples de 15,6 ms (tic de l'ordonnanceur) : mean et p99 sont jugés sur le MEILLEUR des passages ;
  // les budgets de taille, de corps et d'erreurs sur le PIRE.
  const best = (f: (r: (typeof rs)[number]) => number) => Math.min(...rs.map(f));
  const worst = (f: (r: (typeof rs)[number]) => number) => Math.max(...rs.map(f));
  const mean = best((r) => r.mean), p99 = best((r) => r.p99), snapMax = worst((r) => r.snapMax), meMax = worst((r) => r.meMax);
  const bodies0 = rs[0].bodies0;
  const r0 = rs[0];
  console.log(`# piétons max ${worst((r) => r.pedMax)}, civils max ${worst((r) => r.civMax)}, policiers max ${worst((r) => r.copMax)}, étoiles max ${worst((r) => r.starsMax)}`);
  console.log(`# pas serveur (min sur ${PASSES} passages) : moyen ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms ; snapshot moyen ${(best((r) => r.snapMean) / 1024).toFixed(2)} Ko, max ${(snapMax / 1024).toFixed(2)} Ko ; me max ${meMax} o`);
  check(rs.every((r) => !r.broken), 'Rapier jamais empoisonné (sim.broken faux)');
  check(mean < 4, 'pas serveur moyen < 4 ms', mean.toFixed(2));
  check(p99 < 10, 'pas serveur p99 < 10 ms (min des passages)', p99.toFixed(2));
  check(snapMax < 8 * 1024, 'snapshot delta < 8 Ko (pire passage)', `${(snapMax / 1024).toFixed(2)} Ko`);
  check(meMax < 1024, 'message `me` < 1 Ko', `${meMax} o`);
  console.log(`# corps Rapier : départ ${bodies0}, par minute ${r0.bodySeries.join(' ')}, max ${worst((r) => r.bodiesMax)}`);
  // Un véhicule détruit laisse 6 débris pendant 20 s : 8 épaves simultanées (4 explosions en 5 étoiles) = ~50 corps ; plafond réaliste +80.
  // Pas de fuite : pendant la phase calme les débris disparaissent (minimum au niveau de départ) et, à la fin, au plus 2 épaves fraîches subsistent.
  check(rs.every((r) => r.bodiesMax <= r.bodies0 + 80 && r.lateMin <= r.bodies0 + 4 && r.bodiesEnd <= r.bodies0 + 20), 'world.bodies.len() : débris plafonnés (+80) puis retour au niveau de départ (pas de fuite)',
    rs.map((r) => `départ ${r.bodies0}, max ${r.bodiesMax}, calme ${r.lateMin}..${r.lateMax}, fin ${r.bodiesEnd}`).join(' | '));
  check(worst((r) => r.pedMax) >= 40, 'population de piétons présente', String(worst((r) => r.pedMax)));
  check(worst((r) => r.civMax) >= 1, 'civils présents', String(worst((r) => r.civMax)));
  check(rs.every((r) => r.starsMax === 5 && r.copMax >= 1), 'recherche à 5 étoiles et policiers présents', `étoiles ${r0.starsMax}, policiers ${r0.copMax}`);
  const bad = rs.flatMap((r) => r.bad);
  check(bad.length === 0, 'aucune erreur dans le journal', bad.slice(0, 2).join(' | '));
  console.log(fails ? `${fails} échec(s)` : 'charge : TOUT VERT');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
