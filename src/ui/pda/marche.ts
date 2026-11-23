// PROPRIÉTAIRE : game-economy
// Onglet « Marché » du PDA : prix connus par quartier et marchandise, tuyaux actifs (reçus par SMS), sac et planque.
// Le client n'invente aucun prix : il mémorise ceux que le serveur lui a montrés chez un dealer (`me.shop`) et les tuyaux reçus par SMS.
//
// API pour main.ts (toutes facultatives : l'onglet est enregistré par l'import de ce module, que src/ui/pda.ts ou main.ts doit faire une fois) :
//   import { installMarcheTab, notePrices, resetMarket } from './ui/pda/marche';
//     importer le module enregistre déjà l'onglet 'marche' (registerTab) ; `installMarcheTab()` le refait explicitement (utile en cas d'import circulaire)
//   notePrices(me, simTimeMs)  : à appeler à chaque message `me` (net.onMe) pour retenir les prix du dealer proche, même PDA fermé
//   pushSms(...)               : (src/ui/pda/sms.ts) les tuyaux sont lus automatiquement via onSms ; rien à faire de plus
//   resetMarket()              : oublie prix et tuyaux (changement de partie / reconnexion)
// Tout texte passe par `textContent`.
import { DISTRICT_IDS, GOOD_IDS, type DistrictId, type GoodId } from '../../../shared/ids';
import { DISTRICTS } from '../../../shared/city/districts';
import { GOODS } from '../../../shared/economy/goods';
import { STASH_CAP } from '../../../shared/economy/trade';
import type { PrivateState, Sms } from '../../../shared/protocol';
import { registerTab, type PanelRenderer } from '../pda';
import { onSms } from './sms';

interface Seen { buy: number; sell: number; at: number }
const seen = new Map<string, Seen>(); // `${district}:${good}`
const tips = new Map<string, NonNullable<Sms['tip']>>(); // `${district}:${good}` -> tuyau le plus récent
const key = (d: string, g: string) => `${d}:${g}`;

/** Retient les prix du dealer proche (appeler à chaque message `me`). */
export function notePrices(me: PrivateState, now: number): void {
  const s = me.shop;
  if (!s) return;
  for (const g of s.goods) if (Number.isFinite(g.buy) && Number.isFinite(g.sell)) seen.set(key(s.district, g.good), { buy: g.buy, sell: g.sell, at: now });
}

/** Oublie tout (nouvelle partie). */
export function resetMarket(): void {
  seen.clear();
  tips.clear();
}

onSms((sms) => {
  const t = sms.tip;
  if (t && GOOD_IDS.includes(t.good) && DISTRICT_IDS.includes(t.district)) tips.set(key(t.district, t.good), t);
});

const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const bagVolume = (b: Partial<Record<string, number>>) => Object.entries(b).reduce((v, [g, q]) => v + (GOODS[g as GoodId]?.weight ?? 0) * (q ?? 0), 0);

