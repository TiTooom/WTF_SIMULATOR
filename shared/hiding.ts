// PROPRIÉTAIRE : game-missions
// Furtivité : cônes de vision, ligne de vue et cachettes. 100 % PUR (aucun Rapier, aucune horloge, aucun Math.random) :
// le serveur (server/systems/police.ts) s'en sert pour décider qui voit qui, le client peut s'en servir pour DESSINER les cônes
// et afficher « E : se cacher ». Repère du jeu : x vers l'est, z vers le sud, lacet 0 = regard vers -z, avant = (-sin lacet, -cos lacet).
//
// API publique
//   VISION                                        constantes (portées, champs de vision, rayons)
//   inCone(ox, oz, yaw, range, fov, tx, tz)       point dans le secteur (distance <= range et écart de cap <= fov / 2)
//   lineOfSight(city, ax, az, bx, bz)             false si un bâtiment coupe le segment (grille spatiale mise en cache par ville)
//   canSee(city, cone, tx, tz)                    cône (ou proximité NEAR) ET ligne de vue
//   cameraYaw(poi, timeS)                         cap d'une caméra de surveillance à l'instant timeS (secondes) : balayage ± 50°
//   copCameraCones(cops, cameras, isDown, timeS)  tous les cônes actifs : flics (à pied / en voiture) + caméras NON détruites
//   hidingSpots(city)                             cachettes déterministes (mémoïsées par ville)
//   nearestHidingSpot(spots, x, z, extra?)        cachette dont le rayon (+ extra) contient le point, la plus proche
import type { CityLayout, Poi } from './city/layout';
import { CITY } from './city/layout';
import type { DistrictId } from './ids';

const rad = (d: number) => (d * Math.PI) / 180;

export const VISION = {
  /** Policier à pied : 45 m, 100°. */
  FOOT: { range: 45, fov: rad(100) },
  /** Voiture de police : 60 m, 110° (pare-brise + côtés). */
  CAR: { range: 60, fov: rad(110) },
  /** Caméra de surveillance : 35 m, cône étroit de 50° qui balaie ± 50° autour de son axe en `period` secondes. */
  CAMERA: { range: 35, fov: rad(50), sweep: rad(50), period: 16 },
  /** En deçà (m), un flic ou une caméra perçoit le joueur dans toutes les directions (si la ligne de vue est libre). */
  NEAR: 7,
  /** Un flic à moins de GRILLE_R m, en ligne de vue, qui voit le joueur entrer dans une cachette la « grille ». */
  GRILLE_R: 15,
  /** Un flic à moins de FIND_R m d'un joueur caché le découvre. */
  FIND_R: 3,
} as const;

export type ConeKind = 'foot' | 'car' | 'camera';
export interface VisionCone {
  kind: ConeKind;
  id: string; // 'flic:<id>' / 'car:<id>' / id du POI caméra
  x: number;
  z: number;
  yaw: number;
  range: number;
  fov: number;
}

/** Un observateur policier (piéton ou voiture) : position, cap, en voiture ou non. */
export interface CopEye { id: string | number; x: number; z: number; yaw: number; car: boolean }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Le point (tx, tz) est-il dans le secteur d'origine (ox, oz), de cap `yaw`, de portée `range` et d'ouverture totale `fov` (rad) ? Pas de ligne de vue. */
export function inCone(ox: number, oz: number, yaw: number, range: number, fov: number, tx: number, tz: number): boolean {
  const dx = tx - ox, dz = tz - oz;
  const d2 = dx * dx + dz * dz;
  if (!(d2 <= range * range)) return false; // NaN refusé
  if (d2 < 1e-6) return true;
  const want = Math.atan2(-dx, -dz);
  return Math.abs(wrap(want - yaw)) <= fov / 2;
}

// ---------- Ligne de vue : grille spatiale sur les bâtiments ----------
const LOS_CELL = 32;
interface LosGrid { n: number; org: number; cells: number[][]; stamp: Int32Array; tick: number }
const grids = new WeakMap<CityLayout, LosGrid>();

