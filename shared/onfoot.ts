// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : déplacement à pied (marche, course, roulade d'esquive multidirectionnelle) ; les constantes remplacent celles de sim.ts (WALK/RUN/JUMP) quand la roulade existera.
export const ONFOOT = { walk: 6, run: 10, roll: 14, rollMs: 450, rollCooldownMs: 900 } as const;

/** Direction de roulade en repère monde à partir de l'entrée (f, s) et du cap ; squelette : droit devant. */
export function rollDirection(_f: number, _s: number, yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
