// PROPRIÉTAIRE : game-economy
// À IMPLÉMENTER : interface d'achat / revente chez un dealer (ShopView), envoie des messages `trade` ; les prix affichés viennent du serveur.
import type { GameClientMsg, ShopView } from '../../shared/protocol';

export function renderShop(_root: HTMLElement, _shop: ShopView, _send: (m: GameClientMsg) => void): void {}
