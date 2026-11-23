// La ville : génération DÉTERMINISTE (même résultat sur le serveur et sur tous les clients, aucun `Math.random`).
// Grille N×N de cellules (îlots) entourées de rues ; circulation à droite ; trottoirs et marquages purement visuels.
// Repère : x vers l'est, z vers le sud (comme Three.js), y vers le haut. Un véhicule de lacet 0 regarde vers -z (le nord).
import { seeded } from '../constants';
import type { DistrictId } from '../ids';
import { DISTRICT_IDS } from '../ids';
import { DISTRICTS } from './districts';

export const CITY = { SEED: 20260601, N: 10, CELL: 64, HALF: 320, ROAD: 8, SIDEWALK: 3, LOT: 50, CHUNK: 128, BORDER: 330 } as const;

export type BlockKind = 'batiments' | 'parc' | 'place';
export interface Block {
  id: number; // j * N + i
  i: number; // colonne (vers l'est)
  j: number; // ligne (vers le sud)
  x: number; // centre
  z: number;
  district: DistrictId;
  kind: BlockKind;
}

export interface Building {
  id: number;
  x: number; // centre
  z: number;
  w: number; // largeur (axe x)
  d: number; // profondeur (axe z)
  h: number; // hauteur ; le toit est à y = h
  block: number;
  district: DistrictId;
  color: number;
}

export interface RoadNode {
  id: number; // j * (N+1) + i
  i: number;
  j: number;
  x: number;
  z: number;
}

export interface RoadEdge {
  id: number;
  a: number; // id du nœud (le plus à l'ouest ou au nord)
  b: number;
  len: number;
  horizontal: boolean; // le tronçon va dans le sens de l'axe x
}

export type PoiKind = 'dealer' | 'planque' | 'commissariat' | 'hopital' | 'camera' | 'parking' | 'donneur' | 'spawn';
export interface Poi {
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  yaw: number; // orientation conseillée (rad, convention du véhicule : 0 = vers -z)
  district: DistrictId;
  /** `spawn` : 'player' (à pied, sur la chaussée) ou 'car' (voiture du monde de départ, dans la voie de droite). */
  tag?: 'player' | 'car';
}

export interface ChunkRef { cx: number; cz: number; id: number }

export interface CityLayout {
  blocks: Block[];
  buildings: Building[];
  nodes: RoadNode[];
  edges: RoadEdge[];
  /** Voisins de chaque nœud (ids), même indexation que `nodes`. */
  neighbors: number[][];
  pois: Poi[];
  /** Empreinte du contenu (identique partout si la génération est déterministe). */
  hash: string;
  poisOf(kind: PoiKind): Poi[];
  districtAt(x: number, z: number): DistrictId;
  /** Îlot dont la cellule contient le point (rues comprises), null hors de la ville. */
  blockAt(x: number, z: number): Block | null;
  /** Chunk de CITY.CHUNK m (5×5) contenant le point (borné). */
  chunkOf(x: number, z: number): ChunkRef;
  nearestNode(x: number, z: number): RoadNode;
}

const { N, CELL, HALF, ROAD, SIDEWALK, LOT, CHUNK } = CITY;
const NODES_PER_ROW = N + 1;
export const CHUNKS_PER_SIDE = Math.ceil((2 * HALF) / CHUNK); // 5

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const cellOf = (v: number) => clampI(Math.floor((v + HALF) / CELL), 0, N - 1);
const rngFor = (salt: number) => {
  const r = seeded(((CITY.SEED * 31 + salt * 7919) % 2147483646) + 1);
  r(); r(); r(); // les premiers tirages d'un congruentiel linéaire sont corrélés entre graines voisines
  return r;
};

