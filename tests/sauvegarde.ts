// PROPRIÉTAIRE : intégrateur. Sauvegarde v3 sur un vrai serveur : parties jouées puis redémarrage, solo.json / multi.json distincts,
// fichiers tronqués / hostiles / énormes / anciens, écriture atomique et copie de secours (.bak).
// Lancement : npx tsx tests/sauvegarde.ts   (ports 3463-3466, dossiers temporaires)
import fs from 'node:fs';
import path from 'node:path';
import { startServer, type RunningServer } from '../server/server';
import { getCity } from '../shared/city/layout';
import { check, failCount, join, sleep, tmpDir, until, type Client } from './helpers-net';

const city = getCity();
const dealer = city.poisOf('dealer')[0];
const planque = city.poisOf('planque')[0];
let nextPort = 3463;
const ip = (n: number) => ({ localAddress: `127.0.0.${n}` });

async function boot(mode: 'solo' | 'multi', t: ReturnType<typeof tmpDir>, logs: string[] = []): Promise<RunningServer> {
  return startServer({ mode, saveDir: t.saves, publicDir: t.pub, port: nextPort++, log: (l) => logs.push(l) });
}
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const accountOf = (file: { systems?: { economy?: { accounts?: unknown[][] } } }, name: string) => file.systems?.economy?.accounts?.find((a) => a[0] === name);
const protoClean = () => ({} as Record<string, unknown>).polluted === undefined && ({} as Record<string, unknown>).heat === undefined && Object.keys(Object.prototype).length === 0;

async function play(srv: RunningServer, port: number, name: string, n = 2): Promise<Client> {
  const c = await join(port, name, ip(n));
  return c;
}

