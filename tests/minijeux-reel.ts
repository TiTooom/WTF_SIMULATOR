// PROPRIÉTAIRE : game-minigames
// Vérification « en vrai » des 8 mini-jeux : serveur réel (startServer, port aléatoire, SAVE_DIR temporaire) + Chrome headless (CDP, rendu logiciel).
// Chaque jeu est lancé par `/debug mg <kind>` puis JOUÉ avec de vraies entrées (Input.dispatchMouseEvent / dispatchKeyEvent) ; captures à mi-partie
// et à la fin ; le serveur doit renvoyer mg_end ok=true. Un joueur passif doit échouer (expiration), Échap annule, etc.
// Lancement : npx tsx tests/minijeux-reel.ts [dossier de captures]
// Prérequis : client compilé (`npx vite build`, dist/public ou variable MG_PUBLIC) ; Chrome (variable CHROME ou chemin par défaut ; saute si absent).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../server/server';
import { getCity } from '../shared/city/layout';
import { MINIGAME_KINDS, type MinigameKind } from '../shared/ids';
import { DIGI_COLS, RULES, briseGlaceSpec, digicodePos, digicodeSpec, dosageSpec, tournevisSpec } from '../shared/minigames/rules';

const PORT = 3100 + Math.floor(Math.random() * 800);
const DEBUG = 9400 + Math.floor(Math.random() * 400);
const out = process.argv[2] ?? join(tmpdir(), 'gta-minijeux-reel');
const CHROME = process.env.CHROME
  ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, msg: string, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'OK   ' : 'ECHEC'} ${msg}${detail ? '  — ' + detail : ''}`); };

const W = 640;
const H = 400;
const SCENARIO_MS = 60000;

type Ev = { k: string; sid?: number; ok?: boolean; s?: { sid: number; kind: string; seed: number; difficulty: number; maxMs: number } };

async function main() {
  if (!CHROME) { console.log('minijeux-reel : Chrome introuvable, suite sautée.'); return; }
  mkdirSync(out, { recursive: true });
  const saveDir = mkdtempSync(join(tmpdir(), 'gta-mgsave-'));
  const profile = mkdtempSync(join(tmpdir(), 'gta-mgchrome-'));
  const srvLogs: string[] = [];
  const server = await startServer({ mode: 'solo', saveDir, publicDir: resolve(process.env.MG_PUBLIC ?? 'dist/public'), port: PORT, log: (l) => srvLogs.push(l) });
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
    if (!wsUrl) { console.log('minijeux-reel : Chrome ne répond pas, suite sautée.'); return; }
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('CDP')); });
    let id = 0;
    const pending = new Map<number, (r: { result?: { result?: { value?: unknown }; data?: string } }) => void>();
    const logs: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') { const d = String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (!/pointer lock/i.test(d)) logs.push('EXC ' + d); } // requestPointerLock sans fenêtre active : artefact du mode sans tête
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + (m.params.args?.[0]?.value ?? m.params.args?.[0]?.description));
    };
    const send = (method: string, params: object = {}) => new Promise<{ result?: { result?: { value?: unknown }; data?: string } }>((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async <T>(expr: string): Promise<T> => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value as T;

    // Compteur d'écouteurs sur window/document (détection des fuites) installé avant tout script de la page
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const ids = new WeakMap(); let n = 0; const reg = new Set();
        const key = (t, type, fn, opt) => { if (!fn || (t !== window && t !== document)) return null; let i = ids.get(fn); if (!i) { i = ++n; ids.set(fn, i); }
          const cap = typeof opt === 'object' ? !!(opt && opt.capture) : !!opt; return (t === window ? 'w' : 'd') + '|' + type + '|' + cap + '|' + i; };
        const a = EventTarget.prototype.addEventListener, r = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (type, fn, opt) { const k = key(this, type, fn, opt); if (k) reg.add(k); return a.call(this, type, fn, opt); };
        EventTarget.prototype.removeEventListener = function (type, fn, opt) { const k = key(this, type, fn, opt); if (k) reg.delete(k); return r.call(this, type, fn, opt); };
        window.__lis = () => reg.size;
        // Rendu 3D court-circuité pendant les parties (le rendu logiciel est trop lent pour piloter un jeu d'adresse) ; réactivé pour les captures de contexte
        window.__noGL = true;
        for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue;
          for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) { const o = P.prototype[fn]; if (!o) continue;
            P.prototype[fn] = function () { if (window.__noGL) return; return o.apply(this, arguments); }; } }
        window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      })()`,
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?name=Testeur&nopause` });

    for (let i = 0, ok = false; i < 100 && !ok; i++) { await sleep(300); ok = !!(await ev<boolean>('!!(window.__wtf && window.__wtf.me)')); }
    check(!!(await ev<boolean>('!!(window.__wtf && window.__wtf.me)')), 'connexion au serveur réel');
    await ev(`(() => { const n = window.__wtf.net; window.__ev = []; const o = n.onGame; n.onGame = (e) => { window.__ev.push(Object.assign({ at: performance.now() }, e)); o(e); }; return 1; })()`);
    const sim = () => server.sim();
    const player = () => [...sim().players.values()][0];
    const sendChat = (text: string) => ev(`window.__wtf.net.send({ type: 'chat', text: ${JSON.stringify(text)} })`);
    const events = () => ev<(Ev & { at: number })[]>('window.__ev');
    const clearEv = () => ev('window.__ev.length = 0');
    const fps = async () => { const a = await ev<number>('window.__frames'); await sleep(1000); return (await ev<number>('window.__frames')) - a; };
    console.log(`     images par seconde (rendu logiciel) : ${await fps()}`);
    // laisse tomber les véhicules/piétons, place le joueur dans un coin calme
    await sleep(800);

    // ---------- entrées ----------
    let mx = 640, my = 360;
    const mouse = (type: string, button = 'none', buttons = 0) => send('Input.dispatchMouseEvent', { type, x: mx, y: my, button, buttons, clickCount: button === 'none' ? 0 : 1 });
    const down = () => mouse('mousePressed', 'left', 1);
    const up = () => mouse('mouseReleased', 'left', 0);
    const click = async () => { await down(); await up(); };
    const key = async (code: string, vk: number, k: string) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk });
    };
    await mouse('mouseMoved');
    type Cur = { x: number; y: number; sc: number; gone?: boolean };
    const cur = async () => (await ev<Cur | null>('window.__mg ? { x: __mg.cursor.x, y: __mg.cursor.y, sc: __mg.scale() } : null')) ?? { x: -1, y: -1, sc: 1, gone: true };
    const probe = async () => (await ev<Record<string, number> | null>('window.__mg ? __mg.probe() : null')) ?? { gone: 1, cx: 320, cy: 200, level: 0, target: 0, shuffled: 1 };
    const mgNow = async () => (await ev<number | null>('window.__mg ? __mg.now() : null')) ?? 1e9;
    /** Déplace le curseur virtuel du jeu vers (cx, cy) en coordonnées du canvas, par petits pas de souris. */
    const moveTo = async (cx: number, cy: number, stepPx = 40, pause = 6) => {
      const c = await cur(); // une seule lecture : les déplacements relatifs de la souris sont exacts (pas de dérive)
      if (c.gone) return;
      const dx = cx - c.x, dy = cy - c.y, d = Math.hypot(dx, dy);
      if (d < 1) return;
      const n = Math.max(1, Math.ceil(d / stepPx));
      for (let i = 0; i < n; i++) { mx += (dx * c.sc) / n; my += (dy * c.sc) / n; await mouse('mouseMoved'); if (pause) await sleep(pause); }
    };
    const shot = async (name: string, full = false) => {
      const clip = full ? undefined : await ev<{ x: number; y: number; width: number; height: number; scale: number } | null>(`(() => { const c = document.querySelector('#mg-overlay canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x - 24, y: r.y - 24, width: r.width + 60, height: r.height + 60, scale: 1 }; })()`);
      const png = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      const f = join(out, `${name}.png`);
      writeFileSync(f, Buffer.from(png.result?.data ?? '', 'base64'));
    };

    // ---------- robots (un par jeu) ----------
    type Ctx = { start: NonNullable<Ev['s']>; mid: () => Promise<void> };
    const bots: Record<MinigameKind, (c: Ctx) => Promise<void>> = {
      async tournevis(c) {
        const s = tournevisSpec(c.start.seed, c.start.difficulty);
        const p = await probe();
        await moveTo(p.cx + 100, p.cy);
        const sc = (await cur()).sc;
        await down();
        await sleep(260);
        let a = 0;
        const total = s.turns * Math.PI * 2 + 0.8;
        let midDone = false;
        while (Math.abs(a) < total) {
          const na = a + s.dir * 0.7; // cercle de rayon 100 par pas de 0,7 rad (déplacement relatif exact)
          mx += (Math.cos(na) - Math.cos(a)) * 100 * sc; my += (Math.sin(na) - Math.sin(a)) * 100 * sc;
          a = na;
          await mouse('mouseMoved');
          await sleep(6);
          if (!midDone && Math.abs(a) > total / 2) { midDone = true; await c.mid(); }
        }
        await up();
      },
      async court_circuit(c) {
        const p = await probe();
        await moveTo(70, p.e0y, 140, 0);
        await down();
        await moveTo(p.zx - 9, p.zy, 140, 0);
        await up();
        await moveTo(W - 70, p.e1y, 140, 0);
        await down();
        await moveTo(p.zx + 9, p.zy, 140, 0);
        await up();
        await c.mid(); // la jauge se remplit pendant la capture ; le serveur attend la fin du contact d'une seconde
      },
      async digicode(c) {
        const s = digicodeSpec(c.start.seed, c.start.difficulty);
        let prev = -1e9;
        for (let i = 0; i < DIGI_COLS; i++) {
          // instant futur où la colonne i est au plus près du centre de sa zone verte
          const lat0 = Date.now(); const t0 = await mgNow(); const lat = (Date.now() - lat0) / 2;
          let best = -1, bd = 9;
          for (let t = Math.max(prev + 220, t0 + 90 + lat * 2); t < t0 + 1400; t += 4) {
            const d = Math.abs(digicodePos(s.cols[i], t) - s.cols[i].center);
            if (d < bd) { bd = d; best = t; }
          }
          // attente active : on relit l'horloge du jeu et on envoie le clic un peu avant l'instant visé
          for (;;) {
            const t = await mgNow();
            const left = best - t - lat - 6;
            if (left <= 14) { if (left > 0) await sleep(left); break; }
            await sleep(Math.max(4, left - 30));
          }
          await down();
          await up();
          prev = best;
          if (i === 1) await c.mid();
        }
      },
      async dosage(c) {
        const s = dosageSpec(c.start.seed, c.start.difficulty);
        for (let i = 0; i < s.targets.length; i++) {
          await down();
          for (;;) { // relâche dès que le niveau lu dans le jeu atteint la ligne (compense la latence)
            const p = await probe();
            if (p.gone || p.level >= s.targets[i] - 0.025) break;
            await sleep(4);
          }
          await up();
          if (i === 1) await c.mid();
          await sleep(60);
        }
      },
      async fouille(c) {
        const p = await probe();
        const y = p.y;
        await moveTo(p.left + 5, y);
        await sleep(30);
        await c.mid();
        for (let k = 0; k < 3; k++) await moveTo(k % 2 === 0 ? p.left + 95 : p.left + 5, y, 12, 4);
        await moveTo(p.x, p.y);
        await click();
      },
      async brise_glace(c) {
        const hits = briseGlaceSpec(c.start.seed, c.start.difficulty).hits;
        for (let i = 0; i < hits; i++) {
          if (i % 2) await key('Space', 32, ' '); else await click();
          if (i === 2) await c.mid();
          await sleep(78);
        }
      },
      async desamorcage(c) {
        // le fil flashe 0,5 s ; on attend le mélange puis on tranche la même couleur à sa nouvelle place
        let p = await probe();
        for (let i = 0; i < 60 && !p.shuffled; i++) { await sleep(40); p = await probe(); }
        await c.mid();
        p = await probe();
        await moveTo(W / 2, p.y);
        if (process.env.DEBUGMG) console.log('     [des]', JSON.stringify(p), JSON.stringify(await cur()), 'spec', JSON.stringify(c.start));
        await click();
      },
      async liasses(c) {
        const p = await probe();
        for (let i = 0; i < p.target; i++) {
          await moveTo(p.sx, p.sy, 140, 0);
          await down();
          await moveTo(p.gx, p.gy, 140, 0);
          await up();
          if (i === 1) await c.mid();
        }
        if (process.env.DEBUGMG) console.log('     [li]', JSON.stringify(await probe()), 'now', await mgNow());
        await moveTo(p.tx, p.ty, 140, 0);
        await click();
      },
    };

    /** Lance le jeu, le joue (ou pas), renvoie le résultat serveur et la durée côté client. */
    async function run(kind: MinigameKind, how: 'jouer' | 'passif', tag: string, vue = false) {
      home();
      mx = 640; my = 360; await mouse('mouseMoved'); // la souris repart du centre à chaque partie (le curseur du jeu aussi) : pas de dérive hors fenêtre
      await clearEv();
      await sendChat(`/debug mg ${kind}`);
      let st: Ev | undefined;
      for (let i = 0; i < 40 && !st; i++) { await sleep(100); st = (await events()).find((e) => e.k === 'mg_start'); }
      if (!st?.s) return { started: false, ok: false, ms: 0, starts: 0 };
      for (let i = 0; i < 20 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(50);
      const t0 = Date.now();
      if (vue && how === 'jouer') await shot(`${tag}_0_debut`, true);
      if (how === 'jouer') {
        await Promise.race([
          bots[kind]({ start: st.s, mid: async () => { if (vue) await shot(`${tag}_1_mi`); } }),
          sleep(SCENARIO_MS).then(() => { throw new Error('bot trop long'); }),
        ]);
        if (vue) await shot(`${tag}_2_fin`);
      }
      let end: Ev | undefined;
      for (let i = 0; i < 100 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      if (vue && how === 'passif') await shot(`${tag}_3_echec`); // animation de sortie en rouge
      const starts = (await events()).filter((e) => e.k === 'mg_start').length;
      if (process.env.DEBUGMG) console.log('     [debug]', kind, how, JSON.stringify((await events()).map((e) => ({ k: e.k, ok: e.ok, at: Math.round(e.at) }))), 'hp', player().hp);
      // la superposition se ferme d'elle-même après l'animation de sortie
      for (let i = 0; i < 30 && (await ev<boolean>(`!!document.getElementById('mg-overlay')`)); i++) await sleep(100);
      return { started: true, ok: !!end?.ok, ended: !!end, ms: Date.now() - t0, starts, maxMs: st.s.maxMs, s: st.s };
    }

    const baseLis = await ev<number>('window.__lis()');
    // La caméra du jeu regarde le joueur : on le met au calme pour que le fond soit lisible
    const park = getCity().blocks.find((b) => b.kind === 'parc') ?? getCity().blocks[0];
    const home = () => { sim().teleportPlayer(player(), park.x, 1.3, park.z); player().hp = 100; };
    home();
    await sleep(500);

    // ---------- 1. chaque jeu : réussite jouée, échec passif, deuxième essai d'affilée ----------
    const ONLY = (process.env.MG_ONLY ?? '').split(',').filter(Boolean);
    for (const kind of MINIGAME_KINDS) {
      if (ONLY.length && !ONLY.includes(kind)) continue;
      let r: Awaited<ReturnType<typeof run>> | null = null;
      let attempts = 0;
      // premier essai : avec captures (le temps perdu aux captures peut coûter la partie : un essai de plus sans capture au besoin)
      r = await run(kind, 'jouer', kind, true); attempts++;
      if (!r.ok) { console.log(`     ${kind} : essai ${attempts} perdu (${r.ms} ms), nouvel essai sans capture`); r = await run(kind, 'jouer', kind); attempts++; }
      if (!r.ok) { r = await run(kind, 'jouer', kind); attempts++; }
      check(r.started && r.ok, `${kind} : joué à la souris/clavier, le serveur valide (mg_end ok)`, `${attempts} essai(s), ${r.ms} ms`);
      const r2 = await run(kind, 'jouer', kind); // enchaîné immédiatement
      let ok2 = r2.ok;
      if (!ok2) ok2 = (await run(kind, 'jouer', kind)).ok;
      check(ok2, `${kind} : deuxième partie d'affilée réussie`);
      const rp = await run(kind, 'passif', kind, true);
      check(rp.started && !rp.ok && rp.ended === true, `${kind} : joueur passif -> échec`, `${rp.ms} ms (max ${RULES[kind].maxMs})`);
      check(rp.ms <= RULES[kind].maxMs + 2500, `${kind} : échec passif dans les temps (< 4 s + sortie)`, `${rp.ms} ms`);
      check(!(await ev<boolean>(`!!document.getElementById('mg-overlay')`)), `${kind} : superposition retirée`);
    }
    check((await ev<number>('window.__lis()')) === baseLis, 'aucune fuite d\'écouteurs window/document après 24 parties', `${baseLis} -> ${await ev<number>('window.__lis()')}`);

    // ---------- 1b. capture de contexte : le mini-jeu par-dessus la ville réelle (rendu 3D réactivé) ----------
    if (!ONLY.length || ONLY.includes('contexte')) {
      await ev('window.__noGL = false');
      home();
      await sleep(1200);
      await clearEv();
      await sendChat('/debug mg fouille');
      for (let i = 0; i < 30 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(100);
      await sleep(1500);
      await shot('contexte_ville', true);
      await key('Escape', 27, 'Escape');
      await sleep(600);
      await ev('window.__noGL = true');
    }

    // ---------- 2. annulation par Échap ----------
    if (!ONLY.length) {
      await clearEv();
      await sendChat('/debug mg digicode');
      for (let i = 0; i < 30 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(100);
      await sleep(400);
      await key('Escape', 27, 'Escape');
      let end: Ev | undefined;
      for (let i = 0; i < 30 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      check(!!end && end.ok === false, 'Échap annule : échec envoyé, mg_end ok=false');
      check(!(await ev<boolean>(`!!document.getElementById('mg-overlay')`)), 'Échap : superposition retirée immédiatement');
      const rr = await run('brise_glace', 'jouer', 'apres_echap');
      check(rr.ok, 'nouvelle partie possible juste après Échap');
    }
    // perte du pointer lock = annulation
    if (!ONLY.length) {
      await clearEv();
      await sendChat('/debug mg dosage');
      for (let i = 0; i < 30 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(100);
      await ev(`document.dispatchEvent(new Event('pointerlockchange'))`);
      let end: Ev | undefined;
      for (let i = 0; i < 30 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      check(!!end && end.ok === false && !(await ev<boolean>(`!!document.getElementById('mg-overlay')`)), 'perte du pointer lock : annulation propre');
    }

    // ---------- 3. robustesse côté jeu ----------
    if (!ONLY.length) {
      // relancé en boucle : un seul mini-jeu à la fois, une seule superposition
      await clearEv();
      for (let i = 0; i < 6; i++) await sendChat('/debug mg liasses');
      await sleep(900);
      const starts = (await events()).filter((e) => e.k === 'mg_start').length;
      const overlays = await ev<number>(`document.querySelectorAll('#mg-overlay').length`);
      check(starts === 1 && overlays === 1, '/debug mg relancé 6 fois : une seule session et une seule superposition', `${starts} start, ${overlays} superposition(s)`);
      // touché pendant le jeu : le serveur annule, le client ferme
      await clearEv();
      sim().damagePlayer(player(), 20, null, 'test');
      let end: Ev | undefined;
      for (let i = 0; i < 30 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      for (let i = 0; i < 20 && (await ev<boolean>(`!!document.getElementById('mg-overlay')`)); i++) await sleep(100);
      check(!!end && !end.ok && !(await ev<boolean>(`!!document.getElementById('mg-overlay')`)), 'joueur touché : le serveur annule, le client ferme la superposition');
      // résultat tardif : sid déjà clos, ignoré sans effet
      await clearEv();
      await ev(`window.__wtf.net.send({ type: 'game', m: { k: 'mg', r: { sid: ${end?.sid ?? 1}, ok: true, ms: 1500, data: [3, 500] } } })`);
      await sleep(500);
      check((await events()).length === 0, 'résultat tardif (sid clos) ignoré par le serveur');
      // éloignement (pause : l'anti-spam du chat a pu voir passer 6 commandes d'affilée)
      await sleep(3000);
      await sendChat('/debug mg tournevis');
      for (let i = 0; i < 30 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(100);
      await clearEv();
      sim().teleportPlayer(player(), 60, 1.3, 60);
      end = undefined;
      for (let i = 0; i < 30 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      check(!!end && !end.ok, 's\'éloigner annule le mini-jeu');
      home();
      await sleep(400);
      // mort pendant le jeu, puis aucun démarrage tant que mort
      await sendChat('/debug mg fouille');
      for (let i = 0; i < 30 && !(await ev<boolean>('!!window.__mg')); i++) await sleep(100);
      await clearEv();
      sim().damagePlayer(player(), 999, null, 'test');
      end = undefined;
      for (let i = 0; i < 30 && !end; i++) { await sleep(100); end = (await events()).find((e) => e.k === 'mg_end'); }
      check(!!end && !end.ok, 'mort pendant le jeu : annulé');
      await clearEv();
      await sendChat('/debug mg fouille');
      await sleep(500);
      const dead = player().hp <= 0;
      const started = (await events()).some((e) => e.k === 'mg_start');
      check(!(dead && started), 'pas de mini-jeu démarré sur un joueur mort', `mort=${dead} start=${started}`);
      for (let i = 0; i < 100 && player().hp <= 0; i++) await sleep(100);
      await sleep(500);
    }

    // ---------- 4. fin ----------
    check((await ev<number>('window.__lis()')) === baseLis, 'toujours aucune fuite d\'écouteurs à la fin');
    const bad = srvLogs.filter((l) => /\[game\]|\[minigames\]|TypeError|RangeError|Erreur/.test(l));
    check(bad.length === 0, 'serveur : aucune erreur dans le journal', bad.slice(0, 3).join(' | '));
    check(logs.length === 0, 'client : aucune erreur console', logs.slice(0, 4).join(' | '));
    check(!sim().broken, 'Rapier jamais empoisonné');
    ws.close();
  } finally {
    try { chrome?.kill(); } catch { /* ignoré */ }
    await server.stop();
    await sleep(500);
    for (const d of [profile, saveDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* verrou Windows : ignoré */ } }
  }
  console.log(fails ? `${fails} échec(s)` : 'minijeux-reel : TOUT VERT');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
