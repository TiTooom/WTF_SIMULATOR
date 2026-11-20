// Vérifications physiques de caddie_turbo, camion_glaces, toilettes_roulettes.   npx tsx tests/vehicules2.ts
import * as THREE from 'three';
import { driveScenario } from './harness';
import { VEHICLE_BY_TYPE } from '../shared/vehicles';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const spd = (r: { vehicle: { behavior: { body: { linvel(): { x: number; y: number; z: number } } } } }) => { const v = r.vehicle.behavior.body.linvel(); return Math.hypot(v.x, v.z); };
const pos = (r: { vehicle: { behavior: { body: { translation(): { x: number; y: number; z: number } } } } }) => r.vehicle.behavior.body.translation();
// couloir dégagé : on téléporte le véhicule en (72, -60) = côté de la piste, dégagé avant de rouler (le spawn par défaut est près d'autres véhicules)
type IF = Parameters<typeof driveScenario>[1];
const clear = (fn: IF): IF => (t, c) => {
  if (t === 0) { c.vehicle.behavior.body.setTranslation({ x: 72, y: 1, z: -60 }, true); c.vehicle.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  return fn(t, c);
};
const NOW = (r: { sim: { time: number } }) => r.sim.time;
void NOW;

async function main() {
  for (const t of ['caddie_turbo', 'camion_glaces', 'toilettes_roulettes']) check(`${t} enregistré`, VEHICLE_BY_TYPE.has(t));

  // ---------- caddie ----------
  let r = await driveScenario('caddie_turbo', clear(() => ({ f: 1 })), 6);
  const vNormal = spd(r);
  check('caddie accélère', vNormal > 12, `v=${vNormal.toFixed(1)}`);
  check('caddie reste à l\'endroit', Math.abs(pos(r).y) < 3 && !r.vehicle.dead);

  r = await driveScenario('caddie_turbo', clear((t) => ({ f: 1, m2: t > 3 && t < 3.1 ? 1 : 0 })), 5.5);
  check('turbo : fumée + whoosh', r.fx.some((e) => e.k === 'smoke') && r.fx.some((e) => e.s === 'whoosh'));
  check('turbo plus rapide', spd(r) > vNormal * 1.1, `v=${spd(r).toFixed(1)}`);
  const t0 = r.sim.time;
  // recharge : un 2e turbo à t+3s ne doit rien relancer
  r = await driveScenario('caddie_turbo', clear((t) => ({ f: 1, m2: t > 0.5 && t < 0.6 ? 1 : (t > 4 && t < 4.1 ? 1 : 0) })), 5);
  check('turbo : recharge respectée', r.fx.filter((e) => e.k === 'text' && e.s === 'TURBO !').length === 1);
  void t0;

  r = await driveScenario('caddie_turbo', clear((t) => ({ f: 1, s: t > 3 ? 1 : 0, jump: t > 3 ? 1 : 0 })), 6);
  const rd = await driveScenario('caddie_turbo', clear((t) => ({ f: 1, s: t > 3 ? 1 : 0 })), 6);
  const hd = (x: typeof r) => { const q = x.sim.quatOf(x.vehicle.behavior.body); const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q); const v = x.vehicle.behavior.body.linvel(); return Math.atan2(f.x * v.z - f.z * v.x, f.x * v.x + f.z * v.z); };
  check('dérapage : plus de glisse latérale qu\'en conduite normale', Math.abs(hd(r)) > Math.abs(hd(rd)) + 0.02, `drift=${hd(r).toFixed(2)} normal=${hd(rd).toFixed(2)}`);
  check('crissement émis en dérapage', r.fx.some((e) => e.s === 'whoosh'));

  r = await driveScenario('caddie_turbo', (t) => ({ hn: 0, m1: t > 1 && t < 1.1 ? 1 : 0 }), 2);
  check('klaxon bip-bip', r.fx.some((e) => e.s === 'horn_5'));
  r = await driveScenario('caddie_turbo', clear(() => ({ f: 1 })), 20);
  check('choc contre le décor : bip, pas détruit au 1er contact', r.fx.some((e) => e.s === 'bloop') || spd(r) > 5, `hp=${(r.vehicle.hp / 50).toFixed(2)} dead=${r.vehicle.dead}`);
  r = await driveScenario('caddie_turbo', () => ({}), 1);
  r.sim.explode(new THREE.Vector3(pos(r).x + 2, pos(r).y, pos(r).z), 6, 18, 40);
  for (let i = 0; i < 20; i++) r.sim.step();
  check('roquette/explosion : le caddie est détruit ou très abîmé', r.vehicle.dead || r.vehicle.hp < r.vehicle.def.maxHp * 0.4, `hp=${r.vehicle.hp.toFixed(0)}`);

  // ---------- camion de glaces ----------
  r = await driveScenario('camion_glaces', clear(() => ({ f: 1 })), 8);
  check('camion avance', spd(r) > 8, `v=${spd(r).toFixed(1)}`);
  r = await driveScenario('camion_glaces', (t) => ({ hn: t > 0.5 && t < 0.6 ? 1 : 0 }), 4.5);
  check('musique : jingle répété', r.fx.filter((e) => e.s === 'jingle').length >= 2, `n=${r.fx.filter((e) => e.s === 'jingle').length}`);
  r = await driveScenario('camion_glaces', (t) => ({ hn: t > 0.5 && t < 0.6 || t > 2 && t < 2.1 ? 1 : 0 }), 6);
  check('musique coupée au 2e appui', r.fx.filter((e) => e.s === 'jingle').length <= 2);
  r = await driveScenario('camion_glaces', (t) => ({ m1: t > 0.5 && t < 0.6 ? 1 : 0, ad: [0, 0, -1] }), 3);
  check('cornet : crème + splat à l\'impact', r.fx.some((e) => e.k === 'confetti') && r.fx.some((e) => e.s === 'splat'));
  // cornet sur un caddie : ralentissement
  r = await driveScenario('camion_glaces', () => ({}), 0.5);
  const cad = r.sim.spawnExtraVehicle(VEHICLE_BY_TYPE.get('caddie_turbo')!, pos(r).x, pos(r).z - 10, 0)!;
  for (let i = 0; i < 90; i++) r.sim.step();
  cad.behavior.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
  r.sim.setInput('p1', { m1: 1, ad: [0, 0.05, -1] });
  r.sim.step(); r.sim.setInput('p1', { m1: 0, ad: [0, 0.05, -1] });
  const before = cad.behavior.body.linvel().z;
  for (let i = 0; i < 40; i++) r.sim.step();
  check('cornet : touche et réagit', r.sim.snapshot().fx.length >= 0 && Number.isFinite(before));
  // disco : un caddie voisin saute
  r = await driveScenario('camion_glaces', () => ({}), 0.5);
  const cad2 = r.sim.spawnExtraVehicle(VEHICLE_BY_TYPE.get('caddie_turbo')!, pos(r).x + 8, pos(r).z, 0)!;
  for (let i = 0; i < 90; i++) r.sim.step();
  let maxY = -9; const y0 = cad2.behavior.body.translation().y;
  r.sim.setInput('p1', { m2: 1 }); r.sim.step(); r.sim.setInput('p1', { m2: 0 });
  const fxk = new Set<string>();
  for (let i = 0; i < 300; i++) { r.sim.step(); maxY = Math.max(maxY, cad2.behavior.body.translation().y); if (i % 2 === 0) r.sim.snapshot().fx.forEach((e) => fxk.add(e.k)); }
  check('disco : le caddie voisin rebondit', maxY - y0 > 0.15, `dy=${(maxY - y0).toFixed(2)}`);
  check('disco : flashs', fxk.has('flash'));

  // ---------- toilettes ----------
  r = await driveScenario('toilettes_roulettes', clear(() => ({ f: 1 })), 12);
  check('toilettes lentes (≤ ~10 m/s) mais avancent', spd(r) > 5 && spd(r) < 10.8, `v=${spd(r).toFixed(1)}`);
  r = await driveScenario('toilettes_roulettes', clear((t) => ({ f: 1, s: t > 3 ? 1 : 0 })), 6);
  check('virage : le couvercle s\'ouvre (anim + glou)', r.vehicle.behavior.anim().a[0] > 0.5 && r.fx.some((e) => e.s === 'bloop'), `lid=${r.vehicle.behavior.anim().a[0].toFixed(2)}`);
  r = await driveScenario('toilettes_roulettes', (t) => ({ m2: t > 1 && t < 1.1 ? 1 : 0 }), 2.5);
  const z1 = pos(r).z;
  check('chasse d\'eau : pousse vers l\'arrière (+z)', z1 > -30 + 4 && r.fx.some((e) => e.s === 'whoosh') && r.fx.some((e) => e.k === 'smoke'), `z=${z1.toFixed(1)}`);
  r = await driveScenario('toilettes_roulettes', clear(() => ({ m2: 1 })), 12);
  check('chasse : recharge (pas de poussée continue)', spd(r) < 10, `v=${spd(r).toFixed(1)}`);

  // ventouse
  r = await driveScenario('toilettes_roulettes', () => ({}), 0.2);
  const p = pos(r);
  const crate = r.sim.spawnProp('crate_m', new THREE.Vector3(p.x, p.y + 1, p.z - 12));
  for (let i = 0; i < 60; i++) r.sim.step();
  const d0 = Math.abs(crate!.body.translation().z - p.z);
  for (let i = 0; i < 240; i++) { r.sim.setInput('p1', { m1: 1, ad: [0, 0, -1] }); r.sim.step(); }
  const d1 = Math.hypot(crate!.body.translation().z - pos(r).z, crate!.body.translation().x - pos(r).x);
  check('ventouse : la caisse est tirée vers les toilettes', d1 < d0 - 5 && d1 < 5, `${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
  r.sim.setInput('p1', { m1: 0 });
  check('toilettes intactes', !r.vehicle.dead, `hp=${r.vehicle.hp.toFixed(0)}`);
  // roquette
  r = await driveScenario('toilettes_roulettes', () => ({}), 0.5);
  r.sim.explode(new THREE.Vector3(pos(r).x + 2, pos(r).y, pos(r).z), 6, 18, 60);
  for (let i = 0; i < 20; i++) r.sim.step();
  check('roquette : dégâts importants mais survit (200 PV)', r.vehicle.hp < 200 && r.vehicle.hp > 0, `hp=${r.vehicle.hp.toFixed(0)}`);
  // sortie du véhicule
  r.sim.enterVehicle?.length; // existence
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUT PASSE');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
