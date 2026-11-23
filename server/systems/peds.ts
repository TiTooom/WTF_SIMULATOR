// PROPRIÉTAIRE : game-missions
// Piétons sur rails (≤ 80, plafond strict 160) : données pures sans corps Rapier (shared/peds.ts).
// Renversés par les voitures rapides (pedKnocked + crime pieton_renverse), fuient devant les tirs et explosions.
// Règle Rapier : aucun corps conservé entre deux ticks ; chaque véhicule est revalidé (refOf/resolveRef + bodyOk) à chaque lecture.
import { PED_STRIDE } from '../../shared/protocol';
import { bodyOk } from '../../shared/guard';
import { STEP } from '../../shared/constants';
import type { GameSystem, SystemFactory } from '../../shared/game';
import { PED_KINDS, type PedKind } from '../../shared/ids';
import type { Poi } from '../../shared/city/layout';
import { CITY } from '../../shared/city/layout';
import { knockPed, makeDealer, makePed, PED_ST, scarePed, stepPed, type PedState } from '../../shared/peds';

export const PEDS_TARGET = 80; // population visée
export const PEDS_HARD_CAP = 160; // plafond strict
const SPAWN_MIN = 40, SPAWN_MAX = 110, DESPAWN = 130;
const HIT_R = 1.6; // rayon de collision piéton / voiture (m, depuis le centre de la voiture)
const HIT_SPEED = 4; // m/s
const CELL = 16;
const GN = Math.ceil((2 * (CITY.HALF + 20)) / CELL);

export interface PedsSystem extends GameSystem {
  /** Tir ou explosion en (x, z) : fait fuir les piétons dans `radius`. */
  onShot(x: number, z: number, radius?: number): void;
  /** Accès aux piétons (tests, autres systèmes) : lecture seule par convention. */
  readonly peds: readonly PedState[];
}

const kindIndex = (k: PedKind) => PED_KINDS.indexOf(k);

