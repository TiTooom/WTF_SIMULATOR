// PROPRIÉTAIRE : game-economy
// Prix du marché : logique PURE (ni Rapier, ni réseau, ni Math.random : l'aléa vient d'un `rnd: () => number` fourni, graine -> déterministe).
//
//   P(p,q,t) = Pbase(p) × Mterritoire(p,q) × Mévénement(p,q,t) × (1 + 0,3 × Rq) × ε     (DA.md)
//
// Territoire : 0,5-0,7 si le gang local produit p, 1,4-1,8 s'il en demande, 1,0 sinon (gangs.ts).
// Événement : pénurie x2,5-3,5 (70 %), surplus x0,35 (30 %), normal x1,0 ; durée 90-180 s, démarre `EVENT_LEAD_MS` après le tuyau.
// Rq : pression policière du quartier, [0,1]. ε ∈ [0,92 ; 1,08] recalculé tous les `NOISE_PERIOD_MS`.
// Prix entier ≥ 1, plafonné à `Pbase × MAX_PRICE_FACTOR`.
//
// Argent : INDIVIDUEL par joueur (docs/ARCHITECTURE-GTA.md §0). Le marché (prix) est, lui, commun à tous les joueurs.
//
// ===== CONTRAT POUR LA VAGUE 3 (server/systems/economy.ts) =====
// Le système serveur possède UN `MarketState` (créé par `newMarketState()` à la création de la partie, ou `parseMarket(save.market)` au chargement).
//  - Chaque tick (ou chaque seconde) : `advanceMarket(state, ctx.time, rnd)` (expire les événements, recalcule ε), puis
//    `const sms = rollTip(state, ctx.time, rnd)`. rollTip s'auto-planifie (renvoie null presque tout le temps) ; quand un événement naît
//    il est DÉJÀ enregistré dans `state.events`. Si `sms` n'est pas null, le serveur lui ajoute `id` (par joueur) et `at` et l'envoie
//    à chaque joueur (event `{ k: 'sms', sms }`) ; la probabilité d'envoi tient déjà compte des caméras du quartier.
//    `rnd` : un générateur seedé (`makeRng(seed)`) ; ne pas utiliser Math.random si l'on veut des parties rejouables.
//  - Caméras : à l'init, `setCameras(state, district, intactes, total)` pour chaque quartier ; à chaque destruction (CrimeKind
//    'camera_detruite') : `setCameras(state, d, intactes - 1, total)`. Pression policière : `state.police[d]` (initiale : BASE_POLICE),
//    le serveur peut la moduler ([0,1]) ; elle entre dans le prix.
//  - Achat/revente (`bus.on('trade')` n'est émis par le serveur qu'APRÈS validation) : le serveur calcule le prix avec
//    `quote(good, district, state, ctx.time)` (buy = ce que PAIE le joueur, sell = ce qu'il REÇOIT, par unité), débite/crédite, met à jour
//    le sac (volume = GOODS[good].weight × qty ≤ bagCap), puis appelle `applyTrade(state, good, district, side, qty)` (impact sur ε).
//    Le client ne calcule jamais de prix : `ShopView.goods` se remplit avec `shopGoods(district, state, now)`.
//  - Sauvegarde : `serializeMarket(state)` -> JSON sûr (uniquement des tableaux et des nombres) ; chargement : `parseMarket(unknown)`
//    ne jette jamais et renvoie un état valide (ids inconnus ignorés, valeurs bornées).
import { DISTRICT_IDS, GOOD_IDS, isIn, type DistrictId, type GoodId } from '../ids';
import type { Sms } from '../protocol';
import { GOODS } from './goods';
import { BASE_POLICE, territoryMult } from './gangs';
import { makeTipSms } from './tips';

