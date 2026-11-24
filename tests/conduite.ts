// PROPRIÉTAIRE : game-camera-driving
// Suite « conduite » : sensation des 4 voitures dans la VRAIE ville (shared/city). Pas de serveur : Sim directement (aucun port, aucun fichier).
// Lancement : npx tsx tests/conduite.ts
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { getCity, CITY } from '../shared/city/layout';
import { lanesOf, nextLane, routeLanes, laneWaypoints, lanesFrom, nearestLane, turnKind } from '../shared/city/lanes';
import { steerTo, advanceWaypoint, newDriveMem } from '../shared/ai/drive';
import { ONFOOT, FOOT, newRoll, startRoll, rollVelocity, rollDirection, rolling, wishVelocity, approachVelocity, turnToward } from '../shared/onfoot';
import { AutoLock, AIM_DEFAULTS, computeAim, pickTarget } from '../src/aim';
import { CameraRig } from '../src/camera';
import * as THREE from 'three';
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

// ======================================================================================================================
// RESSENTI : mesures chiffrées par voiture (temps 0-90 %, freinage, rayon, marche arrière, dérapage, frottement de mur, ville de 640 m)
// ======================================================================================================================
const FEEL: Record<string, { t90: [number, number]; brake18: [number, number]; r10: [number, number]; rev: [number, number] }> = {
  citadine: { t90: [2.5, 3.5], brake18: [7.5, 11], r10: [5, 7.5], rev: [6, 10] },
  berline: { t90: [3.4, 4.6], brake18: [8.5, 12.5], r10: [5.5, 8.5], rev: [6.5, 11] },
  camionnette: { t90: [3.9, 5.3], brake18: [11, 16], r10: [7, 10.5], rev: [4.5, 8] },
  police: { t90: [2.9, 4.0], brake18: [7, 10.5], r10: [5.5, 8.5], rev: [7, 11.5] },
};
async function ressenti() {
  const out: Record<string, Record<string, number>> = {};
  for (const type of Object.keys(FEEL)) {
    const F = FEEL[type], m: Record<string, number> = {};
    // accélération pleine : 0-60 %, 0-90 %, 0-98 % de la vitesse de pointe, 600 m de ligne droite
    let r = await setup(type, -126, 300, 0);
    let vm = 0; const series: number[] = [];
    for (let k = 0; k < 60 * 40; k++) { drive(r, { f: 1 }); const t = pose(r).total; series.push(t); vm = Math.max(vm, t); if (pose(r).z < -312) break; }
    const timeTo = (frac: number) => { const i = series.findIndex((v) => v >= frac * vm); return i < 0 ? Infinity : (i + 1) * STEP; };
    m.vmax = vm; m.t60 = timeTo(0.6); m.t90 = timeTo(0.9); m.t98 = timeTo(0.98); m.run600 = series.length * STEP;
    r.sim.dispose();
    // freinage franc (f = -1) depuis 18 m/s
    r = await setup(type, -126, 300, 0, 18);
    const z0 = pose(r).z;
    for (let k = 0; k < 400; k++) { drive(r, { f: -1 }); if (pose(r).total < 0.3) break; }
    m.brake18 = z0 - pose(r).z;
    r.sim.dispose();
    // rayon de braquage à 10 m/s (vitesse tenue par le gaz)
    r = await setup(type, -126, 200, 0, 10);
    for (let k = 0; k < 40; k++) drive(r, { f: 0.4 });
    const p0 = pose(r);
    for (let k = 0; k < 40; k++) drive(r, { f: 0.4, s: 1 });
    const p1 = pose(r);
    m.r10 = Math.abs(p1.speed) / (Math.abs(wrap(p1.yaw - p0.yaw)) / (40 * STEP));
    r.sim.dispose();
    // marche arrière
    r = await setup(type, -126, 250, 0);
    let rev = 0; for (let k = 0; k < 600; k++) { drive(r, { f: -1 }); rev = Math.max(rev, -pose(r).speed); }
    m.rev = rev;
    r.sim.dispose();
    // dérapage : 18 m/s, frein à main + braquage 0,67 s, puis on relâche 1 s
    r = await setup(type, -126, 250, 0, 18);
    for (let k = 0; k < 20; k++) drive(r, { f: 1 });
    const s0 = pose(r).total; let slip = 0;
    for (let k = 0; k < 40; k++) { drive(r, { f: 1, s: 1, jump: 1 }); const p = pose(r); if (p.total > 4) slip = Math.max(slip, Math.abs(wrap(Math.atan2(-p.vx, -p.vz) - p.yaw))); }
    m.slip = slip; m.keep = pose(r).total / s0;
    for (let k = 0; k < 60; k++) drive(r, { f: 1 });
    const pr = pose(r); m.rec = Math.abs(wrap(Math.atan2(-pr.vx, -pr.vz) - pr.yaw));
    r.sim.dispose();
    // choc de plein fouet contre le mur nord : arrêt, pas de rebond
    r = await setup(type, 2, -250, 0, 20);
    for (let k = 0; k < 400 && pose(r).z > -325; k++) drive(r, { f: 1 });
    for (let k = 0; k < 40; k++) drive(r, { f: 1 });
    m.headOn = pose(r).total;
    r.sim.dispose();
    // frottement : voiture en travers du mur nord (~40° d'incidence), on garde de l'élan et on repart le long du mur
    r = await setup(type, -100, -314, -Math.PI / 2 + 0.7, 20);
    let before = 0, hit = false;
    for (let k = 0; k < 300; k++) { drive(r, { f: 1 }); if (pose(r).z < -324.5) { before = pose(r).total; hit = true; for (let j = 0; j < 45; j++) drive(r, { f: 1 }); break; } }
    m.scrape = hit ? pose(r).total / before : 0; m.scrapeYaw = Math.abs(wrap(pose(r).yaw + Math.PI / 2));
    r.sim.dispose();
    out[type] = m;
    console.log(`  # ${type.padEnd(11)} vmax ${vm.toFixed(1)} | 0-60% ${m.t60.toFixed(2)} s 0-90% ${m.t90.toFixed(2)} s 0-98% ${m.t98.toFixed(2)} s | frein 18 m/s ${m.brake18.toFixed(1)} m | R(10 m/s) ${m.r10.toFixed(1)} m | arrière ${m.rev.toFixed(1)} m/s | dérapage ${(m.slip * 57.3).toFixed(0)}° garde ${(m.keep * 100).toFixed(0)} % sortie ${(m.rec * 57.3).toFixed(0)}° | mur frontal ${m.headOn.toFixed(1)} m/s, frottement ${(m.scrape * 100).toFixed(0)} % cap ±${(m.scrapeYaw * 57.3).toFixed(0)}°`);
    const rng = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;
    check(`${type} : 0-90 % en ${F.t90[0]}-${F.t90[1]} s`, rng(m.t90, F.t90), `${m.t90.toFixed(2)} s`);
    check(`${type} : atteint 98 % de sa pointe en < 8 s (la pointe est réellement atteinte)`, m.t98 < 8, `${m.t98.toFixed(2)} s`);
    check(`${type} : freinage franc depuis 18 m/s en ${F.brake18[0]}-${F.brake18[1]} m`, rng(m.brake18, F.brake18), `${m.brake18.toFixed(1)} m`);
    check(`${type} : rayon à 10 m/s en ${F.r10[0]}-${F.r10[1]} m`, rng(m.r10, F.r10), `${m.r10.toFixed(1)} m`);
    check(`${type} : marche arrière ${F.rev[0]}-${F.rev[1]} m/s (≈ 1/3 de la pointe)`, rng(m.rev, F.rev), `${m.rev.toFixed(1)} m/s`);
    check(`${type} : dérapage lisible (20-50° d'angle, jamais de toupie)`, m.slip > 0.35 && m.slip < 0.87, `${(m.slip * 57.3).toFixed(0)}°`);
    check(`${type} : le dérapage garde l'élan (>= 75 % de la vitesse)`, m.keep >= 0.75, `${(m.keep * 100).toFixed(0)} %`);
    check(`${type} : sortie de dérapage : cap rattrapé en 1 s (< 26°)`, m.rec < 0.45, `${(m.rec * 57.3).toFixed(0)}°`);
    check(`${type} : choc de plein fouet : arrêt sans rebond`, m.headOn < 1, `${m.headOn.toFixed(1)} m/s`);
    check(`${type} : frottement contre un mur : garde >= 60 % de la vitesse et se range le long du mur (±20°)`, m.scrape >= 0.6 && m.scrapeYaw < 0.35, `${(m.scrape * 100).toFixed(0)} %, ±${(m.scrapeYaw * 57.3).toFixed(0)}°`);
  }
  check('0-90 % : citadine la plus vive, camionnette la plus lente', out.citadine.t90 < out.police.t90 && out.police.t90 < out.berline.t90 && out.berline.t90 < out.camionnette.t90);
  check('rayon : camionnette > berline > citadine', out.camionnette.r10 > out.berline.r10 && out.berline.r10 > out.citadine.r10);
  check('freinage : camionnette freine plus long que la citadine', out.camionnette.brake18 > out.citadine.brake18 * 1.3);
  check('dérapage : la citadine glisse plus que la camionnette', out.citadine.slip > out.camionnette.slip);
  // ville de 640 m : 600 m de ligne droite en 22-34 s pour la citadine, la police traverse plus vite
  check('ville de 640 m : traversée en ligne droite citadine 22-34 s', out.citadine.run600 >= 22 && out.citadine.run600 <= 34, `${out.citadine.run600.toFixed(1)} s`);
  check('ville de 640 m : la police traverse en moins de 24 s et plus vite que la citadine', out.police.run600 < 24 && out.police.run600 < out.citadine.run600, `${out.police.run600.toFixed(1)} s`);
  // un bloc de 64 m à l'arrêt : ni trop long ni trop court
  const r = await setup('citadine', -126, 300, 0);
  let tBlock = 0;
  for (let k = 0; k < 60 * 15; k++) { drive(r, { f: 1 }); if (300 - pose(r).z >= 64) { tBlock = (k + 1) * STEP; break; } }
  check('un bloc de 64 m départ arrêté : 3,5 à 7 s (citadine)', tBlock > 3.5 && tBlock < 7, `${tBlock.toFixed(2)} s`);
  r.sim.dispose();
}

