// Mise à jour automatique : vérifie les Releases GitHub, télécharge en arrière-plan, propose de redémarrer.
// Actif seulement dans l'application installée sous Windows (sur macOS l'app n'est pas signée par Apple :
// la mise à jour automatique y est impossible, on retélécharge le .dmg).
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface UpdateState {
  status: 'idle' | 'downloading' | 'ready';
  version?: string;
  percent?: number;
}

export interface Updater {
  state(): UpdateState;
  install(): void;
}

export function setupUpdater(onChange: (s: UpdateState) => void): Updater {
  let state: UpdateState = { status: 'idle' };
  const set = (s: UpdateState) => {
    state = s;
    onChange(s);
  };
  const enabled = app.isPackaged && process.platform === 'win32';

  if (enabled) {
    try {
      autoUpdater.logger = console;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true; // sinon, installée à la fermeture du jeu
      autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, percent: 0 }));
      autoUpdater.on('download-progress', (p) => set({ ...state, status: 'downloading', percent: Math.round(p.percent) }));
      autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version }));
      autoUpdater.on('error', (e) => console.log('Mise à jour impossible :', e?.message ?? e)); // silencieux pour le joueur
      const check = () => {
        if (state.status !== 'ready') autoUpdater.checkForUpdates().catch(() => {});
      };
      setTimeout(check, 3000);
      setInterval(check, 30 * 60 * 1000);
    } catch (e) {
      console.log('Mise à jour désactivée :', e); // un souci de mise à jour ne doit jamais empêcher de jouer
    }
  }

  return {
    state: () => state,
    install: () => {
      if (enabled) autoUpdater.quitAndInstall(true, true); // installe sans fenêtre et relance le jeu
    },
  };
}
