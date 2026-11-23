import { defineConfig } from 'vite';

// Le client compilé est servi par le serveur du jeu (dist/public). En développement,
// Vite sert le client et relaie la WebSocket vers le serveur local.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist/public', emptyOutDir: true },
  server: { host: true, port: 5173, strictPort: true, proxy: { '/ws': { target: `ws://localhost:${process.env.SERVER_PORT ?? 3000}`, ws: true } } },
});