export const render: PanelRenderer = (root, me, ctx) => {
  root.textContent = '';
  const now = ctx.now();
  notePrices(me, now);

  // ---- Tuyaux actifs ----
  root.appendChild(el('h3', 'pda-h', 'Tuyaux actifs'));
  const active = [...tips.values()].filter((t) => t.until > now).sort((a, b) => a.until - b.until);
  if (!active.length) root.appendChild(el('div', 'pda-card pda-muted', 'Aucun tuyau pour le moment. Les SMS des informateurs annoncent les pénuries et les surplus.'));
  for (const t of active) {
    const card = el('div', 'pda-card hot');
    const pct = Math.round((t.mult - 1) * 100);
    const row = el('div', 'pda-row');
    row.append(el('span', 'pda-tag', t.mult >= 1 ? 'Pénurie' : 'Surplus'),
      el('b', undefined, `${GOODS[t.good]?.emoji ?? ''} ${GOODS[t.good]?.name ?? t.good}`),
      el('span', undefined, `à ${DISTRICTS[t.district]?.name ?? t.district}`));
    const right = el('span', 'pda-muted', `prix ${pct >= 0 ? '+' : ''}${pct} % · encore ${fmtLeft(t.until - now)}`);
    right.style.marginLeft = 'auto';
    row.appendChild(right);
    card.appendChild(row);
    root.appendChild(card);
  }

  // ---- Tableau quartiers × marchandises ----
  root.appendChild(el('h3', 'pda-h', 'Prix connus'));
  const card = el('div', 'pda-card');
  card.style.overflowX = 'auto';
  const table = el('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;font-size:12px;font-weight:800;text-align:center';
  const thead = el('tr');
  thead.appendChild(el('th'));
  for (const g of GOOD_IDS) {
    const th = el('th', undefined, GOODS[g].emoji);
    th.title = `${GOODS[g].name} (base ${GOODS[g].base} €)`;
    th.style.cssText = 'padding:2px 4px;font-size:16px';
    thead.appendChild(th);
  }
  table.appendChild(thead);
  for (const d of DISTRICT_IDS as readonly DistrictId[]) {
    const tr = el('tr');
    const name = el('td', undefined, DISTRICTS[d]?.name ?? d);
    name.style.cssText = 'text-align:left;padding:3px 6px 3px 0;white-space:nowrap;font-size:13px';
    if (d === me.district) name.style.textDecoration = 'underline';
    tr.appendChild(name);
    for (const g of GOOD_IDS) {
      const td = el('td');
      td.style.cssText = 'padding:3px 4px;border:2px solid #000';
      const s = seen.get(key(d, g));
      const tip = tips.get(key(d, g));
      const tipOn = !!tip && tip.until > now;
      if (s) {
        td.textContent = String(s.buy);
        const ratio = s.buy / GOODS[g].base;
        td.style.background = ratio < 0.9 ? '#b2f2bb' : ratio > 1.3 ? '#ffc9c9' : '#fff';
        td.title = `Achat ${s.buy} € · revente ${s.sell} € · vu il y a ${Math.max(0, Math.round((now - s.at) / 1000))} s`;
      } else {
        td.textContent = '?';
        td.style.background = '#e9e4d0';
        td.style.color = '#8a8da8';
      }
      if (tipOn) {
        td.style.outline = '3px solid #e63946';
        td.title += (td.title ? ' · ' : '') + (tip!.mult >= 1 ? 'pénurie annoncée' : 'surplus annoncé');
        if (!s) td.textContent = tip!.mult >= 1 ? '▲' : '▼';
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  card.appendChild(table);
  card.appendChild(el('div', 'pda-muted', 'Prix d\'achat vus chez les dealers (vert : bon marché, rouge : cher, ? : jamais vu). Contour rouge : tuyau actif.'));
  root.appendChild(card);

  // ---- Sac ----
  root.appendChild(el('h3', 'pda-h', `Sac (${bagVolume(me.bag)}/${me.bagCap})`));
  const bagCard = el('div', 'pda-card');
  const bagItems = GOOD_IDS.filter((g) => (me.bag[g] ?? 0) > 0);
  if (!bagItems.length) bagCard.classList.add('pda-muted');
  bagCard.appendChild(el('div', undefined, bagItems.length ? bagItems.map((g) => `${GOODS[g].emoji} ${GOODS[g].name} ×${me.bag[g]}`).join('  ·  ') : 'Le sac est vide.'));
  root.appendChild(bagCard);

  // ---- Planque ----
  root.appendChild(el('h3', 'pda-h', 'Planque'));
  const st = me.stash;
  const stCard = el('div', 'pda-card');
  if (!st) {
    stCard.classList.add('pda-muted');
    stCard.textContent = 'Aucune planque à portée. Approche-toi d\'une planque de la ville pour déposer ou reprendre de la marchandise.';
  } else {
    const used = bagVolume(st);
    stCard.appendChild(el('div', 'pda-muted', `Contenu de ta planque : ${used}/${STASH_CAP} de volume.`));
    const grid = el('div', 'pda-grid');
    for (const g of GOOD_IDS) {
      const inStash = st[g] ?? 0, inBag = me.bag[g] ?? 0;
      if (!inStash && !inBag) continue;
      const c = el('div', 'pda-card');
      c.appendChild(el('b', undefined, `${GOODS[g].emoji} ${GOODS[g].name}`));
      c.appendChild(el('div', 'pda-muted', `Sac ${inBag} · Planque ${inStash}`));
      const r = el('div', 'pda-row');
      const mk = (label: string, op: 'put' | 'take', qty: number, ok: boolean) => {
        const b = el('button', 'pda-btn', label);
        b.type = 'button';
        b.disabled = !ok;
        b.addEventListener('click', (e) => { e.stopPropagation(); ctx.send({ k: 'stash', op, good: g, qty }); });
        return b;
      };
      r.append(mk('Déposer 1', 'put', 1, inBag >= 1), mk('Tout', 'put', Math.max(1, inBag), inBag >= 1),
        mk('Reprendre 1', 'take', 1, inStash >= 1), mk('Tout', 'take', Math.max(1, inStash), inStash >= 1));
      r.style.flexWrap = 'wrap';
      c.appendChild(r);
      grid.appendChild(c);
    }
    if (!grid.childElementCount) stCard.appendChild(el('div', 'pda-muted', 'Rien dans le sac ni dans la planque.'));
    else stCard.appendChild(grid);
  }
  root.appendChild(stCard);
};

/** Enregistre l'onglet « Marché » dans le PDA (idempotent). Appelé automatiquement à l'import ; à rappeler explicitement si le module est importé par pda.ts (cycle). */
export function installMarcheTab(): void { registerTab('marche', render, 'Marché'); }
try { installMarcheTab(); } catch { /* import circulaire : l'appelant utilisera installMarcheTab() */ }
