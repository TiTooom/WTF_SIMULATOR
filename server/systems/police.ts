// PROPRIÉTAIRE : game-missions
// Police : étoiles par joueur (shared/wanted.ts), voitures de police du pool qui poursuivent et percutent, arrestation, mort.
// Règles : aucune référence de corps conservée entre deux ticks (VRef + sim.resolveRef + bodyOk) ; serialize() sans lire Rapier ;
// violence « Chinatown Wars » (explosions, voitures qui volent) mais jamais de sang.
//  - Crimes : écoute `crime` (tir filtré par témoins), `pedKnocked` (flic renversé = agression), `vehicleDestroyed`, `enteredVehicle`,
//    `cameraDestroyed`, `playerDied`, `debug` (`/debug stars <n>`).
//  - Détruire une voiture de police : `copDestroyed` (une étoile en moins toutes les COPS_PER_STAR_DROP destructions).
//  - Arrestation : à pied, avec ≥ 1 étoile, un flic (piéton `flic` du système peds, ou voiture de police près de soi) à moins de
//    BUST_R pendant BUST_S secondes -> `playerBusted` (l'économie confisque sac + part de l'argent), retour au commissariat, event `arrete`.
//  - Mort : event `mort`, puis réapparition à l'hôpital une fois que la simulation a relevé le joueur.
// FURTIVITÉ (shared/hiding.ts, shared/wanted.ts) :
//  - Vision : chaque voiture de police (60 m, 110°) et chaque flic à pied (45 m, 100°) a un cône dans son sens de marche ; les caméras de surveillance
//    intactes balayent ± 50° (35 m) ; à moins de 7 m on est perçu dans toutes les directions ; les bâtiments bloquent la vue (lineOfSight).
//  - États (`ws` publié dans l'état privé) : 0 libre, 1 repéré (vu : poursuite directe), 2 recherche (dernière position connue, puis quadrillage lent),
//    3 caché. Non vu pendant LOSE_DELAY_S[étoiles - 1] secondes : une étoile tombe, puis la suivante, jusqu'à 0. Revu : le compteur repart.
//  - Cachettes : E près d'une cachette (avec au moins 1 étoile) cache le joueur (immobile, an = 5, invisible, ni conduite ni tir) ; E ou un mouvement
//    ressort. Grillée si un flic ≤ 15 m en ligne de vue le voit entrer. Un flic à ≤ 3 m d'un joueur caché le découvre. En recherche, une voiture
//    qui arrive sur son point de quadrillage fouille la cachette la plus proche de la dernière position connue avec 25 % de chances (jamais deux fois la même de suite).
//  - Une voiture est visible comme un piéton ; la police ne suit que le joueur, jamais une voiture vide : l'abandonner (même dans un garage) la rend sans effet.
import type { SimPlayer, VRef } from '../../shared/api';
import { bodyOk } from '../../shared/guard';
import type { GameSystem, SystemFactory } from '../../shared/game';
import type { CrimeKind } from '../../shared/ids';
import type { Mark, PrivateState } from '../../shared/protocol';
import { newDriveMem, steerTo, type DriveMem, type Pose } from '../../shared/ai/drive';
import { canSee, copCameraCones, lineOfSight as canSeeLine, hidingSpots, nearestHidingSpot, VISION, type CopEye, type HidingSpot, type VisionCone } from '../../shared/hiding';
import { PED_ST } from '../../shared/peds';
import type { EconomySystem } from './economy';
import { nearestLane } from '../../shared/city/lanes';
import { addCrime, copAccelFactor, copDestroyed, copSpeed, copsWanted, copTurnFactor, HEAT_MAX, heatOfStars, newWanted, searchPhase, starProgress, starsOf, tickWanted, unseenLeft, type WantedState } from '../../shared/wanted';
import type { PedsSystem } from './peds';

export const POLICE_POOL_MAX = 10; // taille du pool de voitures de police (shared/constants VEHICLE_POOL.police)
export const BUST_R = 2; // m : distance d'un flic à pied
export const BUST_CAR_R = 3.5; // m : distance d'une voiture de police (le policier en descend)
export const BUST_S = 2; // s de contact continu
const AI_EVERY = 3; // ticks entre deux décisions de conduite (20 Hz)
const AI_DT = AI_EVERY / 60;
const SPAWN_EVERY = 30; // ticks (0,5 s) : au plus une voiture de police créée par passage
const SPAWN_MIN = 100, SPAWN_MAX = 150; // m : loin, toujours hors du champ de vue
const FIRST_SPAWN_MS = 3000; // délai entre le premier crime et l'arrivée de la première voiture
const REINFORCE_MS = 6000; // délai entre deux voitures (pas de renfort instantané)
const QUADRILLE_PART = 0.45; // part de la vitesse de poursuite pendant le quadrillage
const GOTO_PART = 0.85; // part de la vitesse pour rejoindre la dernière position connue
const GOTO_DONE = 25; // m : la voiture est « arrivée » à la dernière position connue
const FOUILLE_CHANCE = 0.25, FOUILLE_COOLDOWN_MS = 6000, FOUILLE_RADIUS = 30;
const BURN_MS = 60_000; // une cachette grillée reste inutilisable aussi longtemps
const HOLD_SEEN_MS = 3000; // un joueur découvert reste « repéré » au moins ce temps
const FAR_RELEASE = 230; // m : une voiture trop loin de tous les joueurs est recyclée
const MARK_R = 130;
const MAX_SAVED = 64;
const DEBOUNCE_MS: Partial<Record<CrimeKind, number>> = { vol_vehicule: 1500, deal_vu: 1500, camera_detruite: 1500, explosion: 1500, agression_flic: 3000, tir: 3000 };
/** Portée d'un coup ou d'un tir à mains nues (m) : aucune arme à distance n'existe encore ; un clic plus loin ne touche rien. */
export const SHOT_REACH = 3;
/** Distance (m) à laquelle un flic ou une voiture de police placé dans la direction de visée voit une menace. */
export const THREAT_R = 6;
export type ShotImpact = 'rien' | 'pieton' | 'flic' | 'vehicule' | 'decor';

