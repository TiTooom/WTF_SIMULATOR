// PROPRIÉTAIRE : game-minigames
// TODO vague 4 : glisser des liasses vers la zone centrale sans trop dépasser (envoyer [nb de liasses], voir liassesSpec).
// Repli actuel : clic quand l'anneau est plein (voir fallback.ts).
import { liassesSpec } from '../../shared/minigames/rules';
import { fallbackGame } from './fallback';

export const createLiasses = fallbackGame('liasses', '#2ecc71', (s) => [liassesSpec(s).target]);
