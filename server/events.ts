// Événements chaos : durée limitée, annonces dans le chat, effets réels, état toujours restauré à la fin.
// Un seul événement actif à la fois. Déclenchés par /meteo <id>, par le bouton « NE PAS APPUYER », ou au hasard
// (toutes les 4 à 8 minutes, uniquement en multi avec au moins 2 joueurs).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Sim } from '../shared/sim';
import type { SimPlayer, SimProp } from '../shared/api';
import type { Input } from '../shared/protocol';
import { worldHooks } from '../shared/packs/world';
import { bodyOk } from '../shared/guard';

const WALK = 6; // même valeur que le cœur (vitesse de marche)
const NORMAL_GRAVITY = -9.81;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, '_');

interface Run {
  sim: Sim;
  n: number; // pas écoulés depuis le début
  until: number; // temps de simulation (ms) de fin
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Fin anticipée demandée par l'événement (ex : gnome détruit). */
  finish: boolean;
}

interface ChaosEvent {
  id: string;
  name: string;
  emoji: string;
  seconds: number;
  msg: string;
  end: string;
  start?(r: Run): string | void; // peut renvoyer un texte d'annonce à la place de `msg`
  tick?(r: Run): void;
  stop?(r: Run): void;
}

// ---------- Utilitaires ----------
const living = (sim: Sim): SimPlayer[] => [...sim.players.values()].filter((p) => p.hp > 0);
const posOf = (p: SimPlayer) => (p.vehicle?.behavior.body ?? p.body).translation();
const lightProps = (sim: Sim, maxMass: number): SimProp[] => {
  const out: SimProp[] = [];
  for (const p of sim.props.values()) if (!p.frozen && !p.held && p.body.mass() < maxMass) out.push(p);
  return out;
};
const liveVehicles = (sim: Sim) => sim.vehicles.filter((v) => !v.dead && v.behavior.body);
const addKb = (p: SimPlayer, x: number, z: number, cap: number) => {
  const kb = (p.scratch.kb as [number, number] | undefined) ?? [0, 0];
  kb[0] += x;
  kb[1] += z;
  const m = Math.hypot(kb[0], kb[1]);
  if (m > cap) { kb[0] *= cap / m; kb[1] *= cap / m; }
  p.scratch.kb = kb;
};

function groundCollider(sim: Sim): RAPIER.Collider | null {
  const found: { c: RAPIER.Collider | null } = { c: null };
  sim.world.forEachCollider((c) => {
    if (found.c || c.parent()) return;
    try {
      const h = c.halfExtents();
      if (h && h.x >= 400 && h.z >= 400) found.c = c;
    } catch { /* pas un cuboïde */ }
  });
  return found.c;
}