// ---------- Réglages d'équilibrage ----------
export const POLICE_COEF = 0.3; // α dans (1 + α·R)
export const NOISE_MIN = 0.92;
export const NOISE_MAX = 1.08;
export const NOISE_PERIOD_MS = 25_000;
export const MARGIN = 0.1; // marge de chaque côté : le joueur paie p×1,10 et reçoit p×0,90
export const MAX_PRICE_FACTOR = 10; // prix ≤ Pbase × 10
export const TRADE_IMPACT = 0.004; // variation de ε par unité échangée (achat : hausse, vente : baisse), toujours dans [0,92 ; 1,08]
export const SHORTAGE_SHARE = 0.7; // 70 % pénurie, 30 % surplus
export const SHORTAGE_MULT: [number, number] = [2.5, 3.5];
export const SURPLUS_MULT = 0.35;
export const EVENT_DURATION_MS: [number, number] = [90_000, 180_000];
export const EVENT_LEAD_MS = 15_000; // délai entre le SMS et le début de l'effet
export const ROLL_PERIOD_MS = 20_000; // une tentative d'événement toutes les ~20 s (±30 %)
export const ROLL_CHANCE = 0.6;
export const MAX_EVENTS = 5;
export const TIP_SEND_PROB = 0.85; // probabilité d'envoyer le SMS d'un événement
export const CAMS_PER_DISTRICT = 3;

export interface MarketEvent { good: GoodId; district: DistrictId; mult: number; start: number; until: number } // temps de simulation (ms) ; actif si start ≤ t < until
export interface MarketState {
  noise: Record<string, number>; // ε par `${good}:${district}`, ∈ [0.92, 1.08] (absent = 1)
  noiseAt: number; // date du dernier recalcul de ε
  events: MarketEvent[];
  camsUp: Record<DistrictId, number>; // caméras de surveillance intactes
  camsTotal: Record<DistrictId, number>; // caméras de surveillance au total
  police: Record<DistrictId, number>; // pression policière R ∈ [0, 1]
  nextRollAt: number; // prochaine tentative d'événement
}

const perDistrict = <T>(f: (d: DistrictId) => T) => Object.fromEntries(DISTRICT_IDS.map((d) => [d, f(d)])) as Record<DistrictId, T>;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function newMarketState(): MarketState {
  return {
    noise: {}, noiseAt: 0, events: [],
    camsUp: perDistrict(() => CAMS_PER_DISTRICT), camsTotal: perDistrict(() => CAMS_PER_DISTRICT),
    police: perDistrict((d) => BASE_POLICE[d]), nextRollAt: ROLL_PERIOD_MS * 0.75,
  };
}

/** Générateur pseudo-aléatoire seedé (mulberry32), uniforme dans [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nkey = (good: GoodId, district: DistrictId) => `${good}:${district}`;
export const noiseOf = (state: MarketState, good: GoodId, district: DistrictId): number => clamp(num(state.noise[nkey(good, district)], 1), NOISE_MIN, NOISE_MAX);

/** Mévénement : produit des événements actifs (start ≤ now < until) sur (good, district) ; 1,0 si aucun. */
export function eventMult(state: MarketState, good: GoodId, district: DistrictId, now: number): number {
  let m = 1;
  for (const e of state.events) if (e.good === good && e.district === district && now >= e.start && now < e.until) m *= e.mult;
  return clamp(m, SURPLUS_MULT, SHORTAGE_MULT[1]);
}

/** Prix réel (flottant) avant arrondi, déjà plafonné. */
export function rawPrice(good: GoodId, district: DistrictId, state: MarketState, now: number): number {
  const base = GOODS[good].base;
  const r = clamp(num(state.police[district], 0), 0, 1);
  const p = base * territoryMult(good, district) * eventMult(state, good, district, now) * (1 + POLICE_COEF * r) * noiseOf(state, good, district);
  return clamp(p, 1, base * MAX_PRICE_FACTOR);
}

/** Prix unitaire de référence (entier ≥ 1) d'un produit dans un quartier. */
export function unitPrice(good: GoodId, district: DistrictId, state: MarketState, now: number): number {
  return Math.max(1, Math.round(rawPrice(good, district, state, now)));
}

/**
 * Prix que paie (buy) / reçoit (sell) le joueur, par unité, entiers ≥ 1 avec buy > sell.
 * Marge de MARGIN de chaque côté : (1-m)/(1+m) = 0,818 est inférieur à l'amplitude maximale de ε (0,92..1,08 = 1,174),
 * donc aucun aller-retour achat/revente dans le MÊME quartier ne rapporte, même en exploitant le bruit (hors événement / pression policière).
 */
