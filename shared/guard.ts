// Garde-fous Rapier. Lire (ou écrire) un corps RETIRÉ du monde lève « RuntimeError: unreachable » et EMPOISONNE le monde :
// ensuite tout appel Rapier (world.step compris) lève « recursive use of an object detected ». Il ne faut donc jamais
// toucher un corps retiré : tester `bodyOk(b)` avant d'utiliser une référence conservée entre deux ticks.
import type RAPIER from '@dimforge/rapier3d-compat';

/** Vrai si le corps existe encore dans le monde (aucun appel qui puisse paniquer). */
export function bodyOk(b: RAPIER.RigidBody | null | undefined): b is RAPIER.RigidBody {
  if (!b) return false;
  try { return b.isValid(); } catch { return false; }
}

/** Vrai si l'erreur signale un monde Rapier empoisonné (panique WASM puis « recursive use »). */
export function isPoison(e: unknown): boolean {
  const m = String((e as { message?: unknown } | null)?.message ?? e ?? '');
  return /recursive use of an object|unreachable|memory access out of bounds|null function|RuntimeError/i.test(m);
}
