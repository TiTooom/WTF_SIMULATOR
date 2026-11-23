// PROPRIÉTAIRE : game-camera-driving
// Suite « conduite » : sensation des 4 voitures dans la VRAIE ville (shared/city). Pas de serveur : Sim directement (aucun port, aucun fichier).
// Lancement : npx tsx tests/conduite.ts
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { getCity, CITY } from '../shared/city/layout';
import { lanesOf, nextLane, routeLanes, laneWaypoints, lanesFrom, nearestLane, turnKind } from '../shared/city/lanes';
import { steerTo, advanceWaypoint, newDriveMem } from '../shared/ai/drive';
import { ONFOOT, newRoll, startRoll, rollVelocity, rollDirection, rolling } from '../shared/onfoot';
import { AutoLock, computeAim, pickTarget } from '../src/aim';
import type { Input } from '../shared/protocol';
import type { SimPlayer, SimVehicle } from '../shared/api';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const city = getCity();
const { HALF, CELL } = CITY;

interface Rig { sim: Sim; player: SimPlayer; v: SimVehicle }
async function setup(type: string, x: number, z: number, yaw: number, speed = 0): Promise<Rig> {
  const sim = await Sim.create();
  sim.log = () => {};
  sim.addPlayer('p1', 'Testeur');
  const player = sim.players.get('p1')!;
  const v = sim.acquireVehicle(type, x, z, yaw)!;
  if (!v) throw new Error('véhicule introuvable : ' + type);
  for (let i = 0; i < 40; i++) sim.step();
  sim.enterVehicle(player, v, 0, true);
  if (speed) v.behavior.body.setLinvel({ x: -Math.sin(yaw) * speed, y: 0, z: -Math.cos(yaw) * speed }, true);
  return { sim, player, v };
}
const pose = (r: Rig) => {
  const b = r.v.behavior.body;
  const q = b.rotation(), t = b.translation(), lv = b.linvel();
  const yaw = 2 * Math.atan2(q.y, q.w);
  return { x: t.x, z: t.z, yaw, speed: lv.x * -Math.sin(yaw) + lv.z * -Math.cos(yaw), vx: lv.x, vz: lv.z, total: Math.hypot(lv.x, lv.z) };
};
const drive = (r: Rig, i: Partial<Input>) => { r.sim.setInput('p1', { ...i }); r.sim.step(); };
const nodeAt = (i: number, j: number) => city.nodes[j * (CITY.N + 1) + i];

async function vitesses() {
  const res: Record<string, number> = {};
  for (const [type, lo, hi] of [['citadine', 22, 26.5], ['berline', 25, 29.5], ['camionnette', 17, 21.5], ['police', 28, 32.5]] as const) {
    const r = await setup(type, -126, 300, 0); // axe x = 2 : voie nord de la rue centrale, 600 m de ligne droite
    let max = 0;
    for (let k = 0; k < 60 * 18; k++) { drive(r, { f: 1 }); max = Math.max(max, pose(r).total); if (pose(r).z < -312) break; }
    res[type] = max;
    check(`${type} : vitesse max ${lo}-${hi} m/s`, max >= lo && max <= hi, `${max.toFixed(1)} m/s`);
    check(`${type} : aucun dégât en ligne droite`, r.v.hp === r.v.def.maxHp, `${r.v.hp}/${r.v.def.maxHp}`);
    r.sim.dispose();
  }
  check('ordre des vitesses : camionnette < citadine < berline < police', res.camionnette < res.citadine && res.citadine < res.berline && res.berline < res.police);
}

async function rayon() {
  for (const [type, rmin, rmax] of [['citadine', 5, 12], ['berline', 5.5, 14], ['camionnette', 7, 17]] as const) {
    const r = await setup(type, -126, 200, 0, 12);
    for (let k = 0; k < 40; k++) drive(r, { f: 0.5 });
    const p0 = pose(r);
    const n = 40; // 0,67 s de braquage plein (une rue de 8 m + trottoirs suffit)
    for (let k = 0; k < n; k++) drive(r, { f: 0.5, s: 1 });
    const p1 = pose(r);
    const w = Math.abs(wrap(p1.yaw - p0.yaw)) / (n * STEP);
    const R = Math.abs(p1.speed) / w;
    check(`${type} : rayon de braquage ${rmin}-${rmax} m à ${p1.speed.toFixed(0)} m/s`, R >= rmin && R <= rmax, `R = ${R.toFixed(1)} m, lacet ${w.toFixed(2)} rad/s`);
    r.sim.dispose();
  }
  // à l'arrêt : pas de pivot sur place
  const r = await setup('citadine', -126, 200, 0);
  const y0 = pose(r).yaw;
  for (let k = 0; k < 120; k++) drive(r, { s: 1 });
  check('citadine : pas de pivot sur place', Math.abs(wrap(pose(r).yaw - y0)) < 0.1);
  r.sim.dispose();
}

