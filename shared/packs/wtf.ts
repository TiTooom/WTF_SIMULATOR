// Paquet « wtf » : 9 objets absurdes, faits pour le chaos et le rire. Jamais de dégâts mortels gratuits.
import * as THREE from 'three';
import type { ItemDef, ItemHandler, Pack, PropTick, SimApi, SimPlayer, SimProp, SimVehicle, UseCtx } from '../api';
import type { PropKind } from '../props';

const items: ItemDef[] = [
  { id: 'canon_confettis', name: 'Canon à confettis', emoji: '🎉', cat: 'wtf', cooldown: 3,
    desc: 'Clic gauche : un obus de 300 confettis qui secoue les caisses légères. Clic droit : éventail de mini-bombes festives.' },
  { id: 'bombe_poulets', name: 'Bombe à poulets', emoji: '🐔', cat: 'wtf', cooldown: 6,
    desc: 'Clic gauche : lance une bombe qui libère 12 poulets-cubes pendant 15 s. Ils ne font pas de dégâts, juste de la poussière de dignité.' },
  { id: 'canne_vaches', name: 'Canne à pêche à vaches', emoji: '🐄', cat: 'wtf', cooldown: 2, hold: true,
    desc: 'Clic gauche maintenu : accroche un objet, un véhicule vide ou un joueur (25 m) et le ramène à toi, vache au bout du fil. Relâche pour le laisser tomber.' },
  { id: 'chaussures_ressorts', name: 'Chaussures à ressorts', emoji: '👟', cat: 'wtf', cooldown: 40,
    desc: 'Clic gauche : 20 s de saut ×2, double saut en l’air, et onde de choc à l’atterrissage qui renverse les objets légers.' },
  { id: 'super_aimant', name: 'Super-aimant', emoji: '🧲', cat: 'wtf', cooldown: 10, hold: true,
    desc: 'Clic gauche maintenu : attire caisses et véhicules légers vers le point visé. Clic droit maintenu : les repousse. 6 s d’énergie, puis recharge.' },
  { id: 'trompette_tornade', name: 'Trompette-tornade', emoji: '🎺', cat: 'wtf', cooldown: 8, hold: true,
    desc: 'Clic gauche maintenu : souffle un cône de vent qui balaie objets et joueurs. 6 s de souffle, puis elle reprend sa respiration.' },
  { id: 'champignon_retrecisseur', name: 'Champignon rétrécisseur', emoji: '🍄', cat: 'wtf', cooldown: 12,
    desc: 'Clic gauche : lance le champignon. Dans 5 m autour, tout le monde (toi aussi) passe à 60 % de taille pendant 15 s.' },
  { id: 'pasteque_bombe', name: 'Pastèque-bombe', emoji: '🍉', cat: 'wtf', cooldown: 7,
    desc: 'Clic gauche : lance une pastèque lourde qui éclate en 6 tranches rebondissantes. Rien ne fait plus d’effet.' },
  { id: 'ventilateur_portatif', name: 'Ventilateur portatif', emoji: '🌀', cat: 'wtf', cooldown: 4, hold: true,
    desc: 'Clic gauche maintenu : flux ascendant qui soulève caisses et joueurs (batterie 10 s). Molette : incline le souffle vers l’avant.' },
];

// ---------- Props ----------
const props: PropKind[] = [
  { id: 'x_poulet', name: 'Poulet-cube', shape: 'box', size: [0.5, 0.5, 0.5], color: 0xffd60a, mass: 1.2, friction: 0.5, bounce: 0.2, life: 15, behavior: 'x_poulet' },
  { id: 'x_vache', name: 'Vache-cube', shape: 'box', size: [1.3, 0.9, 0.6], color: 0xf4f1ea, mass: 3, gravityScale: 0, life: 25, behavior: 'x_vache' },
  { id: 'x_ressort', name: 'Ressort', shape: 'cylinder', size: [0.6, 0.3], color: 0xff3d9a, mass: 0.1, gravityScale: 0, life: 21, behavior: 'x_ressort' },
  { id: 'x_champignon', name: 'Champignon', shape: 'sphere', size: [0.9], color: 0xe63946, mass: 2, friction: 0.9, life: 15, behavior: 'x_champignon' },
  { id: 'x_tranche', name: 'Tranche de pastèque', shape: 'sphere', size: [0.5], color: 0xe63946, mass: 0.8, friction: 0.4, bounce: 0.85, life: 5 },
];

