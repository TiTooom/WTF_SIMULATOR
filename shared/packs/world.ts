// Paquet « world » : props de décor (immeubles en blocs, château de caisses…), props des événements chaos
// et easter eggs (ids `e_…`) avec leurs comportements permanents (propTicks).
import * as THREE from 'three';
import type { Pack, PropTick, SimApi, SimProp } from '../api';
import type { PropKind } from '../props';

/** Crochets posés par le serveur (server/events.ts) : un prop du monde peut déclencher un événement chaos. */
export const worldHooks: { chaos?: (who: string) => void } = {};

// ---------- Props ----------
const blk = (id: string, color: number): PropKind => ({ id, name: 'Bloc de ville', shape: 'box', size: [2.5, 2.5, 2.5], color, mass: 10, hp: 45, friction: 0.9 });

export const WORLD_PROPS: PropKind[] = [
  // Ville miniature
  blk('d_blk_a', 0xe76f51), blk('d_blk_b', 0x4cc9f0), blk('d_blk_c', 0xf9c74f), blk('d_blk_d', 0x90be6d),
  { id: 'd_cyl', name: 'Tour cylindrique', shape: 'cylinder', size: [2.6, 2.5], color: 0xb388eb, mass: 9, hp: 45, friction: 0.9 },
  // Château de caisses
  { id: 'd_crate', name: 'Caisse de rempart', shape: 'box', size: [2.2, 2.2, 2.2], color: 0xc68642, mass: 8, hp: 80, friction: 0.9 },
  { id: 'd_crate_s', name: 'Créneau', shape: 'box', size: [1.1, 1.1, 1.1], color: 0xe0a458, mass: 2, hp: 40 },
  { id: 'd_gold', name: 'Donjon-coffre', shape: 'box', size: [3, 3, 3], color: 0xffd166, mass: 60, hp: 400, friction: 0.9 },
  { id: 'd_gold_s', name: 'Caisse dorée', shape: 'box', size: [1, 1, 1], color: 0xffc300, mass: 2, hp: 30 },
  // Divers
  { id: 'd_cart', name: 'Caddie décoratif', shape: 'box', size: [0.7, 0.9, 1.1], color: 0xb0b7c3, mass: 6 },
  { id: 'd_cone', name: 'Cône', shape: 'cylinder', size: [0.5, 0.9], color: 0xff7b00, mass: 1.5 },
  { id: 'd_barrel', name: 'Tonneau', shape: 'cylinder', size: [0.9, 1.1], color: 0x4895ef, mass: 5, hp: 40 },
  // Événements chaos
  { id: 'x_rain', name: 'Caisse tombée du ciel', shape: 'box', size: [1.2, 1.2, 1.2], color: 0xff6bd6, mass: 2, hp: 40, life: 25 },
  { id: 'x_gnome', name: 'Gnome géant', shape: 'cylinder', size: [3, 6], color: 0xe63946, mass: 500, hp: 700 },
  // Easter eggs
  { id: 'e_cow', name: 'Vache', shape: 'box', size: [1.6, 1.4, 2.6], color: 0xfafafa, mass: 40, behavior: 'e_cow' },
  { id: 'e_button', name: 'Bouton NE PAS APPUYER', shape: 'cylinder', size: [1.6, 0.6], color: 0xe63946, mass: 4000, behavior: 'e_button' },
  { id: 'e_piano', name: 'Piano-caisse', shape: 'box', size: [3, 1.3, 1.1], color: 0x23232e, mass: 3000, behavior: 'e_piano' },
  { id: 'e_duck', name: 'Canard géant', shape: 'sphere', size: [4], color: 0xffe14d, mass: 3000, behavior: 'e_duck' },
  { id: 'e_sing', name: 'Caisse qui chante', shape: 'box', size: [1.5, 1.5, 1.5], color: 0x9b5de5, mass: 10, hp: 150, behavior: 'e_sing' },
  { id: 'e_nothing', name: 'Paillasson', shape: 'box', size: [2.4, 0.2, 1.4], color: 0x8d6e63, mass: 3000, behavior: 'e_nothing' },
  { id: 'e_stone', name: 'Pierre centrale', shape: 'sphere', size: [1.4], color: 0x9aa0a6, mass: 3000, behavior: 'e_circle' },
  { id: 'e_summit', name: 'Cube du sommet', shape: 'box', size: [3, 3, 3], color: 0xffd700, mass: 100, glow: true, behavior: 'e_summit' },
];

