// Lancement en ligne de commande (développement) :
//   npm run dev:server           -> serveur multi ; le client est servi par Vite (npm run dev)
//   node dist/server.mjs --solo  -> solo
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, lanAddresses } from './server';

// Filet de sécurité : une exception oubliée ne doit jamais arrêter la partie des copains (on journalise et on continue).
process.on('uncaughtException', (e) => console.error('[uncaughtException ignorée]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection ignorée]', e));

const solo = process.argv.includes('--solo');
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({
  mode: solo ? 'solo' : 'multi',
  port: Number(process.env.PORT) || undefined,
  saveDir: path.resolve(process.env.SAVE_DIR ?? 'saves'),
  publicDir: path.join(here, 'public'),
  hostName: process.env.HOST_NAME,
  log: console.log,
  onFatal: () => process.exit(1), // le serveur s'est arrêté seul (la partie a été sauvegardée)
});
const dev = !!process.env.npm_lifecycle_event?.startsWith('dev');
const clientPort = dev ? 5173 : server.port; // en dev, le client est servi par Vite (5173)
console.log(`Jeu : http://localhost:${clientPort}`);
if (!solo) for (const ip of lanAddresses()) console.log(`Amis (même Wi-Fi) : http://${ip}:${clientPort}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await server.stop();
    process.exit(0);
  });
