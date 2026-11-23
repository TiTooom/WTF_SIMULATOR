// PROPRIÉTAIRE : game-camera-driving
// Voies de circulation à droite (2 par tronçon, à ±LANE_OFFSET de l'axe) construites sur le graphe de getCity().
// Repère : x est, z sud ; un véhicule de lacet 0 regarde vers -z. Voie de droite : cap nord x+2, sud x-2, est z+2, ouest z-2
// (identique aux POI `spawn` de layout.ts).
import { CITY, type CityLayout } from './layout';

export const LANE_OFFSET = 2;

export interface Lane {
  id: number; // edge.id * 2 (sens a -> b) ou edge.id * 2 + 1 (sens b -> a)
  edge: number; // id du tronçon (CityLayout.edges)
  from: number; // id du nœud de départ (sens de circulation)
  to: number; // id du nœud d'arrivée
  x0: number; z0: number; x1: number; z1: number; // axe de la voie (droite de la chaussée)
  yaw: number; // cap du véhicule sur cette voie
}

interface LaneGraph {
  lanes: Lane[];
  byFrom: Lane[][]; // voies sortant de chaque nœud
  routes: Map<number, Lane[] | null>; // cache d'itinéraires (routeLanes)
}

const graphs = new WeakMap<CityLayout, LaneGraph>();

function graphOf(city: CityLayout): LaneGraph {
  let g = graphs.get(city);
  if (g) return g;
  const lanes: Lane[] = [];
  const byFrom: Lane[][] = city.nodes.map(() => []);
  const o = LANE_OFFSET;
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    let l0: Lane, l1: Lane;
    if (e.horizontal) { // a à l'ouest, b à l'est
      l0 = { id: e.id * 2, edge: e.id, from: e.a, to: e.b, x0: a.x, z0: a.z + o, x1: b.x, z1: b.z + o, yaw: -Math.PI / 2 }; // vers l'est : z+2
      l1 = { id: e.id * 2 + 1, edge: e.id, from: e.b, to: e.a, x0: b.x, z0: b.z - o, x1: a.x, z1: a.z - o, yaw: Math.PI / 2 }; // vers l'ouest : z-2
    } else { // a au nord, b au sud
      l0 = { id: e.id * 2, edge: e.id, from: e.a, to: e.b, x0: a.x - o, z0: a.z, x1: b.x - o, z1: b.z, yaw: Math.PI }; // vers le sud : x-2
      l1 = { id: e.id * 2 + 1, edge: e.id, from: e.b, to: e.a, x0: b.x + o, z0: b.z, x1: a.x + o, z1: a.z, yaw: 0 }; // vers le nord : x+2
    }
    lanes.push(l0, l1);
    byFrom[l0.from].push(l0);
    byFrom[l1.from].push(l1);
  }
  g = { lanes, byFrom, routes: new Map() };
  graphs.set(city, g);
  return g;
}

/** Toutes les voies de la ville (mémoïsées : ne pas modifier le tableau). */
export function lanesOf(city: CityLayout): Lane[] {
  return graphOf(city).lanes;
}

/** Voies qui partent du nœud (sens de circulation). */
export function lanesFrom(city: CityLayout, node: number): Lane[] {
  return graphOf(city).byFrom[node] ?? [];
}

