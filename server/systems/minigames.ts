// PROPRIÉTAIRE : game-minigames
// Sessions de mini-jeux : un seul mini-jeu actif par joueur, `sid` unique à usage unique, validation du résultat par les règles de
// shared/minigames/rules.ts (durée plausible, graine, anti-triche), annulation si le joueur s'éloigne, est touché, meurt ou monte en véhicule.
// Aucun corps Rapier n'est conservé : la position vient de `sim.playerPos` (qui vérifie `bodyOk`), le temps de `sim.time`.
import type { SimPlayer, SimVehicle } from '../../shared/api';
import type { GameCtx, GameSystem, SystemFactory } from '../../shared/game';
import { MINIGAME_KINDS, isIn, type MinigameKind } from '../../shared/ids';
import { RULES, clamp01 } from '../../shared/minigames/rules';
import type { GameClientMsg, MinigameResult } from '../../shared/protocol';

/** Marge (ms) entre la fin de la durée maximale et l'expiration serveur de la session (latence réseau). */
export const TTL_MARGIN_MS = 1500;
/** Tolérance (ms) sur les durées annoncées par le client. */
const SLACK_MS = 250;
/** Perte de points de vie qui compte comme « touché ». */
const HIT_HP = 0.5;

export interface MinigameDone { p: SimPlayer; kind: MinigameKind; tag: string; ok: boolean; ms: number; reason: string }

interface Session {
  sid: number;
  kind: MinigameKind;
  tag: string;
  seed: number;
  difficulty: number;
  startedAt: number; // sim.time (ms)
  ttlAt: number; // sim.time (ms)
  pos: [number, number, number];
  hp: number;
  vehicle: SimVehicle | null; // simple identité pour détecter un changement ; jamais lu (pas d'accès Rapier)
  onDone?: (e: MinigameDone) => void;
}

export interface MinigamesSystem extends GameSystem {
  /**
   * Démarre un mini-jeu pour `p` (mg_start envoyé). Retourne le `sid`, ou null si le joueur en a déjà un, est mort, ou si `kind` est inconnu.
   * `tag` identifie l'appelant (« vol:12 », « mission:agros:2 »…). `onDone` est appelé une seule fois, que ce soit réussite, échec ou annulation.
   * `seed` (facultatif) fixe la graine (tests, missions rejouables).
   */
  startMinigame(p: SimPlayer, kind: MinigameKind, tag: string, difficulty: number, onDone?: (e: MinigameDone) => void, seed?: number): number | null;
  /** Annule la session de `p` (échec sans punition). Retourne true s'il y en avait une. */
  cancel(p: SimPlayer, reason?: string): boolean;
  /** Session en cours de `p`, ou null. */
  activeOf(p: SimPlayer): { sid: number; kind: MinigameKind; tag: string } | null;
  /** Abonnement global aux fins de session (en plus de `minigameDone` sur le bus, qui ne porte pas le tag). */
  onDone(fn: (e: MinigameDone) => void): () => void;
}

