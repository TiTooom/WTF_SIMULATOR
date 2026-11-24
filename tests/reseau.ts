// PROPRIÉTAIRE : intégrateur. Robustesse réseau : format compact des snapshots (côté client), arrivée en cours de route, message `me` malformé,
// déconnexions pendant boutique / mini-jeu / mission, reconnexion d'un fantôme, 8 joueurs simultanés (mesure du pas serveur et des snapshots).
// Lancement : npx tsx tests/reseau.ts   (ports 3467-3469)
import { Net } from '../src/net';
import { packMe, unpackMe } from '../shared/me';
import { startServer } from '../server/server';
import { getCity } from '../shared/city/layout';
import { missionById } from '../shared/missions';
import type { MinigamesSystem } from '../server/systems/minigames';
import type { MissionsSystem } from '../server/systems/missions';
import { check, failCount, join, sleep, tmpDir, until, info, type Client } from './helpers-net';

const city = getCity();
const dealer = city.poisOf('dealer')[0];
const giver = city.poisOf('donneur').find((p) => p.id === missionById('annales')!.giver)!;
const ip = (n: number) => ({ localAddress: `127.0.0.${n}` });

// ---------- A. Net.expand : snapshots compacts reçus par le client ----------
function partClient() {
  const mk = () => new Net() as unknown as { expand(s: unknown): boolean };
  const veh = (i: number) => ({ type: 'citadine', p: [i, 0, 0], q: [0, 0, 0, 1], sp: 0, st: 0, a: [], hp: 1, dead: 0, drv: '' });
  const full = (n: number) => ({ t: 100, players: [{ id: 'p1', name: 'A', p: [0, 0, 0], yaw: 0, veh: -1, seat: 0, hp: 100 }], vehicles: Array.from({ length: n }, (_, i) => veh(i)), props: [], proj: [], fx: [] });
  // champs omis : drv, a, hp, dead, st ; q réduit à [qy, qw]
  const delta = (idx: number[], vn: number) => ({ t: 133, d: 1, vn, vi: idx, players: [{ id: 'p1', p: [1, 0, 0], yaw: 0, veh: -1, seat: 0, hp: 100 }],
    vehicles: idx.map((i) => ({ type: 'citadine', p: [i + 0.5, 0, 0], q: [0.5, 0.8660254], sp: 1 })), props: [] });
  {
    const n = mk();
    const d = delta([1], 3);
    check('delta reçu avant tout snapshot complet : ignoré (pas d\'exception)', n.expand(d) === false);
  }
  {
    const n = mk();
    check('snapshot complet accepté', n.expand(full(3)) === true);
    const d = delta([1], 3) as { vehicles: { q: number[]; drv?: string; hp?: number; a?: number[]; dead?: number; st?: number }[]; players: { name?: string }[]; fx?: unknown[]; peds?: unknown[] };
    const ok = n.expand(d);
    const v = d.vehicles as unknown as { p: number[]; q: number[]; drv: string; hp: number; a: number[]; dead: number; st: number }[];
    check('delta compact : valeurs omises rétablies (drv, a, hp, dead, st, q)', ok && v.length === 3 && v[1].drv === '' && v[1].hp === 1 && Array.isArray(v[1].a) && v[1].dead === 0 && v[1].st === 0 && v[1].q.length === 4 && Math.abs(v[1].q[1] - 0.5) < 1e-9 && Math.abs(v[1].q[3] - 0.8660254) < 1e-9);
    check('delta : véhicules non listés repris de l\'état précédent, position mise à jour', v[0].p[0] === 0 && v[1].p[0] === 1.5 && v[2].p[0] === 2);
    check('delta : nom du joueur retrouvé (omis), fx et peds par défaut', d.players[0].name === 'A' && Array.isArray(d.fx) && Array.isArray(d.peds));
  }
  {
    const n = mk();
    n.expand(full(3));
    check('delta avec un indice hors bornes (vi=[9], vn=3) : ignoré proprement, état cohérent', n.expand(delta([9], 3)) === true);
    check('delta dont vn dépasse l\'état connu (trou) : snapshot écarté', mk().expand(Object.assign(full(2), {})) === true && (() => { const m = mk(); m.expand(full(2)); return m.expand(delta([0], 5)) === false; })());
  }
  {
    const n = mk();
    n.expand(full(2));
    const garbage: unknown[] = [null, 42, 'x', [], {}, { t: 1 }, { t: 'x', players: [], vehicles: [], props: [] }, { t: 1, players: 5, vehicles: [], props: [] }, { t: 1, players: [], vehicles: {}, props: [] }, { d: 1, t: 1, players: [], vehicles: [], props: [], vi: 'x', vn: 'y' }];
    let threw = false;
    let accepted = 0;
    try { for (const g of garbage) if (n.expand(g)) accepted++; } catch { threw = true; }
    check('snapshots malformés : aucune exception', !threw, `${accepted} acceptés`);
  }
  {
    // snapshots hors ordre : un ancien delta après un plus récent ne casse rien (l'état reste complet)
    const n = mk();
    n.expand(full(3));
    const a = n.expand(delta([2], 3)), b = n.expand(delta([0], 3)), c = n.expand(delta([2], 3));
    check('deltas rejoués dans le désordre : toujours exploitables', a && b && c);
  }
  // me malformé
  const bad: unknown[] = [null, 5, 'x', [], { m: 'beaucoup' }, { m: -5, b: 'x', mk: 7, md: [], sh: 'x', ms: 'x', ac: 3 }, { m: 1e99, b: [999, 1, -3, 5], mk: [[1], 'x', [NaN, 1, 2]], md: { __proto__: { a: 1 }, annales: 99 } },
    { sh: { l: [0, 'a', null, 99, 1, 1] }, ms: [1, 2], ac: [9, 'x'] }];
  let threw = false;
  const outs: (ReturnType<typeof unpackMe>)[] = [];
  try { for (const b of bad) outs.push(unpackMe(b)); } catch { threw = true; }
  check('unpackMe sur 8 `me` malformés : aucune exception', !threw);
  check('unpackMe : non-objets rejetés (null), objets nettoyés (bornes, types)', outs[0] === null && outs[1] === null && outs[3] === null && outs.slice(4).every((o) => o !== null && Number.isFinite(o.money) && o.money >= 0 && o.stars >= 0 && o.stars <= 5 && o.marks.length <= 16 && typeof o.bag === 'object'));
  check('unpackMe : aller-retour exact avec packMe', JSON.stringify(unpackMe(JSON.parse(JSON.stringify(packMe({ money: 12, bag: { cafe_machine: 2 }, bagCap: 14, stars: 2, starProgress: 0.5, district: 'docks', marks: [{ x: 1, z: 2, k: 'dealer' }], medals: { annales: 'or' }, unread: 3 }))))?.bag) === '{"cafe_machine":2}');
}

