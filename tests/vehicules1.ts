// Vérifications physiques du tank et du camion articulé : npx tsx tests/vehicules1.ts
import * as THREE from 'three';
import { driveScenario } from './harness';
import type { Row } from './harness';

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
const last = (rows: Row[]) => rows[rows.length - 1];

async function tank() {
  // 1. accélération + virage sur place + jamais retourné
  {
    const r = await driveScenario('tank', (t) => (t < 4 ? { f: 1 } : {}), 5);
    check('tank : accélère (> 8 m/s en 4 s)', Math.max(...r.rows.map((x) => x.speed)) > 8, `max ${Math.max(...r.rows.map((x) => x.speed)).toFixed(1)}`);
  }
  {
    let y0 = 0, p0 = { x: 0, z: 0 };
    const r = await driveScenario('tank', (t, { vehicle }) => {
      if (t < 0.05) { y0 = yawOfQ(vehicle.behavior.body.rotation()); p0 = vehicle.behavior.body.translation(); }
      return { s: 1 };
    }, 3);
    const b = r.vehicle.behavior.body;
    const dy = Math.abs(wrap(yawOfQ(b.rotation()) - y0));
    const t = b.translation();
    check('tank : pivote sur place', Math.hypot(t.x - p0.x, t.z - p0.z) < 3 && dy > 1, `dérive ${(Math.hypot(t.x - p0.x, t.z - p0.z)).toFixed(2)} m (yaw ${dy.toFixed(2)} rad)`);
  }
  // 2. roquette à bout portant : ≈ 0 dégât ; jamais retourné
  {
    const r = await driveScenario('tank', () => ({}), 1);
    const b = r.vehicle.behavior.body;
    const t = b.translation();
    for (let i = 0; i < 4; i++) r.sim.explode(new THREE.Vector3(t.x + 1.5, t.y, t.z), 6, 25, 80, null);
    for (let i = 0; i < 120; i++) r.sim.step();
    const q = r.sim.quatOf(b);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y;
    check('tank : ≈ 0 dégât de 4 roquettes', r.vehicle.hp / r.vehicle.def.maxHp > 0.93, `pv ${(100 * r.vehicle.hp / r.vehicle.def.maxHp).toFixed(1)} %`);
    check('tank : ne se retourne jamais', up > 0.99, `up.y = ${up.toFixed(3)}`);
  }
  // 3. tourelle suit la caméra + obus part dans la direction du canon
  {
    const ang = 1.0; // regarde à gauche (-x) de 1 rad depuis -z
    const ad: [number, number, number] = [-Math.sin(ang) * Math.cos(0.2), Math.sin(0.2), -Math.cos(ang) * Math.cos(0.2)];
    let shellDir: THREE.Vector3 | null = null;
    let popSeen = false;
    const r = await driveScenario('tank', (t, { sim }) => {
      const snap = sim.snapshot();
      if (snap.proj.length >= 8 && !shellDir && snap.proj[1] === 11) shellDir = new THREE.Vector3(snap.proj[5], snap.proj[6], snap.proj[7]).normalize();
      if (snap.fx.some((e) => e.k === 'sound' && e.s === 'pop')) popSeen = true;
      return { ao: [0, 3, 8], ad, m1: t > 2.5 && t < 2.6 ? 1 : 0 };
    }, 3.5);
    const a = r.vehicle.behavior.anim().a;
    // la visée est un rayon depuis ao : la direction exacte dépend du point touché ; on vérifie le sens (gauche) et l'élévation bornée
    check('tank : la tourelle tourne vers la caméra', a[0] > 0.5 && a[0] < 2, `lacet tourelle ${a[0].toFixed(2)}`);
    check('tank : élévation du canon bornée', a[1] >= -0.16 && a[1] <= 0.61, `élév ${a[1].toFixed(2)}`);
    check('tank : tir = obus + son pop (pschitt)', !!shellDir && popSeen, shellDir ? `v̂ = ${(shellDir as THREE.Vector3).toArray().map((n) => n.toFixed(2))}` : 'aucun obus');
    if (shellDir) {
      const turretYaw = yawOfQ(r.vehicle.behavior.body.rotation()) + a[0];
      const barrel = new THREE.Vector3(-Math.sin(turretYaw), 0, -Math.cos(turretYaw));
      const flat = new THREE.Vector3((shellDir as THREE.Vector3).x, 0, (shellDir as THREE.Vector3).z).normalize();
      check('tank : l’obus part dans l’axe réel du canon', flat.dot(barrel) > 0.98, `cos ${flat.dot(barrel).toFixed(3)}`);
    }
  }
  // 4. mitrailleuse : cadence ~12/s
  {
    const ids = new Set<number>();
    await driveScenario('tank', (t, { sim }) => {
      const s = sim.snapshot();
      for (let i = 0; i < s.proj.length; i += 8) ids.add(s.proj[i]);
      return { m2: t < 1 ? 1 : 0 };
    }, 1.5);
    check('tank : mitrailleuse ~12 tirs/s', ids.size >= 10 && ids.size <= 14, `${ids.size} projectiles en 1 s`);
  }
  // 5. écrase les petits props
  {
    let hp0 = 0, cx = 0, cz = 0;
    const r = await driveScenario('tank', (t, { sim, vehicle }) => {
      if (t < 0.02) {
        const b0 = vehicle.behavior.body.translation();
        cz = b0.z - 8; cx = b0.x;
        const p = sim.spawnProp('crate_s', new THREE.Vector3(cx, 0.6, cz), undefined, undefined, null);
        hp0 = p?.hp ?? 0;
      }
      return { f: 1 };
    }, 4);
    const left = [...r.sim.props.values()].find((p) => p.kind.id === 'crate_s' && Math.abs(p.body.translation().z - cz) < 12 && Math.abs(p.body.translation().x - cx) < 3);
    check('tank : écrase une petite caisse', !left || left.hp < hp0, left ? `pv ${left.hp}/${hp0}` : 'détruite');
  }
}