// ---------- Utilitaires ----------
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const pos = (b: { translation(): { x: number; y: number; z: number } }) => { const t = b.translation(); return V(t.x, t.y, t.z); };
const arr = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
const sound = (api: SimApi, at: THREE.Vector3, s: string) => api.fx({ k: 'sound', p: arr(at), s });
const text = (api: SimApi, at: THREE.Vector3, s: string, c?: number) => api.fx({ k: 'text', p: arr(at), s, c });
const everyN = (api: SimApi, ms: number) => Math.floor(api.time / ms) !== Math.floor((api.time - 1000 / 60) / ms);
const ready = (p: SimPlayer, id: string, api: SimApi) => (p.cooldowns[id] ?? 0) <= api.time;
const head = (p: SimPlayer) => pos(p.body).add(V(0, 0.6 * p.mods.scale, 0));

const isMarker = (k: string) => k === 'x_ressort' || k === 'x_vache';
const lightProp = (p: SimProp, maxMass: number) => !p.frozen && !p.held && !isMarker(p.kind.id) && p.body.mass() <= maxMass;
const freeVehicle = (v: SimVehicle, maxMass: number) => !v.dead && !v.driver && !!v.behavior.body && v.behavior.body.mass() <= maxMass;

/** Pousse un joueur à pied (vitesse horizontale additionnelle qui s'amortit toute seule). */
function kick(p: SimPlayer, dx: number, dz: number, cap = 12) {
  const kb = (p.scratch.kb as [number, number] | undefined) ?? [0, 0];
  kb[0] += dx; kb[1] += dz;
  const l = Math.hypot(kb[0], kb[1]);
  if (l > cap) { kb[0] *= cap / l; kb[1] *= cap / l; }
  p.scratch.kb = kb;
}

/** Petite onde de choc sans dégâts : renverse les props légers, bouscule les joueurs. */
function shove(api: SimApi, at: THREE.Vector3, radius: number, power: number, except?: SimPlayer) {
  for (const h of api.nearby(at, radius)) {
    const f = 1 - h.dist / radius;
    if (h.prop && lightProp(h.prop, 12)) {
      const m = h.prop.body.mass();
      const d = h.normal.clone(); d.y = Math.max(d.y, 0.3); d.normalize();
      h.prop.body.applyImpulse({ x: d.x * m * power * f, y: d.y * m * power * f, z: d.z * m * power * f }, true);
    } else if (h.player && h.player !== except) kick(h.player, h.normal.x * power * f, h.normal.z * power * f, 10);
  }
}

function launch(ctx: UseCtx, kind: string, speed: number, gravity: number, onHit: (hit: import('../api').Hit | null, at: THREE.Vector3) => void, dir = ctx.dir, life = 6) {
  const { api, player: p } = ctx;
  api.spawnProjectile({ kind, pos: head(p).addScaledVector(dir, 1.1), vel: dir.clone().multiplyScalar(speed).add(V(0, 1.5, 0)),
    owner: p, gravity, life, onHit });
}

/** Énergie d'un objet maintenu : renvoie true tant qu'il reste du jus ; au bout de `max` s, déclenche la recharge `cd` s. */
interface Energy { used: number }
function drain(ctx: UseCtx, id: string, on: boolean, max: number, cd: number, label: string): boolean {
  const { api, player: p } = ctx;
  const st = ((p.scratch[id] as Energy) ??= { used: 0 });
  if (!ready(p, id, api)) return false;
  if (!on) { st.used = Math.max(0, st.used - ctx.dt * 0.5); return false; }
  st.used += ctx.dt;
  if (st.used >= max) {
    st.used = 0;
    p.cooldowns[id] = api.time + cd * 1000;
    text(api, head(p).add(V(0, 0.8, 0)), label, 0xff9966);
    return false;
  }
  return true;
}