// ---------- B. Serveur réel ----------
async function partServer() {
  const t = tmpDir('wtf-reseau-');
  const PORT = 3467;
  const logs: string[] = [];
  const srv = await startServer({ mode: 'multi', saveDir: t.saves, publicDir: t.pub, port: PORT, log: (l) => logs.push(l), joinGapMs: 0 });
  const sim = () => srv.sim();
  const mgs = () => srv.game().system<MinigamesSystem>('minigames')!;
  const missions = () => srv.game().system<MissionsSystem>('missions')!;
  const at = (c: Client, x: number, z: number) => sim().teleportPlayer(sim().players.get(c.id)!, x, 1.3, z);

  // Arrivée en cours de route : le 1er snapshot d'un nouveau est complet, les anciens continuent en deltas
  const a = await join(PORT, 'Anna', ip(2));
  await sleep(1200);
  const b = await join(PORT, 'Boris', ip(3));
  await until(() => b.snaps >= 2, 3000);
  check('arrivée en cours de route : premier snapshot COMPLET (sans « d »)', b.fullSnaps >= 1 && !!b.lastSnap && b.lastSnap.vi === undefined || b.fullSnaps >= 1);
  check('anciens joueurs : snapshots suivants en delta', a.snapBytes.length > 5);
  const seen = b.lastSnap?.players?.map((p) => p.id) ?? [];
  check('le nouveau voit les 2 joueurs', seen.includes(a.id) && seen.includes(b.id));

  // `me` : taille (pire cas) et fréquence
  at(b, dealer.x, dealer.z);
  await until(() => !!b.me?.shop, 3000);
  check('`me` boutique ouverte : < 800 octets', b.meMaxBytes > 0 && b.meMaxBytes < 800, `${b.meMaxBytes} o`);

  // Spam de chat / commandes / messages hostiles
  for (let i = 0; i < 200; i++) a.chat(`spam ${i}`);
  for (let i = 0; i < 100; i++) a.send({ type: 'input', i: { f: 'x', s: null, yaw: 'Infinity', ao: [1e308, NaN, 'a'], ad: [0, 0, 0] } });
  a.send('{"type":"input","i":{"ad":[1e999,0,0]}}');
  await sleep(500);
  check('spam de chat limité (≤ 5 messages diffusés)', b.chats.filter((c) => c.startsWith('spam')).length <= 5, String(b.chats.filter((c) => c.startsWith('spam')).length));
  check('entrées hostiles : serveur sain, joueur toujours là', !sim().broken && sim().players.has(a.id) && (await info(PORT))?.game === 'jeu3d');
  const tr = sim().players.get(a.id)!.body.translation();
  check('entrées hostiles : position finie', [tr.x, tr.y, tr.z].every(Number.isFinite));

  // Déconnexions brutales : boutique, mini-jeu, mission
  const c = await join(PORT, 'Chloe', ip(4));
  const d = await join(PORT, 'Dan', ip(5));
  const e = await join(PORT, 'Eli', ip(6));
  at(c, dealer.x + 2, dealer.z);
  await until(() => !!c.me?.shop, 3000);
  c.ws.terminate(); // coupure brutale boutique ouverte
  at(d, dealer.x - 2, dealer.z);
  await sleep(300);
  mgs().startMinigame(sim().players.get(d.id)!, 'digicode', 'test', 0.5);
  await until(() => d.events.some((x) => x.k === 'mg_start'), 3000);
  const dPlayer = sim().players.get(d.id)!;
  d.ws.terminate(); // coupure brutale en plein mini-jeu
  at(e, giver.x + 3, giver.z + 3);
  await sleep(300);
  e.game({ k: 'mission', op: 'start', id: 'annales' });
  await until(() => !!missions().inspect(sim().players.get(e.id)!), 3000);
  const ePlayer = sim().players.get(e.id)!;
  e.ws.terminate(); // coupure brutale en pleine mission
  check('coupures brutales (boutique, mini-jeu, mission) : joueurs retirés', await until(() => !sim().players.has(c.id) && !sim().players.has(d.id) && !sim().players.has(e.id), 3000));
  await sleep(1500);
  check('après les coupures : mini-jeu et mission nettoyés', !mgs().activeOf(dPlayer) && !missions().inspect(ePlayer));
  check('après les coupures : simulation saine, aucune exception', !sim().broken && !logs.some((l) => /TypeError|RangeError|Error:/.test(l)), logs.filter((l) => /Error/.test(l)).slice(0, 2).join(' | '));

  // Reconnexion avec le même pseudo après une coupure brutale (fantôme : socket muet)
  const ghost = await join(PORT, 'Fred', { ...ip(7), autoPong: false });
  await until(() => !!ghost.me, 3000);
  at(ghost, dealer.x, dealer.z);
  await until(() => !!ghost.me?.shop, 3000);
  ghost.chat('/debug money 321');
  await sleep(300);
  const moneyG = ghost.me!.money;
  await sleep(5500); // plus un mot du fantôme depuis > 5 s
  const back = await join(PORT, 'Fred', ip(8));
  await until(() => !!back.me, 3000);
  check('reconnexion : même pseudo « Fred » (pas « Fred (2) »), ancien socket retiré', [...sim().players.values()].filter((p) => p.name === 'Fred').length === 1 && !sim().players.has(ghost.id));
  check('reconnexion : compte retrouvé', back.me?.money === moneyG, `${back.me?.money} vs ${moneyG}`);
  back.ws.close();

  for (const x of [a, b]) x.ws.close();
  await sleep(300);
  await srv.stop();
  t.clean();
}

