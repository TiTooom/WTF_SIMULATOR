// Paquet « build » : les 10 objets de construction (planche, bloc, rampe, mur, pilier, ballon, trampoline,
// barrique explosive, roue géante, propulseur). Ids de props préfixés `b_`.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ItemDef, ItemHandler, Pack, PropTick, SimApi, SimPlayer, SimProp, SimVehicle, UseCtx } from '../api';
import type { PropKind } from '../props';

const UP = new THREE.Vector3(0, 1, 0);
const RANGE = 14; // portée de pose (m)

// ---------- Props ----------
const props: PropKind[] = [
  { id: 'b_planche', name: 'Planche', shape: 'box', size: [0.8, 0.2, 3], color: 0xc9954f, mass: 6, hp: 80, friction: 0.9 },
  { id: 'b_bloc', name: 'Bloc', shape: 'box', size: [1, 1, 1], color: 0xd2603a, mass: 15, hp: 150, friction: 0.9 },
  { id: 'b_rampe', name: 'Rampe', shape: 'wedge', size: [4, 1.6, 6], color: 0xff8c1a, mass: 300, friction: 0.7 },
  { id: 'b_mur', name: 'Mur', shape: 'box', size: [4, 2.5, 0.4], color: 0x8e8e9a, mass: 400 },
  { id: 'b_pilier_c', name: 'Pilier court', shape: 'cylinder', size: [0.9, 2.5], color: 0xe6dccb, mass: 250 },
  { id: 'b_pilier', name: 'Pilier', shape: 'cylinder', size: [0.9, 5], color: 0xe6dccb, mass: 400 },
  { id: 'b_pilier_g', name: 'Grand pilier', shape: 'cylinder', size: [0.9, 8], color: 0xe6dccb, mass: 600 },
  { id: 'b_ballon', name: 'Ballon flottant', shape: 'sphere', size: [1.3], color: 0xff4d5e, mass: 0.4, gravityScale: -0.25, hp: 4, friction: 0.2, bounce: 0.5, behavior: 'b_balloon' },
  { id: 'b_trampoline', name: 'Trampoline', shape: 'box', size: [3, 0.4, 3], color: 0x2ec4b6, mass: 150, friction: 1.2, bounce: 0.9, behavior: 'b_trampoline' },
  { id: 'b_barrique', name: 'Barrique explosive', shape: 'cylinder', size: [0.8, 1.2], color: 0xd62828, mass: 25, hp: 30, bounce: 0.2,
    explosive: { radius: 4, power: 20, damage: 70 }, behavior: 'b_barrel' },
  { id: 'b_roue', name: 'Roue géante', shape: 'cylinder', size: [4, 0.7], color: 0x3a86ff, mass: 600, friction: 1.4, behavior: 'b_wheel' },
  { id: 'b_propulseur', name: 'Propulseur', shape: 'cylinder', size: [0.6, 0.9], color: 0xff7b00, mass: 40, life: 10, glow: true, behavior: 'b_thruster' },
];

