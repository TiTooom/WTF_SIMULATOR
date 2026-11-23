// Coquille du PDA (PROPRIÉTAIRE : art-toon) : assistant numérique diégétique, thème BD (encre épaisse, aplats, trame de points).
// Aucune logique de jeu : les onglets affichent `PrivateState` (message `me`) et envoient des `GameClientMsg` ; TOUT texte venant du réseau passe par `textContent`.
//
// API pour main.ts :
//   const pda = new Pda(document.body, { send: (m) => net.send({ type: 'game', m }), now: () => simTimeMs, key: () => settings.keys.pda,
//                                        onToggle: (open) => open ? document.exitPointerLock() : grab(), canOpen: () => playing && !chat.isOpen() && !settingsOpen,
//                                        player: () => ({ x, z, yaw }), mates: () => [{ name, x, z }] });
//   net.onMe = (s) => pda.setState(s);                 // le PDA se redessine tout seul s'il est ouvert
//   pda.open('carte' | 'sms' | 'marche' | 'missions' | 'stats'), pda.close(), pda.toggle(), pda.isOpen()
//   registerTab('marche', renderMarche, 'Marché')      // pour les onglets des autres agents (src/ui/pda/marche.ts, missions.ts, stats.ts), avant ou après `new Pda`
// `carte` et `sms` sont enregistrés par défaut. Un onglet non enregistré affiche « bientôt disponible ».
//
// Contrat d'un onglet : `render(root, me, ctx)` est appelé à l'ouverture, au changement d'onglet et (au plus 5 fois/s, jamais pendant un clic) quand `me` change.
// Il doit être idempotent et léger (reconstruire le contenu de `root` ou le mettre à jour). Classes utilitaires : .pda-h .pda-card .pda-row .pda-btn .pda-muted .pda-tag .pda-grid.
import { DISTRICTS } from '../../shared/city/districts';
import { PDA_PANELS, type GameClientMsg, type Panel, type PrivateState } from '../../shared/protocol';
import { render as renderCarte } from './pda/carte';
import { render as renderSms } from './pda/sms';

export interface PdaCtx {
  /** Envoie un message de jeu au serveur (jamais de logique côté client). */
  send(m: GameClientMsg): void;
  /** Temps de simulation courant (ms) = `Snapshot.t` : sert aux compte à rebours (`Sms.tip.until`). */
  now(): number;
  /** Code de la touche d'ouverture (event.code, réglage `pda`). Sans lui, l'ouverture se fait seulement par `open()`. */
  key?(): string;
  /** Appelé à l'ouverture / fermeture (libérer / reprendre la souris). */
  onToggle?(open: boolean): void;
  /** Garde-fou : false pendant le chat, les options, avant la connexion. */
  canOpen?(): boolean;
  /** Position du joueur (carte). */
  player?(): { x: number; z: number; yaw: number } | null;
  /** Coéquipiers (carte). */
  mates?(): { name: string; x: number; z: number }[];
}
/** Un onglet : remplit `root` d'après l'état privé le plus récent. */
export type PanelRenderer = (root: HTMLElement, me: PrivateState, ctx: PdaCtx) => void;

const LABELS: Record<Panel, string> = { carte: 'Carte', sms: 'SMS', marche: 'Marché', missions: 'Missions', stats: 'Stats' };
const tabs = new Map<Panel, { render: PanelRenderer; label: string }>();
/** Enregistre (ou remplace) le rendu d'un onglet. */
export function registerTab(id: Panel, render: PanelRenderer, label?: string): void {
  tabs.set(id, { render, label: label ?? LABELS[id] });
}
registerTab('carte', renderCarte);
registerTab('sms', renderSms);

