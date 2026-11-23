// PROPRIÉTAIRE : art-toon
// À IMPLÉMENTER : coquille du PDA (ouverture par la touche `pda`, onglets carte / sms / marché / missions / stats, style BD, feuille pda.css). Les onglets sont dans src/ui/pda/*.
import type { GameClientMsg, Panel, PrivateState } from '../../shared/protocol';

export interface PdaCtx {
  /** Envoie un message de jeu au serveur (jamais de logique côté client). */
  send(m: GameClientMsg): void;
  now(): number;
}
/** Un onglet : remplit `root` d'après l'état privé le plus récent. */
export type PanelRenderer = (root: HTMLElement, me: PrivateState, ctx: PdaCtx) => void;

export class Pda {
  constructor(_root: HTMLElement, _ctx: PdaCtx) {}
  open(_panel?: Panel): void {}
  close(): void {}
  isOpen(): boolean { return false; }
  setState(_me: PrivateState): void {}
}