// ---------- Objets ----------
const items: ItemDef[] = [
  { id: 'planche', name: 'Planche', emoji: '🪵', cat: 'build', cooldown: 0.5,
    desc: 'Clic gauche : pose une planche légère. Clic droit : tourne de 90°. Chaque pont commence par une planche. Le suivant aussi.' },
  { id: 'bloc', name: 'Bloc', emoji: '🧱', cat: 'build', cooldown: 0.3,
    desc: 'Clic gauche : pose un cube de 1 m, empilable. Rien ne tient, mais tout tombe avec style.' },
  { id: 'rampe', name: 'Rampe', emoji: '📐', cat: 'build', cooldown: 1,
    desc: 'Clic gauche : pose une rampe fixe qui monte devant toi. Clic droit : tourne de 90°. Ça ne passe jamais, mais ça décolle.' },
  { id: 'mur', name: 'Mur', emoji: '🪨', cat: 'build', cooldown: 1.5,
    desc: 'Clic gauche : pose un mur fixe de 4 × 2,5 m. Clic droit : tourne de 90°. Il ne sert à rien, sauf à être détruit au tank.' },
  { id: 'pilier', name: 'Pilier', emoji: '🏛️', cat: 'build', cooldown: 0.8,
    desc: 'Clic gauche : pose un pilier fixe. Molette : hauteur (2,5 / 5 / 8 m). C’est toujours celui que tout le monde pousse.' },
  { id: 'ballon_flottant', name: 'Ballon flottant', emoji: '🎈', cat: 'build', cooldown: 4,
    desc: 'Clic gauche sur une caisse ou un véhicule : y attache un ballon qui le soulève jusqu’à 15 m. Une voiture qui flotte, c’est un argument de vente.' },
  { id: 'trampoline', name: 'Trampoline', emoji: '🤸', cat: 'build', cooldown: 2,
    desc: 'Clic gauche : pose un trampoline qui double ta vitesse de chute et te renvoie en l’air. Adore les pelleteuses.' },
  { id: 'barrique_explosive', name: 'Barrique explosive', emoji: '🛢️', cat: 'build', cooldown: 6,
    desc: 'Clic gauche : pose une barrique. Clic droit : la lance. Elle explose au tir ou à l’impact, parfois juste pour la décoration.' },
  { id: 'roue_geante', name: 'Roue géante', emoji: '🎡', cat: 'build', cooldown: 8,
    desc: 'Clic gauche : pose une roue qui tourne sans arrêt. Clic droit sur la roue : inverse le sens. Un manège sans prévenir.' },
  { id: 'propulseur', name: 'Propulseur', emoji: '🚀', cat: 'build', cooldown: 3,
    desc: 'Clic gauche : pose un réacteur fixe pendant 10 s. Molette : inclinaison. Clic droit : inverse la poussée. Un réacteur de baignoire, ça pousse plus que prévu.' },
];

// ---------- Utilitaires de placement ----------
const refusals = ['Trop loin !', 'Rien à portée…', 'Tu vises le ciel ?', 'Dans le vide ? Non.'];

const yawOf = (dir: THREE.Vector3) => Math.atan2(-dir.x, -dir.z); // lacet qui amène l'axe local −z sur la visée horizontale
const yawQuat = (a: number) => new THREE.Quaternion().setFromAxisAngle(UP, a);

function rotSteps(p: SimPlayer, id: string): number { return ((p.scratch['b_rot_' + id] as number) ?? 0); }

/** Demi-étendue d'un prop (orienté par q) dans la direction n : sert à poser sans s'enfoncer. */
function support(k: PropKind, q: THREE.Quaternion, n: THREE.Vector3): number {
  const [a, b, c] = k.size;
  if (k.shape === 'sphere') return a / 2;
  if (k.shape === 'cylinder') {
    const c0 = Math.abs(n.dot(UP.clone().applyQuaternion(q)));
    return c0 * ((b ?? a) / 2) + Math.sqrt(Math.max(0, 1 - c0 * c0)) * (a / 2);
  }
  const h = [a / 2, (b ?? a) / 2, (c ?? a) / 2];
  const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  return ax.reduce((s, v, i) => s + Math.abs(n.dot(v.applyQuaternion(q))) * h[i], 0);
}

/** Vise, pose un prop au point d'impact (décalé selon la normale) ; null + refus drôle si rien n'est visé. */
function place(ctx: UseCtx, id: string, kindId: string, q: THREE.Quaternion, freeze: boolean,
  vel?: THREE.Vector3, extra = 0): { prop: SimProp; point: THREE.Vector3 } | null {
  const { api, player: p } = ctx;
  const kind = props.find((k) => k.id === kindId)!;
  const hit = api.raycast(ctx.origin, ctx.dir, RANGE, p.body);
  if (!hit) {
    const at = ctx.origin.clone().addScaledVector(ctx.dir, 3);
    api.fx({ k: 'text', p: [at.x, at.y, at.z], s: refusals[Math.floor(api.time / 1000) % refusals.length] });
    p.cooldowns[id] = api.time; // un refus ne coûte pas de recharge
    return null;
  }
  const n = hit.normal.clone().normalize();
  const pos = hit.point.clone().addScaledVector(n, support(kind, q, n) + 0.03 + extra);
  const prop = api.spawnProp(kindId, pos, q, vel, p);
  if (!prop) return null;
  if (freeze) api.freezeProp(prop, true);
  api.fx({ k: 'sound', p: [pos.x, pos.y, pos.z], s: 'pop' });
  api.fx({ k: 'spark', p: [hit.point.x, hit.point.y, hit.point.z], a: 0.5, b: 5 });
  return { prop, point: pos };
}