// ======================================================================================================================
// CAMÉRA (CameraRig) : avance, zoom selon la vitesse, pas de tremblement, entrée au volant, téléportation
// ======================================================================================================================
function camera() {
  const mk = () => new CameraRig(new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 400));
  const qy = (yaw: number): [number, number, number, number] => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const dt = 1 / 60;
  const veh = (sp: number, yaw = 0) => ({ q: qy(yaw), sp, camDistance: 9, vmax: 25 }); // 9 m : distance typique d'une vue de voiture
  const fr = mk(); fr.zoom = 1;
  for (let i = 0; i < 120; i++) fr.update(dt, { pos: [0, 1, 0] });
  const foot = { lead: fr.lead, dist: fr.distance, pitch: fr.pitchDeg };
  const at = (sp: number) => {
    const c = mk(); c.zoom = 1; let z = 0;
    for (let i = 0; i < 360; i++) { z -= sp * dt; c.update(dt, { pos: [0, 0.7, z], veh: veh(sp) }); }
    // retard du ressort : la voiture est `z - focusZ` devant le point suivi ; le point regardé est `lead` devant lui
    return { lead: c.lead, dist: c.distance, pitch: c.pitchDeg, offCentre: Math.abs(c.lead - (c.focusZ - z)) };
  };
  const s0 = at(0), s10 = at(10), s25 = at(25);
  console.log(`  # caméra : à pied ${foot.dist.toFixed(1)} m ${foot.pitch.toFixed(0)}° | arrêtée avance ${s0.lead.toFixed(1)} m, dist ${s0.dist.toFixed(1)} m ${s0.pitch.toFixed(0)}° | 10 m/s avance ${s10.lead.toFixed(1)} m, dist ${s10.dist.toFixed(1)} m ${s10.pitch.toFixed(0)}° | 25 m/s avance ${s25.lead.toFixed(1)} m, dist ${s25.dist.toFixed(1)} m ${s25.pitch.toFixed(0)}°, voiture à ${s25.offCentre.toFixed(1)} m du centre`);
  check('caméra : pas d\'avance à pied ni à l\'arrêt', foot.lead < 0.05 && s0.lead < 0.05);
  check('caméra : l\'avance croît avec la vitesse (4-8 m à 10 m/s, 12-15 m à 25 m/s)', s10.lead > 4 && s10.lead < 8 && s25.lead > 12 && s25.lead <= 15.01, `${s10.lead.toFixed(1)} / ${s25.lead.toFixed(1)} m`);
  check('caméra : plus proche à pied, plus loin à haute vitesse', foot.dist < s0.dist && s0.dist < s10.dist && s10.dist < s25.dist, `${foot.dist.toFixed(1)} < ${s0.dist.toFixed(1)} < ${s10.dist.toFixed(1)} < ${s25.dist.toFixed(1)}`);
  check('caméra : inclinaison 50-65°, plus rasante à haute vitesse', foot.pitch <= 65 && s25.pitch >= 50 && s25.pitch < s0.pitch, `${foot.pitch.toFixed(0)}° / ${s0.pitch.toFixed(0)}° / ${s25.pitch.toFixed(0)}°`);
  check('caméra : la voiture reste à l\'écran à 25 m/s (< 12 m du point regardé)', s25.offCentre < 12, `${s25.offCentre.toFixed(1)} m`);
  // tremblement : lacet interpolé à 30 Hz bruité (±0,6° d'un snapshot à l'autre) en ligne droite
  const lcg = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5; })();
  const jit = mk(); jit.zoom = 1;
  let yawA = 0, yawB = 0, z = 0, minY = 1e9, maxY = -1e9, legacy = 0, legMin = 1e9, legMax = -1e9, lastYaw = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 2 === 0) { yawA = yawB; yawB = lcg() * 0.021; }
    const yaw = yawA + (yawB - yawA) * ((i % 2) / 2);
    z -= 20 * dt;
    jit.update(dt, { pos: [0, 0.7, z], veh: veh(20, yaw) });
    if (i > 120) { minY = Math.min(minY, jit.yaw); maxY = Math.max(maxY, jit.yaw); }
    const raw = Math.max(-0.26, Math.min(0.26, ((yaw - lastYaw) / dt) * 0.2)); lastYaw = yaw; // ancienne formule : lacet brut
    legacy += (raw - legacy) * (1 - Math.exp(-4 * dt));
    if (i > 120) { legMin = Math.min(legMin, legacy); legMax = Math.max(legMax, legacy); }
  }
  console.log(`  # tremblement du pivot en ligne droite (bruit ±0,6°) : avant ${((legMax - legMin) * 57.3).toFixed(1)}° crête à crête, après ${((maxY - minY) * 57.3).toFixed(2)}°`);
  check('caméra : lacet bruité en ligne droite -> pivot stable (< 0,6° crête à crête)', (maxY - minY) * 57.3 < 0.6, `${((maxY - minY) * 57.3).toFixed(2)}°`);
  // virage soutenu : le pivot se penche (jusqu'à ±15°) dans le bon sens
  const tr = mk(); let yaw = 0, tz = 0;
  for (let i = 0; i < 180; i++) { yaw += 1.5 * dt; tz -= 15 * dt; tr.update(dt, { pos: [0, 0.7, tz], veh: veh(15, yaw) }); }
  check('caméra : virage à gauche soutenu -> pivot positif, <= 15°', tr.yaw > 0.1 && tr.yaw <= 0.2618, `${(tr.yaw * 57.3).toFixed(1)}°`);
  // montée au volant : cap de la voiture quelconque, pas de coup de pivot
  const en = mk(); en.lastVehYaw = 2.9;
  for (let i = 0; i < 30; i++) en.update(dt, { pos: [0, 1, 0] });
  en.onEnterVehicle();
  let maxLean = 0;
  for (let i = 0; i < 60; i++) { en.update(dt, { pos: [0, 0.7, 0], veh: veh(0, 0.4) }); maxLean = Math.max(maxLean, Math.abs(en.yaw)); }
  check('caméra : entrée dans un véhicule sans coup de pivot', maxLean < 0.01, `${(maxLean * 57.3).toFixed(2)}°`);
  // téléportation de 30 m, 200 m : saute tout de suite, sans avance résiduelle
  for (const jump of [30, 200]) {
    const t = mk(); let z2 = 0;
    for (let i = 0; i < 240; i++) { z2 -= 25 * dt; t.update(dt, { pos: [0, 0.7, z2], veh: veh(25) }); }
    z2 -= jump; t.update(dt, { pos: [0, 0.7, z2], veh: veh(25) });
    const err = Math.abs(t.focusZ - z2);
    check(`caméra : téléportation de ${jump} m -> la caméra saute sur la cible dès l'image suivante`, err < 0.5, `écart ${err.toFixed(2)} m`);
    check(`caméra : téléportation de ${jump} m -> l'avance de l'ancien endroit est effacée`, t.lead < 1, `avance ${t.lead.toFixed(2)} m`);
  }
  const t2 = mk(); for (let i = 0; i < 60; i++) t2.update(dt, { pos: [0, 1, 0] });
  t2.teleported(); t2.update(dt, { pos: [10, 1, 10] });
  check('caméra : teleported() saute même sous le seuil', Math.hypot(t2.focusX - 10, t2.focusZ - 10) < 0.5);
  // ---- Réaction aux commandes ----
  const ft = (opt: { intent?: { x: number; z: number }; cursor?: { x: number; y: number } }, n = 180) => {
    const c = mk(); c.zoom = 1; let x = 0, maxStep = 0, last = 0, flips = 0, lastD = 0;
    for (let i = 0; i < n; i++) {
      if (opt.intent) x += opt.intent.x * 5 * dt;
      c.update(dt, { pos: [x, 1, 0], ...opt });
      const d = c.panX - last; last = c.panX; maxStep = Math.max(maxStep, Math.abs(d));
      if (i > 5 && d * lastD < -1e-9) flips++; lastD = d;
    }
    return { c, maxStep, flips };
  };
  const still = ft({}), run = ft({ intent: { x: 1, z: 0 } }), up = ft({ intent: { x: 0, z: -1 } });
  console.log(`  # caméra à pied : repos pan ${still.c.panX.toFixed(2)} m | course vers +x pan ${run.c.panX.toFixed(2)} m | vers le haut pan z ${up.c.panZ.toFixed(2)} m`);
  check('caméra à pied : aucun décalage sans commande', Math.hypot(still.c.panX, still.c.panZ) < 0.01);
  check('caméra à pied : décalage dans le sens du déplacement, borné', run.c.panX > 2.5 && run.c.panX < 5 && Math.abs(up.c.panZ + run.c.panX) < 1.2 && up.c.panZ < -2.5);
  check('caméra à pied : convergence monotone, sans oscillation', run.flips === 0 && up.flips === 0);
  const cur = ft({ cursor: { x: 1, y: 0 } }), curFar = ft({ cursor: { x: 1, y: 1 } }), dz = ft({ cursor: { x: 0.08, y: -0.05 } });
  console.log(`  # curseur au bord droit : ${cur.c.panX.toFixed(2)} m, coin : ${Math.hypot(curFar.c.panX, curFar.c.panZ).toFixed(2)} m`);
  check('caméra à pied : curseur au bord -> décalage vers lui (> 1 m, <= 8 m)', cur.c.panX > 1 && Math.hypot(curFar.c.panX, curFar.c.panZ) <= 8.01 && curFar.c.panZ < 0);
  check('caméra à pied : zone morte du curseur au repos', Math.hypot(dz.c.panX, dz.c.panZ) < 0.01);
  check('caméra à pied : pas de dérive du décalage (stable après 3 s puis 6 s)', Math.abs(ft({ cursor: { x: 1, y: 0 } }, 180).c.panX - ft({ cursor: { x: 1, y: 0 } }, 360).c.panX) < 0.01);
  // pas de saut au changement véhicule <-> à pied et à la téléportation
  const sw = mk(); sw.zoom = 1;
  for (let i = 0; i < 120; i++) sw.update(dt, { pos: [0, 1, 0], intent: { x: 1, z: 0 }, cursor: { x: 1, y: 0 } });
  let prevP = sw.camera.position.clone(), jump = 0;
  sw.onEnterVehicle();
  for (let i = 0; i < 120; i++) { sw.update(dt, { pos: [0, 0.7, 0], veh: veh(0) }); jump = Math.max(jump, sw.camera.position.distanceTo(prevP)); prevP = sw.camera.position.clone(); }
  for (let i = 0; i < 120; i++) { sw.update(dt, { pos: [0, 1, 0], intent: { x: 1, z: 0 } }); jump = Math.max(jump, sw.camera.position.distanceTo(prevP)); prevP = sw.camera.position.clone(); }
  check('caméra : pas de saut en montant/descendant du véhicule (< 0,25 m par image)', jump < 0.25, `${jump.toFixed(3)} m`);
  const tp = mk(); for (let i = 0; i < 120; i++) tp.update(dt, { pos: [0, 1, 0], intent: { x: 1, z: 0 }, cursor: { x: 1, y: 0 } });
  tp.teleported(); tp.update(dt, { pos: [5, 1, 5] });
  check('caméra : teleported() efface le décalage à pied', Math.hypot(tp.panX, tp.panZ) < 0.01);
  // véhicule : volant instantané, gaz/frein, frein à main, marche arrière
  const drv = (ctl: { f: number; s: number; hb?: number }, sp = 15, n = 20, yaw = 0) => {
    const c = mk(); c.zoom = 1; let z = 0;
    for (let i = 0; i < 90; i++) { z -= sp * dt; c.update(dt, { pos: [0, 0.7, z], veh: { ...veh(sp, yaw), ctl: { f: 0, s: 0 } } }); }
    const d0 = c.distance;
    for (let i = 0; i < n; i++) { z -= sp * dt; c.update(dt, { pos: [0, 0.7, z], veh: { ...veh(sp, yaw), ctl: ctl } }); }
    return { c, d0 };
  };
  const sl = drv({ f: 0, s: -1 }), sr = drv({ f: 0, s: 1 }), s0b = drv({ f: 0, s: 0 });
  console.log(`  # volant à gauche 1/3 s (cap encore droit) : pivot ${(sl.c.yaw * 57.3).toFixed(1)}° ; droite ${(sr.c.yaw * 57.3).toFixed(1)}° ; neutre ${(s0b.c.yaw * 57.3).toFixed(1)}°`);
  check('caméra : le volant penche la caméra avant que la voiture ne tourne (bon sens, <= 15°)', sl.c.yaw > 0.03 && sr.c.yaw < -0.03 && Math.abs(s0b.c.yaw) < 0.005 && Math.abs(sl.c.yaw) <= 0.2619);
  const gas = drv({ f: 1, s: 0 }, 8, 120), brk = drv({ f: -1, s: 0 }, 8, 120);
  console.log(`  # zoom à 8 m/s : neutre ${s0b.d0.toFixed(1)} m, gaz ${gas.c.distance.toFixed(1)} m, frein ${brk.c.distance.toFixed(1)} m`);
  check('caméra : zoom out au gaz, zoom in au freinage (< 8 %)', gas.c.distance > gas.d0 + 0.2 && brk.c.distance < brk.d0 - 0.2 && gas.c.distance / gas.d0 < 1.08 && brk.c.distance / brk.d0 > 0.92);
  const hb = drv({ f: 0, s: -1, hb: 1 }, 18, 40), nohb = drv({ f: 0, s: -1 }, 18, 40);
  check('caméra : frein à main en virage -> pivot plus marqué, toujours <= 15°', hb.c.yaw > nohb.c.yaw && hb.c.yaw <= 0.2619, `${(hb.c.yaw * 57.3).toFixed(1)}° vs ${(nohb.c.yaw * 57.3).toFixed(1)}°`);
  // dérapage : cap vers +z (voiture qui regarde -z) mais mouvement vers +x -> l'avance penche vers +x
  const gl = mk(); gl.zoom = 1; let gx = 0;
  for (let i = 0; i < 180; i++) { gx += 15 * dt; gl.update(dt, { pos: [gx, 0.7, 0], veh: veh(15, 0) }); }
  check('caméra : glissade -> l\'avance suit la direction réelle du mouvement', gl.panX > 3, `panX ${gl.panX.toFixed(1)} m`);
  // marche arrière : l'avance est derrière la voiture
  const rv = mk(); rv.zoom = 1; let rz = 0;
  for (let i = 0; i < 240; i++) { rz += 5 * dt; rv.update(dt, { pos: [0, 0.7, rz], veh: veh(-5, 0) }); }
  check('caméra : marche arrière -> avance vers l\'arrière (+z), pas d\'inversion de lacet', rv.panZ > 1.5 && Math.abs(rv.yaw) < 0.01, `panZ ${rv.panZ.toFixed(1)} m`);
  const nn = mk(); nn.update(NaN, { pos: [0, 1, 0] }); nn.update(5, { pos: [1, 1, 1] });
  check('caméra : dt invalide sans NaN', Number.isFinite(nn.camera.position.x + nn.camera.position.y + nn.camera.position.z));
}