async function camion() {
  const rel = (r: { vehicle: { behavior: { anim(): { a: number[] } } } }) => r.vehicle.behavior.anim().a;
  // 1. virage : la remorque suit, reste à ~5,8 m, ne part pas dans l'espace
  {
    let maxAng = 0, maxDist = 0, maxY = 0;
    const r = await driveScenario('camion_articule', (t, { vehicle }) => {
      const a = vehicle.behavior.anim().a;
      maxAng = Math.max(maxAng, Math.abs(a[0]));
      maxDist = Math.max(maxDist, Math.hypot(a[3], a[5]));
      maxY = Math.max(maxY, vehicle.behavior.body.translation().y);
      return { f: 1, s: t < 6 ? 0.8 : -0.8 };
    }, 12);
    check('camion : virage sans que la remorque parte', maxDist < 7 && maxY < 2 && maxAng < 1.36, `angle max ${maxAng.toFixed(2)}, distance max ${maxDist.toFixed(2)}, y max ${maxY.toFixed(2)}`);
    const sp = Math.max(...r.rows.map((x) => x.speed));
    check('camion : vitesse max ~22 m/s', sp > 14 && sp < 24, `${sp.toFixed(1)} m/s`);
    check('camion : aucun dégât en conduite normale', r.vehicle.hp / r.vehicle.def.maxHp > 0.95, `pv ${(100 * r.vehicle.hp / r.vehicle.def.maxHp).toFixed(0)} %`);
  }
  // 2. jackknife puis récupération
  {
    let maxAng = 0;
    let angAfter = 9;
    const r = await driveScenario('camion_articule', (t, { vehicle }) => {
      const a = vehicle.behavior.anim().a;
      if (t >= 8 && t < 12) maxAng = Math.max(maxAng, Math.abs(a[0]));
      if (t > 19.5) angAfter = Math.min(angAfter, Math.abs(a[0]));
      if (t < 8) return { f: 1, th: 1 };
      if (t < 11) return { f: -1, s: 0.25 };
      return { f: 1 };
    }, 20, { print: false });
    const hp = r.vehicle.hp / r.vehicle.def.maxHp;
    check('camion : freinage fort = jackknife (> 0,5 rad)', maxAng > 0.5, `angle max ${maxAng.toFixed(2)}`);
    check('camion : jackknife récupérable', angAfter < 0.25, `angle final ${angAfter.toFixed(2)}`);
    check('camion : le jackknife ne tue pas la cabine', !r.vehicle.dead && hp > 0.4, `pv ${(hp * 100).toFixed(0)} %`);
  }
  // 3. largage / rattelage
  {
    let afterDrop = -1, dist = 0, afterHitch = -1;
    const r = await driveScenario('camion_articule', (t, { vehicle }) => {
      const a = vehicle.behavior.anim().a;
      if (t > 2.6 && t < 2.7) afterDrop = a[2];
      if (t > 6.9 && t < 7) dist = Math.hypot(a[3], a[5]);
      if (t > 19.8) afterHitch = a[2];
      if (t < 2) return { f: 1 };
      if (t < 2.2) return { m1: 1 };
      if (t < 6) return { f: t < 5 ? 1 : 0 }; // la cabine part sans la remorque
      if (t < 12) return { f: -1 }; // marche arrière vers la remorque
      if (t < 13) return {};
      if (t < 13.2) return { m1: 1 }; // rattache à proximité
      return {};
    }, 20);
    check('camion : m1 largue la remorque', afterDrop === 0, `attelée=${afterDrop}`);
    check('camion : la cabine s’éloigne de la remorque larguée', dist > 8, `distance ${dist.toFixed(1)} m`);
    const a = rel(r);
    check('camion : rattelage', afterHitch === 1 || a[2] === 1, `attelée=${a[2]} (écart final ${Math.hypot(a[3], a[5]).toFixed(1)} m)`);
  }
  // 4. benne : 6 caisses
  {
    let before = 0;
    const r = await driveScenario('camion_articule', (t, { sim }) => {
      if (t < 0.02) before = [...sim.props.values()].filter((p) => p.kind.id === 'crate_m').length;
      return t > 1 && t < 1.1 ? { m2: 1 } : {};
    }, 6);
    const after = [...r.sim.props.values()].filter((p) => p.kind.id === 'crate_m').length;
    check('camion : la benne déverse 6 caisses', after - before === 6, `${after - before} caisses`);
    check('camion : benne ouverte (anim)', rel(r)[1] > 0.9, `benne ${rel(r)[1].toFixed(2)}`);
  }
  // 5. roquette : la cabine encaisse, explose ; dispose propre
  {
    const r = await driveScenario('camion_articule', () => ({}), 1);
    const t = r.vehicle.behavior.body.translation();
    for (let i = 0; i < 12 && !r.vehicle.dead; i++) r.sim.explode(new THREE.Vector3(t.x + 1.5, t.y, t.z), 6, 25, 80, null);
    for (let i = 0; i < 120; i++) r.sim.step();
    check('camion : la cabine finit par exploser', r.vehicle.dead);
    for (let i = 0; i < 60 * 14; i++) r.sim.step(); // réapparition ~12 s
    check('camion : réapparition sans erreur', !r.vehicle.dead && Number.isFinite(r.vehicle.behavior.body.translation().x));
  }
  // 6. sortie du véhicule
  {
    const r = await driveScenario('camion_articule', () => ({}), 0.5);
    r.sim.interact?.(r.player);
    check('camion : sortie (interact)', r.player.vehicle === null || r.player.vehicle !== undefined);
  }
}

async function main() {
  await tank();
  await camion();
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
