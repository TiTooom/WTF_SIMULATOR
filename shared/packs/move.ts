// Paquet « move » : jetpack, grappin, parachute, bottes de gravité, téléporteur.
import * as THREE from 'three';
import type { ItemDef, ItemHandler, Pack, PropTick, SimApi, SimPlayer, SimProp, UseCtx } from '../api';
import type { PropKind } from '../props';
import { bodyOk } from '../guard';

const items: ItemDef[] = [
  { id: 'jetpack', name: 'Jetpack', emoji: '🧑‍🚀', cat: 'move', cooldown: 0, hold: true,
    desc: 'Espace maintenu : monte (Z/S/Q/D pour avancer). 8 s de réservoir, 3 s de surchauffe, recharge au sol. Clic droit : coupe.' },
  { id: 'grappin', name: 'Grappin', emoji: '🪝', cat: 'move', cooldown: 1,
    desc: 'Clic gauche : lance le crochet (30 m) et te tire vers le point visé. Clic droit : lâche le câble.' },
  { id: 'parachute', name: 'Parachute', emoji: '🪂', cat: 'move', cooldown: 0, hold: true,
    desc: 'Clic droit maintenu en l’air : ouvre le parachute, tu tombes 4 fois moins vite. Relâche pour refermer.' },
  { id: 'bottes_gravite', name: 'Bottes de gravité réduite', emoji: '👢', cat: 'move', cooldown: 30,
    desc: 'Clic gauche : équipe les bottes 20 s. Gravité ×0,4 et sauts énormes (Espace).' },
  { id: 'teleporteur', name: 'Téléporteur', emoji: '📍', cat: 'move', cooldown: 0.5,
    desc: 'Clic gauche : pose une balise (60 s). Clic droit : te téléporte dessus (30 m max, atterrissage approximatif).' },
];

const props: PropKind[] = [
  { id: 'm_balise', name: 'Balise de téléportation', shape: 'cylinder', size: [0.9, 0.12], color: 0x66f0ff, mass: 5, life: 60, glow: true, behavior: 'm_balise' },
];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const grounded = (api: SimApi, p: SimPlayer) => {
  const t = p.body.translation();
  return !!api.raycast(V(t.x, t.y, t.z), V(0, -1, 0), 1.15 * p.mods.scale, p.body);
};

const kbSet = (p: SimPlayer, x: number, z: number) => { p.scratch.kb = [x, z]; };
const everyMs = (api: SimApi, ms: number) => Math.floor(api.time / ms) !== Math.floor((api.time - 17) / ms);

/** `use` est déclenché par m1 comme par m2 : on rend la recharge si le clic n'était pas le bon. */
const remember = (ctx: UseCtx, id: string) => { ctx.player.scratch['cd_' + id] = ctx.player.cooldowns[id] ?? 0; };
const refund = (ctx: UseCtx, id: string) => {
  const prev = ctx.player.scratch['cd_' + id];
  ctx.player.cooldowns[id] = typeof prev === 'number' ? prev : 0;
};

// ---------- Jetpack ----------
interface Jet { fuel: number; hot: number; shown: number; thrusting: boolean }
const FUEL = 8;
const jet = (p: SimPlayer): Jet => ((p.scratch.jet as Jet) ??= { fuel: FUEL, hot: 0, shown: 0, thrusting: false });
const gauge = (f: number) => '⛽ ' + '▮'.repeat(Math.max(0, Math.round((f / FUEL) * 8))) + '▯'.repeat(8 - Math.max(0, Math.round((f / FUEL) * 8)));

const jetpack: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    const j = jet(p);
    const dt = ctx.dt;
    const t = p.body.translation();
    const i = p.input;
    const overheated = api.time < j.hot;
    const wants = !!i.jump && !ctx.held2 && !overheated && j.fuel > 0 && !p.vehicle;
    if (wants) {
      if (!j.thrusting) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
      j.thrusting = true;
      j.fuel = Math.max(0, j.fuel - dt);
      const lv = p.body.linvel();
      const vy = Math.min(lv.y + 30 * dt, 9);
      p.body.setLinvel({ x: lv.x, y: vy, z: lv.z }, true);
      const dir = V(i.s, 0, -i.f).applyAxisAngle(V(0, 1, 0), i.yaw);
      if (dir.lengthSq() > 1) dir.normalize();
      kbSet(p, dir.x * 7, dir.z * 7); // poussée avant (en plus de la marche)
      if (everyMs(api, 50)) {
        api.fx({ k: 'spark', p: [t.x + rnd(-0.1, 0.1), t.y - 0.8, t.z + rnd(-0.1, 0.1)], a: 0.5, b: 5, c: 0xff8a1a });
        api.fx({ k: 'smoke', p: [t.x, t.y - 0.9, t.z], a: 0.6, b: 1 });
      }
      if (everyMs(api, 700)) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh', a: 0.5 });
      if (j.fuel <= 0) {
        j.hot = api.time + 3000;
        j.thrusting = false;
        api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: '🔥 SURCHAUFFE ! pfff...', c: 0xff5533 });
        api.fx({ k: 'smoke', p: [t.x, t.y - 0.5, t.z], a: 1.4, b: 6 });
        api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' });
      }
    } else {
      j.thrusting = false;
      // recharge au sol : réservoir plein en ~10 s
      if (!overheated && grounded(api, p)) {
        const before = j.fuel;
        j.fuel = Math.min(FUEL, j.fuel + (FUEL / 10) * dt);
        if (before < FUEL && j.fuel >= FUEL) api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: '⛽ Plein !', c: 0x88ff88 });
      }
    }
    if (api.time - j.shown > 900 && (wants || j.fuel < FUEL)) {
      j.shown = api.time;
      const s = overheated ? '🔥 refroidissement…' : gauge(j.fuel);
      api.fx({ k: 'text', p: [t.x, t.y + 1.3, t.z], s, c: overheated ? 0xff5533 : j.fuel < 2.5 ? 0xffaa33 : 0x8fe3ff });
    }
  },
  holster(p) { jet(p).thrusting = false; },
};