/** Virage à 90° à `speed` m/s sur l'intersection `node` ; arrive du sud vers le nord dans la voie de droite (x+2). */
async function virage90(dir: 1 | -1, speed: number, type = 'citadine') {
  const node = nodeAt(5, 5); // (0, 0) : au coeur de la ville
  const r = await setup(type, node.x + 2, node.z + 60, 0, speed);
  const startZ = node.z + 2 + (dir === 1 ? 11 : 7); // droite : l'arc commence avant le carrefour ; gauche : plus tard
  let state = 0, yawStart = 0;
  let minSp = 99;
  for (let k = 0; k < 60 * 12; k++) {
    const p = pose(r);
    const input: Partial<Input> = { f: p.speed < speed ? 1 : 0.35 };
    if (state === 0 && p.z <= startZ) { state = 1; yawStart = p.yaw; }
    if (state === 1) {
      const turned = Math.abs(wrap(p.yaw - yawStart));
      if (turned < Math.PI / 2 - 0.2) input.s = dir; else state = 2;
    }
    if (state === 2) minSp = Math.min(minSp, p.speed);
    drive(r, input);
  }
  const p = pose(r);
  const want = dir === 1 ? -Math.PI / 2 : Math.PI / 2; // est / ouest
  const name = `${type} : virage ${dir === 1 ? 'à droite' : 'à gauche'} à ${speed} m/s`;
  check(`${name} : aucun contact (pv intacts)`, r.v.hp === r.v.def.maxHp, `${r.v.hp}/${r.v.def.maxHp}`);
  check(`${name} : cap final dans l'axe de la rue (±8°)`, Math.abs(wrap(p.yaw - want)) < 0.14, `écart ${(Math.abs(wrap(p.yaw - want)) * 57.3).toFixed(1)}°`);
  const lateral = Math.abs(p.z - (node.z + (dir === 1 ? 2 : -2)));
  check(`${name} : sur la chaussée d'arrivée (±5 m de la voie)`, lateral < 5 && Math.abs(p.x - node.x) > 20, `écart voie ${lateral.toFixed(1)} m, x=${p.x.toFixed(0)}`);
  check(`${name} : garde de la vitesse`, p.speed > speed * 0.5, `${p.speed.toFixed(1)} m/s`);
  r.sim.dispose();
}

async function freinAMain() {
  const run = async (hand: number) => {
    const r = await setup('citadine', -126, 250, 0, 18);
    for (let k = 0; k < 20; k++) drive(r, { f: 1 });
    let maxSlip = 0;
    for (let k = 0; k < 36; k++) {
      drive(r, { f: 1, s: 1, jump: hand });
      const p = pose(r);
      const vyaw = Math.atan2(-p.vx, -p.vz);
      if (p.total > 4) maxSlip = Math.max(maxSlip, Math.abs(wrap(vyaw - p.yaw)));
    }
    const hp = r.v.hp === r.v.def.maxHp;
    r.sim.dispose();
    return { maxSlip, hp };
  };
  const grip = await run(0);
  const drift = await run(1);
  check('braquage normal : adhérence forte (dérapage < 10°)', grip.maxSlip < 0.17, `${(grip.maxSlip * 57.3).toFixed(1)}°`);
  check('frein à main + braquage : la voiture dérape (> 20°)', drift.maxSlip > 0.35, `${(drift.maxSlip * 57.3).toFixed(1)}°`);
  check('frein à main : pas de dégât ni de retournement', drift.hp);
  // freine droit
  const r = await setup('citadine', -126, 250, 0, 22);
  for (let k = 0; k < 20; k++) drive(r, { f: 1 });
  const v1 = pose(r).total;
  for (let k = 0; k < 60; k++) drive(r, { jump: 1 });
  check('frein à main : ralentit fortement en 1 s', pose(r).total < v1 * 0.6, `${v1.toFixed(1)} -> ${pose(r).total.toFixed(1)}`);
  r.sim.dispose();
}

async function aide() {
  // sans braquage, un léger écart de cap par rapport à la rue se résorbe ; avec braquage actif, l'aide ne s'applique pas
  const run = async (s: number) => {
    const r = await setup('citadine', -126, 250, 0.2, 15);
    for (let k = 0; k < 90; k++) drive(r, { f: 0.6, s });
    const e = Math.abs(wrap(pose(r).yaw));
    r.sim.dispose();
    return e;
  };
  const e0 = await run(0);
  check('aide directionnelle : recale un écart de 11° sans braquage', e0 < 0.08, `reste ${(e0 * 57.3).toFixed(1)}°`);
  const e1 = await run(0.3);
  check('aide directionnelle : inactive pendant un braquage', e1 > 0.5, `${(e1 * 57.3).toFixed(0)}°`);
}

