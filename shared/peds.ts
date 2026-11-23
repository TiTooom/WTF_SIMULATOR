// PROPRIÉTAIRE : game-missions
// Piétons sur rails : logique PURE (aucun Rapier, aucune horloge globale, aucun Math.random). Déterministe à graine.
// Chaque piéton suit un rail carré autour d'un îlot (milieu du trottoir, décalé de `off` m), dans un sens (`dir`), et ne quitte le
// trottoir qu'aux coins pour traverser la rue jusqu'au coin de l'îlot voisin (passage piéton). Jamais dans un bâtiment (rail à 25-28 m du centre
// de l'îlot, les bâtiments sont à ≤ 25 m).
import type { CityLayout } from './city/layout';
import { CITY } from './city/layout';
import type { PedKind } from './ids';

/** États d'animation (valeur envoyée dans `Snapshot.peds`, champ `st`). */
export const PED_ST = { WALK: 0, FLEE: 1, KNOCKED: 2, IDLE: 3, TALK: 4 } as const;

/** Demi-côté du rail au milieu du trottoir (lot 25 m + moitié du trottoir). */
export const RAIL_H = CITY.LOT / 2 + CITY.SIDEWALK / 2; // 26,5
/** Décalage latéral maximal sur le trottoir (reste entre 25,5 et 27,5 m du centre). */
export const RAIL_OFF = 1;

export interface PedState {
  id: number;
  kind: PedKind;
  x: number;
  z: number;
  yaw: number; // convention véhicule : 0 = vers -z
  st: number; // PED_ST
  block: number; // îlot suivi (id de bloc)
  t: number; // abscisse sur le rail, [0, 4 * côté[
  dir: 1 | -1; // sens de parcours
  off: number; // décalage latéral [-RAIL_OFF, RAIL_OFF]
  spd: number; // vitesse de marche (m/s)
  rng: number; // état du générateur propre au piéton (entier 1..2147483646)
  timer: number; // secondes restantes dans l'état courant (immobile, parle, fuite, renversé, marche de gang)
  /** 1 pendant la traversée d'une rue (seul cas où le piéton est hors du trottoir). */
  cross: 0 | 1;
  cx: number; // cible de la traversée (monde)
  cz: number;
  cb: number; // îlot d'arrivée de la traversée
  ct: number; // abscisse d'arrivée
  fx: number; // origine de la menace (fuite)
  fz: number;
  gone: boolean; // à retirer (renversé depuis assez longtemps)
}

const rnd = (p: PedState): number => (p.rng = (p.rng * 16807) % 2147483647) / 2147483647;
const seedOf = (n: number): number => (Math.abs(Math.floor(n)) % 2147483646) + 1;

const side = (h: number) => 2 * h;

/** Position relative au centre de l'îlot pour l'abscisse t (rail carré de demi-côté h, sens horaire depuis le coin nord-ouest). */
export function railXZ(h: number, t: number): [number, number] {
  const s = 2 * h;
  const L = 4 * s;
  t = ((t % L) + L) % L;
  if (t < s) return [-h + t, -h];
  if (t < 2 * s) return [h, -h + (t - s)];
  if (t < 3 * s) return [h - (t - 2 * s), h];
  return [-h, h - (t - 3 * s)];
}

/** Abscisse du coin (sx, sz ∈ {-1, +1}). */
export function cornerT(h: number, sx: number, sz: number): number {
  const s = 2 * h;
  if (sx < 0 && sz < 0) return 0;
  if (sx > 0 && sz < 0) return s;
  if (sx > 0 && sz > 0) return 2 * s;
  return 3 * s;
}

/** Projette un point relatif (dx, dz) sur le rail de demi-côté h : abscisse du point le plus proche. */
export function railProject(h: number, dx: number, dz: number): number {
  const s = 2 * h;
  if (Math.abs(dz) >= Math.abs(dx)) {
    const c = Math.max(-h, Math.min(h, dx));
    return dz < 0 ? c + h : 2 * s + (h - c);
  }
  const c = Math.max(-h, Math.min(h, dz));
  return dx > 0 ? s + (c + h) : 3 * s + (h - c);
}

const setPos = (p: PedState, city: CityLayout) => {
  const b = city.blocks[p.block];
  const [rx, rz] = railXZ(RAIL_H + p.off, p.t);
  p.x = b.x + rx;
  p.z = b.z + rz;
};

