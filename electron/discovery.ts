// Détection automatique des parties sur le réseau local (diffusion UDP) :
// l'hôte annonce sa partie toutes les 1,5 s, les joueurs qui ouvrent « Rejoindre » écoutent.
import dgram from 'node:dgram';
import os from 'node:os';

const DISCOVERY_PORT = 41234;
const MAGIC = 'jeu3d-v1';

export interface FoundGame { host: string; port: number; name: string; players: number }

/** Adresses de diffusion de chaque carte réseau (ex : 192.168.0.255). */
function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list ?? []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      const ip = n.address.split('.').map(Number);
      const mask = n.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'));
    }
  return [...out];
}

/** Annonce la partie tant que la fonction retournée n'est pas appelée. */
export function announceGame(getInfo: () => { name: string; port: number; players: number }): () => void {
  const sock = dgram.createSocket('udp4');
  sock.on('error', () => {});
  let timer: NodeJS.Timeout | null = null;
  sock.bind(0, () => {
    sock.setBroadcast(true);
    const beat = () => {
      const msg = Buffer.from(JSON.stringify({ magic: MAGIC, ...getInfo() }));
      for (const addr of broadcastAddresses()) sock.send(msg, DISCOVERY_PORT, addr, () => {});
    };
    beat();
    timer = setInterval(beat, 1500);
  });
  return () => {
    if (timer) clearInterval(timer);
    try { sock.close(); } catch { /* déjà fermé */ }
  };
}

/** Écoute les annonces ; appelle onChange avec la liste à jour. */
export function listenForGames(onChange: (games: FoundGame[]) => void): () => void {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Map<string, FoundGame & { at: number }>();
  const emit = () => onChange([...seen.values()].map(({ at: _at, ...g }) => g));
  sock.on('error', () => {});
  sock.on('message', (buf, rinfo) => {
    try {
      const m = JSON.parse(buf.toString());
      if (m.magic !== MAGIC || typeof m.port !== 'number') return;
      const key = `${rinfo.address}:${m.port}`;
      const game = { host: rinfo.address, port: m.port, name: String(m.name ?? 'Partie').slice(0, 32), players: Number(m.players) || 0, at: Date.now() };
      const prev = seen.get(key);
      seen.set(key, game);
      if (!prev || prev.players !== game.players || prev.name !== game.name) emit();
    } catch { /* paquet étranger : ignoré */ }
  });
  const purge = setInterval(() => {
    let changed = false;
    for (const [k, g] of seen) if (Date.now() - g.at > 5000) { seen.delete(k); changed = true; }
    if (changed) emit();
  }, 2000);
  sock.bind(DISCOVERY_PORT);
  return () => {
    clearInterval(purge);
    try { sock.close(); } catch { /* déjà fermé */ }
  };
}