function aPiedRessenti() {
  const dt = 1 / 60;
  let v: [number, number] = [0, 0]; const want = wishVelocity(1, 0, 0, false);
  let t = 0; while (Math.hypot(...v) < 0.9 * ONFOOT.walk && t < 2) { v = approachVelocity(v, want, dt); t += dt; }
  const tWalk = t;
  v = [0, 0]; const wr = wishVelocity(1, 0, 0, true); t = 0; while (Math.hypot(...v) < 0.9 * ONFOOT.run && t < 2) { v = approachVelocity(v, wr, dt); t += dt; }
  const tRun = t;
  t = 0; while (Math.hypot(...v) > 0.3 && t < 2) { v = approachVelocity(v, [0, 0], dt); t += dt; }
  const tStop = t;
  v = [0, -ONFOOT.run]; t = 0; const back = wishVelocity(-1, 0, 0, true); while (v[1] < 0.9 * ONFOOT.run && t < 2) { v = approachVelocity(v, back, dt); t += dt; }
  const tTurn = t;
  console.log(`  # à pied : 90 % de la marche en ${tWalk.toFixed(2)} s, de la course en ${tRun.toFixed(2)} s, arrêt en ${tStop.toFixed(2)} s, demi-tour en course ${tTurn.toFixed(2)} s (avant : tout instantané)`);
  check('à pied : marche à 90 % en 0,06-0,2 s (vif, pas instantané)', tWalk >= 0.06 && tWalk <= 0.2, `${tWalk.toFixed(2)} s`);
  check('à pied : course à 90 % en 0,12-0,35 s', tRun >= 0.12 && tRun <= 0.35, `${tRun.toFixed(2)} s`);
  check('à pied : arrêt net en < 0,2 s', tStop < 0.2, `${tStop.toFixed(2)} s`);
  check('à pied : demi-tour en course en < 0,45 s', tTurn < 0.45, `${tTurn.toFixed(2)} s`);
  const d = wishVelocity(1, 1, 0, true);
  check('à pied : diagonale pas plus rapide que la course', Math.abs(Math.hypot(...d) - ONFOOT.run) < 1e-9);
  check('à pied : sans entrée -> vitesse nulle ; NaN toléré', wishVelocity(0, 0, 1, true).every((x) => x === 0) && wishVelocity(NaN, NaN, 0, false).every((x) => x === 0));
  const w = wishVelocity(1, 0, Math.PI / 2, false); // lacet 90° : l'avant est l'ouest
  check('à pied : vitesse voulue suit le cap', Math.abs(w[0] + ONFOOT.walk) < 1e-9 && Math.abs(w[1]) < 1e-9);
  let cur: [number, number] = [0, 0], over = 0;
  for (let i = 0; i < 120; i++) { cur = approachVelocity(cur, want, dt); over = Math.max(over, Math.hypot(...cur) - ONFOOT.walk); }
  check('à pied : aucun dépassement de la vitesse voulue', over < 1e-9);
  let yaw = 0; t = 0; while (Math.abs(wrap(Math.PI - yaw)) > 0.05 && t < 2) { yaw = turnToward(yaw, Math.PI, dt); t += dt; }
  const t180 = t;
  yaw = 0; t = 0; while (Math.abs(wrap(0.5 - yaw)) > 0.02 && t < 2) { yaw = turnToward(yaw, 0.5, dt); t += dt; }
  const t30 = t;
  console.log(`  # rotation vers le curseur : 180° en ${t180.toFixed(2)} s, 29° en ${t30.toFixed(2)} s`);
  check('à pied : demi-tour vers le curseur en 0,1-0,35 s', t180 > 0.1 && t180 < 0.35, `${t180.toFixed(2)} s`);
  check('à pied : petit écart rattrapé en < 0,3 s', t30 < 0.3, `${t30.toFixed(2)} s`);
  let y2 = 3.0, finite = true; for (let i = 0; i < 30; i++) { y2 = turnToward(y2, -3.0, dt); if (!Number.isFinite(y2)) finite = false; }
  check('à pied : tourne par le plus court chemin (3,0 -> -3,0 passe par π)', finite && Math.abs(wrap(y2 + 3.0)) < 0.02);
  check('à pied : turnToward tolère NaN', turnToward(NaN, 1, dt) === 1 && turnToward(1, NaN, dt) === 1 && turnToward(1, 2, 0) === 1);
  check('à pied : constantes cohérentes (arrêt plus franc que le démarrage)', FOOT.brake > FOOT.accel && FOOT.accel > FOOT.runAccel);
}

