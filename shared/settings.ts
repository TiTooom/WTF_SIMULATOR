// Réglages du joueur (touches, sensibilité, volumes) : définition, valeurs par défaut et validation.
// Utilisé par l'application (stockage), le menu et le jeu. La validation est stricte car un hôte distant
// peut demander de sauvegarder des réglages : seuls des codes de touches et des nombres bornés sont acceptés.

export interface ActionDef {
  id: string;
  label: string;
  group: 'À pied' | 'Véhicules' | 'Pilotage' | 'Inventaire' | 'Pelleteuse' | 'Général';
  default: string; // event.code (position physique de la touche : fonctionne en AZERTY comme en QWERTY)
}

export const ACTIONS = [
  { id: 'forward', label: 'Avancer', group: 'À pied', default: 'KeyW' },
  { id: 'back', label: 'Reculer', group: 'À pied', default: 'KeyS' },
  { id: 'left', label: 'Gauche', group: 'À pied', default: 'KeyA' },
  { id: 'right', label: 'Droite', group: 'À pied', default: 'KeyD' },
  { id: 'jump', label: 'Sauter', group: 'À pied', default: 'Space' },
  { id: 'interact', label: 'Monter / descendre', group: 'Général', default: 'KeyE' },
  { id: 'chat', label: 'Ouvrir le chat', group: 'Général', default: 'Enter' },
  { id: 'throttleUp', label: 'Gaz / monter', group: 'Pilotage', default: 'ShiftLeft' },
  { id: 'throttleDown', label: 'Freiner / descendre', group: 'Pilotage', default: 'ControlLeft' },
  { id: 'yawLeft', label: 'Lacet à gauche', group: 'Pilotage', default: 'KeyZ' },
  { id: 'yawRight', label: 'Lacet à droite', group: 'Pilotage', default: 'KeyC' },
  { id: 'horn', label: 'Klaxon / action spéciale', group: 'Véhicules', default: 'KeyH' },
  { id: 'inventory', label: "Ouvrir l'inventaire", group: 'Inventaire', default: 'Tab' },
  { id: 'slot1', label: 'Emplacement 1', group: 'Inventaire', default: 'Digit1' },
  { id: 'slot2', label: 'Emplacement 2', group: 'Inventaire', default: 'Digit2' },
  { id: 'slot3', label: 'Emplacement 3', group: 'Inventaire', default: 'Digit3' },
  { id: 'slot4', label: 'Emplacement 4', group: 'Inventaire', default: 'Digit4' },
  { id: 'slot5', label: 'Emplacement 5', group: 'Inventaire', default: 'Digit5' },
  { id: 'slot6', label: 'Emplacement 6', group: 'Inventaire', default: 'Digit6' },
  { id: 'slot7', label: 'Emplacement 7', group: 'Inventaire', default: 'Digit7' },
  { id: 'slot8', label: 'Emplacement 8', group: 'Inventaire', default: 'Digit8' },
  { id: 'slot9', label: 'Emplacement 9', group: 'Inventaire', default: 'Digit9' },
  { id: 'swingLeft', label: 'Pivoter la cabine à gauche', group: 'Pelleteuse', default: 'ArrowLeft' },
  { id: 'swingRight', label: 'Pivoter la cabine à droite', group: 'Pelleteuse', default: 'ArrowRight' },
  { id: 'boomUp', label: 'Lever la flèche', group: 'Pelleteuse', default: 'ArrowUp' },
  { id: 'boomDown', label: 'Baisser la flèche', group: 'Pelleteuse', default: 'ArrowDown' },
  { id: 'stickOut', label: 'Sortir le bras', group: 'Pelleteuse', default: 'KeyR' },
  { id: 'stickIn', label: 'Rentrer le bras', group: 'Pelleteuse', default: 'KeyF' },
  { id: 'bucketCurl', label: 'Godet : ramasser', group: 'Pelleteuse', default: 'KeyT' },
  { id: 'bucketDump', label: 'Godet : vider', group: 'Pelleteuse', default: 'KeyG' },
] as const satisfies readonly ActionDef[];

export type ActionId = (typeof ACTIONS)[number]['id'];

export interface Settings {
  keys: Record<ActionId, string>;
  sensitivity: number; // 0.2 à 3 (1 = normal)
  master: number; // 0 à 1
  effects: number; // 0 à 1
  /** Barre d'objets (9 emplacements, identifiants d'objets, '' = vide). Tableau vide = barre par défaut du jeu. */
  hotbar: string[];
}

/** Touches qu'on ne peut pas assigner : Échap ouvre la pause. */
export const RESERVED_CODES = ['Escape'];

export function defaultSettings(): Settings {
  const keys = {} as Record<ActionId, string>;
  for (const a of ACTIONS) keys[a.id] = a.default;
  return { keys, sensitivity: 1, master: 0.7, effects: 1, hotbar: [] };
}

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Valide des réglages venant du disque ou d'une page : complète avec les valeurs par défaut, rejette le reste. */
export function sanitizeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
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
  if (Array.isArray(r.hotbar) && r.hotbar.length === 9 && r.hotbar.every((h) => typeof h === 'string' && /^[a-z0-9_]{0,32}$/.test(h))) out.hotbar = [...(r.hotbar as string[])];
  return out;
}
