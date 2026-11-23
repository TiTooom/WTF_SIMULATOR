// Serveur du jeu (module réutilisable) : physique autoritaire + WebSocket + fichiers du client + sauvegarde.
// Démarré par l'application (electron/main.ts) ou en ligne de commande (server/index.ts).
// Robustesse : aucun client ne doit pouvoir faire tomber le processus (tout handler est sous try/catch, les sockets ont un
// écouteur d'erreur, les requêtes HTTP sont validées) et une panique de Rapier (monde empoisonné) est rattrapée par un « disjoncteur » :
// la simulation est reconstruite à partir du dernier état sain gardé en mémoire, sans déconnecter personne.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Sim, type SaveData } from '../shared/sim';
import { DEFAULT_PORT, MAX_PLAYERS, SNAP_HZ, STEP } from '../shared/constants';
import { MAX_GAME_MSG_CHARS } from '../shared/game';
import type { ChatMsg, ClientMsg, GameServerEvent, ServerMsg } from '../shared/protocol';
import { runCommand } from './commands';
import { installGame, type Game, type Outgoing } from './game';

export interface ServerOptions {
  mode: 'solo' | 'multi';
  saveDir: string;
  publicDir: string; // dossier du client compilé
  hostName?: string; // nom affiché aux autres joueurs
  port?: number;
  log?: (line: string) => void;
  /** Appelé si le serveur doit s'arrêter seul (monde qui s'effondre en boucle). La partie est sauvegardée avant. */
  onFatal?: (reason: string) => void;
  /** Période du heartbeat WebSocket (ms, 10 000 par défaut ; réduite par les tests). */
  heartbeatMs?: number;
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
  /** Simulation courante (elle change si le disjoncteur reconstruit le monde). Pour les tests et le diagnostic. */
  sim(): Sim;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const MAX_SOCKETS = 2 * MAX_PLAYERS;
const MAX_SOCKETS_PER_IP = 4;
const JOIN_TIMEOUT_MS = 5000; // un socket qui n'a pas dit « join » dans ce délai est fermé
const JOIN_MIN_GAP_MS = 2000; // 1 join par IP toutes les 2 s
const GOOD_STATE_EVERY_MS = 10_000; // instantané en mémoire du dernier état sain
const MAX_REBUILDS = 3; // reconstructions du monde par minute, au-delà : arrêt propre
const RESERVED_NAMES = new Set(['serveur', 'server', 'system', 'systeme', 'admin']);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
  const { mode, saveDir } = opts;
  const publicDir = path.resolve(opts.publicDir);
  const log = opts.log ?? (() => {});
  const saveFile = path.join(saveDir, `${mode}.json`);
  const hostName = opts.hostName?.trim() || 'Partie';

  // ---------- Simulation + sauvegarde ----------
  let sim = await Sim.create();
  let savedGame: unknown;
  try {
    const raw = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
    sim.restore(raw); // ignore tout ce qui n'est pas une sauvegarde v3
    savedGame = raw?.version === 3 ? raw.systems : undefined; // état des systèmes de jeu (revalidé par chaque système)
    log(`Sauvegarde chargée : ${saveFile}`);
  } catch {
    log('Nouvelle partie (aucune sauvegarde trouvée).');
  }
  let game: Game = installGame(sim, { mode, saved: savedGame }); // logique de jeu (systèmes) au-dessus de la physique
  sim.soloMode = mode === 'solo';

  let lastGameState: unknown = savedGame ?? null; // dernier état du jeu sain (reconstruction et sauvegarde d'un monde cassé)
  let lastGood: SaveData | null = null; // dernier état sérialisé alors que le monde était sain (reconstruction du disjoncteur)
  try { lastGood = sim.serialize(); } catch (e) { sim.noteError(e); }
  let nextGoodAt = performance.now() + GOOD_STATE_EVERY_MS;
  let stopped = false;
  let rebuilding = false;
  const rebuilds: number[] = [];