// ---------- Grappin ----------
interface Hook { point: THREE.Vector3; prop?: SimProp; until: number }
const hooks = new WeakMap<SimPlayer, Hook>();

const grappin: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    if (!ctx.pressed1) { refund(ctx, 'grappin'); return; }
    const h = api.raycast(ctx.origin, ctx.dir, 30, p.body);
    const t = p.body.translation();
    if (!h) {
      api.fx({ k: 'beam', p: [t.x, t.y + 0.6, t.z], t: [ctx.origin.x + ctx.dir.x * 30, ctx.origin.y + ctx.dir.y * 30, ctx.origin.z + ctx.dir.z * 30], a: 0.05, c: 0x444444 });
      api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'Rien à accrocher... 🪝' });
      return;
    }
    hooks.set(p, { point: h.point.clone(), prop: h.prop, until: api.time + 3500 });
    api.fx({ k: 'sound', p: [h.point.x, h.point.y, h.point.z], s: 'zap' });
    api.fx({ k: 'spark', p: [h.point.x, h.point.y, h.point.z], a: 0.6 });
    api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'GRAPPIN !' });
  },
  tick(ctx) {
    const { api, player: p } = ctx;
    remember(ctx, 'grappin');
    const hk = hooks.get(p);
    if (!hk) return;
    const t = p.body.translation();
    if (hk.prop) {
      if (api.props.get(hk.prop.id) !== hk.prop || !bodyOk(hk.prop.body)) { hooks.delete(p); return; }
      const pt = hk.prop.body.translation();
      hk.point.set(pt.x, pt.y, pt.z);
    }
    const to = V(hk.point.x - t.x, hk.point.y - t.y, hk.point.z - t.z);
    const d = to.length();
    if (ctx.pressed2 || api.time > hk.until || d < 2.2) {
      hooks.delete(p);
      if (ctx.pressed2) api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'Câble lâché' });
      else if (d < 2.2) api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'Arrivé ! (en gardant l’élan)' });
      return;
    }
    to.divideScalar(d);
    const speed = 24;
    kbSet(p, to.x * speed, to.z * speed);
    const lv = p.body.linvel();
    p.body.setLinvel({ x: lv.x, y: lv.y + (to.y * speed - lv.y) * 0.35 + 0.4, z: lv.z }, true);
    if (everyMs(api, 33)) api.fx({ k: 'beam', p: [t.x, t.y + 0.6, t.z], t: [hk.point.x, hk.point.y, hk.point.z], a: 0.05, c: 0x2b2b2b });
  },
  holster(p) { hooks.delete(p); },
};

// ---------- Parachute ----------
const parachute: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    const open = p.scratch.chute === true;
    const t = p.body.translation();
    const lv = p.body.linvel();
    const wants = ctx.held2 && !p.vehicle && lv.y < -1 && !grounded(api, p);
    if (!wants) {
      if (open) {
        p.scratch.chute = false;
        api.fx({ k: 'text', p: [t.x, t.y + 2, t.z], s: ctx.held2 ? '...' : 'Parachute plié' });
      }
      return;
    }
    if (!open) {
      p.scratch.chute = true;
      api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
      api.fx({ k: 'text', p: [t.x, t.y + 2.5, t.z], s: '🪂 POUF ! Wiiiiii', c: 0xffffff });
    }
    // chute plafonnée à ~25 % d'une chute libre de 20 m/s
    if (lv.y < -5) p.body.setLinvel({ x: lv.x, y: lv.y + (-5 - lv.y) * 0.2, z: lv.z }, true);
    if (everyMs(api, 150)) {
      api.fx({ k: 'ring', p: [t.x, t.y + 2.6, t.z], a: 1.9, c: Math.floor(api.time / 150) % 2 ? 0xff3b3b : 0xffffff });
      api.fx({ k: 'beam', p: [t.x, t.y + 0.5, t.z], t: [t.x + 1.5, t.y + 2.6, t.z], a: 0.02, c: 0xffffff });
      api.fx({ k: 'beam', p: [t.x, t.y + 0.5, t.z], t: [t.x - 1.5, t.y + 2.6, t.z], a: 0.02, c: 0xffffff });
    }
  },
  holster(p) { p.scratch.chute = false; },
};

