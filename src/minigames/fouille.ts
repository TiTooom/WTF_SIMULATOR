// PROPRIÉTAIRE : game-minigames
// TODO vague 4 : balayer les détritus à la souris pour dégager l'objet brillant (envoyer [emplacement, nb de balayages], voir fouilleSpec).
// Repli actuel : clic quand l'anneau est plein (voir fallback.ts).
import { fouilleSpec } from '../../shared/minigames/rules';
import { fallbackGame } from './fallback';

export const createFouille = fallbackGame('fouille', '#9aa5b1', (s) => [fouilleSpec(s).slot, fouilleSpec(s).swipes]);
