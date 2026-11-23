// PROPRIÉTAIRE : game-camera-driving
// Voies de circulation à droite (2 par tronçon, à ±LANE_OFFSET de l'axe) construites sur le graphe de getCity().
// Repère : x est, z sud ; un véhicule de lacet 0 regarde vers -z. Voie de droite : cap nord x+2, sud x-2, est z+2, ouest z-2
// (identique aux POI `spawn` de layout.ts).
import type { CityLayout } from './layout';

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
  g = { lanes, byFrom };
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

const dirOf = (l: Lane): [number, number] => {
  const dx = l.x1 - l.x0, dz = l.z1 - l.z0, n = Math.hypot(dx, dz) || 1;
  return [dx / n, dz / n];
};

/** 'right' | 'straight' | 'left' : manœuvre pour passer de `a` à `b`. */
export function turnKind(a: Lane, b: Lane): 'right' | 'straight' | 'left' {
  const [ax, az] = dirOf(a), [bx, bz] = dirOf(b);
  const cross = ax * bz - az * bx; // x est, z sud : > 0 = virage à droite
  if (Math.abs(cross) < 0.5) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

/** Voie à prendre après `lane` (tout droit, gauche ou droite selon `rnd` ∈ [0,1[), ou null si impasse. Jamais de demi-tour. */
export function nextLane(city: CityLayout, lane: Lane, rnd: number): Lane | null {
  const opts = graphOf(city).byFrom[lane.to].filter((l) => l.to !== lane.from);
  if (!opts.length) return null;
  const weight = { straight: 0.55, right: 0.25, left: 0.2 } as const;
  const w = opts.map((l) => weight[turnKind(lane, l)]);
  let r = (Number.isFinite(rnd) ? Math.max(0, Math.min(0.999999, rnd)) : 0) * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < opts.length; i++) {
    r -= w[i];
    if (r < 0) return opts[i];
  }
  return opts[opts.length - 1];
}

/** Voie la plus proche d'un point (et sa projection), pour placer un véhicule sur la route. null si aucune voie à moins de `maxDist`. */
export function nearestLane(city: CityLayout, x: number, z: number, maxDist = 12): { lane: Lane; t: number; dist: number } | null {
  let best: { lane: Lane; t: number; dist: number } | null = null;
  for (const l of graphOf(city).lanes) {
    const dx = l.x1 - l.x0, dz = l.z1 - l.z0, len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - l.x0) * dx + (z - l.z0) * dz) / len2));
    const d = Math.hypot(x - (l.x0 + dx * t), z - (l.z0 + dz * t));
    if (d < maxDist && (!best || d < best.dist)) best = { lane: l, t, dist: d };
  }
  return best;
}

/**
 * Itinéraire en voies (sans demi-tour) du nœud `fromNode` au nœud `toNode` (parcours en largeur sur le graphe de voies).
 * `first` : voie déjà empruntée (interdit le demi-tour au départ). Retourne [] si fromNode === toNode, null si inaccessible.
 */
export function routeLanes(city: CityLayout, fromNode: number, toNode: number, first?: Lane): Lane[] | null {
  if (fromNode === toNode) return [];
  const g = graphOf(city);
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