  const save = () => {
    try {
      let data: SaveData | null = null;
      if (!sim.broken && !rebuilding) {
        try { data = sim.serialize(); lastGood = data; } catch (e) { sim.noteError(e); }
      }
      data ??= lastGood; // monde empoisonné : on sauvegarde le dernier état sain, jamais une lecture du monde cassé
      if (!data) return;
      let gameState: unknown = null;
      if (!sim.broken && !rebuilding) { try { gameState = game.serialize(); lastGameState = gameState; } catch (e) { log(`Sérialisation du jeu ignorée : ${e}`); } } else gameState = lastGameState;
      fs.mkdirSync(saveDir, { recursive: true });
      const tmp = `${saveFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 3, players: data.players, systems: (gameState && typeof gameState === 'object' ? gameState : {}) as Record<string, unknown> } satisfies SaveData));
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

  const reply = (res: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders, body?: string | Buffer) => {
    try {
      res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(body);
    } catch { /* connexion déjà fermée */ }
  };

  const server = http.createServer((req, res) => {
    try {
      let urlPath: string;
      try {
        urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      } catch {
        return reply(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Adresse invalide');
      }
      if (urlPath.includes('\0')) return reply(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Adresse invalide');
      if (urlPath === '/info') return reply(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(info()));
      const file = path.resolve(publicDir, '.' + path.sep + (urlPath === '/' ? 'index.html' : urlPath));
      if (!file.startsWith(publicDir + path.sep)) return reply(res, 403, {});
      fs.readFile(file, (err, data) => {
        try {
          if (err) return reply(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, urlPath === '/' ? 'Serveur Grand Theft Auto : Edition UniLaSalle en marche, mais le client ne se trouve pas ici. En développement, ouvre le port 5173 ; sinon lance npm run build.' : 'Introuvable');
          reply(res, 200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }, data);
        } catch { /* réponse impossible : on ignore */ }
      });
    } catch (e) {
      log(`Erreur HTTP (ignorée) : ${e}`);
      reply(res, 500, {});
    }
  });
  server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch { /* déjà fermé */ } });

  // ---------- WebSocket ----------
  const sockets = new Map<WebSocket, string>(); // socket -> id joueur (uniquement les sockets dont le joueur existe)
  const ipCount = new Map<string, number>();
  const ipOf = new WeakMap<WebSocket, string>();
  const lastJoinByIp = new Map<string, number>();
  const wss = new WebSocketServer({
    server, path: '/ws', maxPayload: 4096,
    verifyClient: ({ origin, req }: { origin: string; req: http.IncomingMessage }) => {
      try {
        // Un site web quelconque ne doit pas pouvoir faire jouer le navigateur d'un ami : l'hôte de l'Origin doit être celui du serveur.
        // (Les clients sans Origin — outils, bots — et l'application Electron, dont la page vient du même hôte, passent.)
        if (origin) {
          if (new URL(origin).host !== req.headers.host) return false;
        }
        if (wss.clients.size >= MAX_SOCKETS) return false;
        const ip = req.socket.remoteAddress ?? '?';
        if ((ipCount.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) return false;
        return true;
      } catch {
        return false;
      }
    },
  });
  wss.on('error', (e) => log(`Erreur WebSocket (ignorée) : ${e}`));
  // Heartbeat : une coupure brutale (navigateur tué, Wi-Fi perdu) n'émet jamais « close » ; sans ping, le joueur fantôme occuperait sa place pour toujours.
  const alive = new WeakMap<WebSocket, { ok: boolean; missed: number }>();
  const dropped = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      try {
        const st = alive.get(ws) ?? { ok: true, missed: 0 };
        alive.set(ws, st);
        st.missed = st.ok ? 0 : st.missed + 1;
        if (st.missed >= 2) { dropped.add(ws); ws.terminate(); continue; } // muet depuis 2 cycles : traité comme un départ
        st.ok = false;
        ws.ping();
      } catch { /* socket qui se ferme */ }
    }
  }, opts.heartbeatMs ?? 10_000);
  const needFull = new Set<WebSocket>(); // clients qui n'ont pas encore reçu de snapshot complet (les suivants sont des deltas)
  let nextId = 1;
  const send = (ws: WebSocket, msg: ServerMsg) => {
    try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } catch { /* socket qui se ferme */ }
  };

  // ---------- Chat ----------
  const chatHistory: ChatMsg[] = []; // derniers messages, renvoyés aux nouveaux arrivants
  const chatTimes = new WeakMap<WebSocket, number[]>(); // anti-spam : 5 messages max par 5 s et par joueur
  const gameTimes = new WeakMap<WebSocket, number[]>(); // anti-spam des messages `game` : 20 par seconde et par socket
  const lastMe = new WeakMap<WebSocket, string>(); // dernier état privé envoyé (le message `me` ne part que s'il change)
  const say = (m: ChatMsg) => {
    chatHistory.push(m);
    if (chatHistory.length > 30) chatHistory.shift();
    const data = JSON.stringify({ type: 'chat', m } satisfies ServerMsg);
    for (const ws of sockets.keys()) {
      try { if (ws.readyState === ws.OPEN) ws.send(data); } catch { /* socket qui se ferme */ }
    }
  };
  const wire = (s: Sim) => {
    s.onAnnounce = (text) => say({ from: '', text, sys: true });
    s.log = (l) => log(l);
    s.soloMode = mode === 'solo';
  };
  wire(sim);
  const cleanChat = (raw: unknown) =>
    String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

  /** Pseudo propre, unique parmi les joueurs connectés (« (2) » sinon) et jamais un mot réservé (serveur, admin…). */
  const uniqueName = (raw: unknown): string => {
    let base = String(raw ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!base || RESERVED_NAMES.has(fold(base))) base = `Joueur${nextId}`;
    const taken = (n: string) => [...sim.players.values()].some((p) => fold(p.name) === fold(n));
    if (!taken(base)) return base;
    for (let i = 2; i < 100; i++) {
      const suffix = ` (${i})`;
      const n = base.slice(0, 16 - suffix.length).trimEnd() + suffix;
      if (!taken(n)) return n;
    }
    return `Joueur${nextId}`;
  };

  const handleMessage = (ws: WebSocket, raw: unknown) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return; // « null », nombres, tableaux : ignorés
    const id = sockets.get(ws);
    if (msg.type === 'join' && !id) {
      const ip = ipOf.get(ws) ?? '?';
      const now = Date.now();
      if (now - (lastJoinByIp.get(ip) ?? 0) < JOIN_MIN_GAP_MS) return send(ws, { type: 'error', message: 'Doucement ! Un seul joueur à la fois et par seconde.' });
      lastJoinByIp.set(ip, now);
      if (lastJoinByIp.size > 200) for (const [k, t] of lastJoinByIp) if (now - t > 10_000) lastJoinByIp.delete(k);
      if (rebuilding || sim.broken) return send(ws, { type: 'error', message: 'Le monde hoquette, réessaie dans un instant.' });
      if (sockets.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Serveur plein.' });
      const name = uniqueName(msg.name);
      const pid = `p${nextId++}`;
      try {
        sim.addPlayer(pid, name);
        if (!sim.players.has(pid)) throw new Error('joueur non créé');
      } catch (e) {
        sim.noteError(e);
        log(`Arrivée de ${name} impossible : ${(e as Error)?.stack ?? e}`);
        try { sim.removePlayer(pid); } catch { /* rien à nettoyer */ }
        send(ws, { type: 'error', message: 'Impossible de te faire entrer pour le moment, réessaie.' });
        try { ws.close(); } catch { /* déjà fermé */ }
        return;
      }
      // Le socket n'est enregistré qu'une fois le joueur réellement créé
      sockets.set(ws, pid);
      try { const pl = sim.players.get(pid); if (pl) game.onJoin(pl); } catch (e) { log(`Erreur du jeu à l'arrivée (ignorée) : ${e}`); }
      needFull.add(ws);
      if (!sim.hostId || !sim.players.has(sim.hostId)) sim.hostId = pid; // le premier arrivé est le chef de la bande
      send(ws, { type: 'welcome', id: pid, mode });
      for (const m of chatHistory) send(ws, { type: 'chat', m });
      if (mode === 'multi') say({ from: '', text: `${name} a rejoint la partie`, sys: true });
      log(`+ ${name} (${sockets.size} joueur(s))`);
    } else if (id && msg.type === 'input') {
      sim.setInput(id, msg.i ?? {});
    } else if (id && msg.type === 'interact') {
      sim.interact(id);
    } else if (id && msg.type === 'game') {
      // Message de jeu : taille bornée, cadence bornée, puis validation structurelle stricte dans game.onMessage (parseGameMsg)
      if (String(raw).length > MAX_GAME_MSG_CHARS) return;
      const now = Date.now();
      const recent = (gameTimes.get(ws) ?? []).filter((t) => now - t < 1000);
      if (recent.length >= 20) return;
      gameTimes.set(ws, [...recent, now]);
      const player = sim.players.get(id);
      if (!player || rebuilding || sim.broken) return;
      game.onMessage(player, (msg as { m?: unknown }).m);
    } else if (id && msg.type === 'chat') {
      const text = cleanChat(msg.text);
      const now = Date.now();
      const recent = (chatTimes.get(ws) ?? []).filter((t) => now - t < 5000);
      if (!text || recent.length >= 5) return; // vide ou trop rapide : ignoré
      chatTimes.set(ws, [...recent, now]);
      const player = sim.players.get(id);
      if (!player) return;
      if (text.startsWith('/')) {
        // Commande : exécutée côté serveur, réponse privée, jamais diffusée telle quelle
        runCommand(sim, player, text, (t) => send(ws, { type: 'chat', m: { from: '', text: t, sys: true } }));
        return;
      }
      say({ from: player.name, text });
    }
  };

