// Itinéraire par les rues pour une IA de poursuite : la ville est une grille complète (rues tous les CITY.CELL mètres), un chemin en
// ligne droite traverse souvent des bâtiments. PUR et déterministe.
//   clearDrive(city, ax, az, bx, bz)  : une voiture peut-elle aller tout droit (ligne de vue élargie à sa largeur) ?
//   roadRoute(city, from, to)         : points de passage le long des rues, de `from` à `to` (dernier point = `to`).
import { CITY, type CityLayout } from '../city/layout';
import { lineOfSight } from '../hiding';

export interface Pt { x: number; z: number }

const HALF_WIDTH = 1.4; // m : demi-largeur d'une voiture avec une petite marge

export function clearDrive(city: CityLayout, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (!Number.isFinite(d)) return false;
  const ox = d > 1e-6 ? (-dz / d) * HALF_WIDTH : 0, oz = d > 1e-6 ? (dx / d) * HALF_WIDTH : 0;
  return lineOfSight(city, ax + ox, az + oz, bx + ox, bz + oz) && lineOfSight(city, ax - ox, az - oz, bx - ox, bz - oz);
}

const clampI = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
const lineAt = (i: number) => -CITY.HALF + CITY.CELL * i;

/** Tronçon de rue le plus proche d'un point : sens et intersections des deux bouts. */
function segmentOf(p: Pt): { horizontal: boolean; ends: [Pt, Pt] } {
  const { HALF, CELL, N } = CITY;
  const i = clampI(Math.round((p.x + HALF) / CELL), N), j = clampI(Math.round((p.z + HALF) / CELL), N);
  if (Math.abs(p.z - lineAt(j)) <= Math.abs(p.x - lineAt(i))) { // rue est-ouest
    const a = clampI(Math.floor((p.x + HALF) / CELL), N - 1);
    return { horizontal: true, ends: [{ x: lineAt(a), z: lineAt(j) }, { x: lineAt(a + 1), z: lineAt(j) }] };
  }
  const b = clampI(Math.floor((p.z + HALF) / CELL), N - 1);
  return { horizontal: false, ends: [{ x: lineAt(i), z: lineAt(b) }, { x: lineAt(i), z: lineAt(b + 1) }] };
}

export function roadRoute(_city: CityLayout, from: Pt, to: Pt): Pt[] {
  const s = segmentOf(from), t = segmentOf(to);
  let best: Pt[] = [], bd = Infinity;
  for (const a of s.ends) {
    for (const c of t.ends) {
      // coude en L entre les deux intersections : on part dans le sens de la rue courante
      const corner = s.horizontal ? { x: c.x, z: a.z } : { x: a.x, z: c.z };
      const len = Math.hypot(a.x - from.x, a.z - from.z) + Math.abs(c.x - a.x) + Math.abs(c.z - a.z) + Math.hypot(to.x - c.x, to.z - c.z);
      if (len < bd) { bd = len; best = [a, corner, c, { x: to.x, z: to.z }]; }
    }
  }
  return best;
}
