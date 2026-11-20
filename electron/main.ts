// Application de bureau : menu (solo / héberger / rejoindre) + serveur intégré + fenêtre de jeu.
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron';
import { startServer, type RunningServer } from '../server/server';
import { announceGame, listenForGames } from './discovery';
import { setupUpdater, type Updater } from './updater';

let updater: Updater | null = null;

let win: BrowserWindow | null = null;
let running: RunningServer | null = null;
let stopAnnounce: (() => void) | null = null;
let stopListen: (() => void) | null = null;

const menuFile = path.join(__dirname, 'menu.html');
const publicDir = path.join(app.getAppPath(), 'dist', 'public');
const saveDir = path.join(app.getPath('userData'), 'saves'); // ex : %APPDATA%/Jeu 3D/saves

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 800, minHeight: 500, backgroundColor: '#9fd3ff', title: 'Jeu 3D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  // Windows : pas de barre de menus. macOS : menu minimal indispensable (Cmd+Q, Cmd+C/V dans le pseudo, plein écran Ctrl+Cmd+F).
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null,
  );
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // F11 : plein écran
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win?.setFullScreen(!win.isFullScreen());
  });
  win.on('closed', () => { win = null; });
  showMenu();
  updater = setupUpdater((s) => {
    if (win && !win.isDestroyed()) win.webContents.send('launcher:update', s);
  });
}

function showMenu(error?: string) {
  void win?.loadFile(menuFile, error ? { query: { error } } : undefined);
}

async function stopEverything() {
  stopAnnounce?.(); stopAnnounce = null;
  stopListen?.(); stopListen = null;
  const s = running;
  running = null;
  if (s) await s.stop(); // sauvegarde la partie avant d'arrêter
}

// Seule la page du menu (fichier local) peut piloter l'application ; une page distante (hôte d'un ami) ne le peut pas.
const fromMenu = (e: IpcMainInvokeEvent) => e.senderFrame?.url.startsWith('file:') === true;

ipcMain.handle('launcher:solo', async (e, name: string) => {
  if (!fromMenu(e)) return;
  await stopEverything();
  try {
    running = await startServer({ mode: 'solo', saveDir, publicDir, hostName: name, log: console.log });
    await win?.loadURL(`http://localhost:${running.port}/?name=${encodeURIComponent(name)}`);
  } catch (err) {
    await stopEverything();
    showMenu(`Impossible de démarrer la partie : ${(err as Error).message}`);
  }
});

ipcMain.handle('launcher:host', async (e, name: string) => {
  if (!fromMenu(e)) return;
  await stopEverything();
  try {
    const server = (running = await startServer({ mode: 'multi', saveDir, publicDir, hostName: `Partie de ${name || 'un ami'}`, log: console.log }));
    stopAnnounce = announceGame(() => {
      const i = server.info();
      return { name: i.name, port: i.port, players: i.players };
    });
    await win?.loadURL(`http://localhost:${server.port}/?name=${encodeURIComponent(name)}`);
  } catch (err) {
    await stopEverything();
    showMenu(`Impossible d'héberger : ${(err as Error).message}`);
  }
});

ipcMain.handle('launcher:join', async (e, address: string, name: string) => {
  if (!fromMenu(e)) return { ok: false, error: 'Non autorisé.' };
  // Accepte « 192.168.0.12 », « 192.168.0.12:3000 » ou une adresse http://...
  const m = /^(?:https?:\/\/)?([\w.-]+)(?::(\d{1,5}))?\/?$/.exec(address.trim());
  if (!m) return { ok: false, error: "Adresse invalide. Exemple : 192.168.0.12" };
  const url = `http://${m[1]}:${m[2] ?? 3000}`;
  try {
    const res = await fetch(`${url}/info`, { signal: AbortSignal.timeout(4000) });
    const info = (await res.json()) as { game?: string };
    if (info.game !== 'jeu3d') throw new Error('not a game');
  } catch {
    return { ok: false, error: "Partie introuvable. Vérifie l'adresse, que vous êtes sur le même Wi-Fi, et que l'hôte a autorisé le jeu dans le pare-feu." };
  }
  stopListen?.(); stopListen = null;
  await win?.loadURL(`${url}/?name=${encodeURIComponent(name)}`);
  return { ok: true };
});

ipcMain.handle('launcher:discover', (e, enable: boolean) => {
  if (!fromMenu(e)) return;
  stopListen?.(); stopListen = null;
  if (enable)
    stopListen = listenForGames((games) => {
      if (!win?.isDestroyed()) win?.webContents.send('launcher:games', games);
    });
});

// Retour au menu (accessible aussi depuis la page de jeu) : arrête le serveur local, sauvegarde.
ipcMain.handle('launcher:back', async (_e, error?: unknown) => {
  await stopEverything();
  showMenu(typeof error === 'string' ? error.slice(0, 200) : undefined);
});
ipcMain.handle('launcher:update-state', (e) =>
  fromMenu(e) ? { ...(updater?.state() ?? { status: 'idle' }), current: app.getVersion() } : { status: 'idle' });
ipcMain.handle('launcher:install-update', (e) => {
  if (fromMenu(e)) updater?.install();
});
ipcMain.handle('launcher:quit', (e) => {
  if (fromMenu(e)) app.quit();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('before-quit', (e) => {
  if (!running) return;
  e.preventDefault();
  void stopEverything().then(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
void app.whenReady().then(createWindow);
