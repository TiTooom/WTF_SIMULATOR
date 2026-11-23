// PROPRIÉTAIRE : game-minigames
// Règles de chaque mini-jeu, partagées serveur/client : durées plausibles, distance d'annulation, « spec » déterministe tirée de la
// graine (le client anime exactement ce que le serveur sait recalculer) et validation du résultat. Le serveur ne fait jamais confiance
// au client : `validate` est appelé APRÈS les contrôles de durée (server/systems/minigames.ts) et ne lit que `seed`, `difficulty`, `result`.
import type { MinigameKind } from '../ids';
import type { MinigameResult } from '../protocol';

export interface MinigameRule {
  minMs: number; // durée minimale plausible (un résultat plus rapide est refusé)
  maxMs: number; // durée maximale (au-delà : échec) ; reste sous 4,5 s (consigne : micro-interaction < 4 s)
  cancelDist: number; // m : annulé si le joueur s'éloigne de plus que ça
  validate(seed: number, difficulty: number, result: MinigameResult): boolean;
}

// ---------- Outils déterministes ----------
export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Générateur déterministe (mulberry32) : même graine, mêmes tirages, serveur et client. */
export function rng(seed: number): () => number {
  let a = (Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const data = (r: MinigameResult): number[] => (Array.isArray(r.data) ? r.data : []);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ---------- tournevis : maintenir pour enfoncer, tourner en cercle jusqu'à briser le verrou ----------
export const tournevisSpec = (_seed: number, d: number) => ({
  turns: 3 + Math.floor(clamp01(d) * 2.99), // tours complets à effectuer (3..5)
  minPressMs: 150, // temps minimal d'enfoncement avant de tourner
  dir: _seed % 2 === 0 ? 1 : -1, // sens du verrou : 1 = horaire
});

// ---------- court_circuit : rapprocher deux câbles et maintenir 1 s ----------
export const HOTWIRE_HOLD_MS = 1000;
export function courtCircuitSpec(seed: number, d = 0) {
  const r = rng(seed);
  const dd = clamp01(d);
  return {
    ay: 0.28 + r() * 0.52, by: 0.28 + r() * 0.52, meetX: 0.4 + r() * 0.2, // hauteurs des bouts de câbles et point de contact (0..1)
    zoneR: 100 - 28 * dd, // rayon de la zone dénudée où il faut amener les deux bouts (px du canvas)
    contact: 30 - 8 * dd, // distance de contact entre les deux bouts
    decay: 1400 + 1600 * dd, // ms de jauge perdus par seconde quand le contact est rompu
  };
}

// ---------- digicode : 3 colonnes qui défilent, une zone verte chacune, clic pour stopper ----------
export const DIGI_COLS = 3;
export function digicodeSpec(seed: number, d: number) {
  const r = rng(seed);
  const dd = clamp01(d);
  const cols = Array.from({ length: DIGI_COLS }, () => ({
    center: 0.22 + r() * 0.56, // centre de la zone verte (0..1)
    half: 0.13 - 0.05 * dd, // demi-largeur
    speed: 0.75 + r() * 0.35 + dd * 0.35, // cycles (aller-retour) par seconde
    phase: r(), // décalage de départ
  }));
  return { cols, minGapMs: 120 };
}
/** Position (0..1, onde triangulaire) d'une colonne à l'instant t (ms depuis le début du jeu). */
export function digicodePos(col: { speed: number; phase: number }, tMs: number): number {
  const x = (col.phase + (col.speed * tMs) / 1000) % 1;
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

// ---------- dosage : 3 bouteilles à remplir jusqu'à la ligne ----------
export const DOSAGE_BOTTLES = 3;
export const DOSAGE_FILL_RATE = 1.1; // niveau (0..1) par seconde : le client ne peut pas remplir plus vite
export const DOSAGE_CLIENT_RATE = 1.0; // cadence réelle du client (légèrement sous la limite serveur)
export function dosageSpec(seed: number, d: number) {
  const r = rng(seed);
  return { targets: Array.from({ length: DOSAGE_BOTTLES }, () => 0.55 + r() * 0.35), tol: 0.1 - 0.04 * clamp01(d) };
}

// ---------- fouille : balayer les détritus pour dégager l'objet brillant ----------
export const FOUILLE_SLOTS = 5;
export function fouilleSpec(seed: number, d = 0) {
  return { slot: Math.floor(rng(seed)() * FOUILLE_SLOTS), swipes: clamp01(d) >= 0.5 ? 4 : 3 }; // balayages à faire sur le bon tas
}

// ---------- brise_glace : marteler la vitre (5 ou 6 coups) ----------
export const briseGlaceSpec = (_seed: number, d: number) => ({ hits: 5 + Math.floor(clamp01(d) * 1.99), maxCps: 16 });

// ---------- desamorcage : mémoriser le fil flashé, le trancher ----------
export const WIRE_COLORS = 4;
export const desamorcageSpec = (seed: number, d = 0) => ({ wire: Math.floor(rng(seed ^ 0x5bd1e995)() * WIRE_COLORS), flashMs: Math.round(600 - 250 * clamp01(d)) }); // le flash raccourcit avec la difficulté

// ---------- liasses : glisser le bon nombre de liasses ----------
export const liassesSpec = (seed: number, d = 0) => ({
  target: 3 + Math.floor(rng(seed ^ 0x1b873593)() * 2) + (clamp01(d) >= 0.5 ? 1 : 0), // 3..5 liasses
  maxOver: clamp01(d) >= 0.7 ? 0 : 1, // une de trop tolérée sauf en difficile
  perMs: 110,
});

// ---------- Règles ----------
const mk = (minMs: number, maxMs: number, validate: MinigameRule['validate'], cancelDist = 4): MinigameRule => ({ minMs, maxMs, cancelDist, validate });

export const RULES: Record<MinigameKind, MinigameRule> = {
  tournevis: mk(1300, 4200, (seed, d, r) => {
    const s = tournevisSpec(seed, d);
    const [turns, pressMs] = data(r);
    return r.ok && finite(turns) && finite(pressMs) && turns >= s.turns && pressMs >= s.minPressMs && r.ms >= 350 * s.turns * 0.6;
  }),
  court_circuit: mk(1300, 4200, (_seed, _d, r) => { // la zone et le contact sont jugés par le client ; le serveur ne vérifie que la tenue et la durée
    const [holdMs] = data(r);
    return r.ok && finite(holdMs) && holdMs >= HOTWIRE_HOLD_MS && r.ms >= holdMs + 150;
  }),
  digicode: mk(1000, 4200, (seed, d, r) => {
    const s = digicodeSpec(seed, d);
    const t = data(r);
    if (!r.ok || t.length !== DIGI_COLS || !t.every((x) => finite(x) && x >= 0)) return false;
    for (let i = 0; i < DIGI_COLS; i++) {
      if (i > 0 && t[i] - t[i - 1] < s.minGapMs) return false;
      if (Math.abs(digicodePos(s.cols[i], t[i]) - s.cols[i].center) > s.cols[i].half) return false;
    }
    return t[DIGI_COLS - 1] <= r.ms + 50;
  }),
  dosage: mk(1700, 4000, (seed, d, r) => {
    const s = dosageSpec(seed, d);
    const lv = data(r);
    if (!r.ok || lv.length !== DOSAGE_BOTTLES || !lv.every(finite)) return false;
    let sum = 0;
    for (let i = 0; i < DOSAGE_BOTTLES; i++) {
      if (lv[i] > 1 || Math.abs(lv[i] - s.targets[i]) > s.tol) return false; // débordement ou loin de la ligne
      sum += lv[i];
    }
    return r.ms >= (sum / DOSAGE_FILL_RATE) * 900;
  }),
  fouille: mk(900, 4000, (seed, d, r) => {
    const s = fouilleSpec(seed, d);
    const [slot, swipes] = data(r);
    return r.ok && slot === s.slot && finite(swipes) && swipes >= s.swipes && r.ms >= swipes * 120;
  }),
  brise_glace: mk(700, 4000, (seed, d, r) => {
    const s = briseGlaceSpec(seed, d);
    const [hits] = data(r);
    return r.ok && finite(hits) && hits >= s.hits && r.ms >= (hits / s.maxCps) * 1000;
  }),
  desamorcage: mk(800, 4000, (seed, d, r) => {
    const s = desamorcageSpec(seed, d);
    const [cut] = data(r);
    return r.ok && cut === s.wire && r.ms >= s.flashMs + 150;
  }),
  liasses: mk(900, 4200, (seed, d, r) => {
    const s = liassesSpec(seed, d);
    const [placed] = data(r);
    return r.ok && finite(placed) && Number.isInteger(placed) && placed >= s.target && placed <= s.target + s.maxOver && r.ms >= placed * s.perMs;
  }),
};
