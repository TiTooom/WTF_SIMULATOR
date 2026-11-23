// PROPRIÉTAIRE : game-economy
// Boutique du dealer, fenêtre style BD (même esprit que le PDA). Les prix viennent du serveur (`me.shop`), le client n'en calcule aucun ;
// il envoie seulement des messages `{ k: 'trade', dealer, good, qty, side }` que le serveur revalide. Tout texte passe par `textContent`.
//
// API pour main.ts :
//   const shop = new ShopUi(document.body, { send: (m) => net.send({ type: 'game', m }), onToggle: (open) => open ? document.exitPointerLock() : grab(),
//                                             toast: (t) => hud.toast(t) });
//   net.onMe = (s) => { pda.setState(s); shop.setState(s); };       // ferme tout seul quand `s.shop` disparaît (le joueur s'éloigne)
//   à la touche d'interaction (settings.keys.interact) : `if (shop.interact()) return;` avant d'envoyer { type: 'interact' } au serveur
//        interact() ouvre la boutique si `me.shop` est présent (renvoie true), la ferme si elle est ouverte (true), sinon renvoie false.
//   shop.isOpen(), shop.close()   (Échap ferme aussi la boutique)
//   shop.canInteract()            : vrai si un dealer est à portée (pour afficher l'astuce « E : parler au dealer »)
import { GANGS } from '../../shared/economy/gangs';
import { GOODS } from '../../shared/economy/goods';
import { BAG_CAP, MAX_TRADE_QTY } from '../../shared/economy/trade';
import type { GameClientMsg, PrivateState, ShopView } from '../../shared/protocol';
import { DISTRICTS } from '../../shared/city/districts';

export interface ShopOptions {
  /** Envoie un message de jeu au serveur. */
  send(m: GameClientMsg): void;
  /** Ouverture / fermeture (libérer / reprendre la souris). */
  onToggle?(open: boolean): void;
  /** Petit message affiché à la fermeture (réplique d'adieu du dealer). */
  toast?(text: string): void;
}

const CSS = `
.shop-overlay{position:fixed;inset:0;z-index:880;display:none;align-items:center;justify-content:center;background:rgba(12,12,28,.6);font-family:"Segoe UI",Verdana,sans-serif;color:#1b1b2b}
.shop-overlay.open{display:flex}
.shop-win{width:min(820px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#fff6dc;border:6px solid #000;border-radius:18px;padding:14px 16px;box-shadow:9px 9px 0 #000;box-sizing:border-box}
.shop-head{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.shop-title{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;text-shadow:2px 2px 0 #ffd23f}
.shop-grow{flex:1}
.shop-chip{padding:3px 12px;border:3px solid #000;border-radius:999px;background:#fff;font-size:14px;font-weight:900;box-shadow:2px 2px 0 #000}
.shop-bubble{position:relative;border:4px solid #000;border-radius:14px;background:#fff;padding:8px 14px;margin:0 0 10px;font-weight:700;font-style:italic;box-shadow:4px 4px 0 #000}
.shop-list{overflow:auto;display:flex;flex-direction:column;gap:8px;padding:2px 6px 8px 2px}
.shop-row{display:grid;grid-template-columns:minmax(150px,1.4fr) auto auto auto;align-items:center;gap:8px 12px;border:4px solid #000;border-radius:10px;background:#fff;padding:6px 10px;box-shadow:3px 3px 0 #000}
.shop-name{font-weight:900}
.shop-sub{font-size:12px;color:#5a5d7a;font-weight:700}
.shop-price{font-weight:900;text-align:center;min-width:92px}
.shop-price b{display:block;font-size:11px;text-transform:uppercase;color:#5a5d7a}
.shop-qty{display:flex;align-items:center;gap:4px}
.shop-qty span{min-width:30px;text-align:center;font-weight:900}
.shop-btn{padding:4px 9px;border:3px solid #000;border-radius:8px;background:#e9e4d0;color:#1b1b2b;font-size:13px;font-weight:900;cursor:pointer;box-shadow:2px 2px 0 #000}
.shop-btn:hover{filter:brightness(1.08)}
.shop-btn:disabled{opacity:.45;cursor:default}
.shop-btn.buy{background:#69db7c}
.shop-btn.sell{background:#ffd23f}
.shop-act{display:flex;gap:6px}
.shop-foot{display:flex;align-items:center;gap:10px;margin-top:10px}
.shop-hint{font-size:12px;color:#5a5d7a;font-weight:700}
@media (max-width:700px){.shop-row{grid-template-columns:1fr 1fr}}
`;

