// Non-régression robustesse (audits code + sécurité) : npx tsx tests/robustesse.ts
// Partie 1 : simulation seule (corps retirés = monde empoisonné, sauvegardes, pseudos, anti-enclavement).
// Partie 2 : vrai serveur sur les ports 3450 à 3452 avec des clients `ws` jetables (HTTP/WS malveillants, chef de bande, disjoncteur, heartbeat, sauvegarde).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { getCity } from '../shared/city/layout';
import { startServer, hostAllowed } from '../server/server';
import { unpackMe } from '../shared/me';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const errors: string[] = [];
const fresh = async () => {
  const s = await Sim.create();
  s.log = (l) => errors.push(l);
  s.onAnnounce = () => {};
  return s;
};
/** Avance de n pas ; sain = aucune exception, monde non empoisonné et temps qui avance. */
function steps(sim: Sim, n: number, each?: (k: number) => void) {
  const t0 = sim.time;
  let err = '';
  for (let k = 0; k < n && !err; k++) {
    try { each?.(k); sim.step(); } catch (e) { err = String((e as Error)?.message ?? e); }
  }
  return { ok: !err && !sim.broken && sim.time > t0 + (n - 2) * STEP * 1000, err };
}
/** Provoque la panique Rapier : lecture d'un corps retiré du monde. */
function poison(sim: Sim) {
  const b = sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  sim.world.removeRigidBody(b);
  try { b.translation(); } catch { /* attendu : le monde est maintenant empoisonné */ }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(x = 192, z = 192) { // (192, 192) = une intersection (les rues sont sur les multiples de 64)
  const sim = await fresh();
  sim.addPlayer('p1', 'Bob');
  const bob = sim.players.get('p1')!;
  steps(sim, 60);
  sim.teleportPlayer(bob, x, 1, z);
  steps(sim, 30);
  return { sim, bob };
}
async function partSim() {
  // ---------- A1. Conducteur : véhicule détruit / joueur déconnecté pendant la conduite ----------
  for (const how of ['détruit', 'déconnecté', 'téléporté hors du véhicule']) {
    const { sim, bob } = await setup(0, -36);
    const car = sim.vehicles.find((v) => v.def.type === 'citadine' && !v.pooled && !v.dead)!;
    sim.enterVehicle(bob, car, 0);
    sim.setInput('p1', { f: 1, s: 0.5, m1: 1 });
    steps(sim, 30);
    check(`conduite (${how}) : conducteur bien installé avant le test`, bob.vehicle === car);
    if (how === 'détruit') sim.damageVehicle(car, 1e9, 'bullet', null);
    else if (how === 'déconnecté') sim.removePlayer('p1');
    else sim.teleportPlayer(bob, 100, 1, 100);
    const r = steps(sim, 120);
    check(`conduite (${how}) : 120 pas sans exception, le temps avance`, r.ok, r.err);
    sim.addPlayer('p9', 'Retour');
    check(`conduite (${how}) : un joueur peut arriver ensuite`, steps(sim, 30).ok);
  }

  // ---------- A2. Projectile dont le tireur s'est déconnecté ----------
  {
    const { sim, bob } = await setup(-320, -320);
    sim.addPlayer('p2', 'Cy');
    const cy = sim.players.get('p2')!;
    const t = bob.body.translation();
    sim.teleportPlayer(cy, t.x, 1, t.z - 30);
    sim.spawnProjectile({ kind: 'rocket', pos: V(t.x, 1, t.z - 2), vel: V(0, 0, -20), owner: bob, radius: 5, power: 10, damage: 30 });
    sim.removePlayer('p1');
    const r = steps(sim, 180);
    check('roquette dont le tireur est parti : 180 pas sans exception', r.ok, r.err);
  }

  // ---------- A3. 400 props (le plafond évince le plus ancien) ----------
  {
    const { sim } = await setup();
    for (let i = 0; sim.props.size < 400; i++) sim.spawnProp('crate_s', V(260 + (i % 20) * 2, 0.5, 260 + Math.floor(i / 20) * 2));
    for (let i = 0; i < 20; i++) sim.spawnProp('crate_m', V(200 + i * 0.1, 1.3 + i, 195));
    const r = steps(sim, 120);
    check('plafond de props atteint : 120 pas sans exception, plafond respecté', r.ok && sim.props.size <= 400, `${sim.props.size} props ${r.err}`);
  }

  // ---------- A5. disjoncteur (niveau simulation) ----------
  {
    const { sim } = await setup();
    sim.setInput('p1', { f: 1, m1: 1, ad: [0, 0, -1] });
    steps(sim, 5);
    poison(sim);
    let threw = false;
    try { sim.step(); sim.step(); } catch { threw = true; }
    check('disjoncteur : panique détectée (broken), step() ne lève pas', sim.broken && !threw);
    const t = sim.time;
    sim.step();
    check('disjoncteur : un monde cassé ne tourne plus', sim.time === t);
    check('disjoncteur : positions connues sans toucher Rapier', sim.knownPlayers().length === 1 && sim.knownPlayers()[0].pos.every(Number.isFinite));
    sim.dispose();
  }

  // ---------- B2/B3. pseudos dangereux, sauvegardes ----------
  {
    const sim = await fresh();
    const names = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];
    let threw = false;
    try { names.forEach((n, i) => sim.addPlayer(`q${i}`, n)); } catch { threw = true; }
    check('pseudos constructor/__proto__/… : addPlayer sans exception', !threw && sim.players.size === names.length);
    const r = steps(sim, 1900); // > 30 s : ils sont mémorisés à leur départ
    check('pseudos : simulation saine', r.ok, r.err);
    names.forEach((_, i) => sim.removePlayer(`q${i}`));
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    check('pseudos : prototype d\'Object intact', Object.getPrototypeOf({}) === Object.prototype && ({} as Record<string, unknown>).polluted === undefined
      && Array.isArray((Object.getOwnPropertyDescriptor(data.players, 'constructor') ?? {}).value));
    const b = await fresh();
    b.restore(data);
    b.addPlayer('r1', 'constructor');
    const t = b.players.get('r1')!.body.translation();
    check('pseudo « constructor » : position sauvegardée restaurée', Math.abs(t.x - data.players.constructor[0]) < 1.5);
    // deux joueurs connectés de même pseudo ne partagent pas la position
    b.addPlayer('r2', 'constructor');
    const t2 = b.players.get('r2')!.body.translation();
    check('même pseudo : pas de position partagée', Math.hypot(t2.x - t.x, t2.z - t.z) > 0.01 || data.players.constructor[0] === 0);

    // passage éclair : non mémorisé
    const c = await fresh();
    c.addPlayer('z', 'Zed');
    steps(c, 300);
    c.removePlayer('z');
    check('joueur resté < 30 s : non enregistré', !('Zed' in c.serialize().players));

    // sauvegarde corrompue / ancienne
    const d = await fresh();
    const bad = JSON.parse('{"version":3,"systems":{"__proto__":{"x":1}},'
      + '"players":{"__proto__":[1,2,3],"constructor":[1,2,3],"prototype":[1,2,3],"ok":[5,5,5],"bad":[1],"nan":[1,null,3]}}');
    let t3 = false;
    try { d.restore(bad); d.restore({ version: 3, players: [], systems: 7 } as never); d.restore('x' as never); } catch { t3 = true; }
    check('sauvegarde corrompue : ignorée sans exception', !t3);
    const keys = Object.keys(d.serialize().players);
    check('sauvegarde corrompue : clés interdites et entrées invalides ignorées', keys.length === 1 && keys[0] === 'ok', keys.join(','));
    check('sauvegarde corrompue : simulation toujours saine', steps(d, 60).ok);
    const e = await fresh();
    e.restore({ version: 1, crates: [], vehicles: [], players: { Vieux: [1, 1, 1] } } as never);
    e.restore({ version: 2, props: [], vehicles: [], players: { Vieux: [1, 1, 1] } } as never);
    check('sauvegardes anciennes (v1, v2) : ignorées', steps(e, 10).ok && !('Vieux' in e.serialize().players));
    const many: Record<string, number[]> = {};
    for (let i = 0; i < 350; i++) many[`J${i}`] = [i, 1, i];
    const f = await fresh();
    f.restore({ version: 3, systems: {}, players: many } as never);
    const ks = Object.keys(f.serialize().players);
    check('sauvegarde : plafond de 200 joueurs mémorisés (FIFO)', ks.length === 200 && ks.includes('J349') && !ks.includes('J0'), String(ks.length));
  }

  // ---------- D2. anti-enclavement des joueurs restaurés (sous le sol, dans un bâtiment) ----------
  {
    const a = await fresh();
    steps(a, 5);
    const bd = getCity().buildings[20]; // bloc fixe du décor (collision)
    const data = a.serialize();
    data.players = { Sous: [10, -8, 10], Bloc: [bd.x, 1, bd.z] };
    const b = await fresh();
    b.restore(data);
    b.addPlayer('s1', 'Sous');
    b.addPlayer('s2', 'Bloc');
    const ys = ['s1', 's2'].map((id) => b.players.get(id)!.body.translation());
    check('joueurs restaurés sous le sol / dans un bâtiment : replacés', ys[0].y > 0 && ys[1].y > 0);
    const inside = (t: { x: number; y: number; z: number }) => Math.abs(t.x - bd.x) < bd.w / 2 && Math.abs(t.z - bd.z) < bd.d / 2 && t.y < bd.h - 0.2;
    check('joueur restauré dans un bâtiment : jamais à l intérieur', !inside(ys[1]));
    check('simulation saine après restauration', steps(b, 120).ok);
  }

  // ---------- C3. ao borné dans setInput ----------
  {
    const { sim, bob } = await setup();
    sim.setInput('p1', { ao: [1000, 1000, 1000] });
    const ao = bob.input.ao;
    const t = bob.body.translation();
    check('ao : origine de visée bornée à 12 m de la tête', Math.hypot(ao[0] - t.x, ao[1] - t.y - 0.7, ao[2] - t.z) <= 12.01);
  }
}