export function quote(good: GoodId, district: DistrictId, state: MarketState, now: number): { buy: number; sell: number } {
  const p = rawPrice(good, district, state, now);
  const sell = Math.max(1, Math.floor(p * (1 - MARGIN)));
  const buy = Math.max(sell + 1, Math.ceil(p * (1 + MARGIN)));
  return { buy, sell };
}

/** Prix d'un lot (entier). `qty` entier ≥ 0, borné par le serveur. */
export function tradeTotal(good: GoodId, district: DistrictId, state: MarketState, now: number, side: 'buy' | 'sell', qty: number): number {
  const q = quote(good, district, state, now);
  return (side === 'buy' ? q.buy : q.sell) * Math.max(0, Math.floor(qty));
}

/** Liste des prix d'un dealer (`ShopView.goods`). */
export function shopGoods(district: DistrictId, state: MarketState, now: number): { good: GoodId; buy: number; sell: number }[] {
  return GOOD_IDS.map((good) => ({ good, ...quote(good, district, state, now) }));
}

/** Impact d'un échange sur ε : acheter fait monter le prix, vendre le fait baisser (toujours borné). */
export function applyTrade(state: MarketState, good: GoodId, district: DistrictId, side: 'buy' | 'sell', qty: number): void {
  const k = nkey(good, district);
  const d = TRADE_IMPACT * clamp(Math.floor(num(qty, 0)), 0, 100) * (side === 'buy' ? 1 : -1);
  state.noise[k] = clamp(noiseOf(state, good, district) + d, NOISE_MIN, NOISE_MAX);
}

/** Avance le temps : retire les événements expirés (renvoyés) et recalcule ε si la période est écoulée. */
export function advanceMarket(state: MarketState, now: number, rnd: () => number): MarketEvent[] {
  const expired = state.events.filter((e) => e.until <= now);
  if (expired.length) state.events = state.events.filter((e) => e.until > now);
  if (now - state.noiseAt >= NOISE_PERIOD_MS || state.noiseAt > now) {
    state.noiseAt = now;
    for (const g of GOOD_IDS) for (const d of DISTRICT_IDS) state.noise[nkey(g, d)] = NOISE_MIN + (NOISE_MAX - NOISE_MIN) * rnd();
  }
  return expired;
}

/** Met à jour le compte de caméras d'un quartier. */
export function setCameras(state: MarketState, district: DistrictId, intact: number, total: number): void {
  const t = clamp(Math.floor(num(total, CAMS_PER_DISTRICT)), 0, 64);
  state.camsTotal[district] = t;
  state.camsUp[district] = clamp(Math.floor(num(intact, 0)), 0, t);
}

/** Part de caméras intactes du quartier, [0,1]. */
export function camsIntactRatio(state: MarketState, district: DistrictId): number {
  const t = state.camsTotal[district];
  return t > 0 ? clamp(state.camsUp[district] / t, 0, 1) : 0;
}

/** Probabilité d'envoyer le SMS d'un événement de ce quartier : divisée par deux si plus de 50 % des caméras sont intactes. */
export function tipSendProbability(state: MarketState, district: DistrictId): number {
  return camsIntactRatio(state, district) > 0.5 ? TIP_SEND_PROB / 2 : TIP_SEND_PROB;
}

/** Crée un événement de marché (sans SMS) et l'enregistre. Renvoie null si impossible (doublon, trop d'événements). */
export function createEvent(state: MarketState, now: number, rnd: () => number): MarketEvent | null {
  if (state.events.length >= MAX_EVENTS) return null;
  for (let tries = 0; tries < 8; tries++) {
    // tirage pondéré : les produits communs reviennent plus souvent (poids 4 - rareté)
    let total = 0;
    for (const g of GOOD_IDS) total += 4 - GOODS[g].rarity;
    let x = rnd() * total;
    let good = GOOD_IDS[GOOD_IDS.length - 1];
    for (const g of GOOD_IDS) { x -= 4 - GOODS[g].rarity; if (x < 0) { good = g; break; } }
    const district = DISTRICT_IDS[Math.min(DISTRICT_IDS.length - 1, Math.floor(rnd() * DISTRICT_IDS.length))];
    if (state.events.some((e) => e.good === good && e.district === district)) continue;
    const shortage = rnd() < SHORTAGE_SHARE;
    const mult = shortage ? SHORTAGE_MULT[0] + (SHORTAGE_MULT[1] - SHORTAGE_MULT[0]) * rnd() : SURPLUS_MULT;
    const dur = EVENT_DURATION_MS[0] + (EVENT_DURATION_MS[1] - EVENT_DURATION_MS[0]) * rnd();
    const start = now + EVENT_LEAD_MS;
    const ev: MarketEvent = { good, district, mult, start, until: start + dur };
    state.events.push(ev);
    return ev;
  }
  return null;
}

