// Vérifications des 10 objets de construction : npx tsx tests/objets1.ts
import * as THREE from 'three';
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { ITEMS } from '../shared/registry';
import type { SimProp } from '../shared/api';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fxLog: { k: string; s?: string }[] = [];
const errors: string[] = [];

async function fresh() {
  const s = await Sim.create();
  s.log = (l) => errors.push(l);
  s.onAnnounce = () => {};
  return s;
}
const run = (sim: Sim, seconds: number, each?: (k: number) => void) => {
  const n = Math.round(seconds / STEP);
  for (let k = 0; k < n; k++) {
    each?.(k);
    sim.step();
    if (k % 2 === 0) for (const e of sim.snapshot().fx) fxLog.push({ k: e.k, s: e.s });
  }
};
const pos = (p: { body: { translation(): { x: number; y: number; z: number } } }) => { const t = p.body.translation(); return V(t.x, t.y, t.z); };

async function setup(x = 200, z = 200) {
  const sim = await fresh();
  sim.addPlayer('p1', 'Bob');
  const bob = sim.players.get('p1')!;
  run(sim, 1);
  bob.body.setTranslation({ x, y: 1, z }, true);
  run(sim, 0.5);
  const head = () => { const t = bob.body.translation(); return V(t.x, t.y + 0.7, t.z); };
  const input = (ad: THREE.Vector3, item: string, m1 = 0, m2 = 0, wheel = 0) => {
    const h = head();
    const a = ad.clone().normalize();
    sim.setInput('p1', { ao: [h.x, h.y, h.z], ad: [a.x, a.y, a.z], m1, m2, item, wheel });
  };
  /** Clic (front montant) puis relâche. */
  const click = (ad: THREE.Vector3, item: string, btn: 1 | 2 = 1, wheel = 0) => {
    run(sim, 0.05, () => input(ad, item, 0, 0));
    run(sim, 0.05, () => input(ad, item, btn === 1 ? 1 : 0, btn === 2 ? 1 : 0, wheel));
    run(sim, 0.05, () => input(ad, item, 0, 0));
  };
  return { sim, bob, head, input, click, ground: V(0, -0.5, -1) };
}
const myProps = (sim: Sim, kind: string) => [...sim.props.values()].filter((p) => p.kind.id === kind && !p.base);

