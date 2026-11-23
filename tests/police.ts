// PROPRIÉTAIRE : game-missions
// Suite « police » : étoiles (logique pure), piéton renversé, destruction de voitures de police, arrestation, mort, pool ≤ 10, VRef, /debug stars.
// Lancement : npx tsx tests/police.ts  (aucun serveur réseau : Sim + systèmes directement)
import { GameBus, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { makePed, PED_ST } from '../shared/peds';
import type { GameServerEvent } from '../shared/protocol';
import { Sim } from '../shared/sim';
import { VEHICLE_POOL } from '../shared/constants';
import {
  addCrime, copDestroyed, copsWanted, COPS_PER_STAR_DROP, CRIME_HEAT, heatOfStars, newWanted, starProgress, starsOf, tickWanted, UNSEEN_DELAY_S, BUST_MONEY_LOSS,
} from '../shared/wanted';
import { CRIME_KINDS } from '../shared/ids';
import { createPeds, type PedsSystem } from '../server/systems/peds';
import { createPolice, POLICE_POOL_MAX, type PoliceSystem } from '../server/systems/police';
import type { PrivateState } from '../shared/protocol';

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.log('ECHEC : ' + msg); } else console.log('ok     : ' + msg); };
const city = getCity();

// ---------- 1. Logique pure ----------
{
  ok(CRIME_KINDS.every((k) => k === 'flic_detruit' ? CRIME_HEAT[k] === 0 : CRIME_HEAT[k] > 0), 'chaque crime a une chaleur (flic_detruit = 0 : baisse)');
  let w = newWanted();
  ok(starsOf(w.heat) === 0, 'départ : 0 étoile');
  w = addCrime(w, 'pieton_renverse');
  ok(starsOf(w.heat) === 1, 'un piéton renversé : 1 étoile');
  for (let i = 0; i < 40; i++) w = addCrime(w, 'agression_flic');
  ok(starsOf(w.heat) === 5, 'le plafond est 5 étoiles');
  for (let s = 5; s >= 2; s--) {
    w = { ...w, heat: heatOfStars(s), kills: 0 };
    let n = 0;
    while (starsOf(w.heat) === s && n < 10) { w = copDestroyed(w); n++; }
    ok(n === COPS_PER_STAR_DROP && starsOf(w.heat) === s - 1, `${s} étoiles : ${COPS_PER_STAR_DROP} voitures détruites -> ${s - 1} étoile(s)`);
  }
  w = { heat: heatOfStars(3), kills: 0, calm: 0 };
  for (let i = 0; i < 20000; i++) w = tickWanted(w, 0.05, false); // 1000 s sans être vu, loin de tout : 3 étoiles ne s'évaporent PAS
  ok(starsOf(w.heat) === 3, 'fuir longtemps ne fait pas perdre 3 étoiles');
  w = { heat: heatOfStars(1) + 2, kills: 0, calm: 0 };
  for (let i = 0; i < (UNSEEN_DELAY_S - 1) * 20; i++) w = tickWanted(w, 0.05, false);
  ok(starsOf(w.heat) === 1, 'rien ne se passe avant le délai');
  for (let i = 0; i < 20 * 300; i++) w = tickWanted(w, 0.05, false);
  ok(starsOf(w.heat) === 0, '1 étoile s\'évapore très lentement si aucun flic ne voit le joueur');
  const seen = tickWanted({ heat: 20, kills: 0, calm: 40 }, 1, true);
  ok(seen.calm === 0 && seen.heat === 20, 'être vu remet le compteur à zéro');
  ok(starProgress(0) === 0 && starProgress(heatOfStars(2)) === 0 && starProgress(5) === 0.5, 'starProgress cohérent');
  ok(copsWanted(0) === 0 && copsWanted(5) <= POLICE_POOL_MAX && copsWanted(5) > copsWanted(1) && BUST_MONEY_LOSS > 0, 'copsWanted croît et reste ≤ pool');
}