/** Ancien verrouillage (vague 3) : plus proche dans le cône, bascule si < 70 % de la distance courante. */
function legacyLock() {
  let id: number | null = null;
  type T = { id: number; pos: [number, number, number] };
  return (from: [number, number, number], yaw: number, targets: T[]) => {
    const o = AIM_DEFAULTS;
    const dist = (t: T) => Math.hypot(t.pos[0] - from[0], t.pos[2] - from[2]);
    const cur = id === null ? null : targets.find((t) => t.id === id) ?? null;
    const curOk = cur !== null && dist(cur) <= o.range * o.keep;
    let best: T | null = null, bd = Infinity;
    for (const t of targets) { const dx = t.pos[0] - from[0], dz = t.pos[2] - from[2], d = Math.hypot(dx, dz); if (!(d > 0.3) || d > o.range || Math.abs(wrap(Math.atan2(-dx, -dz) - yaw)) > o.cone) continue; if (d < bd) { bd = d; best = t; } }
    let chosen: T | null = curOk ? cur : null;
    if (best && (!chosen || (best.id !== chosen.id && dist(best) < dist(chosen) * o.switchGain))) chosen = best;
    id = chosen ? chosen.id : null;
    return id;
  };
}

function viseeStabilite() {
  const mk = () => ({ lock: new AutoLock(), old: legacyLock() });
  type TG = { id: number; pos: [number, number, number]; vx: number; vz: number };
  const crowd = (n: number, seed: number): TG[] => {
    let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, pos: [(rnd() - 0.5) * 30, 0, -4 - rnd() * 20] as [number, number, number], vx: (rnd() - 0.5) * 3, vz: (rnd() - 0.5) * 3 }));
  };
  const wander = (tg: TG[]) => { for (const t of tg) { t.pos[0] += t.vx / 60; t.pos[2] += t.vz / 60; if (Math.abs(t.pos[0]) > 18) t.vx = -t.vx; if (t.pos[2] > -3 || t.pos[2] < -24) t.vz = -t.vz; } };
  // A. main qui tremble : curseur ±8° autour d'une direction, 12 cibles qui errent, 30 s -> combien de changements de cible ?
  const jitter = (useNew: boolean) => {
    let s = 5; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
    const tg = crowd(12, 99), { lock, old } = mk();
    let last: number | string | null = null, switches = 0;
    for (let f = 0; f < 60 * 30; f++) {
      wander(tg);
      const yaw = 0.1 + rnd() * 0.28; // ±8° de bruit à 60 Hz
      const id = useNew ? (lock.update([0, 0, 0], yaw, tg, true, f * (1000 / 60))?.id ?? null) : old([0, 0, 0], yaw, tg);
      if (id !== last) { if (id !== null && last !== null) switches++; last = id; }
    }
    return switches;
  };
  const ja = jitter(false), jb = jitter(true);
  console.log(`  # verrouillage, main qui tremble (±8°, 12 cibles mobiles, 30 s) : changements de cible ${ja} -> ${jb}`);
  check('verrouillage : main qui tremble -> au plus 1 changement par 3 s, à peine plus qu\'avant', jb <= ja + 2 && jb <= 10, `${ja} -> ${jb}`);
  // B. visée voulue : le curseur passe de la cible 1 à la cible 2 (60° d'écart, même distance) et s'y pose : combien de temps pour verrouiller la 2 ?
  const aim = (useNew: boolean) => {
    const tg: TG[] = [{ id: 1, pos: [-7, 0, -12], vx: 0, vz: 0 }, { id: 2, pos: [7, 0, -12.5], vx: 0, vz: 0 }];
    const { lock, old } = mk(); const y1 = Math.atan2(7, 12), y2 = -Math.atan2(7, 12.5); // cap vers 1 (ouest) puis 2 (est)
    let tAcq = Infinity;
    for (let f = 0; f < 60 * 3; f++) {
      const t = f / 60, yaw = t < 1 ? y1 : t < 1.4 ? y1 + (y2 - y1) * ((t - 1) / 0.4) : y2;
      const id = useNew ? (lock.update([0, 0, 0], yaw, tg, true, f * (1000 / 60))?.id ?? null) : old([0, 0, 0], yaw, tg);
      if (id === 2 && tAcq === Infinity) tAcq = t - 1.4;
    }
    return tAcq;
  };
  const oa = aim(false), ob = aim(true);
  console.log(`  # verrouillage, le joueur passe d'une cible à l'autre (60° d'écart) : cible 2 verrouillée ${Number.isFinite(oa) ? oa.toFixed(2) + ' s' : 'jamais'} après la fin du geste -> ${ob.toFixed(2)} s`);
  check('verrouillage : viser une autre cible la verrouille en < 0,5 s (avant : jamais)', ob < 0.5, `${Number.isFinite(oa) ? oa.toFixed(2) : 'jamais'} -> ${ob.toFixed(2)} s`);
  const lock = new AutoLock();
  const T = (id: number, x: number, z: number) => ({ id, pos: [x, 0, z] as [number, number, number] });
  lock.update([0, 0, 0], 0, [T(1, 0, -12)], true, 0);
  const early = lock.update([0, 0, 0], 0, [T(1, 0, -12), T(2, 0, -3)], true, 100);
  const late = lock.update([0, 0, 0], 0, [T(1, 0, -12), T(2, 0, -3)], true, 600);
  check('verrouillage : garde 350 ms avant de changer, puis bascule sur la cible bien meilleure', early?.id === 1 && late?.id === 2);
  const l2 = new AutoLock(); l2.update([0, 0, 0], 0, [T(1, 0, -10)], true, 0);
  check('verrouillage : curseur retourné à 180° -> verrou relâché', l2.update([0, 0, 0], Math.PI, [T(1, 0, -10)], true, 1000) === null);
  const l3 = new AutoLock(); l3.update([0, 0, 0], 0, [T(1, 0, -10), T(2, 3, -14)], true, 0);
  check('verrouillage : cible disparue -> nouvelle cible aussitôt', l3.update([0, 0, 0], 0, [T(2, 3, -14)], true, 50)?.id === 2);
  check('verrouillage : à distance égale, la cible la plus proche de l\'axe du curseur', pickTarget([0, 0, 0], 0, [T(1, -8, -8), T(2, 0.5, -11.3)])?.id === 2);
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
  console.log('\n--- ressenti (mesures) ---');
  await ressenti();
  camera();
  aPiedRessenti();
  viseeStabilite();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