// ---------- 1. Canon à confettis ----------
const PARTY = [0xff3355, 0xffd60a, 0x3ddc84, 0x3399ff, 0xc77dff, 0xff9f1c, 0xffffff];
function confettiBurst(api: SimApi, at: THREE.Vector3, salvos: number, perSalvo: number) {
  for (let i = 0; i < salvos; i++) {
    api.fx({ k: 'confetti', p: arr(at.clone().add(V(rnd(-0.6, 0.6), 0.3 + i * 0.5, rnd(-0.6, 0.6)))), b: perSalvo, a: 0.8 + i * 0.35,
      c: i % 2 ? PARTY[(Math.random() * PARTY.length) | 0] : 0 });
  }
  api.fx({ k: 'ring', p: arr(at), a: 4, c: PARTY[(Math.random() * PARTY.length) | 0] });
}

const canon_confettis: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    if (ctx.pressed2) {
      p.cooldowns.canon_confettis = api.time + 2500;
      for (let i = -3; i <= 3; i++) {
        const d = ctx.dir.clone().applyAxisAngle(V(0, 1, 0), i * 0.13).normalize();
        launch(ctx, 'confetti', 28, 7, (_h, at) => { confettiBurst(api, at, 1, 45); shove(api, at, 3, 3); }, d, 3);
      }
      sound(api, head(p), 'pop');
      text(api, head(p).add(V(0, 0.9, 0)), 'FÊTE !', 0xffd60a);
      return;
    }
    launch(ctx, 'confetti', 32, 6, (_h, at) => {
      confettiBurst(api, at, 3, 100);
      shove(api, at, 5, 6);
      sound(api, at, 'fanfare');
      text(api, at.clone().add(V(0, 1.5, 0)), 'SURPRISE !', 0xff5599);
    });
    sound(api, head(p), 'pop');
  },
};

// ---------- 2. Bombe à poulets ----------
const bombe_poulets: ItemHandler = {
  use(ctx) {
    const { api } = ctx;
    launch(ctx, 'chicken', 22, 13, (hit, at) => {
      const c = at.clone().add(hit ? hit.normal.clone().multiplyScalar(0.6) : V(0, 0.4, 0));
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, Math.PI * 2), s = rnd(2.5, 6.5);
        api.spawnProp('x_poulet', c.clone().add(V(rnd(-0.3, 0.3), rnd(0, 0.5), rnd(-0.3, 0.3))), undefined, V(Math.cos(a) * s, rnd(4, 8), Math.sin(a) * s), null);
      }
      api.fx({ k: 'smoke', p: arr(c), a: 1.5 });
      api.fx({ k: 'confetti', p: arr(c), b: 25, c: 0xffd60a });
      sound(api, c, 'chicken');
      text(api, c.clone().add(V(0, 1.6, 0)), 'COT COT CODEC !', 0xffd60a);
    }, ctx.dir, 5);
    sound(api, head(ctx.player), 'whoosh');
  },
};

const chickenState = new WeakMap<SimProp, { next: number; vx: number; vz: number; bump: number; h: number }>();
const x_poulet: PropTick = (prop, api) => {
  if (prop.frozen || prop.held) return;
  let st = chickenState.get(prop);
  if (!st) { st = { next: api.time + rnd(0, 500), vx: 0, vz: 0, bump: 0, h: rnd(0, 6.28) }; chickenState.set(prop, st); }
  const b = prop.body, v = b.linvel(), t = b.translation();
  if (api.time - prop.bornAt > 14600) { // pouf, le poulet s'évapore en plumes
    api.fx({ k: 'smoke', p: [t.x, t.y, t.z], a: 0.6 });
    api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
    api.removeProp(prop);
    return;
  }
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  b.setRotation({ x: 0, y: Math.sin(st.h / 2), z: 0, w: Math.cos(st.h / 2) }, true);
  if (api.time >= st.next) {
    st.next = api.time + rnd(400, 1300);
    const a = rnd(0, Math.PI * 2);
    st.vx = Math.cos(a) * 4; st.vz = Math.sin(a) * 4;
    st.h = Math.atan2(st.vx, st.vz);
    const grounded = Math.abs(v.y) < 0.8;
    b.setLinvel({ x: st.vx, y: grounded ? rnd(3.5, 6.5) : v.y, z: st.vz }, true);
    if (Math.random() < 0.1) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'chicken' });
    if (Math.random() < 0.04) api.fx({ k: 'text', p: [t.x, t.y + 0.7, t.z], s: 'cot !', c: 0xffd60a });
  }
  if (api.time >= st.bump) {
    for (const p of api.players.values()) {
      if (p.vehicle || p.hp <= 0) continue;
      const q = p.body.translation();
      const dx = q.x - t.x, dz = q.z - t.z, d = Math.hypot(dx, dz);
      if (d < 1 && Math.abs(q.y - t.y) < 1.4) {
        st.bump = api.time + 500;
        kick(p, (dx / (d || 1)) * 3.5, (dz / (d || 1)) * 3.5, 6);
        break;
      }
    }
  }
};

