// PROPRIÉTAIRE : intégrateur. Disjoncteur (reconstruction du monde Rapier empoisonné) avec TOUS les systèmes de jeu actifs, sur un vrai serveur.
// Lancement : npx tsx tests/disjoncteur.ts   (ports 3460-3462, sauvegardes dans un dossier temporaire)
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/server';
import { getCity } from '../shared/city/layout';
import { GOOD_IDS } from '../shared/ids';
import { missionById } from '../shared/missions';
import type { EconomySystem } from '../server/systems/economy';
import type { MinigamesSystem } from '../server/systems/minigames';
import type { MissionsSystem } from '../server/systems/missions';
import type { PoliceSystem } from '../server/systems/police';
import { check, failCount, join, poison, sleep, tmpDir, until, type Client } from './helpers-net';

const city = getCity();
const dealer = city.poisOf('dealer')[0];
const planque = city.poisOf('planque')[0];
const giver = city.poisOf('donneur').find((p) => p.id === missionById('annales')!.giver)!;
const cam = city.poisOf('camera')[0];

/** État de départ d'une vraie partie : argent, sac, planque, médailles, caméra détruite, marché avec un tuyau en cours, indice de recherche. */
function seedSave(file: string) {
  const market = { v: 1, noiseAt: 0, nextRollAt: 3_000_000, flowAt: 0, flow: [], noise: [], events: [['cafe_machine', 'campus', 3, -1000, 3_600_000]], cams: [], police: [] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 3, players: {},
    systems: {
      economy: {
        v: 1, market,
        accounts: [['Alice', 777, [['croissant_pirate', 2]], [['cafe_machine', 3]], 5], ['Bob', 321, [], [], 1], ['Carol', 450, [], [], 1]],
        camsDown: [cam.id],
      },
      missions: { v: 1, medals: { Alice: { annales: 'or' } } },
      police: { v: 1, w: { Alice: { heat: 70, kills: 1 } } },
    },
  }));
}


