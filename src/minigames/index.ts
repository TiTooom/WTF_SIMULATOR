// PROPRIÉTAIRE : game-minigames
// À IMPLÉMENTER : les 8 mini-jeux (< 4 s, souris/clavier uniquement, aucun texte explicatif) + leurs sons (registerSound). Le serveur valide le résultat.
import type { MinigameResult, MinigameStart } from '../../shared/protocol';

export interface Minigames {
  /** Démarre la session annoncée par le serveur (événement `mg_start`). */
  start(s: MinigameStart): void;
  /** Le serveur a clos la session (`mg_end`) ou le joueur est loin : ferme l'interface. */
  end(sid: number): void;
  active(): boolean;
}

export function createMinigames(_opts: { send: (r: MinigameResult) => void }): Minigames {
  return { start() {}, end() {}, active: () => false };
}
