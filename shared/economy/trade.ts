// PROPRIÉTAIRE : game-economy
// Règles pures du commerce et de la planque (aucun état global, aucun Rapier) : le serveur (server/systems/economy.ts) et les tests s'en servent.
// Sacs et planques sont des Map<GoodId, number> (jamais d'objet à clés libres : pas de pollution de prototype).
import { GOOD_IDS, type GoodId } from '../ids';
import { BUST_MONEY_LOSS } from '../wanted';
import { GOODS } from './goods';

export const START_MONEY = 200; // argent de départ de chaque joueur (euros)
export const BAG_CAP = 30; // capacité du sac (somme des GOODS[..].weight × quantité)
export const STASH_CAP = 300; // capacité de la planque
export const MAX_MONEY = 1_000_000_000; // plafond d'argent (évite tout dépassement de nombre)
export const MAX_TRADE_QTY = 50; // quantité maximale par transaction
export const SHOP_RANGE = 3; // m : un dealer / une planque s'ouvre à moins de 3 m
export const TRADE_RANGE = 4; // m : tolérance du serveur pour une transaction (le joueur a pu reculer d'un pas)
export const BUST_MONEY_SHARE = BUST_MONEY_LOSS; // (0,25, shared/wanted.ts) part de l'argent perdue lors d'une arrestation (le sac est entièrement perdu)
export const CAMERA_RADIUS_EXPLOSION = 12; // m
export const CAMERA_RADIUS_VEHICLE = 10; // m
export const CAMERA_SHOT_RANGE = 45; // m
export const CAMERA_SHOT_WIDTH = 2.5; // m
export const DEAL_COP_RANGE = 35; // m : un flic voit l'échange
export const DEAL_CAM_RANGE = 25; // m : une caméra intacte voit l'échange

export type Bag = Map<GoodId, number>;

/** Entier fini dans [lo, hi] ? (refuse NaN, fractions, négatifs, chaînes). */
export const isIntIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Volume occupé (somme poids × quantité). */
export function bagVolume(bag: ReadonlyMap<GoodId, number>): number {
  let v = 0;
  for (const [g, q] of bag) v += GOODS[g].weight * q;
  return v;
}

/** Copie sérialisable `{ good: qty }` (quantités > 0, ordre de GOOD_IDS). */
export function bagToObject(bag: ReadonlyMap<GoodId, number>): Partial<Record<GoodId, number>> {
  const out: Partial<Record<GoodId, number>> = {};
  for (const g of GOOD_IDS) { const q = bag.get(g); if (q && q > 0) out[g] = q; }
  return out;
}

export function addToBag(bag: Bag, good: GoodId, qty: number): void {
  const n = (bag.get(good) ?? 0) + qty;
  if (n > 0) bag.set(good, n); else bag.delete(good);
}

export type TradeRefusal = 'quantite' | 'argent' | 'place' | 'stock' | 'prix';
export type TradeCheck = { ok: true; total: number } | { ok: false; why: TradeRefusal };

/** Valide un achat/une vente. `unit` = prix unitaire calculé par le serveur (entier ≥ 1). Ne modifie rien. */
export function checkTrade(
  side: 'buy' | 'sell', good: GoodId, qty: unknown, unit: number, money: number, bag: ReadonlyMap<GoodId, number>, bagCap: number,
): TradeCheck {
  if (!isIntIn(qty, 1, MAX_TRADE_QTY)) return { ok: false, why: 'quantite' };
  if (!isIntIn(unit, 1, 1e7)) return { ok: false, why: 'prix' };
  const total = unit * qty;
  if (side === 'buy') {
    if (!(money >= total)) return { ok: false, why: 'argent' };
    if (bagVolume(bag) + GOODS[good].weight * qty > bagCap) return { ok: false, why: 'place' };
  } else if ((bag.get(good) ?? 0) < qty) return { ok: false, why: 'stock' };
  return { ok: true, total };
}

/** Valide un dépôt (`put` : sac -> planque) ou un retrait (`take` : planque -> sac). Ne modifie rien. */
export function checkStash(
  op: 'put' | 'take', good: GoodId, qty: unknown, bag: ReadonlyMap<GoodId, number>, bagCap: number, stash: ReadonlyMap<GoodId, number>, stashCap: number,
): { ok: true } | { ok: false; why: TradeRefusal } {
  if (!isIntIn(qty, 1, 999)) return { ok: false, why: 'quantite' };
  if (op === 'put') {
    if ((bag.get(good) ?? 0) < qty) return { ok: false, why: 'stock' };
    if (bagVolume(stash) + GOODS[good].weight * qty > stashCap) return { ok: false, why: 'place' };
  } else {
    if ((stash.get(good) ?? 0) < qty) return { ok: false, why: 'stock' };
    if (bagVolume(bag) + GOODS[good].weight * qty > bagCap) return { ok: false, why: 'place' };
  }
  return { ok: true };
}

/** Argent perdu à l'arrestation (entier, 0 ≤ perte ≤ money). */
export function bustLoss(money: number): number {
  if (!Number.isFinite(money)) return 0;
  return Math.max(0, Math.min(Math.floor(money), Math.floor(money * BUST_MONEY_SHARE)));
}

/** Montant d'une commande (« 50 », jamais « -5 », « 1e3 », « 2.5 », « 0x10 »). null si invalide. */
export function parseAmount(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_MONEY ? n : null;
}

/** Distance d'un point à un rayon horizontal (origine o, direction d unitaire) ; null si derrière l'origine ou au-delà de `range`. */
export function rayMissDistance(ox: number, oz: number, dx: number, dz: number, px: number, pz: number, range: number): number | null {
  const len = Math.hypot(dx, dz);
  if (!(len > 0.2) || !Number.isFinite(len)) return null;
  const ux = dx / len, uz = dz / len;
  const rx = px - ox, rz = pz - oz;
  const t = rx * ux + rz * uz;
  if (t < 0 || t > range) return null;
  return Math.abs(rx * uz - rz * ux);
}