// ---------- Comportements ----------
const store = new WeakMap<object, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
function state(p: SimProp, init: () => Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  let s = store.get(p);
  if (!s) { s = init(); store.set(p, s); }
  return s;
}

interface Who { x: number; y: number; z: number; name: string; id: string; hp: number }
function whoIs(api: SimApi): Who[] {
  const out: Who[] = [];
  for (const p of api.players.values()) {
    const b = p.vehicle?.behavior.body ?? p.body;
    const t = b.translation();
    out.push({ x: t.x, y: t.y, z: t.z, name: p.name, id: p.id, hp: p.hp });
  }
  return out;
}

/** Garde un prop lourd à sa place (les objets « fixes » du monde ne dérivent pas, sans être gelés donc sans teinte bleue). */
function anchor(p: SimProp, s: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = p.body.translation();
  s.home ??= { x: t.x, y: t.y, z: t.z };
  const h = s.home;
  if (Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z) > 0.15) {
    p.body.setTranslation({ x: h.x, y: h.y, z: h.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  return h as { x: number; y: number; z: number };
}

const fxText = (api: SimApi, p: [number, number, number], s: string, c = 0xffe066) => api.fx({ k: 'text', p, s, c });
const fxSound = (api: SimApi, p: [number, number, number], s: string) => api.fx({ k: 'sound', p, s });

const cow: PropTick = (p, api) => {
  const s = state(p, () => ({ n: 0, next: 0, started: false, done: false }));
  if (s.done) return;
  const t = p.body.translation();
  s.home ??= { x: t.x, y: t.y, z: t.z };
  if (!s.started) {
    const lv = p.body.linvel();
    if (Math.hypot(t.x - s.home.x, t.z - s.home.z) > 0.7 || t.y < s.home.y - 0.7 || Math.hypot(lv.x, lv.z) > 1.4) { s.started = true; s.next = api.time; }
    return;
  }
  if (api.time < s.next) return;
  fxText(api, [t.x, t.y + 2.2, t.z], 'MEUH !', 0xffffff);
  fxSound(api, [t.x, t.y, t.z], 'horn_2');
  s.n++;
  s.next = api.time + 650;
  if (s.n >= 3) {
    s.done = true;
    for (let i = 0; i < 3; i++) api.spawnProp('d_gold_s', new THREE.Vector3(t.x + (i - 1) * 1.3, t.y + 2.5 + i * 0.4, t.z + 1.5));
    api.fx({ k: 'confetti', p: [t.x, t.y + 1, t.z], b: 70 });
    api.announce('🐄 La vache a parlé trois fois. Des caisses dorées tombent du ciel.');
  }
};

const button: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0 }));
  const h = anchor(p, s);
  if (api.time < s.cool) return;
  for (const w of whoIs(api)) {
    if (w.hp <= 0 || Math.hypot(w.x - h.x, w.z - h.z) > 2.3 || w.y > h.y + 2.5) continue;
    s.cool = api.time + 60_000;
    fxText(api, [h.x, h.y + 2, h.z], 'CLIC !', 0xff4d4d);
    fxSound(api, [h.x, h.y, h.z], 'zap');
    api.announce(`🔴 ${w.name} a appuyé sur le bouton « NE PAS APPUYER ». Évidemment.`);
    worldHooks.chaos?.(w.name);
    return;
  }
};

const NOTES = ['bloop', 'pop', 'horn_5', 'bloop', 'boing', 'horn_1', 'meow'];
const piano: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0, left: 0, next: 0 }));
  const h = anchor(p, s);
  if (s.left > 0 && api.time >= s.next) {
    fxSound(api, [h.x, h.y, h.z], NOTES[(Math.random() * NOTES.length) | 0]);
    s.left--;
    s.next = api.time + 170;
    return;
  }
  if (api.time < s.cool) return;
  for (const w of whoIs(api)) {
    if (w.hp <= 0 || Math.abs(w.x - h.x) > 2.3 || Math.abs(w.z - h.z) > 1.7 || w.y > h.y + 2.5) continue;
    s.cool = api.time + 1800;
    s.left = 5;
    s.next = api.time;
    fxText(api, [h.x, h.y + 1.8, h.z], '♪ ♫ ♪', 0xffffff);
    return;
  }
};

