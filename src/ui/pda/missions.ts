// PROPRIÉTAIRE : game-missions
// Onglet « Missions » du PDA : liste des 5 missions, état (verrouillée / disponible / en cours / terminée), médailles, seuils, boutons Lancer / Rejouer / Abandonner.
// Tout texte passe par `textContent`. Aucune logique de jeu : le serveur décide (distance du donneur, déblocage, reprise).
// Branchements (main.ts) : rien de requis (l'onglet s'enregistre au chargement du module) ; `noteMissionEvent(ev)` (via stats.ts `noteGameEvent`)
// permet d'afficher « Rejouer » après un échec. Les planches BD des missions sont enregistrées ici au chargement.
import { DISTRICTS } from '../../../shared/city/districts';
import { getCity } from '../../../shared/city/layout';
import { MISSIONS } from '../../../shared/missions';
import { medalRank, MEDAL_MULT } from '../../../shared/missions/medals';
import { MISSION_VIGNETTES } from '../../../shared/missions/vignettes';
import type { GameServerEvent, PrivateState } from '../../../shared/protocol';
import { registerVignettes } from '../comic';
import { registerTab, type PanelRenderer } from '../pda';

for (const [id, panels] of Object.entries(MISSION_VIGNETTES)) registerVignettes(id, panels);

const MEDAL_LABEL = { bronze: 'Bronze', argent: 'Argent', or: 'Or' } as const;
const MEDAL_COLOR = { bronze: '#cd7f32', argent: '#c0c0c8', or: '#ffd23f' } as const;

/** Dernier échec connu (rejouable) : renseigné par noteMissionEvent. */
let failedId: string | null = null;
export function noteMissionEvent(ev: GameServerEvent): void {
  if (ev.k !== 'mission') return;
  if (ev.ev === 'fail') failedId = ev.id;
  else if (ev.ev === 'start' || ev.ev === 'done') { if (failedId === ev.id) failedId = null; }
}

const fmtMs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const render: PanelRenderer = (root, me: PrivateState, ctx) => {
  root.textContent = '';
  root.appendChild(el('h2', 'pda-h', 'Missions'));
  const active = me.mission?.id ?? null;
  if (me.mission) {
    const card = el('div', 'pda-card hot');
    card.appendChild(el('div', undefined, `En cours : étape ${me.mission.step}/${me.mission.steps} · ${me.mission.text}`));
    const left = me.mission.timeLimitMs ? ` · reste ${fmtMs(Math.max(0, me.mission.timeLimitMs - me.mission.ms))}` : '';
    card.appendChild(el('div', 'pda-muted', `Chrono ${fmtMs(me.mission.ms)}${left}`));
    root.appendChild(card);
  }
  const pos = ctx.player?.() ?? null;
  const city = getCity();
  for (const def of MISSIONS) {
    const medal = me.medals[def.id];
    const locked = !!def.requires && medalRank(me.medals[def.requires]) === 0;
    const isActive = active === def.id;
    const card = el('div', isActive ? 'pda-card hot' : 'pda-card');
    const head = el('div', 'pda-row');
    head.appendChild(el('span', 'pda-tag', DISTRICTS[def.district].name));
    const title = el('b', undefined, def.name);
    head.appendChild(title);
    const grow = el('span');
    grow.style.flex = '1';
    head.appendChild(grow);
    if (medal) {
      const m = el('span', 'pda-tag', MEDAL_LABEL[medal]);
      m.style.background = MEDAL_COLOR[medal];
      head.appendChild(m);
    }
    card.appendChild(head);
    card.appendChild(el('div', 'pda-muted', def.blurb ?? ''));
    const gold = def.medals.or;
    card.appendChild(el('div', 'pda-muted', `${def.steps.length} étapes · ${def.reward} € (×${MEDAL_MULT.or} en or) · Or : moins de ${fmtMs(gold.ms)}, ${gold.maxDamage} dégâts max, ${Math.round(gold.minAccuracy * 100)} % de précision${def.timeLimitMs ? ` · limite ${fmtMs(def.timeLimitMs)}` : ''}`));

    const giver = city.pois.find((p) => p.id === def.giver);
    const dist = pos && giver ? Math.round(Math.hypot(giver.x - pos.x, giver.z - pos.z)) : null;
    const row = el('div', 'pda-row');
    row.style.marginTop = '6px';
    if (isActive) {
      const b = el('button', 'pda-btn', 'Abandonner');
      b.type = 'button';
      b.style.background = '#e63946';
      b.addEventListener('click', () => ctx.send({ k: 'mission', op: 'abort', id: def.id }));
      row.appendChild(b);
    } else if (locked) {
      row.appendChild(el('span', 'pda-muted', `Verrouillée : termine « ${MISSIONS.find((m) => m.id === def.requires)?.name ?? '?'} »`));
    } else {
      const b = el('button', 'pda-btn', medal ? 'Rejouer' : 'Lancer');
      b.type = 'button';
      b.disabled = !!active;
      b.addEventListener('click', () => ctx.send({ k: 'mission', op: 'start', id: def.id }));
      row.appendChild(b);
      if (failedId === def.id && !active) {
        const r = el('button', 'pda-btn', 'Reprendre au checkpoint');
        r.type = 'button';
        r.style.background = '#2a9d4a';
        r.addEventListener('click', () => ctx.send({ k: 'mission', op: 'retry', id: def.id }));
        row.appendChild(r);
      }
      row.appendChild(el('span', 'pda-muted', dist === null ? 'Va voir le donneur (repère sur la carte).' : dist <= 45 ? 'Le donneur est là.' : `Donneur à ${dist} m (repère sur la carte).`));
    }
    card.appendChild(row);
    root.appendChild(card);
  }
};

registerTab('missions', render, 'Missions');