// ---------- Bottes de gravité ----------
const bottes_gravite: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    api.applyMod(p, { gravity: 0.4, jump: 1.6 }, 20);
    const t = p.body.translation();
    api.fx({ k: 'ring', p: [t.x, t.y - 0.8, t.z], a: 3, c: 0xb9a3ff });
    api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
    api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: '👢 Premier pas sur la Lune (20 s)', c: 0xcdb8ff });
  },
};

// ---------- Téléporteur ----------
interface Beacon { prop: SimProp; pos: THREE.Vector3; until: number }
const beacons = new WeakMap<SimPlayer, Beacon>();
const TP_COOLDOWN = 10000;
const OOPS = ['ZIP ! Presque...', 'Pile à côté !', 'Atterrissage « artistique »', 'Il manquait un mètre', 'Arrivé avant le copain !'];

const teleporteur: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const t = p.body.translation();
    if (ctx.pressed1) {
      const old = beacons.get(p);
      if (old && api.props.get(old.prop.id) === old.prop) api.removeProp(old.prop);
      const pos = V(t.x, t.y - 0.75, t.z);
      const prop = api.spawnProp('m_balise', pos.clone().add(V(0, 0.1, 0)), undefined, undefined, p);
      if (!prop) return;
      api.freezeProp(prop, true);
      beacons.set(p, { prop, pos, until: api.time + 60000 });
      api.fx({ k: 'ring', p: [pos.x, pos.y + 0.2, pos.z], a: 3, c: 0x66f0ff });
      api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' });
      api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: '📍 Balise posée (60 s)', c: 0x66f0ff });
      return;
    }
    // m2 : téléportation (recharge propre de 10 s, indépendante de la pose)
    const b = beacons.get(p);
    const now = api.time;
    if (now < ((p.scratch.tpReady as number) ?? 0)) {
      api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: `Recharge… ${Math.ceil((((p.scratch.tpReady as number) ?? 0) - now) / 1000)} s`, c: 0xffaa55 });
      return;
    }
    if (!b || api.props.get(b.prop.id) !== b.prop || !bodyOk(b.prop.body) || now > b.until) {
      beacons.delete(p);
      api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: 'Pas de balise ! (clic gauche pour en poser une)', c: 0xffaa55 });
      return;
    }
    const d = Math.hypot(b.pos.x - t.x, b.pos.y - t.y, b.pos.z - t.z);
    if (d > 30) {
      api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: `Balise trop loin (${Math.round(d)} m, max 30)`, c: 0xffaa55 });
      return;
    }
    // atterrissage approximatif : décalage aléatoire
    const a = rnd(0, Math.PI * 2);
    const r = rnd(0.8, 3.2);
    const to = V(b.pos.x + Math.cos(a) * r, b.pos.y + 1.6, b.pos.z + Math.sin(a) * r);
    api.fx({ k: 'ring', p: [t.x, t.y - 0.5, t.z], a: 3, c: 0x66f0ff });
    api.fx({ k: 'flash', p: [t.x, t.y, t.z], a: 2, c: 0xbff8ff });
    api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'zap' });
    p.body.setTranslation({ x: to.x, y: to.y, z: to.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.scratch.kb = undefined;
    api.fx({ k: 'ring', p: [to.x, to.y - 0.5, to.z], a: 3, c: 0x66f0ff });
    api.fx({ k: 'sound', p: [to.x, to.y, to.z], s: 'boing' });
    api.fx({ k: 'text', p: [to.x, to.y + 1.6, to.z], s: OOPS[Math.floor(Math.random() * OOPS.length)], c: 0xbff8ff });
    api.removeProp(b.prop);
    beacons.delete(p);
    p.scratch.tpReady = now + TP_COOLDOWN;
  },
  holster() { /* la balise reste en place 60 s */ },
};

const baliseTick: PropTick = (prop, api) => {
  const t = prop.body.translation();
  if (everyMs(api, 700)) {
    api.fx({ k: 'ring', p: [t.x, t.y + 0.1, t.z], a: 1.6, c: 0x66f0ff });
    api.fx({ k: 'beam', p: [t.x, t.y, t.z], t: [t.x, t.y + 7, t.z], a: 0.1, c: 0x66f0ff });
  }
};

export const pack: Pack = {
  items, props,
  handlers: { jetpack, grappin, parachute, bottes_gravite, teleporteur },
  propTicks: { m_balise: baliseTick },
};
