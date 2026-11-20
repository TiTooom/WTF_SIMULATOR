// Lancement en ligne de commande (développement) :
//   npm run dev:server           -> serveur multi ; le client est servi par Vite (npm run dev)
//   node dist/server.mjs --solo  -> solo
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, lanAddresses } from './server';

const solo = process.argv.includes('--solo');
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await startServer({
  mode: solo ? 'solo' : 'multi',
  port: Number(process.env.PORT) || undefined,
  saveDir: path.resolve(process.env.SAVE_DIR ?? 'saves'),
  publicDir: path.join(here, 'public'),
  hostName: process.env.HOST_NAME,
  log: console.log,
});
console.log(`Jeu : http://localhost:${server.port}`);
if (!solo) for (const ip of lanAddresses()) console.log(`Amis (même Wi-Fi) : http://${ip}:${server.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await server.stop();
    process.exit(0);
  });