/** 'right' | 'straight' | 'left' : manœuvre pour passer de `a` à `b`. Sans allocation. */
export function turnKind(a: Lane, b: Lane): 'right' | 'straight' | 'left' {
  const adx = a.x1 - a.x0, adz = a.z1 - a.z0, bdx = b.x1 - b.x0, bdz = b.z1 - b.z0;
  const cross = (adx * bdz - adz * bdx) / ((Math.hypot(adx, adz) || 1) * (Math.hypot(bdx, bdz) || 1)); // x est, z sud : > 0 = virage à droite
  if (Math.abs(cross) < 0.5) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

const TURN_W = { straight: 0.55, right: 0.25, left: 0.2 } as const;

/** Voie à prendre après `lane` (tout droit, gauche ou droite selon `rnd` ∈ [0,1[), ou null si impasse. Jamais de demi-tour. Sans allocation. */
export function nextLane(city: CityLayout, lane: Lane, rnd: number): Lane | null {
  const all = graphOf(city).byFrom[lane.to];
  let total = 0, last: Lane | null = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i].to === lane.from) continue;
    total += TURN_W[turnKind(lane, all[i])];
    last = all[i];
  }
  if (!last) return null;
  let r = (Number.isFinite(rnd) ? Math.max(0, Math.min(0.999999, rnd)) : 0) * total;
  for (let i = 0; i < all.length; i++) {
    if (all[i].to === lane.from) continue;
    r -= TURN_W[turnKind(lane, all[i])];
    if (r < 0) return all[i];
  }
  return last;
}

/** Voie la plus proche d'un point (et sa projection), pour placer un véhicule sur la route. null si aucune voie à moins de `maxDist`. */
export function nearestLane(city: CityLayout, x: number, z: number, maxDist = 12): { lane: Lane; t: number; dist: number } | null {
  let bestD2 = maxDist * maxDist, bl: Lane | null = null, bt = 0;
  for (const l of graphOf(city).lanes) { // voies alignées sur les axes : rejet rapide par boîte avant la projection
    if (x < Math.min(l.x0, l.x1) - maxDist || x > Math.max(l.x0, l.x1) + maxDist || z < Math.min(l.z0, l.z1) - maxDist || z > Math.max(l.z0, l.z1) + maxDist) continue;
    const dx = l.x1 - l.x0, dz = l.z1 - l.z0, len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - l.x0) * dx + (z - l.z0) * dz) / len2));
    const ex = x - (l.x0 + dx * t), ez = z - (l.z0 + dz * t), d2 = ex * ex + ez * ez;
    if (d2 < bestD2) { bestD2 = d2; bl = l; bt = t; }
  }
  return bl ? { lane: bl, t: bt, dist: Math.sqrt(bestD2) } : null;
}

/**
 * Itinéraire en voies (sans demi-tour) du nœud `fromNode` au nœud `toNode` (parcours en largeur sur le graphe de voies).
 * `first` : voie déjà empruntée (interdit le demi-tour au départ). Retourne [] si fromNode === toNode, null si inaccessible.
 */
export function routeLanes(city: CityLayout, fromNode: number, toNode: number, first?: Lane): Lane[] | null {
  if (fromNode === toNode) return [];
  const g = graphOf(city);
  // Cache : le graphe est fixe, seul le demi-tour interdit au départ dépend de `first` (clé = nœud d'où l'on vient). Copie rendue à l'appelant.
  const key = (first ? first.from + 1 : 0) * 65536 + fromNode * 256 + toNode;
  const hit = g.routes.get(key);
  if (hit !== undefined) return hit && hit.slice();
  const res = bfsRoute(g, fromNode, toNode, first);
  if (g.routes.size > 6000) g.routes.clear();
  g.routes.set(key, res);
  return res && res.slice();
}

function bfsRoute(g: LaneGraph, fromNode: number, toNode: number, first?: Lane): Lane[] | null {
  const prev = new Map<number, Lane | null>(); // id de voie -> voie précédente
  const queue: Lane[] = [];
  for (const l of g.byFrom[fromNode] ?? []) {
    if (first && l.to === first.from) continue;
    prev.set(l.id, null);
    queue.push(l);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur.to === toNode) {
      const out: Lane[] = [];
      for (let l: Lane | null = cur; l; l = prev.get(l.id) ?? null) out.push(l);
      return out.reverse();
    }
    for (const nx of g.byFrom[cur.to]) {
      if (nx.to === cur.from || prev.has(nx.id)) continue;
      prev.set(nx.id, cur);
      queue.push(nx);
    }
  }
  return null;
}

