// PROPRIÉTAIRE : game-camera-driving
// Déplacement à pied : constantes + roulade d'esquive. Logique PURE (aucun accès à Rapier) : sim.ts l'appelle depuis `walk()`.
//
// Branchement attendu dans sim.ts (walk) :
//   const roll = (p.scratch.roll ??= newRoll()) as RollState;
//   if (i.jump && !p.prevInput.jump && this.grounded(p) && startRoll(roll, this.time, i.f, i.s, i.yaw)) p.invulnUntil = Math.max(p.invulnUntil, this.time + ONFOOT.rollMs * 0.8);
//   const rv = rollVelocity(roll, this.time);            // [vx, vz] ou null
//   si rv : p.body.setLinvel({ x: rv[0] + kx, y: vy, z: rv[1] + kz }, true) à la place de la marche ; sinon marche normale (WALK/RUN = ONFOOT.walk/run).
//   Supprimer le saut (`if (i.jump && ground) vy = JUMP`) : jump = roulade à pied (protocole). Optionnel : an (PlayerSnap) = 2 pendant la roulade (rolling(roll, time)).
export const ONFOOT = { walk: 6, run: 10, roll: 14, rollMs: 450, rollCooldownMs: 900 } as const;
/**
 * Ressenti de la marche (m/s², rad/s) : démarrage vif mais non instantané (6 m/s en ~0,11 s, 10 m/s en ~0,25 s), arrêt net (~0,1 s),
 * demi-tour de vitesse en ~0,2 s, personnage qui se tourne vers le curseur en ~0,2 s pour 180°.
 */
export const FOOT = { accel: 55, runAccel: 40, brake: 75, turnRate: 20 } as const;

export interface RollState {
  /** Fin de la roulade en cours (ms de simulation), 0 = aucune. */
  until: number;
  /** Prochaine roulade possible (ms). */
  readyAt: number;
  start: number;
  dx: number; // direction unitaire en repère monde
  dz: number;
}

export const newRoll = (): RollState => ({ until: 0, readyAt: 0, start: 0, dx: 0, dz: -1 });

/**
 * Direction de roulade en repère monde à partir de l'entrée (f, s) et du cap du personnage ; sans entrée, droit devant.
 * Même convention que la marche de sim.ts : (s, -f) tourné de `yaw` autour de Y.
 */
export function rollDirection(f: number, s: number, yaw: number): [number, number] {
  const ff = Number.isFinite(f) ? f : 0, ss = Number.isFinite(s) ? s : 0;
  const len = Math.hypot(ff, ss);
  if (len < 0.1) return [-Math.sin(yaw), -Math.cos(yaw)];
  const x = ss / len, z = -ff / len;
  const c = Math.cos(yaw), si = Math.sin(yaw);
  return [x * c + z * si, -x * si + z * c];
}

/** Lance une roulade si le délai de récupération est écoulé. Retourne true si elle démarre. */
export function startRoll(r: RollState, now: number, f: number, s: number, yaw: number): boolean {
  if (now < r.readyAt || now < r.until) return false;
  const [dx, dz] = rollDirection(f, s, yaw);
  r.dx = dx; r.dz = dz;
  r.start = now;
  r.until = now + ONFOOT.rollMs;
  r.readyAt = now + ONFOOT.rollCooldownMs;
  return true;
}

export const rolling = (r: RollState, now: number): boolean => now < r.until;

/** Vitesse horizontale imposée pendant la roulade (démarrage vif, fin ralentie), null hors roulade. */
export function rollVelocity(r: RollState, now: number): [number, number] | null {
  if (now >= r.until) return null;
  const k = Math.max(0, Math.min(1, (now - r.start) / ONFOOT.rollMs)); // 0 -> 1
  const sp = ONFOOT.roll * (1.15 - 0.55 * k * k); // 16 m/s au départ, ~8,4 à la fin
  return [r.dx * sp, r.dz * sp];
}

/** Vitesse voulue (repère monde) à partir de l'entrée (f, s), du cap de la caméra/du joueur et de la course. Normalisée : pas de diagonale plus rapide. */
export function wishVelocity(f: number, s: number, yaw: number, run: boolean | number): [number, number] {
  let x = Number.isFinite(s) ? s : 0, z = Number.isFinite(f) ? -f : 0;
  const len = Math.hypot(x, z);
  if (len < 0.05) return [0, 0];
  if (len > 1) { x /= len; z /= len; }
  const c = Math.cos(yaw), si = Math.sin(yaw), sp = run ? ONFOOT.run : ONFOOT.walk;
  return [(x * c + z * si) * sp, (-x * si + z * c) * sp];
}

/**
 * Rapproche la vitesse horizontale `cur` de `want` : accélération limitée (FOOT.accel / runAccel), freinage plus franc (FOOT.brake) ;
 * un demi-tour passe par zéro. Fonction pure (retourne un nouveau couple).
 */
export function approachVelocity(cur: readonly [number, number], want: readonly [number, number], dt: number): [number, number] {
  const dx = want[0] - cur[0], dz = want[1] - cur[1];
  const d = Math.hypot(dx, dz);
  if (!(d > 1e-9) || !(dt > 0)) return [want[0], want[1]];
  const wl = Math.hypot(want[0], want[1]), cl = Math.hypot(cur[0], cur[1]);
  const a = wl < cl - 0.01 || d > wl + cl - 0.01 ? FOOT.brake : wl > ONFOOT.walk + 0.5 ? FOOT.runAccel : FOOT.accel;
  const step = a * dt;
  if (d <= step) return [want[0], want[1]];
  return [cur[0] + (dx / d) * step, cur[1] + (dz / d) * step];
}

/** Tourne `cur` vers `target` (rad, plus court chemin) : vitesse proportionnelle à l'écart, plafonnée à `rate` rad/s. Sans à-coup à l'arrivée. */
export function turnToward(cur: number, target: number, dt: number, rate: number = FOOT.turnRate): number {
  if (!Number.isFinite(cur)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target) || !(dt > 0)) return cur;
  const err = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  const step = Math.max(-rate * dt, Math.min(rate * dt, err * (1 - Math.exp(-14 * dt))));
  return cur + step;
}
