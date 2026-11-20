// Menu principal de l'application (page locale). Compilé en electron/menu.js par esbuild.
import { sanitizeSettings, type Settings } from '../shared/settings';
import { openSettings } from '../src/ui/settingsPanel';

interface FoundGame { host: string; port: number; name: string; players: number }
interface UpdateState { status: 'idle' | 'downloading' | 'ready'; version?: string; percent?: number; current?: string }
interface Launcher {
  solo(name: string): Promise<void>;
  host(name: string): Promise<void>;
  join(address: string, name: string): Promise<{ ok: boolean; error?: string } | undefined>;
  discover(enable: boolean): Promise<void>;
  onGames(cb: (games: FoundGame[]) => void): void;
  getUpdate(): Promise<UpdateState>;
  onUpdate(cb: (s: UpdateState) => void): void;
  installUpdate(): Promise<void>;
  getSettings(): Promise<unknown>;
  saveSettings(s: Settings): Promise<void>;
  quit(): Promise<void>;
}

const api = (window as unknown as { launcher: Launcher }).launcher;
const $ = (id: string) => document.getElementById(id)!;
const nameInput = $('name') as HTMLInputElement;
const status = $('status');
const params = new URLSearchParams(location.search);
if (params.get('error')) status.textContent = params.get('error');

try { nameInput.value = localStorage.getItem('name') || ''; } catch { /* ignoré */ }
const name = () => {
  const n = nameInput.value.trim();
  try { localStorage.setItem('name', n); } catch { /* ignoré */ }
  return n || 'Joueur';
};
const busy = (b: boolean) => document.querySelectorAll('button').forEach((x) => (x.disabled = b));

$('solo').onclick = () => { busy(true); status.textContent = 'Démarrage…'; void api.solo(name()); };
$('host').onclick = () => { busy(true); status.textContent = 'Démarrage du serveur…'; void api.host(name()); };
$('quit').onclick = () => void api.quit();
$('options').onclick = () => void openSettings({
  load: async () => sanitizeSettings(await api.getSettings()),
  save: (s) => api.saveSettings(s),
});

async function join(address: string) {
  busy(true);
  status.textContent = 'Connexion…';
  const r = await api.join(address, name());
  if (r && !r.ok) {
    status.textContent = r.error ?? 'Connexion impossible.';
    busy(false);
  }
}
$('join').onclick = () => {
  const a = ($('addr') as HTMLInputElement).value.trim();
  if (a) void join(a);
  else status.textContent = "Saisis l'adresse de l'hôte ou clique sur une partie détectée.";
};
$('addr').onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') $('join').click(); };

function renderGames(games: FoundGame[]) {
  const box = $('games');
  box.textContent = '';
  if (!games.length) {
    const d = document.createElement('div');
    d.className = 'none';
    d.textContent = 'Aucune partie détectée. Demande à ton ami de cliquer sur « Héberger ».';
    box.appendChild(d);
    return;
  }
  for (const g of games) {
    const b = document.createElement('button');
    b.className = 'game';
    const t = document.createElement('span');
    t.textContent = g.name;
    const s = document.createElement('small');
    s.textContent = `${g.players} joueur${g.players > 1 ? 's' : ''}`;
    b.append(t, s);
    b.onclick = () => void join(`${g.host}:${g.port}`);
    box.appendChild(b);
  }
}
api.onGames(renderGames);
void api.discover(true);

// Mise à jour automatique : téléchargement en arrière-plan, puis proposition de redémarrer
function renderUpdate(s: UpdateState) {
  if (s.current) $('version').textContent = 'v' + s.current;
  $('update').style.display = s.status === 'idle' ? 'none' : 'block';
  $('updateBar').style.display = s.status === 'downloading' ? 'block' : 'none';
  $('updateBtn').style.display = s.status === 'ready' ? 'block' : 'none';
  if (s.status === 'downloading') {
    $('updateText').textContent = `Nouvelle version ${s.version} : téléchargement… ${s.percent || 0} %`;
    ($('updateBar').firstElementChild as HTMLElement).style.width = `${s.percent || 0}%`;
  } else if (s.status === 'ready') {
    $('updateText').textContent = `La version ${s.version} est prête.`;
  }
}
$('updateBtn').onclick = () => { busy(true); status.textContent = 'Mise à jour…'; void api.installUpdate(); };
api.onUpdate((s) => renderUpdate({ ...s, current: undefined }));
void api.getUpdate().then(renderUpdate);
