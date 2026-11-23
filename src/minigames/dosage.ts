// PROPRIÉTAIRE : game-minigames
// TODO vague 4 : pistolet de pompe, 3 bouteilles à remplir jusqu'à la ligne en maintenant le clic (niveaux envoyés : [n1, n2, n3], voir dosageSpec).
// Repli actuel : clic quand l'anneau est plein (voir fallback.ts).
import { dosageSpec } from '../../shared/minigames/rules';
import { fallbackGame } from './fallback';

export const createDosage = fallbackGame('dosage', '#ff8c42', (s, d) => dosageSpec(s, d).targets);