  wss.on('connection', (ws, req) => {
    alive.set(ws, { ok: true, missed: 0 });
    ws.on('pong', () => { const st = alive.get(ws); if (st) { st.ok = true; st.missed = 0; } });
    ws.on('error', () => {}); // premier écouteur : un message trop gros ou un socket cassé ne doit JAMAIS faire tomber le processus
    const ip = req.socket.remoteAddress ?? '?';
    ipOf.set(ws, ip);
    ipCount.set(ip, (ipCount.get(ip) ?? 0) + 1);
    // Un socket muet (qui n'envoie pas « join ») occupe une place pour rien : fermé au bout de 5 s
    const mute = setTimeout(() => { if (!sockets.has(ws)) { try { ws.terminate(); } catch { /* déjà fermé */ } } }, JOIN_TIMEOUT_MS);
    ws.on('message', (raw) => {
      try {
        handleMessage(ws, raw);
      } catch (e) {
        if (sim.noteError(e)) return;
        log(`Erreur de message (ignorée) : ${(e as Error)?.stack ?? e}`);
      }
    });
    ws.on('close', () => {
      clearTimeout(mute);
      const n = (ipCount.get(ip) ?? 1) - 1;
      if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
      try {
        const id = sockets.get(ws);
        needFull.delete(ws);
        if (!id) return;
        const name = sim.players.get(id)?.name;
        sockets.delete(ws);
        log(`- ${name} (${sockets.size} joueur(s))`);
        try { const pl = sim.players.get(id); if (pl) game.onLeave(pl); } catch (e) { log(`Erreur du jeu au départ (ignorée) : ${e}`); }
        try { sim.removePlayer(id); } catch (e) { sim.noteError(e); }
        if (sim.hostId === id || !sim.hostId || !sim.players.has(sim.hostId)) {
          // le chef est parti : le joueur connecté le plus ancien reprend le flambeau
          const next = sockets.values().next().value as string | undefined;
          sim.hostId = next ?? '';
          if (next && mode === 'multi') say({ from: '', text: `${sim.players.get(next)?.name ?? 'Quelqu\'un'} est le nouveau chef de la bande`, sys: true });
        }
        if (mode === 'multi' && name) say({ from: '', text: dropped.has(ws) ? `${name} a décroché` : `${name} a quitté la partie`, sys: true });
        if (sockets.size === 0) save();
      } catch (e) {
        log(`Erreur de déconnexion (ignorée) : ${(e as Error)?.stack ?? e}`);
      }
    });
  });

