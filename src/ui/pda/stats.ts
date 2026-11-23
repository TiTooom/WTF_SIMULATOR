// PROPRIÉTAIRE : game-missions
// Onglet « Stats » du PDA : argent, étoiles (actuelles et max), médailles, missions terminées, temps de jeu, arrestations, K.O.
// Tout texte passe par `textContent`. Les compteurs viennent de `me` (PrivateState) et des événements de jeu ; ils sont mémorisés dans localStorage
// (navigateur ou app) sous une clé propre, jamais envoyés ni crus par le serveur : simple confort d'affichage.
// Branchements (main.ts) : `net.onGame = (ev) => noteGameEvent(ev)` (arrestations, morts, missions) et `net.onMe = (s) => { pda.setState(s); noteMe(s); }`
// (étoiles max). Sans ces appels l'onglet fonctionne avec ce qu'il voit à l'ouverture (money, médailles, étoiles, temps de jeu).
import { MEDAL_TIERS } from '../../../shared/ids';
import { MISSIONS } from '../../../shared/missions';
import type { GameServerEvent, PrivateState } from '../../../shared/protocol';
import { registerTab, type PanelRenderer } from '../pda';
import { noteMissionEvent } from './missions';

interface Counters { playMs: number; maxStars: number; arrests: number; deaths: number; done: number; fails: number; maxMoney: number }
const KEY = 'gta_unilasalle_stats';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 1e12) : 0);

function load(): Counters {
  const base: Counters = { playMs: 0, maxStars: 0, arrests: 0, deaths: 0, done: 0, fails: 0, maxMoney: 0 };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (o && typeof o === 'object') for (const k of Object.keys(base) as (keyof Counters)[]) base[k] = num(o[k]);
  } catch { /* stockage indisponible : compteurs de la session seulement */ }
  return base;
}
const c: Counters = load();
let dirty = false;
const save = () => {
  if (!dirty) return;
  dirty = false;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignoré */ }
};
if (typeof setInterval === 'function') {
  setInterval(() => { c.playMs += 1000; dirty = true; save(); }, 1000);
}

/** À appeler pour chaque événement de jeu reçu (arrêté, mort, mission). Transmet aussi à l'onglet Missions. */
export function noteGameEvent(ev: GameServerEvent): void {
  noteMissionEvent(ev);
  if (ev.k === 'arrete') c.arrests++;
  else if (ev.k === 'mort') c.deaths++;
  else if (ev.k === 'mission' && ev.ev === 'done') c.done++;
  else if (ev.k === 'mission' && ev.ev === 'fail') c.fails++;
  else return;
  dirty = true;
  save();
}

/** À appeler pour chaque état privé reçu : retient les maxima. */
export function noteMe(me: PrivateState): void {
  if (me.stars > c.maxStars) { c.maxStars = me.stars; dirty = true; }
  if (me.money > c.maxMoney) { c.maxMoney = me.money; dirty = true; }
}

const fmtTime = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min ${String(Math.floor(ms / 1000) % 60).padStart(2, '0')} s`;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const render: PanelRenderer = (root, me) => {
  noteMe(me);
  root.textContent = '';
  root.appendChild(el('h2', 'pda-h', 'Statistiques'));
  const medals = Object.values(me.medals);
  const count = (t: string) => medals.filter((m) => m === t).length;
  const lines: [string, string][] = [
    ['Temps de jeu', fmtTime(c.playMs)],
    ['Argent', `${Math.round(me.money).toLocaleString('fr-FR')} € (record ${Math.round(c.maxMoney).toLocaleString('fr-FR')} €)`],
    ['Étoiles', `${me.stars} (max ${c.maxStars})`],
    ['Missions terminées', `${medals.length} / ${MISSIONS.length}`],
    ['Médailles', MEDAL_TIERS.map((t) => `${count(t)} ${t}`).join(' · ')],
    ['Missions réussies / ratées', `${c.done} / ${c.fails}`],
    ['Arrestations', String(c.arrests)],
    ['K.O.', String(c.deaths)],
  ];
  const card = el('div', 'pda-card');
  for (const [k, v] of lines) {
    const row = el('div', 'pda-row');
    const a = el('b', undefined, k);
    a.style.minWidth = '210px';
    row.append(a, el('span', undefined, v));
    card.appendChild(row);
  }
  root.appendChild(card);
  if (me.mission) {
    const m = el('div', 'pda-card hot');
    m.textContent = `Mission en cours : étape ${me.mission.step}/${me.mission.steps} — ${me.mission.text}`;
    root.appendChild(m);
  }
  if (me.activity) {
    const a = el('div', 'pda-card hot');
    a.textContent = `Activité : ${me.activity.kind} — ${me.activity.text} (${me.activity.score} €)`;
    root.appendChild(a);
  }
};

registerTab('stats', render, 'Stats');
