// Vérifications physiques des véhicules aériens WTF : ovni, canape_fusee, dirigeable_pedales.  npx tsx tests/aeriens.ts
import * as THREE from 'three';
import { driveScenario } from './harness';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) fails++;
};
const pos = (v: { behavior: { body: { translation(): { x: number; y: number; z: number } } } }) => v.behavior.body.translation();
const speed = (v: { behavior: { body: { linvel(): { x: number; y: number; z: number } } } }) => { const l = v.behavior.body.linvel(); return Math.hypot(l.x, l.y, l.z); };

async function ovni() {
  // 1. décollage + vol horizontal stable + vitesse max
  let r = await driveScenario('ovni', (t) => ({ th: t < 2 ? 1 : 0, f: t > 2 ? 1 : 0 }), 8);
  let p = pos(r.vehicle);
  check('ovni : décolle et vole', p.y > 12, `y=${p.y.toFixed(1)}`);
  const sp = Math.hypot(r.vehicle.behavior.body.linvel().x, r.vehicle.behavior.body.linvel().z);
  check('ovni : vitesse horizontale ≤ 31 m/s et > 20', sp < 31 && sp > 20, `${sp.toFixed(1)} m/s`);
  check('ovni : intact', r.vehicle.hp === r.vehicle.def.maxHp && !r.vehicle.dead, `hp=${r.vehicle.hp}`);
  // 2. rebond : descente forcée, bloop et pas de dégât
  r = await driveScenario('ovni', (t) => ({ th: t < 2 ? 1 : -1 }), 8, { every: 0.25 });
  const bloops = r.fx.filter((e) => e.k === 'sound' && e.s === 'bloop').length;
  check('ovni : rebondit (bloop)', bloops >= 2, `${bloops} bloops`);
  check('ovni : survit aux rebonds', !r.vehicle.dead && r.vehicle.hp > r.vehicle.def.maxHp * 0.9, `hp=${r.vehicle.hp}`);
  // 4. rayon tracteur
  r = await driveScenario('ovni', (t, { sim, vehicle }) => {
    if (t < 0.02) {
      const b = vehicle.behavior.body.translation();
      (sim as any).__crate = sim.spawnProp('crate_m', new THREE.Vector3(b.x, 0.8, b.z));
    }
    return { m1: t > 0.5 ? 1 : 0, th: t < 0.5 ? 1 : 0 };
  }, 0.5 + 4, { every: 1 });
  const crate = (r.sim as any).__crate;
  const cy = crate.body.translation().y;
  check('ovni : rayon tracteur soulève une caisse', cy > 4, `caisse y=${cy.toFixed(1)}`);
  // 5. éjection radiale
  r = await driveScenario('ovni', (t, { sim, vehicle }) => {
    if (t < 0.02) {
      const b = vehicle.behavior.body.translation();
      (sim as any).__c = sim.spawnProp('crate_m', new THREE.Vector3(b.x + 5, 0.7, b.z));
    }
    return { m2: t > 0.5 && t < 0.6 ? 1 : 0 };
  }, 2);
  const c2 = (r.sim as any).__c.body.translation();
  const o = pos(r.vehicle);
  check('ovni : éjection radiale écarte une caisse', Math.hypot(c2.x - o.x, c2.z - o.z) > 9, `distance=${Math.hypot(c2.x - o.x, c2.z - o.z).toFixed(1)}`);
  check('ovni : onde (ring) émise', r.fx.some((e) => e.k === 'ring'));
}

