// Onglet « SMS » du PDA (PROPRIÉTAIRE : art-toon) : messages reçus et « tuyaux » (événements de prix annoncés par SMS).
// Branchement : dans `net.onGame`, `if (e.k === 'sms') pushSms(e.sms)` ; `onSms(cb)` prévient (toast, son). Le compteur de non lus du badge vient de `me.unread`.
// Ouvrir l'onglet marque les messages comme lus (message `sms_lu` envoyé au serveur, une fois par SMS). Tout texte passe par `textContent`.
import { DISTRICTS } from '../../../shared/city/districts';
import { GOODS } from '../../../shared/economy/goods';
import type { Sms } from '../../../shared/protocol';
import type { PanelRenderer } from '../pda';

interface Item { sms: Sms; read: boolean; readAt: number }
const MAX = 60;
const items: Item[] = [];
const listeners = new Set<(s: Sms) => void>();

/** Ajoute un SMS reçu (événement serveur `sms`). Les doublons (même id) sont ignorés. */
export function pushSms(sms: Sms): void {
  if (!sms || typeof sms.text !== 'string' || items.some((i) => i.sms.id === sms.id)) return;
  items.unshift({ sms: { id: sms.id, from: String(sms.from ?? '').slice(0, 40), text: sms.text.slice(0, 400), at: sms.at, tip: sms.tip }, read: false, readAt: 0 });
  if (items.length > MAX) items.length = MAX;
  for (const cb of listeners) cb(sms);
}
/** Écoute les nouveaux SMS ; renvoie la fonction de désinscription. */
export function onSms(cb: (s: Sms) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const smsCount = () => items.length;
export const smsUnreadLocal = () => items.filter((i) => !i.read).length;
export function clearSms(): void { items.length = 0; }

const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtAgo = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : `il y a ${Math.floor(s / 3600)} h`;
};

export const render: PanelRenderer = (root, _me, ctx) => {
  root.textContent = '';
  const h = document.createElement('h3');
  h.className = 'pda-h';
  h.textContent = 'Messages';
  root.appendChild(h);
  // Un message lu à l'instant reste marqué « nouveau » 20 s
  const t0 = performance.now();
  for (const it of items) if (!it.read) { it.read = true; it.readAt = t0; ctx.send({ k: 'sms_lu', id: it.sms.id }); }
  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'pda-card pda-muted';
    e.textContent = "Aucun message. Les bons plans arrivent ici : reste à l'écoute.";
    root.appendChild(e);
    return;
  }
  const now = ctx.now();
  for (const it of items) {
    const s = it.sms;
    const card = document.createElement('div');
    card.className = 'pda-card' + (s.tip ? ' hot' : '');
    const head = document.createElement('div');
    head.className = 'pda-row';
    const from = document.createElement('b');
    from.textContent = s.from || 'Inconnu';
    head.appendChild(from);
    if (it.readAt && t0 - it.readAt < 20000) {
      const nw = document.createElement('span');
      nw.className = 'pda-tag';
      nw.style.background = '#e63946';
      nw.style.color = '#fff';
      nw.textContent = 'Nouveau';
      head.appendChild(nw);
    }
    if (s.tip) {
      const tag = document.createElement('span');
      tag.className = 'pda-tag';
      tag.textContent = 'Tuyau';
      head.appendChild(tag);
    }
    const when = document.createElement('span');
    when.className = 'pda-muted';
    when.style.marginLeft = 'auto';
    when.textContent = now >= s.at ? fmtAgo(now - s.at) : '';
    head.appendChild(when);
    card.appendChild(head);
    const body = document.createElement('div');
    body.style.margin = '6px 0 0';
    body.textContent = s.text;
    card.appendChild(body);
    if (s.tip) {
      const t = s.tip;
      const left = t.until - now;
      const line = document.createElement('div');
      line.className = 'pda-muted';
      line.style.marginTop = '6px';
      const good = GOODS[t.good]?.name ?? t.good;
      const where = DISTRICTS[t.district]?.name ?? t.district;
      const pct = Math.round((t.mult - 1) * 100);
      line.textContent = `${good} à ${where} : prix ${pct >= 0 ? '+' : ''}${pct} %` + (left > 0 ? ` · encore ${fmtLeft(left)}` : ' · terminé');
      if (left <= 0) card.style.opacity = '0.6';
      card.appendChild(line);
    }
    root.appendChild(card);
  }
};