async function main() {
  const t = tmpDir('wtf-disj-');
  const PORT = 3460;
  const logs: string[] = [];
  seedSave(path.join(t.saves, 'multi.json'));
  const srv = await startServer({ mode: 'multi', saveDir: t.saves, publicDir: t.pub, port: PORT, log: (l) => logs.push(l) });
  const ip = (n: number) => ({ localAddress: `127.0.0.${n}` }); // une adresse par client : pas de limite « 1 join / 2 s par IP »
  const alice = await join(PORT, 'Alice', ip(2));
  const bob = await join(PORT, 'Bob', ip(3));
  const carol = await join(PORT, 'Carol', ip(4));
  check('3 joueurs connectés', [alice, bob, carol].every((c) => c.id) && srv.sim().players.size === 3);
  const pl = (c: Client) => srv.sim().players.get(c.id)!;

  // ---------- Une vraie partie en cours ----------
  const at = (c: Client, x: number, z: number) => { srv.sim().teleportPlayer(pl(c), x, 1.3, z); };
  at(alice, dealer.x, dealer.z);
  at(bob, dealer.x + 1, dealer.z + 1);
  await until(() => !!alice.me?.shop && !!bob.me?.shop, 3000);
  check('boutique ouverte chez le dealer (me.shop)', !!alice.me?.shop && alice.me.shop.goods.length === GOOD_IDS.length);
  check('compte rechargé : argent 777, sac, étoiles, médaille or', alice.me?.money === 777 && (alice.me?.bag.croissant_pirate ?? 0) === 2 && (alice.me?.stars ?? 0) >= 1 && alice.me?.medals.annales === 'or', JSON.stringify(alice.me));
  const good = alice.me!.shop!.goods.find((g) => g.good === 'cafe_machine')!;
  alice.game({ k: 'trade', dealer: alice.me!.shop!.dealer, good: 'cafe_machine', qty: 1, side: 'buy' });
  check('achat réel avant la panne', await until(() => (alice.me?.bag.cafe_machine ?? 0) === 1, 3000) && alice.me!.money < 777 && alice.me!.money >= 777 - good.buy - 5, `${alice.me?.money} (prix ${good.buy})`);
  at(alice, planque.x, planque.z);
  await until(() => !!alice.me?.stash, 3000);
  alice.game({ k: 'stash', op: 'put', good: 'croissant_pirate', qty: 1 });
  check('dépôt réel à la planque avant la panne', await until(() => (alice.me?.stash?.croissant_pirate ?? 0) === 1, 3000));

  // Mission en cours (Alice) + mini-jeu en cours (Bob)
  at(alice, giver.x + 3, giver.z + 3);
  await sleep(300);
  alice.game({ k: 'mission', op: 'start', id: 'annales' });
  const missions = () => srv.game().system<MissionsSystem>('missions')!;
  check('mission lancée', await until(() => !!missions().inspect(pl(alice)), 3000));
  const mgs = () => srv.game().system<MinigamesSystem>('minigames')!;
  at(bob, dealer.x, dealer.z);
  await sleep(200);
  const sid = mgs().startMinigame(pl(bob), 'digicode', 'test', 0.5);
  check('mini-jeu en cours (Bob)', sid !== null && await until(() => bob.events.some((e) => e.k === 'mg_start'), 3000));
  // Carol : ses messages partiront PENDANT la reconstruction
  at(carol, dealer.x - 1, dealer.z - 1);
  await until(() => !!carol.me?.shop, 3000);
  await sleep(1200);

  // ---------- État avant la panne (instantané synchrone, juste avant l'empoisonnement) ----------
  const simBefore = srv.sim();
  const eco = srv.game().system<EconomySystem>('economy')!;
  const police = srv.game().system<PoliceSystem>('police')!;
  const vehiclesBefore = simBefore.vehicles.length;
  const pooledBefore = simBefore.vehicles.filter((v) => v.pooled).length;
  const timeBefore = simBefore.time;
  const stateBefore = JSON.parse(JSON.stringify(srv.game().serialize())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const posBefore = new Map([alice, bob, carol].map((c) => { const p = pl(c).body.translation(); return [c.id, [p.x, p.z] as [number, number]]; }));
  const starsBefore = police.starsOf(pl(alice).id);
  const carolMoney0 = eco.moneyOf(pl(carol));
  const carolBuy = carol.me!.shop!.goods.find((g) => g.good === 'croissant_pirate')!.buy;
  const snapsBefore = alice.snaps;
  const eventsBeforeA = alice.events.length;
  const eventsBeforeB = bob.events.length;

  poison(simBefore);
  simBefore.broken = true; // le serveur voit le monde cassé : tout message de jeu qui arrive désormais est mis de côté
  carol.game({ k: 'trade', dealer: carol.me!.shop!.dealer, good: 'croissant_pirate', qty: 2, side: 'buy' }); // en vol pendant la reconstruction
  carol.send({ type: 'input', i: { f: 1, s: 0, jump: 0, run: 0, yaw: 0, hn: 0, act: 0, m1: 0, m2: 0, ao: [0, 0, 0], ad: [0, 0, -1] } });
  check('disjoncteur : le serveur reconstruit la simulation', await until(() => srv.sim() !== simBefore, 6000));
  const sim = srv.sim();
  check('nouvelle simulation saine, tous les joueurs conservés', !sim.broken && sim.players.size === 3, `${sim.players.size}`);
  check('temps de simulation conservé (pas de retour à 0)', sim.time >= timeBefore, `${timeBefore} -> ${sim.time}`);
  check('aucun client déconnecté', ![alice, bob, carol].some((c) => c.closed));

  // Conservation de l'argent, du sac, de la planque, des médailles, des caméras, du marché, des étoiles
  const after = JSON.parse(JSON.stringify(srv.game().serialize())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const accOf = (st: Record<string, any>, n: string) => st.economy.accounts.find((a: unknown[]) => a[0] === n) as [string, number, unknown, unknown, number]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const a0 = accOf(stateBefore, 'Alice'), a1 = accOf(after, 'Alice');
  check('Alice : argent, sac et planque conservés', !!a1 && a1[1] === a0[1] && JSON.stringify(a1[2]) === JSON.stringify(a0[2]) && JSON.stringify(a1[3]) === JSON.stringify(a0[3]), JSON.stringify([a0, a1]));
  const b0 = accOf(stateBefore, 'Bob'), b1 = accOf(after, 'Bob');
  check('Bob : compte conservé', !!b1 && b1[1] === b0[1]);
  check('caméras détruites conservées', JSON.stringify(after.economy.camsDown) === JSON.stringify(stateBefore.economy.camsDown) && after.economy.camsDown.includes(cam.id));
  check('médailles conservées', JSON.stringify(after.missions.medals) === JSON.stringify(stateBefore.missions.medals) && after.missions.medals.Alice.annales === 'or');
  check('indice de recherche conservé', police.starsOf !== undefined && srv.game().system<PoliceSystem>('police')!.starsOf(sim.players.get(alice.id)!.id) >= Math.max(1, starsBefore - 1), `avant ${starsBefore}`);
  const mkt = (st: Record<string, any>, at0: number) => (st.economy.market.events as [string, string, number, number, number][]).map((e) => [e[0], e[1], e[2], e[3] + at0, e[4] + at0]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const evBefore = mkt(stateBefore, timeBefore), evAfter = mkt(after, sim.time);
  check('marché : le tuyau en cours est conservé (mêmes dates absolues)', evBefore.length > 0 && evBefore.every((e) => evAfter.some((f) => f[0] === e[0] && f[1] === e[1] && f[2] === e[2] && Math.abs(f[3] - e[3]) < 400 && Math.abs(f[4] - e[4]) < 400)), JSON.stringify([evBefore, evAfter]));

  // Joueurs repositionnés, jamais coincés
  let moved = 0, stuck = 0, below = 0;
  for (const c of [alice, bob, carol]) {
    const p = sim.players.get(c.id)!;
    const tr = p.body.translation();
    const b = posBefore.get(c.id)!;
    if (Math.hypot(tr.x - b[0], tr.z - b[1]) > 12) moved++;
    if (tr.y < 0) below++;
    const free = sim.clearSpot(tr.x, tr.y, tr.z, [0.4, 0.9, 0.4]);
    if (free === null || free > tr.y + 0.6) stuck++;
  }
  check('joueurs replacés au même endroit (≤ 12 m), au-dessus du sol, hors des murs', moved === 0 && below === 0 && stuck === 0, `déplacés ${moved}, sous le sol ${below}, coincés ${stuck}`);
  sim.setInput(alice.id, { f: 1 });
  for (let i = 0; i < 60; i++) await sleep(5);
  check('les joueurs peuvent bouger après la reconstruction', Math.hypot(sim.players.get(alice.id)!.body.translation().x - posBefore.get(alice.id)![0], sim.players.get(alice.id)!.body.translation().z - posBefore.get(alice.id)![1]) > 0.2);

  // Pool de véhicules restauré
  check('pool de véhicules restauré (même effectif, des véhicules libres)', sim.vehicles.length === vehiclesBefore && sim.vehicles.some((v) => v.pooled) && pooledBefore > 0, `${sim.vehicles.length}/${vehiclesBefore}`);
  const rented = sim.acquireVehicle('citadine', 400, 400, 0);
  check('pool : acquireVehicle fonctionne sur le nouveau monde', !!rented);
  if (rented) sim.releaseVehicle(rented);
  check('population relancée (trafic de civils)', await until(() => sim.vehicles.some((v) => !v.pooled && !v.dead && v.ai), 6000));

  // Mission / mini-jeu interrompus proprement
  const missionsNew = srv.game().system<MissionsSystem>('missions')!;
  check('mission en cours : échec propre (plus de run côté serveur)', !missionsNew.inspect(sim.players.get(alice.id)!));
  check('mission en cours : le client reçoit « fail » avec l\'identifiant', await until(() => alice.events.slice(eventsBeforeA).some((e) => e.k === 'mission' && e.ev === 'fail' && e.id === 'annales'), 3000));
  check('mini-jeu en cours : le client reçoit « mg_end » (interface refermée)', await until(() => bob.events.slice(eventsBeforeB).some((e) => e.k === 'mg_end' && !e.ok), 3000));
  check('mini-jeu : plus de session côté serveur', !srv.game().system<MinigamesSystem>('minigames')!.activeOf(sim.players.get(bob.id)!));
  await sleep(300);
  check('me après la panne : argent, sac, médailles intacts (Alice)', alice.me?.money === a0[1] && alice.me?.medals.annales === 'or' && (alice.me?.bag.cafe_machine ?? 0) === 1 && (alice.me?.bag.croissant_pirate ?? 0) === 1, JSON.stringify(alice.me));

  // Aucun message client perdu : l'achat de Carol parti pendant la reconstruction a été rejoué
  const carolNow = srv.game().system<EconomySystem>('economy')!.moneyOf(sim.players.get(carol.id)!);
  check('aucun message perdu : l\'achat envoyé pendant la reconstruction a été exécuté', await until(() => srv.game().system<EconomySystem>('economy')!.moneyOf(sim.players.get(carol.id)!) < carolMoney0, 3000), `${carolMoney0} -> ${carolNow} (prix ${carolBuy})`);
  check('aucun message perdu : l\'achat rejoué correspond au prix', srv.game().system<EconomySystem>('economy')!.bagOf(sim.players.get(carol.id)!).get('croissant_pirate') === 2);

  check('annonce « Le monde a hoqueté » reçue', await until(() => alice.chats.some((c) => /Le monde a hoqueté/.test(c)), 2000));
  await sleep(500);
  check('les clients reçoivent toujours des snapshots (complet puis deltas)', alice.snaps > snapsBefore + 5 && alice.fullSnaps >= 2);
  check('le serveur fonctionne : /chat, nouvelle arrivée possible', await (async () => {
    const dave = await join(PORT, 'Dave', ip(5));
    const ok = !!dave.id && !dave.closed;
    dave.ws.close();
    return ok;
  })());
  const errs = logs.filter((l) => /TypeError|RangeError|Reconstruction impossible|recursive use/.test(l));
  check('journal : aucune exception inattendue', errs.length === 0, errs.slice(0, 3).join(' | '));

  // Deuxième panne enchaînée (le disjoncteur autorise 3 reconstructions par minute)
  await until(() => srv.sim().players.size === 3, 3000); // Dave est bien parti
  const s2 = srv.sim();
  poison(s2);
  const okRb = await until(() => srv.sim() !== s2 && !srv.sim().broken, 6000);
  check('2e panne enchaînée : encore reconstruit', okRb && srv.sim().players.size === 3, `rebuilt=${okRb} joueurs=${[...srv.sim().players.values()].map((p) => p.name).join(',')}`);
  check('2e panne : l\'argent est toujours le même', eco !== undefined && srv.game().system<EconomySystem>('economy')!.moneyOf(srv.sim().players.get(bob.id)!) === b0[1]);

  for (const c of [alice, bob, carol]) c.ws.close();
  await sleep(200);
  await srv.stop();

  // ---------- Panne répétée : arrêt propre, partie sauvegardée ----------
  const t2 = tmpDir('wtf-disj2-');
  seedSave(path.join(t2.saves, 'multi.json'));
  let fatal = '';
  const srv2 = await startServer({ mode: 'multi', saveDir: t2.saves, publicDir: t2.pub, port: PORT + 2, log: () => {}, onFatal: (r) => { fatal = r; } });
  const z = await join(PORT + 2, 'Alice', ip(6));
  await until(() => !!z.me, 3000);
  srv2.sim().teleportPlayer(srv2.sim().players.get(z.id)!, dealer.x, 1.3, dealer.z);
  await until(() => !!z.me?.shop, 3000);
  z.game({ k: 'trade', dealer: z.me!.shop!.dealer, good: 'cafe_machine', qty: 1, side: 'buy' });
  await until(() => (z.me?.bag.cafe_machine ?? 0) === 1, 3000);
  const moneyKept = z.me!.money;
  for (let k = 0; k < 5 && !fatal; k++) {
    const s = srv2.sim();
    poison(s);
    await until(() => srv2.sim() !== s || !!fatal, 6000);
    await sleep(150);
  }
  check('4e panne en moins d\'une minute : arrêt propre demandé (onFatal)', await until(() => !!fatal, 5000), fatal);
  const file = JSON.parse(fs.readFileSync(path.join(t2.saves, 'multi.json'), 'utf8'));
  const accA = (file.systems?.economy?.accounts ?? []).find((a: unknown[]) => a[0] === 'Alice');
  check('arrêt sur panne : la partie est sauvegardée (argent et sac d\'Alice)', file.version === 3 && !!accA && accA[1] === moneyKept && JSON.stringify(accA[2]).includes('cafe_machine'), JSON.stringify(accA));
  z.ws.close();
  t2.clean();
  t.clean();
  console.log(failCount() ? `\n${failCount()} échec(s)` : '\nDisjoncteur : toutes les vérifications passent.');
  process.exit(failCount() ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