// ---------- Les 10 événements ----------
const EVENTS: ChaosEvent[] = [
  {
    id: 'pluie_de_caisses', name: 'Pluie de caisses', emoji: '☔', seconds: 20,
    msg: 'Il pleut des caisses ! Ouvrez les parapluies (vous n\'en avez pas).',
    end: 'La pluie de caisses s\'arrête. Il reste de quoi construire une maison.',
    start: (r) => { r.data.rain = [] as SimProp[]; },
    tick: (r) => {
      if (r.n % 24) return;
      const rain = (r.data.rain as SimProp[]).filter((p) => r.sim.props.get(p.id) === p);
      r.data.rain = rain;
      for (const pl of living(r.sim)) {
        if (rain.length >= 90) break;
        const t = posOf(pl);
        const a = rand(0, Math.PI * 2), d = rand(0, 40);
        const p = r.sim.spawnProp('x_rain', new THREE.Vector3(t.x + Math.cos(a) * d, rand(38, 50), t.z + Math.sin(a) * d),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))), new THREE.Vector3(0, -3, 0));
        if (p) rain.push(p);
      }
    },
  },
  {
    id: 'gravite_lunaire', name: 'Gravité lunaire', emoji: '🌙', seconds: 30,
    msg: 'Bienvenue sur la Lune. Ne vous cognez pas au plafond.',
    end: 'La gravité est revenue. Le sol aussi, malheureusement.',
    start: (r) => {
      r.data.g0 = r.sim.world.gravity.y;
      r.sim.setGravity(r.data.g0 * 0.3);
    },
    stop: (r) => r.sim.setGravity(r.data.g0 ?? NORMAL_GRAVITY),
  },
  {
    id: 'klaxons_hurlants', name: 'Klaxons hurlants', emoji: '📯', seconds: 20,
    msg: 'Les klaxons font grève de la discrétion.',
    end: 'Les klaxons se calment. Les voisins aussi.',
    tick: (r) => {
      if (r.n % 120) return;
      for (const v of liveVehicles(r.sim)) {
        const t = v.behavior.body.translation();
        r.sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: `horn_${1 + ((Math.random() * 5) | 0)}` });
        if (Math.random() < 0.3) r.sim.fx({ k: 'text', p: [t.x, t.y + 2.5, t.z], s: pick(['PIIIIN', 'POUET', 'TUUUT', 'BIP BIP']), c: 0xffd60a });
      }
    },
  },
  {
    id: 'sol_glissant', name: 'Sol glissant', emoji: '🧊', seconds: 25,
    msg: 'Le sol est une patinoire. Bonne chance pour la marche arrière.',
    end: 'Le sol retrouve son adhérence. Vos genoux aussi.',
    start: (r) => {
      const g = groundCollider(r.sim);
      r.data.ground = g;
      if (g) { g.setFriction(0.05); g.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min); }
      r.data.slip = true;
    },
    stop: (r) => {
      const g = r.data.ground as RAPIER.Collider | null;
      if (g) { g.setFriction(1); g.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average); }
      for (const p of r.sim.players.values()) { p.scratch.kb = undefined; delete p.scratch.slipM; delete p.scratch.slipT; }
    },
  },
  {
    id: 'mini_boss', name: 'Gnome géant', emoji: '👹', seconds: 60,
    msg: 'Un gnome géant vient de sortir de terre. Il n\'a pas l\'air content.',
    end: 'Fin de l\'alerte au gnome géant.',
    start: (r) => {
      const who = pick(living(r.sim));
      const t = who ? posOf(who) : { x: 0, y: 0, z: 0 };
      const a = rand(0, Math.PI * 2);
      const x = t.x + Math.cos(a) * 28, z = t.z + Math.sin(a) * 28;
      const g = r.sim.spawnProp('x_gnome', new THREE.Vector3(x, 3.2, z));
      r.data.gnome = g;
      if (g) {
        g.body.setEnabledRotations(false, true, false, true);
        r.sim.fx({ k: 'boom', p: [x, 0.5, z], a: 5 });
        r.sim.fx({ k: 'shake', p: [x, 0, z], a: 0.8 });
        r.sim.fx({ k: 'text', p: [x, 7.5, z], s: 'GNOME !', c: 0xe63946 });
      }
    },
    tick: (r) => {
      const g = r.data.gnome as SimProp | null;
      if (!g) { r.finish = true; return; }
      if (r.sim.props.get(g.id) !== g || !bodyOk(g.body)) {
        // détruit (le corps n'existe plus : ne JAMAIS le lire) : 3 caisses de récompense là où il est tombé
        const last = r.data.last ?? { x: 0, z: 0 };
        for (let i = 0; i < 3; i++) r.sim.spawnProp('crate_l', new THREE.Vector3(last.x + (i - 1) * 1.5, 3 + i, last.z));
        r.sim.fx({ k: 'confetti', p: [last.x, 2, last.z], b: 70 });
        r.sim.announce('🏆 Le gnome géant est vaincu. Il laisse trois caisses (c\'est tout ce qu\'il avait).');
        r.data.gnome = null;
        r.finish = true;
        return;
      }
      const t = g.body.translation();
      r.data.last = { x: t.x, z: t.z };
      if (r.n % 300 === 150) {
        let best: { x: number; z: number } | null = null, bd = Infinity;
        for (const p of living(r.sim)) {
          const q = posOf(p), d = Math.hypot(q.x - t.x, q.z - t.z);
          if (d < bd) { bd = d; best = q; }
        }
        if (best) {
          const m = g.body.mass(), d = Math.max(1, bd);
          g.body.applyImpulse({ x: ((best.x - t.x) / d) * m * 7, y: m * 4, z: ((best.z - t.z) / d) * m * 7 }, true);
          r.sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_2' });
          r.sim.fx({ k: 'text', p: [t.x, t.y + 4.5, t.z], s: 'GRAAAH', c: 0xe63946 });
        }
      }
      if (r.n % 6 === 0) {
        // un véhicule lancé contre le gnome lui fait mal
        for (const v of liveVehicles(r.sim)) {
          const q = v.behavior.body.translation(), lv = v.behavior.body.linvel();
          const sp = Math.hypot(lv.x, lv.z);
          if (sp > 8 && Math.hypot(q.x - t.x, q.z - t.z) < 3.8 && q.y < 6) r.sim.damageProp(g, sp * 14, v.driver);
        }
      }
    },
    stop: (r) => {
      const g = r.data.gnome as SimProp | null;
      if (g && r.sim.props.get(g.id) === g && bodyOk(g.body)) {
        const t = g.body.translation();
        r.sim.fx({ k: 'smoke', p: [t.x, t.y, t.z], a: 3 });
        r.sim.removeProp(g);
      }
    },
  },
  {
    id: 'tremblement', name: 'Tremblement de terre', emoji: '🌋', seconds: 15,
    msg: 'Ça tremble ! Le chat a déjà fait sa valise.',
    end: 'La terre se calme. Les caisses, beaucoup moins.',
    tick: (r) => {
      if (r.n % 8) return;
      const pls = living(r.sim);
      for (const pl of pls) {
        const t = posOf(pl);
        r.sim.fx({ k: 'shake', p: [t.x, t.y, t.z], a: 0.9 });
      }
      for (const p of lightProps(r.sim, 25)) {
        const t = p.body.translation();
        if (!pls.some((pl) => { const q = posOf(pl); return Math.hypot(q.x - t.x, q.z - t.z) < 70; })) continue;
        const m = p.body.mass();
        p.body.applyImpulse({ x: rand(-1, 1) * m * 1.5, y: rand(0.6, 2.6) * m, z: rand(-1, 1) * m * 1.5 }, true);
      }
      for (const v of liveVehicles(r.sim)) {
        const m = v.behavior.body.mass();
        v.behavior.body.applyImpulse({ x: rand(-1, 1) * m * 0.5, y: rand(0.1, 0.7) * m, z: rand(-1, 1) * m * 0.5 }, true);
        v.noImpactUntil = Math.max(v.noImpactUntil ?? 0, r.sim.time + 400); // pas de dégâts de choc causés par la secousse
      }
      for (const pl of pls) if (!pl.vehicle) addKb(pl, rand(-3, 3), rand(-3, 3), 6);
    },
  },
  {
    id: 'aimant_geant', name: 'Aimant géant', emoji: '🧲', seconds: 20,
    msg: 'Tout le monde se fait aspirer vers le centre. Pas de panique, c\'est la physique.',
    end: 'L\'aimant géant est débranché. Tout retombe, en désordre.',
    tick: (r) => {
      const c = { x: 0, y: 6, z: 0 };
      const dt = 1 / 60;
      for (const p of lightProps(r.sim, 30)) {
        const t = p.body.translation();
        const dx = c.x - t.x, dy = c.y - t.y, dz = c.z - t.z, d = Math.max(2, Math.hypot(dx, dy, dz));
        const m = p.body.mass(), k = (m * 16 * dt) / d;
        p.body.applyImpulse({ x: dx * k, y: dy * k, z: dz * k }, true);
        const v = p.body.linvel();
        if (d < 14) p.body.setLinvel({ x: v.x * 0.97, y: v.y * 0.97, z: v.z * 0.97 }, true);
      }
      for (const v of liveVehicles(r.sim)) {
        const t = v.behavior.body.translation();
        const dx = c.x - t.x, dz = c.z - t.z, d = Math.max(4, Math.hypot(dx, dz)), m = v.behavior.body.mass();
        v.behavior.body.applyImpulse({ x: (dx / d) * m * 4 * dt, y: 0, z: (dz / d) * m * 4 * dt }, true);
      }
      for (const pl of living(r.sim)) {
        if (pl.vehicle) continue;
        const t = posOf(pl), d = Math.max(3, Math.hypot(t.x, t.z));
        addKb(pl, (-t.x / d) * 0.35, (-t.z / d) * 0.35, 6);
      }
      if (r.n % 90 === 0) r.sim.fx({ k: 'ring', p: [0, 1, 0], a: 14, c: 0x9d4edd });
    },
  },
  {
    id: 'party_generale', name: 'Party générale', emoji: '🎉', seconds: 15,
    msg: 'C\'est la fête ! Personne n\'a demandé la permission.',
    end: 'La fête est finie. Il y a des confettis partout, bon courage.',
    start: (r) => { for (const p of r.sim.players.values()) r.sim.applyMod(p, { jump: 1.3 }, 15); },
    tick: (r) => {
      if (r.n % 30 === 0) for (const p of living(r.sim)) { const t = posOf(p); r.sim.fx({ k: 'confetti', p: [t.x, t.y + 1, t.z], b: 40 }); }
      if (r.n % 75 === 0) {
        for (const v of liveVehicles(r.sim)) {
          const t = v.behavior.body.translation();
          r.sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: `horn_${1 + ((Math.random() * 5) | 0)}` });
        }
      }
    },
    stop: (r) => { for (const p of r.sim.players.values()) { p.mods.jump = 1; p.modsUntil.jump = 0; } },
  },
  {
    id: 'touches_inversees', name: 'Touches inversées', emoji: '🔀', seconds: 20,
    msg: 'Les mains à l\'envers. Bonne chance.',
    end: 'Les touches reviennent à l\'endroit. Respire.',
    start: (r) => {
      const who = pick(living(r.sim));
      if (!who) return;
      r.data.who = who.id;
      return `${who.name} a les mains à l'envers (gauche et droite échangées). Bonne chance.`;
    },
    stop: (r) => { r.data.who = null; },
  },
  {
    id: 'vent_violent', name: 'Vent violent', emoji: '💨', seconds: 20,
    msg: 'Vent de face ! Les chapeaux s\'envolent, les vaches aussi.',
    end: 'Le vent tombe. Il était temps, mon chapeau est à Lyon.',
    start: (r) => { r.data.a = rand(0, Math.PI * 2); },
    tick: (r) => {
      const wx = Math.cos(r.data.a), wz = Math.sin(r.data.a), dt = 1 / 60;
      for (const p of lightProps(r.sim, 40)) {
        const m = p.body.mass();
        p.body.applyImpulse({ x: wx * m * 11 * dt, y: 0, z: wz * m * 11 * dt }, true);
      }
      for (const v of liveVehicles(r.sim)) {
        const m = v.behavior.body.mass();
        v.behavior.body.applyImpulse({ x: wx * m * 1.6 * dt, y: 0, z: wz * m * 1.6 * dt }, true);
      }
      for (const pl of living(r.sim)) if (!pl.vehicle) addKb(pl, wx * 0.3, wz * 0.3, 5);
      if (r.n % 90 === 0) for (const pl of living(r.sim)) { const t = posOf(pl); r.sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' }); }
    },
  },
];

