// Câblage des extras « monde » : événements chaos, modes, commandes de chat, trampolines, cerceaux de cascade.
// Branché par server/server.ts : `const extras = installExtras(sim, { mode })`, puis `extras.step()` avant chaque `sim.step()`.
import * as THREE from 'three';
import type { Sim } from '../shared/sim';
import { crateLayout } from '../shared/constants';
import { PADS, PLACES, RINGS, spawnDecor } from '../shared/world';
import { registerCommand } from './commands';
import { createEvents, eventList, type EventsCtl } from './events';
import { createModes, MODES, type ModesCtl } from './modes';

export interface Extras {
  step(): void;
  events: EventsCtl;
  modes: ModesCtl;
  /** Remet props, décor et véhicules du monde à l'état initial (sans déconnecter personne). */
  resetWorld(): void;
  /** Nombre de cerceaux traversés par joueur. */
  rings: Map<string, number>;
}

const bySim = new WeakMap<Sim, Extras>();
const isDecorKind = (id: string) => /^(d|e|x)_/.test(id);

export function installExtras(sim: Sim, opts: { mode: 'solo' | 'multi' }): Extras {
  const events = createEvents(sim, opts);
  const modes = createModes(sim);
  const ringScore = new Map<string, number>();
  const padCool = new Map<string, number>();
  const prevPos = new Map<number, [number, number, number]>();
  const ringCool = new Map<string, number>();

  /** Décor frais : retire d'éventuels props de décor sauvegardés (anciens) et recrée ceux du monde. */
  const refreshDecor = () => {
    for (const p of [...sim.props.values()]) if (isDecorKind(p.kind.id)) sim.removeProp(p);
    spawnDecor(sim as never);
  };
  refreshDecor();

  const resetWorld = () => {
    events.stop();
    modes.stop(false);
    sim.setGravity(-9.81);
    for (const p of [...sim.props.values()]) sim.removeProp(p);
    for (const c of crateLayout()) {
      const p = sim.spawnProp(c.kind, new THREE.Vector3(c.x, c.y, c.z)) as { base?: boolean } | null;
      if (p) p.base = true;
    }
    spawnDecor(sim as never);
    // véhicules du monde : reconstruits à leur point d'origine s'ils sont libres, réapparition immédiate s'ils sont détruits
    const priv = sim as unknown as {
      buildBehavior(v: unknown, x: number, y: number, z: number, yaw: number): boolean;
      owners: Map<number, { vehicle?: unknown }>;
    };
    for (const v of sim.vehicles) {
      const extra = (v as unknown as { extra?: boolean }).extra;
      if (extra) continue;
      if (v.dead) { v.deadAt = sim.time - 60_000; continue; }
      if (v.driver || v.passengers.length) continue;
      try { v.behavior.dispose(); } catch { /* déjà retiré */ }
      priv.owners.forEach((o, h) => { if (o.vehicle === v) priv.owners.delete(h); });
      if (priv.buildBehavior(v, v.home.x, 1.2, v.home.z, v.home.yaw)) v.hp = v.def.maxHp;
      else { v.dead = true; v.deadAt = sim.time - 60_000; v.hp = 0; }
    }
  };

  // ---------- Trampolines et cerceaux ----------
  const stepPads = () => {
    for (const pad of PADS) {
      for (const v of sim.vehicles) {
        if (v.dead || !v.behavior.body) continue;
        const t = v.behavior.body.translation();
        if (Math.hypot(t.x - pad.x, t.z - pad.z) > pad.r || t.y > 2.6) continue;
        const key = `v${v.id}`;
        if (sim.time < (padCool.get(key) ?? 0)) continue;
        const lv = v.behavior.body.linvel();
        if (lv.y > 4) continue;
        padCool.set(key, sim.time + 700);
        v.behavior.body.setLinvel({ x: lv.x, y: pad.power, z: lv.z }, true);
        v.noImpactUntil = Math.max(v.noImpactUntil ?? 0, sim.time + 1400); // les rebonds ne cassent rien
        sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
      }
      for (const p of sim.players.values()) {
        if (p.vehicle || p.hp <= 0) continue;
        const t = p.body.translation();
        if (Math.hypot(t.x - pad.x, t.z - pad.z) > pad.r || t.y > 2.2) continue;
        const key = `p${p.id}`;
        if (sim.time < (padCool.get(key) ?? 0)) continue;
        const lv = p.body.linvel();
        if (lv.y > 3) continue;
        padCool.set(key, sim.time + 700);
        p.body.setLinvel({ x: lv.x, y: pad.power * 0.85, z: lv.z }, true);
        sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
      }
      for (const pr of sim.props.values()) {
        if (pr.frozen || pr.held || pr.body.mass() > 60) continue;
        const t = pr.body.translation();
        if (Math.hypot(t.x - pad.x, t.z - pad.z) > pad.r || t.y > 1.6) continue;
        const key = `o${pr.id}`;
        if (sim.time < (padCool.get(key) ?? 0)) continue;
        const lv = pr.body.linvel();
        if (lv.y > 2) continue;
        padCool.set(key, sim.time + 700);
        pr.body.setLinvel({ x: lv.x, y: pad.power * 0.8, z: lv.z }, true);
      }
    }
    if (padCool.size > 200) for (const [k, t] of padCool) if (t < sim.time) padCool.delete(k);
  };

  const stepRings = () => {
    for (const v of sim.vehicles) {
      if (v.dead || !v.behavior.body) continue;
      const t = v.behavior.body.translation();
      const prev = prevPos.get(v.id);
      prevPos.set(v.id, [t.x, t.y, t.z]);
      if (!prev || !v.driver) continue;
      for (let i = 0; i < RINGS.length; i++) {
        const r = RINGS[i];
        const d0 = (prev[0] - r.x) * r.nx + (prev[2] - r.z) * r.nz;
        const d1 = (t.x - r.x) * r.nx + (t.z - r.z) * r.nz;
        if (d0 * d1 >= 0 || d0 === d1) continue;
        const k = d0 / (d0 - d1);
        const ix = prev[0] + (t.x - prev[0]) * k, iy = prev[1] + (t.y - prev[1]) * k, iz = prev[2] + (t.z - prev[2]) * k;
        const lateral = (ix - r.x) * -r.nz + (iz - r.z) * r.nx;
        if (Math.hypot(lateral, iy - r.y) > r.r + 0.6) continue;
        const key = `${v.id}:${i}`;
        if (sim.time < (ringCool.get(key) ?? 0)) continue;
        ringCool.set(key, sim.time + 3000);
        const n = (ringScore.get(v.driver.id) ?? 0) + 1;
        ringScore.set(v.driver.id, n);
        sim.fx({ k: 'confetti', p: [r.x, r.y, r.z], b: 50 });
        sim.fx({ k: 'sound', p: [r.x, r.y, r.z], s: 'pop' });
        sim.fx({ k: 'text', p: [r.x, r.y + r.r + 1, r.z], s: `CERCEAU ! (${n})`, c: 0xffd60a });
        if (n % 3 === 0) sim.announce(`🎯 ${v.driver.name} a traversé ${n} cerceaux de cascade.`);
      }
    }
  };

  const stepMiaou = () => {
    if (sim.time % 400 > 20) return; // ~ toutes les 0,4 s
    for (const p of sim.players.values()) {
      const until = p.scratch.miaouUntil as number | undefined;
      if (until === undefined) continue;
      if (sim.time > until) { delete p.scratch.miaouUntil; continue; }
      const b = p.vehicle?.behavior.body ?? p.body;
      const lv = b.linvel(), t = b.translation();
      if (Math.hypot(lv.x, lv.z) > 1.2) sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'meow' });
    }
  };

  const extras: Extras = {
    events, modes, resetWorld, rings: ringScore,
    step() {
      events.step();
      modes.step();
      stepPads();
      stepRings();
      stepMiaou();
    },
  };
  bySim.set(sim, extras);
  return extras;
}

