// Onglet « Carte » du PDA (PROPRIÉTAIRE : art-toon) : plan de la ville, quartiers colorés (nom + gang), repères `PrivateState.marks`, joueur et coéquipiers.
// Exporte aussi `cityMapCanvas` / `worldToMap` (fond de carte partagé avec la mini-carte du HUD).
import { DISTRICTS } from '../../../shared/city/districts';
import { CITY, getCity } from '../../../shared/city/layout';
import { DISTRICT_IDS } from '../../../shared/ids';
import type { Mark, PrivateState } from '../../../shared/protocol';
import type { PanelRenderer, PdaCtx } from '../pda';

const { HALF, CELL, ROAD, SIDEWALK, LOT, BORDER } = CITY;
/** Demi-largeur du monde représenté (m) : la ville + le quai. */
export const MAP_EXTENT = BORDER + 8;

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const shade = (c: number, k: number) => {
  const r = Math.round(((c >> 16) & 255) * k), g = Math.round(((c >> 8) & 255) * k), b = Math.round((c & 255) * k);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
};
const mixCss = (c: number, w: number) => {
  const m = (v: number) => Math.round(v + (255 - v) * w);
  return `rgb(${m((c >> 16) & 255)},${m((c >> 8) & 255)},${m(c & 255)})`;
};

/** Monde -> pixels du fond de carte (côté `px`). */
export const worldToMap = (v: number, px: number) => ((v + MAP_EXTENT) / (2 * MAP_EXTENT)) * px;

