// Non-régression robustesse (audits code + sécurité) : npx tsx tests/robustesse.ts
// Partie 1 : simulation seule (corps retirés = monde empoisonné, sauvegardes, pseudos, anti-enclavement).
// Partie 2 : vrai serveur sur les ports 3450/3451 avec des clients `ws` jetables (HTTP/WS malveillants, gouvernance, disjoncteur, heartbeat).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Sim } from '../shared/sim';
import { STEP, treeLayout } from '../shared/constants';
import { VEHICLE_BY_TYPE } from '../shared/vehicles';
import { installExtras } from '../server/extras';
import { startServer } from '../server/server';

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

async function setup(x = 200, z = 200) {
  const sim = await fresh();
  sim.addPlayer('p1', 'Bob');
  const bob = sim.players.get('p1')!;
  steps(sim, 60);
  sim.teleportPlayer(bob, x, 1, z);
  steps(sim, 30);
  return { sim, bob };
}
const aimAt = (sim: Sim, from: THREE.Vector3, to: THREE.Vector3, extra: object = {}) => {
  const d = to.clone().sub(from).normalize();
  return { ad: [d.x, d.y, d.z] as [number, number, number], ...extra };
};

async function partSim() {
  // ---------- A1. Physgun relâché après disparition de la cible ----------
  for (const how of ['gommé', 'détruit', 'déconnecté']) {
    const { sim, bob } = await setup();
    const head = () => { const t = bob.body.translation(); return V(t.x, t.y + 0.7, t.z); };
    let removeTarget: () => void;
    let center: THREE.Vector3;
    if (how === 'gommé') {
      const pr = sim.spawnProp('crate_m', V(200, 1.3, 196))!;
      center = V(200, 0.6, 196); // posé au sol
      removeTarget = () => sim.removeProp(pr);
    } else if (how === 'détruit') {
      const car = sim.vehicles.find((v) => v.def.type === 'car')!;
      const t = car.behavior.body.translation();
      sim.teleportPlayer(bob, t.x, 1, t.z + 6);
      center = V(t.x, t.y, t.z);
      removeTarget = () => sim.damageVehicle(car, 1e9, 'bullet', null);
    } else {
      sim.addPlayer('p2', 'Cy');
      const cy = sim.players.get('p2')!;
      sim.teleportPlayer(cy, 200, 1, 196);
      center = V(200, 1, 196);
      removeTarget = () => sim.removePlayer('p2');
    }
    steps(sim, 40);
    const inp = (m1: number) => sim.setInput('p1', { item: 'physgun', m1, ...aimAt(sim, head(), center) });
    inp(0); steps(sim, 3);
    inp(1); steps(sim, 10);
    const st = bob.scratch.physgun as { grab: unknown } | undefined;
    check(`physgun (${how}) : cible bien saisie avant le test`, !!st?.grab);
    removeTarget();
    const r = steps(sim, 120);
    check(`physgun (${how}) : 120 pas sans exception, le temps avance`, r.ok, r.err);
    check(`physgun (${how}) : saisie vidée`, !(bob.scratch.physgun as { grab: unknown }).grab);
  }

  // ---------- A2. mini_boss détruit ----------
  {
    const { sim } = await setup();
    const ex = installExtras(sim, { mode: 'multi' });
    ex.events.scheduleAuto(1e12);
    ex.events.start('mini_boss');
    steps(sim, 20, () => ex.step());
    const gnome = [...sim.props.values()].find((p) => p.kind.id === 'x_gnome');
    check('mini_boss : gnome créé', !!gnome);
    if (gnome) sim.removeProp(gnome);
    const r = steps(sim, 120, () => ex.step());
    check('mini_boss détruit : 120 pas sans exception', r.ok, r.err);
    check('mini_boss détruit : événement terminé, récompense posée', ex.events.active() === null && [...sim.props.values()].filter((p) => p.kind.id === 'crate_l').length >= 3);
  }

  // ---------- A3. missile + cible déconnectée ----------
  {
    const { sim, bob } = await setup(-300, -300);
    sim.addPlayer('p2', 'Cy');
    const plane = sim.vehicles.find((v) => v.def.type === 'avion_chasse')!;
    const pt = plane.behavior.body.translation();
    const fw = V(0, 0, -1).applyQuaternion(sim.quatOf(plane.behavior.body));
    sim.enterVehicle(bob, plane, 0);
    steps(sim, 20);
    sim.teleportPlayer(sim.players.get('p2')!, pt.x + fw.x * 60, pt.y + 0.5, pt.z + fw.z * 60);
    sim.setInput('p1', { m2: 1 });
    steps(sim, 45);
    const projs = (sim as unknown as { projs: unknown[] }).projs.length;
    check('missile : tiré', projs > 0, `${projs} projectile(s)`);
    sim.removePlayer('p2');
    sim.setInput('p1', { m2: 0 });
    const r = steps(sim, 120);
    check('missile : cible déconnectée, 120 pas sans exception', r.ok, r.err);
  }

  // ---------- A4. canne à vaches avec 400 props (la vache évince la cible) ----------
  {
    const { sim, bob } = await setup();
    const p0 = sim.spawnProp('crate_m', V(200, 1.3, 195))!;
    for (let i = 0; sim.props.size < 400; i++) sim.spawnProp('crate_s', V(260 + (i % 20) * 2, 0.5, 260 + Math.floor(i / 20) * 2))!;
    steps(sim, 20);
    const oldest = [...sim.props.values()].find((p) => !(p as { base?: boolean }).base);
    check('canne : cible = prop le plus ancien non-base (sera évincé)', oldest === p0 && sim.props.size >= 400);
    const head = () => { const t = bob.body.translation(); return V(t.x, t.y + 0.7, t.z); };
    const inp = (m1: number) => sim.setInput('p1', { item: 'canne_vaches', m1, ...aimAt(sim, head(), V(200, 1.3, 195)) });
    inp(0); steps(sim, 3);
    inp(1);
    const r = steps(sim, 120);
    check('canne à vaches, 400 props : 120 pas sans exception', r.ok, r.err);
  }

  // ---------- A5. disjoncteur (niveau simulation) ----------
  {
    const { sim } = await setup();
    sim.setInput('p1', { item: 'physgun', m1: 1, ad: [0, 0, -1] });
    steps(sim, 5);
    poison(sim);
    let threw = false;
    try { sim.step(); sim.step(); } catch { threw = true; }
    check('disjoncteur : panique détectée (broken), step() ne lève pas', sim.broken && !threw);
    const t = sim.time;
    sim.step();
    check('disjoncteur : un monde cassé ne tourne plus', sim.time === t);
    const priv = sim as unknown as { itemFails: Map<string, number>; badItems: Set<string> };
    check('disjoncteur : pas compté dans itemFails/badItems', priv.itemFails.size === 0 && priv.badItems.size === 0);
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
    const bad = JSON.parse('{"version":2,"props":[null,{"k":1},{"k":"crate_s","p":[1,"a",2],"q":[0,0,0,1]},{"k":"zzz","p":[1,1,1],"q":[0,0,0,1]}],'
      + '"vehicles":[null,{"type":"car","p":[1,2],"q":[0,0,0,1]},{"type":"car","p":[1,2,3],"q":[0,0,0,0],"i":"x","hp":"y","st":"no"}],'
      + '"players":{"__proto__":[1,2,3],"constructor":[1,2,3],"prototype":[1,2,3],"ok":[5,5,5],"bad":[1],"nan":[1,null,3]}}');
    let t3 = false;
    try { d.restore(bad); d.restore({ version: 2, props: {}, vehicles: 5, players: [] } as never); d.restore('x' as never); } catch { t3 = true; }
    check('sauvegarde corrompue : ignorée sans exception', !t3);
    const keys = Object.keys(d.serialize().players);
    check('sauvegarde corrompue : clés interdites et entrées invalides ignorées', keys.length === 1 && keys[0] === 'ok', keys.join(','));
    check('sauvegarde corrompue : simulation toujours saine', steps(d, 60).ok);
    const e = await fresh();
    e.restore({ version: 1, crates: [], vehicles: [], players: {} } as never);
    check('sauvegarde ancienne (v1) : ignorée', steps(e, 10).ok);
    const many: Record<string, number[]> = {};
    for (let i = 0; i < 350; i++) many[`J${i}`] = [i, 1, i];
    const f = await fresh();
    f.restore({ version: 2, props: [], vehicles: [], players: many } as never);
    const ks = Object.keys(f.serialize().players);
    check('sauvegarde : plafond de 200 joueurs mémorisés (FIFO)', ks.length === 200 && ks.includes('J349') && !ks.includes('J0'), String(ks.length));
  }

  // ---------- D1. rang décalé par un véhicule mort ----------
  {
    const a = await fresh();
    const type = [...new Set(a.vehicles.map((v) => v.def.type))].find((t) => a.vehicles.filter((v) => v.def.type === t).length >= 2)!;
    const same = a.vehicles.filter((v) => !v.extra && v.def.type === type);
    a.damageVehicle(same[0], 1e9, 'bullet', null);
    same[1].behavior.body.setTranslation({ x: 60, y: 1.2, z: 60 }, true);
    steps(a, 5);
    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = await fresh();
    b.restore(data);
    const bs = b.vehicles.filter((v) => !v.extra && v.def.type === type);
    const t1 = bs[1].behavior.body.translation();
    const t0 = bs[0].behavior.body.translation();
    check(`rang décalé (${type}) : le 2e véhicule retrouve sa place, pas le 1er`, Math.abs(t1.x - 60) < 1 && Math.hypot(t0.x - 60, t0.z - 60) > 20);
  }

  // ---------- D2. anti-enclavement ----------
  {
    const a = await fresh();
    steps(a, 5);
    const tree = treeLayout()[0];
    const car = a.vehicles.find((v) => v.def.type === 'car')!;
    const data = a.serialize();
    data.vehicles = [{ type: 'car', p: [tree.x, 1.5, tree.z], q: [0, 0, 0, 1], hp: 1, i: a.vehicles.indexOf(car) }];
    data.players = { Sous: [10, -8, 10], Arbre: [tree.x, 1, tree.z] };
    data.props = [{ k: 'crate_m', p: [5, -4, 5], q: [0, 0, 0, 1], f: 0 }];
    const b = await fresh();
    b.restore(data);
    const bc = b.vehicles.find((v) => v === b.vehicles[a.vehicles.indexOf(car)])!;
    const t = bc.behavior.body.translation();
    const clear = b.clearSpot(t.x, t.y, t.z, [0.8, 0.5, 1.2]);
    check('véhicule restauré dans un arbre : remonté ou replacé à l\'origine', t.y > 0 && clear === t.y);
    const tc = [...b.props.values()].filter((p) => p.kind.id === 'crate_m').some((p) => p.body.translation().y < 0);
    check('prop restauré sous le sol : remonté', !tc);
    b.addPlayer('s1', 'Sous');
    b.addPlayer('s2', 'Arbre');
    const ys = ['s1', 's2'].map((id) => b.players.get(id)!.body.translation());
    check('joueurs restaurés sous le sol / dans un arbre : replacés', ys[0].y > 0 && (ys[1].y > 0));
    const def = VEHICLE_BY_TYPE.get('car')!;
    const ex = b.spawnExtraVehicle(def, tree.x, tree.z, 0)!;
    const te = ex.behavior.body.translation();
    check('/spawn dans un arbre : jamais enclavé', b.clearSpot(te.x, te.y, te.z, [0.8, 0.5, 1.2]) === te.y);
    check('/spawn : simulation saine après', steps(b, 120).ok);
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

  B.ws.send(JSON.stringify({ type: 'chat', text: '/reset oui' }));
  check('/reset oui refusé à un non-hôte', await until(() => chatHas(B, /chef de la bande/), 2000));
  check('/reset : rien n\'a été annoncé', !chatHas(A, /remis le monde/));
  A.ws.send(JSON.stringify({ type: 'chat', text: '/gravite 999' }));
  check('/gravite par l\'hôte : valeur clampée annoncée (40.0)', await until(() => chatHas(A, /40\.0 m\/s²/), 2000));
  B.ws.send(JSON.stringify({ type: 'chat', text: '/gravite 1' }));
  B.ws.send(JSON.stringify({ type: 'chat', text: '/meteo stop' }));
  B.ws.send(JSON.stringify({ type: 'chat', text: '/mode stop' }));
  await sleep(200);
  check('/gravite, /meteo, /mode refusés à un non-hôte', B.msgs.filter((m) => m.type === 'chat' && /chef de la bande/.test(String((m.m as { text: string }).text))).length >= 4);

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
  B.ws.send(JSON.stringify({ type: 'chat', text: '/reset oui' }));
  check('hôte conservé après reconstruction (non-hôte toujours refusé)', await until(() => B.msgs.filter((m) => m.type === 'chat' && /chef de la bande/.test(String((m.m as { text: string }).text))).length >= 5, 2000));

  // ----- Hôte parti : le plus ancien reprend -----
  A.ws.close();
  await until(() => srv.sim().players.size === 1, 2000);
  await sleep(3500); // anti-spam du chat : 5 messages par 5 s
  B.ws.send(JSON.stringify({ type: 'chat', text: '/gravite normal' }));
  check('hôte parti : le joueur le plus ancien devient chef', await until(() => chatHas(B, /nouveau chef/) && chatHas(B, /9\.8 m\/s²/), 2000));

  // ----- Muet fermé sous 5 s -----
  await until(() => mute.closed, 7000);
  const dt = mute.closedAt - tMute;
  check('socket muet fermé sous 5 s', mute.closed && dt < 6500, `${dt} ms`);

  const E = await connect(PORT);
  E.ws.send(JSON.stringify({ type: 'join', name: 'Eve' }));
  await until(() => E.msgs.some((m) => m.type === 'welcome'), 2000);
  const F = await connect(PORT);
  F.ws.send(JSON.stringify({ type: 'join', name: 'Fred' }));
  check('2 join en moins de 2 s depuis la même IP : le 2e est refusé', await until(() => F.msgs.some((m) => m.type === 'error'), 2000) && !F.msgs.some((m) => m.type === 'welcome'));
  E.ws.close(); F.ws.close();
  check('serveur toujours vivant (/info)', (await info(PORT))?.game === 'jeu3d');
  const thrownLogs = logs.filter((l) => /uncaught|TypeError|URIError/i.test(l));
  check('aucune exception non gérée dans le journal', thrownLogs.length === 0, thrownLogs.join(' | '));
  B.ws.close();
  await sleep(100);
  await srv.stop();
  check('stop() : simulation libérée', srv.sim().broken === true);

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

async function main() {
  await partSim();
  await partServer();
  console.log(fails ? `\n${fails} échec(s)` : '\nToutes les vérifications passent.');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
