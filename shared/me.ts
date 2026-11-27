// Format compact du message `me` (état privé du joueur). Budget : < 800 octets dans le pire cas (boutique ouverte, sac plein, médailles,
// mission, activité), contre ~1 Ko en JSON « lisible ». Le serveur appelle packMe, le client unpackMe (qui revalide TOUT : le client ne
// fait pas confiance au fil, un message `me` bricolé ne doit jamais faire tomber l'interface).
import { DISTRICT_IDS, GANG_IDS, GOOD_IDS, MEDAL_TIERS, isIn, type GoodId, type MedalTier } from './ids';
import type { Mark, PrivateState, ShopView } from './protocol';

export const MARK_KINDS: Mark['k'][] = ['mission', 'dealer', 'planque', 'camera', 'donneur', 'hopital', 'commissariat', 'cible', 'danger', 'autre'];
const ACTIVITY_KINDS = ['taxi', 'ambulance', 'pompier', 'justicier'] as const;
const MAX_MARKS = 16; // plafond à la lecture
const WIRE_MARKS = 12; // plafond à l'envoi (budget 800 octets)
const BAD = new Set(['__proto__', 'constructor', 'prototype']);

type Bag = Partial<Record<GoodId, number>>;

/** Forme sur le fil (clés courtes, tableaux plats). */
export interface WireMe {
  m: number; // argent
  b: number[]; // sac : [index de marchandise, quantité, …]
  c: number; // capacité du sac
  s: number; // étoiles
  p: number; // progression
  d: number; // index du quartier
  mk: (number | string)[][]; // repères : [x, z, index de type, libellé?]
  md: Record<string, number>; // médailles : id de mission -> index de médaille
  u: number; // SMS non lus
  w?: number[]; // recherche : [état, secondes avant l'étoile perdue ?] (absent = libre)
  sh?: { id: string; d: number; g: number; l: number[] }; // boutique : id, quartier, gang, [index, achat, vente, …]
  st?: number[]; // planque : comme `b`
  ms?: [string, number, number, string, number, number?]; // mission : id, étape, étapes, texte, ms, limite
  ac?: [number, string, number]; // activité : index du type, texte, score
}

const flatBag = (bag: Bag | undefined): number[] => {
  const out: number[] = [];
  if (!bag) return out;
  GOOD_IDS.forEach((g, i) => { const q = bag[g]; if (typeof q === 'number' && q > 0) out.push(i, q); });
  return out;
};

export function packMe(s: PrivateState): WireMe {
  const w: WireMe = {
    m: s.money, b: flatBag(s.bag), c: s.bagCap, s: s.stars, p: s.starProgress, d: Math.max(0, DISTRICT_IDS.indexOf(s.district)),
    mk: s.marks.slice(0, WIRE_MARKS).map((k) => (k.label ? [k.x, k.z, Math.max(0, MARK_KINDS.indexOf(k.k)), k.label] : [k.x, k.z, Math.max(0, MARK_KINDS.indexOf(k.k))])),
    md: {}, u: s.unread,
  };
  for (const id of Object.keys(s.medals)) w.md[id] = Math.max(0, MEDAL_TIERS.indexOf(s.medals[id]));
  if (s.shop) {
    const l: number[] = [];
    for (const g of s.shop.goods) l.push(GOOD_IDS.indexOf(g.good), g.buy, g.sell);
    w.sh = { id: s.shop.dealer, d: Math.max(0, DISTRICT_IDS.indexOf(s.shop.district)), g: Math.max(0, GANG_IDS.indexOf(s.shop.gang)), l };
  }
  if (s.ws) w.w = s.wl !== undefined ? [s.ws, s.wl] : [s.ws];
  if (s.stash) w.st = flatBag(s.stash);
  if (s.mission) {
    const m = s.mission;
    w.ms = m.timeLimitMs !== undefined ? [m.id, m.step, m.steps, m.text, Math.round(m.ms), Math.round(m.timeLimitMs)] : [m.id, m.step, m.steps, m.text, Math.round(m.ms)];
  }
  if (s.activity) w.ac = [Math.max(0, ACTIVITY_KINDS.indexOf(s.activity.kind)), s.activity.text, s.activity.score];
  return w;
}