const baseCache = new Map<number, HTMLCanvasElement>();
/** Fond de carte (eau, île, rues, îlots colorés par quartier, bâtiments, noms de quartiers), dessiné une fois par taille. */
export function cityMapCanvas(px: number, labels = true): HTMLCanvasElement {
  const key = px * 2 + (labels ? 1 : 0);
  const hit = baseCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const W = (v: number) => (v / (2 * MAP_EXTENT)) * px; // longueur monde -> px
  const X = (v: number) => worldToMap(v, px);
  const city = getCity();
  g.fillStyle = '#2a8fe0';
  g.fillRect(0, 0, px, px);
  g.fillStyle = '#9bd37a';
  g.strokeStyle = '#14141f';
  g.lineWidth = Math.max(2, px / 220);
  g.fillRect(X(-BORDER - 3), X(-BORDER - 3), W(2 * (BORDER + 3)), W(2 * (BORDER + 3)));
  g.strokeRect(X(-BORDER - 3), X(-BORDER - 3), W(2 * (BORDER + 3)), W(2 * (BORDER + 3)));
  // rues
  g.fillStyle = '#585b70';
  for (let k = 0; k <= CITY.N; k++) {
    const v = -HALF + CELL * k;
    g.fillRect(X(-HALF - ROAD / 2), X(v - ROAD / 2), W(2 * HALF + ROAD), W(ROAD));
    g.fillRect(X(v - ROAD / 2), X(-HALF - ROAD / 2), W(ROAD), W(2 * HALF + ROAD));
  }
  g.strokeStyle = '#14141f';
  g.lineWidth = Math.max(1, px / 500);
  for (const b of city.blocks) {
    const d = DISTRICTS[b.district];
    g.fillStyle = '#d8d3c2';
    g.fillRect(X(b.x - LOT / 2 - SIDEWALK), X(b.z - LOT / 2 - SIDEWALK), W(LOT + 2 * SIDEWALK), W(LOT + 2 * SIDEWALK));
    g.fillStyle = b.kind === 'parc' ? '#79c24a' : b.kind === 'place' ? '#eee2c6' : mixCss(d.color, 0.45);
    g.fillRect(X(b.x - LOT / 2), X(b.z - LOT / 2), W(LOT), W(LOT));
    if (b.kind === 'place') {
      g.fillStyle = '#4aa8ff';
      g.beginPath(); g.arc(X(b.x), X(b.z), W(6), 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  for (const b of city.buildings) {
    g.fillStyle = shade(DISTRICTS[b.district].color, 0.82);
    g.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), W(b.w), W(b.d));
    g.strokeRect(X(b.x - b.w / 2), X(b.z - b.d / 2), W(b.w), W(b.d));
  }
  // lieux publics connus de tous
  for (const p of city.pois) {
    if (p.kind !== 'hopital' && p.kind !== 'commissariat') continue;
    g.fillStyle = p.kind === 'hopital' ? '#ffffff' : '#2f80ed';
    g.lineWidth = Math.max(2, px / 250);
    g.beginPath(); g.arc(X(p.x), X(p.z), px / 70, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = p.kind === 'hopital' ? '#e63946' : '#ffd23f';
    g.font = `900 ${Math.round(px / 55)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(p.kind === 'hopital' ? '+' : '★', X(p.x), X(p.z) + 1);
  }
  if (labels) {
    for (const id of DISTRICT_IDS) {
      const mine = city.blocks.filter((b) => b.district === id);
      const cx = mine.reduce((a, b) => a + b.x, 0) / mine.length, cz = mine.reduce((a, b) => a + b.z, 0) / mine.length;
      const d = DISTRICTS[id];
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${Math.round(px / 28)}px "Segoe UI",sans-serif`;
      g.lineWidth = Math.max(4, px / 110);
      g.strokeStyle = '#14141f';
      g.strokeText(d.name.toUpperCase(), X(cx), X(cz));
      g.fillStyle = '#fff';
      g.fillText(d.name.toUpperCase(), X(cx), X(cz));
      g.font = `800 ${Math.round(px / 44)}px "Segoe UI",sans-serif`;
      g.lineWidth = Math.max(3, px / 160);
      g.strokeText(d.gangName, X(cx), X(cz) + px / 26);
      g.fillStyle = hex(d.color);
      g.fillText(d.gangName, X(cx), X(cz) + px / 26);
    }
  }
  baseCache.set(key, c);
  return c;
}

export const MARK_STYLE: Record<Mark['k'], { color: string; glyph: string; name: string }> = {
  mission: { color: '#ffd23f', glyph: 'M', name: 'Mission' },
  dealer: { color: '#b15cff', glyph: 'D', name: 'Dealer' },
  planque: { color: '#2ec4b6', glyph: 'P', name: 'Planque' },
  camera: { color: '#ff8fc8', glyph: 'C', name: 'Caméra' },
  donneur: { color: '#ff9f1c', glyph: '!', name: "Donneur d'ordres" },
  hopital: { color: '#ffffff', glyph: '+', name: 'Hôpital' },
  commissariat: { color: '#2f80ed', glyph: '★', name: 'Commissariat' },
  cible: { color: '#ff3b30', glyph: 'X', name: 'Cible' },
  danger: { color: '#ff3b30', glyph: '!', name: 'Danger' },
  autre: { color: '#c8c8d8', glyph: '•', name: 'Repère' },
};

function drawOverlay(g: CanvasRenderingContext2D, px: number, me: PrivateState, ctx: PdaCtx) {
  g.drawImage(cityMapCanvas(px), 0, 0);
  const X = (v: number) => worldToMap(v, px);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const r = px / 62;
  for (const m of me.marks) {
    const st = MARK_STYLE[m.k] ?? MARK_STYLE.autre;
    g.beginPath(); g.arc(X(m.x), X(m.z), r, 0, Math.PI * 2);
    g.fillStyle = st.color; g.fill();
    g.lineWidth = Math.max(2, px / 200); g.strokeStyle = '#14141f'; g.stroke();
    g.fillStyle = '#14141f'; g.font = `900 ${Math.round(r * 1.3)}px sans-serif`;
    g.fillText(st.glyph, X(m.x), X(m.z) + 1);
    if (m.label) {
      g.font = `800 ${Math.round(px / 48)}px "Segoe UI",sans-serif`;
      g.lineWidth = Math.max(3, px / 140); g.strokeStyle = '#14141f';
      g.strokeText(m.label, X(m.x), X(m.z) - r * 1.9);
      g.fillStyle = '#fff'; g.fillText(m.label, X(m.x), X(m.z) - r * 1.9);
    }
  }
  for (const mate of ctx.mates?.() ?? []) {
    g.beginPath(); g.arc(X(mate.x), X(mate.z), r * 0.9, 0, Math.PI * 2);
    g.fillStyle = '#4dabf7'; g.fill(); g.lineWidth = Math.max(2, px / 200); g.strokeStyle = '#14141f'; g.stroke();
    g.fillStyle = '#14141f'; g.font = `900 ${Math.round(r * 1.1)}px sans-serif`;
    g.fillText((mate.name[0] ?? '?').toUpperCase(), X(mate.x), X(mate.z) + 1);
  }
  const p = ctx.player?.();
  if (p) {
    g.save();
    g.translate(X(p.x), X(p.z));
    g.rotate(-p.yaw);
    g.beginPath(); g.moveTo(0, -r * 1.5); g.lineTo(r * 1.05, r * 1.1); g.lineTo(0, r * 0.5); g.lineTo(-r * 1.05, r * 1.1); g.closePath();
    g.fillStyle = '#ff3b30'; g.fill(); g.lineWidth = Math.max(2, px / 160); g.strokeStyle = '#fff'; g.stroke();
    g.lineWidth = Math.max(1.5, px / 280); g.strokeStyle = '#14141f'; g.stroke();
    g.restore();
  }
}

interface State { canvas: HTMLCanvasElement; side: HTMLDivElement; timer: number; me: PrivateState; ctx: PdaCtx }
const states = new WeakMap<HTMLElement, State>();

function fillSide(side: HTMLDivElement, me: PrivateState) {
  side.textContent = '';
  const h = document.createElement('h3');
  h.className = 'pda-h';
  h.textContent = 'Carte de la ville';
  side.appendChild(h);
  const here = document.createElement('div');
  here.className = 'pda-card hot';
  const d = DISTRICTS[me.district];
  here.textContent = d ? `Tu es : ${d.name} (${d.gangName})` : '';
  side.appendChild(here);
  const card = document.createElement('div');
  card.className = 'pda-card';
  for (const id of DISTRICT_IDS) {
    const row = document.createElement('div');
    row.className = 'pda-row';
    const sw = document.createElement('span');
    sw.style.cssText = `display:inline-block;width:16px;height:16px;border:3px solid #000;border-radius:4px;background:${hex(DISTRICTS[id].color)}`;
    const t = document.createElement('span');
    t.textContent = `${DISTRICTS[id].name} : ${DISTRICTS[id].gangName}`;
    t.style.fontWeight = '800';
    row.append(sw, t);
    card.appendChild(row);
  }
  // Légende des repères (pastilles identiques à celles de la carte)
  const leg = document.createElement('div');
  leg.className = 'pda-card';
  leg.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;font-weight:800';
  for (const k of ['mission', 'dealer', 'planque', 'camera', 'donneur', 'hopital', 'commissariat', 'cible', 'danger'] as const) {
    const st = MARK_STYLE[k];
    const item = document.createElement('span');
    item.style.cssText = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap';
    const dot = document.createElement('span');
    dot.textContent = st.glyph;
    dot.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:2px solid #14141f;border-radius:50%;background:${st.color};color:#14141f;font-size:11px;font-weight:900`;
    const nm = document.createElement('span');
    nm.textContent = st.name;
    item.append(dot, nm);
    leg.appendChild(item);
  }
  side.append(card, leg);
  const mk = document.createElement('div');
  mk.className = 'pda-card';
  if (!me.marks.length) {
    mk.textContent = 'Aucun repère pour le moment.';
    mk.classList.add('pda-muted');
  } else {
    for (const m of me.marks) {
      const st = MARK_STYLE[m.k] ?? MARK_STYLE.autre;
      const row = document.createElement('div');
      row.className = 'pda-row';
      const tag = document.createElement('span');
      tag.className = 'pda-tag';
      tag.style.background = st.color;
      tag.textContent = st.name;
      const t = document.createElement('span');
      t.textContent = m.label ?? '';
      row.append(tag, t);
      mk.appendChild(row);
    }
  }
  side.appendChild(mk);
}

export const render: PanelRenderer = (root, me, ctx) => {
  let st = states.get(root);
  if (!st || !root.contains(st.canvas)) {
    if (st) clearInterval(st.timer);
    root.textContent = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap';
    const frame = document.createElement('div');
    frame.style.cssText = 'border:5px solid #000;border-radius:10px;box-shadow:5px 5px 0 #000;background:#2a8fe0;line-height:0';
    const canvas = document.createElement('canvas');
    const px = Math.max(320, Math.min(520, Math.floor(root.clientHeight - 50) || 520));
    canvas.width = canvas.height = px;
    canvas.style.cssText = 'width:min(' + px + 'px,100%);height:auto;border-radius:5px';
    frame.appendChild(canvas);
    const side = document.createElement('div');
    side.style.cssText = 'flex:1;min-width:230px';
    wrap.append(frame, side);
    root.appendChild(wrap);
    const s: State = { canvas, side, timer: 0, me, ctx };
    s.timer = window.setInterval(() => {
      if (!s.canvas.isConnected) { clearInterval(s.timer); return; }
      drawOverlay(s.canvas.getContext('2d')!, s.canvas.width, s.me, s.ctx);
    }, 250);
    states.set(root, s);
    st = s;
  }
  st.me = me;
  st.ctx = ctx;
  fillSide(st.side, me);
  drawOverlay(st.canvas.getContext('2d')!, st.canvas.width, me, ctx);
};