// ---------- Commandes de chat (enregistrées une fois ; elles retrouvent leurs extras via ctx.sim) ----------
const honk = (sim: Sim) => {
  for (const v of sim.vehicles) {
    if (v.dead || !v.behavior.body) continue;
    const t = v.behavior.body.translation();
    sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: `horn_${1 + ((Math.random() * 5) | 0)}` });
    sim.fx({ k: 'text', p: [t.x, t.y + 2.5, t.z], s: 'POUET', c: 0xffd60a });
  }
};
let lastHonk = -1e9;

registerCommand('meteo', ({ sim, args, reply, announce, player }) => {
  const x = bySim.get(sim);
  if (!x) return reply('Les événements ne sont pas disponibles.');
  const q = args.join(' ').trim();
  if (!q) {
    const act = x.events.active();
    return reply(`Événements : ${eventList().map((e) => `${e.id} (${e.seconds} s)`).join(', ')}.${act ? ` En cours : ${act}.` : ''} Usage : /meteo <id> · /meteo stop`);
  }
  if (q === 'stop' || q === 'arret' || q === 'arrêt') return reply(x.events.stop() ? 'Événement arrêté.' : 'Aucun événement en cours.');
  const err = x.events.start(q, player.name);
  if (err) reply(err);
  else announce(`🎛️ ${player.name} a commandé la météo.`);
}, '/meteo <id> : lance un événement chaos (sans argument : la liste)');

