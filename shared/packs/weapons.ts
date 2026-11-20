// Paquet « weapons » : lance-roquettes, grenade, mitraillette, mine collante, fusil à ventouses, lance-tomates.
import * as THREE from 'three';
import type { Hit, ItemDef, ItemHandler, Pack, PropTick, SimApi, SimPlayer, SimProp, SimVehicle, UseCtx } from '../api';
import type { PropKind } from '../props';

const items: ItemDef[] = [
  { id: 'lance_roquettes', name: 'Lance-roquettes', emoji: '🎯', cat: 'weapon', cooldown: 3,
    desc: 'Clic gauche : tire une roquette qui explose sur 6 m. Le recul est offert. Le mode d’emploi tient en un mot : BOUM.' },
  { id: 'grenade', name: 'Grenade à fragments', emoji: '💣', cat: 'weapon', cooldown: 2,
    desc: 'Clic gauche : lance une grenade qui rebondit. Clic droit : la lance en cloche. Elle explose 3 s plus tard.' },
  { id: 'mitraillette', name: 'Mitraillette', emoji: '🔫', cat: 'weapon', cooldown: 0, hold: true,
    desc: 'Clic gauche maintenu : rafale (chargeur de 30, rechargement 2 s). Clic droit : tir unique précis.' },
  { id: 'mine_collante', name: 'Mine collante', emoji: '🪤', cat: 'weapon', cooldown: 5,
    desc: 'Clic gauche : pose une mine au sol. Elle explose au contact et colle la cible 2 s. Évite de marcher dessus.' },
  { id: 'fusil_ventouses', name: 'Fusil à ventouses', emoji: '🪝', cat: 'weapon', cooldown: 4,
    desc: 'Clic gauche : tire une ventouse qui se colle à la cible et la tire vers toi. Clic droit : relâche le câble.' },
  { id: 'lance_tomates', name: 'Lance-tomates', emoji: '🍅', cat: 'weapon', cooldown: 1,
    desc: 'Clic gauche : lance une tomate. Pas de dégâts, mais la cible ralentit de 20 % pendant 3 s. Et c’est très rouge.' },
];

const props: PropKind[] = [
  { id: 'w_mine', name: 'Mine collante', shape: 'sphere', size: [0.6], color: 0xd62839, mass: 2, hp: 15, life: 120, behavior: 'w_mine',
    explosive: { radius: 3, power: 9, damage: 20 } },
  { id: 'w_glue', name: 'Flaque de colle', shape: 'cylinder', size: [5, 0.05], color: 0x7bd62f, mass: 5, life: 2, gravityScale: 0, behavior: 'w_glue' },
];

// ---------- utilitaires ----------
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (v: THREE.Vector3, dy = 0): [number, number, number] => [v.x, v.y + dy, v.z];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Le tir part de la tête du joueur mais converge vers le point visé par la caméra. */
function aim(ctx: UseCtx, spread = 0, range = 150): { muzzle: THREE.Vector3; dir: THREE.Vector3 } {
  const t = ctx.player.body.translation();
  const head = V(t.x, t.y + 0.6, t.z);
  const muzzle = head.clone().addScaledVector(ctx.dir, 1.2);
  const h = ctx.api.raycast(ctx.origin, ctx.dir, range, ctx.player.body);
  const target = h && h.dist > 1.5 ? h.point : ctx.origin.clone().addScaledVector(ctx.dir, range);
  const dir = target.sub(muzzle);
  if (dir.lengthSq() < 1e-4 || dir.dot(ctx.dir) < 0.5) dir.copy(ctx.dir);
  dir.normalize();
  if (spread > 0) {
    dir.x += rnd(-spread, spread);
    dir.y += rnd(-spread, spread);
    dir.z += rnd(-spread, spread);
    dir.normalize();
  }
  return { muzzle, dir };
}

/** Pousse le joueur (tir, recul) : impulsion horizontale via `kb` + vitesse verticale. */
function kick(p: SimPlayer, vx: number, vy: number, vz: number) {
  const kb = (p.scratch.kb as [number, number] | undefined) ?? [0, 0];
  kb[0] += vx;
  kb[1] += vz;
  p.scratch.kb = kb;
  const lv = p.body.linvel();
  p.body.setLinvel({ x: lv.x, y: lv.y + vy, z: lv.z }, true);
}

/** `use` est déclenché par m1 ou m2 et consomme la recharge ; pour un clic non voulu on la rend. */
function rememberCooldown(ctx: UseCtx, id: string) {
  ctx.player.scratch['cd_' + id] = ctx.player.cooldowns[id] ?? 0;
}
function refundCooldown(ctx: UseCtx, id: string) {
  const prev = ctx.player.scratch['cd_' + id];
  ctx.player.cooldowns[id] = typeof prev === 'number' ? prev : 0;
}

