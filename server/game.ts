// Logique de jeu au-dessus du moteur physique (Sim) : bus d'événements, systèmes (server/systems/*), état privé, sauvegarde.
// Le serveur appelle preStep/postStep à chaque pas ; une erreur dans un système ne doit jamais faire tomber la boucle
// (chaque appel est isolé ; un système qui échoue 20 pas de suite est suspendu et journalisé).
// Règles pour les systèmes : jamais de corps Rapier conservé entre deux ticks (VRef + sim.resolveRef), serialize() sans lire Rapier.
import type { SimPlayer } from '../shared/api';
import { getCity } from '../shared/city/layout';
import { GameBus, parseGameMsg, type GameCtx, type GameSystem, type SystemFactory } from '../shared/game';
import { SYSTEM_IDS, type SystemId } from '../shared/ids';
import { PED_STRIDE, type GameServerEvent, type PrivateState } from '../shared/protocol';
import type { Sim } from '../shared/sim';
import { registerCommand, requireHost } from './commands';
import { createActivities } from './systems/activities';
import { createEconomy } from './systems/economy';
import { createMinigames } from './systems/minigames';
import { createMissions } from './systems/missions';
import { createPeds } from './systems/peds';
import { createPolice } from './systems/police';
import { createTraffic } from './systems/traffic';

/** Systèmes installés, dans l'ordre d'appel (preStep/postStep). Chaque spécialiste remplit sa fabrique dans son fichier. */
export const SYSTEMS: SystemFactory[] = [createTraffic, createPeds, createPolice, createEconomy, createMinigames, createMissions, createActivities];

export interface GameOptions {
  mode: 'solo' | 'multi';
  /** État sauvegardé (`Game.serialize()` d'une partie précédente, lu depuis le disque : NON FIABLE). */
  saved?: unknown;
}

/** Événement sortant : `to` = id de joueur, null = tout le monde. */
export interface Outgoing { to: string | null; ev: GameServerEvent }

export interface Game {
  preStep(): void;
  postStep(): void;
  /** État de chaque système, JSON pur, calculé SANS lire Rapier. */
  serialize(): Record<string, unknown>;
  restore(saved: unknown): void;
  onJoin(player: SimPlayer): void;
  onLeave(player: SimPlayer): void;
  /** Message `game` d'un client : `raw` est `unknown`, validé ici avant d'atteindre un système. */
  onMessage(player: SimPlayer, raw: unknown): void;
  /** État privé du joueur (message `me`). */
  privateFor(player: SimPlayer): PrivateState;
  /** Événements à envoyer depuis le dernier appel (le serveur les route vers les sockets). */
  drainOutbox(): Outgoing[];
  /** Piétons à plat (PED_STRIDE nombres chacun) pour le snapshot ; liste vide si aucun système de piétons. */
  pedsFlat(): number[];
}

const MAX_OUTBOX = 400;
const MAX_PEDS = 160;
const MAX_MARKS = 16;
const FAIL_LIMIT = 20;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Bus par simulation, pour les commandes de debug (qui n'ont accès qu'au Sim). */
const busOf = new WeakMap<Sim, GameBus>();

registerCommand('debug', ({ sim, player, args, reply }) => {
  if (!requireHost({ sim, player, reply })) return;
  const what = (args[0] ?? '').toLowerCase();
  if (!['stars', 'money', 'mg'].includes(what)) return reply('Usage : /debug stars|money|mg <valeur>');
  const bus = busOf.get(sim);
  if (!bus) return reply('Le jeu n\'est pas prêt.');
  bus.emit('debug', { p: player, what, arg: String(args[1] ?? '').slice(0, 32) });
  reply(`debug ${what} transmis aux systèmes (aucun ne l'écoute encore en vague 1).`);
}, '/debug stars|money|mg <valeur> : outils de mise au point (chef de la bande)');