registerCommand('party', ({ sim, reply, player, announce }) => {
  const x = bySim.get(sim);
  const err = x?.events.start('party_generale', player.name);
  if (err) reply(err);
  else announce(`🎛️ ${player.name} lance la fête.`);
}, '/party : party générale (15 s)');

registerCommand('klaxon', ({ sim, player, reply, announce }) => {
  if (sim.time - lastHonk < 8000) return reply('Les klaxons ont besoin de souffler (8 s).');
  lastHonk = sim.time;
  honk(sim);
  announce(`📯 ${player.name} a appuyé sur TOUS les klaxons.`);
}, '/klaxon : tous les véhicules klaxonnent');

registerCommand('miaou', ({ sim, player, announce }) => {
  player.scratch.miaouUntil = sim.time + 10_000;
  announce(`🐱 ${player.name} se met à miauler à chaque pas (10 s).`);
}, '/miaou : miaule à chaque pas pendant 10 s');

registerCommand('annonce', ({ sim, player, args, reply, announce }) => {
  const text = args.join(' ').trim().slice(0, 120);
  if (!text) return reply('Usage : /annonce <texte>');
  announce(`📣 ANNONCE de ${player.name} : ${text}`);
  for (const p of sim.players.values()) {
    const t = (p.vehicle?.behavior.body ?? p.body).translation();
    sim.fx({ k: 'text', p: [t.x, t.y + 4, t.z], s: text.slice(0, 38), c: 0xffe066 });
    sim.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'fanfare' });
  }
}, '/annonce <texte> : message géant avec fanfare');

registerCommand('reset', ({ sim, player, args, reply, announce }) => {
  const x = bySim.get(sim);
  if (!x) return reply('Indisponible.');
  if ((args[0] ?? '').toLowerCase() !== 'oui') return reply('Ça remet tous les objets et véhicules du monde à zéro. Confirme avec : /reset oui');
  x.resetWorld();
  announce(`🔄 ${player.name} a remis le monde à zéro (personne n'a été déconnecté).`);
}, '/reset oui : remet props et véhicules du monde à l\'état initial');

const placeKey = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PLACE_ALIASES: Record<string, keyof typeof PLACES> = {
  piste: 'piste', aeroport: 'piste', avion: 'piste', heliport: 'heliport', helico: 'heliport', cascade: 'cascade', cascades: 'cascade',
  parcours: 'parcours', course: 'parcours', ville: 'ville', arene: 'arene', derby: 'arene', colline: 'arene', parking: 'parking',
  supermarche: 'parking', chateau: 'chateau', pont: 'pont',
};
/** Point d'arrivée de /lieu (côté d'où l'on voit le lieu, hors des bâtiments). */
const ARRIVAL: Record<keyof typeof PLACES, [number, number]> = {
  piste: [80, -8], heliport: [110, -18], cascade: [28, 85], parcours: [-114, -62], ville: [-40, 70],
  arene: [-26, -140], parking: [20, -62], chateau: [-92, -5], pont: [96, 30],
};
registerCommand('lieu', ({ sim, player, args, reply }) => {
  const a = args[0] ?? '';
  let x: number, z: number;
  if (a && Number.isFinite(Number(a)) && Number.isFinite(Number(args[1]))) { x = Number(a); z = Number(args[1]); }
  else {
    const key = PLACE_ALIASES[placeKey(a)];
    if (!key) return reply(`Usage : /lieu <nom>. Lieux : ${Object.keys(PLACES).join(', ')}.`);
    [x, z] = ARRIVAL[key];
  }
  sim.teleportPlayer(player, Math.max(-480, Math.min(480, x)), 3, Math.max(-480, Math.min(480, z)));
}, '/lieu <nom> : se téléporter à un lieu (piste, heliport, cascade, parcours, ville, arene, parking, chateau, pont)');

registerCommand('mode', ({ sim, args, reply, announce, player }) => {
  const x = bySim.get(sim);
  if (!x) return reply('Les modes ne sont pas disponibles.');
  const q = (args[0] ?? '').toLowerCase();
  if (!q) {
    const a = x.modes.active();
    return reply(`Modes : ${MODES.map((m) => `${m.id} (${m.aliases[0]})`).join(', ')}. /mode stop · /mode classement${a ? ` — en cours : ${a}` : ''}`);
  }
  if (q === 'stop') return reply(x.modes.stop() ? 'Mode arrêté.' : 'Aucun mode en cours.');
  if (q === 'classement' || q === 'score') return reply(x.modes.active() ? x.modes.ranking() : 'Aucun mode en cours.');
  const err = x.modes.start(q);
  if (err) reply(err);
  else announce(`🎮 ${player.name} a lancé un mode de jeu.`);
}, '/mode <roi|derby|stop|classement> : modes de jeu');