/** Mémorise la recharge avant utilisation pour qu'un clic droit « tourner » n'en coûte pas. */
function rotateTick(item: string, ctx: UseCtx): boolean {
  const p = ctx.player;
  p.scratch['b_cd_' + item] = p.cooldowns[item] ?? 0;
  if (!ctx.pressed2 || ctx.pressed1) return false;
  const n = rotSteps(p, item) + 1;
  p.scratch['b_rot_' + item] = n % 4;
  const o = ctx.origin.clone().addScaledVector(ctx.dir, 2.5);
  ctx.api.fx({ k: 'text', p: [o.x, o.y, o.z], s: `↻ ${(n % 4) * 90}°` });
  return true;
}
const refund = (item: string, ctx: UseCtx) => { ctx.player.cooldowns[item] = (ctx.player.scratch['b_cd_' + item] as number) ?? 0; };

function simple(item: string, kindId: string, opts: { freeze: boolean; rotate: boolean; orient?: (yaw: number) => THREE.Quaternion }): ItemHandler {
  return {
    tick(ctx) { if (opts.rotate) rotateTick(item, ctx); else ctx.player.scratch['b_cd_' + item] = ctx.player.cooldowns[item] ?? 0; },
    use(ctx) {
      if (!ctx.pressed1) { refund(item, ctx); return; }
      const yaw = yawOf(ctx.dir) + (opts.rotate ? rotSteps(ctx.player, item) * Math.PI / 2 : 0);
      place(ctx, item, kindId, opts.orient ? opts.orient(yaw) : yawQuat(yaw), opts.freeze);
    },
  };
}

// ---------- Pilier : hauteur à la molette ----------
const PILLARS = [{ id: 'b_pilier_c', h: 2.5 }, { id: 'b_pilier', h: 5 }, { id: 'b_pilier_g', h: 8 }];
const pilier: ItemHandler = {
  tick(ctx) {
    const p = ctx.player;
    p.scratch.b_cd_pilier = p.cooldowns.pilier ?? 0;
    if (ctx.wheel) {
      const cur = (p.scratch.b_pil as number) ?? 1;
      const next = Math.max(0, Math.min(2, cur + (ctx.wheel > 0 ? 1 : -1)));
      p.scratch.b_pil = next;
      const o = ctx.origin.clone().addScaledVector(ctx.dir, 2.5);
      ctx.api.fx({ k: 'text', p: [o.x, o.y, o.z], s: `Hauteur : ${PILLARS[next].h} m` });
    }
  },
  use(ctx) {
    if (!ctx.pressed1) { refund('pilier', ctx); return; }
    const sel = PILLARS[(ctx.player.scratch.b_pil as number) ?? 1];
    place(ctx, 'pilier', sel.id, new THREE.Quaternion(), true);
  },
};

// ---------- Barrique : poser / lancer ----------
const barrique: ItemHandler = {
  tick(ctx) { ctx.player.scratch.b_cd_barrique_explosive = ctx.player.cooldowns.barrique_explosive ?? 0; },
  use(ctx) {
    const { api, player: p } = ctx;
    if (ctx.pressed2 && !ctx.pressed1) {
      const pos = ctx.origin.clone().addScaledVector(ctx.dir, 1.8);
      const v = ctx.dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3, 0));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
      const prop = api.spawnProp('b_barrique', pos, q, v, p);
      if (prop) {
        prop.body.setAngvel({ x: 4, y: 0, z: 2 }, true);
        api.fx({ k: 'sound', p: [pos.x, pos.y, pos.z], s: 'whoosh' });
        api.fx({ k: 'text', p: [pos.x, pos.y + 1, pos.z], s: 'Attention, ça vole !' });
      }
      return;
    }
    place(ctx, 'barrique_explosive', 'b_barrique', new THREE.Quaternion(), false);
  },
};