const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const bagVol = (bag: Partial<Record<string, number>>) => {
  let v = 0;
  for (const [g, q] of Object.entries(bag)) v += (GOODS[g as keyof typeof GOODS]?.weight ?? 0) * (q ?? 0);
  return v;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Remplit `root` avec le contenu de la boutique (sans état global : `qty` est conservé par l'appelant). */
export function renderShop(root: HTMLElement, shop: ShopView, send: (m: GameClientMsg) => void, me?: PrivateState, qty: Map<string, number> = new Map()): void {
  root.textContent = '';
  const gang = GANGS[shop.gang];
  const money = me?.money ?? 0, cap = me?.bagCap ?? BAG_CAP, bag = me?.bag ?? {};
  const used = bagVol(bag);
  const head = el('div', 'shop-head');
  head.append(el('div', 'shop-title', gang?.dealer.name ?? 'Dealer'), el('div', 'shop-grow'),
    el('span', 'shop-chip', DISTRICTS[shop.district]?.name ?? ''), el('span', 'shop-chip', fmt(money)), el('span', 'shop-chip', `Sac ${used}/${cap}`));
  root.appendChild(head);
  root.appendChild(el('div', 'shop-bubble', `« ${gang?.dealer.greeting ?? '...'} »`));
  const list = el('div', 'shop-list');
  for (const g of shop.goods) {
    const def = GOODS[g.good];
    if (!def) continue;
    const owned = bag[g.good] ?? 0;
    const row = el('div', 'shop-row');
    const name = el('div');
    name.append(el('div', 'shop-name', `${def.emoji} ${def.name}`), el('div', 'shop-sub', `${def.blurb} (volume ${def.weight} · dans le sac : ${owned})`));
    const price = el('div', 'shop-price');
    const b1 = el('b', undefined, 'Tu paies'); price.append(b1, document.createTextNode(fmt(g.buy)));
    const price2 = el('div', 'shop-price');
    const b2 = el('b', undefined, 'Tu reçois'); price2.append(b2, document.createTextNode(fmt(g.sell)));
    const maxBuy = Math.max(0, Math.min(MAX_TRADE_QTY, Math.floor(money / Math.max(1, g.buy)), Math.floor((cap - used) / Math.max(1, def.weight))));
    const maxSell = Math.min(MAX_TRADE_QTY, owned);
    const q = Math.max(1, Math.min(MAX_TRADE_QTY, qty.get(g.good) ?? 1));
    const qv = el('span', undefined, String(q));
    const setQ = (n: number) => { const v = Math.max(1, Math.min(MAX_TRADE_QTY, Math.round(n))); qty.set(g.good, v); qv.textContent = String(v); buy.textContent = `Acheter ×${v}`; sell.textContent = `Vendre ×${v}`; check(); };
    const qb = (label: string, f: () => number) => { const b = el('button', 'shop-btn', label); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); setQ(f()); }); return b; };
    const qctl = el('div', 'shop-qty');
    qctl.append(qb('−5', () => (qty.get(g.good) ?? 1) - 5), qb('−1', () => (qty.get(g.good) ?? 1) - 1), qv,
      qb('+1', () => (qty.get(g.good) ?? 1) + 1), qb('+5', () => (qty.get(g.good) ?? 1) + 5), qb('max', () => (maxBuy > 0 ? maxBuy : maxSell || 1)));
    const buy = el('button', 'shop-btn buy', `Acheter ×${q}`); buy.type = 'button';
    const sell = el('button', 'shop-btn sell', `Vendre ×${q}`); sell.type = 'button';
    const check = () => { const n = qty.get(g.good) ?? 1; buy.disabled = n > maxBuy; sell.disabled = n > maxSell; };
    const go = (side: 'buy' | 'sell') => () => send({ k: 'trade', dealer: shop.dealer, good: g.good, qty: Math.max(1, Math.min(MAX_TRADE_QTY, qty.get(g.good) ?? 1)), side });
    buy.addEventListener('click', (e) => { e.stopPropagation(); go('buy')(); });
    sell.addEventListener('click', (e) => { e.stopPropagation(); go('sell')(); });
    check();
    const act = el('div', 'shop-act');
    act.append(buy, sell);
    row.append(name, price, price2, qctl);
    const wrap = el('div');
    wrap.style.gridColumn = '1 / -1';
    wrap.style.display = 'flex';
    wrap.style.justifyContent = 'flex-end';
    wrap.appendChild(act);
    row.appendChild(wrap);
    list.appendChild(row);
  }
  root.appendChild(list);
  root.appendChild(el('div', 'shop-hint', 'Les prix changent avec les tuyaux reçus par SMS et la pression policière. Éloigne-toi ou appuie sur Échap pour partir.'));
}