export const createMinigames: SystemFactory = (ctx: GameCtx): MinigamesSystem => {
  const sessions = new Map<string, Session>(); // clé : id du joueur
  const listeners: ((e: MinigameDone) => void)[] = [];
  let nextSid = 1;

  const finish = (p: SimPlayer, s: Session, ok: boolean, ms: number, reason: string, notify = true) => {
    if (sessions.get(p.id) === s) sessions.delete(p.id);
    if (notify) ctx.sendTo(p.id, { k: 'mg_end', sid: s.sid, ok });
    const e: MinigameDone = { p, kind: s.kind, tag: s.tag, ok, ms, reason };
    ctx.bus.emit('minigameDone', { p, kind: s.kind, ok, ms });
    for (const fn of [...listeners]) { try { fn(e); } catch (err) { ctx.sim.log(`[minigames] écouteur : ${(err as Error)?.stack ?? err}`); } }
    if (s.onDone) { try { s.onDone(e); } catch (err) { ctx.sim.log(`[minigames] onDone (${s.tag}) : ${(err as Error)?.stack ?? err}`); } }
  };

  const playerById = (id: string) => ctx.sim.players.get(id);

  /** Jugement d'un résultat reçu. Retourne [ok, motif]. */
  const judge = (s: Session, r: MinigameResult, elapsed: number): [boolean, string] => {
    if (!r.ok) return [false, 'echec'];
    const rule = RULES[s.kind];
    if (r.ms < rule.minMs || elapsed < rule.minMs - SLACK_MS) return [false, 'trop_rapide'];
    if (r.ms > rule.maxMs + SLACK_MS || elapsed > rule.maxMs + TTL_MARGIN_MS) return [false, 'trop_long'];
    if (r.ms > elapsed + SLACK_MS) return [false, 'incoherent']; // le client dit avoir joué plus longtemps que la session n'existe
    let valid = false;
    try { valid = rule.validate(s.seed, s.difficulty, r); } catch { valid = false; }
    return valid ? [true, 'ok'] : [false, 'invalide'];
  };

  const cancel = (p: SimPlayer, reason = 'annule'): boolean => {
    const s = sessions.get(p.id);
    if (!s) return false;
    finish(p, s, false, Math.max(0, ctx.sim.time - s.startedAt), reason);
    return true;
  };

  const startMinigame: MinigamesSystem['startMinigame'] = (p, kind, tag, difficulty, onDone, seed) => {
    if (!p || !isIn(MINIGAME_KINDS, kind) || !ctx.sim.players.has(p.id) || sessions.has(p.id) || p.hp <= 0) return null;
    const rule = RULES[kind];
    const d = clamp01(difficulty);
    const sd = Number.isFinite(seed) ? (Math.floor(seed as number) >>> 0) % 0x7fffffff : Math.floor(Math.random() * 0x7fffffff);
    const s: Session = {
      sid: nextSid++, kind, tag: String(tag ?? '').slice(0, 48), seed: sd, difficulty: d,
      startedAt: ctx.sim.time, ttlAt: ctx.sim.time + rule.maxMs + TTL_MARGIN_MS,
      pos: ctx.sim.playerPos(p), hp: p.hp, vehicle: p.vehicle, onDone,
    };
    sessions.set(p.id, s);
    ctx.sendTo(p.id, { k: 'mg_start', s: { sid: s.sid, kind, seed: sd, difficulty: d, maxMs: rule.maxMs } });
    return s.sid;
  };

  const cancelOn = (p: SimPlayer, reason: string) => { cancel(p, reason); };
  ctx.bus.on('playerDied', ({ p }) => cancelOn(p, 'mort'));
  ctx.bus.on('playerBusted', ({ p }) => cancelOn(p, 'arrete'));
  ctx.bus.on('debug', ({ p, what, arg }) => {
    if (what !== 'mg') return;
    const kind = isIn(MINIGAME_KINDS, arg) ? arg : 'tournevis';
    startMinigame(p, kind, 'debug', 0.3);
  });

  return {
    id: 'minigames',
    startMinigame,
    cancel,
    activeOf(p) {
      const s = sessions.get(p.id);
      return s ? { sid: s.sid, kind: s.kind, tag: s.tag } : null;
    },
    onDone(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    postStep() {
      const now = ctx.sim.time;
      for (const [id, s] of [...sessions]) {
        const p = playerById(id);
        if (!p) { sessions.delete(id); continue; }
        if (p.hp <= 0) { finish(p, s, false, now - s.startedAt, 'mort'); continue; }
        if (p.hp < s.hp - HIT_HP) { finish(p, s, false, now - s.startedAt, 'touche'); continue; }
        s.hp = Math.max(s.hp, p.hp); // les soins relèvent le seuil : on ne compte que les pertes
        if (p.vehicle !== s.vehicle) { finish(p, s, false, now - s.startedAt, 'vehicule'); continue; }
        const at = ctx.sim.playerPos(p);
        if (Math.hypot(at[0] - s.pos[0], at[2] - s.pos[2]) > RULES[s.kind].cancelDist) { finish(p, s, false, now - s.startedAt, 'eloigne'); continue; }
        if (now > s.ttlAt) finish(p, s, false, now - s.startedAt, 'expire');
      }
    },

    onLeave(p) {
      const s = sessions.get(p.id);
      if (s) finish(p, s, false, Math.max(0, ctx.sim.time - s.startedAt), 'depart', false);
    },

    // Pendant un mini-jeu, la touche d'interaction ne fait rien d'autre (pas de montée en véhicule par erreur).
    onInteract: (p) => sessions.has(p.id),
    canEnter: (p) => (sessions.has(p.id) ? false : undefined),

    onMessage(p, m: GameClientMsg) {
      if (m.k !== 'mg') return;
      const s = sessions.get(p.id);
      if (!s || s.sid !== m.r.sid) return; // sid inconnu, rejoué, ou d'un autre joueur : ignoré sans réponse
      const elapsed = ctx.sim.time - s.startedAt;
      const [ok, reason] = judge(s, m.r, elapsed);
      finish(p, s, ok, ok ? m.r.ms : Math.min(m.r.ms, elapsed), reason);
    },

    // Les sessions sont éphémères (quelques secondes) : rien à sauvegarder.
    serialize: () => ({ v: 1 }),
    restore: () => {},
  };
};