function voies() {
  const lanes = lanesOf(city);
  check('voies : 2 par tronçon', lanes.length === city.edges.length * 2, `${lanes.length}`);
  const ok = lanes.every((l) => {
    const dx = l.x1 - l.x0, dz = l.z1 - l.z0;
    return Math.abs(Math.hypot(dx, dz) - CELL) < 1e-6 && Math.abs(wrap(Math.atan2(-dx, -dz) - l.yaw)) < 1e-6;
  });
  check('voies : cap = sens de la voie, longueur d\'un tronçon', ok);
  const spawns = city.pois.filter((p) => p.kind === 'spawn' && p.tag === 'car');
  const onRight = spawns.every((p) => { const n = nearestLane(city, p.x, p.z, 3); return !!n && n.dist < 0.01 && Math.abs(wrap(n.lane.yaw - p.yaw)) < 1e-6; });
  check('voies : les voitures de départ sont dans la voie de droite', onRight);
  let dead = 0, uturn = 0, links = 0;
  for (const l of lanes) {
    for (let k = 0; k < 4; k++) {
      const nx = nextLane(city, l, k / 4 + 0.01);
      if (!nx) { dead++; continue; }
      links++;
      if (nx.from !== l.to || nx.to === l.from) uturn++;
    }
  }
  check('voies : nextLane continu, jamais de demi-tour, jamais d\'impasse', dead === 0 && uturn === 0, `${links} liaisons`);
  const l0 = lanes.find((l) => l.from === nodeAt(5, 5).id && l.yaw === 0)!;
  const kinds = new Set([0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98].map((r) => { const n = nextLane(city, l0, r); return n ? turnKind(l0, n) : 'x'; }));
  check('voies : tout droit / droite / gauche selon rnd', kinds.size === 3, [...kinds].join(','));
  check('voies : sortants de chaque nœud', lanesFrom(city, nodeAt(5, 5).id).length === 4);
}

async function steerToTests() {
  const cases: [string, [number, number], [number, number]][] = [
    ['202 m, un virage', [2, 3], [5, 4]],
    ['231 m, plusieurs virages', [6, 2], [4, 5]],
    ['bord à bord', [0, 0], [1, 2]],
  ];
  for (const [label, [i0, j0], [i1, j1]] of cases) {
    const a = nodeAt(i0, j0), b = nodeAt(i1, j1);
    const route = routeLanes(city, a.id, b.id)!;
    const wps = laneWaypoints(route);
    const first = route[0];
    const straight = Math.hypot(b.x - a.x, b.z - a.z);
    const r = await setup('citadine', first.x0 + (first.x1 - first.x0) * 0.04, first.z0 + (first.z1 - first.z0) * 0.04, first.yaw);
    const mem = newDriveMem();
    let idx = 0, t = 0, arrived = false;
    const end = wps[wps.length - 1];
    for (let k = 0; k < 60 * 70; k++) {
      const p = pose(r);
      idx = advanceWaypoint(p, wps, idx);
      const last = idx === wps.length - 1;
      const inp = steerTo(p, wps[idx], { maxSpeed: 15, arriveRadius: last ? 3 : 0.5, mem, dt: STEP, brakeFor: Infinity });
      drive(r, inp);
      t = k * STEP;
      if (Math.hypot(p.x - end.x, p.z - end.z) < 5 && last) { arrived = true; break; }
    }
    check(`steerTo ${label} (${straight.toFixed(0)} m à vol d'oiseau, ${route.length} tronçons) : arrive`, arrived, `${t.toFixed(1)} s`);
    check(`steerTo ${label} : sans dégât`, r.v.hp === r.v.def.maxHp, `${r.v.hp}/${r.v.def.maxHp}`);
    r.sim.dispose();
  }
  // Coincé contre le mur de bordure : marche arrière puis repart
  {
    const r = await setup('citadine', 2, -HALF - 5 + 3, 0); // nez au mur nord (z = -330)
    const target = { x: 2, z: -HALF + 40 };
    const mem = newDriveMem();
    let reached = false, sawReverse = false;
    for (let k = 0; k < 60 * 30; k++) {
      const p = pose(r);
      if (Math.hypot(p.x - target.x, p.z - target.z) < 6) { reached = true; break; }
      if (p.speed < -1) sawReverse = true;
      drive(r, steerTo(p, target, { maxSpeed: 12, mem, dt: STEP }));
    }
    check('steerTo : nez au mur, rejoint la cible derrière lui', reached, `recul ${sawReverse}`);
    r.sim.dispose();
  }
  // Coincé (logique pure) : voulait avancer à l'arrêt pendant > 1,2 s -> marche arrière
  {
    const mem = newDriveMem();
    let rev = false;
    for (let k = 0; k < 60; k++) { const o = steerTo({ x: 0, z: 0, yaw: 0, speed: 0 }, { x: 0, z: -50 }, { maxSpeed: 12, mem, dt: 0.05 }); if ((o.f ?? 0) < 0) rev = true; }
    check('steerTo : immobile alors qu il veut avancer -> marche arrière', rev);
  }
  // Freinage anticipé : s'arrête sur la cible sans la dépasser de plus de quelques mètres
  {
    const r = await setup('citadine', -126, 250, 0, 25);
    const target = { x: -126, z: 100 };
    let minZ = 1e9;
    for (let k = 0; k < 60 * 25; k++) {
      const p = pose(r);
      minZ = Math.min(minZ, p.z);
      drive(r, steerTo(p, target, { maxSpeed: 25, dt: STEP }));
    }
    const p = pose(r);
    check('steerTo : freinage anticipé, arrêt sur la cible', Math.hypot(p.x - target.x, p.z - target.z) < 8 && Math.abs(p.speed) < 2 && minZ > target.z - 8, `z=${p.z.toFixed(1)}, dépassement max ${(target.z - minZ).toFixed(1)} m`);
    r.sim.dispose();
  }
  // Obstacle devant : ralentit
  const f = steerTo({ x: 0, z: 0, yaw: 0, speed: 20 }, { x: 0, z: -200 }, { maxSpeed: 25, brakeFor: 12 });
  check('steerTo : obstacle à 12 m à 20 m/s -> freine', (f.f ?? 0) < 0);
  check('steerTo : cible dans l\'axe -> pas de braquage', Math.abs(f.s ?? 1) < 0.01);
}

