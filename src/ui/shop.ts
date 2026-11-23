// PROPRIÉTAIRE : game-economy
// Boutique du dealer, fenêtre style BD (même esprit que le PDA). Les prix viennent du serveur (`me.shop`), le client n'en calcule aucun ;
// il envoie seulement des messages `{ k: 'trade', dealer, good, qty, side }` que le serveur revalide. Tout texte passe par `textContent`.
//
// API pour main.ts :
//   const shop = new ShopUi(document.body, { send: (m) => net.send({ type: 'game', m }), onToggle: (open) => open ? document.exitPointerLock() : grab(),
//                                             toast: (t) => hud.toast(t) });
//   net.onMe = (s) => { pda.setState(s); shop.setState(s); };       // ferme tout seul quand `s.shop` disparaît (le joueur s'éloigne, est arrêté ou meurt)
//   à la touche d'interaction (settings.keys.interact) : `if (shop.interact()) return;` avant d'envoyer { type: 'interact' } au serveur
//        interact() ouvre la boutique si `me.shop` est présent (renvoie true), la ferme si elle est ouverte (true), sinon renvoie false.
//   shop.isOpen(), shop.close()   (Échap ferme aussi la boutique)
//   shop.canInteract()            : vrai si un dealer est à portée (pour afficher l'astuce « E : parler au dealer »)
// Confort : tri (ordre, prix, bon marché, revente, sac), prix colorés selon l'écart à la base (vert : avantageux, rouge : cher) et flèche de tendance
// depuis le dernier changement de prix, confirmation visuelle d'une transaction (la ligne clignote, le montant flotte), anti double-clic (250 ms, comme le serveur).
// Clavier (fenêtre ouverte, la souris est libérée par onToggle) : ↑/↓ choisir la ligne, ←/→ quantité ±1, PgPréc/PgSuiv ±5, Fin = max, Origine = 1,
// Entrée = acheter, Suppr ou Retour arrière = vendre. Aucune lettre (elles servent à marcher) ; Échap ferme. Les autres touches ne sont pas interceptées.
import { GANGS } from '../../shared/economy/gangs';
import { GOODS } from '../../shared/economy/goods';
import { BAG_CAP, MAX_TRADE_QTY } from '../../shared/economy/trade';
import type { GoodId } from '../../shared/ids';
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
.shop-overlay.open .shop-win{animation:shop-pop .18s ease-out}
@keyframes shop-pop{from{transform:scale(.92) translateY(14px);opacity:0}to{transform:none;opacity:1}}
.shop-win{width:min(820px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#fff6dc;border:6px solid #000;border-radius:18px;padding:14px 16px;box-shadow:9px 9px 0 #000;box-sizing:border-box}
.shop-head{display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.shop-title{font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;text-shadow:2px 2px 0 #ffd23f}
.shop-grow{flex:1}
.shop-chip{padding:3px 12px;border:3px solid #000;border-radius:999px;background:#fff;font-size:14px;font-weight:900;box-shadow:2px 2px 0 #000}
.shop-chip.up{animation:shop-up .7s ease-out}
.shop-chip.down{animation:shop-down .7s ease-out}
@keyframes shop-up{0%{background:#69db7c;transform:scale(1.18)}100%{background:#fff;transform:none}}
@keyframes shop-down{0%{background:#ff8787;transform:scale(1.18)}100%{background:#fff;transform:none}}
.shop-bubble{position:relative;border:4px solid #000;border-radius:14px;background:#fff;padding:8px 14px;margin:0 0 8px;font-weight:700;font-style:italic;box-shadow:4px 4px 0 #000}
.shop-sort{display:flex;align-items:center;gap:6px;margin:0 0 8px;flex-wrap:wrap;font-size:12px;font-weight:900;color:#5a5d7a;text-transform:uppercase}
.shop-sort .shop-btn{padding:2px 8px;font-size:12px}
.shop-sort .shop-btn.on{background:#ffd23f}
.shop-list{overflow:auto;display:flex;flex-direction:column;gap:8px;padding:2px 6px 8px 2px}
.shop-row{position:relative;display:grid;grid-template-columns:minmax(150px,1.4fr) auto auto auto;align-items:center;gap:8px 12px;border:4px solid #000;border-radius:10px;background:#fff;padding:6px 10px;box-shadow:3px 3px 0 #000;cursor:default}
.shop-row.sel{outline:4px solid #2f80ed;outline-offset:1px}
.shop-row.flash-buy{animation:shop-up .8s ease-out}
.shop-row.flash-sell{animation:shop-down .8s ease-out}
.shop-float{position:absolute;right:14px;top:-4px;font-weight:900;font-size:18px;pointer-events:none;text-shadow:2px 2px 0 #fff;animation:shop-float 1s ease-out forwards}
.shop-float.buy{color:#1e8e3e}
.shop-float.sell{color:#b8860b}
@keyframes shop-float{from{transform:translateY(8px);opacity:1}to{transform:translateY(-22px);opacity:0}}
.shop-name{font-weight:900}
.shop-sub{font-size:12px;color:#5a5d7a;font-weight:700}
.shop-price{font-weight:900;text-align:center;min-width:92px}
.shop-price b{display:block;font-size:11px;text-transform:uppercase;color:#5a5d7a}
.shop-price.good{color:#1e8e3e}
.shop-price.bad{color:#d62828}
.shop-qty{display:flex;align-items:center;gap:4px}
.shop-qty span{min-width:30px;text-align:center;font-weight:900}
.shop-btn{padding:4px 9px;border:3px solid #000;border-radius:8px;background:#e9e4d0;color:#1b1b2b;font-size:13px;font-weight:900;cursor:pointer;box-shadow:2px 2px 0 #000;transition:transform .06s}
.shop-btn:hover{filter:brightness(1.08)}
.shop-btn:active:not(:disabled){transform:translate(2px,2px);box-shadow:0 0 0 #000}
.shop-btn:disabled{opacity:.45;cursor:default}
.shop-btn.buy{background:#69db7c}
.shop-btn.sell{background:#ffd23f}
.shop-act{display:flex;gap:6px}
.shop-hint{font-size:12px;color:#5a5d7a;font-weight:700;margin-top:4px}
@media (max-width:700px){.shop-row{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:reduce){.shop-overlay.open .shop-win,.shop-chip.up,.shop-chip.down,.shop-row.flash-buy,.shop-row.flash-sell,.shop-float{animation:none}}
`;

const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const bagVol = (bag: Partial<Record<string, number>>) => {
  let v = 0;
  for (const [g, q] of Object.entries(bag)) v += (GOODS[g as keyof typeof GOODS]?.weight ?? 0) * (q ?? 0);
  return v;
};
const clampQty = (n: number) => Math.max(1, Math.min(MAX_TRADE_QTY, Math.round(Number.isFinite(n) ? n : 1)));
/** Anti double-clic côté client (le serveur ignore aussi une 2e transaction dans les 200 ms). */
export const CLICK_LOCK_MS = 250;

export type ShopSort = 'ordre' | 'prix' | 'marche' | 'revente' | 'sac';
export const SORT_LABELS: [ShopSort, string][] = [['ordre', 'Ordre'], ['prix', 'Prix'], ['marche', 'Bon marché'], ['revente', 'Revente'], ['sac', 'Mon sac']];

/** Options d'affichage (état conservé par ShopUi entre deux rendus). */
export interface ShopRenderOpts {
  sort?: ShopSort;
  trend?: ReadonlyMap<string, number>; // marchandise -> -1 / +1 : sens du dernier changement de prix d'achat
  flash?: ReadonlyMap<string, { side: 'buy' | 'sell'; qty: number }>; // lignes à faire clignoter
  moneyFlash?: 'up' | 'down' | null;
  flashAge?: number; // ms écoulées depuis le début du clignotement (un nouveau rendu reprend l'animation là où elle en était)
  locked?: boolean; // anti double-clic : boutons d'échange grisés
  selected?: string; // marchandise sélectionnée au clavier
  onSelect?(good: string): void;
  onSort?(s: ShopSort): void;
  onQty?(good: string, n: number): void;
}

/** Ordre d'affichage selon le tri (n'invente aucun prix : compare seulement les prix reçus du serveur et la base de la table). */
export function sortGoods<T extends { good: GoodId; buy: number; sell: number }>(goods: readonly T[], sort: ShopSort, bag: Partial<Record<string, number>>): T[] {
  const list = [...goods].filter((g) => GOODS[g.good]);
  const base = (g: T) => GOODS[g.good].base;
  if (sort === 'prix') list.sort((a, b) => a.buy - b.buy);
  else if (sort === 'marche') list.sort((a, b) => a.buy / base(a) - b.buy / base(b));
  else if (sort === 'revente') list.sort((a, b) => b.sell / base(b) - a.sell / base(a));
  else if (sort === 'sac') list.sort((a, b) => (bag[b.good] ?? 0) - (bag[a.good] ?? 0));
  return list;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Classe de couleur d'un prix d'achat (vert : bon marché, rouge : cher) ou de revente (vert : bien payé, rouge : mal payé) par rapport à la base. */
export function priceClass(side: 'buy' | 'sell', price: number, base: number): '' | 'good' | 'bad' {
  const r = price / Math.max(1, base);
  if (side === 'buy') return r <= 0.85 ? 'good' : r >= 1.3 ? 'bad' : '';
  return r >= 1.15 ? 'good' : r <= 0.7 ? 'bad' : '';
}

/** Remplit `root` avec le contenu de la boutique (sans état global : `qty` est conservé par l'appelant). */
export function renderShop(root: HTMLElement, shop: ShopView, send: (m: GameClientMsg) => void, me?: PrivateState, qty: Map<string, number> = new Map(), ui: ShopRenderOpts = {}): void {
  root.textContent = '';
  const gang = GANGS[shop.gang];
  const money = me?.money ?? 0, cap = me?.bagCap ?? BAG_CAP, bag = me?.bag ?? {};
  const used = bagVol(bag);
  const head = el('div', 'shop-head');
  const moneyChip = el('span', ui.moneyFlash ? `shop-chip ${ui.moneyFlash}` : 'shop-chip', fmt(money));
  head.append(el('div', 'shop-title', gang?.dealer.name ?? 'Dealer'), el('div', 'shop-grow'),
    el('span', 'shop-chip', DISTRICTS[shop.district]?.name ?? ''), moneyChip, el('span', 'shop-chip', `Sac ${used}/${cap}`));
  if (ui.moneyFlash && ui.flashAge) moneyChip.style.animationDelay = `${-ui.flashAge}ms`;
  root.appendChild(head);
  root.appendChild(el('div', 'shop-bubble', `« ${gang?.dealer.greeting ?? '...'} »`));
  const sort = ui.sort ?? 'ordre';
  const bar = el('div', 'shop-sort');
  bar.appendChild(el('span', undefined, 'Trier :'));
  for (const [id, label] of SORT_LABELS) {
    const b = el('button', id === sort ? 'shop-btn on' : 'shop-btn', label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); ui.onSort?.(id); });
    bar.appendChild(b);
  }
  root.appendChild(bar);
  const list = el('div', 'shop-list');
  for (const g of sortGoods(shop.goods, sort, bag)) {
    const def = GOODS[g.good];
    const owned = bag[g.good] ?? 0;
    const fl = ui.flash?.get(g.good);
    const row = el('div', 'shop-row' + (ui.selected === g.good ? ' sel' : '') + (fl ? ` flash-${fl.side}` : ''));
    row.dataset.good = g.good;
    if (fl && ui.flashAge) row.style.animationDelay = `${-ui.flashAge}ms`;
    row.addEventListener('pointerdown', () => ui.onSelect?.(g.good));
    const name = el('div');
    name.append(el('div', 'shop-name', `${def.emoji} ${def.name}`), el('div', 'shop-sub', `${def.blurb} (volume ${def.weight} · dans le sac : ${owned})`));
    const tr = ui.trend?.get(g.good) ?? 0;
    const price = el('div', `shop-price ${priceClass('buy', g.buy, def.base)}`.trim());
    price.append(el('b', undefined, 'Tu paies'), document.createTextNode(`${fmt(g.buy)}${tr > 0 ? ' ▲' : tr < 0 ? ' ▼' : ''}`));
    price.title = `Base ${def.base} € · le prix monte à chaque unité achetée`;
    const price2 = el('div', `shop-price ${priceClass('sell', g.sell, def.base)}`.trim());
    price2.append(el('b', undefined, 'Tu reçois'), document.createTextNode(fmt(g.sell)));
    price2.title = `Base ${def.base} € · le prix baisse à chaque unité vendue`;
    const maxBuy = Math.max(0, Math.min(MAX_TRADE_QTY, Math.floor(money / Math.max(1, g.buy)), Math.floor((cap - used) / Math.max(1, def.weight))));
    const maxSell = Math.min(MAX_TRADE_QTY, owned);
    const q = clampQty(qty.get(g.good) ?? 1);
    const qv = el('span', undefined, String(q));
    const buy = el('button', 'shop-btn buy', `Acheter ×${q}`); buy.type = 'button';
    const sell = el('button', 'shop-btn sell', `Vendre ×${q}`); sell.type = 'button';
    const check = () => { const n = clampQty(qty.get(g.good) ?? 1); buy.disabled = !!ui.locked || n > maxBuy; sell.disabled = !!ui.locked || n > maxSell; };
    const setQ = (n: number) => { const v = clampQty(n); qty.set(g.good, v); qv.textContent = String(v); buy.textContent = `Acheter ×${v}`; sell.textContent = `Vendre ×${v}`; check(); ui.onQty?.(g.good, v); };
    const qb = (label: string, f: () => number) => { const b = el('button', 'shop-btn', label); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); setQ(f()); }); return b; };
    const qctl = el('div', 'shop-qty');
    qctl.append(qb('−5', () => (qty.get(g.good) ?? 1) - 5), qb('−1', () => (qty.get(g.good) ?? 1) - 1), qv,
      qb('+1', () => (qty.get(g.good) ?? 1) + 1), qb('+5', () => (qty.get(g.good) ?? 1) + 5), qb('max', () => (maxBuy > 0 ? maxBuy : maxSell || 1)));
    const go = (side: 'buy' | 'sell') => () => send({ k: 'trade', dealer: shop.dealer, good: g.good, qty: clampQty(qty.get(g.good) ?? 1), side });
    buy.addEventListener('click', (e) => { e.stopPropagation(); if (!buy.disabled) go('buy')(); });
    sell.addEventListener('click', (e) => { e.stopPropagation(); if (!sell.disabled) go('sell')(); });
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
    if (fl) { const f = el('span', `shop-float ${fl.side}`, `${fl.side === 'buy' ? '+' : '−'}${fl.qty} ${def.emoji}`); if (ui.flashAge) f.style.animationDelay = `${-ui.flashAge}ms`; row.appendChild(f); }
    list.appendChild(row);
  }
  root.appendChild(list);
  root.appendChild(el('div', 'shop-hint', 'Les prix changent avec les tuyaux reçus par SMS, la pression policière et tes propres échanges : le lot est facturé au prix moyen. Éloigne-toi ou appuie sur Échap pour partir.'));
  root.appendChild(el('div', 'shop-hint', 'Clavier : ↑ ↓ choisir · ← → quantité ±1 · PgPréc / PgSuiv ±5 · Fin max · Entrée acheter · Suppr vendre.'));
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
  private sort: ShopSort = 'ordre';
  private selected = '';
  private lockUntil = 0;
  private unlockTimer = 0;
  private lastPrices = new Map<string, number>(); // marchandise -> dernier prix d'achat vu chez ce dealer
  private trend = new Map<string, number>();
  private prevBag: Partial<Record<string, number>> = {};
  private prevMoney = -1;
  private flash = new Map<string, { side: 'buy' | 'sell'; qty: number }>();
  private moneyFlash: 'up' | 'down' | null = null;
  private flashTimer = 0;
  private flashAt = 0;

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
    addEventListener('keydown', (e) => this.onKey(e), true);
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
    this.lastPrices.clear(); this.trend.clear(); this.flash.clear(); this.moneyFlash = null;
    this.prevBag = { ...(this.me?.bag ?? {}) }; this.prevMoney = this.me?.money ?? -1;
    this.selected = shop.goods[0]?.good ?? '';
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
    if (!me.shop || me.shop.dealer !== this.dealer) { // le joueur s'est éloigné (ou a été arrêté / est mort : le serveur ne renvoie plus de boutique)
      this.opened = false;
      this.overlay.classList.remove('open');
      this.opts.onToggle?.(false);
      return;
    }
    this.draw(false);
  }

  /** Envoi d'une transaction avec anti double-clic. */
  private send = (m: GameClientMsg): void => {
    const now = performance.now();
    if (now < this.lockUntil) return;
    this.lockUntil = now + CLICK_LOCK_MS;
    this.opts.send(m);
    this.draw(true);
    clearTimeout(this.unlockTimer);
    this.unlockTimer = window.setTimeout(() => { if (this.opened) this.draw(true); }, CLICK_LOCK_MS + 20);
  };

  private onKey(e: KeyboardEvent): void {
    if (!this.opened) return;
    if (e.code === 'Escape') { e.stopImmediatePropagation(); this.close(); return; }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // chat : on ne vole rien
    const shop = this.me?.shop;
    if (!shop || e.ctrlKey || e.altKey || e.metaKey) return;
    const me = this.me!;
    const order = sortGoods(shop.goods, this.sort, me.bag).map((g) => g.good as string);
    if (!order.length) return;
    let idx = order.indexOf(this.selected);
    if (idx < 0) idx = 0;
    const cur = order[idx] as GoodId;
    const q = clampQty(this.qty.get(cur) ?? 1);
    const g = shop.goods.find((x) => x.good === cur);
    const bag = me.bag;
    const used = bagVol(bag);
    const def = GOODS[cur];
    let handled = true;
    switch (e.code) {
      case 'ArrowUp': this.selected = order[(idx + order.length - 1) % order.length]; break;
      case 'ArrowDown': this.selected = order[(idx + 1) % order.length]; break;
      case 'ArrowLeft': this.qty.set(cur, clampQty(q - 1)); break;
      case 'ArrowRight': this.qty.set(cur, clampQty(q + 1)); break;
      case 'PageUp': this.qty.set(cur, clampQty(q + 5)); break;
      case 'PageDown': this.qty.set(cur, clampQty(q - 5)); break;
      case 'End': case 'Home': {
        const maxBuy = g && def ? Math.max(0, Math.min(MAX_TRADE_QTY, Math.floor(me.money / Math.max(1, g.buy)), Math.floor(((me.bagCap || BAG_CAP) - used) / Math.max(1, def.weight)))) : 0;
        const maxSell = Math.min(MAX_TRADE_QTY, bag[cur] ?? 0);
        this.qty.set(cur, clampQty(e.code === 'Home' ? 1 : maxBuy > 0 ? maxBuy : maxSell || 1));
        break;
      }
      case 'Enter': case 'NumpadEnter': if (!e.repeat) this.send({ k: 'trade', dealer: shop.dealer, good: cur, qty: q, side: 'buy' }); break;
      case 'Delete': case 'Backspace': if (!e.repeat) this.send({ k: 'trade', dealer: shop.dealer, good: cur, qty: q, side: 'sell' }); break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.draw(true);
    const row = this.win.querySelector(`.shop-row[data-good="${this.selected}"]`);
    if (row && 'scrollIntoView' in row) (row as HTMLElement).scrollIntoView({ block: 'nearest' });
  }

  /** Compare le sac et l'argent au dernier rendu : lignes à faire clignoter (confirmation visuelle d'une transaction). */
  private detectChanges(me: PrivateState): void {
    if (this.prevMoney >= 0) {
      let any = false;
      this.flash.clear();
      for (const g of Object.keys(GOODS)) {
        const d = (me.bag[g as GoodId] ?? 0) - (this.prevBag[g] ?? 0);
        if (d !== 0) { this.flash.set(g, { side: d > 0 ? 'buy' : 'sell', qty: Math.abs(d) }); any = true; }
      }
      this.moneyFlash = me.money > this.prevMoney ? 'up' : me.money < this.prevMoney ? 'down' : null;
      if (any || this.moneyFlash) {
        this.flashAt = performance.now();
        clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => { this.flash.clear(); this.moneyFlash = null; }, 1100);
      }
    }
    this.prevBag = { ...me.bag };
    this.prevMoney = me.money;
  }

  private draw(force: boolean): void {
    const me = this.me;
    if (!me?.shop) return;
    const sig = JSON.stringify([me.money, me.bag, me.bagCap, me.shop]);
    const changed = sig !== this.lastSig;
    if (!force && (!changed || this.pressed)) return;
    if (changed) {
      this.lastSig = sig;
      this.detectChanges(me);
      for (const g of me.shop.goods) { // tendance : sens du dernier changement du prix d'achat
        const prev = this.lastPrices.get(g.good);
        if (prev !== undefined && prev !== g.buy) this.trend.set(g.good, g.buy > prev ? 1 : -1);
        this.lastPrices.set(g.good, g.buy);
      }
    }
    const y = this.win.scrollTop;
    const list = this.win.querySelector('.shop-list');
    const ly = list ? list.scrollTop : 0;
    renderShop(this.win, me.shop, this.send, me, this.qty, {
      sort: this.sort, trend: this.trend, flash: this.flash, moneyFlash: this.moneyFlash, flashAge: this.flash.size || this.moneyFlash ? performance.now() - this.flashAt : 0, locked: performance.now() < this.lockUntil, selected: this.selected,
      onSelect: (g) => { this.selected = g; this.win.querySelectorAll('.shop-row').forEach((r) => r.classList.toggle('sel', (r as HTMLElement).dataset.good === g)); },
      onSort: (s) => { this.sort = s; this.draw(true); },
    });
    this.win.scrollTop = y;
    const nl = this.win.querySelector('.shop-list');
    if (nl) nl.scrollTop = ly;
  }
}
