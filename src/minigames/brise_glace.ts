// PROPRIÉTAIRE : game-minigames
// TODO vague 4 : marteler la fissure de la vitre (envoyer [nb de coups], voir briseGlaceSpec).
// Repli actuel : clic quand l'anneau est plein (voir fallback.ts).
import { briseGlaceSpec } from '../../shared/minigames/rules';
import { fallbackGame } from './fallback';

export const createBriseGlace = fallbackGame('brise_glace', '#74c0fc', (s, d) => [briseGlaceSpec(s, d).hits]);
