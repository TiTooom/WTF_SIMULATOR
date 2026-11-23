import { sanitizeSettings, type Settings } from '../shared/settings';

/** API exposée par l'application (preload) ; absente quand on joue depuis un navigateur. */
interface Launcher {
  getSettings?: () => Promise<unknown>;
  saveSettings?: (s: Settings) => Promise<unknown>;
  backToMenu?: (error?: string) => Promise<void>;
}
export const launcher = (): Launcher | undefined => (window as unknown as { launcher?: Launcher }).launcher;

const STORAGE_KEY = 'gta-unilasalle-settings';

/** Application : réglages enregistrés dans le dossier de l'app (valables pour toutes les parties).
 *  Navigateur : stockés dans ce navigateur, pour ce serveur. */
export async function loadSettings(): Promise<Settings> {
  try {
    const l = launcher();
    if (l?.getSettings) return sanitizeSettings(await l.getSettings());
    return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return sanitizeSettings(null);
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    const l = launcher();
    if (l?.saveSettings) await l.saveSettings(s);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* stockage indisponible : les réglages ne durent que le temps de la session */ }
}