// ---------- Roue géante : m2 inverse le sens de la roue visée ----------
const roue: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    p.scratch.b_cd_roue_geante = p.cooldowns.roue_geante ?? 0;
    if (ctx.pressed2 && !ctx.pressed1) {
      const h = api.raycast(ctx.origin, ctx.dir, 40, p.body);
      if (h?.prop?.kind.id === 'b_roue') {
        const st = wheelState(h.prop);
        st.dir = -st.dir;
        const t = h.prop.body.translation();
        api.fx({ k: 'text', p: [t.x, t.y + 2.6, t.z], s: st.dir > 0 ? '↻ Sens horaire' : '↺ Sens inverse' });
        api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' });
      } else api.fx({ k: 'text', p: [ctx.origin.x + ctx.dir.x * 2, ctx.origin.y + ctx.dir.y * 2, ctx.origin.z + ctx.dir.z * 2], s: 'Vise une roue !' });
    }
  },
  use(ctx) {
    if (!ctx.pressed1) { refund('roue_geante', ctx); return; }
    // axe de rotation = direction du regard à plat : le joueur voit le disque de face
    const h = new THREE.Vector3(ctx.dir.x, 0, ctx.dir.z);
    if (h.lengthSq() < 1e-6) h.set(0, 0, -1);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, h.normalize());
    place(ctx, 'roue_geante', 'b_roue', q, false);
  },
};

// ---------- Propulseur : inclinaison à la molette ----------
const propulseur: ItemHandler = {
  tick(ctx) {
    const p = ctx.player;
    p.scratch.b_cd_propulseur = p.cooldowns.propulseur ?? 0;
    if (ctx.wheel) {
      const cur = (p.scratch.b_elev as number) ?? 0;
      const next = Math.max(-90, Math.min(90, cur + (ctx.wheel > 0 ? 15 : -15)));
      p.scratch.b_elev = next;
      const o = ctx.origin.clone().addScaledVector(ctx.dir, 2.5);
      ctx.api.fx({ k: 'text', p: [o.x, o.y, o.z], s: `Inclinaison : ${next}°` });
    }
    if (ctx.pressed2 && !ctx.pressed1) {
      p.scratch.b_rev = !p.scratch.b_rev;
      const o = ctx.origin.clone().addScaledVector(ctx.dir, 2.5);
      ctx.api.fx({ k: 'text', p: [o.x, o.y, o.z], s: p.scratch.b_rev ? 'Poussée inversée' : 'Poussée normale' });
    }
  },
  use(ctx) {
    if (!ctx.pressed1) { refund('propulseur', ctx); return; }
    const e = (((ctx.player.scratch.b_elev as number) ?? 0) * Math.PI) / 180;
    const h = new THREE.Vector3(ctx.dir.x, 0, ctx.dir.z);
    if (h.lengthSq() < 1e-6) h.set(0, 0, -1);
    h.normalize();
    const thrust = new THREE.Vector3(h.x * Math.cos(e), Math.sin(e), h.z * Math.cos(e));
    if (ctx.player.scratch.b_rev) thrust.negate();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, thrust); // axe y local = sens de la poussée
    const r = place(ctx, 'propulseur', 'b_propulseur', q, true);
    if (r) ctx.api.fx({ k: 'text', p: [r.point.x, r.point.y + 1, r.point.z], s: '3… 2… 1… 🔥' });
  },
};

// ---------- Ballon ----------
type Target = { kind: 'prop'; prop: SimProp } | { kind: 'veh'; veh: SimVehicle };
interface Balloon { target: Target | null; since: number; phase: number }
const balloons = new WeakMap<SimProp, Balloon>();
const lifted = new WeakMap<object, number>(); // un seul soulèvement par cible et par pas