// ---------- 3. Canne à vaches ----------
interface Hook { kind: 'prop' | 'player' | 'vehicle'; prop?: SimProp; player?: SimPlayer; veh?: SimVehicle; cow: SimProp | null }
const hookOf = (p: SimPlayer) => p.scratch.cane as Hook | undefined;
const hookBody = (h: Hook) => (h.kind === 'prop' ? h.prop!.body : h.kind === 'player' ? h.player!.body : h.veh!.behavior.body);
function hookValid(h: Hook, api: SimApi): boolean {
  if (h.kind === 'prop') return api.props.get(h.prop!.id) === h.prop && !h.prop!.frozen;
  if (h.kind === 'player') return api.players.get(h.player!.id) === h.player && !h.player!.vehicle && h.player!.hp > 0;
  return !h.veh!.dead && !h.veh!.driver && !!h.veh!.behavior.body;
}
function dropHook(p: SimPlayer, api: SimApi, cooldown = true) {
  const h = hookOf(p);
  if (!h) return;
  p.scratch.cane = undefined;
  if (h.cow && api.props.has(h.cow.id)) {
    const t = pos(h.cow.body);
    api.fx({ k: 'smoke', p: arr(t), a: 0.8 });
    sound(api, t, 'pop');
    api.removeProp(h.cow);
  }
  if (cooldown) p.cooldowns.canne_vaches = api.time + 2000;
}
const cowTick: PropTick = () => { /* la vache est pilotée par la canne */ };

const canne_vaches: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    let h = hookOf(p);
    if (h && !ctx.held1) { dropHook(p, api); return; }
    if (!h) {
      if (!ctx.pressed1 || !ready(p, 'canne_vaches', api)) return;
      const hit = api.raycast(ctx.origin, ctx.dir, 25, p.body);
      const hand = head(p);
      if (hit?.prop && !hit.prop.frozen) h = { kind: 'prop', prop: hit.prop, cow: null };
      else if (hit?.player && hit.player !== p && !hit.player.vehicle) h = { kind: 'player', player: hit.player, cow: null };
      else if (hit?.vehicle && freeVehicle(hit.vehicle, 4000)) h = { kind: 'vehicle', veh: hit.vehicle, cow: null };
      if (!h) {
        const end = hit ? hit.point : ctx.origin.clone().addScaledVector(ctx.dir, 25);
        api.fx({ k: 'beam', p: arr(hand), t: arr(end), a: 0.04, c: 0xffffff });
        text(api, end.clone().add(V(0, 0.8, 0)), 'Rien ne mord…', 0xcccccc);
        p.cooldowns.canne_vaches = api.time + 600;
        return;
      }
      h.cow = api.spawnProp('x_vache', pos(hookBody(h)!).add(V(0, 2, 0)), undefined, undefined, null);
      if (h.cow) h.cow.body.collider(0).setSensor(true);
      p.scratch.cane = h;
      sound(api, hand, 'meow');
      text(api, pos(hookBody(h)!).add(V(0, 2.8, 0)), 'MEUH ?!', 0xffffff);
    }
    if (!hookValid(h, api)) { dropHook(p, api); return; }
    const body = hookBody(h)!;
    const t = pos(body), me = head(p);
    const to = me.clone().sub(t);
    const d = to.length();
    if (d > 28) { text(api, t, 'Le fil a cassé !', 0xff9966); dropHook(p, api); return; }
    if (d > 2.8) {
      to.normalize();
      const v = body.linvel();
      const want = V(to.x * 14, to.y * 14 + 3, to.z * 14);
      body.setLinvel({ x: v.x + (want.x - v.x) * 0.3, y: v.y + (want.y - v.y) * 0.3, z: v.z + (want.z - v.z) * 0.3 }, true);
      body.wakeUp();
    } else {
      const v = body.linvel();
      body.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
    }
    if (h.kind === 'player') h.player!.scratch.heldUntil = api.time + 150;
    if (h.kind === 'vehicle') h.veh!.noImpactUntil = api.time + 150;
    if (h.cow && api.props.has(h.cow.id)) {
      const lift = h.kind === 'player' ? 2.3 : h.kind === 'vehicle' ? 2.6 : 1.4;
      h.cow.body.setTranslation({ x: t.x, y: t.y + lift + Math.sin(api.time / 150) * 0.15, z: t.z }, true);
      h.cow.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      h.cow.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const yaw = Math.atan2(-to.x, -to.z);
      h.cow.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    }
    if (everyN(api, 33)) api.fx({ k: 'beam', p: arr(me), t: arr(t.clone().add(V(0, 0.4, 0))), a: 0.04, c: 0xffffff });
    if (everyN(api, 1500)) sound(api, t, 'meow');
  },
  holster(p, api) { dropHook(p, api); },
};