  // ---------- Disjoncteur : reconstruction d'un monde empoisonné ----------
  const fatal = (reason: string) => {
    log(`Arrêt du serveur : ${reason}`);
    save();
    void stop().then(() => opts.onFatal?.(reason));
  };

  const rebuild = async () => {
    if (rebuilding || stopped) return;
    rebuilding = true;
    try {
      const now = Date.now();
      while (rebuilds.length && now - rebuilds[0] > 60_000) rebuilds.shift();
      if (rebuilds.length >= MAX_REBUILDS) return fatal(`le monde s'est effondré ${MAX_REBUILDS} fois en une minute`);
      rebuilds.push(now);
      const old = sim;
      const people = old.knownPlayers(); // positions lues sans toucher au monde cassé
      const time = old.time;
      const hostId = old.hostId;
      const fresh = await Sim.create();
      if (stopped) { fresh.dispose(); return; }
      wire(fresh);
      fresh.time = time;
      fresh.hostId = hostId;
      if (lastGood) {
        try { fresh.restore(lastGood); } catch (e) { log(`Restauration partielle (ignorée) : ${e}`); }
      }
      let carried: unknown = lastGameState ?? undefined;
      try { carried = game.serialize(); } catch { /* l'état des systèmes ne lit pas Rapier : sinon on garde le dernier état sain */ }
      const fg = installGame(fresh, { mode, saved: carried });
      const connected = new Set(sockets.values());
      for (const pl of people) {
        if (!connected.has(pl.id)) continue;
        try { fresh.addPlayer(pl.id, pl.name, pl.pos); } catch (e) { log(`Joueur ${pl.name} non replacé : ${e}`); }
        try { const np = fresh.players.get(pl.id); if (np) fg.onJoin(np); } catch (e) { log(`Erreur du jeu à la reconstruction (ignorée) : ${e}`); }
      }
      if (hostId && !fresh.players.has(hostId)) fresh.hostId = '';
      sim = fresh;
      game = fg;
      fresh.resetDelta();
      for (const ws of sockets.keys()) needFull.add(ws); // snapshot complet pour tous : le monde a changé d'identité
      try { lastGood = fresh.serialize(); } catch (e) { fresh.noteError(e); }
      nextGoodAt = performance.now() + GOOD_STATE_EVERY_MS;
      old.dispose();
      say({ from: '', text: 'Le monde a hoqueté, on remet les choses en place', sys: true });
      log('Monde reconstruit après une panique de la physique.');
    } catch (e) {
      log(`Reconstruction impossible : ${(e as Error)?.stack ?? e}`);
      fatal('reconstruction du monde impossible');
    } finally {
      rebuilding = false;
    }
  };