const ballon: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const h = api.raycast(ctx.origin, ctx.dir, 30, p.body);
    if (!h) {
      const at = ctx.origin.clone().addScaledVector(ctx.dir, 3);
      api.fx({ k: 'text', p: [at.x, at.y, at.z], s: 'Un ballon dans le vide, très poétique.' });
      p.cooldowns.ballon_flottant = api.time;
      return;
    }
    let target: Target | null = null;
    if (h.prop && !h.prop.frozen && h.prop.kind.id !== 'b_ballon') target = { kind: 'prop', prop: h.prop };
    else if (h.vehicle && !h.vehicle.dead) target = { kind: 'veh', veh: h.vehicle };
    const base = target
      ? (() => { const b = target.kind === 'prop' ? target.prop.body : target.veh.behavior.body; const t = b.translation(); return new THREE.Vector3(t.x, t.y + 3.2, t.z); })()
      : h.point.clone().addScaledVector(h.normal, 1);
    const prop = api.spawnProp('b_ballon', base, undefined, undefined, p);
    if (!prop) return;
    balloons.set(prop, { target, since: api.time, phase: Math.random() * 6 });
    api.fx({ k: 'sound', p: [base.x, base.y, base.z], s: 'bloop' });
    api.fx({ k: 'text', p: [base.x, base.y + 1, base.z], s: target ? 'Décollage !' : 'Il s’envole…' });
  },
};

const g = (api: SimApi) => -api.world.gravity.y;

const balloonTick: PropTick = (prop, api, dt) => {
  let st = balloons.get(prop);
  if (!st) { st = { target: null, since: api.time, phase: 0 }; balloons.set(prop, st); } // ballon restauré / orphelin
  const b = prop.body;
  const t = b.translation();
  const tg = st.target;
  let tb: RAPIER.RigidBody | null = null;
  if (tg) {
    if (tg.kind === 'prop') tb = api.props.get(tg.prop.id) === tg.prop ? tg.prop.body : null;
    else tb = !tg.veh.dead && tg.veh.behavior.body ? tg.veh.behavior.body : null;
    if (!tb) { st.target = null; st.since = api.time; }
  }
  if (tb && tg) {
    const tt = tb.translation();
    const lv = tb.linvel();
    const tilt = Math.sin(api.time / 700 + st.phase) * 0.3;
    b.setTranslation({ x: tt.x + tilt, y: tt.y + 3.2, z: tt.z - tilt }, true);
    b.setLinvel(lv, true);
    const frozen = tg.kind === 'prop' && (tg.prop.frozen || tg.prop.held);
    if (!frozen && lifted.get(tb) !== api.time) {
      lifted.set(tb, api.time);
      const y = tt.y;
      const vt = Math.max(-3, Math.min(3, (15 - y) * 0.6));
      const acc = Math.max(0, Math.min(40, g(api) + 3 * (vt - lv.y)));
      const m = tb.mass();
      tb.applyImpulse({ x: 0, y: m * acc * dt, z: 0 }, true);
      // la gravité s'applique déjà : l'impulsion ci-dessus compense (acc inclut g)
      if (tg.kind === 'veh') tg.veh.noImpactUntil = api.time + 100;
    }
    if (Math.floor(api.time / 50) !== Math.floor((api.time - dt * 1000) / 50)) {
      api.fx({ k: 'beam', p: [tt.x, tt.y + 0.4, tt.z], t: [t.x, t.y - 0.6, t.z], a: 0.03, c: 0xffffff });
    }
  } else {
    // ballon seul : monte puis finit par éclater
    if (t.y > 15) { const v = b.linvel(); b.setLinvel({ x: v.x, y: Math.min(v.y, 0.5), z: v.z }, true); }
    if (api.time - st.since > 14000) {
      api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
      api.fx({ k: 'confetti', p: [t.x, t.y, t.z], c: 0xff4d5e, b: 14 });
      api.fx({ k: 'text', p: [t.x, t.y + 1, t.z], s: 'POP !' });
      api.removeProp(prop);
    }
  }
};