const CSS = `
.pda-overlay{position:fixed;inset:0;z-index:900;display:none;align-items:center;justify-content:center;background:rgba(12,12,28,.78);font-family:"Segoe UI",Verdana,sans-serif;color:#1b1b2b}
.pda-overlay.open{display:flex}
.pda-device{position:relative;width:min(1000px,97vw);height:min(640px,94vh);display:flex;flex-direction:column;background:#23233a;border:6px solid #000;border-radius:30px;padding:14px 16px 12px;box-shadow:9px 9px 0 #000,0 0 0 3px #ffd23f inset;box-sizing:border-box}
.pda-top{display:flex;align-items:center;gap:12px;margin:0 6px 10px;color:#fff;font-weight:900}
.pda-top .pda-speaker{width:70px;height:10px;border-radius:5px;background:#0b0b16;box-shadow:0 0 0 2px #000}
.pda-top .pda-title{font-size:20px;letter-spacing:.12em;color:#ffd23f;text-shadow:2px 2px 0 #000}
.pda-top .pda-grow{flex:1}
.pda-chip{padding:3px 12px;border:3px solid #000;border-radius:999px;background:#fff;color:#1b1b2b;font-size:14px;font-weight:900;box-shadow:2px 2px 0 #000}
.pda-hint{font-size:12px;color:#aeb0d0;font-weight:700}
.pda-screen{flex:1;min-height:0;overflow:auto;border:5px solid #000;border-radius:14px;padding:14px 16px;background:radial-gradient(rgba(27,27,43,.13) 1.3px,transparent 1.7px) 0 0/9px 9px,#fff6dc;box-sizing:border-box}
.pda-tabs{display:flex;gap:10px;margin-top:10px;justify-content:center}
.pda-tab{position:relative;min-width:110px;padding:9px 16px;border:4px solid #000;border-radius:12px;background:#e9e4d0;color:#1b1b2b;font-size:15px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;box-shadow:3px 3px 0 #000;transition:transform .08s}
.pda-tab:hover{transform:translate(-1px,-1px)}
.pda-tab.on{background:#ffd23f;transform:translate(2px,2px);box-shadow:1px 1px 0 #000}
.pda-tab.off{opacity:.55}
.pda-badge{position:absolute;top:-12px;right:-9px;min-width:22px;height:22px;line-height:22px;padding:0 4px;border:3px solid #000;border-radius:999px;background:#e63946;color:#fff;font-size:12px;text-align:center;box-sizing:border-box}
.pda-h{margin:0 0 10px;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;text-shadow:2px 2px 0 #ffd23f}
.pda-card{border:4px solid #000;border-radius:10px;background:#fff;padding:9px 12px;margin:0 0 10px;box-shadow:4px 4px 0 #000}
.pda-card.hot{background:#ffe9a6}
.pda-row{display:flex;align-items:center;gap:10px}
.pda-muted{color:#5a5d7a;font-size:13px;font-weight:700}
.pda-tag{display:inline-block;padding:1px 8px;margin-right:6px;border:3px solid #000;border-radius:6px;background:#ffd23f;font-size:11px;font-weight:900;text-transform:uppercase}
.pda-btn{padding:6px 14px;border:4px solid #000;border-radius:9px;background:#2f80ed;color:#fff;font-size:14px;font-weight:900;cursor:pointer;box-shadow:3px 3px 0 #000}
.pda-btn:hover{filter:brightness(1.1)}
.pda-btn:disabled{opacity:.5;cursor:default}
.pda-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
@media (max-width:760px){.pda-tab{min-width:70px;padding:7px 8px;font-size:12px}}
`;

export class Pda {
  private overlay: HTMLDivElement;
  private screen: HTMLDivElement;
  private chipMoney: HTMLSpanElement;
  private chipDistrict: HTMLSpanElement;
  private tabEls = new Map<Panel, { btn: HTMLButtonElement; badge: HTMLSpanElement; label: HTMLSpanElement }>();
  private me: PrivateState | null = null;
  private panel: Panel = 'carte';
  private opened = false;
  private lastSig = '';
  private lastRender = 0;
  private pressed = false;
  private timer = 0;

