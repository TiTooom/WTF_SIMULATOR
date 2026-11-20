// Dirigeable à pédales : l'avancée dépend de la cadence de frappe de la touche « avant » (fronts montants de input.f).
// Touché, le ballon siffle et descend en planant (fuite) au lieu d'exploser ; une rustine le regonfle après atterrissage.
// anim().a = [cadence (pédalages/s), fuite 0..1, lest prêt 0..1, trompette (0..1), roulis]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';

const MASS = 400;
const MAX_SPEED = 14;
const PER_PRESS = 2.6; // m/s de vitesse cible par pédalage/s
const BALLAST_CD = 8000;
const TRUMPET_CD = 900;

export const def: VehicleDef = {
  type: 'dirigeable_pedales',
  name: 'le dirigeable à pédales',
  emoji: '🎈',
  enterRadius: 6,
  exitOffset: 3.2,
  seats: 2,
  maxHp: 50,
  armor: { impact: 1, explosion: 2.5, bullet: 1.2 },
  impact: { threshold: 10, scale: 2 },
  spawns: [[40, 25, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.05).setAngularDamping(3).enabledRotations(false, true, false).setCanSleep(false).setGravityScale(0),
    );
    const sl = (d: RAPIER.ColliderDesc) => api.sliding(d).setCollisionGroups(grp(G.VEHICLE));
    api.world.createCollider(sl(RAPIER.ColliderDesc.cuboid(1.6, 1.6, 4.3).setTranslation(0, 1.6, 0).setMass(MASS * 0.6)), body); // ballon
    api.world.createCollider(sl(RAPIER.ColliderDesc.cuboid(1.0, 0.5, 1.3).setTranslation(0, -0.6, 0).setMass(MASS * 0.4)), body); // nacelle

    const presses: number[] = []; // dates (ms) des coups de pédale
    let prevF = 0, prevM1 = 0, prevM2 = 0;
    let cadence = 0;
    let leak = 0; // secondes de fuite restantes
    let leakMax = 1;
    let lastHp = -1;
    let ballastAt = 0, trumpetAt = 0, trumpetFx = 0;
    let smokeAt = 0, roll = 0;
    let grounded = false;

    return {
      body,
      step({ input, driver, api, self, dt }) {
        const t = body.translation();
        const lv = body.linvel();
        const now = api.time;
        const q = api.quatOf(body);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const hasDriver = !!driver;
        const inp = hasDriver ? input : null;

        // fuite : toute perte de PV perce le ballon (longue si les PV sont bas)
        if (lastHp < 0) lastHp = self.hp;
        if (self.hp < lastHp - 0.5 && !self.dead) {
          const low = self.hp / self.def.maxHp < 0.5;
          leakMax = low ? 14 : 6;
          leak = leakMax;
          api.fx({ k: 'sound', p: [t.x, t.y + 2, t.z], s: 'whoosh' });
          api.fx({ k: 'text', p: [t.x, t.y + 4, t.z], s: 'pfffff…', c: 0xffffff });
        }
        lastHp = self.hp;
        const leaking = leak > 0;
        if (leaking) {
          leak -= dt * (grounded ? 3 : 1);
          if (leak <= 0) {
            leak = 0;
            api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Rustine ! 🩹', c: 0x9dff8a });
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
          }
          if (now > smokeAt) {
            smokeAt = now + 220;
            api.fx({ k: 'smoke', p: [t.x + right.x * 1.7, t.y + 1.8, t.z + right.z * 1.7], a: 0.7 });
          }
        }

        const down = api.raycast(new THREE.Vector3(t.x, t.y - 0.5, t.z), new THREE.Vector3(0, -1, 0), 0.8, body);
        grounded = !!down;

        // pédalage : fronts montants de f sur la dernière seconde
        const fOn = inp && inp.f > 0.5 ? 1 : 0;
        if (fOn && !prevF) presses.push(now);
        prevF = fOn;
        while (presses.length && now - presses[0] > 1000) presses.shift();
        cadence += (presses.length - cadence) * 0.15;
        const target = Math.min(MAX_SPEED, presses.length * PER_PRESS) * (leaking ? 0.5 : 1);

        let vx = lv.x, vy = lv.y, vz = lv.z;
        const vf = vx * fwd.x + vz * fwd.z;
        const lat = vx * right.x + vz * right.z;
        if (inp && inp.f < -0.5) { // s : frein / marche arrière lente
          vx *= 0.97; vz *= 0.97;
        } else if (presses.length) {
          if (target > vf) { const dv = Math.min(4 * dt, target - vf); vx += fwd.x * dv; vz += fwd.z * dv; }
          else { vx *= 1 - 0.3 * dt; vz *= 1 - 0.3 * dt; }
        } else { vx *= 1 - 0.35 * dt; vz *= 1 - 0.35 * dt; } // il dérive et ralentit
        vx -= right.x * lat * 0.05; vz -= right.z * lat * 0.05; // la dérive latérale s'éteint

        // altitude : flottabilité douce ; en fuite il plane vers le sol
        let vyTarget = 0;
        if (inp) vyTarget = inp.th * 3.5;
        if (t.y > 70 && vyTarget > 0) vyTarget = 0;
        if (leaking) vyTarget = inp && inp.th > 0 ? -1.5 : -3.2;
        vy += (vyTarget - vy) * 0.04;
        body.setLinvel({ x: vx, y: vy, z: vz }, true);

        const turn = inp ? -(inp.yw + inp.s) * 0.75 : 0;
        body.setAngvel({ x: 0, y: turn, z: 0 }, true);
        roll += (-turn * 0.25 - roll) * 0.08;

        // lest : une grosse caisse tombe de la nacelle
        const ready = now >= ballastAt;
        if (inp && inp.m1 && !prevM1 && ready) {
          ballastAt = now + BALLAST_CD;
          const p = api.spawnProp('crate_l', new THREE.Vector3(t.x, t.y - 2.4, t.z), undefined, new THREE.Vector3(vx, Math.min(vy, 0) - 1, vz), driver);
          if (p) api.fx({ k: 'text', p: [t.x, t.y - 1, t.z], s: 'Lest !', c: 0xe9c46a });
        }
        // trompette
        if (inp && inp.m2 && !prevM2 && now >= trumpetAt) {
          trumpetAt = now + TRUMPET_CD;
          trumpetFx = now + 500;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_2' });
          api.fx({ k: 'text', p: [t.x + fwd.x * 2, t.y + 1, t.z + fwd.z * 2], s: 'BRRRT !', c: 0xffe066 });
        }
        prevM1 = inp && inp.m1 ? 1 : 0;
        prevM2 = inp && inp.m2 ? 1 : 0;
      },
      anim() {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
        const lv = body.linvel();
        return {
          sp: lv.x * fwd.x + lv.z * fwd.z, st: 0,
          a: [cadence, leak > 0 ? Math.min(1, 0.3 + leak / leakMax * 0.7) : 0, Math.min(1, Math.max(0, 1 - (ballastAt - api.time) / BALLAST_CD)), api.time < trumpetFx ? 1 : 0, roll],
        };
      },
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
