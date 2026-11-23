// PROPRIÉTAIRE : game-minigames
// TODO vague 4 : fil flashé 0,5 s à mémoriser puis à trancher d'un geste sec (envoyer [fil coupé], voir desamorcageSpec).
// Repli actuel : clic quand l'anneau est plein (voir fallback.ts).
import { desamorcageSpec } from '../../shared/minigames/rules';
import { fallbackGame } from './fallback';

export const createDesamorcage = fallbackGame('desamorcage', '#ee4035', (s) => [desamorcageSpec(s).wire]);