// ---------- 4. Chaussures à ressorts ----------
const markerOwner = new WeakMap<SimProp, { id: string; until: number }>();
const springState = new WeakMap<SimProp, { air: boolean; fall: number; jprev: number; jumps: number; lastGround: number }>();

const chaussures_ressorts: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const old = p.scratch.shoes as SimProp | undefined;
    if (old && api.props.has(old.id)) api.removeProp(old);
    p.cooldowns.chaussures_ressorts = api.time + 40000;
    api.applyMod(p, { jump: 2 }, 20);
    const m = api.spawnProp('x_ressort', pos(p.body), undefined, undefined, null);
    if (m) {
      m.body.collider(0).setSensor(true);
      markerOwner.set(m, { id: p.id, until: api.time + 20000 });
      p.scratch.shoes = m;
    }
    const at = head(p);
    sound(api, at, 'boing');
    text(api, at.add(V(0, 1, 0)), 'BOING ! 👟', 0xff3d9a);
  },
};

const x_ressort: PropTick = (prop, api) => {
  const own = markerOwner.get(prop);
  const pl = own && api.players.get(own.id);
  if (!own || !pl || pl.hp <= 0 || pl.vehicle || api.time > own.until) {
    if (pl && own && api.time > own.until) text(api, head(pl).add(V(0, 0.8, 0)), 'Les ressorts rendent l’âme', 0xff9fcb);
    api.removeProp(prop);
    return;
  }
  const sc = pl.mods.scale;
  const t = pl.body.translation();
  const b = prop.body;
  b.setTranslation({ x: t.x, y: t.y - 0.72 * sc, z: t.z }, true);
  b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  let st = springState.get(prop);
  if (!st) { st = { air: false, fall: 0, jprev: 1, jumps: 0, lastGround: api.time }; springState.set(prop, st); }
  const vy = pl.body.linvel().y;
  const grounded = !!api.raycast(V(t.x, t.y, t.z), V(0, -1, 0), 0.85 * sc + 0.3, pl.body);
  if (grounded) {
    if (st.air && st.fall > 6) {
      const f = Math.min(1.5, st.fall / 12);
      const at = V(t.x, t.y - 0.7 * sc, t.z);
      for (const h of api.nearby(at, 7)) {
        const k = 1 - h.dist / 7;
        if (h.prop && lightProp(h.prop, 15)) {
          const m = h.prop.body.mass();
          const o = h.normal.clone(); o.y = 0; if (o.lengthSq() > 1e-6) o.normalize();
          h.prop.body.applyImpulse({ x: o.x * m * 4 * k * f, y: m * (5 + rnd(0, 3)) * k * f, z: o.z * m * 4 * k * f }, true);
          h.prop.body.applyTorqueImpulse({ x: rnd(-1, 1) * m * k, y: 0, z: rnd(-1, 1) * m * k }, true);
        } else if (h.player && h.player !== pl) {
          kick(h.player, h.normal.x * 5 * k * f, h.normal.z * 5 * k * f, 8);
          const lv = h.player.body.linvel();
          h.player.body.setLinvel({ x: lv.x, y: Math.max(lv.y, 4 * k * f), z: lv.z }, true);
        }
      }
      api.fx({ k: 'ring', p: arr(at), a: 7, c: 0xff3d9a });
      api.fx({ k: 'shake', p: arr(at), a: 0.35 });
      sound(api, at, 'boing');
      text(api, at.clone().add(V(0, 1.6, 0)), 'BADABOING !', 0xff3d9a);
    }
    st.air = false; st.fall = 0; st.jumps = 0; st.lastGround = api.time;
  } else {
    st.air = true;
    st.fall = Math.max(st.fall, -vy);
    if (pl.input.jump && !st.jprev && st.jumps < 1 && api.time - st.lastGround > 150) {
      st.jumps++;
      const lv = pl.body.linvel();
      pl.body.setLinvel({ x: lv.x, y: 9, z: lv.z }, true);
      st.fall = 0;
      const at = V(t.x, t.y - 0.7 * sc, t.z);
      api.fx({ k: 'ring', p: arr(at), a: 2, c: 0xffffff });
      sound(api, at, 'boing');
      text(api, at.clone().add(V(0, 1.4, 0)), 'DOUBLE BOING', 0xff9fcb);
    }
  }
  st.jprev = pl.input.jump;
};