const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Vitesse de marche typique par type (m/s), tirée dans une fourchette crédible. */
function walkSpeed(kind: PedKind, r: number): number {
  switch (kind) {
    case 'etudiant': return 1.4 + r * 0.5;
    case 'flic': return 1.1 + r * 0.2;
    case 'gang': return 0.9 + r * 0.3;
    case 'dealer': return 1.0;
    default: return 1.2 + r * 0.4;
  }
}

export interface MakePedOpts {
  /** Abscisse de départ (sinon tirée au hasard). */
  t?: number;
  dir?: 1 | -1;
  off?: number;
}

/** Crée un piéton sur le rail de l'îlot `blockId`. Déterministe pour (seed, id, kind, blockId). */
export function makePed(id: number, kind: PedKind, seed: number, city: CityLayout, blockId: number, opts: MakePedOpts = {}): PedState {
  const p: PedState = {
    id, kind, x: 0, z: 0, yaw: 0, st: PED_ST.WALK, block: blockId, t: 0, dir: 1, off: 0, spd: 1.3, rng: seedOf(seed * 7919 + id * 104729 + 13),
    timer: 0, cross: 0, cx: 0, cz: 0, cb: 0, ct: 0, fx: 0, fz: 0, gone: false,
  };
  rnd(p); rnd(p);
  const s = side(RAIL_H) * 4;
  p.t = opts.t ?? rnd(p) * s;
  p.dir = opts.dir ?? (rnd(p) < 0.5 ? 1 : -1);
  p.off = opts.off ?? (rnd(p) * 2 - 1) * RAIL_OFF;
  p.spd = walkSpeed(kind, rnd(p));
  if (kind === 'gang') { p.st = PED_ST.IDLE; p.timer = 3 + rnd(p) * 6; }
  setPos(p, city);
  const [ax, az] = railXZ(RAIL_H + p.off, p.t + p.dir * 0.5);
  const b = city.blocks[blockId];
  p.yaw = yawOf(b.x + ax - p.x, b.z + az - p.z);
  return p;
}

/** Piéton immobile (dealer) planté sur le trottoir à l'endroit du POI (position projetée sur le rail de son îlot). */
export function makeDealer(id: number, seed: number, city: CityLayout, x: number, z: number, yaw: number): PedState | null {
  const b = city.blockAt(x, z);
  if (!b) return null;
  const dx = x - b.x, dz = z - b.z;
  const t = railProject(RAIL_H, dx, dz);
  const p = makePed(id, 'dealer', seed, city, b.id, { t, off: 0, dir: 1 });
  p.st = PED_ST.IDLE;
  p.timer = 1e9;
  p.yaw = yaw;
  return p;
}

/** Fait fuir un piéton (sauf policier) : court sur son rail en s'éloignant de (x, z) pendant `secs` secondes. */
export function scarePed(p: PedState, city: CityLayout, x: number, z: number, secs: number): void {
  if (p.st === PED_ST.KNOCKED || p.gone || p.kind === 'flic') return;
  p.st = PED_ST.FLEE;
  p.timer = secs;
  p.fx = x;
  p.fz = z;
  if (!p.cross) fleeDir(p, city);
}

/** Renverse un piéton (allongé quelques secondes puis retiré). */
export function knockPed(p: PedState, secs = 6): void {
  p.st = PED_ST.KNOCKED;
  p.timer = secs;
  p.cross = 0;
}

function fleeDir(p: PedState, city: CityLayout) {
  const b = city.blocks[p.block];
  const h = RAIL_H + p.off;
  let best: 1 | -1 = p.dir, bd = -1;
  for (const d of [1, -1] as const) {
    const [rx, rz] = railXZ(h, p.t + d * 6);
    const dd = Math.hypot(b.x + rx - p.fx, b.z + rz - p.fz);
    if (dd > bd) { bd = dd; best = d; }
  }
  p.dir = best;
}

function startCross(p: PedState, city: CityLayout, corner: number): boolean {
  const sx = corner === 1 || corner === 2 ? 1 : -1;
  const sz = corner >= 2 ? 1 : -1;
  const b = city.blocks[p.block];
  const horizontal = rnd(p) < 0.5;
  const ni = b.i + (horizontal ? sx : 0), nj = b.j + (horizontal ? 0 : sz);
  if (ni < 0 || nj < 0 || ni >= CITY.N || nj >= CITY.N) return false;
  const nb = city.blocks[nj * CITY.N + ni];
  const h = RAIL_H + p.off;
  const tsx = horizontal ? -sx : sx, tsz = horizontal ? sz : -sz;
  p.cross = 1;
  p.cb = nb.id;
  p.ct = cornerT(h, tsx, tsz);
  p.cx = nb.x + tsx * h;
  p.cz = nb.z + tsz * h;
  return true;
}