/**
 * Tente de lancer un événement (s'auto-planifie : appel possible à chaque tick). Quand un événement naît il est enregistré dans l'état,
 * et le SMS correspondant est renvoyé avec la probabilité `tipSendProbability` (sinon null : l'événement a lieu en silence).
 */
export function rollTip(state: MarketState, now: number, rnd: () => number): Omit<Sms, 'id' | 'at'> | null {
  if (now < state.nextRollAt) return null;
  state.nextRollAt = now + ROLL_PERIOD_MS * (0.7 + 0.6 * rnd());
  if (rnd() >= ROLL_CHANCE) return null;
  const ev = createEvent(state, now, rnd);
  if (!ev) return null;
  if (rnd() >= tipSendProbability(state, ev.district)) return null;
  return makeTipSms(ev, rnd);
}

// ---------- Sérialisation sûre (tableaux uniquement) ----------
export interface MarketSave {
  v: 1;
  noiseAt: number;
  nextRollAt: number;
  noise: [string, string, number][]; // [good, district, ε]
  events: [string, string, number, number, number][]; // [good, district, mult, start, until]
  cams: [string, number, number][]; // [district, intactes, total]
  police: [string, number][]; // [district, R]
}

export function serializeMarket(state: MarketState): MarketSave {
  const noise: MarketSave['noise'] = [];
  for (const g of GOOD_IDS) for (const d of DISTRICT_IDS) { const e = state.noise[nkey(g, d)]; if (e !== undefined) noise.push([g, d, e]); }
  return {
    v: 1, noiseAt: state.noiseAt, nextRollAt: state.nextRollAt, noise,
    events: state.events.map((e) => [e.good, e.district, e.mult, e.start, e.until]),
    cams: DISTRICT_IDS.map((d) => [d, state.camsUp[d], state.camsTotal[d]]),
    police: DISTRICT_IDS.map((d) => [d, state.police[d]]),
  };
}

/** Relit une sauvegarde non fiable. Ne jette jamais : valeurs inconnues ignorées, nombres bornés. */
export function parseMarket(raw: unknown): MarketState {
  const s = newMarketState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  s.noiseAt = num(r.noiseAt, 0);
  s.nextRollAt = num(r.nextRollAt, s.nextRollAt);
  const arr = (v: unknown, max: number): unknown[][] => (Array.isArray(v) ? v.slice(0, max).filter((x): x is unknown[] => Array.isArray(x)) : []);
  for (const [g, d, e] of arr(r.noise, 100)) if (isIn(GOOD_IDS, g) && isIn(DISTRICT_IDS, d)) s.noise[nkey(g, d)] = clamp(num(e, 1), NOISE_MIN, NOISE_MAX);
  for (const [g, d, m, a, b] of arr(r.events, MAX_EVENTS)) {
    if (isIn(GOOD_IDS, g) && isIn(DISTRICT_IDS, d)) {
      s.events.push({ good: g, district: d, mult: clamp(num(m, 1), SURPLUS_MULT, SHORTAGE_MULT[1]), start: num(a, 0), until: num(b, 0) });
    }
  }
  for (const [d, up, total] of arr(r.cams, 20)) if (isIn(DISTRICT_IDS, d)) setCameras(s, d, num(up, CAMS_PER_DISTRICT), num(total, CAMS_PER_DISTRICT));
  for (const [d, v] of arr(r.police, 20)) if (isIn(DISTRICT_IDS, d)) s.police[d] = clamp(num(v, BASE_POLICE[d]), 0, 1);
  return s;
}