// ---------- Partie 2 : vrai serveur ----------
function httpGet(port: number, p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    });
    req.on('error', () => resolve({ status: 0, headers: {} }));
    req.end();
  });
}
const info = async (port: number) => {
  try { return (await (await fetch(`http://127.0.0.1:${port}/info`)).json()) as { game?: string; players: number }; } catch { return null; }
};

interface Client { ws: WebSocket; msgs: { type: string; [k: string]: unknown }[]; closed: boolean; closedAt: number; snaps: number }
function connect(port: number, opts: ConstructorParameters<typeof WebSocket>[2] = {}): Promise<Client> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, opts);
    const c: Client = { ws, msgs: [], closed: false, closedAt: 0, snaps: 0 };
    ws.on('message', (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m.type === 'snap') c.snaps++; else c.msgs.push(m);
      } catch { /* ignoré */ }
    });
    ws.on('close', () => { c.closed = true; c.closedAt = Date.now(); });
    ws.on('error', () => { c.closed = true; resolve(c); });
    ws.on('open', () => resolve(c));
  });
}
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(30); return f(); };
const chatHas = (c: Client, re: RegExp) => c.msgs.some((m) => m.type === 'chat' && re.test(String((m.m as { text?: string })?.text ?? '')));

async function partServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtf-robustesse-'));
  const pub = path.join(dir, 'public');
  fs.mkdirSync(pub);
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>t</title>');
  const logs: string[] = [];
  const PORT = 3450;
  const srv = await startServer({ mode: 'multi', saveDir: path.join(dir, 'saves'), publicDir: pub, port: PORT, log: (l) => logs.push(l) });
  check('serveur : démarré sur le port de test', srv.port === PORT);

  // ----- HTTP malformé -----
  const bad1 = await httpGet(PORT, '/%E0%A4%A');
  check('GET /%E0%A4%A : 400 sans planter', bad1.status === 400, String(bad1.status));
  const bad2 = await httpGet(PORT, '/%00');
  check('GET /%00 : 400 sans planter', bad2.status === 400, String(bad2.status));
  const ok = await httpGet(PORT, '/');
  check('GET / : 200 + X-Content-Type-Options: nosniff', ok.status === 200 && ok.headers['x-content-type-options'] === 'nosniff');
  const trav = await httpGet(PORT, '/..%2f..%2fsecret');
  check('traversée de dossier refusée', trav.status === 403 || trav.status === 404, String(trav.status));

  // ----- Origine étrangère / même origine -----
  const evil = await connect(PORT, { headers: { Origin: 'http://evil.example' } });
  await sleep(300);
  check('WebSocket : Origin étrangère refusée', evil.closed && evil.msgs.length === 0);
  const sameOrigin = await connect(PORT, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
  check('WebSocket : même origine acceptée', !sameOrigin.closed);
  sameOrigin.ws.close();

  // ----- Socket muet fermé sous 5 s -----
  const mute = await connect(PORT);
  const tMute = Date.now();

  // ----- Joueurs : pseudos, hôte -----
  const A = await connect(PORT);
  A.ws.send(JSON.stringify({ type: 'join', name: 'constructor' }));
  check('pseudo « constructor » : accepté (welcome)', await until(() => A.msgs.some((m) => m.type === 'welcome'), 2000));
  A.ws.send('null');
  A.ws.send('[1,2]');
  A.ws.send('42');
  A.ws.send(JSON.stringify({ type: 'input', i: null }));
  await sleep(2100);
  const B = await connect(PORT);
  B.ws.send(JSON.stringify({ type: 'join', name: 'constructor' }));
  check('2e « constructor » : accepté', await until(() => B.msgs.some((m) => m.type === 'welcome'), 2000));
  const names = [...srv.sim().players.values()].map((p) => p.name);
  check('pseudo déjà pris : suffixe (2)', names.includes('constructor') && names.includes('constructor (2)'), names.join('|'));
  check('serveur vivant après message « null »', (await info(PORT))?.game === 'jeu3d');

  // Les anciennes commandes du jeu WTF n'existent plus : réponse privée « inconnue », rien de diffusé
  const msgsA = A.msgs.length;
  B.ws.send(JSON.stringify({ type: 'chat', text: '/gravite 999' }));
  B.ws.send(JSON.stringify({ type: 'chat', text: '/reset oui' }));
  check('commandes supprimées (/gravite, /reset) : « inconnue » pour l auteur', await until(() => B.msgs.filter((m) => m.type === 'chat' && /Commande inconnue/.test(String((m.m as { text: string }).text))).length >= 2, 2000));
  await sleep(200);
  check('commandes supprimées : rien n est diffusé aux autres', A.msgs.slice(msgsA).every((m) => m.type !== 'chat'));
  B.ws.send(JSON.stringify({ type: 'chat', text: '/help' }));
  check('/help : liste des commandes restantes', await until(() => chatHas(B, /Commandes : .*drive/), 2000));
  const welcomeOf = (c: Client) => String(c.msgs.find((m) => m.type === 'welcome')?.id);
  check('chef de la bande = premier arrivé', srv.sim().hostId === welcomeOf(A), srv.sim().hostId);

  // ----- Message trop gros, mot réservé, rythme des join -----
  await sleep(2100);
  const C = await connect(PORT);
  C.ws.send(JSON.stringify({ type: 'join', name: 'Admin' }));
  await until(() => C.msgs.some((m) => m.type === 'welcome'), 2000);
  const cname = [...srv.sim().players.values()].map((p) => p.name).find((n) => /^Joueur\d+$/.test(n));
  check('mot réservé « Admin » : remplacé', !!cname && ![...srv.sim().players.values()].some((p) => p.name.toLowerCase() === 'admin'));
  const D = await connect(PORT);
  D.ws.send(JSON.stringify({ type: 'join', name: 'Vite' }));
  await sleep(300);
  check('5e socket de la même IP (plafond 4) : refusé', D.closed && !D.msgs.some((m) => m.type === 'welcome'));
  C.ws.send('x'.repeat(5000));
  check('message de 5 000 octets : socket fermé, serveur vivant', await until(() => C.closed, 2000) && (await info(PORT))?.game === 'jeu3d');
  D.ws.close();

  // ----- Disjoncteur sur le vrai serveur -----
  const before = srv.sim();
  const snapsBefore = A.snaps;
  poison(before);
  check('disjoncteur : le serveur reconstruit la simulation', await until(() => srv.sim() !== before, 4000));
  const after = srv.sim();
  check('disjoncteur : les 2 joueurs connectés sont conservés', after.players.size === 2 && !after.broken, String(after.players.size));
  check('disjoncteur : annonce « Le monde a hoqueté »', await until(() => chatHas(A, /Le monde a hoqueté/), 2000));
  await sleep(500);
  check('disjoncteur : les clients reçoivent toujours des snapshots', A.snaps > snapsBefore + 3 && !A.closed && !B.closed);
  const t0 = after.time;
  await sleep(400);
  check('disjoncteur : la simulation avance', after.time > t0);
  check('chef de la bande conservé après reconstruction', after.hostId === welcomeOf(A), after.hostId);

  // ----- Hôte parti : le plus ancien reprend -----
  A.ws.close();
  await until(() => srv.sim().players.size === 1, 2000);
  check('hôte parti : le joueur le plus ancien devient chef', await until(() => chatHas(B, /nouveau chef/) && srv.sim().hostId === welcomeOf(B), 2000));

  // ----- Muet fermé sous 5 s -----
  await until(() => mute.closed, 7000);
  const dt = mute.closedAt - tMute;
  check('socket muet fermé sous 5 s', mute.closed && dt < 6500, `${dt} ms`);

  // ----- Messages `game` malformés / hostiles : aucun effet, aucune exception, aucune déconnexion -----
  {
    const prefix = Object.keys(Object.prototype).length;
    const nPlayers = srv.sim().players.size;
    const before = srv.sim().time;
    const hostile: string[] = [
      '{"type":"game"}', '{"type":"game","m":null}', '{"type":"game","m":[]}', '{"type":"game","m":"trade"}', '{"type":"game","m":42}',
      '{"type":"game","m":{"k":"trade"}}', '{"type":"game","m":{"k":"trade","dealer":5,"good":{},"qty":"beaucoup","side":[]}}',
      '{"type":"game","m":{"k":"trade","dealer":"d","good":"cafe_machine","qty":-5,"side":"buy"}}',
      '{"type":"game","m":{"k":"trade","dealer":"d","good":"cafe_machine","qty":1e308,"side":"buy"}}',
      '{"type":"game","m":{"k":"__proto__","polluted":true}}',
      '{"type":"game","m":{"__proto__":{"polluted":true},"k":"sms_lu","id":1}}',
      '{"type":"game","__proto__":{"polluted":true},"m":{"k":"sms_lu","id":1}}',
      '{"type":"game","m":{"k":"mg","r":{"sid":"x","ok":1,"ms":-1,"data":"zzz"}}}',
      '{"type":"game","m":{"k":"mission","op":"start","id":"' + 'x'.repeat(3000) + '"}}', // énorme (mais sous la limite du socket)
      '{"type":"game","m":{"k":"sms_lu","id":1,"pad":"' + 'y'.repeat(900) + '"}}', // trop long pour un message de jeu
      '{"type":"game","m":{"k":"constructor"}}', '{"type":"game","m":{"k":"toString"}}',
    ];
    for (const h of hostile) B.ws.send(h);
    for (let i = 0; i < 80; i++) B.ws.send('{"type":"game","m":{"k":"sms_lu","id":' + i + '}}'); // rafale : limitée à 20/s
    const stranger = await connect(PORT);
    stranger.ws.send('{"type":"game","m":{"k":"sms_lu","id":1}}'); // pas encore « join » : ignoré
    await sleep(500);
    check('messages `game` hostiles : serveur vivant, mêmes joueurs, simulation qui avance',
      (await info(PORT))?.game === 'jeu3d' && srv.sim().players.size === nPlayers && srv.sim().time > before && !srv.sim().broken);
    check('messages `game` hostiles : socket du joueur toujours ouvert, aucune réponse d erreur', !B.closed && !B.msgs.some((m) => m.type === 'error'));
    check('messages `game` hostiles : Object.prototype non pollué', ({} as Record<string, unknown>).polluted === undefined && Object.keys(Object.prototype).length === prefix);
    const bad = logs.filter((l) => /\[game\]|TypeError|RangeError/.test(l));
    check('messages `game` hostiles : aucune exception dans le journal', bad.length === 0, bad.slice(0, 2).join(' | '));
    stranger.ws.close();
    // état privé : au moins un message `me`, bien formé, et pas de déluge (envoyé seulement s'il change)
    const meMsgs = B.msgs.filter((m) => m.type === 'me');
    const s0 = unpackMe(meMsgs[0]?.s);
    check('message `me` reçu : état privé bien formé (format compact, relu par unpackMe)', meMsgs.length >= 1 && !!s0 && s0.money >= 0 && s0.stars === 0 && typeof s0.district === 'string' && Array.isArray(s0.marks) && typeof s0.bag === 'object');
    const n0 = B.msgs.filter((m) => m.type === 'me').length;
    await sleep(1200);
    check('message `me` : pas renvoyé tant que l état ne change pas', B.msgs.filter((m) => m.type === 'me').length - n0 <= 1, String(B.msgs.filter((m) => m.type === 'me').length - n0));
  }

  await sleep(2100); // un join par IP toutes les 2 s : on laisse passer le délai avant le test
  const E = await connect(PORT);
  E.ws.send(JSON.stringify({ type: 'join', name: 'Eve' }));
  await until(() => E.msgs.some((m) => m.type === 'welcome'), 2000);
  const F = await connect(PORT);
  F.ws.send(JSON.stringify({ type: 'join', name: 'Fred' }));
  check('2 join en moins de 2 s depuis la même IP : le 2e est refusé', await until(() => F.msgs.some((m) => m.type === 'error'), 2000) && !F.msgs.some((m) => m.type === 'welcome'), JSON.stringify(F.msgs) + ' closed=' + F.closed);
  E.ws.close(); F.ws.close();
  check('serveur toujours vivant (/info)', (await info(PORT))?.game === 'jeu3d');
  const thrownLogs = logs.filter((l) => /uncaught|TypeError|URIError/i.test(l));
  check('aucune exception non gérée dans le journal', thrownLogs.length === 0, thrownLogs.join(' | '));
  B.ws.close();
  await sleep(100);
  await srv.stop();
  check('stop() : simulation libérée', srv.sim().broken === true);
  const saveFile = path.join(dir, 'saves', 'multi.json');
  let saved: { version?: number; players?: unknown; systems?: unknown; game?: unknown; props?: unknown } = {};
  try { saved = JSON.parse(fs.readFileSync(saveFile, 'utf8')); } catch { /* absent */ }
  check('sauvegarde serveur : fichier écrit (version 3, joueurs, systèmes)', saved.version === 3 && typeof saved.players === 'object' && typeof saved.systems === 'object' && !('game' in saved) && !('props' in saved), JSON.stringify(Object.keys(saved)));
  check('sauvegarde serveur : pas de fichier temporaire restant', !fs.existsSync(saveFile + '.tmp'));
  const logs3: string[] = [];
  const srv3 = await startServer({ mode: 'multi', saveDir: path.join(dir, 'saves'), publicDir: pub, port: 3452, log: (l) => logs3.push(l) });
  check('redémarrage : la sauvegarde est rechargée', logs3.some((l) => /Sauvegarde chargée/.test(l)));
  await srv3.stop();

  // ----- Heartbeat : joueur fantôme (socket qui ne répond plus aux ping) -----
  const PORT2 = 3451;
  const srv2 = await startServer({ mode: 'multi', saveDir: path.join(dir, 'saves2'), publicDir: pub, port: PORT2, log: (l) => logs.push(l), heartbeatMs: 300 });
  const G = await connect(PORT2, { autoPong: false } as never);
  G.ws.send(JSON.stringify({ type: 'join', name: 'Fantome' }));
  await until(() => G.msgs.some((m) => m.type === 'welcome'), 2000);
  check('heartbeat : fantôme connecté', srv2.sim().players.size === 1);
  await sleep(1500);
  check('heartbeat : socket muet aux ping retiré, slot libéré', srv2.sim().players.size === 0 && (await info(PORT2))?.players === 0);
  await sleep(2100);
  const H = await connect(PORT2); // un vivant (répond aux ping automatiquement) reste
  H.ws.send(JSON.stringify({ type: 'join', name: 'Vivant' }));
  await until(() => H.msgs.some((m) => m.type === 'welcome'), 2000);
  await sleep(1500);
  check('heartbeat : un client vivant n\'est pas retiré', srv2.sim().players.size === 1 && !H.closed);
  H.ws.close();
  await sleep(100);
  await srv2.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- Partie 3 : audit de sécurité (hôte, CSP, seau à jetons, secrets de pseudo, éviction de comptes) ----------
async function partSecurity() {
  check('hostAllowed : localhost, 127.x, [::1], IPv4 privées et lien local avec port', ['localhost', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.20:3000', '10.0.0.5', '172.16.0.1:80', '172.31.9.9', '169.254.1.1:3000'].every((h) => hostAllowed(h)));
  check('hostAllowed : refuse domaines, IP publiques, ports absurdes, IPv4 invalides, vide', ['evil.example', 'evil.example:3000', 'localhost.evil.com', '8.8.8.8:3000', '172.32.0.1', '192.169.0.1', '127.0.0.1:99999', '300.1.1.1', '', 'a b', '127.0.0.1.evil.com'].every((h) => !hostAllowed(h)) && !hostAllowed(undefined));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtf-secu-'));
  const pub = path.join(dir, 'public');
  fs.mkdirSync(pub);
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>t</title>');
  const saves = path.join(dir, 'saves');
  fs.mkdirSync(saves);
  // 100 comptes garnis + 28 comptes vides, hors ligne : de nouveaux pseudos ne doivent évincer que des comptes vides
  const accounts: unknown[] = [];
  for (let i = 0; i < 100; i++) accounts.push([`Riche${i}`, 5000 + i, [['cafe_machine', 1]], [], 1]);
  for (let i = 0; i < 28; i++) accounts.push([`Vide${i}`, 200, [], [], 1]);
  fs.writeFileSync(path.join(saves, 'multi.json'), JSON.stringify({ version: 3, players: {}, systems: { economy: { v: 1, accounts, camsDown: [] } } }));
  const logs: string[] = [];
  const PORT = 3453;
  let srv = await startServer({ mode: 'multi', saveDir: saves, publicDir: pub, port: PORT, log: (l) => logs.push(l), joinGapMs: 0 });

  // ----- B1 : en-tête Host -----
  const getH = (host: string, p = '/') => new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET', headers: { Host: host } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, headers: res.headers }); });
    req.on('error', () => resolve({ status: 0, headers: {} }));
    req.end();
  });
  check('HTTP : Host d un nom de domaine refusé (400)', (await getH('evil.example:3453')).status === 400);
  check('HTTP : Host en IPv4 privée accepté', (await getH('192.168.1.20:3453')).status === 200);
  const page = await getH(`127.0.0.1:${PORT}`);
  const csp = String(page.headers['content-security-policy']);
  check('HTTP : X-Frame-Options DENY + CSP (default-src self, connect-src ws:) sur la page', page.headers['x-frame-options'] === 'DENY' && /default-src 'self'/.test(csp) && /connect-src 'self' ws: wss:/.test(csp));
  const evilWs = await new Promise<boolean>((resolve) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Host: 'evil.example' } }); w.on('open', () => { w.close(); resolve(false); }); w.on('error', () => resolve(true)); });
  check('WebSocket : Host d un nom de domaine refusé', evilWs);

  // ----- M3 : seau à jetons -----
  const spam = await connect(PORT);
  for (let i = 0; i < 1500; i++) spam.ws.send('{"type":"chat","text":"x"}'); // jamais joint : seul « join » est analysé
  check('socket non joint qui inonde de messages : coupé', await until(() => spam.closed, 3000));
  const J = await connect(PORT);
  J.ws.send(JSON.stringify({ type: 'join', name: 'Flood' }));
  await until(() => J.msgs.some((m) => m.type === 'welcome'), 2000);
  const pid = String(J.msgs.find((m) => m.type === 'welcome')?.id);
  for (let i = 0; i < 60; i++) { J.ws.send('{"type":"input","i":{"f":1}}'); await sleep(16); } // ~60 messages/s : légitime
  check('60 messages/s légitimes : socket conservé', !J.closed && srv.sim().players.has(pid));
  for (let i = 0; i < 700; i++) J.ws.send('{"type":"interact"}');
  check('700 interact en rafale : ignorés puis socket coupé', await until(() => J.closed, 3000));
  await sleep(200);
  check('serveur sain après les inondations', (await info(PORT))?.game === 'jeu3d' && !srv.sim().broken && !srv.sim().players.has(pid));

  // ----- M1 : secret de pseudo -----
  const names = () => [...srv.sim().players.values()].map((p) => p.name);
  const joinAs = async (name: string, secret?: string) => {
    const c = await connect(PORT);
    c.ws.send(JSON.stringify({ type: 'join', name, ...(secret ? { secret } : {}) }));
    await until(() => c.msgs.some((m) => m.type === 'welcome'), 2000);
    return c;
  };
  const A = await joinAs('Zoe', 'secret-aaaa-1111');
  check('1er join avec secret : pseudo lié', names().includes('Zoe'));
  A.ws.close();
  await until(() => !names().includes('Zoe'), 2000);
  const B = await joinAs('Zoe', 'autre-bbbb-2222');
  check('même pseudo, autre secret (même hors ligne) : Zoe (2), compte non volé', names().includes('Zoe (2)') && !names().includes('Zoe'), names().join('|'));
  const Bn = await joinAs('Zoe');
  check('même pseudo, sans secret : pas le compte lié', !names().includes('Zoe'), names().join('|'));
  const A2 = await joinAs('Zoe', 'secret-aaaa-1111');
  check('même pseudo, bon secret : retrouve Zoe', names().includes('Zoe'), names().join('|'));
  // compatibilité : un compte d'ancienne sauvegarde (sans lien) est lié par le premier qui le revendique
  for (const c of [B, Bn, A2]) c.ws.close(); // 4 sockets max par adresse
  await sleep(300);
  const L = await joinAs('Riche7', 'legacy-cccc-3333');
  const L2 = await joinAs('Riche7', 'voleur-dddd-4444');
  check('ancienne sauvegarde sans lien : le premier revendique, l autre est écarté', names().includes('Riche7') && names().includes('Riche7 (2)'), names().join('|'));
  const eco = () => srv.game().system<{ accountNames(): string[]; moneyOf(p: unknown): number }>('economy' as never)!;
  check('compte revendiqué : argent d origine', eco().moneyOf([...srv.sim().players.values()].find((p) => p.name === 'Riche7')) === 5007);
  for (const c of [L, L2]) c.ws.close();
  await sleep(400);

  // ----- M2 : pas d'éviction d'un compte garni par un pseudo inconnu -----
  const clients: Client[] = [];
  for (let i = 0; i < 10; i++) {
    clients.push(await joinAs(`Neuf${i}`, `neuf-secret-${i}-xxxx`));
    await sleep(60);
  }
  const accs = eco().accountNames();
  check('10 pseudos inconnus : aucun des 100 comptes garnis évincé', Array.from({ length: 100 }, (_, i) => `Riche${i}`).every((n) => accs.includes(n)), `${accs.length} comptes`);
  check('10 pseudos inconnus : plafond de comptes respecté', accs.length <= 128, String(accs.length));
  for (const c of clients) c.ws.close();
  await sleep(300);

  // ----- Plafond de pseudos distincts par adresse -----
  let refused = 0;
  for (let i = 0; i < 16; i++) {
    const c = await connect(PORT);
    c.ws.send(JSON.stringify({ type: 'join', name: `Essai${i}` }));
    await sleep(80);
    if (c.msgs.some((m) => m.type === 'error' && /Trop de pseudos/.test(String(m.message)))) refused++;
    c.ws.close();
    await sleep(40);
  }
  check('plus de 12 pseudos distincts depuis une même adresse : refusés', refused >= 3, `${refused} refus`);

  // ----- Les liens survivent à un redémarrage -----
  await srv.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(saves, 'multi.json'), 'utf8')) as { claims?: Record<string, string> };
  check('sauvegarde : les liens pseudo -> sha256(secret) sont enregistrés (jamais le secret)', !!saved.claims && /^[0-9a-f]{64}$/.test(saved.claims.Zoe ?? '') && !JSON.stringify(saved).includes('secret-aaaa-1111'));
  srv = await startServer({ mode: 'multi', saveDir: saves, publicDir: pub, port: PORT, log: (l) => logs.push(l), joinGapMs: 0 });
  const R = await joinAs('Zoe', 'voleur-eeee-5555');
  check('après redémarrage : le pseudo lié reste protégé', [...srv.sim().players.values()].some((p) => /^Zoe \(\d+\)$/.test(p.name)) && ![...srv.sim().players.values()].some((p) => p.name === 'Zoe'));
  R.ws.close();
  await sleep(100);
  await srv.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await partSim();
  await partServer();
  await partSecurity();
  console.log(fails ? `\n${fails} échec(s)` : '\nToutes les vérifications passent.');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
