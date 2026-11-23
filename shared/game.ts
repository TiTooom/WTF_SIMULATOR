// Contrats de la logique de jeu (systèmes serveur) : bus d'événements typé, contexte, interface d'un système.
// Écrit par l'intégrateur ; les spécialistes implémentent des `SystemFactory` (server/systems/*.ts) sans toucher à ce fichier.
import type { SimPlayer, SimVehicle } from './api';
import type { CityLayout } from './city/layout';
import type { CrimeKind, GoodId, MinigameKind, SystemId } from './ids';
import { GOOD_IDS, isIn } from './ids';
import type { GameClientMsg, GameServerEvent, PrivateState } from './protocol';
import type { Sim } from './sim';

export interface GameEvents {
  vehicleDestroyed: { v: SimVehicle; by: SimPlayer | null };
  pedKnocked: { pedId: number; by: SimPlayer | null; x: number; z: number };
  crime: { kind: CrimeKind; by: SimPlayer; x: number; z: number };
  playerDied: { p: SimPlayer; by: SimPlayer | null; cause: string };
  playerBusted: { p: SimPlayer };
  enteredVehicle: { p: SimPlayer; v: SimVehicle };
  trade: { p: SimPlayer; good: GoodId; qty: number; price: number; side: 'buy' | 'sell' };
  minigameDone: { p: SimPlayer; kind: MinigameKind; ok: boolean; ms: number };
  cameraDestroyed: { by: SimPlayer | null; id: string };
  /** Commandes `/debug stars|money|mg <arg>` (hôte seulement) : chaque système concerné écoute et agit. */
  debug: { p: SimPlayer; what: string; arg: string };
}

type Handler<T> = (payload: T) => void;

/** Bus d'événements synchrone. Un écouteur qui lève une exception ne bloque ni les autres ni l'émetteur. */
export class GameBus {
  private map = new Map<keyof GameEvents, Handler<never>[]>();
  /** Appelé quand un écouteur lève (journalisation) ; branché par server/game.ts. */
  onError: (event: string, e: unknown) => void = () => {};

  /** S'abonne ; retourne la fonction de désabonnement. */
  on<K extends keyof GameEvents>(k: K, fn: Handler<GameEvents[K]>): () => void {
    const list = this.map.get(k) ?? [];
    list.push(fn as Handler<never>);
    this.map.set(k, list);
    return () => {
      const l = this.map.get(k);
      if (l) this.map.set(k, l.filter((f) => f !== fn));
    };
  }

  emit<K extends keyof GameEvents>(k: K, payload: GameEvents[K]): void {
    const list = this.map.get(k);
    if (!list) return;
    for (const fn of [...list]) {
      try { (fn as Handler<GameEvents[K]>)(payload); } catch (e) { this.onError(String(k), e); }
    }
  }
}

export interface GameCtx {
  sim: Sim;
  bus: GameBus;
  city: CityLayout;
  mode: 'solo' | 'multi';
  /** Événement de jeu pour un joueur (id de joueur). */
  sendTo(playerId: string, ev: GameServerEvent): void;
  broadcast(ev: GameServerEvent): void;
  /** Autre système déjà installé (ordre de SYSTEMS), ou undefined. */
  get<T extends GameSystem = GameSystem>(id: SystemId): T | undefined;
}

/**
 * Un système de jeu serveur. Tous les crochets sont facultatifs et appelés sous try/catch : une exception ne casse pas la boucle.
 * Règles : ne jamais conserver un corps Rapier (utiliser `VRef` + `sim.resolveRef`), `serialize` ne lit pas Rapier.
 */
export interface GameSystem {
  id: SystemId;
  preStep?(): void; // avant sim.step()
  postStep?(): void; // après sim.step()
  onJoin?(p: SimPlayer): void;
  onLeave?(p: SimPlayer): void;
  /** Touche d'interaction : true = traité (empêche de monter dans un véhicule). */
  onInteract?(p: SimPlayer): boolean;
  canEnter?(p: SimPlayer, v: SimVehicle): boolean | undefined;
  /** Message d'un client, DÉJÀ validé structurellement par parseGameMsg ; la validité métier (prix, distance…) reste à vérifier. */
  onMessage?(p: SimPlayer, m: GameClientMsg): void;
  /** Complète l'état privé du joueur (message `me`). */
  privateView?(p: SimPlayer, out: PrivateState): void;
  /** Piétons à plat pour le snapshot (PED_STRIDE nombres chacun : id, kind, x, z, yaw, st). Seul le système `peds` l'implémente. */
  pedsFlat?(): number[];
  /** État à sauvegarder : JSON pur, sans lecture de Rapier. */
  serialize?(): unknown;
  /** Reçoit l'état sauvegardé (NON FIABLE : à valider, clés dangereuses incluses). */
  restore?(data: unknown): void;
}

export type SystemFactory = (ctx: GameCtx) => GameSystem;

// ---------- Validation des messages client (pure : testée sans réseau) ----------
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hasBadKey = (o: object) => BAD_KEYS.some((k) => Object.prototype.hasOwnProperty.call(o, k));
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const idStr = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_.-]{1,48}$/i.test(v);

/** Taille maximale (JSON) d'un message `game` accepté. */
export const MAX_GAME_MSG_CHARS = 600;

/** Retourne le message nettoyé (champs recopiés un par un, rien d'inconnu) ou null s'il est invalide. */
export function parseGameMsg(m: unknown): GameClientMsg | null {
  if (!isObj(m) || hasBadKey(m)) return null;
  switch (m.k) {
    case 'trade':
      if (!idStr(m.dealer) || !isIn(GOOD_IDS, m.good) || !intIn(m.qty, 1, 999) || (m.side !== 'buy' && m.side !== 'sell')) return null;
      return { k: 'trade', dealer: m.dealer, good: m.good, qty: m.qty, side: m.side };
    case 'stash':
      if ((m.op !== 'put' && m.op !== 'take') || !isIn(GOOD_IDS, m.good) || !intIn(m.qty, 1, 999)) return null;
      return { k: 'stash', op: m.op, good: m.good, qty: m.qty };
    case 'mission':
      if ((m.op !== 'start' && m.op !== 'abort' && m.op !== 'retry') || !idStr(m.id)) return null;
      return { k: 'mission', op: m.op, id: m.id };
    case 'mg': {
      const r = m.r;
      if (!isObj(r) || hasBadKey(r) || !intIn(r.sid, 0, 1e9) || typeof r.ok !== 'boolean') return null;
      if (typeof r.ms !== 'number' || !Number.isFinite(r.ms) || r.ms < 0 || r.ms > 60_000) return null;
      let data: number[] | undefined;
      if (r.data !== undefined) {
        if (!Array.isArray(r.data) || r.data.length > 16 || !r.data.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
        data = r.data.slice();
      }
      return { k: 'mg', r: { sid: r.sid, ok: r.ok, ms: r.ms, ...(data ? { data } : {}) } };
    }
    case 'sms_lu':
      if (!intIn(m.id, 0, 1e9)) return null;
      return { k: 'sms_lu', id: m.id };
    default:
      return null;
  }
}
