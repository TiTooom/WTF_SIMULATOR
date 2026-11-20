// Pont sécurisé entre les pages et l'application.
// Le menu local reçoit toute l'API ; une page de jeu distante (hôte d'un ami) reçoit seulement « retour au menu ».
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('launcher', {
    solo: (name: string) => ipcRenderer.invoke('launcher:solo', name),
    host: (name: string) => ipcRenderer.invoke('launcher:host', name),
    join: (address: string, name: string) => ipcRenderer.invoke('launcher:join', address, name),
    discover: (enable: boolean) => ipcRenderer.invoke('launcher:discover', enable),
    onGames: (cb: (games: unknown[]) => void) => {
      ipcRenderer.removeAllListeners('launcher:games');
      ipcRenderer.on('launcher:games', (_e, games) => cb(games));
    },
    quit: () => ipcRenderer.invoke('launcher:quit'),
  });
} else {
  contextBridge.exposeInMainWorld('launcher', {
    backToMenu: (error?: string) => ipcRenderer.invoke('launcher:back', error),
  });
}
