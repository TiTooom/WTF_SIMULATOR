// Registre des props (caisses, débris…). L'ORDRE est partagé serveur/client : les indices de props dans les snapshots en dépendent.
import { BASE_PROPS, type PropKind } from './props';

export const PROP_KINDS: PropKind[] = [...BASE_PROPS];
export const PROP_INDEX = new Map(PROP_KINDS.map((k, i) => [k.id, i]));
export const propKindById = (id: string) => PROP_KINDS[PROP_INDEX.get(id) ?? -1];