const num = (v: unknown, lo: number, hi: number, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v: unknown, lo: number, hi: number, d = 0): number => Math.floor(num(v, lo, hi, d));
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

function unflatBag(v: unknown): Bag {
  const out: Bag = {};
  const a = arr(v, 40);
  for (let i = 0; i + 1 < a.length; i += 2) {
    const g = GOOD_IDS[a[i] as number];
    const q = a[i + 1];
    if (g && typeof q === 'number' && Number.isFinite(q) && q > 0) out[g] = Math.min(9999, Math.floor(q));
  }
  return out;
}

/** Relit un message `me` reçu du fil. Retourne null si ce n'est pas un objet ; tout champ invalide prend une valeur sûre. */
export function unpackMe(raw: unknown): PrivateState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const w = raw as Record<string, unknown>;
  const marks: Mark[] = [];
  for (const e of arr(w.mk, MAX_MARKS)) {
    if (!Array.isArray(e)) continue;
    const kind = MARK_KINDS[e[2] as number];
    if (typeof e[0] !== 'number' || typeof e[1] !== 'number' || !Number.isFinite(e[0]) || !Number.isFinite(e[1]) || !kind) continue;
    const m: Mark = { x: e[0], z: e[1], k: kind };
    if (typeof e[3] === 'string') m.label = e[3].slice(0, 24);
    marks.push(m);
  }
  const medals: Record<string, MedalTier> = {};
  if (w.md && typeof w.md === 'object' && !Array.isArray(w.md)) {
    let n = 0;
    for (const id of Object.keys(w.md)) {
      const t = MEDAL_TIERS[(w.md as Record<string, unknown>)[id] as number];
      if (BAD.has(id) || id.length > 48 || !isIn(MEDAL_TIERS, t) || n++ >= 32) continue;
      medals[id] = t;
    }
  }
  const out: PrivateState = {
    money: int(w.m, 0, 1e9), bag: unflatBag(w.b), bagCap: int(w.c, 1, 999, 14), stars: int(w.s, 0, 5), starProgress: num(w.p, 0, 1),
    district: DISTRICT_IDS[w.d as number] ?? DISTRICT_IDS[0], marks, medals, unread: int(w.u, 0, 9999),
  };
  const search = arr(w.w, 2);
  out.ws = int(search[0], 0, 3);
  if (search.length > 1) out.wl = int(search[1], 0, 999);
  const sh = w.sh;
  if (sh && typeof sh === 'object' && !Array.isArray(sh)) {
    const o = sh as Record<string, unknown>;
    const goods: ShopView['goods'] = [];
    const l = arr(o.l, 3 * GOOD_IDS.length);
    for (let i = 0; i + 2 < l.length; i += 3) {
      const g = GOOD_IDS[l[i] as number];
      if (g) goods.push({ good: g, buy: int(l[i + 1], 0, 1e9), sell: int(l[i + 2], 0, 1e9) });
    }
    out.shop = { dealer: str(o.id, 48), district: DISTRICT_IDS[o.d as number] ?? DISTRICT_IDS[0], gang: GANG_IDS[o.g as number] ?? GANG_IDS[0], goods };
  }
  if (Array.isArray(w.st)) out.stash = unflatBag(w.st);
  if (Array.isArray(w.ms)) {
    const a = w.ms;
    out.mission = { id: str(a[0], 48), step: int(a[1], 0, 99), steps: int(a[2], 0, 99), text: str(a[3], 80), ms: int(a[4], 0, 1e9) };
    if (a[5] !== undefined) out.mission.timeLimitMs = int(a[5], 0, 1e9);
  }
  if (Array.isArray(w.ac)) {
    const kind = ACTIVITY_KINDS[w.ac[0] as number];
    if (kind) out.activity = { kind, text: str(w.ac[1], 80), score: int(w.ac[2], 0, 1e9) };
  }
  return out;
}