// ---------- Systèmes ----------
async function main() {
  const sim = await Sim.create();
  const bus = new GameBus();
  bus.onError = (e, err) => { fails++; console.log(`ECHEC : écouteur ${e} : ${(err as Error)?.stack ?? err}`); };
  const systems = new Map<string, GameSystem>();
  const sent: { to: string; ev: GameServerEvent }[] = [];
  const ctx: GameCtx = {
    sim, bus, city, mode: 'solo',
    sendTo: (to, ev) => { sent.push({ to, ev }); }, broadcast() {},
    get: ((id: string) => systems.get(id)) as GameCtx['get'],
  };
  const peds = createPeds(ctx) as PedsSystem;
  systems.set('peds', peds);
  const police = createPolice(ctx) as PoliceSystem;
  systems.set('police', police);
  const hooksTouched = { died: 0 };
  sim.hooks.onPlayerKilled = (p, by, cause) => { hooksTouched.died++; bus.emit('playerDied', { p, by, cause }); };
  sim.hooks.onVehicleDestroyed = (v, by) => bus.emit('vehicleDestroyed', { v, by });
  sim.hooks.onEnter = (p, v) => bus.emit('enteredVehicle', { p, v });
  sim.hooks.onShot = (p, o) => bus.emit('crime', { kind: 'tir', by: p, x: o[0], z: o[2] });

  const tickAll = (n: number) => { for (let i = 0; i < n; i++) { sim.step(); peds.postStep?.(); police.postStep?.(); } };
  const addPlayer = (id: string, x: number, z: number) => {
    sim.addPlayer(id, id);
    const p = sim.players.get(id)!;
    p.body.setTranslation({ x, y: 1, z }, true);
    police.onJoin?.(p);
    return p;
  };
  const policeAlive = () => sim.vehicles.filter((v) => v.def.type === 'police' && !v.pooled).length;
  const priv = (id: string): PrivateState => {
    const out: PrivateState = { money: 0, bag: {}, bagCap: 20, stars: 0, starProgress: 0, district: 'campus', marks: [], medals: {}, unread: 0 };
    police.privateView!(sim.players.get(id)!, out);
    return out;
  };

  const a = addPlayer('a', 0, 0);
  tickAll(60 * 4); // pose, fin de l'invulnérabilité d'arrivée

  // ---- /debug stars ----
  bus.emit('debug', { p: a, what: 'stars', arg: '4' });
  ok(police.starsOf('a') === 4 && priv('a').stars === 4, '/debug stars 4 : 4 étoiles (privateView)');
  tickAll(6);
  const snapA = sim.snapshot().players.find((q) => q.id === 'a');
  ok(snapA?.ws === 4, 'snapshot : PlayerSnap.ws = 4');
  bus.emit('debug', { p: a, what: 'stars', arg: '99' });
  ok(police.starsOf('a') === 5, '/debug stars 99 : plafonné à 5');
  bus.emit('debug', { p: a, what: 'stars', arg: 'abc' });
  bus.emit('debug', { p: a, what: 'money', arg: '5' });
  ok(police.starsOf('a') === 5, 'arguments invalides ignorés');
  bus.emit('debug', { p: a, what: 'stars', arg: '0' });
  ok(police.starsOf('a') === 0, '/debug stars 0 : retour à 0');
  tickAll(60 * 3);
  ok(police.carCount === 0 && policeAlive() === 0, 'sans recherche : aucune voiture de police');

  // ---- Piéton renversé fait monter les étoiles ----
  {
    const car = sim.acquireVehicle('citadine', -30, 2, -Math.PI / 2, { y: 0.6 });
    ok(!!car, 'citadine du pool acquise');
    if (car) {
      a.body.setTranslation({ x: -32, y: 1, z: 2 }, true);
      sim.enterVehicle(a, car, 0);
      const ped = makePed(900001, 'flic', 1, city, 55); // un flic : les autres piétons fuient devant la voiture
      ped.x = -4; ped.z = 2; ped.st = PED_ST.IDLE; ped.timer = 1e9;
      (peds.peds as ReturnType<typeof makePed>[]).push(ped);
      for (let i = 0; i < 200; i++) { car.behavior.body.setLinvel({ x: 12, y: 0, z: 0 }, true); sim.step(); peds.postStep?.(); police.postStep?.(); }
      ok(ped.st === PED_ST.KNOCKED || ped.gone, 'le piéton est renversé');
      ok(police.starsOf('a') >= 1, `piéton renversé : ${police.starsOf('a')} étoile(s)`);
      sim.leaveVehicle(a, true);
      sim.releaseVehicle(car);
    }
  }

  // ---- Un tir sans témoin ne compte pas, avec témoin oui ----
  {
    bus.emit('debug', { p: a, what: 'stars', arg: '0' });
    const pa: [number, number, number] = [-5000, 1, -5000]; // loin de tout piéton et de toute voiture
    bus.emit('crime', { kind: 'tir', by: a, x: pa[0], z: pa[2] });
    ok(police.heatOf('a') === 0, 'tir sans témoin : aucune chaleur');
    const w = makePed(900002, 'passant', 1, city, 55);
    w.x = pa[0] + 5; w.z = pa[2]; w.st = PED_ST.IDLE; w.timer = 1e9;
    (peds.peds as ReturnType<typeof makePed>[]).push(w);
    tickAll(1); // reconstruit la grille des piétons
    bus.emit('crime', { kind: 'tir', by: a, x: pa[0], z: pa[2] });
    ok(police.heatOf('a') === CRIME_HEAT.tir, 'tir devant un piéton : chaleur ajoutée');
    // doublon de crime signalé par deux systèmes : compté une fois
    bus.emit('debug', { p: a, what: 'stars', arg: '0' });
    bus.emit('crime', { kind: 'camera_detruite', by: a, x: 0, z: 0 });
    bus.emit('cameraDestroyed', { by: a, id: 'cam1' });
    ok(police.heatOf('a') === CRIME_HEAT.camera_detruite, 'crime signalé deux fois : compté une fois (anti-doublon)');
  }

  // ---- Poursuite, pool plafonné à 10, perf ----
  {
    const b = addPlayer('b', 40, 40);
    bus.emit('debug', { p: a, what: 'stars', arg: '5' });
    bus.emit('debug', { p: b, what: 'stars', arg: '5' });
    let maxAlive = 0, maxMine = 0, minDist = Infinity, tot = 0, n = 0;
    for (let i = 0; i < 60 * 70; i++) {
      sim.step(); peds.postStep?.();
      const t0 = performance.now(); police.postStep?.(); tot += performance.now() - t0; n++;
      maxAlive = Math.max(maxAlive, policeAlive());
      maxMine = Math.max(maxMine, police.carCount);
      if (i % 30 === 0) {
        const pa = sim.playerPos(a);
        for (const m of priv('a').marks) minDist = Math.min(minDist, Math.hypot(m.x - pa[0], m.z - pa[2]));
      }
    }
    ok(maxAlive <= VEHICLE_POOL.police && maxAlive <= POLICE_POOL_MAX, `voitures de police vivantes ≤ ${POLICE_POOL_MAX} (max ${maxAlive})`);
    ok(maxMine >= 5 && maxMine <= POLICE_POOL_MAX, `la police est apparue (${maxMine} voitures pour 2 joueurs à 5 étoiles)`);
    ok(minDist < 40, `une voiture de police rejoint le joueur (distance min des repères ${minDist.toFixed(0)} m)`);
    ok(tot / n < 0.5, `budget : ${(tot / n).toFixed(3)} ms/pas en moyenne (< 0,5)`);
    ok(priv('a').marks.every((m) => m.k === 'danger' && m.label === 'flic') && priv('a').marks.length <= 6, 'repères de police valides');
    const ser = JSON.stringify(police.serialize!());
    ok(ser.includes('"b"') && ser.length < 300, `serialize : étoiles seulement (${ser})`);

    // ---- Détruire N voitures de police fait baisser ----
    bus.emit('debug', { p: a, what: 'stars', arg: '3' });
    bus.emit('debug', { p: b, what: 'stars', arg: '0' });
    sim.removePlayer('b');
    police.onLeave?.(b);
    const before = police.starsOf('a');
    const cops: ReturnType<Sim['acquireVehicle']>[] = [];
    for (const v of sim.vehicles) if (v.def.type === 'police' && !v.pooled && !v.dead) cops.push(v);
    while (cops.length < COPS_PER_STAR_DROP) { const v = sim.acquireVehicle('police', 200 + cops.length * 8, 200, 0); if (!v) break; cops.push(v); }
    const pa = sim.playerPos(a);
    for (let i = 0; i < COPS_PER_STAR_DROP; i++) {
      const v = cops[i]!;
      v.lastHitBy = null; // destruction sans attribution directe : le joueur recherché le plus proche ou lastHitBy est crédité
      sim.damageVehicle(v, 1e5, 'explosion', a);
    }
    void pa;
    ok(before === 3 && police.starsOf('a') === 2, `${COPS_PER_STAR_DROP} voitures de police détruites : ${before} -> ${police.starsOf('a')} étoiles`);
    ok(sent.some((e) => e.ev.k === 'toast'), 'toast à la baisse d\'étoile');
    tickAll(60 * 20); // les épaves retournent au pool
  }

  // ---- VRef périmée ----
  {
    const v = sim.acquireVehicle('police', 300, 300, 0)!;
    const ref = sim.refOf(v);
    ok(sim.resolveRef(ref) === v, 'VRef valide tant que la voiture est en jeu');
    sim.releaseVehicle(v);
    ok(sim.resolveRef(ref) === null, 'VRef périmée après recyclage : null');
    sim.acquireVehicle('police', 300, 300, 0);
    ok(sim.resolveRef(ref) === null, 'VRef périmée même après réacquisition (génération)');
    ok(sim.resolveRef({ id: 99999, gen: 0 }) === null && sim.resolveRef(null) === null, 'VRef absurde : null');
    for (const q of sim.vehicles) if (q.def.type === 'police' && !q.pooled) sim.releaseVehicle(q);
  }

  // ---- Arrestation : sac vidé (économie simulée), commissariat ----
  {
    bus.emit('debug', { p: a, what: 'stars', arg: '0' });
    tickAll(60 * 30); // les voitures de police restantes sont recyclées
    a.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
    tickAll(30);
    const bag: Record<string, number> = { cafe_machine: 5, cables_hdmi: 2 };
    let money = 1000;
    let busted = 0;
    bus.on('playerBusted', ({ p }) => { if (p.id === 'a') { busted++; for (const k of Object.keys(bag)) delete bag[k]; money = Math.round(money * (1 - BUST_MONEY_LOSS)); } });
    bus.emit('debug', { p: a, what: 'stars', arg: '2' });
    const pa = sim.playerPos(a);
    const flic = makePed(900003, 'flic', 1, city, 55);
    flic.x = pa[0] + 1; flic.z = pa[2]; flic.st = PED_ST.IDLE; flic.timer = 1e9;
    (peds.peds as ReturnType<typeof makePed>[]).push(flic);
    sent.length = 0;
    tickAll(60 * 1);
    ok(busted === 0, 'pas d\'arrestation avant 2 s de contact');
    tickAll(60 * 2);
    ok(busted === 1, `playerBusted émis une fois (${busted})`);
    ok(Object.keys(bag).length === 0 && money === 750, 'sac vidé, 25 % de l\'argent perdu (via l\'écouteur de l\'économie)');
    const pb = sim.playerPos(a);
    const com = city.poisOf('commissariat')[0];
    ok(Math.hypot(pb[0] - com.x, pb[2] - com.z) < 6, `joueur au commissariat (${Math.hypot(pb[0] - com.x, pb[2] - com.z).toFixed(1)} m)`);
    ok(police.starsOf('a') === 0, 'étoiles remises à 0');
    ok(sent.some((e) => e.to === 'a' && e.ev.k === 'arrete'), 'event de jeu « arrete » envoyé');
    // un flic sans étoile n'arrête personne
    const f2 = makePed(900004, 'flic', 1, city, 55);
    f2.x = pb[0] + 1; f2.z = pb[2]; f2.st = PED_ST.IDLE; f2.timer = 1e9;
    (peds.peds as ReturnType<typeof makePed>[]).push(f2);
    tickAll(60 * 4);
    ok(busted === 1, 'sans étoile, un flic proche n\'arrête pas');
  }

  // ---- Mort : hôpital ----
  {
    sent.length = 0;
    bus.emit('debug', { p: a, what: 'stars', arg: '3' });
    sim.damagePlayer(a, 1e4, null, 'generic');
    ok(police.starsOf('a') === 0, 'la mort remet les étoiles à 0');
    tickAll(60 * 4);
    ok(sent.some((e) => e.to === 'a' && e.ev.k === 'mort'), 'event « mort » envoyé');
    const pb = sim.playerPos(a);
    const h = city.poisOf('hopital')[0];
    ok(a.hp > 0 && Math.hypot(pb[0] - h.x, pb[2] - h.z) < 6, `réapparition à l'hôpital (${Math.hypot(pb[0] - h.x, pb[2] - h.z).toFixed(1)} m)`);
  }

  // ---- Sauvegarde ----
  {
    bus.emit('debug', { p: a, what: 'stars', arg: '2' });
    const ser = police.serialize!();
    police.restore!(null);
    police.restore!({ w: 5 });
    police.restore!(JSON.parse('{"w":{"__proto__":{"heat":50},"x":{"heat":"a"},"z":{"heat":1e99,"kills":-3},"q":null}}'));
    police.restore!(ser);
    ok(({} as { heat?: number }).heat === undefined, 'restore : pas de pollution du prototype');
    sim.removePlayer('a');
    police.onLeave?.(a);
    const a2 = addPlayer('z', 5, 5);
    ok(police.starsOf('z') >= 0 && a2.id === 'z', 'restore hostile ignoré, joueur suivant normal');
  }
}

main().then(() => {
  console.log(fails ? `\n${fails} échec(s)` : '\npolice : tout est vert');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