async function canape() {
  let r = await driveScenario('canape_fusee', (t) => ({ f: 1, th: t < 1 ? 1 : 0 }), 6, { every: 1 });
  const sp = Math.hypot(r.vehicle.behavior.body.linvel().x, r.vehicle.behavior.body.linvel().z);
  check('canapé : accélère (f)', sp > 15, `${sp.toFixed(1)} m/s`);
  check('canapé : stable', !r.vehicle.dead && pos(r.vehicle).y < 40 && pos(r.vehicle).y > 0, `y=${pos(r.vehicle).y.toFixed(1)}`);
  // saut + atterrissage
  r = await driveScenario('canape_fusee', (t) => ({ jump: t > 0.2 && t < 0.3 ? 1 : 0 }), 4, { every: 0.25 });
  const boings = r.fx.filter((e) => e.k === 'sound' && e.s === 'boing').length;
  const ymax = Math.max(...r.rows.map((x) => x.alt));
  check('canapé : saut ressort + boïoïng à l\'atterrissage', boings >= 2 && ymax > 5, `boings=${boings}, ymax=${ymax.toFixed(1)}`);
  check('canapé : pas de dégâts au saut', r.vehicle.hp === r.vehicle.def.maxHp, `hp=${r.vehicle.hp}`);
  // boost
  const base = await driveScenario('canape_fusee', () => ({ f: 1 }), 2);
  const boost = await driveScenario('canape_fusee', (t) => ({ f: 1, m2: t > 0.1 && t < 0.2 ? 1 : 0 }), 2);
  check('canapé : le boost accélère davantage', speed(boost.vehicle) > speed(base.vehicle) * 1.3, `${speed(base.vehicle).toFixed(1)} -> ${speed(boost.vehicle).toFixed(1)} m/s`);
  // coussin
  const cu = await driveScenario('canape_fusee', (t) => ({ m1: t > 0.2 && t < 0.3 ? 1 : 0, ad: [0, 0, -1] as [number, number, number] }), 1);
  check('canapé : lance un coussin', cu.sim.snapshot().proj.length >= 8 || cu.fx.some((e) => e.s === 'pop'));
  // virage sur lui-même
  r = await driveScenario('canape_fusee', () => ({ s: 1 }), 2);
  const q = r.vehicle.behavior.body.rotation();
  check('canapé : tourne sur lui-même', Math.abs(q.y) > 0.3 && Math.hypot(r.vehicle.behavior.body.linvel().x, r.vehicle.behavior.body.linvel().z) < 2);
}

async function dirigeable() {
  // sans pédaler : flotte, ne tombe pas
  let r = await driveScenario('dirigeable_pedales', (t) => ({ th: t < 3 ? 1 : 0 }), 8, { every: 1 });
  check('dirigeable : monte puis reste en l\'air', pos(r.vehicle).y > 8 && Math.abs(r.vehicle.behavior.body.linvel().y) < 0.5, `y=${pos(r.vehicle).y.toFixed(1)}`);
  // cadence : 5 coups/s vs 2 coups/s vs aucune
  const mash = (hz: number) => (t: number) => ({ th: t < 2 ? 1 : 0, f: t > 1 && Math.floor(t * hz * 2) % 2 === 0 ? 1 : 0 });
  const fast = await driveScenario('dirigeable_pedales', mash(6), 8);
  const slow = await driveScenario('dirigeable_pedales', mash(2), 8);
  const none = await driveScenario('dirigeable_pedales', () => ({ th: 0 }), 8);
  const hs = (v: any) => Math.hypot(v.behavior.body.linvel().x, v.behavior.body.linvel().z);
  check('dirigeable : cadence rapide > lente > rien', hs(fast.vehicle) > hs(slow.vehicle) && hs(slow.vehicle) > hs(none.vehicle) + 0.5,
    `rapide=${hs(fast.vehicle).toFixed(1)} lente=${hs(slow.vehicle).toFixed(1)} rien=${hs(none.vehicle).toFixed(1)}`);
  check('dirigeable : plafond ~14 m/s', hs(fast.vehicle) <= 14.5 && hs(fast.vehicle) > 9);
  // maintenir f ne fait pas avancer vite
  const hold = await driveScenario('dirigeable_pedales', () => ({ f: 1 }), 6);
  check('dirigeable : maintenir f ≠ pédaler', hs(hold.vehicle) < 4, `${hs(hold.vehicle).toFixed(1)} m/s`);
  // lest
  const bl = await driveScenario('dirigeable_pedales', (t) => ({ th: t < 2 ? 1 : 0, m1: t > 2.5 && t < 2.6 ? 1 : 0 }), 4);
  check('dirigeable : lâche un lest (crate_l)', [...bl.sim.props.values()].some((p) => p.kind.id === 'crate_l'));
  // dégonflage : coup puis observation
  r = await driveScenario('dirigeable_pedales', (t, { sim, vehicle }) => {
    if (Math.abs(t - 3) < 0.009) sim.damageVehicle(vehicle, 12, 'bullet', null);
    return { th: t < 3 ? 1 : 0 };
  }, 12, { every: 1 });
  const ys = r.rows.map((x) => x.alt.toFixed(1)).join(' ');
  console.log('   altitudes (1/s) :', ys);
  const yMid = r.rows.find((x) => x.t >= 3)!.alt;
  check('dirigeable : touché, il descend en planant sans exploser', !r.vehicle.dead && r.rows[r.rows.length - 1].alt < yMid - 3, `hp=${r.vehicle.hp}`);
  check('dirigeable : pfffff émis', r.fx.some((e) => e.k === 'text' && e.s?.startsWith('pfff')));
}

(async () => {
  await ovni();
  await canape();
  await dirigeable();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
})();