// ---------- Lance-roquettes ----------
const lance_roquettes: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    if (!ctx.pressed1) return;
    const { muzzle, dir } = aim(ctx);
    api.spawnProjectile({
      kind: 'rocket', pos: muzzle, vel: dir.clone().multiplyScalar(55), owner: p, life: 5, trail: true,
      radius: 6, power: 22, damage: 70,
    });
    api.fx({ k: 'flash', p: at(muzzle), a: 1.4, c: 0xffd27a });
    api.fx({ k: 'smoke', p: at(muzzle), a: 1.2, b: 5 });
    api.fx({ k: 'sound', p: at(muzzle), s: 'rocket' });
    api.fx({ k: 'text', p: at(muzzle, 1), s: 'FWOOSH !' });
    kick(p, -dir.x * 5, 1, -dir.z * 5); // recul
  },
};

// ---------- Grenade ----------
const grenade: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const lob = !ctx.pressed1 && ctx.pressed2;
    const t = p.body.translation();
    const start = V(t.x, t.y + 0.7, t.z).addScaledVector(ctx.dir, 0.9);
    const vel = ctx.dir.clone();
    if (lob) vel.y += 0.7; else vel.y += 0.15;
    vel.normalize().multiplyScalar(lob ? 17 : 21);
    api.spawnProjectile({
      kind: 'grenade', pos: start, vel, owner: p, gravity: 14, life: 3, fuse: true, bounce: true,
      radius: 5, power: 12, damage: 45,
    });
    api.fx({ k: 'sound', p: at(start), s: 'whoosh' });
    api.fx({ k: 'text', p: at(start, 0.8), s: lob ? 'Attends... 3, 2, 1' : 'Tiens !' });
  },
};

// ---------- Mitraillette ----------
interface Gun { ammo: number; next: number; reloadUntil: number; shots: number }
const MAG = 30;
const gun = (p: SimPlayer): Gun => ((p.scratch.gun as Gun) ??= { ammo: MAG, next: 0, reloadUntil: 0, shots: 0 });

function shootBullet(ctx: UseCtx, g: Gun, spread: number, damage: number) {
  const { api, player: p } = ctx;
  const { muzzle, dir } = aim(ctx, spread, 120);
  api.spawnProjectile({ kind: 'bullet', pos: muzzle, vel: dir.clone().multiplyScalar(140), owner: p, life: 1.2, damage });
  g.ammo--;
  g.shots++;
  if (g.shots % 2 === 0) api.fx({ k: 'beam', p: at(muzzle), t: at(muzzle.clone().addScaledVector(dir, 9)), a: 0.04, c: 0xffe27a });
  if (g.shots % 3 === 0) {
    api.fx({ k: 'spark', p: at(muzzle), a: 0.3, b: 3 });
    api.fx({ k: 'sound', p: at(muzzle), s: 'pop', a: 0.5 });
  }
  if (g.shots % 15 === 1) api.fx({ k: 'text', p: at(muzzle, 1), s: 'tatatatata' });
  if (g.ammo <= 0) {
    g.reloadUntil = api.time + 2000;
    api.fx({ k: 'text', p: at(muzzle, 1.2), s: '🔄 Rechargement…', c: 0xff9955 });
    api.fx({ k: 'sound', p: at(muzzle), s: 'zap', a: 0.5 });
  }
}

const mitraillette: ItemHandler = {
  tick(ctx) {
    const { api, player: p } = ctx;
    const g = gun(p);
    if (g.reloadUntil) {
      if (api.time < g.reloadUntil) return;
      g.reloadUntil = 0;
      g.ammo = MAG;
      const t = p.body.translation();
      api.fx({ k: 'text', p: [t.x, t.y + 1.8, t.z], s: '✔ Chargeur plein (30)', c: 0x88ff88 });
      api.fx({ k: 'sound', p: [t.x, t.y + 1, t.z], s: 'bloop' });
    }
    if (api.time < g.next) return;
    if (ctx.pressed2) {
      g.next = api.time + 150;
      shootBullet(ctx, g, 0, 14);
    } else if (ctx.held1) {
      g.next = api.time + 66; // ~15 tirs/s
      shootBullet(ctx, g, 0.035, 6);
    }
  },
  holster(p) {
    const g = gun(p);
    if (g.reloadUntil) { g.reloadUntil = 0; g.ammo = MAG; }
  },
};