  constructor(root: HTMLElement, private ctx: PdaCtx) {
    if (!document.getElementById('pda-css')) {
      const st = document.createElement('style');
      st.id = 'pda-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.overlay = document.createElement('div');
    this.overlay.className = 'pda-overlay';
    const dev = document.createElement('div');
    dev.className = 'pda-device';
    const top = document.createElement('div');
    top.className = 'pda-top';
    const spk = document.createElement('div'); spk.className = 'pda-speaker';
    const title = document.createElement('div'); title.className = 'pda-title'; title.textContent = 'PDA UNILASALLE';
    const grow = document.createElement('div'); grow.className = 'pda-grow';
    this.chipMoney = document.createElement('span'); this.chipMoney.className = 'pda-chip';
    this.chipDistrict = document.createElement('span'); this.chipDistrict.className = 'pda-chip';
    const hint = document.createElement('span'); hint.className = 'pda-hint'; hint.textContent = 'Échap : fermer';
    top.append(spk, title, grow, this.chipDistrict, this.chipMoney, hint);
    this.screen = document.createElement('div');
    this.screen.className = 'pda-screen';
    const bar = document.createElement('div');
    bar.className = 'pda-tabs';
    for (const id of PDA_PANELS) {
      const btn = document.createElement('button');
      btn.className = 'pda-tab';
      btn.type = 'button';
      const badge = document.createElement('span');
      badge.className = 'pda-badge';
      badge.style.display = 'none';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.open(id); });
      bar.appendChild(btn);
      const label = document.createElement('span');
      btn.append(label, badge);
      this.tabEls.set(id, { btn, badge, label });
    }
    dev.append(top, this.screen, bar);
    this.overlay.appendChild(dev);
    root.appendChild(this.overlay);
    this.syncLabels();

    this.screen.addEventListener('pointerdown', () => { this.pressed = true; });
    addEventListener('pointerup', () => { this.pressed = false; }, true);
    addEventListener('keydown', (e) => this.onKey(e), true);
    this.overlay.addEventListener('mousedown', (e) => { if (e.target === this.overlay) this.close(); });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (this.opened && e.code === 'Escape') {
      e.stopImmediatePropagation();
      this.close();
      return;
    }
    const key = this.ctx.key?.();
    if (!key || e.code !== key || e.repeat) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (!this.opened && this.ctx.canOpen && !this.ctx.canOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.toggle();
  }

  private syncLabels() {
    for (const [id, el] of this.tabEls) {
      const t = tabs.get(id);
      el.label.textContent = t?.label ?? LABELS[id];
      el.btn.classList.toggle('off', !t);
    }
  }

  open(panel?: Panel): void {
    if (panel && PDA_PANELS.includes(panel)) this.panel = panel;
    const was = this.opened;
    this.opened = true;
    this.overlay.classList.add('open');
    this.syncLabels();
    for (const [id, el] of this.tabEls) el.btn.classList.toggle('on', id === this.panel);
    this.draw(true);
    if (!this.timer) this.timer = window.setInterval(() => this.draw(false), 200);
    if (!was) this.ctx.onToggle?.(true);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.overlay.classList.remove('open');
    clearInterval(this.timer);
    this.timer = 0;
    this.ctx.onToggle?.(false);
  }

  toggle(): void { this.opened ? this.close() : this.open(); }
  isOpen(): boolean { return this.opened; }
  panelId(): Panel { return this.panel; }

  /** Nouvel état privé (message `me`). */
  setState(me: PrivateState): void {
    this.me = me;
    const t = this.tabEls.get('sms');
    if (t) {
      t.badge.textContent = String(Math.min(99, me.unread));
      t.badge.style.display = me.unread > 0 ? '' : 'none';
    }
    if (this.opened) this.draw(false);
  }

  private draw(force: boolean) {
    const me = this.me;
    if (!me) {
      if (force) { this.screen.textContent = 'En attente du serveur…'; }
      return;
    }
    this.chipMoney.textContent = `${Math.round(me.money).toLocaleString('fr-FR')} €`;
    this.chipDistrict.textContent = DISTRICTS[me.district]?.name ?? '';
    const sig = this.panel + JSON.stringify(me);
    const now = performance.now();
    if (!force && sig === this.lastSig && now - this.lastRender < 1000) return; // inchangé (rafraîchi chaque seconde pour les compte à rebours)
    if (!force && (this.pressed || now - this.lastRender < 180)) return;
    this.lastSig = sig;
    this.lastRender = now;
    const t = tabs.get(this.panel);
    if (!t) {
      this.screen.textContent = '';
      const p = document.createElement('div');
      p.className = 'pda-card';
      p.textContent = 'Cet onglet sera bientôt disponible.';
      this.screen.appendChild(p);
      return;
    }
    try { t.render(this.screen, me, this.ctx); } catch (err) { console.error('PDA', this.panel, err); }
  }
}
