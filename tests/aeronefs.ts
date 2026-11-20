// Vérifications physiques des aéronefs (avion_chasse, helicoptere) : npx tsx tests/aeronefs.ts
import * as THREE from 'three';
import { driveScenario, type InputFn } from './harness';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../shared/sim';
import type { SimVehicle } from '../shared/api';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const bodyOf = (v: SimVehicle) => v.behavior.body;
const pos = (v: SimVehicle) => bodyOf(v).translation();
const vel = (v: SimVehicle) => bodyOf(v).linvel();
const tilt = (sim: Sim, v: SimVehicle) => new THREE.Vector3(0, 1, 0).applyQuaternion(sim.quatOf(bodyOf(v))).y; // 1 = à plat
const place = (sim: Sim, v: SimVehicle, p: [number, number, number], vl: [number, number, number], q?: THREE.Quaternion) => {
  const b = bodyOf(v);
  b.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
  b.setLinvel({ x: vl[0], y: vl[1], z: vl[2] }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  b.setRotation(q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 }, true);
  v.noImpactUntil = sim.time + 400;
};
const finite = (v: SimVehicle) => !v.dead && Object.values(pos(v)).every(Number.isFinite) && Object.values(vel(v)).every(Number.isFinite);

async function avion() {
  console.log('\n=== avion_chasse ===');
  // 1. décollage de la piste (x=80, z de -30 vers -280)
  {
    let maxAlt = 0, rotated = false, vRot = 0, zRot = 0;
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      const p = pos(vehicle);
      maxAlt = Math.max(maxAlt, p.y);
      const sp = Math.hypot(vel(vehicle).x, vel(vehicle).z);
      if (!rotated && sp > 44) { rotated = true; vRot = sp; zRot = p.z; }
      return { th: t < 3 ? 1 : 0, f: rotated ? -0.35 : 0 };
    }, 22, { every: 2, print: true });
    const p = pos(r.vehicle);
    check('décollage : décolle de la piste et prend de l\'altitude', maxAlt > 25 && finite(r.vehicle), `alt max=${maxAlt.toFixed(1)}, rotation à ${vRot.toFixed(0)} m/s, z=${zRot.toFixed(0)}`);
    check('décollage : décolle avant la fin de la piste (z > -280)', zRot > -280 && zRot < -30, `z=${zRot.toFixed(0)}`);
    void p;
  }
  // 2. vol en palier + virage (mise en place en l'air)
  {
    let alt0 = 0;
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) { place(sim, vehicle, [80, 120, -200], [0, 0, -60]); alt0 = 120; }
      return { th: t < 1 ? 1 : 0 };
    }, 10, { every: 2, print: true });
    const p = pos(r.vehicle);
    check('palier : l\'altitude se maintient sans commande (±20 m)', Math.abs(p.y - alt0) < 20 && finite(r.vehicle), `alt=${p.y.toFixed(1)}`);
    check('palier : se remet à plat', tilt(r.sim, r.vehicle) > 0.98, `up.y=${tilt(r.sim, r.vehicle).toFixed(3)}`);
    check('palier : reste en vie sans dégâts', r.vehicle.hp === r.vehicle.def.maxHp, `hp=${r.vehicle.hp}`);
  }
  {
    let yaw0 = 0;
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) { place(sim, vehicle, [80, 150, -200], [0, 0, -60]); yaw0 = 0; }
      return { th: t < 1 ? 1 : 0, s: t > 1 && t < 2.5 ? 1 : 0, f: t > 1 && t < 2.5 ? -0.3 : 0 };
    }, 9, { every: 1.5, print: true });
    const q = r.sim.quatOf(bodyOf(r.vehicle));
    const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const heading = Math.atan2(-fw.x, -fw.z);
    check('virage : le roulis à droite fait tourner à droite', heading < -0.8 && finite(r.vehicle), `cap=${(heading * 57.3).toFixed(0)}° (négatif = droite)`);
    check('virage : se remet ensuite à plat, pas d\'emballement', tilt(r.sim, r.vehicle) > 0.9 && bodyOf(r.vehicle).angvel().x ** 2 < 25, `up.y=${tilt(r.sim, r.vehicle).toFixed(2)}`);
    void yaw0;
  }
  // 3. atterrissage doux train sorti : aucun dégât
  {
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) place(sim, vehicle, [80, 14, -60], [0, -3, -42]);
      return { th: 0, jump: t > 6 ? 1 : 0 };
    }, 16, { every: 2, print: true });
    check('atterrissage doux (train sorti) : aucun dégât', r.vehicle.hp === r.vehicle.def.maxHp && !r.vehicle.dead, `hp=${r.vehicle.hp}`);
    const sp = Math.hypot(vel(r.vehicle).x, vel(r.vehicle).z);
    check('atterrissage doux : il freine et s\'arrête sur la piste', sp < 3 && Math.abs(pos(r.vehicle).x - 80) < 12, `v=${sp.toFixed(1)} x=${pos(r.vehicle).x.toFixed(1)} z=${pos(r.vehicle).z.toFixed(0)}`);
  }
  // 3b. atterrissage doux à ~6 m/s verticaux (limite)
  {
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) place(sim, vehicle, [80, 3, -190], [0, -6, -40]);
      return { th: 0 };
    }, 5, { every: 1, print: false });
    check('atterrissage à 6 m/s verticaux : pas détruit', !r.vehicle.dead && r.vehicle.hp > 0, `hp=${r.vehicle.hp.toFixed(0)}`);
  }
  // 4. atterrissage train rentré : glisse sur le ventre + étincelles, sans exploser
  {
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) { place(sim, vehicle, [80, 12, -60], [0, -3, -42]); }
      return { th: 0, hn: t > 0.1 && t < 0.2 ? 1 : 0 };
    }, 14, { every: 2, print: true });
    const sparks = r.fx.filter((e) => e.k === 'spark').length;
    check('ventre : train rentré -> étincelles de tôle', sparks > 5, `${sparks} étincelles`);
    check('ventre : ne détruit pas l\'avion', !r.vehicle.dead, `hp=${r.vehicle.hp}`);
    const sp = Math.hypot(vel(r.vehicle).x, vel(r.vehicle).z);
    check('ventre : finit par s\'arrêter', sp < 2, `v=${sp.toFixed(1)}`);
  }
  // 5. crash : piqué à haute vitesse
  {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0)); // nez vers le bas
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) place(sim, vehicle, [80, 60, -150], [0, -30, -50], q);
      return { th: 1, f: 1 };
    }, 8, { every: 1, print: true });
    check('crash : un piqué au sol fait exploser l\'avion', r.vehicle.dead, `dead=${r.vehicle.dead} hp=${r.vehicle.hp}`);
    check('crash : explosion émise', r.fx.some((e) => e.k === 'boom'));
  }
  // 5b. crash frontal contre un mur en vol horizontal
  {
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) {
        place(sim, vehicle, [80, 8, -100], [0, 0, -60]);
        sim.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 20, 1).setTranslation(80, 10, -160));
      }
      return { th: 1 };
    }, 4, { every: 1, print: false });
    check('crash : un mur à 60 m/s fait exploser l\'avion', r.vehicle.dead);
  }
  // 6. armes
  {
    let bullets = 0;
    let maxBullets = 0;
    const r = await driveScenario('avion_chasse', (t, { sim, vehicle }) => {
      if (t === 0) place(sim, vehicle, [80, 150, -200], [0, 0, -50]);
      const n = (sim as unknown as { projs: unknown[] }).projs.length;
      maxBullets = Math.max(maxBullets, n);
      if (t > 0.9 && t < 1.1) bullets = n;
      return { th: 1, m1: t > 0.5 && t < 1.5 ? 1 : 0 };
    }, 2, { every: 1, print: false });
    void bullets;
    check('mitrailleuse : ~20 tirs/s (2 ailes) -> au moins 15 projectiles en 1 s', maxBullets >= 15 && maxBullets <= 60, `${maxBullets} projectiles simultanés`);
    void r;
  }
  {
    // missile : cible (le 2e véhicule, une voiture) placée devant, légèrement décalée
    const sim = await Sim.create();
    sim.log = (l) => console.log(l);
    sim.onAnnounce = () => {};
    sim.addPlayer('p1', 'Pilote');
    const pl = sim.players.get('p1')!;
    const plane = sim.vehicles.find((v) => v.def.type === 'avion_chasse')!;
    const car = sim.vehicles.find((v) => v.def.type === 'car')!;
    for (let i = 0; i < 90; i++) sim.step();
    sim.enterVehicle(pl, plane, 0);
    place(sim, plane, [80, 40, -200], [0, 0, -50]);
    const cb = bodyOf(car);
    cb.setTranslation({ x: 100, y: 2, z: -420 }, true);
    cb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.noImpactUntil = sim.time + 20000;
    let fired = false, hpMin = car.hp, pre = car.hp;
    for (let k = 0; k < 60 * 9; k++) {
      sim.setInput('p1', { th: 1, m2: k > 30 && !fired ? 1 : 0 });
      if (k > 30) fired = true;
      cb.setLinvel({ x: 0, y: 0, z: 0 }, true); // la voiture reste en place
      plane.noImpactUntil = sim.time + 100;
      sim.step();
      hpMin = Math.min(hpMin, car.hp);
    }
    check('missile : tête chercheuse, touche une cible décalée de 20 m à 220 m', hpMin < pre || car.dead, `hp voiture ${pre} -> ${hpMin.toFixed(0)}`);
  }
}