  // ---------- Jeu : événements ponctuels et état privé ----------
  const routeOutbox = (out: Outgoing[]) => {
    for (const o of out) {
      const data = JSON.stringify({ type: 'game', e: o.ev satisfies GameServerEvent } satisfies ServerMsg);
      for (const [ws, id] of sockets) {
        if (o.to !== null && o.to !== id) continue;
        try { if (ws.readyState === ws.OPEN) ws.send(data); } catch { /* socket qui se ferme */ }
      }
    }
  };
  /** Message `me` : état privé de chaque joueur, 10 Hz au plus, seulement s'il a changé depuis le dernier envoi. */
  const sendMe = () => {
    for (const [ws, id] of sockets) {
      try {
        const p = sim.players.get(id);
        if (!p || ws.readyState !== ws.OPEN) continue;
        const json = JSON.stringify(game.privateFor(p));
        if (lastMe.get(ws) === json) continue;
        lastMe.set(ws, json);
        ws.send(`{"type":"me","s":${json}}`);
      } catch (e) {
        if (sim.noteError(e)) return;
        log(`Erreur d'état privé (ignorée) : ${e}`);
      }
    }
  };

  // ---------- Boucle de simulation à pas fixe ----------
  let acc = 0;
  let last = performance.now();
  let ticks = 0;
  let idle = false;
  const snapEvery = Math.round(1 / STEP / SNAP_HZ);
  const loop = setInterval(() => {
    const now = performance.now();
    if (rebuilding || stopped) { last = now; acc = 0; return; }
    acc = Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    while (acc >= STEP) {
      try { game.preStep(); } catch (e) { if (!sim.noteError(e)) log(`Erreur du jeu (preStep, ignorée) : ${e}`); }
      try {
        sim.step();
      } catch (e) {
        if (!sim.noteError(e)) log(`Erreur de simulation (ignorée) : ${e}`);
      }
      if (!sim.broken) { try { game.postStep(); } catch (e) { if (!sim.noteError(e)) log(`Erreur du jeu (postStep, ignorée) : ${e}`); } }
      if (!sim.broken) routeOutbox(game.drainOutbox());
      if (sim.broken) { acc = 0; void rebuild(); return; }
      acc -= STEP;
      if (now >= nextGoodAt) {
        nextGoodAt = now + GOOD_STATE_EVERY_MS;
        try { lastGood = sim.serialize(); lastGameState = game.serialize(); } catch (e) { if (!sim.noteError(e)) log(`Instantané ignoré : ${e}`); }
        if (sim.broken) { acc = 0; void rebuild(); return; }
      }
      if (ticks % 6 === 0 && !sim.broken) sendMe();
      if (++ticks % snapEvery === 0) {
        if (sockets.size === 0) {
          sim.clearFx();
          if (!idle) { sim.resetDelta(); idle = true; }
        } else {
          idle = false;
          try {
            const d = sim.snapshotDelta();
            if (!d.fx.length) delete (d as Partial<typeof d>).fx; // fx vide : non sérialisé
            const peds = game.pedsFlat();
            if (peds.length) d.peds = peds;
            const delta = JSON.stringify({ type: 'snap', s: d } satisfies ServerMsg);
            let full: string | null = null;
            for (const ws of sockets.keys()) {
              if (ws.readyState !== ws.OPEN) continue;
              try {
                if (needFull.has(ws)) {
                  needFull.delete(ws);
                  full ??= JSON.stringify({ type: 'snap', s: { ...sim.snapshotFull(), fx: d.fx ?? [], ...(peds.length ? { peds } : {}) } } satisfies ServerMsg);
                  ws.send(full);
                } else ws.send(delta);
              } catch (e) {
                if (sim.noteError(e)) throw e;
              }
            }
          } catch (e) {
            if (!sim.noteError(e)) log(`Erreur de snapshot (ignorée) : ${e}`);
            if (sim.broken) { acc = 0; void rebuild(); return; }
          }
        }
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
    clearInterval(heartbeat);
    sim.dispose();
    throw e;
  });
  server.on('error', (e) => log(`Erreur du serveur HTTP (ignorée) : ${e}`));
  log(`Serveur ${mode} prêt sur le port ${actualPort}`);

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(loop);
    clearInterval(saveTimer);
    clearInterval(heartbeat);
    save();
    for (const ws of [...wss.clients]) { try { ws.close(); } catch { /* déjà fermé */ } }
    try { wss.close(); } catch { /* déjà fermé */ }
    try { server.closeAllConnections(); } catch { /* déjà fermé */ }
    await new Promise<void>((r) => server.close(() => r()));
    sim.dispose(); // libère la mémoire WASM de la simulation (après la sauvegarde et la fermeture des sockets)
  }

  return { port: actualPort, info, stop, sim: () => sim };
}
