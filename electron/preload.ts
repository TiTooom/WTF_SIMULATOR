// Pont sécurisé entre les pages et l'application.
// Le menu local reçoit toute l'API ; une page de jeu distante (hôte d'un ami) reçoit seulement « retour au menu ».
import { contextBridge, ipcRenderer } from 'electron';

// Réglages : disponibles partout (le main process valide tout ce qu'il reçoit)
const settingsApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),
};

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('launcher', {
    ...settingsApi,
    solo: (name: string) => ipcRenderer.invoke('launcher:solo', name),
    host: (name: string) => ipcRenderer.invoke('launcher:host', name),
    join: (address: string, name: string) => ipcRenderer.invoke('launcher:join', address, name),
    discover: (enable: boolean) => ipcRenderer.invoke('launcher:discover', enable),
    onGames: (cb: (games: unknown[]) => void) => {
      ipcRenderer.removeAllListeners('launcher:games');
      ipcRenderer.on('launcher:games', (_e, games) => cb(games));
    },
    getUpdate: () => ipcRenderer.invoke('launcher:update-state'),
    onUpdate: (cb: (state: unknown) => void) => {
      ipcRenderer.removeAllListeners('launcher:update');
      ipcRenderer.on('launcher:update', (_e, state) => cb(state));
    },
    installUpdate: () => ipcRenderer.invoke('launcher:install-update'),
    quit: () => ipcRenderer.invoke('launcher:quit'),
  });
} else {
  contextBridge.exposeInMainWorld('launcher', {
    ...settingsApi,
    backToMenu: (error?: string) => ipcRenderer.invoke('launcher:back', error),
  });
}