export interface PoliceSystem extends GameSystem {
  /** Étoiles (0..5) d'un joueur (0 si inconnu). */
  starsOf(playerId: string): number;
  /** Chaleur brute d'un joueur. */
  heatOf(playerId: string): number;
  /** Nombre de voitures de police actuellement pilotées par ce système. */
  readonly carCount: number;
  /** Fixe l'indice d'un joueur (0..5 ; missions, activités). Sans effet si le joueur est inconnu. */
  setStars(playerId: string, stars: number): void;
  /** Cachette où le joueur est caché (null sinon). */
  hiddenIn(playerId: string): HidingSpot | null;
  /** État de recherche (WS) : 0 libre, 1 repéré, 2 recherche, 3 caché. */
  phaseOf(playerId: string): number;
  /** Dernière position connue du joueur par la police. */
  lastKnownOf(playerId: string): { x: number; z: number } | null;
}

interface HideState { spot: HidingSpot; armed: boolean; burned: boolean; since: number }
interface PState {
  w: WantedState; bust: number; ws: number; last: Map<CrimeKind, number>; seenBy: boolean; lastVictim: number;
  lk: { x: number; z: number } | null; // dernière position connue du joueur
  lkRoad: { src: { x: number; z: number }; x: number; z: number } | null; // point de la chaussée le plus proche de `lk` (cache)
  hide: HideState | null;
  phase: number; // WS publié
  holdSeenUntil: number; // ms de simulation
  fouilleAt: number; // ms : pas de nouvelle fouille avant
  lastSearched: string | null;
}
interface Car {
  ref: VRef; mem: DriveMem; lastHp: number; siren: boolean; x: number; z: number; speed: number; yaw: number;
  wp: { x: number; z: number } | null; wpAt: number; fouille: HidingSpot | null; onSite: boolean;
}

/**
 * Commandes d'une voiture de police : steerTo plafonné à copSpeed(étoiles) × `speedScale`, avec une poussée et un braquage réduits
 * (copAccelFactor / copTurnFactor) : la police est moins vive que la citadine du joueur. Exportée pour les tests.
 */