const duck: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0 }));
  const h = anchor(p, s);
  if (api.time < s.cool) return;
  const ws = whoIs(api);
  if (!ws.some((w) => w.hp > 0 && Math.hypot(w.x - h.x, w.y - h.y, w.z - h.z) < 3.8)) return;
  s.cool = api.time + 6000;
  fxSound(api, [h.x, h.y, h.z], 'quack');
  fxText(api, [h.x, h.y + 3.2, h.z], 'COIN COIN !', 0xffe14d);
  api.fx({ k: 'confetti', p: [h.x, h.y + 1, h.z], c: 0xffe14d, b: 40 });
  for (const pl of api.players.values()) {
    const w = ws.find((x) => x.id === pl.id);
    if (w && Math.hypot(w.x - h.x, w.z - h.z) < 12) api.applyMod(pl, { speed: 1.2 }, 3);
  }
};

const MELODY = 22_000;
const sing: PropTick = (p, api) => {
  const s = state(p, () => ({ next: 0 }));
  if (api.time < s.next) return;
  const t = p.body.translation();
  if (!whoIs(api).some((w) => Math.hypot(w.x - t.x, w.z - t.z) < 35)) { s.next = api.time + 2000; return; }
  s.next = api.time + MELODY;
  fxSound(api, [t.x, t.y, t.z], 'jingle');
  fxText(api, [t.x, t.y + 1.6, t.z], '♪ la la la ♪', 0xc77dff);
};

const nothing: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0 }));
  const h = anchor(p, s);
  if (api.time < s.cool) return;
  if (!whoIs(api).some((w) => w.hp > 0 && Math.hypot(w.x - h.x, w.z - h.z) < 7)) return;
  s.cool = api.time + 20_000;
  fxText(api, [h.x, h.y + 3, h.z], 'Vraiment, rien.', 0xffffff);
  for (let i = 0; i < 5; i++) {
    api.fx({ k: 'confetti', p: [h.x + (i - 2) * 2.5, h.y + 1 + i, h.z + 3], b: 30 });
    api.fx({ k: 'spark', p: [h.x + (i - 2) * 2.5, h.y + 5 + i, h.z + 3] });
  }
  fxSound(api, [h.x, h.y, h.z], 'fanfare');
};

const circle: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0, spin: 0 }));
  const h = anchor(p, s);
  const ws = whoIs(api);
  if (s.spin > 0) {
    s.spin--;
    for (const v of api.vehicles) {
      if (v.dead || !v.behavior.body) continue;
      const t = v.behavior.body.translation();
      if (Math.hypot(t.x - h.x, t.z - h.z) > 45) continue;
      const w = v.behavior.body.angvel();
      v.behavior.body.setAngvel({ x: w.x, y: 6, z: w.z }, true);
    }
    return;
  }
  if (api.time < s.cool) return;
  const inside = ws.filter((w) => w.hp > 0 && Math.hypot(w.x - h.x, w.z - h.z) < 6.5 && w.y < h.y + 4).length;
  if (inside < Math.min(4, Math.max(1, ws.length))) return;
  s.cool = api.time + 30_000;
  s.spin = 180;
  fxText(api, [h.x, h.y + 3, h.z], 'Le cercle s\'éveille...', 0x9d4edd);
  api.fx({ k: 'ring', p: [h.x, h.y + 0.5, h.z], a: 14, c: 0x9d4edd });
  api.announce('🗿 Le cercle de pierres s\'est éveillé. Tous les véhicules des environs tournent, c\'est normal.');
};

const summit: PropTick = (p, api) => {
  const s = state(p, () => ({ cool: 0 }));
  const h = anchor(p, s);
  if (api.time < s.cool) return;
  for (const w of whoIs(api)) {
    if (w.hp <= 0 || Math.hypot(w.x - h.x, w.y - h.y, w.z - h.z) > 6) continue;
    s.cool = api.time + 30_000;
    fxText(api, [h.x, h.y + 3, h.z], 'Tu as touché le ciel.', 0xfff3b0);
    api.fx({ k: 'confetti', p: [h.x, h.y + 2, h.z], b: 90 });
    fxSound(api, [h.x, h.y, h.z], 'fanfare');
    api.announce(`☁️ ${w.name} a touché le ciel (le pilier-sommet, 300 m). Respect.`);
    return;
  }
};

export const pack: Pack = {
  items: [],
  props: WORLD_PROPS,
  handlers: {},
  propTicks: { e_cow: cow, e_button: button, e_piano: piano, e_duck: duck, e_sing: sing, e_nothing: nothing, e_circle: circle, e_summit: summit },
};
