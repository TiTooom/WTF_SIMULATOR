// Suite « captures » (PROPRIÉTAIRE : art-toon) : rend des scènes du client dans Chrome headless (WebGL logiciel) via CDP, SANS serveur de jeu,
// enregistre des PNG et vérifie les budgets (appels de dessin de la ville).
// Lancement : npx tsx tests/captures.ts [dossier de sortie] [shot ...]   (Chrome : variable CHROME ou chemin Windows par défaut)
// Shots : city city_high vehicles peds hud pda_carte pda_sms comic_<image>. Saute proprement (code 0) si Chrome est introuvable.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const PORT = 3600 + Math.floor(Math.random() * 100);
const DEBUG = PORT + 100;
const out = process.argv[2] && !process.argv[2].startsWith('shot=') ? process.argv[2] : join(tmpdir(), 'gta-captures');
const only = process.argv.slice(3);
const SHOTS = only.length ? only : ['city', 'city_high', 'vehicles', 'peds', 'hud', 'pda_carte', 'pda_sms', 'comic_ruelle', 'comic_explosion'];
const CHROME = process.env.CHROME
  ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

const deadline = Date.now() + 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

async function main() {
  if (!CHROME) { console.log('captures : Chrome introuvable (variable CHROME), suite sautée.'); return; }
  mkdirSync(out, { recursive: true });
  const vite = await createServer({ root: process.cwd(), logLevel: 'silent', server: { port: PORT, strictPort: true, host: '127.0.0.1' }, optimizeDeps: { noDiscovery: true } });
  await vite.listen();
  const profile = mkdtempSync(join(tmpdir(), 'gta-chrome-'));
  let chrome: ChildProcess | null = null;
  try {
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--hide-scrollbars',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: 'ignore' });
    let wsUrl = '';
    while (!wsUrl && Date.now() < deadline) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
      } catch { /* pas encore prêt */ }
      if (!wsUrl) await sleep(300);
    }
    if (!wsUrl) { console.log('captures : Chrome ne répond pas, suite sautée.'); return; }
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('CDP')); });
    let id = 0;
    const pending = new Map<number, (r: { result?: Record<string, unknown>; error?: unknown }) => void>();
    const logs: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + (m.params.args?.[0]?.value ?? m.params.args?.[0]?.description));
    };
    const send = (method: string, params: object = {}) => new Promise<{ result?: Record<string, unknown> }>((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    for (const shot of SHOTS) {
      if (Date.now() > deadline) { console.log('captures : délai global atteint.'); break; }
      logs.length = 0;
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/tests/captures.html?shot=${shot}` });
      let info: { ready: boolean; calls: number; tris: number; cityDraw: number; chunks: number; ms: number } | null = null;
      for (let k = 0; k < 80 && Date.now() < deadline; k++) {
        await sleep(400);
        const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__shot || null)', returnByValue: true });
        const v = (r.result as { result?: { value?: string } } | undefined)?.result?.value;
        if (v) { const j = JSON.parse(v); if (j?.ready) { info = j; break; } }
      }
      if (!info) { check(false, `${shot} : scène non prête ${logs.slice(0, 3).join(' | ')}`); continue; }
      await sleep(500);
      const png = (await send('Page.captureScreenshot', { format: 'png' })).result as { data: string };
      const file = join(out, `${shot}.png`);
      writeFileSync(file, Buffer.from(png.data, 'base64'));
      console.log(`     ${shot} -> ${file} (rendu ${info.calls} appels, ${info.tris} triangles, ville ${info.cityDraw} maillages, ${info.chunks} chunks)`);
      check(logs.length === 0, `${shot} : aucune erreur console ${logs.slice(0, 3).join(' | ')}`);
      if (shot.startsWith('city') || shot === 'hud') {
        check(info.cityDraw <= 150, `${shot} : ville ≤ 150 maillages (${info.cityDraw})`);
        check(info.chunks <= 9, `${shot} : ≤ 9 chunks visibles (${info.chunks})`);
      }
    }
    ws.close();
  } finally {
    chrome?.kill();
    await vite.close();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* verrous Windows : sans importance */ }
  }
}

main().then(() => { console.log(failures ? `captures : ${failures} échec(s)` : 'captures : OK'); process.exit(failures ? 1 : 0); }, (e) => { console.error(e); process.exit(1); });