// ---------- 5. Super-aimant ----------
const super_aimant: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    const on = ctx.held1 || ctx.held2;
    if (!drain(ctx, 'super_aimant', on, 6, 10, 'Aimant en surchauffe !')) return;
    const push = !ctx.held1 && ctx.held2;
    const hit = api.raycast(ctx.origin, ctx.dir, 40, p.body);
    const target = hit ? hit.point.clone() : ctx.origin.clone().addScaledVector(ctx.dir, 18);
    const R = 13;
    for (const h of api.nearby(target, R)) {
      let b = null;
      if (h.prop && lightProp(h.prop, 40)) b = h.prop.body;
      else if (h.vehicle && freeVehicle(h.vehicle, 1500)) { b = h.vehicle.behavior.body; h.vehicle.noImpactUntil = api.time + 150; }
      if (!b) continue;
      const t = pos(b), v = b.linvel();
      const to = target.clone().sub(t);
      const d = to.length();
      let w: THREE.Vector3;
      if (push) w = V(-to.x, -to.y + 4, -to.z).normalize().multiplyScalar(16);
      else if (d < 1.2) w = V(0, 0, 0);
      else w = to.normalize().multiplyScalar(Math.min(16, 4 + d * 1.5));
      const k = 0.18;
      b.setLinvel({ x: v.x + (w.x - v.x) * k, y: v.y + (w.y - v.y) * k + 9.81 / 60 * 0.9, z: v.z + (w.z - v.z) * k }, true);
      b.wakeUp();
    }
    if (everyN(api, 100)) {
      api.fx({ k: 'beam', p: arr(head(p)), t: arr(target), a: 0.07, c: push ? 0x3399ff : 0xff3355 });
      api.fx({ k: 'ring', p: arr(target), a: push ? 4 : 2, c: push ? 0x3399ff : 0xff3355 });
    }
    if (everyN(api, 700)) sound(api, target, push ? 'whoosh' : 'zap');
  },
};

