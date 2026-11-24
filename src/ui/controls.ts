// Aide des commandes (PROPRIÉTAIRE : art-toon) : carte des touches RÉELLEMENT assignées (lues via `keyLabel`, jamais codées en dur),
// ouverte par F1 ou par le petit bouton « ? ». Panneau non bloquant (le jeu continue) ; fermeture : F1, Échap ou clic sur « Fermer ».
// Tout texte passe par `textContent`.
//
// API pour main.ts :
//   const controls = createControls({ keyLabel: (a) => L(a), tips: { get: () => guide.isEnabled(), set: (on) => guide.setEnabled(on), replay: () => guide.reset() } });
//   controls.toggle() / controls.open() / controls.close() / controls.isOpen() ; controls.setVisible(false) pour cacher le bouton « ? » (mini-jeu, menu).
//   Le bouton « ? » est en haut à droite, discret (petit, translucide) : le seul rappel permanent de l'aide.
import { ACTIONS, type ActionId } from '../../shared/settings';

export interface ControlsOptions {
  keyLabel: (action: ActionId) => string;
  /** Réglages des conseils (facultatif) : bascule « Conseils » et « Rejouer le tutoriel » dans le panneau. */
  tips?: { get(): boolean; set(on: boolean): void; replay(): void };
  /** Code de la touche d'ouverture (défaut F1). */
  code?: string;
}

const CSS = `
.ct-btn{position:fixed;right:14px;top:14px;z-index:8;width:30px;height:30px;border:3px solid #000;border-radius:50%;background:rgba(255,246,220,.75);color:#1b1b2b;font:900 17px/24px "Segoe UI",Verdana,sans-serif;text-align:center;box-shadow:2px 2px 0 #000;cursor:pointer;padding:0}
.ct-btn:hover{background:#ffd23f}
.ct-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;display:none;width:min(700px,94vw);max-height:84vh;overflow:auto;padding:14px 20px 16px;border:5px solid #000;border-radius:14px;background:#fff6dc;color:#1b1b2b;box-shadow:7px 7px 0 #000;font-family:"Segoe UI",Verdana,sans-serif}
.ct-panel.on{display:block}
.ct-panel h2{margin:0 0 6px;font-size:24px;font-weight:900;letter-spacing:.02em}
.ct-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;align-items:start}
.ct-panel h3{margin:8px 0 3px;font-size:13px;font-weight:900;letter-spacing:.1em;color:#c92a35;text-transform:uppercase}
.ct-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0;font-size:15px;font-weight:700;border-bottom:2px dotted rgba(20,20,31,.25)}
.ct-key{min-width:34px;padding:1px 10px;border:3px solid #000;border-radius:8px;background:#fff;box-shadow:2px 2px 0 #000;text-align:center;font-weight:900;font-size:15px;white-space:nowrap}
.ct-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.ct-actions button{padding:6px 14px;border:3px solid #000;border-radius:8px;background:#ffd23f;color:#1b1b2b;font:900 15px "Segoe UI",Verdana,sans-serif;box-shadow:3px 3px 0 #000;cursor:pointer}
.ct-actions button:hover{background:#ffe27a}
.ct-foot{margin-top:8px;font-size:12px;color:#4a4d6a;font-weight:700}
`;

/** Commandes qui ne se règlent pas (souris, pause) : toujours affichées, textes courts. */
const FIXED: { group: string; rows: [string, string][] }[] = [
  { group: 'Souris', rows: [['Viser', 'Souris'], ['Tirer', 'Clic gauche'], ['Viser librement', 'Clic droit'], ['Zoom (en véhicule)', 'Molette']] },
  { group: 'Divers', rows: [['Pause', 'Échap'], ['Cette aide', 'F1']] },
];

export function createControls(opts: ControlsOptions) {
  const code = opts.code ?? 'F1';
  if (!document.getElementById('ct-css')) {
    const st = document.createElement('style');
    st.id = 'ct-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const btn = document.createElement('button');
  btn.className = 'ct-btn'; btn.type = 'button'; btn.textContent = '?'; btn.title = `Aide des touches (${code})`; btn.setAttribute('aria-label', 'Aide des touches');
  const panel = document.createElement('div');
  panel.className = 'ct-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Commandes');
  document.body.append(btn, panel);
  let open = false;

  const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const row = (label: string, key: string) => { const r = el('div', 'ct-row'); r.append(el('span', undefined, label), el('span', 'ct-key', key)); return r; };

  function build() {
    panel.textContent = '';
    panel.appendChild(el('h2', undefined, 'Commandes'));
    const grid = el('div', 'ct-grid');
    panel.appendChild(grid);
    const block = (title: string, rows: [string, string][]) => {
      const d = el('div');
      d.appendChild(el('h3', undefined, title));
      for (const [l, k] of rows) d.appendChild(row(l, k));
      grid.appendChild(d);
    };
    for (const group of ['À pied', 'Véhicules', 'Général'] as const) {
      const rows = ACTIONS.filter((a) => a.group === group).map((a) => [a.label, opts.keyLabel(a.id)] as [string, string]).filter((r) => r[1] && r[1] !== '—'); // seulement les touches assignées
      if (rows.length) block(group === 'Véhicules' ? 'En véhicule' : group, rows);
    }
    for (const f of FIXED) block(f.group, f.rows);
    const acts = el('div', 'ct-actions');
    if (opts.tips) {
      const tips = opts.tips;
      const b = el('button', undefined, `Conseils : ${tips.get() ? 'oui' : 'non'}`) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => { tips.set(!tips.get()); b.textContent = `Conseils : ${tips.get() ? 'oui' : 'non'}`; });
      const r = el('button', undefined, 'Rejouer le tutoriel') as HTMLButtonElement;
      r.type = 'button';
      r.addEventListener('click', () => { tips.replay(); api.close(); });
      acts.append(b, r);
    }
    const c = el('button', undefined, 'Fermer') as HTMLButtonElement;
    c.type = 'button';
    c.addEventListener('click', () => api.close());
    acts.appendChild(c);
    panel.appendChild(acts);
    panel.appendChild(el('div', 'ct-foot', 'Les touches se changent dans Options (menu pause).'));
  }

  const api = {
    isOpen: () => open,
    open() { build(); open = true; panel.classList.add('on'); },
    close() { open = false; panel.classList.remove('on'); },
    toggle() { if (open) api.close(); else api.open(); },
    setVisible(v: boolean) { btn.style.display = v ? '' : 'none'; if (!v) api.close(); },
    /** Contenu actuel (tests) : « libellé=touche ». */
    rows(): string[] { return Array.from(panel.querySelectorAll('.ct-row')).map((r) => `${r.children[0].textContent}=${r.children[1].textContent}`); },
    dispose() { removeEventListener('keydown', onKey, true); btn.remove(); panel.remove(); },
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (e.code === code) { e.preventDefault(); api.toggle(); }
    else if (e.code === 'Escape' && open) api.close();
  };
  addEventListener('keydown', onKey, true);
  btn.addEventListener('click', () => api.toggle());
  return api;
}
export type Controls = ReturnType<typeof createControls>;