export function copInput(pose: Pose, target: { x: number; z: number }, stars: number, mem: DriveMem, opts: { dt?: number; speedScale?: number; arrive?: number } = {}): { f: number; s: number; jump: number } {
  const out = steerTo(pose, target, { maxSpeed: copSpeed(stars) * (opts.speedScale ?? 1), arriveRadius: opts.arrive ?? 1.5, dt: opts.dt ?? AI_DT, mem });
  let f = out.f ?? 0;
  if (f > 0) f *= copAccelFactor(stars);
  return { f, s: (out.s ?? 0) * copTurnFactor(stars), jump: out.jump ?? 0 };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const BAD = new Set(['__proto__', 'constructor', 'prototype']);

export const createPolice: SystemFactory = (ctx): PoliceSystem => {
  const { sim, bus, city } = ctx;
  const states = new Map<string, PState>();
  const saved = new Map<string, { heat: number; kills: number }>(); // état restauré, appliqué à l'arrivée du joueur
  const cars = new Map<number, Car>(); // id de véhicule -> voiture pilotée par la police (VRef revalidée à chaque lecture)
  const hospitalQueue = new Set<string>(); // morts en attente de réapparition (transférés à l'hôpital)
  let tick = 0;
  let nextSpawnAt = 0; // ms de simulation : pas de renfort avant
  let wasWanted = false;
  let idleTicks = 0; // durée sans aucune recherche (recyclage des voitures)
  let rng = 987654;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  const commissariat = city.poisOf('commissariat')[0];
  const hopital = city.poisOf('hopital')[0];
  const pedsSys = () => ctx.get<PedsSystem>('peds');
  const spots = hidingSpots(city);
  const cameras = city.poisOf('camera');
  const destroyedCams = new Set<string>(); // caméras vues détruites sur le bus (repli si l'économie n'expose pas isCameraDown)
  bus.on('cameraDestroyed', (e) => { if (typeof e.id === 'string') destroyedCams.add(e.id); });
  const camDown = (id: string): boolean => {
    const eco = ctx.get<EconomySystem>('economy') as (EconomySystem & { isCameraDown?: (id: string) => boolean }) | undefined;
    if (!eco) return destroyedCams.has(id);
    if (typeof eco.isCameraDown === 'function') return !!eco.isCameraDown(id);
    if (eco.camerasDown() === 0) { destroyedCams.clear(); return false; }
    return destroyedCams.has(id);
  };
  const burned = new Map<string, number>(); // cachette -> ms de simulation de fin de grillage
  const coneBuf: VisionCone[] = [];

  const ensure = (p: SimPlayer): PState => {
    let s = states.get(p.id);
    if (!s) {
      s = { w: newWanted(), bust: 0, ws: -1, last: new Map(), seenBy: false, lastVictim: -1, lk: null, lkRoad: null, hide: null, phase: 0, holdSeenUntil: 0, fouilleAt: 0, lastSearched: null };
      const key = saved.has(p.name) ? p.name : p.id; // sauvegarde par pseudo (les identifiants p1, p2… changent à chaque démarrage)
      const sv = saved.get(key);
      if (sv) { s.w = { heat: sv.heat, kills: sv.kills, calm: 0 }; saved.delete(key); }
      states.set(p.id, s);
    }
    return s;
  };
  const publish = (p: SimPlayer, s: PState) => {
    const n = starsOf(s.w.heat);
    if (n !== s.ws) { s.ws = n; sim.setPlayerSnap(p.id, { ws: n }); }
  };
  const noteHeat = (p: SimPlayer, s: PState) => { // les flics sont prévenus du lieu du crime
    const q = sim.playerPos(p);
    s.lk = { x: q[0], z: q[2] };
  };
  const unhide = (p: SimPlayer, s: PState) => {
    if (!s.hide) return;
    s.hide = null;
    sim.setPlayerSnap(p.id, { an: 0 });
  };
  const found = (p: SimPlayer, s: PState, text: string) => {
    unhide(p, s);
    noteHeat(p, s);
    s.holdSeenUntil = sim.time + HOLD_SEEN_MS;
    s.w = { ...s.w, calm: 0 };
    ctx.sendTo(p.id, { k: 'toast', text });
  };
  const alive = (p: SimPlayer) => p.hp > 0 && sim.players.get(p.id) === p;

  // ---------- Témoins ----------
  const witnessed = (x: number, z: number): boolean => {
    const peds = pedsSys()?.peds;
    if (peds) {
      for (const q of peds) {
        if (q.gone) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d <= (q.kind === 'flic' ? 60 : 25)) return true;
      }
    }
    for (const c of cars.values()) if (Math.hypot(c.x - x, c.z - z) <= 60) return true;
    return false;
  };

  // ---------- Crimes ----------
  // `victim` : id d'un piéton touché ; une victime différente de la précédente contourne l'anti-rafale d'un tir.
  const commit = (p: SimPlayer, kind: CrimeKind, victim = -1) => {
    if (!alive(p)) return;
    const s = ensure(p);
    const gap = DEBOUNCE_MS[kind];
    if (gap) { // doublons entre systèmes : un seul compte ; un tir : au plus une fois par rafale de 3 s
      const t = s.last.get(kind) ?? -1e9;
      const fresh = kind === 'tir' && victim >= 0 && victim !== s.lastVictim;
      if (sim.time - t < gap && !fresh) return;
      s.last.set(kind, sim.time);
      if (kind === 'tir') s.lastVictim = victim;
    }
    s.w = addCrime(s.w, kind);
    noteHeat(p, s);
    publish(p, s);
  };

  /**
   * Que touche un coup/tir ? Piéton ou flic sur le rayon de visée à moins de SHOT_REACH, véhicule via sim.raycastProbe, sinon rien.
   * `threat` : un flic ou une voiture de police se trouve dans la direction de visée à courte portée. Tout doute = 'rien'.
   */
  const classifyShot = (p: SimPlayer, x: number, z: number): { impact: ShotImpact; victim: number; threat: boolean } => {
    const none = { impact: 'rien' as ShotImpact, victim: -1, threat: false };
    const ad = p.input?.ad;
    if (!ad || !Number.isFinite(x + z + ad[0] + ad[1] + ad[2])) return none;
    const hl = Math.hypot(ad[0], ad[2]);
    const n3 = Math.hypot(ad[0], ad[1], ad[2]);
    if (hl < 1e-4 || n3 < 1e-4) return none;
    const dx = ad[0] / hl, dz = ad[2] / hl;
    let best: { impact: ShotImpact; victim: number } | null = null, bt = Infinity, threat = false;
    const peds = pedsSys()?.peds;
    if (peds) {
      for (const q of peds) {
        if (q.gone) continue;
        const rx = q.x - x, rz = q.z - z;
        const t = rx * dx + rz * dz;
        const side = Math.abs(rx * dz - rz * dx);
        if (q.kind === 'flic' && t > 0 && t <= THREAT_R && side <= 3 + t * 0.35) threat = true;
        if (t < -0.3 || t > SHOT_REACH || side > 0.9) continue;
        if (t < bt) { bt = t; best = { impact: q.kind === 'flic' ? 'flic' : 'pieton', victim: q.id }; }
      }
    }
    for (const c of cars.values()) {
      const rx = c.x - x, rz = c.z - z, t = rx * dx + rz * dz;
      if (t > 0 && t <= THREAT_R && Math.abs(rx * dz - rz * dx) <= 3 + t * 0.35) threat = true;
    }
    if (best) return { ...best, threat };
    if (bodyOk(p.body)) {
      const h = sim.raycastProbe(x, sim.playerPos(p)[1] + 0.7, z, ad[0] / n3, ad[1] / n3, ad[2] / n3, SHOT_REACH, p.body);
      if (h?.kind === 'vehicle') return { impact: 'vehicule', victim: -1, threat };
    }
    return { impact: 'rien', victim: -1, threat };
  };

  bus.on('crime', (e) => {
    if (e.kind === 'flic_detruit') return; // chaleur nulle : l'effet (baisse) est traité dans vehicleDestroyed
    if (e.kind === 'tir') {
      // Un clic dans le vide ou contre le décor ne donne AUCUNE chaleur (repli sûr : rien). `impact` (game.ts) prime s'il est fourni.
      const given = (e as { impact?: unknown }).impact;
      const c = classifyShot(e.by, e.x, e.z);
      const impact: ShotImpact = given === 'pieton' || given === 'flic' || given === 'vehicule' || given === 'decor' || given === 'rien' ? given : c.impact;
      if (impact === 'flic') commit(e.by, 'agression_flic');
      else if (impact === 'pieton') commit(e.by, 'tir', c.impact === 'pieton' ? c.victim : -1);
      else if (impact === 'vehicule') { if (witnessed(e.x, e.z)) commit(e.by, 'tir'); }
      else if (impact === 'rien' && given === undefined && c.threat) commit(e.by, 'tir'); // poing levé sous les yeux d'un flic
      return;
    }
    commit(e.by, e.kind);
  });

  bus.on('pedKnocked', (e) => {
    if (!e.by) return;
    const q = pedsSys()?.peds.find((x) => x.id === e.pedId);
    if (q && q.kind === 'flic') commit(e.by, 'agression_flic');
  });

  bus.on('cameraDestroyed', (e) => { if (e.by) commit(e.by, 'camera_detruite'); });

  bus.on('enteredVehicle', ({ p, v }) => {
    const mine = cars.get(v.id);
    if (mine) { cars.delete(v.id); v.ai = null; } // volée : elle n'est plus pilotée par la police
    const kept = (v as { keep?: boolean }).keep === true;
    if (!kept && (mine || v.def.type === 'police' || v.ai || v.locked)) commit(p, 'vol_vehicule');
  });

  bus.on('vehicleDestroyed', ({ v, by }) => {
    const culprit = by ?? (v.lastHitBy ? sim.players.get(v.lastHitBy) ?? null : null);
    cars.delete(v.id);
    if (v.def.type === 'police') {
      let target = culprit;
      if (!target) { // aucune attribution : le joueur recherché le plus proche (à moins de 40 m) est crédité
        const x = v.home.x, z = v.home.z;
        let best = 40;
        for (const p of sim.players.values()) {
          const s = states.get(p.id);
          if (!s || starsOf(s.w.heat) === 0) continue;
          const q = sim.playerPos(p);
          const d = Math.hypot(q[0] - x, q[2] - z);
          if (d < best) { best = d; target = p; }
        }
      }
      if (!target || !alive(target)) return;
      const s = ensure(target);
      const before = starsOf(s.w.heat);
      s.w = copDestroyed(s.w);
      publish(target, s);
      const q = sim.playerPos(target);
      bus.emit('crime', { kind: 'flic_detruit', by: target, x: q[0], z: q[2] });
      if (starsOf(s.w.heat) < before) ctx.sendTo(target.id, { k: 'toast', text: 'Une voiture de police en moins : on vous cherche moins.' });
      return;
    }
    // Voiture civile (trafic) détruite par un joueur : explosion remarquée. Sa propre voiture ne compte pas.
    if (culprit && v.ai) {
      const t = sim.playerPos(culprit);
      bus.emit('crime', { kind: 'explosion', by: culprit, x: t[0], z: t[2] });
    }
  });

  bus.on('playerDied', ({ p }) => {
    const s = states.get(p.id);
    if (s) { s.w = newWanted(); s.bust = 0; s.lk = null; unhide(p, s); publish(p, s); }
    hospitalQueue.add(p.id);
    ctx.sendTo(p.id, { k: 'mort' });
  });

  bus.on('debug', ({ p, what, arg }) => {
    if (what !== 'stars') return;
    const n = Number.parseInt(arg, 10);
    if (!Number.isFinite(n)) return;
    const s = ensure(p);
    const stars = Math.max(0, Math.min(5, n));
    s.w = { heat: heatOfStars(stars), kills: 0, calm: 0 };
    if (stars > 0) noteHeat(p, s); else s.lk = null;
    publish(p, s);
  });

  // ---------- Arrestation ----------
  const bust = (p: SimPlayer, s: PState) => {
    s.w = newWanted();
    s.bust = 0;
    s.lk = null;
    unhide(p, s);
    publish(p, s);
    bus.emit('playerBusted', { p }); // l'économie confisque le sac et une part de l'argent (BUST_MONEY_LOSS)
    if (commissariat && bodyOk(p.body)) {
      sim.teleportPlayer(p, commissariat.x, 1.3, commissariat.z);
      p.invulnUntil = sim.time + 3000;
      p.hp = Math.max(p.hp, 50);
    }
    ctx.sendTo(p.id, { k: 'arrete' });
  };

  // ---------- Conduite et population des voitures ----------
  const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
  const liveCar = (id: number, c: Car) => {
    const v = sim.resolveRef(c.ref);
    if (!v || v.driver) { cars.delete(id); return null; } // recyclée, détruite ou volée
    return v;
  };

  const refreshCars = () => {
    for (const [id, c] of [...cars]) {
      const v = liveCar(id, c);
      if (!v) continue;
      const b = v.behavior.body;
      if (!bodyOk(b)) { cars.delete(id); continue; }
      const t = b.translation();
      c.x = t.x; c.z = t.z;
      c.speed = sim.forwardSpeed(b);
      const yw = yawOf(sim.quatOf(b));
      if (Number.isFinite(yw)) c.yaw = yw;
      if (v.hp < c.lastHp - 4 && v.lastHitBy) { // un joueur abîme une voiture de police
        const by = sim.players.get(v.lastHitBy);
        if (by) commit(by, 'agression_flic');
      }
      c.lastHp = v.hp;
    }
  };

  type Wanted = { p: SimPlayer; s: PState; pos: [number, number, number]; seen: boolean };

  /** Point de chaussée le plus proche (une voiture ne roule pas dans les bâtiments) ; le point lui-même si aucune voie à 70 m. */
  const snap = (x: number, z: number): { x: number; z: number } => {
    const near = nearestLane(city, x, z, 70);
    if (!near) return { x, z };
    const { lane, t } = near;
    return { x: lane.x0 + (lane.x1 - lane.x0) * t, z: lane.z0 + (lane.z1 - lane.z0) * t };
  };
  const lkRoadOf = (s: PState): { x: number; z: number } | null => {
    const lk = s.lk;
    if (!lk) return null;
    if (!s.lkRoad || s.lkRoad.src !== lk) { const r = snap(lk.x, lk.z); s.lkRoad = { src: lk, x: r.x, z: r.z }; }
    return s.lkRoad;
  };

  /** Une voiture arrivée sur son point de quadrillage : fouille éventuelle d'une cachette proche de la dernière position connue. */
  const maybeFouille = (c: Car, w: Wanted) => {
    const lk = w.s.lk;
    if (!lk || sim.time < w.s.fouilleAt) return;
    w.s.fouilleAt = sim.time + FOUILLE_COOLDOWN_MS;
    if (rand() >= FOUILLE_CHANCE) return;
    let best: HidingSpot | null = null, bd = FOUILLE_RADIUS;
    for (const sp of spots) {
      if (sp.id === w.s.lastSearched) continue; // pas deux fois de suite la même
      const d = Math.hypot(sp.x - lk.x, sp.z - lk.z);
      if (d < bd) { bd = d; best = sp; }
    }
    if (!best) return;
    w.s.lastSearched = best.id;
    c.fouille = best;
    c.wp = snap(best.x, best.z);
    c.wpAt = sim.time;
  };

  const driveCars = (wantedPlayers: Wanted[]) => {
    for (const [id, c] of [...cars]) {
      const v = liveCar(id, c);
      if (!v || !v.ai) continue;
      // Joueur visé : le plus proche de sa position connue (réelle s'il est repéré, sinon la dernière position connue)
      let tgt: Wanted | null = null;
      let bd = Infinity;
      for (const w of wantedPlayers) {
        const ax = w.seen || !w.s.lk ? w.pos[0] : w.s.lk.x, az = w.seen || !w.s.lk ? w.pos[2] : w.s.lk.z;
        const d = Math.hypot(ax - c.x, az - c.z);
        if (d < bd) { bd = d; tgt = w; }
      }
      const inp = v.ai.input;
      if (!tgt) { inp.f = 0; inp.s = 0; inp.jump = 0; inp.hn = 0; continue; }
      const b = v.behavior.body;
      if (!bodyOk(b)) { cars.delete(id); continue; }
      const stars = starsOf(tgt.s.w.heat);
      let target: { x: number; z: number };
      let scale = 1, arrive = 1.5;
      if (tgt.seen || !tgt.s.lk) { // repéré : poursuite directe
        target = { x: tgt.pos[0], z: tgt.pos[2] };
        c.wp = null; c.fouille = null; c.onSite = false;
      } else {
        const lk = lkRoadOf(tgt.s) ?? tgt.s.lk; // on rejoint la chaussée la plus proche de la dernière position connue
        if (!c.onSite && Math.hypot(lk.x - c.x, lk.z - c.z) <= GOTO_DONE) c.onSite = true;
        if (!c.onSite) { // rejoindre la dernière position connue
          target = lk; scale = GOTO_PART; arrive = 6;
        } else { // quadrillage lent autour de la dernière position connue
          if (!c.wp || sim.time - c.wpAt > 14_000) {
            const a = rand() * Math.PI * 2, d = 20 + rand() * 50;
            c.wp = snap(lk.x + Math.cos(a) * d, lk.z + Math.sin(a) * d);
            c.wpAt = sim.time; c.fouille = null;
          }
          target = c.wp; scale = QUADRILLE_PART; arrive = 6;
          if (Math.hypot(c.wp.x - c.x, c.wp.z - c.z) < 10) {
            const f = c.fouille;
            c.wp = null; c.fouille = null;
            if (f) { // fouille effectuée : le joueur est-il caché ici ?
              const h = tgt.s.hide;
              if (h && !h.burned && h.spot.id === f.id) found(tgt.p, tgt.s, 'Un policier fouille votre cachette : vous êtes découvert !');
            } else maybeFouille(c, tgt);
          }
        }
      }
      const out = copInput({ x: c.x, z: c.z, yaw: c.yaw, speed: c.speed }, target, stars, c.mem, { dt: AI_DT, speedScale: scale, arrive });
      inp.f = out.f; inp.s = out.s; inp.jump = out.jump;
      inp.hn = !c.siren ? 1 : 0; // front montant unique : allume la sirène
      c.siren = true;
    }
  };

  const release = (id: number) => {
    const c = cars.get(id);
    cars.delete(id);
    if (!c) return;
    const v = sim.resolveRef(c.ref);
    if (v) sim.releaseVehicle(v);
  };

  const spawnCar = (wantedPlayers: { pos: [number, number, number] }[]) => {
    if (cars.size >= POLICE_POOL_MAX || !wantedPlayers.length) return;
    const all: [number, number][] = [];
    for (const p of sim.players.values()) { const q = sim.playerPos(p); all.push([q[0], q[2]]); }
    for (let attempt = 0; attempt < 6; attempt++) {
      const o = wantedPlayers[Math.floor(rand() * wantedPlayers.length)].pos;
      const a = rand() * Math.PI * 2, d = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
      const near = nearestLane(city, o[0] + Math.cos(a) * d, o[2] + Math.sin(a) * d, 30);
      if (!near) continue;
      const { lane, t } = near;
      const x = lane.x0 + (lane.x1 - lane.x0) * t, z = lane.z0 + (lane.z1 - lane.z0) * t;
      if (all.some(([px, pz]) => Math.hypot(px - x, pz - z) < SPAWN_MIN - 5)) continue; // jamais en vue d'un joueur
      const v = sim.acquireVehicle('police', x, z, lane.yaw, { ai: true });
      if (!v) return; // pool vide : on réessaiera plus tard
      cars.set(v.id, { ref: sim.refOf(v), mem: newDriveMem(), lastHp: v.hp, siren: false, x, z, speed: 0, yaw: lane.yaw, wp: null, wpAt: 0, fouille: null, onSite: false });
      nextSpawnAt = sim.time + REINFORCE_MS;
      return;
    }
  };

  const manageCars = (wantedPlayers: Wanted[]) => {
    if (wantedPlayers.length && !wasWanted) nextSpawnAt = Math.max(nextSpawnAt, sim.time + FIRST_SPAWN_MS); // l'alerte met du temps à arriver
    wasWanted = wantedPlayers.length > 0;
    let desired = 0;
    for (const w of wantedPlayers) desired += copsWanted(starsOf(w.s.w.heat));
    desired = Math.min(POLICE_POOL_MAX, desired);
    idleTicks = wantedPlayers.length ? 0 : idleTicks + SPAWN_EVERY;
    if (cars.size < desired) { if (sim.time >= nextSpawnAt) spawnCar(wantedPlayers); return; }
    // Distances à tous les joueurs (recyclage des voitures inutiles ou perdues)
    const players: [number, number][] = [];
    for (const p of sim.players.values()) { const q = sim.playerPos(p); players.push([q[0], q[2]]); }
    const nearestPlayer = (c: Car) => {
      let d = Infinity;
      for (const [px, pz] of players) d = Math.min(d, Math.hypot(px - c.x, pz - c.z));
      return d;
    };
    for (const [id, c] of [...cars]) {
      const d = nearestPlayer(c);
      if (d > FAR_RELEASE) { release(id); return; }
      if (cars.size > desired) {
        const need = idleTicks > 7200 ? 25 : 60; // hors vue ; au bout de 2 min sans recherche, même près
        if (d > need) { release(id); return; }
      }
    }
  };

  // ---------- Vision ----------
  const eyes: CopEye[] = [];
  type PedLike = { kind: string; gone: boolean; st: number; id: number; x: number; z: number; yaw: number };
  /** Remplit `coneBuf` : cônes de toutes les voitures de police, des flics à pied et des caméras intactes. */
  const buildCones = (peds: readonly PedLike[] | undefined) => {
    eyes.length = 0;
    for (const [id, c] of cars) eyes.push({ id, x: c.x, z: c.z, yaw: c.yaw, car: true });
    if (peds) for (const q of peds) if (q.kind === 'flic' && !q.gone && q.st !== PED_ST.KNOCKED) eyes.push({ id: q.id, x: q.x, z: q.z, yaw: q.yaw, car: false });
    copCameraCones(eyes, cameras, camDown, sim.time / 1000, coneBuf);
  };
  const seenByCones = (x: number, z: number): boolean => {
    for (const c of coneBuf) if (canSee(city, c, x, z)) return true;
    return false;
  };
  /** Un flic (toutes directions, ligne de vue) à moins de GRILLE_R m, ou une caméra dont le cône couvre le point ? */
  const spotted = (x: number, z: number, peds: readonly PedLike[] | undefined): boolean => {
    const r = VISION.GRILLE_R;
    for (const c of cars.values()) if (Math.hypot(c.x - x, c.z - z) <= r && canSeeLine(city, c.x, c.z, x, z)) return true;
    if (peds) for (const q of peds) if (q.kind === 'flic' && !q.gone && Math.hypot(q.x - x, q.z - z) <= r && canSeeLine(city, q.x, q.z, x, z)) return true;
    for (const c of coneBuf) if (c.kind === 'camera' && canSee(city, c, x, z)) return true;
    return false;
  };
  const nearCop = (x: number, z: number, r: number, peds: readonly PedLike[] | undefined): boolean => {
    for (const c of cars.values()) if (Math.hypot(c.x - x, c.z - z) <= r) return true;
    if (peds) for (const q of peds) if (q.kind === 'flic' && !q.gone && Math.hypot(q.x - x, q.z - z) <= r) return true;
    return false;
  };

  // ---------- Pas de jeu ----------
  const fast = () => {
    refreshCars();
    const peds = pedsSys()?.peds;
    buildCones(peds);
    const wantedPlayers: Wanted[] = [];
    for (const p of sim.players.values()) {
      const s = ensure(p);
      const pos = sim.playerPos(p);
      if (!alive(p)) { publish(p, s); continue; }
      let contact = false;
      for (const c of cars.values()) if (Math.hypot(c.x - pos[0], c.z - pos[2]) < BUST_CAR_R) contact = true;
      if (peds) for (const q of peds) if (q.kind === 'flic' && !q.gone && Math.hypot(q.x - pos[0], q.z - pos[2]) < BUST_R) contact = true;
      const starsBefore = starsOf(s.w.heat);
      // Vu ? Un joueur caché (cachette valable) est invisible aux cônes ; un flic tout près le découvre.
      let seen = false;
      if (starsBefore > 0) {
        const hiddenOk = !!s.hide && !s.hide.burned;
        if (hiddenOk) { if (nearCop(pos[0], pos[2], VISION.FIND_R, peds)) found(p, s, 'Un policier vous a débusqué !'); }
        if (!s.hide || s.hide.burned) seen = seenByCones(pos[0], pos[2]);
        if (sim.time < s.holdSeenUntil) seen = true;
        if (seen) s.lk = { x: pos[0], z: pos[2] };
      }
      s.seenBy = seen;
      s.w = tickWanted(s.w, AI_DT, seen);
      const stars = starsOf(s.w.heat);
      if (stars < starsBefore) {
        ctx.sendTo(p.id, { k: 'toast', text: stars === 0 ? 'Vous avez semé la police.' : `La police perd votre trace : ${stars} étoile${stars > 1 ? 's' : ''}.` });
        if (stars === 0) s.lk = null;
      }
      s.phase = searchPhase(stars, seen, !!s.hide && !s.hide.burned);
      publish(p, s);
      if (stars > 0) wantedPlayers.push({ p, s, pos, seen });
      // Arrestation : à pied, contact continu avec un flic (même pour un joueur caché : une arrestation en cours n'est pas interrompue)
      if (stars > 0 && !p.vehicle && contact && p.hp > 0 && sim.time >= p.invulnUntil) {
        s.bust += AI_DT;
        if (s.bust >= BUST_S) bust(p, s);
      } else s.bust = Math.max(0, s.bust - AI_DT * 2);
    }
    driveCars(wantedPlayers);
    if (tick % SPAWN_EVERY < AI_EVERY) manageCars(wantedPlayers);
  };

  // ---------- Cachettes ----------
  const tryHide = (p: SimPlayer): boolean => {
    const s = states.get(p.id);
    if (!s || !alive(p) || p.vehicle) return false;
    if (s.hide) { unhide(p, s); return true; } // E : on ressort
    if (starsOf(s.w.heat) === 0) return false; // sans recherche, E garde ses autres usages (monter, dealer, planque...)
    const pos = sim.playerPos(p);
    const spot = nearestHidingSpot(spots, pos[0], pos[2]);
    if (!spot) return false;
    const peds = pedsSys()?.peds;
    buildCones(peds);
    const isBurned = (burned.get(spot.id) ?? 0) > sim.time || spotted(pos[0], pos[2], peds);
    if (isBurned) burned.set(spot.id, sim.time + BURN_MS);
    if (burned.size > 400) burned.clear();
    s.hide = { spot, armed: false, burned: isBurned, since: sim.time };
    sim.setPlayerSnap(p.id, { an: 5 });
    if (isBurned) {
      noteHeat(p, s);
      s.holdSeenUntil = sim.time + HOLD_SEEN_MS;
      s.w = { ...s.w, calm: 0 };
      s.phase = 1;
      ctx.sendTo(p.id, { k: 'toast', text: 'Cachette grillée : un policier vous a vu entrer !' });
    } else {
      ctx.sendTo(p.id, { k: 'toast', text: 'Vous êtes caché. E ou un mouvement pour sortir.' });
    }
    return true;
  };

  /** Avant chaque pas : un joueur caché qui bouge, saute ou clique ressort (avant que la simulation ne le déplace ou ne le fasse tirer). */
  const watchHidden = () => {
    for (const [id, s] of states) {
      const h = s.hide;
      if (!h) continue;
      const p = sim.players.get(id);
      if (!p || !alive(p) || p.vehicle) { if (p) unhide(p, s); else s.hide = null; continue; }
      const i = p.input;
      const idle = !!i && Math.abs(i.f) < 0.2 && Math.abs(i.s) < 0.2 && !i.jump && !i.m1 && !i.m2;
      if (idle) h.armed = true; // il faut d'abord relâcher les touches pressées pour rejoindre la cachette
      else if (h.armed) unhide(p, s);
    }
  };

  const hospitalTransfer = () => {
    for (const id of [...hospitalQueue]) {
      const p = sim.players.get(id);
      if (!p) { hospitalQueue.delete(id); continue; }
      if (p.hp <= 0) continue; // la simulation ne l'a pas encore relevé
      hospitalQueue.delete(id);
      if (hopital && bodyOk(p.body)) {
        sim.teleportPlayer(p, hopital.x, 1.3, hopital.z);
        p.invulnUntil = sim.time + 3000;
      }
    }
  };

  return {
    id: 'police',
    get carCount() { return cars.size; },
    starsOf: (id) => starsOf(states.get(id)?.w.heat ?? 0),
    heatOf: (id) => states.get(id)?.w.heat ?? 0,
    setStars(id, n) {
      const p = sim.players.get(id);
      if (!p || typeof n !== 'number' || !Number.isFinite(n)) return;
      const s = ensure(p);
      s.w = { heat: heatOfStars(Math.max(0, Math.min(5, n))), kills: 0, calm: 0 };
      if (s.w.heat > 0) noteHeat(p, s); else s.lk = null;
      publish(p, s);
    },
    preStep() { watchHidden(); },
    onInteract: (p) => tryHide(p),
    canEnter: (p) => (states.get(p.id)?.hide ? false : undefined),
    /** Cachette où se trouve le joueur (null sinon) : tests, HUD. */
    hiddenIn: (id: string) => states.get(id)?.hide?.spot ?? null,
    /** État de recherche (WS 0..3) du joueur. */
    phaseOf: (id: string) => states.get(id)?.phase ?? 0,
    /** Dernière position connue du joueur par la police (null sinon). */
    lastKnownOf: (id: string) => { const l = states.get(id)?.lk; return l ? { x: l.x, z: l.z } : null; },
    postStep() {
      tick++;
      if (hospitalQueue.size) hospitalTransfer();
      if (tick % AI_EVERY === 0) fast();
    },
    onJoin(p) { publish(p, ensure(p)); },
    onLeave(p) {
      const s = states.get(p.id);
      if (s && s.w.heat > 0 && saved.size < MAX_SAVED) saved.set(p.name, { heat: s.w.heat, kills: s.w.kills });
      states.delete(p.id);
      hospitalQueue.delete(p.id);
    },
    privateView(p, out: PrivateState) {
      const s = states.get(p.id);
      out.stars = starsOf(s?.w.heat ?? 0);
      out.starProgress = s ? Math.round(starProgress(s.w.heat) * 100) / 100 : 0;
      // Détail de recherche pour le HUD : `ws` 0 libre, 1 repéré, 2 recherche, 3 caché ; `wl` = secondes avant la prochaine étoile perdue (si non vu)
      const o = out as PrivateState & { ws?: number; wl?: number };
      o.ws = s ? s.phase : 0;
      if (s && s.w.heat > 0 && !s.seenBy) o.wl = Math.ceil(unseenLeft(s.w));
      if (!cars.size) return;
      const pos = sim.playerPos(p);
      const list: { d: number; m: Mark }[] = [];
      for (const c of cars.values()) { // positions mises en cache par refreshCars : aucune lecture de Rapier ici
        const d = Math.hypot(c.x - pos[0], c.z - pos[2]);
        if (d <= MARK_R) list.push({ d, m: { x: Math.round(c.x), z: Math.round(c.z), k: 'danger', label: 'flic' } });
      }
      list.sort((a, b) => a.d - b.d);
      for (const e of list.slice(0, 6)) out.marks.push(e.m);
    },
    serialize() {
      const w: Record<string, { heat: number; kills: number }> = Object.create(null);
      let n = 0;
      for (const [id, s] of states) if (s.w.heat > 0 && n++ < MAX_SAVED) w[sim.players.get(id)?.name ?? id] = { heat: Math.round(s.w.heat * 10) / 10, kills: s.w.kills };
      for (const [id, s] of saved) if (n++ < MAX_SAVED && !(id in w)) w[id] = { heat: s.heat, kills: s.kills };
      return { v: 1, w };
    },
    restore(data) {
      if (!isObj(data) || !isObj(data.w)) return;
      let n = 0;
      for (const id of Object.keys(data.w)) {
        if (BAD.has(id) || id.length > 48 || n >= MAX_SAVED) continue;
        const e = (data.w as Record<string, unknown>)[id];
        if (!isObj(e)) continue;
        const heat = typeof e.heat === 'number' && Number.isFinite(e.heat) ? Math.max(0, Math.min(HEAT_MAX, e.heat)) : 0;
        const kills = typeof e.kills === 'number' && Number.isFinite(e.kills) ? Math.max(0, Math.min(10, Math.floor(e.kills))) : 0;
        if (heat > 0) { saved.set(id, { heat, kills }); n++; }
      }
    },
  };
};
