// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : textes des tuyaux SMS (pénurie / surplus, humour campus), expéditeurs fictifs.
import type { DistrictId, GoodId } from '../ids';

/** Texte d'un tuyau. `surplus` : prix cassé ; sinon pénurie (prix qui explose). */
export function tipText(_good: GoodId, _district: DistrictId, _surplus: boolean): string {
  return '';
}