function gridOf(city: CityLayout): LosGrid {
  let g = grids.get(city);
  if (g) return g;
  const org = -(CITY.HALF + 40);
  const n = Math.ceil((2 * (CITY.HALF + 40)) / LOS_CELL);
  const cells: number[][] = Array.from({ length: n * n }, () => []);
  const ci = (v: number) => Math.max(0, Math.min(n - 1, Math.floor((v - org) / LOS_CELL)));
  city.buildings.forEach((b, i) => {
    const x0 = ci(b.x - b.w / 2), x1 = ci(b.x + b.w / 2), z0 = ci(b.z - b.d / 2), z1 = ci(b.z + b.d / 2);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) cells[cz * n + cx].push(i);
  });
  g = { n, org, cells, stamp: new Int32Array(city.buildings.length), tick: 0 };
  grids.set(city, g);
  return g;
}

/** Vrai si le segment (ax, az) -> (bx, bz) ne traverse aucun bâtiment (vue de dessus : la hauteur n'est pas prise en compte). Entrées non finies : false. */
export function lineOfSight(city: CityLayout, ax: number, az: number, bx: number, bz: number): boolean {
  if (!Number.isFinite(ax + az + bx + bz)) return false;
  const g = gridOf(city);
  const ci = (v: number) => Math.max(0, Math.min(g.n - 1, Math.floor((v - g.org) / LOS_CELL)));
  const x0 = ci(Math.min(ax, bx)), x1 = ci(Math.max(ax, bx)), z0 = ci(Math.min(az, bz)), z1 = ci(Math.max(az, bz));
  if (++g.tick > 2e9) { g.stamp.fill(0); g.tick = 1; }
  const dx = bx - ax, dz = bz - az;
  const B = city.buildings;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const list = g.cells[cz * g.n + cx];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (g.stamp[i] === g.tick) continue;
        g.stamp[i] = g.tick;
        const b = B[i];
        let t0 = 0, t1 = 1;
        const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, bz0 = b.z - b.d / 2, bz1 = b.z + b.d / 2;
        if (Math.abs(dx) < 1e-9) { if (ax < bx0 || ax > bx1) continue; }
        else {
          let ta = (bx0 - ax) / dx, tb = (bx1 - ax) / dx;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) continue;
        }
        if (Math.abs(dz) < 1e-9) { if (az < bz0 || az > bz1) continue; }
        else {
          let ta = (bz0 - az) / dz, tb = (bz1 - az) / dz;
          if (ta > tb) { const t = ta; ta = tb; tb = t; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) continue;
        }
        return false;
      }
    }
  }
  return true;
}

/** Le cône voit-il le point ? Dans le secteur (ou à moins de VISION.NEAR m) ET ligne de vue dégagée. */
export function canSee(city: CityLayout, c: VisionCone, tx: number, tz: number): boolean {
  const d = Math.hypot(tx - c.x, tz - c.z);
  if (!(d <= c.range)) return false;
  if (!(d <= VISION.NEAR) && !inCone(c.x, c.z, c.yaw, c.range, c.fov, tx, tz)) return false;
  return lineOfSight(city, c.x, c.z, tx, tz);
}

// ---------- Caméras et cônes ----------
const hashId = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};

/** Cap d'une caméra à l'instant `timeS` : cap du POI (vers la rue) + 50° · sin(2π (t / période + phase du POI)). */
export function cameraYaw(poi: Poi, timeS: number): number {
  const phase = (hashId(poi.id) % 1000) / 1000;
  const t = Number.isFinite(timeS) ? timeS : 0;
  return poi.yaw + VISION.CAMERA.sweep * Math.sin(2 * Math.PI * (t / VISION.CAMERA.period + phase));
}

/** Cône d'un policier. */
export function copCone(c: CopEye): VisionCone {
  const v = c.car ? VISION.CAR : VISION.FOOT;
  return { kind: c.car ? 'car' : 'foot', id: `${c.car ? 'car' : 'flic'}:${c.id}`, x: c.x, z: c.z, yaw: c.yaw, range: v.range, fov: v.fov };
}

/** Cône d'une caméra de surveillance à l'instant `timeS`. */
export function cameraCone(poi: Poi, timeS: number): VisionCone {
  return { kind: 'camera', id: poi.id, x: poi.x, z: poi.z, yaw: cameraYaw(poi, timeS), range: VISION.CAMERA.range, fov: VISION.CAMERA.fov };
}