// ---------- Mine collante ----------
const mine_collante: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const t = p.body.translation();
    const start = V(t.x, t.y + 0.5, t.z).addScaledVector(V(ctx.dir.x, 0, ctx.dir.z).normalize(), 1.8);
    const h = api.raycast(start, V(0, -1, 0), 6, p.body);
    const pos = h ? h.point.clone().add(V(0, 0.3, 0)) : start.clone();
    const m = api.spawnProp('w_mine', pos, undefined, undefined, p);
    if (!m) return;
    api.freezeProp(m, true);
    api.fx({ k: 'sound', p: at(pos), s: 'pop' });
    api.fx({ k: 'text', p: at(pos, 0.8), s: 'Mine posée (ne pas marcher dessus)' });
  },
};

/** Distance 3D entre un corps et un point. */
const dist = (b: { translation(): { x: number; y: number; z: number } }, v: THREE.Vector3) => {
  const t = b.translation();
  return Math.hypot(t.x - v.x, t.y - v.y, t.z - v.z);
};

const mineTick: PropTick = (prop, api) => {
  if (api.time - prop.bornAt < 1200) return; // armement
  const t = prop.body.translation();
  const pos = V(t.x, t.y, t.z);
  let hit = false;
  for (const p of api.players.values()) {
    if (p.vehicle || p.hp <= 0) continue;
    if (dist(p.body, pos) < 1.6) { hit = true; break; }
  }
  if (!hit) for (const v of api.vehicles) {
    if (v.dead || !v.behavior.body) continue;
    if (dist(v.behavior.body, pos) < 2.6) { hit = true; break; }
  }
  if (!hit) return;
  api.removeProp(prop);
  api.explode(pos, 3, 9, 20, null);
  const glue = api.spawnProp('w_glue', pos.clone().add(V(0, 0.05, 0)));
  if (glue) api.freezeProp(glue, true);
  api.fx({ k: 'text', p: at(pos, 1.5), s: 'SCHLOUUUP ! Collé !', c: 0x9be83a });
  api.fx({ k: 'sound', p: at(pos), s: 'splat' });
  for (const p of api.players.values()) {
    if (p.vehicle || p.hp <= 0 || dist(p.body, pos) > 3) continue;
    api.applyMod(p, { speed: 0.12, jump: 0.2 }, 2);
  }
};

const glueTick: PropTick = (prop, api) => {
  const t = prop.body.translation();
  const pos = V(t.x, t.y, t.z);
  for (const v of api.vehicles) {
    if (v.dead || !v.behavior.body || dist(v.behavior.body, pos) > 3) continue;
    const b = v.behavior.body;
    const lv = b.linvel();
    b.setLinvel({ x: lv.x * 0.9, y: lv.y, z: lv.z * 0.9 }, true);
    const av = b.angvel();
    b.setAngvel({ x: av.x * 0.9, y: av.y * 0.9, z: av.z * 0.9 }, true);
    v.noImpactUntil = api.time + 200; // un freinage collant n'est pas un choc
  }
  for (const p of api.players.values()) {
    if (p.vehicle || p.hp <= 0 || dist(p.body, pos) > 3) continue;
    if (p.mods.speed > 0.2) api.applyMod(p, { speed: 0.12, jump: 0.2 }, 0.5);
    const kb = p.scratch.kb as [number, number] | undefined;
    if (kb) { kb[0] *= 0.8; kb[1] *= 0.8; }
  }
  if (Math.floor(api.time / 300) !== Math.floor((api.time - 17) / 300)) api.fx({ k: 'spark', p: at(pos, 0.3), a: 0.3, b: 4, c: 0x9be83a });
};

// ---------- Fusil à ventouses ----------
interface Pull { player?: SimPlayer; prop?: SimProp; veh?: SimVehicle; until: number }
const pulls = new WeakMap<SimPlayer, Pull>();

function pullPos(api: SimApi, pl: Pull): THREE.Vector3 | null {
  if (pl.prop) { if (api.props.get(pl.prop.id) !== pl.prop) return null; const t = pl.prop.body.translation(); return V(t.x, t.y, t.z); }
  if (pl.veh) { if (pl.veh.dead || !pl.veh.behavior.body) return null; const t = pl.veh.behavior.body.translation(); return V(t.x, t.y, t.z); }
  if (pl.player) { if (pl.player.hp <= 0 || api.players.get(pl.player.id) !== pl.player) return null; const t = pl.player.body.translation(); return V(t.x, t.y, t.z); }
  return null;
}