// ---------- 6. Trompette-tornade ----------
const trompette_tornade: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    if (!drain(ctx, 'trompette_tornade', ctx.held1, 6, 8, 'Plus de souffle !')) return;
    const o = head(p).addScaledVector(ctx.dir, 0.8);
    const L = 14, cosHalf = Math.cos(0.55);
    for (const h of api.nearby(o, L)) {
      const to = h.point.clone().sub(o);
      const along = to.dot(ctx.dir);
      if (along < 0.5 || to.length() === 0 || along / to.length() < cosHalf) continue;
      const f = 1 - along / L;
      if (h.prop && lightProp(h.prop, 60)) {
        const m = h.prop.body.mass();
        const a = (14 + 40 * f) / 60;
        h.prop.body.applyImpulse({ x: ctx.dir.x * m * a, y: ctx.dir.y * m * a * 0.5 + m * 0.18, z: ctx.dir.z * m * a }, true);
        h.prop.body.wakeUp();
      } else if (h.vehicle && freeVehicle(h.vehicle, 1500)) {
        const b = h.vehicle.behavior.body, m = b.mass(), a = (4 + 10 * f) / 60;
        h.vehicle.noImpactUntil = api.time + 150;
        b.applyImpulse({ x: ctx.dir.x * m * a, y: 0, z: ctx.dir.z * m * a }, true);
      } else if (h.player && h.player !== p) {
        const hd = V(ctx.dir.x, 0, ctx.dir.z);
        if (hd.lengthSq() > 1e-6) hd.normalize();
        kick(h.player, hd.x * (0.5 + 1.1 * f), hd.z * (0.5 + 1.1 * f), 12);
        const lv = h.player.body.linvel();
        if (f > 0.4 && lv.y < 2) h.player.body.setLinvel({ x: lv.x, y: lv.y + 0.4, z: lv.z }, true);
      }
    }
    if (everyN(api, 100)) {
      const at = o.clone().addScaledVector(ctx.dir, rnd(2, 11));
      api.fx({ k: 'ring', p: arr(at), a: 1.8, c: 0xcfe9ff });
      api.fx({ k: 'smoke', p: arr(at), a: 0.6 });
    }
    if (everyN(api, 650)) { sound(api, o, 'horn_2'); text(api, o.clone().add(V(0, 0.9, 0)), 'POUET', 0xffe066); }
  },
};

// ---------- 7. Champignon rétrécisseur ----------
function shrinkAround(api: SimApi, at: THREE.Vector3) {
  let n = 0;
  for (const p of api.players.values()) {
    if (p.vehicle || p.hp <= 0 || p.mods.scale < 0.95) continue;
    if (pos(p.body).distanceTo(at) > 5) continue;
    api.applyMod(p, { scale: 0.6 }, 15);
    api.fx({ k: 'text', p: [p.body.translation().x, p.body.translation().y + 1.4, p.body.translation().z], s: 'RIKIKI !', c: 0xff6b6b });
    n++;
  }
  if (n) { sound(api, at, 'bloop'); api.fx({ k: 'ring', p: arr(at), a: 5, c: 0xe63946 }); }
}

const champignon_retrecisseur: ItemHandler = {
  use(ctx) {
    const { api } = ctx;
    launch(ctx, 'tomato', 20, 13, (hit, at) => {
      const c = at.clone().add(hit ? hit.normal.clone().multiplyScalar(0.5) : V(0, 0.4, 0));
      api.spawnProp('x_champignon', c, undefined, undefined, null);
      api.fx({ k: 'smoke', p: arr(c), a: 1.2 });
      api.fx({ k: 'confetti', p: arr(c), b: 20, c: 0xe63946 });
      text(api, c.clone().add(V(0, 1.4, 0)), 'Plop ! 🍄', 0xff6b6b);
      shrinkAround(api, c);
    }, ctx.dir, 5);
    sound(api, head(ctx.player), 'whoosh');
  },
};

const x_champignon: PropTick = (prop, api) => {
  if (!everyN(api, 250)) return;
  const t = pos(prop.body);
  shrinkAround(api, t);
  if (everyN(api, 750)) api.fx({ k: 'smoke', p: arr(t.add(V(0, 0.5, 0))), a: 0.4 });
};

