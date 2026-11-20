// Canapé-fusée : poussée maintenue + un peu de portance, saut « ressort », coussins en projectiles, boost turbo.
// anim().a = [cabrage, roulis, turbo actif (0/1), poussée 0..1, compression du ressort 0..1, recharge du turbo 0..1]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';

const MASS = 350;
const BOOST_MS = 2000;
const BOOST_CD = 6000;
const CUSHION_CD = 450;

export const def: VehicleDef = {
  type: 'canape_fusee',
  name: 'le canapé-fusée',
  emoji: '🛋️',
  enterRadius: 5,
  exitOffset: 2.8,
  seats: 2,
  maxHp: 80,
  armor: { impact: 0.8, explosion: 0.7, bullet: 0.8 }, // la mousse amortit
  impact: { threshold: 24, scale: 3 },
  spawns: [[-14, 24, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.05).setAngularDamping(3).enabledRotations(false, true, false).setCanSleep(false),
    );
    api.world.createCollider(
      api.sliding(RAPIER.ColliderDesc.cuboid(1.2, 0.55, 0.6).setMass(MASS))
        .setRestitution(0.55).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(grp(G.VEHICLE)),
      body,
    );
    let pitch = 0, roll = 0, thrust = 0, coil = 0;
    let boostUntil = 0, boostReady = 0;
    let prevJump = 0, prevM1 = 0, prevM2 = 0;
    let jumpAt = 0, cushionAt = 0, boingAt = 0;
    let setVy = 0;
    let flip = 0;

    return {
      body,
      step({ input, driver, api, self }) {
        const t = body.translation();
        const lv = body.linvel();
        const q = api.quatOf(body);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const g = -api.world.gravity.y;
        const now = api.time;
        const boosting = now < boostUntil;
        const hasDriver = !!driver;
        const inp = hasDriver ? input : null;

        const down = api.raycast(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0), 1.6, body);
        const grounded = !!down && down.dist < 0.9;

        // atterrissage : « boïoïng » + confettis
        if (setVy < -4 && lv.y > setVy + 3 && now > boingAt) {
          boingAt = now + 250;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
          api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'BOÏOÏNG', c: 0xffd23f });
          api.fx({ k: 'confetti', p: [t.x, t.y + 0.4, t.z], c: 0xffd23f, a: 0.7, b: 16 });
          coil = 1;
        }

        let vx = lv.x, vy = lv.y, vz = lv.z;
        let thr = 0;
        if (inp) {
          thr = inp.f > 0 ? inp.f : inp.f * 0.4;
          const accel = boosting ? 46 : 21;
          vx += fwd.x * thr * accel * (1 / 60);
          vz += fwd.z * thr * accel * (1 / 60);
          // adhérence latérale douce (le canapé suit son nez)
          const lat = vx * right.x + vz * right.z;
          const k = thr !== 0 ? 0.06 : 0.02;
          vx -= right.x * lat * k;
          vz -= right.z * lat * k;
          // portance : plus il va vite, moins il pèse (il peut voler bas)
          const sp = Math.hypot(vx, vz);
          const liftK = Math.min(0.85, sp / 24) * (thr > 0 ? 1 : 0.5);
          if (vy < 0) vy += g * liftK * (1 / 60); // elle freine la chute, sans le faire grimper
          if (inp.th > 0) vy += 22 * inp.th * (1 / 60) * (t.y > 70 ? 0 : 1);
          else if (inp.th < 0) vy += 14 * inp.th * (1 / 60);
          // plafond de vitesse (le turbo le relève)
          const cap = boosting ? 52 : 30;
          const h = Math.hypot(vx, vz);
          if (h > cap) { const k = Math.max(cap / h, 0.985); vx *= k; vz *= k; }
          if (thr === 0) { vx *= 0.992; vz *= 0.992; }
          body.setAngvel({ x: 0, y: -(inp.yw + inp.s) * 2.6, z: 0 }, true);

          // saut « ressort » : seulement quand il touche (presque) le sol
          if (inp.jump && !prevJump && grounded && now > jumpAt) {
            jumpAt = now + 400;
            vy = 15;
            coil = 1;
            self.noImpactUntil = now + 200;
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
            api.fx({ k: 'text', p: [t.x, t.y + 1.5, t.z], s: 'BOÏNG !', c: 0xffd23f });
            api.fx({ k: 'confetti', p: [t.x, t.y - 0.3, t.z], c: 0xff6fa5, a: 0.6, b: 14 });
          }

          // coussin : projectile mou qui rebondit et finit en confettis
          if (inp.m1 && !prevM1 && now > cushionAt) {
            cushionAt = now + CUSHION_CD;
            const dir = new THREE.Vector3(inp.ad[0], inp.ad[1], inp.ad[2]);
            if (dir.lengthSq() < 0.01) dir.copy(fwd); else dir.normalize();
            const pos = new THREE.Vector3(t.x, t.y + 0.9, t.z).addScaledVector(dir, 2);
            const vel = dir.multiplyScalar(26).add(new THREE.Vector3(vx, 0, vz).multiplyScalar(0.5));
            api.spawnProjectile({
              kind: 'cushion', pos, vel, owner: driver, gravity: 9, life: 4, fuse: true, bounce: true,
              onHit: (_h, at) => {
                api.fx({ k: 'confetti', p: [at.x, at.y, at.z], c: 0xffd23f, a: 0.5, b: 10 });
                api.fx({ k: 'sound', p: [at.x, at.y, at.z], s: 'pop' });
              },
            });
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
          }

          // turbo
          if (inp.m2 && !prevM2 && now >= boostReady) {
            boostUntil = now + BOOST_MS;
            boostReady = now + BOOST_CD;
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'rocket' });
            api.fx({ k: 'flash', p: [t.x + fwd.x * -1.4, t.y, t.z + fwd.z * -1.4], a: 2, c: 0xffa633 });
            api.fx({ k: 'shake', p: [t.x, t.y, t.z], a: 0.3 });
          }
          if (boosting && Math.floor(now / 120) !== flip) {
            flip = Math.floor(now / 120);
            api.fx({ k: 'smoke', p: [t.x - fwd.x * 1.6, t.y + 0.2, t.z - fwd.z * 1.6], a: 0.8 });
          }
          prevJump = inp.jump ? 1 : 0; prevM1 = inp.m1 ? 1 : 0; prevM2 = inp.m2 ? 1 : 0;
        } else {
          prevJump = prevM1 = prevM2 = 0;
          vx *= 0.99; vz *= 0.99;
        }
        body.setLinvel({ x: vx, y: vy, z: vz }, true);
        setVy = vy;

        thrust += (Math.abs(thr) - thrust) * 0.2;
        coil *= 0.9;
        pitch += (Math.max(-0.35, Math.min(0.35, vy * 0.025)) + thr * 0.06 - pitch) * 0.1;
        roll += ((inp ? (inp.yw + inp.s) * 0.2 : 0) - roll) * 0.1;
      },
      anim() {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
        const lv = body.linvel();
        return {
          sp: lv.x * fwd.x + lv.z * fwd.z, st: 0,
          a: [pitch, roll, api.time < boostUntil ? 1 : 0, thrust, coil, Math.min(1, Math.max(0, 1 - (boostReady - api.time) / BOOST_CD))],
        };
      },
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