const fusil_ventouses: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    if (!ctx.pressed1) { refundCooldown(ctx, 'fusil_ventouses'); return; }
    const { muzzle, dir } = aim(ctx, 0, 60);
    pulls.delete(p);
    api.spawnProjectile({
      kind: 'sucker', pos: muzzle, vel: dir.clone().multiplyScalar(60), owner: p, gravity: 4, life: 1.5,
      onHit: (hit: Hit | null, pt: THREE.Vector3) => {
        api.fx({ k: 'sound', p: at(pt), s: 'pop' });
        if (!hit) return;
        if (hit.vehicle) pulls.set(p, { veh: hit.vehicle, until: api.time + 6000 });
        else if (hit.player && hit.player !== p) pulls.set(p, { player: hit.player, until: api.time + 6000 });
        else if (hit.prop) {
          if (hit.prop.frozen) api.freezeProp(hit.prop, false);
          pulls.set(p, { prop: hit.prop, until: api.time + 6000 });
        } else { api.fx({ k: 'text', p: at(pt, 0.6), s: 'Ploc. Collée au mur.' }); return; }
        api.fx({ k: 'text', p: at(pt, 1), s: 'SHLOP ! 🪝' });
      },
    });
    api.fx({ k: 'sound', p: at(muzzle), s: 'whoosh' });
    rememberCooldown(ctx, 'fusil_ventouses');
  },
  tick(ctx) {
    const { api, player: p } = ctx;
    rememberCooldown(ctx, 'fusil_ventouses');
    const pl = pulls.get(p);
    if (!pl) return;
    if (ctx.pressed2 || api.time > pl.until) {
      pulls.delete(p);
      const t0 = p.body.translation();
      api.fx({ k: 'text', p: [t0.x, t0.y + 1.5, t0.z], s: 'Plop !' });
      return;
    }
    const tp = pullPos(api, pl);
    if (!tp) { pulls.delete(p); return; }
    const me = p.body.translation();
    const to = V(me.x - tp.x, me.y + 0.5 - tp.y, me.z - tp.z);
    const d = to.length();
    if (d < 3) { pulls.delete(p); return; }
    to.divideScalar(d);
    const speed = 16;
    if (pl.prop || pl.veh) {
      const b = pl.prop ? pl.prop.body : pl.veh!.behavior.body;
      const lv = b.linvel();
      b.setLinvel({ x: lv.x + (to.x * speed - lv.x) * 0.12, y: lv.y + (to.y * speed * 0.6 - lv.y) * 0.12, z: lv.z + (to.z * speed - lv.z) * 0.12 }, true);
      if (pl.veh) pl.veh.noImpactUntil = api.time + 200;
    } else if (pl.player) {
      pl.player.scratch.kb = [to.x * 9, to.z * 9];
      const lv = pl.player.body.linvel();
      pl.player.body.setLinvel({ x: lv.x, y: Math.max(lv.y, 1.5), z: lv.z }, true);
    }
    if (Math.floor(api.time / 50) !== Math.floor((api.time - 17) / 50)) {
      api.fx({ k: 'beam', p: [me.x, me.y + 0.6, me.z], t: [tp.x, tp.y, tp.z], a: 0.07, c: 0xff9933 });
    }
  },
  holster(p) { pulls.delete(p); },
};

// ---------- Lance-tomates ----------
const splat = (api: SimApi, pt: THREE.Vector3, victim: SimPlayer | null, veh: SimVehicle | null) => {
  api.fx({ k: 'flash', p: at(pt), a: 2.4, c: 0xdd1111 });
  api.fx({ k: 'confetti', p: at(pt), a: 0.5, b: 20, c: 0xe01b1b });
  api.fx({ k: 'sound', p: at(pt), s: 'splat' });
  api.fx({ k: 'text', p: at(pt, 1.3), s: 'SPLAT !', c: 0xff4444 });
  for (const p of api.players.values()) {
    if (p.hp <= 0) continue;
    const near = p === victim || (!p.vehicle && dist(p.body, pt) < 2.2) || (p.vehicle === veh && veh !== null);
    if (near) {
      api.applyMod(p, { speed: 0.8 }, 3);
      const t = p.body.translation();
      api.fx({ k: 'flash', p: [t.x, t.y + 1, t.z], a: 1.6, c: 0xcc0000 });
    }
  }
  if (veh && !veh.dead && veh.behavior.body) {
    const b = veh.behavior.body;
    const lv = b.linvel();
    b.setLinvel({ x: lv.x * 0.8, y: lv.y, z: lv.z * 0.8 }, true);
    veh.noImpactUntil = api.time + 200;
  }
};

const lance_tomates: ItemHandler = {
  use(ctx) {
    const { api, player: p } = ctx;
    const { muzzle, dir } = aim(ctx, 0, 80);
    api.spawnProjectile({
      kind: 'tomato', pos: muzzle, vel: dir.clone().multiplyScalar(36), owner: p, gravity: 8, life: 4,
      onHit: (hit, pt) => splat(api, pt, hit?.player ?? null, hit?.vehicle ?? null),
    });
    api.fx({ k: 'sound', p: at(muzzle), s: 'pop' });
  },
};

export const pack: Pack = {
  items, props,
  handlers: { lance_roquettes, grenade, mitraillette, mine_collante, fusil_ventouses, lance_tomates },
  propTicks: { w_mine: mineTick, w_glue: glueTick },
};
