// Réglages du joueur (touches, sensibilité, volumes) : définition, valeurs par défaut et validation.
// Utilisé par l'application (stockage), le menu et le jeu. La validation est stricte car un hôte distant
// peut demander de sauvegarder des réglages : seuls des codes de touches et des nombres bornés sont acceptés.

export interface ActionDef {
  id: string;
  label: string;
  group: 'À pied' | 'Véhicules' | 'Général';
  default: string; // event.code (position physique de la touche : fonctionne en AZERTY comme en QWERTY)
}

export const ACTIONS = [
  { id: 'forward', label: 'Avancer', group: 'À pied', default: 'KeyW' },
  { id: 'back', label: 'Reculer', group: 'À pied', default: 'KeyS' },
  { id: 'left', label: 'Gauche', group: 'À pied', default: 'KeyA' },
  { id: 'right', label: 'Droite', group: 'À pied', default: 'KeyD' },
  { id: 'jump', label: 'Roulade / frein à main', group: 'À pied', default: 'Space' },
  { id: 'sprint', label: 'Courir', group: 'À pied', default: 'ShiftLeft' },
  { id: 'horn', label: 'Klaxon / sirène', group: 'Véhicules', default: 'KeyH' },
  { id: 'interact', label: 'Monter / descendre', group: 'Général', default: 'KeyE' },
  { id: 'activity', label: 'Activité (taxi, justicier…)', group: 'Général', default: 'KeyQ' },
  { id: 'pda', label: 'Ouvrir le PDA', group: 'Général', default: 'Tab' },
  { id: 'chat', label: 'Ouvrir le chat', group: 'Général', default: 'Enter' },
] as const satisfies readonly ActionDef[];

export type ActionId = (typeof ACTIONS)[number]['id'];

export interface Settings {
  keys: Record<ActionId, string>;
  sensitivity: number; // 0.2 à 3 (1 = normal)
  master: number; // 0 à 1
  effects: number; // 0 à 1
}

/** Touches qu'on ne peut pas assigner : Échap ouvre la pause. */
export const RESERVED_CODES = ['Escape'];

export function defaultSettings(): Settings {
  const keys = {} as Record<ActionId, string>;
  for (const a of ACTIONS) keys[a.id] = a.default;
  return { keys, sensitivity: 1, master: 0.7, effects: 1 };
}

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Valide des réglages venant du disque ou d'une page : complète avec les valeurs par défaut, rejette le reste. */
export function sanitizeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  // Les actions inconnues (anciens settings.json : inventaire, pelleteuse…) sont ignorées : seules celles de ACTIONS sont lues.
  const keys = r.keys && typeof r.keys === 'object' ? (r.keys as Record<string, unknown>) : {};
  // Une touche = une action ('' = non assignée). 1) valeurs valides fournies, 2) défauts seulement si la touche est libre.
  const used = new Set<string>();
  const assigned = new Set<string>();
  for (const a of ACTIONS) {
    const v = keys[a.id];
    if (typeof v !== 'string') continue;
    if (v === '' || (CODE_RE.test(v) && !RESERVED_CODES.includes(v) && !used.has(v))) {
      out.keys[a.id] = v;
      assigned.add(a.id);
      if (v) used.add(v);
    }
  }
  for (const a of ACTIONS) {
    if (assigned.has(a.id)) continue;
    out.keys[a.id] = used.has(a.default) ? '' : a.default;
    if (out.keys[a.id]) used.add(a.default);
  }
  out.sensitivity = num(r.sensitivity, 0.2, 3, 1);
  out.master = num(r.master, 0, 1, 0.7);
  out.effects = num(r.effects, 0, 1, 1);
  return out;
}
