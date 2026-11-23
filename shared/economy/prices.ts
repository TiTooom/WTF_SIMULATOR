// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : formule de DA.md  P = Pbase × Mterritoire × Mévénement × (1 + α·R) × ε  (unitPrice), devis achat/revente avec marge (quote), tirage des tuyaux (rollTip).
import type { DistrictId, GoodId } from '../ids';
import type { Sms } from '../protocol';
import { GOODS } from './goods';

export interface MarketEvent { good: GoodId; district: DistrictId; mult: number; until: number } // until : temps de simulation (ms)
export interface MarketState {
  noise: Record<string, number>; // ε par `${good}:${district}`, ∈ [0.92, 1.08]
  events: MarketEvent[];
  camsUp: Record<DistrictId, number>; // caméras de surveillance intactes
  police: Record<DistrictId, number>; // pression policière R ∈ [0, 1]
}

export function newMarketState(): MarketState {
  const z = { campus: 0, docks: 0, vieux_bourg: 0, zone_indus: 0, les_hauts: 0 };
  return { noise: {}, events: [], camsUp: { ...z, campus: 3, docks: 3, vieux_bourg: 3, zone_indus: 3, les_hauts: 3 }, police: { ...z } };
}

/** Prix unitaire de référence d'un produit dans un quartier. Squelette : prix de base. */
export function unitPrice(good: GoodId, _district: DistrictId, _state: MarketState, _now: number): number {
  return GOODS[good].base;
}

/** Prix que paie (buy) / reçoit (sell) le joueur. Squelette : même prix des deux côtés. */
export function quote(good: GoodId, district: DistrictId, state: MarketState, now: number): { buy: number; sell: number } {
  const p = unitPrice(good, district, state, now);
  return { buy: p, sell: p };
}

/** Tire un tuyau (SMS) ou null. Squelette : jamais. */
export function rollTip(_state: MarketState, _now: number, _rnd: () => number): Omit<Sms, 'id' | 'at'> | null {
  return null;
}