export class ShopUi {
  private overlay: HTMLDivElement;
  private win: HTMLDivElement;
  private me: PrivateState | null = null;
  private opened = false;
  private dealer = '';
  private lastSig = '';
  private pressed = false;
  private qty = new Map<string, number>();

  constructor(parent: HTMLElement, private opts: ShopOptions) {
    if (!document.getElementById('shop-css')) {
      const st = document.createElement('style');
      st.id = 'shop-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.overlay = el('div', 'shop-overlay');
    this.win = el('div', 'shop-win');
    this.overlay.appendChild(this.win);
    parent.appendChild(this.overlay);
    this.win.addEventListener('pointerdown', () => { this.pressed = true; });
    addEventListener('pointerup', () => { this.pressed = false; }, true);
    addEventListener('keydown', (e) => {
      if (this.opened && e.code === 'Escape') { e.stopImmediatePropagation(); this.close(); }
    }, true);
    this.overlay.addEventListener('mousedown', (e) => { if (e.target === this.overlay) this.close(); });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isOpen(): boolean { return this.opened; }
  canInteract(): boolean { return !!this.me?.shop; }

  /** Touche d'interaction : ouvre / ferme la boutique. Renvoie true si l'action a été traitée ici. */
  interact(): boolean {
    if (this.opened) { this.close(); return true; }
    const shop = this.me?.shop;
    if (!shop) return false;
    this.opened = true;
    this.dealer = shop.dealer;
    this.overlay.classList.add('open');
    this.draw(true);
    this.opts.onToggle?.(true);
    return true;
  }

  close(farewell = true): void {
    if (!this.opened) return;
    this.opened = false;
    this.overlay.classList.remove('open');
    const shop = this.me?.shop;
    if (farewell && shop) this.opts.toast?.(GANGS[shop.gang]?.dealer.farewell ?? '');
    this.opts.onToggle?.(false);
  }

  /** Nouvel état privé (message `me`). */
  setState(me: PrivateState): void {
    this.me = me;
    if (!this.opened) return;
    if (!me.shop || me.shop.dealer !== this.dealer) { // le joueur s'est éloigné
      this.opened = false;
      this.overlay.classList.remove('open');
      this.opts.onToggle?.(false);
      return;
    }
    this.draw(false);
  }

  private draw(force: boolean): void {
    const me = this.me;
    if (!me?.shop) return;
    const sig = JSON.stringify([me.money, me.bag, me.bagCap, me.shop]);
    if (!force && (sig === this.lastSig || this.pressed)) return;
    this.lastSig = sig;
    const y = this.win.scrollTop;
    const list = this.win.querySelector('.shop-list');
    const ly = list ? list.scrollTop : 0;
    renderShop(this.win, me.shop, this.opts.send, me, this.qty);
    this.win.scrollTop = y;
    const nl = this.win.querySelector('.shop-list');
    if (nl) nl.scrollTop = ly;
  }
}