async function main() {
  // ---------- 1. Une vraie partie, sauvegarde, redémarrage ----------
  {
    const t = tmpDir('wtf-save1-');
    fs.mkdirSync(t.saves, { recursive: true });
    fs.writeFileSync(path.join(t.saves, 'multi.json'), JSON.stringify({ version: 3, players: {}, systems: { missions: { v: 1, medals: { Alice: { annales: 'argent', sardines: 'bronze' } } } } }));
    const port = nextPort;
    const srv = await boot('multi', t);
    const alice = await play(srv, port, 'Alice', 2);
    const pl = () => srv.sim().players.get(alice.id)!;
    srv.sim().teleportPlayer(pl(), dealer.x, 1.3, dealer.z);
    await until(() => !!alice.me?.shop, 3000);
    check('partie : médailles reprises du fichier', alice.me?.medals.annales === 'argent' && alice.me?.medals.sardines === 'bronze');
    for (const good of ['croissant_pirate', 'cafe_machine'] as const) {
      alice.game({ k: 'trade', dealer: alice.me!.shop!.dealer, good, qty: 2, side: 'buy' });
      await sleep(300);
    }
    await until(() => (alice.me?.bag.cafe_machine ?? 0) === 2 && (alice.me?.bag.croissant_pirate ?? 0) === 2, 3000);
    srv.sim().teleportPlayer(pl(), planque.x, 1.3, planque.z);
    await until(() => !!alice.me?.stash, 3000);
    alice.game({ k: 'stash', op: 'put', good: 'cafe_machine', qty: 1 });
    await until(() => (alice.me?.stash?.cafe_machine ?? 0) === 1, 3000);
    const stashed = { ...alice.me!.stash };
    srv.sim().teleportPlayer(pl(), dealer.x + 100, 1.3, dealer.z + 100); // position à restaurer aussi
    await sleep(31_000); // au-delà de MIN_SESSION_MS (30 s) : la position est mémorisée (en paix : pas d'arrestation qui vide le sac)
    alice.chat('/debug stars 3');
    await until(() => (alice.me?.stars ?? 0) >= 3, 3000);
    const snapshot = { money: alice.me!.money, bag: { ...alice.me!.bag }, stash: stashed, stars: alice.me!.stars };
    check('partie jouée : argent < 200, sac et planque non vides, 3 étoiles', snapshot.money < 200 && (snapshot.bag.croissant_pirate ?? 0) === 2 && (snapshot.stash.cafe_machine ?? 0) === 1 && snapshot.stars >= 3, JSON.stringify(snapshot));
    const posPlayed = pl().body.translation();
    alice.ws.close();
    await until(() => srv.sim().players.size === 0, 2000);
    await srv.stop();

    const file = readJson(path.join(t.saves, 'multi.json'));
    const acc = accountOf(file, 'Alice') as unknown[];
    check('fichier : version 3, joueurs, systèmes (économie, médailles, police)', file.version === 3 && !!file.players && !!file.systems?.economy && !!file.systems?.missions && !!file.systems?.police, Object.keys(file.systems ?? {}).join(','));
    check('fichier : compte d\'Alice (argent, sac, planque)', !!acc && acc[1] === snapshot.money && JSON.stringify(acc[2]).includes('croissant_pirate') && JSON.stringify(acc[3]).includes('cafe_machine'), JSON.stringify(acc));
    check('fichier : police sauvegardée par PSEUDO (pas par identifiant p1)', !!file.systems?.police?.w?.Alice && !file.systems.police.w.p1, JSON.stringify(file.systems?.police));
    check('fichier : taille raisonnable (< 20 Ko)', fs.statSync(path.join(t.saves, 'multi.json')).size < 20_000);
    check('fichier : pas de .tmp résiduel', !fs.existsSync(path.join(t.saves, 'multi.json.tmp')));

    // Redémarrage : un AUTRE joueur arrive en premier (il prend l'identifiant p1), puis Alice
    const logs2: string[] = [];
    const port2 = nextPort;
    const srv2 = await boot('multi', t, logs2);
    check('redémarrage : « Sauvegarde chargée »', logs2.some((l) => /Sauvegarde chargée/.test(l)));
    const zed = await play(srv2, port2, 'Zed', 3);
    const alice2 = await play(srv2, port2, 'Alice', 4);
    await until(() => !!alice2.me && !!zed.me, 3000);
    check('redémarrage : Alice retrouve son argent, son sac et ses médailles', alice2.me?.money === snapshot.money && alice2.me?.bag.croissant_pirate === 2 && alice2.me?.bag.cafe_machine === 1 && alice2.me?.medals.annales === 'argent', JSON.stringify(alice2.me));
    check('redémarrage : les 3 étoiles suivent Alice (pas le joueur p1 = Zed)', (alice2.me?.stars ?? 0) >= 3 && zed.me?.stars === 0, `Alice ${alice2.me?.stars} Zed ${zed.me?.stars}`);
    check('redémarrage : Zed repart avec l\'argent de départ', zed.me?.money === 200);
    const p2 = srv2.sim().players.get(alice2.id)!.body.translation();
    check('redémarrage : position d\'Alice restaurée (≤ 12 m)', Math.hypot(p2.x - posPlayed.x, p2.z - posPlayed.z) < 12, `${p2.x.toFixed(0)},${p2.z.toFixed(0)} vs ${posPlayed.x.toFixed(0)},${posPlayed.z.toFixed(0)}`);
    srv2.sim().teleportPlayer(srv2.sim().players.get(alice2.id)!, planque.x, 1.3, planque.z);
    await until(() => !!alice2.me?.stash, 3000);
    check('redémarrage : planque restaurée', alice2.me?.stash?.cafe_machine === 1);
    alice2.ws.close(); zed.ws.close();
    await sleep(200);
    await srv2.stop();
    const file2 = readJson(path.join(t.saves, 'multi.json'));
    check('redémarrage : la sauvegarde ne perd rien après un 2e cycle', (accountOf(file2, 'Alice') as unknown[])?.[1] === snapshot.money && file2.systems?.missions?.medals?.Alice?.annales === 'argent');

    // ---------- 2. solo.json et multi.json distincts ----------
    const multiBytes = fs.readFileSync(path.join(t.saves, 'multi.json'));
    const portS = nextPort;
    const srvS = await boot('solo', t);
    const solo = await play(srvS, portS, 'Alice', 5);
    await until(() => !!solo.me, 3000);
    check('solo : démarre à neuf (argent de départ, pas de médaille de multi.json)', solo.me?.money === 200 && Object.keys(solo.me?.medals ?? {}).length === 0, JSON.stringify(solo.me?.medals));
    solo.chat('/debug money 999');
    await sleep(500);
    solo.ws.close();
    await sleep(300);
    await srvS.stop();
    check('solo.json créé, multi.json intact (mêmes octets)', fs.existsSync(path.join(t.saves, 'solo.json')) && Buffer.compare(multiBytes, fs.readFileSync(path.join(t.saves, 'multi.json'))) === 0);
    const solo1 = readJson(path.join(t.saves, 'solo.json'));
    check('solo.json : contient son propre compte (v3)', solo1.version === 3 && !!accountOf(solo1, 'Alice'));
    t.clean();
  }

  // ---------- 3. Fichiers abîmés ou hostiles ----------
  {
    const goodFile = JSON.stringify({
      version: 3, players: { Alice: [10, 1, 10] },
      systems: { economy: { v: 1, accounts: [['Alice', 777, [['cafe_machine', 2]], [], 5]], camsDown: [] }, missions: { v: 1, medals: { Alice: { annales: 'or' } } }, police: { v: 1, w: {} } },
    });
    const hostile = '{"version":3,"players":{"__proto__":[1,2,3],"constructor":[1,2,3],"Alice":[1e999,0,0]},"systems":{"__proto__":{"polluted":1},'
      + '"economy":{"accounts":[["__proto__",1e308,[["__proto__",5]],[],1],["Alice","1e9",[],[],"x"],["constructor",5,[],[],1]],"market":{"__proto__":{"polluted":2},"events":[["cafe_machine","campus",1e308,0,-5]]},"camsDown":["__proto__",1,null]},'
      + '"missions":{"medals":{"__proto__":{"annales":"or"},"Alice":{"__proto__":"or","annales":"dragon"},"constructor":{"annales":"or"}}},'
      + '"police":{"w":{"__proto__":{"heat":50},"Alice":{"heat":1e999,"kills":-9},"toString":{"heat":3}}},"peds":7,"traffic":{"seed":"x"},"activities":[1,2],"theft":null}}';
    const manyAccounts = '{"version":3,"players":{},"systems":{"economy":{"v":1,"accounts":[' + Array.from({ length: 40_000 }, (_, i) => `["J${i}",${i},[],[],1]`).join(',') + ']}}}';
    const bigFile = '{"version":3,"players":{},"systems":{"economy":{"v":1,"accounts":[' + Array.from({ length: 200_000 }, (_, i) => `["Joueur${i}",${i},[],[],1]`).join(',') + ']}}}';
    const bigPlayers = JSON.stringify({ version: 3, players: Object.fromEntries(Array.from({ length: 30_000 }, (_, i) => [`P${i}`, [i % 100, 1, i % 100]])), systems: {} });
    const hugeArrays = JSON.stringify({ version: 3, players: {}, systems: { economy: { accounts: [], camsDown: Array.from({ length: 100_000 }, (_, i) => `c${i}`) }, missions: { medals: Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`N${i}`, { annales: 'or' }])) } } });
    const cases: { name: string; main?: string | Buffer | null; bak?: string; tmp?: string; expect: 'neuf' | 'alice' | 'alice-ou-neuf' }[] = [
      { name: 'fichier tronqué (moitié du JSON)', main: goodFile.slice(0, Math.floor(goodFile.length / 2)), expect: 'neuf' },
      { name: 'fichier vide', main: '', expect: 'neuf' },
      { name: 'JSON valide mais pas un objet (null, tableau, nombre, texte)', main: 'null', expect: 'neuf' },
      { name: 'tableau à la racine', main: '[1,2,3]', expect: 'neuf' },
      { name: 'octets aléatoires', main: Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 131 + 7) % 256)), expect: 'neuf' },
      { name: 'ancienne sauvegarde v1', main: JSON.stringify({ version: 1, crates: [], vehicles: [], players: { Alice: [1, 1, 1] } }), expect: 'neuf' },
      { name: 'ancienne sauvegarde v2', main: JSON.stringify({ version: 2, props: [], vehicles: [], players: { Alice: [1, 1, 1] }, game: { money: 99999 } }), expect: 'neuf' },
      { name: 'JSON hostile (__proto__, constructor, nombres absurdes, types faux)', main: hostile, expect: 'alice-ou-neuf' },
      { name: '40 000 comptes (plafond à 64 à la lecture)', main: manyAccounts, expect: 'alice-ou-neuf' },
      { name: '200 000 comptes (fichier > 4 Mo : refusé)', main: bigFile, expect: 'neuf' },
      { name: '30 000 joueurs mémorisés (plafond FIFO)', main: bigPlayers, expect: 'neuf' },
      { name: 'énormes tableaux (100 000 caméras, 20 000 médailles)', main: hugeArrays, expect: 'neuf' },
      { name: 'coupure en plein écriture : .tmp tronqué, sauvegarde principale saine', main: goodFile, tmp: goodFile.slice(0, 50), expect: 'alice' },
      { name: 'principale corrompue + copie de secours .bak saine : rien n\'est perdu', main: goodFile.slice(0, 80), bak: goodFile, expect: 'alice' },
      { name: 'principale absente + .bak saine', main: null, bak: goodFile, expect: 'alice' },
    ];
    for (const c of cases) {
      const t = tmpDir('wtf-save3-');
      fs.mkdirSync(t.saves, { recursive: true });
      if (c.main !== null && c.main !== undefined) fs.writeFileSync(path.join(t.saves, 'multi.json'), c.main);
      if (c.bak !== undefined) fs.writeFileSync(path.join(t.saves, 'multi.json.bak'), c.bak);
      if (c.tmp !== undefined) fs.writeFileSync(path.join(t.saves, 'multi.json.tmp'), c.tmp);
      const logs: string[] = [];
      const port = nextPort;
      let srv: RunningServer | null = null;
      let err = '';
      try { srv = await boot('multi', t, logs); } catch (e) { err = String(e); }
      if (!srv) { check(`${c.name} : le serveur démarre`, false, err); t.clean(); continue; }
      const a = await play(srv, port, 'Alice', 2);
      await until(() => !!a.me, 3000);
      const t0 = srv.sim().time;
      await sleep(400);
      const m = a.me;
      const moneyOk = !!m && Number.isInteger(m.money) && m.money >= 0 && m.money <= 1_000_000_000;
      const alice = m?.money === 777;
      const fine = c.expect === 'neuf' ? m?.money === 200 && Object.keys(m.medals).length === 0
        : c.expect === 'alice' ? alice && m?.medals.annales === 'or' && m?.bag.cafe_machine === 2
        : moneyOk;
      check(`${c.name} : démarrage sain, état attendu (${c.expect})`, fine && srv.sim().time > t0 && !srv.sim().broken && protoClean(), JSON.stringify(m ? { money: m.money, medals: m.medals, bag: m.bag } : null));
      check(`${c.name} : aucune exception dans le journal`, !logs.some((l) => /TypeError|RangeError|Error:/.test(l)), logs.filter((l) => /Error/.test(l)).slice(0, 2).join(' | '));
      a.ws.close();
      await sleep(250);
      await srv.stop();
      let after: { version?: number; systems?: Record<string, unknown> } | null = null;
      try { after = readJson(path.join(t.saves, 'multi.json')); } catch { /* illisible */ }
      check(`${c.name} : la sauvegarde réécrite est valide (v3)`, after?.version === 3 && typeof after.systems === 'object');
      t.clean();
    }
  }

  // ---------- 4. Atomicité de l'écriture ----------
  {
    const t = tmpDir('wtf-save4-');
    fs.mkdirSync(t.saves, { recursive: true });
    const main = path.join(t.saves, 'multi.json');
    fs.writeFileSync(main, JSON.stringify({ version: 3, players: {}, systems: { economy: { v: 1, accounts: [['Alice', 555, [], [], 1]] } } }));
    // a) l'écriture temporaire échoue (le .tmp est un dossier) : l'ancienne sauvegarde reste intacte, le serveur continue
    fs.mkdirSync(main + '.tmp');
    const before = fs.readFileSync(main);
    const logs: string[] = [];
    const port = nextPort;
    const srv = await boot('multi', t, logs);
    const a = await play(srv, port, 'Alice', 2);
    await until(() => !!a.me, 3000);
    a.ws.close();
    await sleep(400); // dernier joueur parti : sauvegarde déclenchée
    check('écriture impossible : journal « Échec de la sauvegarde », serveur toujours vivant', logs.some((l) => /Échec de la sauvegarde/.test(l)) && !srv.sim().broken);
    check('écriture impossible : l\'ancienne sauvegarde est intacte (mêmes octets)', Buffer.compare(before, fs.readFileSync(main)) === 0);
    fs.rmdirSync(main + '.tmp');
    // b) lecteur concurrent : pendant de nombreuses sauvegardes, le fichier principal n'est JAMAIS lu à moitié écrit
    let reads = 0, torn = 0, stop = false;
    const reader = (async () => {
      while (!stop) {
        let raw = '';
        try { raw = fs.readFileSync(main, 'utf8'); } catch { await sleep(1); continue; }
        reads++;
        try { JSON.parse(raw); } catch { torn++; }
        await new Promise<void>((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 25; i++) {
      const c = await join(port, 'Alice', ip(10 + i));
      await sleep(40);
      c.ws.close();
      await sleep(60);
    }
    stop = true;
    await reader;
    check('25 sauvegardes sous lecture concurrente : jamais de fichier à moitié écrit', torn === 0 && reads > 100, `${reads} lectures, ${torn} déchirées`);
    check('la copie de secours (.bak) existe et est valide', (() => { try { return readJson(main + '.bak').version === 3; } catch { return false; } })());
    check('aucun .tmp résiduel', !fs.existsSync(main + '.tmp'));
    await srv.stop();
    t.clean();
  }

  console.log(failCount() ? `\n${failCount()} échec(s)` : '\nSauvegarde : toutes les vérifications passent.');
  process.exit(failCount() ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