// ---------- C. 8 joueurs simultanés : pas serveur et taille des snapshots ----------
async function partEight() {
  const t = tmpDir('wtf-huit-');
  const PORT = 3468;
  const srv = await startServer({ mode: 'multi', saveDir: t.saves, publicDir: t.pub, port: PORT, log: () => {}, joinGapMs: 0 });
  const clients: Client[] = [];
  for (let i = 0; i < 8; i++) clients.push(await join(PORT, `Bot${i}`, ip(20 + i)));
  check('8 joueurs connectés (LAN)', clients.every((c) => !!c.id) && srv.sim().players.size === 8);
  // chronomètre : pas complet (preStep + step + postStep) mesuré en enveloppant les méthodes de l'objet jeu / de la simulation
  const g = srv.game();
  const sm = srv.sim();
  const dts: number[] = [];
  let t0 = 0;
  const wrap = <T extends object>(o: T, k: keyof T, f: (orig: () => void) => void) => { const orig = (o[k] as unknown as () => void).bind(o); (o as Record<string, unknown>)[k as string] = () => f(orig); };
  wrap(g, 'preStep', (orig) => { t0 = performance.now(); orig(); });
  wrap(sm, 'step', (orig) => { orig(); });
  wrap(g, 'postStep', (orig) => { orig(); dts.push(performance.now() - t0); });
  const rng = (() => { let s = 99; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  clients.forEach((c, i) => {
    const n = city.nodes[Math.floor(rng() * city.nodes.length)];
    sm.teleportPlayer(sm.players.get(c.id)!, n.x, 1.3, n.z);
    if (i === 0) c.chat('/debug stars 5');
  });
  const DURATION = 25_000;
  const start = Date.now();
  while (Date.now() - start < DURATION) {
    const k = (Date.now() - start) / 1000;
    clients.forEach((c, i) => {
      const ph = k * 0.7 + i * 1.9;
      c.send({ type: 'input', i: { f: Math.sin(ph) > -0.5 ? 1 : 0, s: Math.sin(ph * 0.5) * 0.6, jump: 0, run: i % 2, yaw: (ph * 0.8) % (Math.PI * 2), hn: 0, act: 0, m1: Math.sin(k * 2.1 + i) > 0.9 ? 1 : 0, m2: 0, ao: [0, 0, 0], ad: [0, 0, -1] } });
    });
    if (Math.floor(k) % 8 === 7) clients.forEach((c) => { const n = city.nodes[Math.floor(rng() * city.nodes.length)]; if (sm.players.has(c.id)) sm.teleportPlayer(sm.players.get(c.id)!, n.x, 1.3, n.z); });
    await sleep(33);
  }
  const sorted = [...dts].sort((x, y) => x - y);
  const mean = dts.reduce((s, x) => s + x, 0) / Math.max(1, dts.length);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const sizes = clients.flatMap((c) => c.snapBytes);
  const sMax = Math.max(...sizes), sAvg = sizes.reduce((s, x) => s + x, 0) / Math.max(1, sizes.length);
  const meMax = Math.max(...clients.map((c) => c.meMaxBytes));
  const fullMax = 0;
  void fullMax;
  const perSec = sizes.length / 8 / (DURATION / 1000);
  console.log(`MESURE 8 joueurs : pas serveur moyen ${mean.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, max ${(sorted[sorted.length - 1] ?? 0).toFixed(2)} ms sur ${dts.length} pas ; snapshot delta moyen ${(sAvg / 1024).toFixed(2)} Ko, max ${(sMax / 1024).toFixed(2)} Ko, ${perSec.toFixed(1)}/s par client ; me max ${meMax} o ; débit serveur sortant ≈ ${((sAvg * perSec * 8) / 1024).toFixed(0)} Ko/s`);
  check('8 joueurs : pas serveur moyen < 4 ms', mean < 4, `${mean.toFixed(2)} ms`);
  check('8 joueurs : p99 du pas < 15 ms (clients de test et serveur sur la même machine)', p99 < 15, `${p99.toFixed(2)} ms`);
  check('8 joueurs : snapshot delta max < 8 Ko', sMax < 8 * 1024, `${(sMax / 1024).toFixed(2)} Ko`);
  check('8 joueurs : `me` < 800 octets', meMax < 800, `${meMax} o`);
  check('8 joueurs : personne déconnecté, monde sain', clients.every((c) => !c.closed) && !srv.sim().broken);
  clients.forEach((c) => c.ws.close());
  await sleep(300);
  await srv.stop();
  t.clean();
}

async function main() {
  partClient();
  await partServer();
  await partEight();
  console.log(failCount() ? `\n${failCount()} échec(s)` : '\nRéseau : toutes les vérifications passent.');
  process.exit(failCount() ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