/**
 * Avance un piéton de `dt` secondes (pur : modifie et retourne `p`). `dt` est borné à 0,25 s.
 * Un piéton renversé reste allongé `timer` secondes puis passe `gone` (le système le retire).
 */
export function stepPed(p: PedState, city: CityLayout, dt: number): PedState {
  if (!(dt > 0)) return p;
  if (dt > 0.25) dt = 0.25;
  if (p.gone) return p;

  if (p.st === PED_ST.KNOCKED) {
    p.timer -= dt;
    if (p.timer <= 0) p.gone = true;
    return p;
  }

  // Immobile / discussion
  if (p.st === PED_ST.IDLE || p.st === PED_ST.TALK) {
    p.timer -= dt;
    if (p.timer <= 0) {
      if (p.kind === 'dealer') p.timer = 1e9; // le dealer ne bouge pas
      else if (p.kind === 'gang') { p.st = PED_ST.WALK; p.timer = 3 + rnd(p) * 4; }
      else p.st = PED_ST.WALK;
    }
    return p;
  }

  const fleeing = p.st === PED_ST.FLEE;
  if (fleeing) {
    p.timer -= dt;
    if (p.timer <= 0) {
      if (p.kind === 'dealer') { p.st = PED_ST.IDLE; p.timer = 1e9; return p; }
      p.st = PED_ST.WALK;
      p.timer = 0;
    }
  }
  const speed = p.st === PED_ST.FLEE ? (p.kind === 'etudiant' ? 5 : 4.2) : p.spd;

  // Traversée d'une rue
  if (p.cross) {
    const dx = p.cx - p.x, dz = p.cz - p.z;
    const d = Math.hypot(dx, dz);
    const mv = speed * dt;
    if (d <= mv) {
      p.block = p.cb;
      p.t = p.ct;
      p.cross = 0;
      p.dir = rnd(p) < 0.5 ? 1 : -1;
      setPos(p, city);
    } else {
      p.x += (dx / d) * mv;
      p.z += (dz / d) * mv;
      p.yaw = yawOf(dx, dz);
    }
    return p;
  }

  // Pauses spontanées (marche seulement)
  if (p.st === PED_ST.WALK) {
    if (p.kind === 'gang') {
      p.timer -= dt;
      if (p.timer <= 0) { p.st = rnd(p) < 0.5 ? PED_ST.TALK : PED_ST.IDLE; p.timer = 4 + rnd(p) * 8; return p; }
    } else if (p.kind !== 'dealer') {
      const rate = p.kind === 'etudiant' ? 0.04 : p.kind === 'flic' ? 0.03 : 0.015;
      if (rnd(p) < rate * dt) {
        p.st = p.kind === 'etudiant' ? PED_ST.TALK : PED_ST.IDLE;
        p.timer = p.kind === 'etudiant' ? 3 + rnd(p) * 5 : 2 + rnd(p) * 3;
        return p;
      }
    }
  }

  // Marche sur le rail
  const h = RAIL_H + p.off;
  const s = 2 * h, L = 4 * s;
  const oldT = p.t;
  let newT = oldT + p.dir * speed * dt;
  const c0 = Math.floor(oldT / s), c1 = Math.floor(newT / s);
  let corner = -1;
  if (c0 !== c1) {
    corner = (((p.dir > 0 ? c1 : c0) % 4) + 4) % 4;
    newT = p.dir > 0 ? c1 * s : c0 * s - 1e-4; // pile sur le coin (juste en deçà dans le sens négatif : pas de double déclenchement)
  }
  p.t = ((newT % L) + L) % L;
  setPos(p, city);
  if (corner >= 0) {
    if (p.st === PED_ST.FLEE) fleeDir(p, city);
    const prob = p.kind === 'flic' || p.kind === 'dealer' ? 0 : p.st === PED_ST.FLEE ? 0.5 : p.kind === 'gang' ? 0.15 : 0.3;
    if (prob > 0 && rnd(p) < prob) startCross(p, city, corner);
  }
  const b = city.blocks[p.block];
  const [nx, nz] = railXZ(h, p.t + p.dir * 0.3);
  p.yaw = yawOf(b.x + nx - p.x, b.z + nz - p.z);
  return p;
}