/**
 * Tous les cônes de vision actifs : un par policier de `cops`, un par caméra de `cameras` pour laquelle `isDown(id)` est faux.
 * `timeS` = temps de simulation en secondes (le balayage des caméras en dépend). `out` (facultatif) est vidé puis rempli : aucune allocation de tableau.
 */
export function copCameraCones(cops: readonly CopEye[], cameras: readonly Poi[], isDown: (id: string) => boolean, timeS: number, out: VisionCone[] = []): VisionCone[] {
  out.length = 0;
  for (const c of cops) if (Number.isFinite(c.x + c.z + c.yaw)) out.push(copCone(c));
  for (const p of cameras) if (p.kind === 'camera' && !isDown(p.id)) out.push(cameraCone(p, timeS));
  return out;
}

// ---------- Cachettes ----------
export type HidingKind = 'haie' | 'benne' | 'cabane' | 'garage' | 'ruelle';
export interface HidingSpot {
  id: string;
  x: number;
  z: number;
  /** Rayon (m) dans lequel on peut se cacher (distance au centre). */
  r: number;
  kind: HidingKind;
  district: DistrictId;
}

const spotCache = new WeakMap<CityLayout, HidingSpot[]>();
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Cachettes (déterministes, mémoïsées par ville) :
 *  - `haie` : 4 haies par îlot de type parc ; `benne` : un coin de chaque îlot bâti ; `cabane` : un second coin des îlots à bâtiment unique ;
 *  - `ruelle` : le centre de TOUS les îlots à plusieurs bâtiments (couloir étroit entre les murs) ;
 *  - `garage` : un garage sur le trottoir à côté de chaque place de parking (POI `parking`).
 * Chaque quartier en possède largement plus de 4.
 */
export function hidingSpots(city: CityLayout): readonly HidingSpot[] {
  const cached = spotCache.get(city);
  if (cached) return cached;
  const out: HidingSpot[] = [];
  const count = new Map<number, number>();
  for (const b of city.buildings) count.set(b.block, (count.get(b.block) ?? 0) + 1);
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const K = CITY.LOT / 2 + 0.5; // 25,5 : lisière du lot, juste hors des bâtiments (≤ 23,5)
  let n = 0;
  const add = (kind: HidingKind, x: number, z: number, r: number, district: DistrictId) => {
    out.push({ id: `${kind[0]}${n++}`, x: round1(x), z: round1(z), r, kind, district });
  };
  for (const b of city.blocks) {
    if (b.kind === 'parc') {
      for (const [sx, sz] of corners) add('haie', b.x + sx * 16, b.z + sz * 16, 3, b.district);
      continue;
    }
    if (b.kind !== 'batiments') continue;
    const nb = count.get(b.id) ?? 0;
    const c0 = corners[b.id % 4];
    add('benne', b.x + c0[0] * K, b.z + c0[1] * K, 2.4, b.district);
    if (nb === 1) { const c2 = corners[(b.id + 2) % 4]; add('cabane', b.x + c2[0] * K, b.z + c2[1] * K, 2.6, b.district); }
    if (nb >= 2) add('ruelle', b.x, b.z, 2.2, b.district);
  }
  for (const p of city.poisOf('parking')) {
    const horizontal = Math.abs(Math.abs(p.yaw) - Math.PI / 2) < 0.1; // tronçon est-ouest : la place est décalée en z
    const line = (v: number) => Math.round((v + CITY.HALF) / CITY.CELL) * CITY.CELL - CITY.HALF;
    const off = CITY.ROAD / 2 + CITY.SIDEWALK / 2; // 5,5 : milieu du trottoir
    if (horizontal) { const l = line(p.z); add('garage', p.x, l + (p.z >= l ? off : -off), 3, p.district); }
    else { const l = line(p.x); add('garage', l + (p.x >= l ? off : -off), p.z, 3, p.district); }
  }
  spotCache.set(city, out);
  return out;
}

/** Cachette la plus proche dont le rayon (+ `extra` m) contient (x, z), sinon null. */
export function nearestHidingSpot(spots: readonly HidingSpot[], x: number, z: number, extra = 0): HidingSpot | null {
  if (!Number.isFinite(x + z)) return null;
  let best: HidingSpot | null = null, bd = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d <= s.r + extra && d < bd) { bd = d; best = s; }
  }
  return best;
}
