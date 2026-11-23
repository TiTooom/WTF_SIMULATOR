// PROPRIÉTAIRE : intégrateur
// Vérification « en vrai » : serveur réel (startServer, port aléatoire, SAVE_DIR temporaire, client = dist/public) + Chrome headless piloté en CDP.
// Parcours : connexion, trafic dans le snapshot, police (/debug stars), argent (/debug money) + achat chez un dealer, vol d'une voiture garée
// (mini-jeu réel, résultat envoyé par le client), arrestation (sac vidé), erreurs console, appels de dessin, captures.
// Lancement : npx tsx tests/reel.ts [dossier de sortie]   (prérequis : `npx vite build` ; Chrome : variable CHROME ou chemin par défaut ; saute si absent)
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../server/server';
import { getCity } from '../shared/city/layout';
import { MISSIONS } from '../shared/missions';
import { TAXI_LIVERY } from '../shared/activities';
import { fouilleSpec, tournevisSpec } from '../shared/minigames/rules';

const PORT = 3100 + Math.floor(Math.random() * 800);
const DEBUG = 9400 + Math.floor(Math.random() * 400);
const out = process.argv[2] ?? join(tmpdir(), 'gta-reel');
const CHROME = process.env.CHROME
  ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, msg: string, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${msg}${detail ? '  — ' + detail : ''}`); };

async function main() {
  if (!CHROME) { console.log('reel : Chrome introuvable, suite sautée.'); return; }
  mkdirSync(out, { recursive: true });
  const saveDir = mkdtempSync(join(tmpdir(), 'gta-save-'));
  const profile = mkdtempSync(join(tmpdir(), 'gta-chrome-'));
  const srvLogs: string[] = [];
  const server = await startServer({ mode: 'solo', saveDir, publicDir: resolve('dist/public'), port: PORT, log: (l) => srvLogs.push(l) });
  let chrome: ChildProcess | null = null;
  try {
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--hide-scrollbars',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    let wsUrl = '';
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
      } catch { /* pas prêt */ }
      if (!wsUrl) await sleep(300);
    }
    if (!wsUrl) { console.log('reel : Chrome ne répond pas, suite sautée.'); return; }
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('CDP')); });
    let id = 0;
    const pending = new Map<number, (r: { result?: { result?: { value?: unknown } } }) => void>();
    const logs: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + (m.params.args?.[0]?.value ?? m.params.args?.[0]?.description));
    };
    const send = (method: string, params: object = {}) => new Promise<{ result?: { result?: { value?: unknown } } }>((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async <T>(expr: string): Promise<T> => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value as T;
    const shot = async (name: string) => {
      const png = (await send('Page.captureScreenshot', { format: 'png' })) as unknown as { result: { data: string } };
      const f = join(out, `${name}.png`);
      writeFileSync(f, Buffer.from(png.result.data, 'base64'));
      console.log(`     capture ${f}`);
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?name=Testeur&nopause` });

    // 1. Connexion
    let me: { money: number; stars: number; bag: Record<string, number>; shop?: { dealer: string; goods: { good: string; buy: number }[] } } | null = null;
    for (let i = 0; i < 100 && !me; i++) { await sleep(300); me = await ev(`window.__wtf && window.__wtf.me ? JSON.parse(JSON.stringify(window.__wtf.me)) : null`); }
    check(!!me, 'connexion : état privé `me` reçu', me ? `argent ${me.money} €` : '');
    await ev(`(() => { const n = window.__wtf.net; window.__ev = []; const o = n.onGame; n.onGame = (e) => { window.__ev.push(e); o(e); }; return 1; })()`);
    const sim = () => server.sim();
    const player = () => [...sim().players.values()][0];
    const sendChat = (text: string) => ev(`window.__wtf.net.send({ type: 'chat', text: ${JSON.stringify(text)} })`);
    const events = () => ev<{ k: string; [k: string]: unknown }[]>('window.__ev');
    const priv = () => ev<NonNullable<typeof me>>(`JSON.parse(JSON.stringify(window.__wtf.me))`);

    // 2. Trafic visible dans le snapshot
    let civ = 0, parked = 0;
    for (let i = 0; i < 60 && civ < 3; i++) {
      await sleep(500);
      civ = sim().vehicles.filter((v) => !v.pooled && !v.dead && v.ai && v.def.type !== 'police').length;
      parked = sim().vehicles.filter((v) => !v.pooled && !v.dead && !v.ai && v.locked).length;
    }
    const clientVeh = await ev<number>('window.__wtf.vehicles');
    check(civ >= 3, 'trafic : civils présents côté serveur', `${civ} civils, ${parked} garées verrouillées`);
    check(clientVeh >= civ, 'trafic : véhicules reçus et dessinés par le client', `${clientVeh}`);
    const peds = await ev<number>('window.__wtf.peds');
    check(peds > 5, 'piétons reçus par le client', String(peds));
    await shot('1_ville_trafic');

    // 3. Police : /debug stars 3
    await sendChat('/debug stars 3');
    let m2 = me;
    for (let i = 0; i < 30 && (m2?.stars ?? 0) < 3; i++) { await sleep(300); m2 = await priv(); }
    check(m2?.stars === 3, 'police : /debug stars 3 -> 3 étoiles côté client', String(m2?.stars));
    let cops = 0;
    for (let i = 0; i < 90 && cops < 2; i++) {
      await sleep(500);
      cops = sim().vehicles.filter((v) => !v.pooled && !v.dead && v.def.type === 'police' && v.ai).length;
    }
    check(cops >= 1, 'police : voitures de police envoyées', `${cops}`);
    await shot('2_police_3_etoiles');
    await sendChat('/debug stars 0');

    // 4. Argent + achat chez un dealer
    await sendChat('/debug money 500');
    let m3 = await priv();
    for (let i = 0; i < 20 && m3.money < 500; i++) { await sleep(300); m3 = await priv(); }
    check(m3.money >= 500, 'économie : /debug money 500', `${m3.money} €`);
    const dealer = getCity().poisOf('dealer')[0];
    sim().teleportPlayer(player(), dealer.x + 1.5, 1.3, dealer.z);
    let m4 = await priv();
    for (let i = 0; i < 30 && !m4.shop; i++) { await sleep(300); m4 = await priv(); }
    check(!!m4.shop, 'économie : dealer à portée, boutique dans `me`', m4.shop?.dealer ?? 'aucune');
    const money0 = m4.money;
    if (m4.shop) {
      const g = m4.shop.goods[0];
      await ev(`window.__wtf.net.send({ type: 'game', m: { k: 'trade', dealer: ${JSON.stringify(m4.shop.dealer)}, good: ${JSON.stringify(g.good)}, qty: 2, side: 'buy' } })`);
      let m5 = await priv();
      for (let i = 0; i < 20 && m5.money === money0; i++) { await sleep(300); m5 = await priv(); }
      check(m5.money < money0 && (m5.bag[g.good] ?? 0) >= 2, 'économie : achat de 2 unités, argent débité et sac rempli', `${money0} -> ${m5.money} €, sac ${JSON.stringify(m5.bag)}`);
      // la touche d'interaction ouvre la boutique côté client (ShopUi)
      await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: window.__wtf.settings.keys.interact }))`);
      await sleep(600);
      const open = await ev<boolean>(`!!document.querySelector('.shop-overlay.open')`);
      check(open, 'client : la touche d\'interaction ouvre la boutique du dealer');
      await shot('3_boutique');
      await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
    }

    // 5. Vol d'une voiture garée (mini-jeu réel)
    const findParked = () => sim().vehicles.find((v) => !v.pooled && !v.dead && !v.ai && v.locked && !v.driver);
    const nodes = getCity().nodes;
    let target = findParked();
    for (let i = 0; i < 40 && !target; i++) { // le trafic fait apparaître des voitures garées à 60-118 m : on se promène
      const n = nodes[(i * 37 + 11) % nodes.length];
      sim().teleportPlayer(player(), n.x, 1.3, n.z);
      for (let k = 0; k < 6 && !target; k++) { await sleep(500); target = findParked(); }
    }
    if (!target) check(false, 'vol : aucune voiture garée verrouillée trouvée');
    else {
      const t = target.behavior.body.translation();
      sim().teleportPlayer(player(), t.x + 1.8, 1.3, t.z);
      await sleep(600);
      await ev('window.__ev.length = 0');
      await ev(`window.__wtf.net.send({ type: 'interact' })`);
      let start: { k: string; s?: { sid: number; kind: string } } | undefined;
      for (let i = 0; i < 20 && !start; i++) { await sleep(300); start = (await events()).find((e) => e.k === 'mg_start') as typeof start; }
      check(!!start, 'vol : l\'interaction près d\'une voiture verrouillée lance un mini-jeu', start?.s?.kind ?? '');
      if (start?.s) {
        const data = start.s.kind === 'tournevis' ? [5, 500] : [1300];
        await sleep(1600); // durée minimale plausible côté serveur
        await ev(`window.__wtf.net.send({ type: 'game', m: { k: 'mg', r: { sid: ${start.s.sid}, ok: true, ms: 1500, data: ${JSON.stringify(data)} } } })`);
        await sleep(500);
        console.log('     événements après envoi :', JSON.stringify(await events()), 'sid', start.s.sid);
        let driving = false;
        for (let i = 0; i < 20 && !driving; i++) { await sleep(300); driving = !!player().vehicle; }
        check(driving, 'vol : mini-jeu réussi, le joueur prend le volant', `type ${player().vehicle?.def.type}`);
        const m6 = await priv();
        check(m6.stars >= 1, 'vol : crime « vol_vehicule » -> au moins 1 étoile (anti-doublon)', `${m6.stars} étoile(s)`);
      }
    }

    // 6. Arrestation : on descend, 3 étoiles, on attend les flics à pied immobile
    const pl = player();
    if (pl.vehicle) { await ev(`window.__wtf.net.send({ type: 'interact' })`); await sleep(800); }
    const before = await priv();
    await sendChat('/debug stars 3');
    await ev('window.__ev.length = 0');
    let arrested = false;
    for (let i = 0; i < 240 && !arrested; i++) {
      await sleep(500);
      arrested = (await events()).some((e) => e.k === 'arrete');
      if (i === 40) await shot('5_police_approche');
    }
    check(arrested, 'arrestation : événement « arrete » reçu', '');
    if (arrested) {
      await sleep(700);
      const after = await priv();
      check(Object.keys(after.bag).length === 0 && after.stars === 0, 'arrestation : sac vidé et étoiles remises à 0', `argent ${before.money} -> ${after.money} €, sac ${JSON.stringify(after.bag)}`);
      await shot('6_arrete');
    }

    // 6b. Mission 1 de bout en bout (donneur -> fouille -> vol -> livraison), écran de fin avec médaille
    {
      const def = MISSIONS[0];
      const giver = getCity().pois.find((p) => p.id === def.giver)!;
      await sleep(1500); // sortie de l'arrestation (téléportation au commissariat)
      sim().teleportPlayer(player(), giver.x + 3, 1.3, giver.z);
      await sleep(700);
      await ev('window.__ev.length = 0');
      await ev(`window.__wtf.net.send({ type: 'game', m: { k: 'mission', op: 'start', id: ${JSON.stringify(def.id)} } })`);
      let mm = await priv() as unknown as { mission?: { id: string; step: number } };
      for (let i = 0; i < 20 && !mm.mission; i++) { await sleep(300); mm = await priv() as unknown as typeof mm; }
      check(mm.mission?.id === def.id, 'mission 1 : lancée près du donneur, visible dans le HUD (me.mission)', JSON.stringify(mm.mission));
      const hudMission = await ev<string>(`document.querySelector('#gta-hud .gh-mission')?.textContent ?? ''`);
      check(hudMission.includes('MISSION'), 'mission 1 : le HUD affiche la mission', hudMission.slice(0, 60));
      const answer = async (): Promise<boolean> => {
        let st: { s: { sid: number; kind: string; seed: number; difficulty: number } } | undefined;
        for (let i = 0; i < 20 && !st; i++) { await sleep(300); st = (await events()).reverse().find((e) => e.k === 'mg_start') as unknown as typeof st; }
        if (!st) return false;
        const data = st.s.kind === 'tournevis' ? [tournevisSpec(st.s.seed, st.s.difficulty).turns, 200] : st.s.kind === 'fouille' ? (() => { const f = fouilleSpec(st.s.seed); return [f.slot, f.swipes]; })() : [1000];
        await sleep(1700);
        await ev(`window.__wtf.net.send({ type: 'game', m: { k: 'mg', r: { sid: ${st.s.sid}, ok: true, ms: 1500, data: ${JSON.stringify(data)} } } })`);
        await sleep(900);
        await ev('window.__ev.length = 0');
        return true;
      };
      let done: { medal?: string; ms?: number; reward?: number; par?: unknown } | undefined;
      for (let guard = 0; guard < 40 && !done; guard++) {
        const cur = await priv() as unknown as { mission?: { step: number } };
        if (!cur.mission) break;
        const st = def.steps[cur.mission.step - 1] ?? def.steps[0];
        if (st.t === 'aller') sim().teleportPlayer(player(), st.x, 1.3, st.z);
        else if (st.t === 'minijeu') { sim().teleportPlayer(player(), st.x, 1.3, st.z); await sleep(500); await answer(); }
        else if (st.t === 'voler') {
          const pp = sim().playerPos(player());
          const car = sim().vehicles.filter((v) => !v.pooled && !v.dead && v.locked && !v.driver && v.def.type === 'citadine')
            .sort((a, b) => { const ta = a.behavior.body.translation(), tb = b.behavior.body.translation(); return Math.hypot(ta.x - pp[0], ta.z - pp[2]) - Math.hypot(tb.x - pp[0], tb.z - pp[2]); })[0];
          if (car) { const t = car.behavior.body.translation(); sim().teleportPlayer(player(), t.x + 1.8, 1.3, t.z); await sleep(600); await ev('window.__ev.length = 0'); await ev(`window.__wtf.net.send({ type: 'interact' })`); await answer(); }
        } else if (st.t === 'livrer') {
          const v = player().vehicle;
          if (v) { v.behavior.body.setTranslation({ x: st.x, y: 0.7, z: st.z }, true); v.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
          else sim().teleportPlayer(player(), st.x, 1.3, st.z);
        }
        await sleep(900);
        done = (await events()).find((e) => e.k === 'mission' && e.ev === 'done') as unknown as typeof done;
      }
      for (let i = 0; i < 10 && !done; i++) { await sleep(300); done = (await events()).find((e) => e.k === 'mission' && e.ev === 'done') as unknown as typeof done; }
      check(!!done && !!done.medal, 'mission 1 : événement de fin avec médaille', JSON.stringify(done));
      check(!!done && typeof done.reward === 'number' && done.reward > 0 && !!done.par, 'mission 1 : l’événement de fin porte récompense et objectifs (par)');
      await sleep(900);
      const result = await ev<string>(`document.body.innerText.includes('MISSION RÉUSSIE') ? 'MISSION RÉUSSIE' : ''`);
      check(result === 'MISSION RÉUSSIE', 'mission 1 : l’écran de fin (showMissionResult) s’affiche');
      await shot('7_fin_mission');
      await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`);
      await ev(`document.querySelector('div[style*="z-index:960"]')?.click()`);
      await sleep(900);
      // le PDA reçoit la médaille
      const medals = (await priv() as unknown as { medals: Record<string, string> }).medals;
      check(!!medals[def.id], 'mission 1 : médaille enregistrée dans me.medals', JSON.stringify(medals));

      // Taxi : berline livrée « taxi » ; la touche d'activité (client) démarre la course
      if (player().vehicle) { await ev(`window.__wtf.net.send({ type: 'interact' })`); await sleep(800); }
      const pp = sim().playerPos(player());
      const taxi = sim().acquireVehicle('berline', pp[0] + 6, pp[2], 0, { livery: TAXI_LIVERY, y: 0.7 });
      check(!!taxi, 'taxi : berline taxi obtenue du pool');
      if (taxi) {
        sim().enterVehicle(player(), taxi, 0, true);
        await sleep(700);
        const key = await ev<string>('window.__wtf.settings.keys.activity');
        await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(key)}, bubbles: true }))`);
        await sleep(400);
        await ev(`window.dispatchEvent(new KeyboardEvent('keyup', { code: ${JSON.stringify(key)}, bubbles: true }))`);
        let act: { activity?: { kind: string; text: string } } = await priv() as never;
        for (let i = 0; i < 20 && !act.activity; i++) { await sleep(300); act = await priv() as never; }
        check(act.activity?.kind === 'taxi', 'taxi : la touche d’activité démarre le taxi (me.activity)', JSON.stringify(act.activity));
        let hudAct = '';
        for (let i = 0; i < 20 && !hudAct.includes('TAXI'); i++) { await sleep(300); hudAct = await ev<string>(`document.querySelector('#gta-hud .gh-mission')?.textContent ?? ''`); } // rendu logiciel lent : le HUD suit avec retard
        check(hudAct.includes('TAXI'), 'taxi : le HUD affiche l’activité', hudAct.slice(0, 60));
        await shot('8_taxi');
      }
    }

    // 7. Rendu et erreurs
    const calls = await ev<number>('window.__wtf.drawCalls');
    check(calls < 150, 'rendu : appels de dessin < 150', String(calls));
    check(logs.length === 0, 'client : aucune erreur console', logs.slice(0, 4).join(' | '));
    const bad = srvLogs.filter((l) => /\[game\]|TypeError|RangeError|Erreur/.test(l));
    check(bad.length === 0, 'serveur : aucune erreur dans le journal', bad.slice(0, 3).join(' | '));
    check(!sim().broken, 'Rapier jamais empoisonné');
    ws.close();
  } finally {
    try { chrome?.kill(); } catch { /* ignoré */ }
    await server.stop();
    await sleep(500);
    for (const d of [profile, saveDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* verrou Windows : ignoré */ } }
  }
  console.log(fails ? `${fails} échec(s)` : 'reel : TOUT VERT');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