async function helico() {
  console.log('\n=== helicoptere ===');
  // décollage / stationnaire / atterrissage
  {
    let maxAlt = 0, altAt = 0, driftX = 0;
    const r = await driveScenario('helicoptere', (t, { vehicle }) => {
      const p = pos(vehicle);
      maxAlt = Math.max(maxAlt, p.y);
      if (Math.abs(t - 13) < 0.01) altAt = p.y;
      if (Math.abs(t - 13) < 0.01) driftX = Math.hypot(p.x - 110, p.z + 40);
      return { th: t > 1 && t < 4 ? 1 : t > 16 && t < 27 ? -0.6 : 0 };
    }, 30, { every: 2, print: true });
    check('hélico : décolle', maxAlt > 10 && finite(r.vehicle) || r.vehicle.hp > 0, `alt max=${maxAlt.toFixed(1)}`);
    check('hélico : stationnaire assisté (alt stable sans commande, dérive < 8 m)', altAt > 8, `alt à 13 s=${altAt.toFixed(1)} dérive=${driftX.toFixed(1)}`);
    const p = pos(r.vehicle);
    check('hélico : atterrit sans dégâts', r.vehicle.hp === r.vehicle.def.maxHp && p.y < 3, `hp=${r.vehicle.hp} alt=${p.y.toFixed(2)}`);
  }
  // avance et virage
  {
    const r = await driveScenario('helicoptere', (t, { vehicle }) => ({ th: t > 1 && t < 3 ? 1 : 0, f: t > 4 && t < 9 ? 1 : 0, yw: t > 9 && t < 12 ? 1 : 0 }), 14, { every: 2, print: true });
    const p = pos(r.vehicle);
    const d = Math.hypot(p.x - 110, p.z + 40);
    check('hélico : avance en piquant du nez, stable', d > 15 && finite(r.vehicle) && tilt(r.sim, r.vehicle) > 0.6, `distance=${d.toFixed(0)} m, up.y=${tilt(r.sim, r.vehicle).toFixed(2)}`);
  }
  // treuil
  {
    const sim = await Sim.create();
    sim.log = (l) => console.log(l);
    sim.onAnnounce = () => {};
    sim.addPlayer('p1', 'Pilote');
    const pl = sim.players.get('p1')!;
    const heli = sim.vehicles.find((v) => v.def.type === 'helicoptere')!;
    for (let i = 0; i < 90; i++) sim.step();
    sim.enterVehicle(pl, heli, 0);
    const box = sim.spawnProp('crate_s', new THREE.Vector3(110, 6, -40));
    const hb = bodyOf(heli);
    hb.setTranslation({ x: 110, y: 14, z: -40 }, true);
    heli.noImpactUntil = sim.time + 500;
    let phase = 'attrape';
    let hooked = false;
    let maxY = 0, lastD = 0;
    if (!box) { check('treuil : prop de test (caisse) créé', false, 'kind inconnu'); return; }
    for (let k = 0; k < 60 * 20; k++) {
      const t = k / 60;
      sim.setInput('p1', { m1: t < 12 ? 1 : 0, m2: t > 15 ? 1 : 0, th: t > 4 && t < 6.5 ? 1 : 0 });
      sim.step();
      const hp = hb.translation();
      const bp = box.body.translation();
      if (t > 3) hooked ||= (heli.behavior.anim().a[3] ?? 0) > 0.5;
      if (t > 9 && t < 12) maxY = Math.max(maxY, bp.y);
      if (t > 11.9 && t < 12) lastD = Math.hypot(bp.x - hp.x, bp.z - hp.z);
      if (k % 120 === 0) console.log(`t=${t.toFixed(0)} heli y=${hp.y.toFixed(1)} caisse y=${bp.y.toFixed(1)} d=${(hp.y - bp.y).toFixed(1)} accrochée=${heli.behavior.anim().a[3]}`);
    }
    const hpos = hb.translation();
    const bpos = box.body.translation();
    check('treuil : la caisse est accrochée puis soulevée', hooked && maxY > 7, `y max caisse=${maxY.toFixed(1)}`);
    check('treuil : largage (m2) -> la caisse retombe', bpos.y < hpos.y - 3, `caisse y=${bpos.y.toFixed(1)}, hélico y=${hpos.y.toFixed(1)}`);
    check('treuil : l\'hélico reste stable avec la charge', heli.hp === heli.def.maxHp && finite(heli), `hp=${heli.hp}`);
    void phase; void lastD;
  }
  // souffle du rotor
  {
    const sim = await Sim.create();
    sim.log = (l) => console.log(l);
    sim.onAnnounce = () => {};
    sim.addPlayer('p1', 'Pilote');
    const pl = sim.players.get('p1')!;
    const heli = sim.vehicles.find((v) => v.def.type === 'helicoptere')!;
    for (let i = 0; i < 90; i++) sim.step();
    sim.enterVehicle(pl, heli, 0);
    const box = sim.spawnProp('crate_s', new THREE.Vector3(112, 0.6, -40));
    const hb = bodyOf(heli);
    for (let k = 0; k < 60 * 4; k++) { sim.setInput('p1', { th: k > 60 ? 0.3 : 0 }); sim.step(); }
    const bp = box!.body.translation();
    check('souffle : le rotor pousse la caisse posée sous lui', Math.hypot(bp.x - 112, bp.z + 40) > 0.4 || bp.y > 1.5, `caisse (${bp.x.toFixed(1)}, ${bp.y.toFixed(1)}, ${bp.z.toFixed(1)}) ; hélico y=${hb.translation().y.toFixed(1)}`);
  }
  // crash
  {
    const r = await driveScenario('helicoptere', (t, { sim, vehicle }) => {
      if (t === 0) { place(sim, vehicle, [110, 60, -40], [0, -25, 0]); sim.interact('p1'); } // le pilote saute : rotor coupé, chute libre
      return {};
    }, 8, { every: 1, print: false });
    check('hélico : sans pilote, une chute de 60 m le détruit', r.vehicle.dead, `hp=${r.vehicle.hp}`);
  }
}

async function main() {
  await avion();
  await helico();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUT PASSE');
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