export const createPeds: SystemFactory = (ctx): PedsSystem => {
  const { sim, bus, city } = ctx;
  let seed = 424242;
  let rng = seed;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  let nextId = 1;
  let peds: PedState[] = [];
  let tick = 0;
  const dealerPed = new Map<string, number>(); // poi.id -> id du piéton
  const dealerCool = new Map<string, number>(); // poi.id -> tick avant lequel on ne le recrée pas
  const dealers: Poi[] = city.poisOf('dealer');
  const commissariat = city.poisOf('commissariat')[0];

  // Grille spatiale (listes chaînées dans des tableaux typés, reconstruite à chaque pas)
  const heads = new Int32Array(GN * GN);
  let nexts = new Int32Array(PEDS_HARD_CAP + 8);
  const cellOf = (v: number) => Math.max(0, Math.min(GN - 1, Math.floor((v + CITY.HALF + 20) / CELL)));
  const rebuildGrid = () => {
    heads.fill(-1);
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const c = cellOf(p.z) * GN + cellOf(p.x);
      nexts[i] = heads[c];
      heads[c] = i;
    }
  };
  const near = (x: number, z: number, r: number, fn: (p: PedState) => void) => {
    const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (let i = heads[cz * GN + cx]; i >= 0; i = nexts[i]) {
        const p = peds[i];
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz <= r2) fn(p);
      }
    }
  };

  const playerPositions = (): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of sim.players.values()) {
      try {
        const q = sim.playerPos(p);
        if (Number.isFinite(q[0]) && Number.isFinite(q[2])) out.push([q[0], q[2]]);
      } catch { /* joueur en cours de retrait : ignoré */ }
    }
    return out;
  };

  const kindFor = (district: string, nearCommissariat: boolean): PedKind => {
    const r = rand();
    if (nearCommissariat && r < 0.25) return 'flic';
    if (district === 'campus') return r < 0.6 ? 'etudiant' : r < 0.93 ? 'passant' : 'gang';
    if (r < 0.04) return 'flic';
    if (r < 0.14) return 'etudiant';
    if (r < 0.26) return 'gang';
    return 'passant';
  };

  const add = (p: PedState | null): boolean => {
    if (!p || peds.length >= PEDS_HARD_CAP) return false;
    if (nexts.length < peds.length + 2) nexts = new Int32Array(nexts.length * 2);
    peds.push(p);
    return true;
  };

  const trySpawn = (players: [number, number][]): boolean => {
    if (!players.length) return false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const o = players[Math.floor(rand() * players.length)];
      const a = rand() * Math.PI * 2, d = SPAWN_MIN + 5 + rand() * (SPAWN_MAX - SPAWN_MIN - 10);
      const px = o[0] + Math.cos(a) * d, pz = o[1] + Math.sin(a) * d;
      const b = city.blockAt(px, pz);
      if (!b) continue;
      const kind = kindFor(b.district, !!commissariat && Math.hypot(commissariat.x - px, commissariat.z - pz) < 70);
      const mk = (t?: number) => makePed(nextId, kind, seed, city, b.id, t === undefined ? {} : { t });
      const p = mk();
      if (!spawnOk(p, players)) continue;
      nextId++;
      add(p);
      if (kind === 'gang') { // petit groupe qui traîne ensemble
        for (let k = 0; k < 2 && peds.length < PEDS_TARGET; k++) {
          const q = makePed(nextId, 'gang', seed, city, b.id, { t: p.t + (k + 1) * 1.2, dir: p.dir, off: p.off });
          if (spawnOk(q, players)) { nextId++; add(q); }
        }
      }
      return true;
    }
    return false;
  };
  const spawnOk = (p: PedState, players: [number, number][]) => {
    for (const [x, z] of players) if (Math.hypot(p.x - x, p.z - z) < SPAWN_MIN) return false;
    return true;
  };

  const managePopulation = () => {
    const players = playerPositions();
    // Disparition : plus aucun joueur à moins de DESPAWN m
    const keep: PedState[] = [];
    for (const p of peds) {
      let ok = !p.gone;
      if (ok) {
        ok = false;
        for (const [x, z] of players) if (Math.hypot(p.x - x, p.z - z) <= DESPAWN) { ok = true; break; }
      }
      if (ok) keep.push(p);
    }
    peds = keep;
    for (const [poi, id] of [...dealerPed]) if (!peds.some((p) => p.id === id)) { dealerPed.delete(poi); dealerCool.set(poi, tick + 60 * 45); }

    // Dealers : un par POI dès qu'un joueur est à portée
    for (const poi of dealers) {
      if (dealerPed.has(poi.id) || (dealerCool.get(poi.id) ?? 0) > tick) continue;
      if (!players.some(([x, z]) => Math.hypot(poi.x - x, poi.z - z) <= SPAWN_MAX)) continue;
      if (peds.length >= PEDS_TARGET) { // plein : un passant cède sa place au dealer
        const k = peds.findIndex((q) => q.kind === 'passant');
        if (k < 0) continue;
        peds.splice(k, 1);
      }
      const p = makeDealer(nextId, seed, city, poi.x, poi.z, poi.yaw);
      if (p && add(p)) { nextId++; dealerPed.set(poi.id, p.id); }
    }

    // Apparition
    const target = Math.min(PEDS_TARGET, players.length ? 50 + 15 * players.length : 0);
    for (let n = 0; n < 8 && peds.length < target; n++) if (!trySpawn(players)) break;
  };

  const knockByVehicles = () => {
    if (!peds.length) return;
    for (const v0 of sim.vehicles) {
      if (v0.pooled || v0.dead) continue;
      const v = v0; // lu directement dans sim.vehicles ce tick (pas de référence conservée) : bodyOk suffit, sans allouer de VRef
      if (!bodyOk(v.behavior.body)) continue;
      const lv = v.behavior.body.linvel();
      const speed = Math.hypot(lv.x, lv.z);
      if (!(speed > 2)) continue;
      const tr = v.behavior.body.translation();
      const x = tr.x, z = tr.z;
      if (speed >= 8) near(x, z, 6, (p) => { if (p.st !== PED_ST.KNOCKED) scarePed(p, city, x, z, 3); });
      if (speed < HIT_SPEED) continue;
      const by = v.driver ?? null;
      near(x, z, HIT_R + 0.8, (p) => {
        if (p.st === PED_ST.KNOCKED || p.gone) return;
        knockPed(p);
        bus.emit('pedKnocked', { pedId: p.id, by, x: p.x, z: p.z });
        if (by) bus.emit('crime', { kind: 'pieton_renverse', by, x: p.x, z: p.z });
      });
    }
  };

  const onShot = (x: number, z: number, radius = 25) => {
    near(x, z, radius, (p) => scarePed(p, city, x, z, 6 + rand() * 4));
  };

  bus.on('crime', (e) => {
    if (e.kind === 'tir') onShot(e.x, e.z, 25);
    else if (e.kind === 'explosion') onShot(e.x, e.z, 45);
    else if (e.kind === 'agression_flic') onShot(e.x, e.z, 14);
  });

  return {
    id: 'peds',
    get peds() { return peds; },
    onShot,
    postStep() {
      tick++;
      for (const p of peds) stepPed(p, city, STEP);
      rebuildGrid();
      knockByVehicles();
      if (tick % 30 === 0) { managePopulation(); rebuildGrid(); }
    },
    pedsFlat() {
      const out: number[] = new Array(peds.length * PED_STRIDE);
      let k = 0;
      for (const p of peds) {
        out[k++] = p.id;
        out[k++] = kindIndex(p.kind);
        out[k++] = Math.round(p.x * 100) / 100;
        out[k++] = Math.round(p.z * 100) / 100;
        out[k++] = Math.round(p.yaw * 100) / 100;
        out[k++] = p.st;
      }
      return out;
    },
    serialize() { return { v: 1, seed: rng }; },
    restore(data) {
      const d = data as { seed?: unknown } | null;
      const s = d && typeof d === 'object' && typeof d.seed === 'number' && Number.isFinite(d.seed) ? Math.floor(d.seed) : NaN;
      if (s >= 1 && s < 2147483647) { seed = s; rng = s; }
    },
  };
};
