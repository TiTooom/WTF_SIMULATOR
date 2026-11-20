// Paquet « core » : outils de base (pistolet à gravité, gomme, soudure). Écrit par le cœur du serveur.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { bodyOk } from '../guard';
import type { ItemDef, ItemHandler, Pack, SimApi, SimPlayer, SimProp, SimVehicle, UseCtx } from '../api';

const items: ItemDef[] = [
  { id: 'physgun', name: 'Pistolet à gravité', emoji: '🧲', cat: 'tool', cooldown: 0, hold: true,
    desc: 'Clic gauche maintenu : saisit un objet, un véhicule vide ou un joueur. Molette : distance. Clic droit : geler / dégeler. Relâche pour lancer !' },
  { id: 'remover', name: 'Gomme', emoji: '🧽', cat: 'tool', cooldown: 0.12, hold: true,
    desc: 'Clic gauche : fait disparaître l’objet visé.' },
  { id: 'welder', name: 'Soudure', emoji: '🔥', cat: 'tool', cooldown: 0.2,
    desc: 'Clic gauche sur deux objets pour les souder ensemble. Clic droit : annule la sélection.' },
];

// ---------- Pistolet à gravité ----------
type Grab = { kind: 'prop'; prop: SimProp } | { kind: 'vehicle'; veh: SimVehicle } | { kind: 'player'; player: SimPlayer };
interface PhysState { grab: Grab | null; dist: number }

/** Corps déjà saisis (un corps ne peut être tenu que par un seul joueur). */
const heldBy = new WeakMap<RAPIER.RigidBody, string>();

const state = (p: SimPlayer): PhysState => ((p.scratch.physgun as PhysState) ??= { grab: null, dist: 6 });
const bodyOf = (g: Grab): RAPIER.RigidBody | null =>
  g.kind === 'prop' ? g.prop.body : g.kind === 'vehicle' ? g.veh.behavior.body : g.player.body;

function release(p: SimPlayer, api: SimApi) {
  const s = state(p);
  const g = s.grab;
  if (!g) return;
  s.grab = null;
  const b = bodyOf(g);
  if (g.kind === 'prop') g.prop.held = false;
  // Cible gommée / détruite / déconnectée / expirée : son corps n'existe plus et y toucher EMPOISONNE le monde. On ne fait que vider l'état.
  if (b && !valid(g, api)) { heldBy.delete(b); return; }
  if (b && bodyOk(b)) {
    if (heldBy.get(b) === p.id) heldBy.delete(b);
    try {
      b.wakeUp();
      if (g.kind === 'player') {
        const v = b.linvel();
        g.player.scratch.kb = [v.x, v.z]; // le joueur lancé garde son élan horizontal
        g.player.scratch.heldUntil = 0;
      } else if (g.kind === 'vehicle') g.veh.noImpactUntil = api.time + 100;
    } catch { /* corps déjà retiré */ }
  }
}

function valid(g: Grab, api: SimApi): boolean {
  if (g.kind === 'prop') return api.props.get(g.prop.id) === g.prop && bodyOk(g.prop.body);
  if (g.kind === 'vehicle') return !g.veh.dead && !g.veh.driver && bodyOk(g.veh.behavior.body);
  return api.players.get(g.player.id) === g.player && !g.player.vehicle && g.player.hp > 0 && bodyOk(g.player.body);
}

