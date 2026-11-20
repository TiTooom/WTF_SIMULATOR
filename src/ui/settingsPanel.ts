// Panneau d'options (touches, souris, son). Utilisé par le menu principal de l'application ET par le jeu.
import { ACTIONS, RESERVED_CODES, defaultSettings, type ActionId, type Settings } from '../../shared/settings';

const NAMES: Record<string, string> = {
  Space: 'Espace', Enter: 'Entrée', Tab: 'Tab', Backspace: 'Retour', CapsLock: 'Verr. Maj',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
  AltLeft: 'Alt gauche', AltRight: 'Alt droit', Delete: 'Suppr', Insert: 'Inser', Home: 'Début', End: 'Fin',
  PageUp: 'Page ↑', PageDown: 'Page ↓', Backquote: '²', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
};

type Layout = { get(code: string): string | undefined } | null;

/** Disposition réelle du clavier (AZERTY, QWERTY…), pour afficher « Z » là où le code physique est KeyW. */
export async function getLayout(): Promise<Layout> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Layout> } }).keyboard;
    return (await kb?.getLayoutMap?.()) ?? null;
  } catch {
    return null;
  }
}

export function keyLabel(code: string, layout: Layout): string {
  if (!code) return '—';
  if (NAMES[code] && !(layout?.get(code) && /^(Backquote|Minus|Equal|Comma|Period|Slash)$/.test(code))) return NAMES[code];
  const k = layout?.get(code);
  if (k) return k.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
  return code;
}

const CSS = `
.sp-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(20,40,70,.7);font-family:"Segoe UI",sans-serif}
.sp-card{background:#fff;color:#2c3e50;border-radius:16px;width:560px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;padding:22px 26px 18px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.sp-body{flex:1;min-height:0;overflow-y:auto;padding-right:8px;margin-right:-8px}
.sp-card h2{margin:0 0 4px;font-size:24px}
.sp-card h3{margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#7f8c9a}
.sp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;font-size:15px}
.sp-row>span:first-child{flex:1}
.sp-key{flex:none;width:170px;padding:7px 10px;font-size:14px;font-weight:700;border:2px solid #cfd8e3;border-radius:8px;background:#f4f8fb;color:#2c3e50;cursor:pointer}
.sp-key:hover{border-color:#3498db}.sp-key.sp-wait{border-color:#e67e22;background:#fff4e5;color:#b9630c}
.sp-range{width:240px}
.sp-val{width:44px;text-align:right;color:#7f8c9a;font-size:14px}
.sp-note{min-height:18px;font-size:13px;color:#c0392b;margin-top:6px}
.sp-actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.sp-actions button{flex:1;padding:11px;font-size:15px;font-weight:700;border:0;border-radius:9px;cursor:pointer;color:#fff;background:#3498db}
.sp-actions button.sp-reset{background:#95a5a6;font-size:13px}
`;

export interface PanelOptions {
  load: () => Promise<Settings>;
  save: (s: Settings) => Promise<void>;
  onChange?: (s: Settings) => void; // appliqué en direct pendant qu'on règle
  onClose?: () => void;
}