function hashOf(parts: number[]): string {
  let h = 2166136261;
  for (const n of parts) {
    h ^= Math.round(n * 100) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function build(): CityLayout {
  // ---- Quartiers : Voronoï (distance de Manhattan) sur les centres de cellules ----
  const districtGrid: DistrictId[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let best: DistrictId = DISTRICT_IDS[0];
      let bd = Infinity;
      for (const id of DISTRICT_IDS) {
        const [si, sj] = DISTRICTS[id].seed;
        const d = Math.abs(si - i) + Math.abs(sj - j);
        if (d < bd) { bd = d; best = id; }
      }
      districtGrid.push(best);
    }
  }

  // ---- Îlots : ~8 % de parcs / places ----
  const blocks: Block[] = [];
  const rb = rngFor(1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const r = rb();
      const kind: BlockKind = r < 0.045 ? 'parc' : r < 0.08 ? 'place' : 'batiments';
      blocks.push({ id: j * N + i, i, j, x: -HALF + CELL * (i + 0.5), z: -HALF + CELL * (j + 0.5), district: districtGrid[j * N + i], kind });
    }
  }
  // Chaque quartier garde au moins 4 îlots bâtis (sécurité si le tirage est extrême)
  for (const id of DISTRICT_IDS) {
    const mine = blocks.filter((b) => b.district === id);
    let built = mine.filter((b) => b.kind === 'batiments').length;
    for (const b of mine) if (built < 4 && b.kind !== 'batiments') { b.kind = 'batiments'; built++; }
  }

  // ---- Bâtiments : 1, 2 ou 4 boîtes par îlot bâti, toujours à l'intérieur du lot (LOT × LOT, trottoirs exclus) ----
  const buildings: Building[] = [];
  const half = LOT / 2;
  const add = (b: Block, x: number, z: number, w: number, d: number, rnd: () => number) => {
    const def = DISTRICTS[b.district];
    const h = Math.round((def.height[0] + rnd() * (def.height[1] - def.height[0])) * 2) / 2;
    buildings.push({ id: buildings.length, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, w: Math.round(w * 100) / 100, d: Math.round(d * 100) / 100, h, block: b.id, district: b.district, color: def.palette[Math.floor(rnd() * def.palette.length)] });
  };
  for (const b of blocks) {
    if (b.kind !== 'batiments') continue;
    const rnd = rngFor(100 + b.id);
    const r = rnd();
    const inner = LOT - 4; // 46 : marge de 2 m autour
    if (r < 0.2) {
      add(b, b.x, b.z, inner, inner, rnd);
    } else if (r < 0.5) {
      const w = (inner - 2) / 2;
      if (rnd() < 0.5) {
        add(b, b.x - (w / 2 + 1), b.z, w, inner, rnd);
        add(b, b.x + (w / 2 + 1), b.z, w, inner, rnd);
      } else {
        add(b, b.x, b.z - (w / 2 + 1), inner, w, rnd);
        add(b, b.x, b.z + (w / 2 + 1), inner, w, rnd);
      }
    } else {
      const q = half / 2; // centre d'un quart de lot
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const w = 16 + rnd() * 6, d = 16 + rnd() * 6; // ≤ 22 : tient dans le quart (23 m utiles)
        add(b, b.x + sx * q, b.z + sz * q, w, d, rnd);
      }
    }
  }

  // ---- Graphe routier : 11×11 intersections, 220 tronçons ----
  const nodes: RoadNode[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) nodes.push({ id: j * NODES_PER_ROW + i, i, j, x: -HALF + CELL * i, z: -HALF + CELL * j });
  const edges: RoadEdge[] = [];
  const neighbors: number[][] = nodes.map(() => []);
  const link = (a: number, b: number, horizontal: boolean) => {
    edges.push({ id: edges.length, a, b, len: CELL, horizontal });
    neighbors[a].push(b);
    neighbors[b].push(a);
  };
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) link(j * NODES_PER_ROW + i, j * NODES_PER_ROW + i + 1, true);
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) link(j * NODES_PER_ROW + i, (j + 1) * NODES_PER_ROW + i, false);

  // ---- Points d'intérêt ----
  const pois: Poi[] = [];
  const rp = rngFor(5000);
  const kerb = half + SIDEWALK / 2; // 26,5 : milieu du trottoir
  const sides = [
    { dx: 0, dz: -1, yaw: 0 }, // trottoir nord de l'îlot : regarde vers le nord (la rue)
    { dx: 1, dz: 0, yaw: -Math.PI / 2 },
    { dx: 0, dz: 1, yaw: Math.PI },
    { dx: -1, dz: 0, yaw: Math.PI / 2 },
  ];
  const usedBlocks = new Set<string>();
  const sidewalkPoi = (kind: PoiKind, b: Block, n: number) => {
    // une même face d'îlot ne porte qu'un seul POI de trottoir
    for (let tries = 0; tries < 40; tries++) {
      const sd = Math.floor(rp() * 4);
      const key = `${b.id}:${sd}`;
      if (usedBlocks.has(key) && tries < 39) continue;
      usedBlocks.add(key);
      const s = sides[sd];
      const along = (rp() - 0.5) * 24;
      const x = b.x + s.dx * kerb + (s.dx === 0 ? along : 0);
      const z = b.z + s.dz * kerb + (s.dz === 0 ? along : 0);
      pois.push({ id: `${kind}_${b.district}_${n}`, kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: s.yaw, district: b.district });
      return;
    }
  };
  const pickBlock = (id: DistrictId, k: number) => {
    const list = blocks.filter((b) => b.district === id && b.kind === 'batiments');
    return list[Math.floor(rp() * list.length)] ?? list[k % list.length];
  };
  for (const id of DISTRICT_IDS) {
    for (let k = 0; k < 2; k++) sidewalkPoi('dealer', pickBlock(id, k), k);
    sidewalkPoi('planque', pickBlock(id, 0), 0);
    for (let k = 0; k < 3; k++) sidewalkPoi('camera', pickBlock(id, k), k);
    sidewalkPoi('donneur', pickBlock(id, 1), 0);
  }
  sidewalkPoi('commissariat', blocks.find((b) => b.i === 5 && b.j === 5 && b.kind === 'batiments') ?? pickBlock('vieux_bourg', 0), 0);
  sidewalkPoi('hopital', pickBlock('campus', 0), 0);

  // Points d'apparition : milieux de tronçons autour du centre (rues forcément dégagées), voitures dans la voie de droite
  const mid = (i: number, j: number, horizontal: boolean) => horizontal ? [-HALF + CELL * (i + 0.5), -HALF + CELL * j] : [-HALF + CELL * i, -HALF + CELL * (j + 0.5)];
  const spawnAt = (n: number, x: number, z: number, tag: 'player' | 'car', yaw: number) =>
    pois.push({ id: `spawn_${tag}_${n}`, kind: 'spawn', x, z, yaw, district: districtGrid[cellOf(z) * N + cellOf(x)], tag });
  const players: [number, number][] = [[0, -32], [0, 32], [-32, 0], [32, 0], [0, -96], [0, 96], [-96, 0], [96, 0]];
  players.forEach(([x, z], n) => spawnAt(n, x, z, 'player', 0));
  // Voie de droite : cap nord (yaw 0) x+2 ; cap sud (π) x-2 ; cap est (-π/2) z+2 ; cap ouest (π/2) z-2
  const lane = 2;
  const cars: [number, number, number][] = [
    [lane, -40, 0], [-lane, 40, Math.PI], [-40, lane, -Math.PI / 2], [40, -lane, Math.PI / 2],
    [lane, -104, 0], [-lane, 104, Math.PI], [-104, lane, -Math.PI / 2], [104, -lane, Math.PI / 2],
  ];
  cars.forEach(([x, z, yaw], n) => spawnAt(n, x, z, 'car', yaw));

  // Parkings (~40, 8 par quartier) : en bord de chaussée au milieu de tronçons tirés au hasard (hors tronçons de départ), garés le long de la route
  const spawnEdges = new Set<number>();
  for (const [x, z] of [...players, ...cars.map(([x, z]) => [x, z] as [number, number])]) {
    const e = edges.find((ed) => {
      const a = nodes[ed.a], b = nodes[ed.b];
      return Math.hypot((a.x + b.x) / 2 - x, (a.z + b.z) / 2 - z) <= 20;
    });
    if (e) spawnEdges.add(e.id);
  }
  const cand = edges.filter((e) => !spawnEdges.has(e.id));
  const PER_DISTRICT = 8;
  const picks: typeof edges = [];
  for (const d of DISTRICT_IDS) {
    const mine = cand.filter((e) => districtGrid[cellOf((nodes[e.a].z + nodes[e.b].z) / 2) * N + cellOf((nodes[e.a].x + nodes[e.b].x) / 2)] === d);
    for (let k = 0; k < PER_DISTRICT && mine.length; k++) picks.push(mine.splice(Math.floor(rp() * mine.length), 1)[0]);
  }
  for (let n = 0; n < picks.length; n++) {
    const e = picks[n];
    const a = nodes[e.a], b = nodes[e.b];
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const side = rp() < 0.5 ? 1 : -1;
    const off = (ROAD / 2 + 0.3) * side; // roues contre le bord de chaussée (PARK_OFFSET de lanes.ts)
    const x = e.horizontal ? cx : cx + off;
    const z = e.horizontal ? cz + off : cz;
    pois.push({ id: `parking_${n}`, kind: 'parking', x, z, yaw: e.horizontal ? -Math.PI / 2 : 0, district: districtGrid[cellOf(z) * N + cellOf(x)] });
  }

  // ---- Empreinte ----
  const nums: number[] = [];
  for (const b of buildings) nums.push(b.x, b.z, b.w, b.d, b.h, b.color);
  for (const p of pois) nums.push(p.x, p.z, p.yaw, p.id.length);
  for (const b of blocks) nums.push(b.kind === 'batiments' ? 1 : 2, DISTRICT_IDS.indexOf(b.district));

  const byKind = new Map<PoiKind, Poi[]>();
  for (const p of pois) (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(p);

  return {
    blocks, buildings, nodes, edges, neighbors, pois, hash: hashOf(nums),
    poisOf: (k) => byKind.get(k) ?? [],
    districtAt: (x, z) => districtGrid[cellOf(z) * N + cellOf(x)],
    blockAt: (x, z) => (Math.abs(x) > HALF || Math.abs(z) > HALF ? null : blocks[cellOf(z) * N + cellOf(x)]),
    chunkOf: (x, z) => {
      const cx = clampI(Math.floor((x + HALF) / CHUNK), 0, CHUNKS_PER_SIDE - 1);
      const cz = clampI(Math.floor((z + HALF) / CHUNK), 0, CHUNKS_PER_SIDE - 1);
      return { cx, cz, id: cz * CHUNKS_PER_SIDE + cx };
    },
    nearestNode: (x, z) => {
      const i = clampI(Math.round((x + HALF) / CELL), 0, N);
      const j = clampI(Math.round((z + HALF) / CELL), 0, N);
      return nodes[j * NODES_PER_ROW + i];
    },
  };
}

let memo: CityLayout | null = null;
/** La ville (calculée une seule fois par processus). */
export function getCity(): CityLayout {
  return (memo ??= build());
}
/** Recalcule la ville sans la mémoïser (tests de déterminisme). */
export function buildCityUncached(): CityLayout {
  return build();
}