const physgun: ItemHandler = {
  tick(ctx: UseCtx) {
    const { api, player: p } = ctx;
    const s = state(p);
    s.dist = Math.max(2, Math.min(40, s.dist + ctx.wheel * 1.5));

    if (s.grab && (!valid(s.grab, api) || !ctx.held1)) release(p, api);

    // m2 : geler (objet tenu) / dégeler (objet visé)
    if (ctx.pressed2) {
      if (s.grab?.kind === 'prop') {
        const prop = s.grab.prop;
        release(p, api);
        api.freezeProp(prop, true);
        const t = prop.body.translation();
        api.fx({ k: 'spark', p: [t.x, t.y, t.z] });
        api.fx({ k: 'text', p: [t.x, t.y + 1, t.z], s: '❄️ gelé' });
      } else if (!s.grab) {
        const h = api.raycast(ctx.origin, ctx.dir, 60, p.body);
        if (h?.prop) {
          api.freezeProp(h.prop, !h.prop.frozen);
          api.fx({ k: 'text', p: [h.point.x, h.point.y + 1, h.point.z], s: h.prop.frozen ? '❄️ gelé' : 'dégelé' });
        }
      }
      return;
    }

    if (!s.grab && ctx.pressed1) {
      const h = api.raycast(ctx.origin, ctx.dir, 60, p.body);
      let g: Grab | null = null;
      if (h?.prop) g = { kind: 'prop', prop: h.prop };
      else if (h?.vehicle && !h.vehicle.driver && !h.vehicle.dead) g = { kind: 'vehicle', veh: h.vehicle };
      else if (h?.player && h.player !== p) g = { kind: 'player', player: h.player };
      const b = g && bodyOf(g);
      if (g && b && !heldBy.has(b)) {
        if (g.kind === 'prop') {
          if (g.prop.frozen) api.freezeProp(g.prop, false);
          g.prop.held = true;
        }
        heldBy.set(b, p.id);
        s.grab = g;
        s.dist = Math.max(2, Math.min(40, h!.dist));
      }
    }

    const g = s.grab;
    if (!g || !ctx.held1) return;
    const b = bodyOf(g)!;
    const target = ctx.origin.clone().addScaledVector(ctx.dir, s.dist);
    const t = b.translation();
    const v = b.linvel();
    // Commande PD douce en vitesse : on vise (cible − position) × gain, plafonné, avec lissage
    const want = new THREE.Vector3(target.x - t.x, target.y - t.y, target.z - t.z).multiplyScalar(8);
    if (want.length() > 35) want.setLength(35);
    const k = 0.35;
    b.setLinvel({ x: v.x + (want.x - v.x) * k, y: v.y + (want.y - v.y) * k, z: v.z + (want.z - v.z) * k }, true);
    const w = b.angvel();
    if (g.kind !== 'player') b.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true);
    if (g.kind === 'player') g.player.scratch.heldUntil = api.time + 150;
    if (g.kind === 'vehicle') g.veh.noImpactUntil = api.time + 150;
    if (Math.floor(api.time / 33) !== Math.floor((api.time - ctx.dt * 1000) / 33)) {
      const pt = p.body.translation();
      api.fx({ k: 'beam', p: [pt.x, pt.y + 0.5, pt.z], t: [t.x, t.y, t.z], a: 0.06, c: 0x66ccff });
    }
  },
  holster(p, api) { release(p, api); },
};

// ---------- Gomme ----------
const remover: ItemHandler = {
  use(ctx) {
    const h = ctx.api.raycast(ctx.origin, ctx.dir, 60, ctx.player.body);
    if (!h?.prop) return;
    const t = h.prop.body.translation();
    ctx.api.fx({ k: 'smoke', p: [t.x, t.y, t.z], a: 1 });
    ctx.api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
    ctx.api.removeProp(h.prop);
  },
};

// ---------- Soudure ----------
const welder: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    if (ctx.pressed2) {
      if (p.scratch.weld !== undefined) api.fx({ k: 'text', p: [ctx.origin.x, ctx.origin.y, ctx.origin.z], s: 'Soudure annulée' });
      p.scratch.weld = undefined;
      return;
    }
    const h = api.raycast(ctx.origin, ctx.dir, 60, p.body);
    if (!h?.prop) return;
    const sel = p.scratch.weld as number | undefined;
    const first = sel !== undefined ? api.props.get(sel) : undefined;
    const pt = h.point;
    if (!first || first === h.prop) {
      p.scratch.weld = h.prop.id;
      api.fx({ k: 'spark', p: [pt.x, pt.y, pt.z] });
      api.fx({ k: 'text', p: [pt.x, pt.y + 1, pt.z], s: 'Soudure 1/2' });
      return;
    }
    p.scratch.weld = undefined;
    const b1 = first.body, b2 = h.prop.body;
    const q1 = new THREE.Quaternion(b1.rotation().x, b1.rotation().y, b1.rotation().z, b1.rotation().w);
    const q2inv = new THREE.Quaternion(b2.rotation().x, b2.rotation().y, b2.rotation().z, b2.rotation().w).invert();
    const p1 = new THREE.Vector3(b1.translation().x, b1.translation().y, b1.translation().z);
    const p2 = new THREE.Vector3(b2.translation().x, b2.translation().y, b2.translation().z);
    const a2 = p1.sub(p2).applyQuaternion(q2inv); // origine du corps 1 dans le repère du corps 2
    const f2 = q2inv.multiply(q1);
    const data = RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: a2.x, y: a2.y, z: a2.z }, { x: f2.x, y: f2.y, z: f2.z, w: f2.w });
    const joint = api.world.createImpulseJoint(data, b1, b2, true);
    joint.setContactsEnabled(false);
    api.fx({ k: 'spark', p: [pt.x, pt.y, pt.z] });
    api.fx({ k: 'sound', p: [pt.x, pt.y, pt.z], s: 'zap' });
    api.fx({ k: 'text', p: [pt.x, pt.y + 1, pt.z], s: 'Soudé !' });
  },
  holster(p) { p.scratch.weld = undefined; },
};

export const pack: Pack = { items, props: [], handlers: { physgun, remover, welder } };