function aPied() {
  const r = newRoll();
  const [dx, dz] = rollDirection(0, 0, 0);
  check('roulade : sans entrée, droit devant (nord pour lacet 0)', Math.abs(dx) < 1e-9 && dz === -1);
  const [ex, ez] = rollDirection(0, 1, 0);
  check('roulade : s=+1 -> vers l\'est (lacet 0)', Math.abs(ex - 1) < 1e-9 && Math.abs(ez) < 1e-9);
  const [fx, fz] = rollDirection(1, 0, Math.PI / 2); // lacet 90° : l'avant est l'ouest
  check('roulade : suit le cap', Math.abs(fx + 1) < 1e-9 && Math.abs(fz) < 1e-9);
  check('roulade : démarre', startRoll(r, 1000, 1, 0, 0) && rolling(r, 1100));
  const v0 = rollVelocity(r, 1000)!, v1 = rollVelocity(r, 1000 + ONFOOT.rollMs - 10)!;
  check('roulade : plus rapide que la course, ralentit en fin', Math.hypot(...v0) > ONFOOT.run && Math.hypot(...v1) < Math.hypot(...v0));
  check('roulade : délai de récupération', !startRoll(r, 1000 + ONFOOT.rollMs + 10, 1, 0, 0) && startRoll(r, 1000 + ONFOOT.rollCooldownMs + 1, 1, 0, 0));
  check('roulade : terminée -> plus de vitesse imposée', rollVelocity(r, 5000) === null);
}

function visee() {
  const T = (id: number, x: number, z: number) => ({ id, pos: [x, 0, z] as [number, number, number] });
  const near = T(1, 0, -8), far = T(2, 0, -20), behind = T(3, 0, 3), out = T(4, 0, -60);
  const p = pickTarget([0, 0, 0], 0, [far, behind, near, out]);
  check('verrouillage : la cible la plus proche dans le cône et la portée', p?.id === 1);
  check('verrouillage : rien derrière / hors portée', pickTarget([0, 0, 0], 0, [behind, out]) === null);
  const lock = new AutoLock();
  lock.update([0, 0, 0], 0, [near, far]);
  const stay = lock.update([0, 0, 0], 0, [near, T(5, 3, -7.5)]);
  check('verrouillage : hystérésis (ne saute pas pour une cible à peine plus proche)', stay?.id === 1);
  const sw = lock.update([0, 0, 0], 0, [near, T(6, 1, -3)]);
  check('verrouillage : bascule sur une cible nettement plus proche', sw?.id === 6);
  check('verrouillage : désactivé = aucune cible', lock.update([0, 0, 0], 0, [near], false) === null);
  const a = computeAim([0, 0, 0], 0, [0, 1, -10]);
  check('visée : dir unitaire vers la cible, lockedOn', a.lockedOn && Math.abs(Math.hypot(...a.dir) - 1) < 1e-9 && a.dir[2] < -0.99);
}

async function main() {
  voies();
  await vitesses();
  await rayon();
  await virage90(1, 15);
  await virage90(-1, 15);
  await virage90(1, 15, 'berline');
  await virage90(1, 10, 'camionnette');
  await freinAMain();
  await aide();
  await steerToTests();
  aPied();
  visee();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