async function main() {
  // ---------- 1. Pose de chaque objet ----------
  const expect: Record<string, { kind: string; frozen: boolean }> = {
    planche: { kind: 'b_planche', frozen: false }, bloc: { kind: 'b_bloc', frozen: false }, rampe: { kind: 'b_rampe', frozen: true },
    mur: { kind: 'b_mur', frozen: true }, pilier: { kind: 'b_pilier', frozen: true }, trampoline: { kind: 'b_trampoline', frozen: false },
    barrique_explosive: { kind: 'b_barrique', frozen: false }, roue_geante: { kind: 'b_roue', frozen: false }, propulseur: { kind: 'b_propulseur', frozen: true },
  };
  check('les 10 objets sont enregistrés (cat build)', ['planche', 'bloc', 'rampe', 'mur', 'pilier', 'ballon_flottant', 'trampoline', 'barrique_explosive', 'roue_geante', 'propulseur']
    .every((id) => ITEMS.find((i) => i.id === id)?.cat === 'build'));
  for (const [item, ex] of Object.entries(expect)) {
    const t = await setup();
    t.click(t.ground, item);
    run(t.sim, 1.2);
    const ps = myProps(t.sim, ex.kind);
    const p = ps[0];
    check(`${item} : le prop ${ex.kind} apparaît`, ps.length === 1);
    if (!p) continue;
    const y = pos(p).y;
    check(`${item} : ${ex.frozen ? 'gelé (reste fixe)' : 'dynamique'}, posé sur le sol (pas enfoncé)`, p.frozen === ex.frozen && y > 0.05 && y < 4.5, `y=${y.toFixed(2)}`);
    if (ex.frozen) {
      const before = pos(p);
      run(t.sim, 1);
      check(`${item} : ne bouge pas`, pos(p).distanceTo(before) < 1e-4);
    }
  }
  {
    const t = await setup();
    t.click(V(0, 1, -0.2), 'bloc');
    check('refus : visée vers le ciel -> pas de prop + texte « Trop loin »', myProps(t.sim, 'b_bloc').length === 0 && fxLog.some((e) => e.k === 'text' && !!e.s && /loin|portée|ciel|vide/i.test(e.s)));
    t.click(t.ground, 'bloc');
    check('refus : pas de recharge perdue, la pose suivante fonctionne', myProps(t.sim, 'b_bloc').length === 1);
  }
  {
    const t = await setup();
    t.click(t.ground, 'planche'); run(t.sim, 0.6);
    t.click(t.ground, 'planche', 2);
    t.click(t.ground, 'planche'); // doit être immédiat malgré le clic droit
    const [a, b] = myProps(t.sim, 'b_planche');
    check('planche : clic droit tourne de 90° sans coûter de recharge', !!b && Math.abs(Math.abs(t.sim.quatOf(a.body).dot(t.sim.quatOf(b.body))) - Math.SQRT1_2) < 0.05);
  }
  {
    const t = await setup();
    t.sim.setInput('p1', { ao: [200, 1.7, 200], ad: [0, -0.5, -1], m1: 0, m2: 0, item: 'pilier', wheel: 1 });
    run(t.sim, 0.1);
    t.click(t.ground, 'pilier');
    check('pilier : la molette change la hauteur (8 m)', myProps(t.sim, 'b_pilier_g').length === 1 && myProps(t.sim, 'b_pilier').length === 0);
  }

  // ---------- 2. Trampoline ----------
  {
    const t = await setup();
    t.click(t.ground, 'trampoline');
    run(t.sim, 1.5);
    const tr = myProps(t.sim, 'b_trampoline')[0];
    const tp = pos(tr);
    const crate = t.sim.spawnProp('crate_s', V(tp.x, tp.y + 6, tp.z), undefined, undefined, null)!;
    let vmax = 0, vin = 0;
    run(t.sim, 3, () => { const v = crate.body.linvel(); if (v.y < vin) vin = v.y; vmax = Math.max(vmax, v.y); });
    check('trampoline : une caisse qui tombe repart vers le haut, plus vite', vmax > 12 && vmax > -vin * 1.4, `chute ${vin.toFixed(1)} -> bond +${vmax.toFixed(1)} m/s`);
    check('trampoline : son boing', fxLog.some((e) => e.k === 'sound' && e.s === 'boing'));
    // joueur
    const bob = t.bob;
    bob.body.setTranslation({ x: tp.x, y: tp.y + 3, z: tp.z }, true);
    let pm = 0;
    run(t.sim, 2, () => { pm = Math.max(pm, bob.body.linvel().y); });
    check('trampoline : le joueur est renvoyé en l\'air', pm > 11, `vy max ${pm.toFixed(1)}`);
    const car = t.sim.vehicles.find((v) => v.def.type === 'car')!;
    car.behavior.body.setTranslation({ x: tp.x, y: tp.y + 4, z: tp.z }, true);
    car.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let cm = 0;
    run(t.sim, 2, () => { cm = Math.max(cm, car.behavior.body.linvel().y); });
    check('trampoline : un véhicule rebondit', cm > 11 && !car.dead, `vy max ${cm.toFixed(1)}, hp ${car.hp}/${car.def.maxHp}`);
  }

  // ---------- 3. Barrique ----------
  {
    const t = await setup();
    t.click(t.ground, 'barrique_explosive');
    run(t.sim, 1);
    const bar = myProps(t.sim, 'b_barrique')[0];
    check('barrique : posée, stable (pas d\'explosion toute seule)', !!bar && t.sim.props.has(bar.id));
    const crate = t.sim.spawnProp('crate_m', pos(bar).add(V(2, 0.6, 0)), undefined, undefined, null)!;
    run(t.sim, 0.5);
    const cy = pos(crate);
    t.sim.damageProp(bar, 10, t.bob); // une balle : elle s'enflamme
    run(t.sim, 0.5);
    check('barrique : touchée, elle s\'enflamme sans exploser tout de suite', t.sim.props.has(bar.id) && fxLog.some((e) => e.k === 'text' && e.s?.includes('🔥')));
    run(t.sim, 2.5);
    check('barrique : puis explose (retirée, boom)', !t.sim.props.has(bar.id) && fxLog.some((e) => e.k === 'boom'));
    check('barrique : l\'explosion projette la caisse voisine', pos(crate).distanceTo(cy) > 2 || !t.sim.props.has(crate.id), `déplacement ${pos(crate).distanceTo(cy).toFixed(1)} m`);
    // dégâts directs forts
    run(t.sim, 7);
    t.click(t.ground, 'barrique_explosive'); run(t.sim, 1);
    const b2 = myProps(t.sim, 'b_barrique')[0];
    t.sim.damageProp(b2, 500, t.bob);
    run(t.sim, 0.6);
    check('barrique : un gros tir la fait exploser aussitôt', !t.sim.props.has(b2.id));
    // lancer (m2) : explose à l'impact
    run(t.sim, 6);
    t.click(V(0, 0.2, -1), 'barrique_explosive', 2);
    const thrown = myProps(t.sim, 'b_barrique')[0];
    check('barrique : clic droit la lance (vitesse élevée)', !!thrown && Math.hypot(thrown.body.linvel().x, thrown.body.linvel().z) > 8);
    run(t.sim, 4);
    check('barrique : la barrique lancée explose à l\'impact', !!thrown && !t.sim.props.has(thrown.id));
  }

  // ---------- 4. Roue géante ----------
  {
    const t = await setup();
    t.click(t.ground, 'roue_geante');
    run(t.sim, 2);
    const w = myProps(t.sim, 'b_roue')[0];
    const w0 = pos(w);
    const av = () => { const a = w.body.angvel(); return Math.hypot(a.x, a.y, a.z); };
    check('roue : tourne à vitesse constante', Math.abs(av() - 2.2) < 0.2, `ω=${av().toFixed(2)} rad/s`);
    run(t.sim, 3);
    check('roue : reste en place (ancrée) tout en tournant', pos(w).distanceTo(w0) < 0.5, `dérive ${pos(w).distanceTo(w0).toFixed(2)} m`);
    const a0 = w.body.angvel();
    // clic droit sur la roue : inverse
    const toW = pos(w).sub(t.head());
    t.click(toW, 'roue_geante', 2);
    run(t.sim, 0.3);
    const a1 = w.body.angvel();
    check('roue : clic droit inverse le sens', a0.x * a1.x + a0.y * a1.y + a0.z * a1.z < 0);
    // une caisse posée sur le haut de la jante est emportée
    const crate = t.sim.spawnProp('crate_m', pos(w).add(V(0, 2.65, 0)), undefined, undefined, null)!;
    const c0 = pos(crate);
    run(t.sim, 2);
    check('roue : entraîne ce qui touche son bord', pos(crate).distanceTo(c0) > 0.8, `déplacement ${pos(crate).distanceTo(c0).toFixed(1)} m`);
  }

  // ---------- 5. Propulseur ----------
  {
    const t = await setup();
    t.click(V(0, 0.3, -1), 'propulseur'); // visé à l'horizontale sur le sol lointain -> raycast peut rater ; on pose au sol
    if (myProps(t.sim, 'b_propulseur').length === 0) t.click(t.ground, 'propulseur');
    run(t.sim, 0.5);
    const th = myProps(t.sim, 'b_propulseur')[0];
    check('propulseur : posé', !!th && th.frozen);
    const q = t.sim.quatOf(th.body);
    const dir = UPV().applyQuaternion(q);
    const crate = t.sim.spawnProp('crate_m', pos(th).addScaledVector(dir, 2.5), undefined, undefined, null)!;
    t.sim.freezeProp(crate, false);
    const c0 = pos(crate);
    run(t.sim, 1.2);
    const d = pos(crate).sub(c0);
    check('propulseur : pousse la caisse dans son axe', d.dot(dir) > 3, `Δ=${d.dot(dir).toFixed(1)} m selon l'axe`);
    check('propulseur : flamme (fx beam)', fxLog.some((e) => e.k === 'beam'));
    run(t.sim, 10);
    check('propulseur : disparaît après 10 s', !t.sim.props.has(th.id));
  }

  // ---------- 6. Ballon ----------
  {
    const t = await setup();
    const crate = t.sim.spawnProp('crate_m', V(200, 0.7, 195), undefined, undefined, null)!;
    run(t.sim, 1);
    t.click(pos(crate).sub(t.head()), 'ballon_flottant');
    const ball = myProps(t.sim, 'b_ballon')[0];
    check('ballon : apparaît attaché à la caisse', !!ball);
    run(t.sim, 5);
    const y5 = pos(crate).y;
    check('ballon : la caisse est soulevée', y5 > 5, `y=${y5.toFixed(1)}`);
    run(t.sim, 15);
    const y = pos(crate).y;
    check('ballon : plafond ≈ 15 m (la caisse se stabilise)', y > 11 && y < 17.5, `y=${y.toFixed(1)}`);
    // véhicule
    const car = t.sim.vehicles.find((v) => v.def.type === 'car')!;
    const cp = pos({ body: car.behavior.body });
    t.bob.body.setTranslation({ x: cp.x + 6, y: 1, z: cp.z }, true);
    run(t.sim, 0.5);
    const head = () => { const q = t.bob.body.translation(); return V(q.x, q.y + 0.7, q.z); };
    const clickCar = () => {
      run(t.sim, 0.05, () => t.sim.setInput('p1', { ao: head().toArray(), ad: pos({ body: car.behavior.body }).sub(head()).normalize().toArray(), m1: 0, m2: 0, item: 'ballon_flottant', wheel: 0 }));
      run(t.sim, 0.05, () => t.sim.setInput('p1', { ao: head().toArray(), ad: pos({ body: car.behavior.body }).sub(head()).normalize().toArray(), m1: 1, m2: 0, item: 'ballon_flottant', wheel: 0 }));
    };
    clickCar();
    run(t.sim, 5);
    check('ballon : soulève une voiture', pos({ body: car.behavior.body }).y > 5 && !car.dead, `y=${pos({ body: car.behavior.body }).y.toFixed(1)} hp=${car.hp}`);
    // ballon seul
    t.click(t.ground, 'ballon_flottant'); run(t.sim, 4.5);
    const free = myProps(t.sim, 'b_ballon').filter((b) => b !== ball && pos(b).y > 3).length;
    run(t.sim, 16);
    check('ballon : seul il monte puis disparaît', free >= 1 && myProps(t.sim, 'b_ballon').filter((b) => pos(b).y > 3 && b.body.linvel().y > 0).length === 0, `montés=${free}`);
  }

  // ---------- 7. Deux minutes simulées ----------
  {
    const sim = await fresh();
    errors.length = 0;
    const ids = ['p1', 'p2', 'p3'];
    ids.forEach((id, i) => sim.addPlayer(id, `Bot${i}`));
    const items = ['planche', 'bloc', 'rampe', 'mur', 'pilier', 'ballon_flottant', 'trampoline', 'barrique_explosive', 'roue_geante', 'propulseur'];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    let threw: unknown = null;
    try {
      run(sim, 120, (k) => {
        if (k % 20 === 0) {
          for (const id of ids) {
            const t = sim.players.get(id)!.body.translation();
            const ad = new THREE.Vector3(rnd(-1, 1), rnd(-0.9, 0.2), rnd(-1, 1)).normalize();
            sim.setInput(id, { f: rnd(-1, 1), s: rnd(-1, 1), yaw: rnd(-3, 3), jump: Math.random() < 0.2 ? 1 : 0, m1: Math.random() < 0.6 ? 1 : 0, m2: Math.random() < 0.25 ? 1 : 0,
              ao: [t.x, t.y + 1, t.z], ad: [ad.x, ad.y, ad.z], item: items[Math.floor(Math.random() * items.length)], wheel: Math.round(rnd(-1, 1)) } as never);
          }
        }
        if (k % 600 === 0) sim.explode(V(rnd(-20, 20), 1, rnd(-20, 20)), 8, 15, 80, null);
      });
    } catch (e) { threw = e; }
    check('2 min simulées, 3 joueurs aléatoires sur les 10 objets, sans exception', !threw && errors.length === 0, threw ? String(threw) : errors[0]?.slice(0, 300) ?? '');
  }

  console.log(fails ? `\n${fails} échec(s)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}
function UPV() { return new THREE.Vector3(0, 1, 0); }
void ({} as SimProp);
main().catch((e) => { console.error(e); process.exit(2); });
