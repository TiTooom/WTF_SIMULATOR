// Modes de jeu entre copains, sans client dédié : timers serveur + annonces dans le chat.
//  - roi_colline : une zone au centre de l'arène de démolition, 1 point par seconde, premier à 100.
//  - derby       : points aux dégâts infligés aux véhicules adverses (chocs, explosions, balles), premier à 400.
import type { Sim } from '../shared/sim';
import type { SimPlayer, SimVehicle, DamageKind } from '../shared/api';
import { HILL } from '../shared/world';
import { bodyOk } from '../shared/guard';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, '_');
const KING_GOAL = 100;
const DERBY_GOAL = 400;
const DERBY_MAX_MS = 6 * 60_000;

export const MODES = [
  { id: 'roi_colline', name: 'Roi de la colline', aliases: ['roi', 'colline', 'king'] },
  { id: 'derby', name: 'Démolition derby', aliases: ['demolition', 'demolition_derby'] },
];

interface Score { name: string; pts: number }

export interface ModesCtl {
  step(): void;
  /** Démarre un mode (id, alias ou début). Retourne un message d'erreur ou null. */
  start(query: string): string | null;
  stop(announce?: boolean): boolean;
  active(): string | null;
  ranking(): string;
  scores(): Score[];
}

export function createModes(sim: Sim): ModesCtl {
  let mode: 'roi_colline' | 'derby' | null = null;
  let t0 = 0;
  let nextRank = 0;
  let nextTick = 0;
  const scores = new Map<string, Score>();
  const recentHit = new Map<number, number>(); // véhicule -> dernier temps où l'on a affiché un « +N »
  let restore: (() => void) | null = null;

  const add = (p: SimPlayer, pts: number) => {
    const s = scores.get(p.id) ?? { name: p.name, pts: 0 };
    s.name = p.name;
    s.pts += pts;
    scores.set(p.id, s);
    return s.pts;
  };
  const sorted = () => [...scores.values()].sort((a, b) => b.pts - a.pts);
  const ranking = () => {
    const top = sorted().slice(0, 5);
    if (!top.length) return 'Personne n\'a encore marqué.';
    return top.map((s, i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${s.name} ${Math.floor(s.pts)}`).join('  ·  ');
  };

  const finish = (why: string) => {
    const top = sorted();
    const w = top[0];
    sim.announce(`🏁 ${why}${w ? ` Vainqueur : ${w.name} avec ${Math.floor(w.pts)} points !` : ''}`);
    if (top.length) sim.announce(`Classement : ${ranking()}`);
    if (w) for (const p of sim.players.values()) if (p.name === w.name) {
      const t = (p.vehicle?.behavior.body ?? p.body).translation();
      sim.fx({ k: 'confetti', p: [t.x, t.y + 1, t.z], b: 90 });
      sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'fanfare' });
    }
    stopInternal();
  };

  const stopInternal = () => {
    mode = null;
    restore?.();
    restore = null;
    scores.clear();
    recentHit.clear();
  };

  /** Derby : intercepte les dégâts subis par les véhicules pour les attribuer à l'adversaire. */
  const patchDamage = () => {
    const orig = sim.damageVehicle.bind(sim);
    const attacker = (v: SimVehicle, kind: DamageKind, by: SimPlayer | null | undefined, vpos: { x: number; y: number; z: number }): SimPlayer | null => {
      if (by && by !== v.driver) return by;
      if (kind !== 'impact') return null;
      // choc : l'adversaire est le conducteur le plus proche qui roule vite
      const vb = vpos; // position lue AVANT les dégâts : si le véhicule vient d'être détruit son corps n'existe plus
      let best: SimPlayer | null = null, bd = 7;
      for (const o of sim.vehicles) {
        if (o === v || o.dead || !o.driver || o.driver === v.driver || !bodyOk(o.behavior.body)) continue;
        const t = o.behavior.body.translation(), lv = o.behavior.body.linvel();
        const d = Math.hypot(t.x - vb.x, t.y - vb.y, t.z - vb.z);
        if (d < bd && Math.hypot(lv.x, lv.y, lv.z) > 3.5) { bd = d; best = o.driver; }
      }
      return best;
    };
    sim.damageVehicle = (v, amount, kind, by) => {
      const before = v.hp, wasDead = v.dead;
      const vp = !wasDead && bodyOk(v.behavior.body) ? v.behavior.body.translation() : { x: 0, y: 0, z: 0 };
      orig(v, amount, kind, by);
      if (mode !== 'derby' || !v.driver) return;
      const atk = attacker(v, kind, by, vp);
      if (!atk || atk === v.driver) return;
      const dealt = Math.max(0, before - Math.max(0, v.hp));
      let gain = dealt;
      if (v.dead && !wasDead) {
        gain += 25;
        sim.announce(`💥 ${atk.name} a démoli le véhicule de ${v.driver?.name ?? 'quelqu\'un'} (+25)`);
      }
      if (gain <= 0) return;
      const total = add(atk, gain);
      if (gain >= 6 && sim.time - (recentHit.get(v.id) ?? 0) > 400) {
        recentHit.set(v.id, sim.time);
        const t = !v.dead && bodyOk(v.behavior.body) ? v.behavior.body.translation() : vp;
        if (t) sim.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: `+${Math.round(gain)}`, c: 0xff7b00 });
      }
      if (total >= DERBY_GOAL) finish(`${atk.name} atteint ${DERBY_GOAL} points de démolition.`);
    };
    restore = () => { delete (sim as unknown as { damageVehicle?: unknown }).damageVehicle; };
  };

  return {
    step() {
      if (!mode) return;
      const now = sim.time;
      if (mode === 'roi_colline' && now >= nextTick) {
        nextTick = now + 1000;
        for (const p of sim.players.values()) {
          if (p.hp <= 0) continue;
          const t = (p.vehicle?.behavior.body ?? p.body).translation();
          if (Math.hypot(t.x - HILL.x, t.z - HILL.z) > HILL.r || t.y > 8) continue;
          const pts = add(p, 1);
          if (pts % 5 === 0) sim.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: `👑 ${pts}`, c: 0xffd60a });
          if (pts >= KING_GOAL) { finish(`${p.name} règne sur la colline.`); return; }
        }
      }
      if (mode === 'derby' && now - t0 > DERBY_MAX_MS) { finish('Temps écoulé.'); return; }
      if (mode && now >= nextRank) {
        nextRank = now + (mode === 'roi_colline' ? 15_000 : 30_000);
        if (scores.size) sim.announce(`📊 ${ranking()}`);
      }
    },
    start(query) {
      const n = norm(query);
      const m = MODES.find((x) => x.id === n || x.aliases.includes(n)) ?? MODES.find((x) => x.id.startsWith(n) || norm(x.name).startsWith(n));
      if (!m) return `Modes : ${MODES.map((x) => `${x.id} (${x.aliases[0]})`).join(', ')}. /mode stop pour arrêter.`;
      if (mode) stopInternal();
      mode = m.id as typeof mode;
      t0 = sim.time;
      nextTick = sim.time + 1000;
      nextRank = sim.time + 20_000;
      scores.clear();
      if (mode === 'roi_colline') {
        sim.announce(`👑 Roi de la colline ! Restez dans la zone rouge de l'arène de démolition (x ${HILL.x}, z ${HILL.z}) : 1 point par seconde, premier à ${KING_GOAL}. Le phare jaune la signale.`);
      } else {
        patchDamage();
        sim.announce(`💥 Démolition derby ! Les points vont aux dégâts infligés aux véhicules adverses (+25 par destruction). Premier à ${DERBY_GOAL}, ou meilleur score dans 6 minutes.`);
      }
      return null;
    },
    stop(announce = true) {
      if (!mode) return false;
      const was = mode;
      if (announce && scores.size) sim.announce(`🛑 Mode arrêté (${was}). Classement : ${ranking()}`);
      else if (announce) sim.announce(`🛑 Mode arrêté (${was}).`);
      stopInternal();
      return true;
    },
    active: () => mode,
    ranking,
    scores: sorted,
  };
}
