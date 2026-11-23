// PROPRIÉTAIRE : game-camera-driving
// Visée : verrouillage automatique sur la cible la plus proche. API PURE (aucun DOM, aucune dépendance Three), appelée par main.ts.
//
// Intégration attendue dans main.ts, une fois par image, à pied et arme en main :
//   const lock = new AutoLock();                                   // une instance, au démarrage
//   const t = lock.update(myPos, cursorYaw, candidates, enabled);  // candidates : AimTarget[] (flics, piétons hostiles, joueurs adverses, caméras…) construits depuis le snapshot interpolé
//   const aim = computeAim(myPos, cursorYaw, t?.pos ?? null);      // origin / dir (-> Input.ao / Input.ad) et yaw (-> Input.yaw) ; lockedOn = vrai si verrouillé
//   hud : dessiner un réticule sur t.pos quand aim.lockedOn.
// Le verrouillage se désactive avec `enabled = false` (touche de visée libre, ou en véhicule).
import type { Vec3 } from '../shared/protocol';

export interface AimResult { origin: Vec3; dir: Vec3; yaw: number; lockedOn: boolean }

export interface AimTarget {
  id: string | number;
  pos: Vec3; // position au sol
  /** Hauteur de visée au-dessus de `pos` (poitrine d'un piéton : 1,0 ; défaut). */
  aimHeight?: number;
}

export interface AimOpts {
  range: number; // portée de verrouillage (m)
  cone: number; // demi-angle d'acquisition autour de la direction du curseur (rad)
  keep: number; // rapport de portée pour conserver un verrou (> 1)
  switchGain: number; // une autre cible ne prend le verrou que si elle est plus proche de ce rapport (< 1)
}
export const AIM_DEFAULTS: AimOpts = { range: 28, cone: (75 * Math.PI) / 180, keep: 1.25, switchGain: 0.7 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const EYE = 1.2; // hauteur de l'origine de tir

/** Visée vers l'avant du personnage, ou vers `lock` (point monde) si fourni. */
export function computeAim(from: Vec3, yaw: number, lock?: Vec3 | null): AimResult {
  const origin: Vec3 = [from[0], from[1] + EYE, from[2]];
  if (lock) {
    const dx = lock[0] - origin[0], dy = lock[1] - origin[1], dz = lock[2] - origin[2];
    const n = Math.hypot(dx, dy, dz);
    if (n > 0.01) return { origin, dir: [dx / n, dy / n, dz / n], yaw: Math.atan2(-dx, -dz), lockedOn: true };
  }
  return { origin, dir: [-Math.sin(yaw), 0, -Math.cos(yaw)], yaw, lockedOn: false };
}

/** Cible à verrouiller : la plus proche dans le cône autour de `cursorYaw` et la portée. Fonction pure (sans mémoire). */
export function pickTarget(from: Vec3, cursorYaw: number, targets: readonly AimTarget[], opts: Partial<AimOpts> = {}): AimTarget | null {
  const o = { ...AIM_DEFAULTS, ...opts };
  let best: AimTarget | null = null;
  let bd = Infinity;
  for (const t of targets) {
    const dx = t.pos[0] - from[0], dz = t.pos[2] - from[2];
    const d = Math.hypot(dx, dz);
    if (!(d > 0.3) || d > o.range) continue;
    if (Math.abs(wrap(Math.atan2(-dx, -dz) - cursorYaw)) > o.cone) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Verrouillage avec hystérésis : garde sa cible tant qu'elle reste à portée, ne change que pour une cible nettement plus proche. */
export class AutoLock {
  private id: string | number | null = null;
  constructor(private readonly opts: Partial<AimOpts> = {}) {}

  get lockedId() { return this.id; }
  reset() { this.id = null; }

  /** Retourne la cible verrouillée avec `pos` relevé à la hauteur de visée (poitrine), ou null. */
  update(from: Vec3, cursorYaw: number, targets: readonly AimTarget[], enabled = true): { id: string | number; pos: Vec3 } | null {
    if (!enabled) { this.id = null; return null; }
    const o = { ...AIM_DEFAULTS, ...this.opts };
    const dist = (t: AimTarget) => Math.hypot(t.pos[0] - from[0], t.pos[2] - from[2]);
    const cur = this.id === null ? null : targets.find((t) => t.id === this.id) ?? null;
    const curOk = cur !== null && dist(cur) <= o.range * o.keep;
    const cand = pickTarget(from, cursorYaw, targets, o);
    let chosen: AimTarget | null = curOk ? cur : null;
    if (cand && (!chosen || (cand.id !== chosen.id && dist(cand) < dist(chosen) * o.switchGain))) chosen = cand;
    this.id = chosen ? chosen.id : null;
    return chosen ? { id: chosen.id, pos: [chosen.pos[0], chosen.pos[1] + (chosen.aimHeight ?? 1), chosen.pos[2]] } : null;
  }
}
