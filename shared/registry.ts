// Registres du contenu : objets d'inventaire, props, comportements. Construits à partir des paquets.
// L'ORDRE des paquets et des props est partagé serveur/client (les indices de props en dépendent).
import type { ItemDef, ItemHandler, Pack } from './api';
import { BASE_PROPS, type PropKind } from './props';
import { pack as core } from './packs/core';
import { pack as build } from './packs/build';
import { pack as weapons } from './packs/weapons';
import { pack as wtf } from './packs/wtf';
import { pack as move } from './packs/move';

const PACKS: Pack[] = [core, build, weapons, wtf, move];

export const ITEMS: ItemDef[] = PACKS.flatMap((p) => p.items);
export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const HANDLERS: Record<string, ItemHandler> = Object.assign({}, ...PACKS.map((p) => p.handlers));

export const PROP_KINDS: PropKind[] = [...BASE_PROPS, ...PACKS.flatMap((p) => p.props)];
export const PROP_INDEX = new Map(PROP_KINDS.map((k, i) => [k.id, i]));
export const propKindById = (id: string) => PROP_KINDS[PROP_INDEX.get(id) ?? -1];

/** Barre d'objets proposée par défaut (9 emplacements) : les premiers objets de chaque catégorie importante. */
export const DEFAULT_HOTBAR: string[] = (() => {
  const want = ['physgun', 'remover', 'welder'];
  const rest = ITEMS.filter((i) => !want.includes(i.id)).map((i) => i.id);
  const have = want.filter((id) => ITEM_BY_ID.has(id));
  return [...have, ...rest].slice(0, 9).concat(Array(9).fill('')).slice(0, 9);
})();
