// PROPRIÉTAIRE : game-minigames
// Vol de voiture garée : la touche d'interaction près d'un véhicule `locked` lance un mini-jeu (voiture ancienne : tournevis ; moderne :
// court-circuit ; difficulté selon le type). Réussite : déverrouille, fait monter le voleur (force) et émet le crime `vol_vehicule`.
// Échec : alarme (klaxon répété, aucune punition lourde). Aucun corps conservé : seules des `VRef` sont gardées entre deux ticks.
// Sûr sans les systèmes traffic/police : `traffic.unlock` est appelé seulement s'il existe.
import type { SimPlayer, SimVehicle, VRef } from '../../shared/api';
import type { GameCtx, GameSystem, SystemFactory } from '../../shared/game';
import type { MinigameKind } from '../../shared/ids';
import type { MinigameDone, MinigamesSystem } from './minigames';

/** Type de mini-jeu et difficulté (0..1) par type de véhicule. Inconnu : court-circuit, difficulté moyenne. */
export const THEFT_PROFILE: Record<string, { kind: MinigameKind; difficulty: number }> = {
  citadine: { kind: 'tournevis', difficulty: 0.2 },
  camionnette: { kind: 'tournevis', difficulty: 0.6 },
  berline: { kind: 'court_circuit', difficulty: 0.4 },
  police: { kind: 'court_circuit', difficulty: 0.9 },
};
export const profileOf = (type: string) => THEFT_PROFILE[type] ?? { kind: 'court_circuit' as MinigameKind, difficulty: 0.5 };

/** Motifs de fin qui déclenchent l'alarme : échec réel ou résultat refusé. DÉCISION : un abandon volontaire (Échap / bouton) ne déclenche PAS l'alarme,
 *  pas plus que s'éloigner, être touché, mourir, ou une session expirée (garde-fou). Le client rejoue tout seul après une erreur de jeu : l'échec réel est rare. */
const ALARM_REASONS = new Set(['echec', 'invalide', 'trop_rapide']);
const ALARM_MS = 2400;
const ALARM_BEEP_MS = 600;
const MAX_ALARMS = 8;

export interface TheftSystem extends GameSystem {
  /** Véhicule en cours de vol par `p`, ou null. */
  stealing(p: SimPlayer): VRef | null;
}

interface Attempt { ref: VRef; vid: number }
interface Alarm { ref: VRef; until: number; next: number }

export const createTheft: SystemFactory = (ctx: GameCtx): TheftSystem => {
  const attempts = new Map<string, Attempt>(); // joueur -> tentative
  const alarms: Alarm[] = [];

  const mg = () => ctx.get<MinigamesSystem>('minigames');
  const live = (r: VRef) => ctx.sim.resolveRef(r);
  const posOf = (v: SimVehicle): [number, number, number] => {
    const t = v.behavior.body.translation(); // `v` vient de resolveRef juste avant : le corps est valide
    return [t.x, t.y, t.z];
  };

  /** Véhicule verrouillé, libre et vivant le plus proche dans le rayon de montée ; null si un véhicule ouvert est plus proche. */
  const targetOf = (p: SimPlayer): SimVehicle | null => {
    const at = ctx.sim.playerPos(p);
    let best: SimVehicle | null = null;
    let bd = Infinity;
    for (const v0 of ctx.sim.vehicles) {
      const v = ctx.sim.resolveRef(ctx.sim.refOf(v0));
      if (!v || v.ai) continue;
      const vp = posOf(v);
      const d = Math.hypot(at[0] - vp[0], at[2] - vp[2]);
      if (d >= v.def.enterRadius || Math.abs(at[1] - vp[1]) >= v.def.enterRadius || d >= bd) continue;
      if (!v.locked && v.driver) continue; // véhicule ouvert déjà occupé : ne masque pas un véhicule verrouillé
      best = v;
      bd = d;
    }
    return best && best.locked && !best.driver ? best : null;
  };

  const startAlarm = (v: SimVehicle) => {
    if (alarms.length >= MAX_ALARMS) alarms.shift();
    alarms.push({ ref: ctx.sim.refOf(v), until: ctx.sim.time + ALARM_MS, next: ctx.sim.time });
  };

  const finishTheft = (p: SimPlayer, a: Attempt, e: MinigameDone) => {
    attempts.delete(p.id);
    const v = live(a.ref);
    if (!v) return; // véhicule détruit ou recyclé entre-temps : rien à faire
    if (!e.ok) {
      if (ALARM_REASONS.has(e.reason)) startAlarm(v);
      return;
    }
    if (ctx.sim.players.get(p.id) !== p || p.hp <= 0 || p.vehicle) return;
    if (v.driver) return; // quelqu'un d'autre a pris le volant : le véhicule reste tel quel
    v.locked = false;
    try {
      (ctx.get('traffic') as (GameSystem & { unlock?(v: SimVehicle): void }) | undefined)?.unlock?.(v);
    } catch (err) { ctx.sim.log(`[theft] traffic.unlock : ${(err as Error)?.stack ?? err}`); }
    if (ctx.sim.enterVehicle(p, v, undefined, true)) {
      const vp = posOf(v);
      ctx.bus.emit('crime', { kind: 'vol_vehicule', by: p, x: vp[0], z: vp[2] });
    }
  };

  return {
    id: 'theft',
    stealing: (p) => attempts.get(p.id)?.ref ?? null,

    onInteract(p) {
      const m = mg();
      if (!m || p.vehicle || p.hp <= 0 || attempts.has(p.id) || m.activeOf(p)) return false;
      const v = targetOf(p);
      if (!v) return false;
      if ([...attempts.values()].some((a) => a.vid === v.id)) return true; // déjà en train d'être crocheté par un autre joueur
      const prof = profileOf(v.def.type);
      const a: Attempt = { ref: ctx.sim.refOf(v), vid: v.id };
      attempts.set(p.id, a);
      const sid = m.startMinigame(p, prof.kind, `vol:${v.id}`, prof.difficulty, (e) => finishTheft(p, a, e));
      if (sid === null) { attempts.delete(p.id); return false; }
      return true;
    },

    postStep() {
      const now = ctx.sim.time;
      for (let i = alarms.length - 1; i >= 0; i--) {
        const al = alarms[i];
        const v = now < al.until ? live(al.ref) : null;
        if (!v) { alarms.splice(i, 1); continue; }
        if (now >= al.next) {
          al.next = now + ALARM_BEEP_MS;
          ctx.sim.fx({ k: 'sound', p: posOf(v), s: 'horn_5' });
        }
      }
    },

    onLeave(p) { attempts.delete(p.id); },
    serialize: () => ({ v: 1 }),
    restore: () => {},
  };
};