// ---------- 8. Pastèque-bombe ----------
const pasteque_bombe: ItemHandler = {
  use(ctx) {
    const { api } = ctx;
    launch(ctx, 'watermelon', 24, 14, (hit, at) => {
      const c = at.clone().add(hit ? hit.normal.clone().multiplyScalar(0.5) : V(0, 0.4, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rnd(-0.3, 0.3), s = rnd(3, 6);
        api.spawnProp('x_tranche', c.clone().add(V(Math.cos(a) * 0.4, rnd(0, 0.3), Math.sin(a) * 0.4)), undefined, V(Math.cos(a) * s, rnd(4, 8), Math.sin(a) * s), null);
      }
      api.fx({ k: 'smoke', p: arr(c), a: 1.2 });
      api.fx({ k: 'confetti', p: arr(c), b: 40, c: 0xe63946 });
      api.fx({ k: 'confetti', p: arr(c), b: 25, c: 0x2a9d3f });
      api.fx({ k: 'shake', p: arr(c), a: 0.4 });
      sound(api, c, 'splat');
      text(api, c.clone().add(V(0, 1.5, 0)), 'SPLASH !', 0xff4d6d);
      shove(api, c, 4, 7);
    }, ctx.dir, 6);
    sound(api, head(ctx.player), 'whoosh');
  },
};

// ---------- 9. Ventilateur portatif ----------
interface Fan { bat: number; tilt: number }
const ventilateur_portatif: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    const st = ((p.scratch.fan as Fan) ??= { bat: 10, tilt: 0 });
    if (ctx.wheel) {
      st.tilt = Math.max(0, Math.min(1, st.tilt - ctx.wheel * 0.1));
      text(api, head(p).add(V(0, 0.9, 0)), `Souffle ${Math.round(st.tilt * 100)} % avant`, 0xcfe9ff);
    }
    if (!ready(p, 'ventilateur_portatif', api)) return;
    if (!ctx.held1) { st.bat = Math.min(10, st.bat + ctx.dt * 2.5); return; }
    st.bat -= ctx.dt;
    if (st.bat <= 0) {
      st.bat = 10;
      p.cooldowns.ventilateur_portatif = api.time + 4000;
      text(api, head(p).add(V(0, 0.9, 0)), 'Batterie à plat !', 0xff9966);
      return;
    }
    const flow = V(0, 1 - st.tilt, 0).addScaledVector(ctx.dir, st.tilt).normalize();
    const hit = api.raycast(ctx.origin, ctx.dir, 12, p.body);
    const c = hit ? hit.point.clone() : ctx.origin.clone().addScaledVector(ctx.dir, 5);
    c.y += 2;
    api.applyMod(p, { jump: 1.5 }, 0.5);
    for (const h of api.nearby(c, 6)) {
      const d2 = Math.hypot(h.point.x - c.x, h.point.z - c.z);
      if (d2 > 3.5) continue;
      if (h.prop && lightProp(h.prop, 25)) {
        const b = h.prop.body, v = b.linvel();
        b.setLinvel({ x: v.x + flow.x * 22 / 60, y: Math.min(7, v.y + (flow.y * 30 + 9.81) / 60), z: v.z + flow.z * 22 / 60 }, true);
        b.applyTorqueImpulse({ x: rnd(-1, 1) * 0.02, y: rnd(-1, 1) * 0.02, z: rnd(-1, 1) * 0.02 }, true);
        b.wakeUp();
      } else if (h.player) {
        const b = h.player.body, v = b.linvel();
        b.setLinvel({ x: v.x, y: Math.min(6.5, v.y + (flow.y * 34 + 9.81) / 60), z: v.z }, true);
        if (flow.x || flow.z) kick(h.player, flow.x * 0.25, flow.z * 0.25, 6);
      }
    }
    if (everyN(api, 120)) {
      api.fx({ k: 'ring', p: arr(c.clone().add(V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)))), a: 1.5, c: 0xcfe9ff });
      api.fx({ k: 'smoke', p: arr(c), a: 0.5 });
    }
    if (everyN(api, 450)) sound(api, head(p), 'whoosh');
  },
};

export const pack: Pack = {
  items,
  props,
  handlers: { canon_confettis, bombe_poulets, canne_vaches, chaussures_ressorts, super_aimant, trompette_tornade, champignon_retrecisseur, pasteque_bombe, ventilateur_portatif },
  propTicks: { x_poulet, x_vache: cowTick, x_ressort, x_champignon },
};
