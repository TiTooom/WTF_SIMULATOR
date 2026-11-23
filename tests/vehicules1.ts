// Vérifications physiques de la voiture (seul véhicule de la vague 0) : npx tsx tests/vehicules1.ts
import * as THREE from 'three';
import { driveScenario } from './harness';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOfQ = (q: { x: number; y: number; z: number; w: number }) => {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  return Math.atan2(-f.x, -f.z);
};

async function voiture() {
  // 1. accélération
  {
    const r = await driveScenario('citadine', (t) => (t < 4 ? { f: 1 } : {}), 5);
    const sp = Math.max(...r.rows.map((x) => x.speed));
    check('voiture : accélère (> 10 m/s en 4 s)', sp > 10, `max ${sp.toFixed(1)} m/s`);
    check('voiture : aucun dégât en conduite normale', r.vehicle.hp === r.vehicle.def.maxHp);
  }
  // 2. virage : braquage proportionnel à la vitesse, la voiture tourne, ne se retourne pas
  {
    let y0 = 0;
    const r = await driveScenario('citadine', (t, { vehicle }) => {
      if (t < 0.05) y0 = yawOfQ(vehicle.behavior.body.rotation());
      return { f: 1, s: 1 };
    }, 1.2); // assez court pour que le lacet ne dépasse pas un demi-tour (angle replié sur ±π)
    const b = r.vehicle.behavior.body;
    const dy = Math.abs(wrap(yawOfQ(b.rotation()) - y0));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(r.sim.quatOf(b)).y;
    check('voiture : tourne en roulant', dy > 0.5, `lacet ${dy.toFixed(2)} rad`);
    check('voiture : ne se retourne pas', up > 0.98, `up.y = ${up.toFixed(3)}`);
  }
  // 3. à l'arrêt, braquer ne fait pas pivoter
  {
    let y0 = 0;
    const r = await driveScenario('citadine', (t, { vehicle }) => {
      if (t < 0.05) y0 = yawOfQ(vehicle.behavior.body.rotation());
      return { s: 1 };
    }, 2);
    const dy = Math.abs(wrap(yawOfQ(r.vehicle.behavior.body.rotation()) - y0));
    check('voiture : pas de pivot sur place', dy < 0.2, `lacet ${dy.toFixed(2)} rad`);
  }
  // 4. frein à main (jump) ralentit
  {
    let v1 = 0, v2 = 0;
    await driveScenario('citadine', (t, { vehicle }) => {
      const lv = vehicle.behavior.body.linvel();
      if (t > 3.95 && t < 4.0) v1 = Math.hypot(lv.x, lv.z);
      if (t > 4.95 && t < 5.0) v2 = Math.hypot(lv.x, lv.z);
      return t < 4 ? { f: 1 } : { jump: 1 };
    }, 5.1);
    check('voiture : le frein à main (jump) ralentit', v2 < v1 * 0.6, `${v1.toFixed(1)} -> ${v2.toFixed(1)} m/s`);
  }
  // 5. klaxon : fx sound horn_car
  {
    const r = await driveScenario('citadine', (t) => ({ hn: t > 0.5 && t < 0.6 ? 1 : 0 }), 2);
    check('voiture : klaxon (fx sound horn_car)', r.fx.some((e) => e.k === 'sound' && e.s === 'horn_car'));
  }
  // 6. destruction + réapparition + sortie du conducteur
  {
    const r = await driveScenario('citadine', () => ({}), 1);
    const t = r.vehicle.behavior.body.translation();
    for (let i = 0; i < 12 && !r.vehicle.dead; i++) r.sim.explode(new THREE.Vector3(t.x + 1.5, t.y, t.z), 6, 25, 80, null);
    for (let i = 0; i < 120; i++) r.sim.step();
    check('voiture : finit par exploser sous les explosions', r.vehicle.dead);
    check('voiture : le conducteur est éjecté', r.player.vehicle === null);
    for (let i = 0; i < 60 * 14; i++) r.sim.step();
    check('voiture : réapparition sans erreur', !r.vehicle.dead && Number.isFinite(r.vehicle.behavior.body.translation().x));
  }
  // 7. interaction : monter / descendre
  {
    const r = await driveScenario('citadine', () => ({}), 0.5);
    r.sim.interact(r.player.id);
    check('voiture : interact depuis le siège = descendre', r.player.vehicle === null);
    const vt = r.vehicle.behavior.body.translation();
    r.player.body.setTranslation({ x: vt.x + 2, y: vt.y + 0.5, z: vt.z }, true);
    r.sim.interact(r.player.id);
    check('voiture : interact à proximité = monter', r.player.vehicle === r.vehicle);
  }
}

async function main() {
  await voiture();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
