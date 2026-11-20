// Avion de chasse : vol arcade (poussée, portance ~ vitesse², alignement de la vitesse sur le nez, stabilisation douce),
// roulage sur train sortable (glisse sur le ventre train rentré), mitrailleuse (m1), missile à tête chercheuse (m2).
// anim().a = [train 0..1, gaz 0..1, roulis, tangage, lacet, missile prêt 0..1, au sol 0|1]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type SimApi, type VehicleDef } from '../api';
import { STEP } from '../constants';
import { bodyOk } from '../guard';

const GRAV = 9.81;
const VC = 34; // vitesse de sustentation (m/s) : portance = poids
const VMAX = 100;
const THRUST = 19; // m/s² plein gaz à l'arrêt
const DRAG = 0.0021;
const GEAR_H = 1.3; // hauteur sous le centre en dessous de laquelle on est « au sol » train sorti
const BELLY_H = 0.85;
const MISSILE_COOLDOWN = 4000;
const GUN_EVERY = 3; // pas physiques entre deux balles (20 tirs/s)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

interface Tracked { pr: { pos: THREE.Vector3; vel: THREE.Vector3; life: number }; target: (() => THREE.Vector3 | null) | null }

export const def: VehicleDef = {
  type: 'avion_chasse',
  name: "l'avion de chasse",
  emoji: '✈️',
  enterRadius: 7,
  exitOffset: 5,
  seats: 1,
  maxHp: 90,
  armor: { impact: 1, explosion: 1.5, bullet: 0.8 },
  // un choc de Δv > 9 m/s en un pas fait mal, > ~11 m/s détruit l'appareil ; un atterrissage doux (< 6 m/s verticaux) ne coûte rien
  impact: { threshold: 9, scale: 40 },
  spawns: [[80, -30, 0]],
  create(api, x, y, z, yaw) {
    const world = api.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0).setAngularDamping(0.5).setCanSleep(false),
    );
    const hullGroups = grp(G.VEHICLE);
    const hull = (d: RAPIER.ColliderDesc, mass: number) =>
      world.createCollider(d.setMass(mass).setFriction(0.3).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0).setCollisionGroups(hullGroups), body);
    hull(RAPIER.ColliderDesc.cuboid(0.65, 0.55, 4.3).setTranslation(0, -0.05, 0), 1100); // fuselage
    hull(RAPIER.ColliderDesc.cuboid(4, 0.08, 1.3).setTranslation(0, -0.15, 0.9), 450); // ailes
    hull(RAPIER.ColliderDesc.cuboid(0.08, 0.9, 0.8).setTranslation(0, 1.0, 3.4), 80); // dérive
    hull(RAPIER.ColliderDesc.cuboid(1.7, 0.06, 0.6).setTranslation(0, 0.1, 3.7), 80); // stabilisateurs
    // train d'atterrissage : billes sans friction (la friction latérale est gérée à la main)
    const gear: RAPIER.Collider[] = [];
    for (const [gx, gz] of [[0, -2.6], [-1.3, 0.9], [1.3, 0.9]]) {
      gear.push(world.createCollider(
        api.sliding(RAPIER.ColliderDesc.ball(0.3).setTranslation(gx, -0.75, gz).setMass(30)).setRestitution(0).setCollisionGroups(hullGroups), body,
      ));
    }
    const setGear = (out: boolean) => { for (const c of gear) c.setEnabled(out); };

    let gearOut = true;
    let gearPos = 1; // 1 = sorti
    let thr = 0;
    let prevHn = 0;
    let gunTick = 0;
    let nextMissile = 0;
    let cmdS = 0, cmdF = 0, cmdY = 0;
    let grounded = true;
    let slideT = 0;
    const missiles: Tracked[] = [];

    const V = (a: { x: number; y: number; z: number }) => new THREE.Vector3(a.x, a.y, a.z);
    const DOWN = new THREE.Vector3(0, -1, 0);

    /** Cible la plus proche dans un cône devant l'appareil (véhicules et joueurs à pied). */
    const pickTarget = (api: SimApi, origin: THREE.Vector3, fw: THREE.Vector3, self: unknown, driverId: string | undefined): (() => THREE.Vector3 | null) | null => {
      let best: (() => THREE.Vector3 | null) | null = null;
      let bd = 450;
      const cosCone = Math.cos(0.65);
      const test = (p: THREE.Vector3, get: () => THREE.Vector3 | null) => {
        const d = p.clone().sub(origin);
        const dist = d.length();
        if (dist < 12 || dist > bd) return;
        if (d.dot(fw) / dist < cosCone) return;
        bd = dist;
        best = get;
      };
      for (const v of api.vehicles) {
        if (v === self || v.dead || !bodyOk(v.behavior.body)) continue;
        const b = v.behavior.body;
        // la cible peut mourir / être retirée entre deux ticks : ne lire son corps que s'il existe encore
        test(V(b.translation()), () => (v.dead || !bodyOk(v.behavior.body) ? null : V(v.behavior.body.translation())));
      }
      for (const p of api.players.values()) {
        if (p.id === driverId || p.vehicle || p.hp <= 0) continue;
        test(V(p.body.translation()), () => (p.hp <= 0 || api.players.get(p.id) !== p || !bodyOk(p.body) ? null : V(p.body.translation())));
      }
      return best;
    };

    const stepMissiles = () => {
      if (!missiles.length) return;
      const live = (api as unknown as { projs?: unknown[] }).projs;
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (m.pr.life <= 0 || (live && !live.includes(m.pr))) { missiles.splice(i, 1); continue; }
        if (m.pr.life > 4.6) continue; // droit les 0,4 premières secondes (dégagement)
        const tp = m.target?.();
        if (!tp) continue;
        const sp = m.pr.vel.length();
        const want = tp.sub(m.pr.pos);
        if (want.lengthSq() < 1e-4 || sp < 1) continue;
        want.normalize();
        const cur = m.pr.vel.clone().divideScalar(sp);
        const ang = Math.acos(clamp(cur.dot(want), -1, 1));
        if (ang < 1e-4) continue;
        const k = Math.min(1, (1.7 * STEP) / ang); // rotation maximale 1,7 rad/s
        cur.lerp(want, k).normalize();
        m.pr.vel.copy(cur.multiplyScalar(sp));
      }
    };

    return {
      body,
      step({ input, api, driver, self }) {
        const t = body.translation();
        const q = api.quatOf(body);
        const invQ = q.clone().invert();
        const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const lin = body.linvel();
        const v = V(lin);
        const vf = v.dot(fw);
        const pos = V(t);
        stepMissiles();

        // ---- manche à gaz persistant, train, armes ----
        if (driver) thr = clamp(thr + input.th * 0.7 * STEP, 0, 1);
        else thr = Math.max(0, thr - 0.5 * STEP);
        if (driver && input.hn && !prevHn) {
          gearOut = !gearOut;
          setGear(gearOut);
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
          api.fx({ k: 'text', p: [t.x, t.y + 2.5, t.z], s: gearOut ? 'Train sorti !' : 'Train rentré !' });
        }
        prevHn = driver ? input.hn : 0;
        gearPos += clamp((gearOut ? 1 : 0) - gearPos, -1.6 * STEP, 1.6 * STEP);
        cmdS = input.s; cmdF = input.f; cmdY = input.yw;

        const ray = api.raycast(pos, DOWN, 40, body);
        const h = ray && ray.kind === 'static' ? ray.dist : Math.max(0.2, t.y);
        grounded = h < (gearOut ? GEAR_H : BELLY_H);

        if (driver && input.m1 && ++gunTick >= GUN_EVERY) {
          gunTick = 0;
          for (const sx of [-3.2, 3.2]) {
            const muzzle = new THREE.Vector3(sx, -0.2, -2.2).applyQuaternion(q).add(pos);
            const dir = fw.clone();
            dir.x += (Math.random() - 0.5) * 0.02; dir.y += (Math.random() - 0.5) * 0.02; dir.z += (Math.random() - 0.5) * 0.02;
            dir.normalize();
            api.spawnProjectile({ kind: 'bullet', pos: muzzle, vel: dir.multiplyScalar(240).add(v), owner: driver, life: 1.4, damage: 5, trail: false });
          }
          if (Math.random() < 0.25) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
        } else if (!input.m1) gunTick = GUN_EVERY;
        if (driver && input.m2 && api.time >= nextMissile) {
          nextMissile = api.time + MISSILE_COOLDOWN;
          const muzzle = new THREE.Vector3(0, -0.7, -2.5).applyQuaternion(q).add(pos);
          const target = pickTarget(api, pos, fw, self, driver.id);
          const vel = fw.clone().multiplyScalar(Math.max(vf, 0) + 65);
          api.spawnProjectile({ kind: 'missile', pos: muzzle, vel, owner: driver, life: 5, radius: 7, power: 18, damage: 60, trail: true });
          const projs = (api as unknown as { projs?: Tracked['pr'][] }).projs;
          const pr = projs?.[projs.length - 1];
          if (pr && pr.vel === undefined) { /* API interne absente : missile droit */ } else if (pr) missiles.push({ pr, target });
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'rocket' });
          api.fx({ k: 'text', p: [t.x, t.y + 2.5, t.z], s: target ? 'VERROUILLÉ !' : 'Fox 2 !' });
        }

        // ---- forces (appliquées directement à la vitesse : stable et prévisible) ----
        const a = new THREE.Vector3();
        a.addScaledVector(fw, THRUST * thr * clamp01(1.15 - Math.abs(vf) / VMAX) - fw.y * 12 * (vf > 0 ? 1 : 0));
        a.addScaledVector(v, -DRAG * v.length()); // traînée
        // portance : ~ vitesse avant², jamais en dessous de zéro, effet de sol à l'atterrissage
        let L = clamp((vf / VC) ** 2, 0, 1.5);
        if (h < 6) L *= 1 + ((6 - h) / 6) * 0.3;
        const liftDir = up.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.45, 0)).normalize();
        if (vf > 0) a.addScaledVector(liftDir, GRAV * L);
        // arrondi automatique : amortit la vitesse verticale près du sol (pardonnant, mais pas assez pour sauver un piqué)
        if (!grounded && h < 5 && lin.y < -1 && vf > 12) a.y += Math.min(30, -lin.y * 1.3 * (1 - h / 5));
        v.addScaledVector(a, STEP);
        // alignement de la vitesse sur le nez (on va où l'on pointe)
        if (vf > 0) {
          const side = v.clone().addScaledVector(fw, -v.dot(fw));
          v.addScaledVector(side, -clamp01(2.4 * STEP * clamp01(vf / VC)));
        }
        // sol : grip des roues, frein, frottement
        const sp = Math.hypot(v.x, v.z);
        if (grounded) {
          const rx = right.x, rz = right.z;
          const rl = Math.hypot(rx, rz) || 1;
          const lat = (v.x * rx + v.z * rz) / rl;
          const grip = gearOut ? 0.92 : 0.35;
          v.x -= (rx / rl) * lat * grip;
          v.z -= (rz / rl) * lat * grip;
          let decel = 0;
          if (gearOut) {
            if (!driver || input.jump) decel = 14;
            else if (thr < 0.05) decel = 1.0;
          } else decel = 7 + sp * 0.06; // ventre sur le béton
          if (decel > 0 && sp > 0.01) {
            const k = Math.max(0, sp - decel * STEP) / sp;
            v.x *= k; v.z *= k;
          }
          if (!gearOut && sp > 4) { // tôle froissée
            if (--slideT <= 0) {
              slideT = 4;
              api.fx({ k: 'spark', p: [t.x - fw.x * 1.5, 0.15, t.z - fw.z * 1.5], a: 1.4, b: 8 });
              api.fx({ k: 'spark', p: [t.x + fw.x * 1.5, 0.15, t.z + fw.z * 1.5], a: 1.4, b: 8 });
              if (Math.random() < 0.5) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
              if (Math.random() < 0.12) api.fx({ k: 'text', p: [t.x, t.y + 2, t.z], s: 'KRRRRRR !' });
            }
          }
        }
        // limites de vitesse
        const spd = v.length();
        if (spd > VMAX) v.multiplyScalar(VMAX / spd);
        v.y = clamp(v.y, -70, 70);
        body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);

        // ---- rotations : vitesse angulaire visée en repère local ----
        const air = clamp01(vf / 20);
        const auth = 0.25 + 0.75 * air;
        const tgt = new THREE.Vector3();
        const rollAng = Math.atan2(right.y, up.y);
        const stall = grounded ? 0 : clamp01((VC * 0.75 - vf) / (VC * 0.4));
        // le roulis vise un angle d'inclinaison (±70°), relâcher remet à plat
        const rollCmd = clamp(4 * (-cmdS * 1.2 - rollAng), -3, 3);
        const stabPitch = -clamp(Math.asin(clamp(fw.y, -1, 1)) * 0.8, -0.9, 0.9) * (1 - Math.abs(cmdF)) * (1 - stall);
        if (grounded) {
          const canRotate = vf > 26;
          tgt.x = canRotate ? -cmdF * 1.0 : 0;
          tgt.z = 0;
          const steer = -(cmdY + cmdS * 0.6);
          const sg = gearOut ? clamp01(Math.abs(vf) / 6) : 0.15;
          const w = new THREE.Vector3(0, steer * 0.9 * sg * (vf >= 0 ? 1 : -1), 0).applyQuaternion(invQ);
          tgt.y = w.y; tgt.x += w.x; tgt.z += w.z;
        } else {
          tgt.x = -cmdF * 1.3 * auth + stabPitch - stall * 1.0;
          tgt.z = rollCmd * auth;
          tgt.y = -cmdY * 0.8 * auth;
          const bank = new THREE.Vector3(0, 1.25 * right.y * clamp01(vf / VC), 0).applyQuaternion(invQ);
          tgt.add(bank);
        }
        const av = body.angvel();
        const loc = V(av).applyQuaternion(invQ);
        loc.lerp(tgt, 1 - Math.exp(-6 * STEP));
        const wv = loc.applyQuaternion(q);
        const wl = wv.length();
        if (wl > 4) wv.multiplyScalar(4 / wl);
        body.setAngvel({ x: wv.x, y: wv.y, z: wv.z }, true);
      },
      anim: () => ({
        sp: api.forwardSpeed(body),
        st: -cmdY,
        a: [gearPos, thr, cmdS, cmdF, cmdY, clamp01(1 - Math.max(0, nextMissile - api.time) / MISSILE_COOLDOWN), grounded ? 1 : 0],
      }),
      dispose() { api.world.removeRigidBody(body); },
      state: () => [gearOut ? 1 : 0, thr],
      restore(s) {
        gearOut = s[0] > 0.5; gearPos = gearOut ? 1 : 0; setGear(gearOut); thr = clamp(s[1] ?? 0, 0, 1);
      },
    };
  },
};