export async function openSettings(opts: PanelOptions): Promise<void> {
  if (!document.getElementById('sp-style')) {
    const st = document.createElement('style');
    st.id = 'sp-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const [initial, layout] = await Promise.all([opts.load(), getLayout()]);
  let s: Settings = { ...initial, keys: { ...initial.keys } };
  let waiting: { id: ActionId; btn: HTMLButtonElement } | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'sp-overlay';
  const card = document.createElement('div');
  card.className = 'sp-card';
  overlay.appendChild(card);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const note = el('div', 'sp-note');
  const changed = () => {
    opts.onChange?.(s);
    void opts.save(s);
  };

  card.appendChild(el('h2', undefined, 'Options'));
  const body = el('div', 'sp-body');
  card.appendChild(body);

  // ---- Touches ----
  const keyButtons = new Map<ActionId, HTMLButtonElement>();
  const refreshKeys = () => {
    for (const [id, b] of keyButtons) b.textContent = keyLabel(s.keys[id], layout);
  };
  const TITLES: Record<string, string> = { 'À pied': 'Déplacement à pied', Véhicules: 'Véhicules', Pilotage: 'Pilotage (avions, hélicoptère…)', Inventaire: 'Inventaire et barre d’objets', Général: 'Général', Pelleteuse: 'Pelleteuse' };
  for (const group of ['À pied', 'Véhicules', 'Pilotage', 'Inventaire', 'Général', 'Pelleteuse'] as const) {
    body.appendChild(el('h3', undefined, TITLES[group]));
    for (const a of ACTIONS.filter((x) => x.group === group)) {
      const row = el('div', 'sp-row');
      row.appendChild(el('span', undefined, a.label));
      const b = el('button', 'sp-key');
      b.type = 'button';
      b.addEventListener('click', () => {
        if (waiting) waiting.btn.classList.remove('sp-wait');
        waiting = { id: a.id, btn: b };
        b.classList.add('sp-wait');
        b.textContent = 'Appuie sur une touche…';
        note.textContent = 'Échap pour annuler.';
      });
      keyButtons.set(a.id, b);
      row.appendChild(b);
      body.appendChild(row);
    }
  }

  // ---- Curseurs ----
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
    const row = el('div', 'sp-row');
    row.appendChild(el('span', undefined, label));
    const wrap = el('span');
    const input = el('input', 'sp-range');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const val = el('span', 'sp-val', fmt(get()));
    input.addEventListener('input', () => {
      set(Number(input.value));
      val.textContent = fmt(get());
      changed();
    });
    wrap.append(input, val);
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    row.appendChild(wrap);
    body.appendChild(row);
    return input;
  };
  body.appendChild(el('h3', undefined, 'Souris'));
  slider('Sensibilité', 0.2, 3, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v), (v) => v.toFixed(2) + '×');
  body.appendChild(el('h3', undefined, 'Son'));
  slider('Volume général', 0, 1, 0.05, () => s.master, (v) => (s.master = v), (v) => Math.round(v * 100) + '%');
  slider('Effets (moteurs, pas…)', 0, 1, 0.05, () => s.effects, (v) => (s.effects = v), (v) => Math.round(v * 100) + '%');

  card.appendChild(note);
  const actions = el('div', 'sp-actions');
  const reset = el('button', 'sp-reset', 'Touches par défaut');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    s = { ...s, keys: { ...defaultSettings().keys } };
    note.textContent = '';
    refreshKeys();
    changed();
  });
  const resetBar = el('button', 'sp-reset', 'Barre d’objets par défaut');
  resetBar.type = 'button';
  resetBar.addEventListener('click', () => {
    s = { ...s, hotbar: [] }; // tableau vide = barre par défaut du jeu
    note.textContent = 'Barre d’objets remise par défaut.';
    changed();
  });
  const close = el('button', undefined, 'Fermer');
  close.type = 'button';
  actions.append(reset, resetBar, close);
  card.appendChild(actions);
  refreshKeys();

  // ---- Capture de la touche à assigner ----
  const onKey = (e: KeyboardEvent) => {
    if (!waiting) {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const { id, btn } = waiting;
    waiting = null;
    btn.classList.remove('sp-wait');
    if (e.code === 'Escape') {
      note.textContent = '';
    } else if (RESERVED_CODES.includes(e.code)) {
      note.textContent = 'Cette touche est réservée.';
    } else {
      // Une touche = une action : si elle servait déjà, les deux actions échangent leurs touches
      const other = ACTIONS.find((a) => a.id !== id && s.keys[a.id] === e.code);
      if (other) {
        s.keys[other.id] = s.keys[id];
        note.textContent = `« ${other.label} » a pris l'ancienne touche (échange).`;
      } else {
        note.textContent = '';
      }
      s.keys[id] = e.code;
      changed();
    }
    refreshKeys();
  };
  window.addEventListener('keydown', onKey, true);

  const finish = () => {
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    opts.onClose?.();
  };
  close.addEventListener('click', finish);
  document.body.appendChild(overlay);
}
