// Serveur du jeu (module réutilisable) : physique autoritaire + WebSocket + fichiers du client + sauvegarde.
// Démarré par l'application (electron/main.ts) ou en ligne de commande (server/index.ts).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Sim } from '../shared/sim';
import { DEFAULT_PORT, MAX_PLAYERS, SNAP_HZ, STEP } from '../shared/constants';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

export interface ServerOptions {
  mode: 'solo' | 'multi';
  saveDir: string;
  publicDir: string; // dossier du client compilé
  hostName?: string; // nom affiché aux autres joueurs
  port?: number;
  log?: (line: string) => void;
}

export interface ServerInfo {
  game: 'jeu3d';
  name: string;
  mode: 'solo' | 'multi';
  players: number;
  port: number;
  urls: string[]; // adresses à donner aux amis (vide en solo)
}

export interface RunningServer {
  port: number;
  info(): ServerInfo;
  stop(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const isPrivate = (ip: string) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip);

/** Adresses IPv4 locales (réseau privé en premier). */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address)
    .sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { mode, saveDir, publicDir } = opts;
  const log = opts.log ?? (() => {});
  const saveFile = path.join(saveDir, `${mode}.json`);
  const hostName = opts.hostName?.trim() || 'Partie';

  // ---------- Simulation + sauvegarde ----------
  const sim = await Sim.create();
  try {
    sim.restore(JSON.parse(fs.readFileSync(saveFile, 'utf8')));
    log(`Sauvegarde chargée : ${saveFile}`);
  } catch {
    log('Nouvelle partie (aucune sauvegarde trouvée).');
  }
  const save = () => {
    try {
      fs.mkdirSync(saveDir, { recursive: true });
      const tmp = `${saveFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(sim.serialize()));
      fs.renameSync(tmp, saveFile); // écriture atomique : jamais de sauvegarde à moitié écrite
    } catch (e) {
      log(`Échec de la sauvegarde : ${e}`);
    }
  };
  const saveTimer = setInterval(save, 30_000);

  // ---------- HTTP ----------
  let actualPort = opts.port ?? DEFAULT_PORT;
  const info = (): ServerInfo => ({
    game: 'jeu3d', name: hostName, mode, players: sockets.size, port: actualPort,
    urls: mode === 'multi' ? lanAddresses().map((ip) => `http://${ip}:${actualPort}`) : [],
  });

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(info()));
      return;
    }
    const file = path.resolve(publicDir, '.' + path.sep + (urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(publicDir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const sockets = new Map<WebSocket, string>(); // socket -> id joueur
  let nextId = 1;
  const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const id = sockets.get(ws);
      if (msg.type === 'join' && !id) {
        if (sockets.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Serveur plein.' });
        const name = String(msg.name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || `Joueur${nextId}`;
        const pid = `p${nextId++}`;
        sockets.set(ws, pid);
        sim.addPlayer(pid, name);
        send(ws, { type: 'welcome', id: pid, mode });
        log(`+ ${name} (${sockets.size} joueur(s))`);
      } else if (id && msg.type === 'input') {
        sim.setInput(id, msg.i ?? {});
      } else if (id && msg.type === 'interact') {
        sim.interact(id);
      }
    });
    ws.on('close', () => {
      const id = sockets.get(ws);
      if (!id) return;
      log(`- ${sim.players.get(id)?.name} (${sockets.size - 1} joueur(s))`);
      sim.removePlayer(id);
      sockets.delete(ws);
      if (sockets.size === 0) save();
    });
  });

  // ---------- Boucle de simulation à pas fixe ----------
  let acc = 0;
  let last = performance.now();
  let ticks = 0;
  const snapEvery = Math.round(1 / STEP / SNAP_HZ);
  const loop = setInterval(() => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    while (acc >= STEP) {
      sim.step();
      acc -= STEP;
      if (++ticks % snapEvery === 0 && sockets.size > 0) {
        const data = JSON.stringify({ type: 'snap', s: sim.snapshot() } satisfies ServerMsg);
        for (const ws of sockets.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
      }
    }
  }, 8);

  // ---------- Écoute (essaie les ports suivants si occupé) ----------
  const host = mode === 'solo' ? '127.0.0.1' : '0.0.0.0';
  const basePort = actualPort;
  await new Promise<void>((resolve, reject) => {
    const tryListen = (p: number) => {
      actualPort = p;
      const onError = (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && p < basePort + 10) tryListen(p + 1);
        else reject(e);
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.off('error', onError);
        resolve();
      });
    };
    tryListen(basePort);
  }).catch((e) => {
    clearInterval(saveTimer);
    clearInterval(loop);
    throw e;
  });
  log(`Serveur ${mode} prêt sur le port ${actualPort}`);

  return {
    port: actualPort,
    info,
    async stop() {
      clearInterval(loop);
      clearInterval(saveTimer);
      save();
      for (const ws of sockets.keys()) ws.close();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