export const EVENT_IDS = EVENTS.map((e) => e.id);
export const eventList = () => EVENTS.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji, seconds: e.seconds }));

export interface EventsCtl {
  step(): void;
  /** Lance un événement (id exact, nom ou début de nom). Retourne un message d'erreur, ou null si lancé. */
  start(query: string, who?: string): string | null;
  /** Arrête l'événement en cours (annonce de fin). */
  stop(): boolean;
  active(): string | null;
  /** Reporte le prochain déclenchement aléatoire (ms de simulation à partir de maintenant). Pour les tests. */
  scheduleAuto(inMs: number): void;
}

export function createEvents(sim: Sim, opts: { mode: 'solo' | 'multi' }): EventsCtl {
  let run: (Run & { def: ChaosEvent }) | null = null;
  let nextAuto = sim.time + rand(4, 8) * 60_000;
  const processed = new WeakMap<SimPlayer, Input>();

  const find = (q: string) => {
    const n = norm(q);
    if (!n) return null;
    return EVENTS.find((e) => e.id === n) ?? EVENTS.find((e) => norm(e.name) === n)
      ?? EVENTS.find((e) => e.id.startsWith(n) || norm(e.name).startsWith(n)) ?? EVENTS.find((e) => e.id.includes(n));
  };

  const begin = (def: ChaosEvent): void => {
    const r: Run & { def: ChaosEvent } = { def, sim, n: 0, until: sim.time + def.seconds * 1000, data: {}, finish: false };
    run = r;
    let text: string | void = def.msg;
    try { text = def.start?.(r) ?? def.msg; } catch (e) { sim.log(`[events] start ${def.id} : ${(e as Error)?.stack ?? e}`); }
    sim.announce(`${def.emoji} ${text}`);
  };

  const end = (announce = true) => {
    if (!run) return;
    const r = run;
    run = null;
    try { r.def.stop?.(r); } catch (e) { sim.log(`[events] stop ${r.def.id} : ${(e as Error)?.stack ?? e}`); }
    if (announce) sim.announce(`✅ ${r.def.end}`);
  };

  /** Touches inversées et sol glissant : transforment l'entrée des joueurs concernés. */
  const filterInputs = () => {
    const r = run;
    if (!r) return;
    for (const p of sim.players.values()) {
      if (p.input !== processed.get(p)) {
        let out: Input = p.input;
        if (r.def.id === 'touches_inversees' && r.data.who === p.id) out = { ...out, s: -out.s };
        else if (r.def.id === 'sol_glissant' && !p.vehicle) {
          const d = new THREE.Vector3(out.s, 0, -out.f).applyAxisAngle(new THREE.Vector3(0, 1, 0), out.yaw);
          if (d.lengthSq() > 1) d.normalize();
          p.scratch.slipT = [d.x * WALK * p.mods.speed, d.z * WALK * p.mods.speed];
          out = { ...out, f: 0, s: 0 };
        }
        p.input = out;
        processed.set(p, out);
      }
      if (r.def.id === 'sol_glissant' && !p.vehicle && p.hp > 0) {
        const M = (p.scratch.slipM as [number, number] | undefined) ?? [0, 0];
        const T = (p.scratch.slipT as [number, number] | undefined) ?? [0, 0];
        M[0] = M[0] * 0.965 + T[0] * 0.035 * 1.0;
        M[1] = M[1] * 0.965 + T[1] * 0.035 * 1.0;
        p.scratch.slipM = M;
        p.scratch.kb = [M[0], M[1]];
      } else if (r.def.id === 'sol_glissant' && p.vehicle) p.scratch.slipT = [0, 0];
    }
  };

  worldHooks.chaos = (who) => {
    if (run) return;
    begin(pick(EVENTS));
    void who;
  };

  return {
    step() {
      if (run) {
        run.n++;
        try { run.def.tick?.(run); } catch (e) { sim.log(`[events] tick ${run.def.id} : ${(e as Error)?.stack ?? e}`); }
        filterInputs();
        if (run && (run.finish || sim.time >= run.until)) end();
      } else if (sim.time >= nextAuto) {
        nextAuto = sim.time + rand(4, 8) * 60_000;
        if (opts.mode === 'multi' && sim.players.size >= 2) begin(pick(EVENTS));
      }
    },
    start(query, _who) {
      if (!query.trim()) return 'Précise un événement (/meteo pour la liste).';
      const def = find(query);
      if (!def) return `Événement inconnu : « ${query} ». /meteo pour la liste.`;
      if (run) return `Un événement est déjà en cours (${run.def.name}). Attends sa fin ou tape /meteo stop.`;
      begin(def);
      return null;
    },
    stop() {
      if (!run) return false;
      end();
      return true;
    },
    active: () => run?.def.id ?? null,
    scheduleAuto(inMs) { nextAuto = sim.time + inMs; },
  };
}