// ---------- Trampoline ----------
const lastBounce = new WeakMap<object, number>();
const trampolineTick: PropTick = (prop, api) => {
  const b = prop.body;
  const tt = b.translation();
  const center = new THREE.Vector3(tt.x, tt.y, tt.z);
  const q = api.quatOf(b);
  const up = UP.clone().applyQuaternion(q);
  const inv = q.clone().invert();
  for (const h of api.nearby(center, 4.2)) {
    if (!h.body || h.body === b) continue;
    if (h.kind === 'prop' && (h.prop!.frozen || h.prop!.held || h.prop!.kind.id === 'b_trampoline')) continue;
    const r = h.point.clone().sub(center);
    const local = r.clone().applyQuaternion(inv);
    const reach = h.kind === 'vehicle' ? 2.1 : h.kind === 'player' ? 1.35 : 1.1;
    if (Math.abs(local.x) > 1.8 || Math.abs(local.z) > 1.8 || local.y < 0.05 || local.y > reach) continue;
    if (api.time - (lastBounce.get(h.body) ?? -1e9) < 400) continue;
    const v = h.body.linvel();
    const vu = v.x * up.x + v.y * up.y + v.z * up.z;
    if (vu > (h.kind === 'prop' ? -1 : 0.6)) continue;
    lastBounce.set(h.body, api.time);
    const out = Math.max(13, Math.min(32, -vu * 2));
    const nv = { x: v.x - up.x * vu + up.x * out, y: v.y - up.y * vu + up.y * out, z: v.z - up.z * vu + up.z * out };
    h.body.setLinvel(nv, true);
    if (h.vehicle) h.vehicle.noImpactUntil = api.time + 400;
    if (h.player) h.player.scratch.heldUntil = 0;
    api.fx({ k: 'sound', p: [tt.x, tt.y, tt.z], s: 'boing' });
    api.fx({ k: 'ring', p: [tt.x, tt.y + 0.3, tt.z], a: 2.2, c: 0x2ec4b6 });
    api.fx({ k: 'text', p: [tt.x, tt.y + 1.2, tt.z], s: out > 22 ? 'BOOOING !!' : 'BOING !' });
  }
};

// ---------- Barrique ----------
interface BarrelState { v: THREE.Vector3 | null; burn: number }
const barrels = new WeakMap<SimProp, BarrelState>();
const barrelTick: PropTick = (prop, api, dt) => {
  let st = barrels.get(prop);
  if (!st) { st = { v: null, burn: 0 }; barrels.set(prop, st); }
  const lv = prop.body.linvel();
  const t = prop.body.translation();
  const by = api.players.get(prop.owner) ?? null;
  if (st.v && !prop.held && api.time - prop.bornAt > 350) {
    const dv = Math.hypot(lv.x - st.v.x, lv.y - st.v.y, lv.z - st.v.z);
    if (dv > 9) { api.damageProp(prop, 9999, by); return; }
  }
  st.v = new THREE.Vector3(lv.x, lv.y, lv.z);
  // touchée sans être détruite : elle s'enflamme puis explose
  if (prop.hp < (prop.kind.hp ?? 30) && st.burn === 0) {
    st.burn = api.time;
    api.fx({ k: 'text', p: [t.x, t.y + 1.2, t.z], s: '🔥 Oh oh…' });
  }
  if (st.burn) {
    if (Math.floor(api.time / 100) !== Math.floor((api.time - dt * 1000) / 100)) {
      api.fx({ k: 'smoke', p: [t.x, t.y + 0.7, t.z], a: 0.7, b: 2 });
      api.fx({ k: 'spark', p: [t.x, t.y + 0.7, t.z], a: 0.6, b: 5 });
    }
    if (api.time - st.burn > 1800) api.damageProp(prop, 9999, by);
  }
};