/**
 * Points de passage à suivre avec steerTo pour un itinéraire : à chaque intersection, le coin intérieur du virage (intersection des axes
 * des deux voies), et le bout de la dernière voie.
 */
export function laneWaypoints(route: Lane[]): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[i + 1];
    if (!b) { pts.push({ x: a.x1, z: a.z1 }); break; }
    const aVertical = a.x0 === a.x1;
    const bVertical = b.x0 === b.x1;
    if (aVertical === bVertical) pts.push({ x: a.x1, z: a.z1 }); // tout droit
    else if (aVertical) pts.push({ x: a.x0, z: b.z0 }); // virage : coin intérieur
    else pts.push({ x: b.x0, z: a.z0 });
  }
  return pts;
}

// ---------- Places de stationnement ----------
/** Distance de l'axe de la rue au centre d'une voiture garée : roues contre le bord de chaussée, hors de la voie de droite (±2 m, demi-largeur 1 m). */
export const PARK_OFFSET = CITY.ROAD / 2 + 0.3;

export interface ParkSlot {
  id: string; // id du POI `parking`, ou `curb_<tronçon>_<côté>` pour une place synthétique
  poi: boolean;
  x: number; z: number;
  yaw: number; // parallèle à la rue, nez dans le sens de circulation de la voie voisine
  edge: number;
}

const slotCache = new WeakMap<CityLayout, ParkSlot[]>();

/**
 * Places de stationnement le long des rues : chaque POI `parking` (recalé à PARK_OFFSET de l'axe, quel que soit son décalage dans layout.ts),
 * plus une place au milieu de chaque côté de chaque tronçon (440) : de quoi garantir des voitures garées partout. Mémoïsé.
 */
export function parkingSlots(city: CityLayout): ParkSlot[] {
  const hit = slotCache.get(city);
  if (hit) return hit;
  const { HALF, CELL } = CITY;
  const out: ParkSlot[] = [];
  const taken = new Set<string>();
  const make = (id: string, poi: boolean, horizontal: boolean, axis: number, along: number, side: 1 | -1, edge: number) => {
    const o = axis + side * PARK_OFFSET;
    // la voie voisine (circulation à droite) : horizontal, côté sud (+z) = vers l'est (yaw -π/2) ; vertical, côté est (+x) = vers le nord (yaw 0)
    out.push(horizontal
      ? { id, poi, x: along, z: o, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, edge }
      : { id, poi, x: o, z: along, yaw: side > 0 ? 0 : Math.PI, edge });
  };
  for (const p of city.poisOf('parking')) {
    const horizontal = Math.abs(Math.sin(p.yaw)) > 0.5;
    const c = horizontal ? p.z : p.x, along = horizontal ? p.x : p.z;
    const axis = Math.round((c + HALF) / CELL) * CELL - HALF;
    const side: 1 | -1 = c >= axis ? 1 : -1;
    const e = city.edges.find((ed) => {
      const a = city.nodes[ed.a], b = city.nodes[ed.b];
      return ed.horizontal === horizontal && Math.abs((horizontal ? a.z : a.x) - axis) < 1 && along >= Math.min(horizontal ? a.x : a.z, horizontal ? b.x : b.z) - 0.5 && along <= Math.max(horizontal ? a.x : a.z, horizontal ? b.x : b.z) + 0.5;
    });
    if (!e) continue;
    make(p.id, true, horizontal, axis, along, side, e.id);
    taken.add(`${e.id}_${side}`);
  }
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    for (const side of [1, -1] as const) {
      if (taken.has(`${e.id}_${side}`)) continue;
      make(`curb_${e.id}_${side > 0 ? 'p' : 'm'}`, false, e.horizontal, e.horizontal ? a.z : a.x, e.horizontal ? (a.x + b.x) / 2 : (a.z + b.z) / 2, side, e.id);
    }
  }
  slotCache.set(city, out);
  return out;
}