export function installGame(sim: Sim, opts: GameOptions): Game {
  const city = getCity();
  const bus = new GameBus();
  bus.onError = (event, e) => sim.log(`[game] écouteur « ${event} » : ${(e as Error)?.stack ?? e}`);
  busOf.set(sim, bus);
  const outbox: Outgoing[] = [];
  const push = (o: Outgoing) => { if (outbox.length < MAX_OUTBOX) outbox.push(o); };
  const systems: GameSystem[] = [];
  const byId = new Map<SystemId, GameSystem>();
  const fails = new Map<GameSystem, number>();
  const suspended = new Set<GameSystem>();

  const ctx: GameCtx = {
    sim, bus, city, mode: opts.mode,
    sendTo: (playerId, ev) => push({ to: String(playerId), ev }),
    broadcast: (ev) => push({ to: null, ev }),
    get: <T extends GameSystem = GameSystem>(id: SystemId) => byId.get(id) as T | undefined,
  };

  /** Exécute `fn` en isolant ses erreurs ; une panique Rapier est signalée au monde (le disjoncteur reconstruira). */
  const guard = <T>(sys: GameSystem, what: string, fn: () => T): T | undefined => {
    if (suspended.has(sys)) return undefined;
    try {
      const r = fn();
      fails.set(sys, 0);
      return r;
    } catch (e) {
      if (sim.noteError(e)) return undefined;
      const n = (fails.get(sys) ?? 0) + 1;
      fails.set(sys, n);
      if (n === 1 || n % 10 === 0) sim.log(`[game] système ${sys.id}, ${what} : ${(e as Error)?.stack ?? e}`);
      if (n >= FAIL_LIMIT) { suspended.add(sys); sim.log(`[game] système ${sys.id} suspendu après ${n} erreurs consécutives`); }
      return undefined;
    }
  };

  for (const make of SYSTEMS) {
    try {
      const s = make(ctx);
      if (!SYSTEM_IDS.includes(s.id) || byId.has(s.id)) { sim.log(`[game] système ignoré : id invalide ou en double (${String(s.id)})`); continue; }
      systems.push(s);
      byId.set(s.id, s);
    } catch (e) {
      sim.log(`[game] création d'un système impossible : ${(e as Error)?.stack ?? e}`);
    }
  }

  // Branchements du moteur
  const run = <T>(f: (s: GameSystem) => T | undefined, what: string): T[] => {
    const out: T[] = [];
    for (const s of systems) { const r = guard(s, what, () => f(s)); if (r !== undefined) out.push(r); }
    return out;
  };
  sim.hooks = {
    onInteract: (p) => run((s) => s.onInteract?.(p), 'onInteract').some(Boolean),
    canEnter: (p, v) => {
      const r = run((s) => s.canEnter?.(p, v), 'canEnter');
      return r.includes(false) ? false : r.includes(true) ? true : undefined;
    },
    onEnter: (p, v) => bus.emit('enteredVehicle', { p, v }),
    onVehicleDestroyed: (v, by) => bus.emit('vehicleDestroyed', { v, by }),
    onPlayerKilled: (p, by, cause) => bus.emit('playerDied', { p, by, cause }),
    onShot: (p, origin) => bus.emit('crime', { kind: 'tir', by: p, x: origin[0], z: origin[2] }),
  };

  const game: Game = {
    preStep() { for (const s of systems) if (s.preStep) guard(s, 'preStep', () => s.preStep!()); },
    postStep() { for (const s of systems) if (s.postStep) guard(s, 'postStep', () => s.postStep!()); },
    serialize() {
      const out: Record<string, unknown> = {};
      for (const s of systems) {
        if (!s.serialize) continue;
        const r = guard(s, 'serialize', () => s.serialize!());
        if (r !== undefined) out[s.id] = r;
      }
      return out;
    },
    restore(saved) {
      if (!isObj(saved)) return;
      for (const s of systems) { // seules les clés connues (SYSTEM_IDS) sont lues : « __proto__ » & co ne sont jamais consultées
        if (!s.restore || !Object.prototype.hasOwnProperty.call(saved, s.id)) continue;
        guard(s, 'restore', () => s.restore!(saved[s.id]));
      }
    },
    onJoin(p) { for (const s of systems) if (s.onJoin) guard(s, 'onJoin', () => s.onJoin!(p)); },
    onLeave(p) { for (const s of systems) if (s.onLeave) guard(s, 'onLeave', () => s.onLeave!(p)); },
    onMessage(p, raw) {
      const m = parseGameMsg(raw);
      if (!m) return;
      for (const s of systems) if (s.onMessage) guard(s, 'onMessage', () => s.onMessage!(p, m));
    },
    privateFor(p) {
      const pos = sim.playerPos(p);
      const out: PrivateState = {
        money: 0, bag: {}, bagCap: 20, stars: 0, starProgress: 0, district: city.districtAt(pos[0], pos[2]), marks: [], medals: {}, unread: 0,
      };
      for (const s of systems) if (s.privateView) guard(s, 'privateView', () => s.privateView!(p, out));
      if (out.marks.length > MAX_MARKS) out.marks.length = MAX_MARKS;
      return out;
    },
    drainOutbox() {
      if (!outbox.length) return outbox;
      return outbox.splice(0, outbox.length);
    },
    pedsFlat() {
      for (const s of systems) {
        if (!s.pedsFlat) continue;
        const r = guard(s, 'pedsFlat', () => s.pedsFlat!());
        if (!Array.isArray(r) || r.length % PED_STRIDE !== 0 || r.length > MAX_PEDS * PED_STRIDE || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
        return r;
      }
      return [];
    },
  };

  if (opts.saved !== undefined) game.restore(opts.saved);
  return game;
}