// ---------- Roue géante : vitesse angulaire imposée, centre ancré ----------
const WHEEL_SPEED = 2.2; // rad/s (bord ≈ 4,4 m/s)
interface WheelState { dir: number; anchor: THREE.Vector3 | null; axis: THREE.Vector3 | null; ang: number }
const wheels = new WeakMap<SimProp, WheelState>();
const wheelState = (p: SimProp): WheelState => {
  let s = wheels.get(p);
  if (!s) { s = { dir: 1, anchor: null, axis: null, ang: 0 }; wheels.set(p, s); }
  return s;
};
const wheelTick: PropTick = (prop, api, dt) => {
  const st = wheelState(prop);
  const b = prop.body;
  if (prop.held || prop.frozen) { st.anchor = null; st.axis = null; return; }
  const t = b.translation();
  if (!st.anchor) {
    st.anchor = new THREE.Vector3(t.x, t.y, t.z);
    st.axis = UP.clone().applyQuaternion(api.quatOf(b));
  }
  const a = st.anchor;
  // ressort sur l'ancre : la roue reste en place même quand un tank la percute
  b.setLinvel({ x: (a.x - t.x) * 12, y: (a.y - t.y) * 12, z: (a.z - t.z) * 12 }, true);
  const w = WHEEL_SPEED * st.dir;
  b.setAngvel({ x: st.axis!.x * w, y: st.axis!.y * w, z: st.axis!.z * w }, true);
  st.ang += w * dt;
  // repère lumineux sur la jante (le modèle client est un cylindre uni)
  if (Math.floor(api.time / 120) !== Math.floor((api.time - dt * 1000) / 120)) {
    const ax = st.axis!;
    const perp = new THREE.Vector3().crossVectors(ax, UP);
    if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
    perp.normalize().applyAxisAngle(ax, st.ang).multiplyScalar(1.85);
    const r = perp;
    api.fx({ k: 'spark', p: [t.x + r.x, t.y + r.y, t.z + r.z], a: 0.3, b: 3, c: 0xfff1a8 });
  }
};

// ---------- Propulseur ----------
const THRUST = 24; // m/s² (au-dessus de g : ça soulève)
const thrusterTick: PropTick = (prop, api, dt) => {
  const b = prop.body;
  const t = b.translation();
  const q = api.quatOf(b);
  const dir = UP.clone().applyQuaternion(q);
  const pos = new THREE.Vector3(t.x, t.y, t.z);
  const nozzle = pos.clone().addScaledVector(dir, -0.5);
  const zone = pos.clone().addScaledVector(dir, 3.2);
  for (const h of api.nearby(zone, 3.6)) {
    if (!h.body || h.body === b) continue;
    if (h.prop && (h.prop.frozen || h.prop.held)) continue;
    if (h.player) {
      const kb = ((h.player.scratch.kb as [number, number] | undefined) ??= [0, 0]);
      kb[0] += dir.x * THRUST * dt * 1.5;
      kb[1] += dir.z * THRUST * dt * 1.5;
      const v = h.body.linvel();
      h.body.setLinvel({ x: v.x, y: v.y + dir.y * THRUST * dt, z: v.z }, true);
      continue;
    }
    const m = h.body.mass();
    h.body.applyImpulse({ x: dir.x * THRUST * m * dt, y: dir.y * THRUST * m * dt, z: dir.z * THRUST * m * dt }, true);
    if (h.vehicle) h.vehicle.noImpactUntil = api.time + 100;
  }
  if (Math.floor(api.time / 70) !== Math.floor((api.time - dt * 1000) / 70)) {
    const end = nozzle.clone().addScaledVector(dir, -(1.4 + Math.random() * 0.8));
    api.fx({ k: 'beam', p: [nozzle.x, nozzle.y, nozzle.z], t: [end.x, end.y, end.z], a: 0.35, c: 0xffb020 });
    api.fx({ k: 'spark', p: [end.x, end.y, end.z], a: 0.6, b: 3, c: 0xff5a1a });
  }
  if (Math.floor(api.time / 800) !== Math.floor((api.time - dt * 1000) / 800)) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
};

export const pack: Pack = {
  items,
  props,
  handlers: {
    planche: simple('planche', 'b_planche', { freeze: false, rotate: true }),
    bloc: simple('bloc', 'b_bloc', { freeze: false, rotate: false }),
    rampe: simple('rampe', 'b_rampe', { freeze: true, rotate: true }),
    mur: simple('mur', 'b_mur', { freeze: true, rotate: true }),
    pilier,
    ballon_flottant: ballon,
    trampoline: simple('trampoline', 'b_trampoline', { freeze: false, rotate: false }),
    barrique_explosive: barrique,
    roue_geante: roue,
    propulseur,
  },
  propTicks: {
    b_balloon: balloonTick,
    b_trampoline: trampolineTick,
    b_barrel: barrelTick,
    b_wheel: wheelTick,
    b_thruster: thrusterTick,
  },
};
