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
  switchGain: number; // une autre cible ne prend le verrou que si son score est meilleur de ce rapport (< 1)
  holdMs: number; // durée minimale d'un verrou avant de pouvoir changer de cible (nécessite le paramètre `now`)
  releaseCone: number; // demi-angle au-delà duquel un curseur détourné relâche le verrou (rad)
  angleWeight: number; // poids de l'écart angulaire au curseur dans le score (0 = distance seule)
  farAngle: number; // le curseur s'est éloigné de la cible verrouillée de plus de cet angle (rad)...
  nearAngle: number; // ...et pointe une autre cible à moins de cet angle : changement voulu par le joueur, sans condition de distance
}
export const AIM_DEFAULTS: AimOpts = {
  range: 28, cone: (75 * Math.PI) / 180, keep: 1.25, switchGain: 0.7, holdMs: 350, releaseCone: (130 * Math.PI) / 180, angleWeight: 0.35, farAngle: 0.6, nearAngle: 0.3,
};

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

const angleTo = (from: Vec3, cursorYaw: number, t: AimTarget) => Math.abs(wrap(Math.atan2(-(t.pos[0] - from[0]), -(t.pos[2] - from[2])) - cursorYaw));

/** Score d'une cible (plus petit = meilleur) : distance, majorée par l'écart angulaire au curseur. Infinity si hors portée ou hors cône. */
function score(from: Vec3, cursorYaw: number, t: AimTarget, o: AimOpts, cone = o.cone): number {
  const dx = t.pos[0] - from[0], dz = t.pos[2] - from[2];
  const d = Math.hypot(dx, dz);
  if (!(d > 0.3) || d > o.range) return Infinity;
  const da = Math.abs(wrap(Math.atan2(-dx, -dz) - cursorYaw));
  if (da > cone) return Infinity;
  return d * (1 + o.angleWeight * (da / Math.PI));
}

/** Cible à verrouiller : la mieux placée (proche et dans l'axe du curseur) dans le cône et la portée. Fonction pure (sans mémoire). */
export function pickTarget(from: Vec3, cursorYaw: number, targets: readonly AimTarget[], opts: Partial<AimOpts> = {}): AimTarget | null {
  const o = { ...AIM_DEFAULTS, ...opts };
  let best: AimTarget | null = null;
  let bs = Infinity;
  for (const t of targets) {
    const sc = score(from, cursorYaw, t, o);
    if (sc < bs) { bs = sc; best = t; }
  }
  return best;
}

/**
 * Verrouillage avec hystérésis : garde sa cible tant qu'elle reste à portée (et que le curseur ne s'en détourne pas franchement),
 * ne change que pour une cible nettement mieux placée (score < 70 %) ou que le curseur pointe franchement (> 34° de l'ancienne, < 17° de la
 * nouvelle), ET après `holdMs` ms de verrou (si `now` est fourni).
 */
export class AutoLock {
  private id: string | number | null = null;
  private since = 0;
  /** Nombre de changements de cible (diagnostic, tests). */
  switches = 0;
  constructor(private readonly opts: Partial<AimOpts> = {}) {}

  get lockedId() { return this.id; }
  reset() { this.id = null; }

  /** Retourne la cible verrouillée avec `pos` relevé à la hauteur de visée (poitrine), ou null. `now` : horloge en ms (optionnelle). */
  update(from: Vec3, cursorYaw: number, targets: readonly AimTarget[], enabled = true, now?: number): { id: string | number; pos: Vec3 } | null {
    if (!enabled) { this.id = null; return null; }
    const o = { ...AIM_DEFAULTS, ...this.opts };
    const cur = this.id === null ? null : targets.find((t) => t.id === this.id) ?? null;
    const curScore = cur ? score(from, cursorYaw, cur, { ...o, range: o.range * o.keep }, o.releaseCone) : Infinity;
    const cand = pickTarget(from, cursorYaw, targets, o);
    let chosen: AimTarget | null = curScore < Infinity ? cur : null;
    if (cand && (!chosen || cand.id !== chosen.id)) {
      const held = chosen !== null && now !== undefined && now - this.since < o.holdMs;
      if (!chosen) chosen = cand;
      else if (!held) {
        const better = score(from, cursorYaw, cand, o) < curScore * o.switchGain;
        const deliberate = angleTo(from, cursorYaw, chosen) > o.farAngle && angleTo(from, cursorYaw, cand) < o.nearAngle; // le joueur vise ailleurs
        if (better || deliberate) chosen = cand;
      }
    }
    if ((chosen ? chosen.id : null) !== this.id) {
      if (chosen && this.id !== null) this.switches++;
      this.since = now ?? 0;
    }
    this.id = chosen ? chosen.id : null;
    return chosen ? { id: chosen.id, pos: [chosen.pos[0], chosen.pos[1] + (chosen.aimHeight ?? 1), chosen.pos[2]] } : null;
  }
}
