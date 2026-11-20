// OVNI : soucoupe qui rebondit comme une balle de ping-pong. Rayon tracteur (m1 maintenu), éjection radiale (m2).
// anim().a = [inclinaison avant, inclinaison côté, rayon tracteur actif (0/1), recharge de l'éjection 0..1]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';

const MASS = 600;
const MAXV = 30;
const BEAM_LEN = 15;
const EJECT_CD = 3000;
const EJECT_R = 16;

export const def: VehicleDef = {
  type: 'ovni',
  name: "l'OVNI",
  emoji: '🛸',
  enterRadius: 6,
  exitOffset: 4.2,
  seats: 2,
  maxHp: 60,
  armor: { impact: 1, explosion: 2, bullet: 1 },
  impact: { threshold: 24, scale: 2 }, // les rebonds ne lui font rien
  spawns: [[28, -10, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.08).setAngularDamping(3).enabledRotations(false, true, false).setCanSleep(false),
    );
    api.world.createCollider(
      api.sliding(RAPIER.ColliderDesc.cylinder(0.85, 2.9).setMass(MASS))
        .setRestitution(0.88).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(grp(G.VEHICLE)),
      body,
    );
    let tiltX = 0, tiltZ = 0;
    let tractor = 0;
    let ejectAt = 0;
    let prevM2 = 0;
    let setVy = 0; // vitesse verticale que nous avons imposée au pas précédent (détection des rebonds)
    let bloopAt = 0;
    let beamTick = 0;

    const lift = (h: ReturnType<typeof api.nearby>[number], t: RAPIER.Vector, up: number) => {
      const b = h.body!;
      const lv = b.linvel();
      const p = b.translation();
      b.setLinvel({ x: lv.x * 0.96 + (t.x - p.x) * 0.03, y: lv.y + (up - lv.y) * 0.12, z: lv.z * 0.96 + (t.z - p.z) * 0.03 }, true);
      if (h.vehicle) h.vehicle.noImpactUntil = api.time + 300;
    };

    return {
      body,
      step({ input, driver, api, self }) {
        const t = body.translation();
        const lv = body.linvel();
        const q = api.quatOf(body);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const hasDriver = !!driver;
        body.setGravityScale(hasDriver ? 0 : 1, true);

        // « bloop » à chaque rebond : on était en train de tomber et la vitesse verticale s'est inversée
        if (setVy < -3 && lv.y > 0.5 && api.time > bloopAt) {
          bloopAt = api.time + 150;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' });
          api.fx({ k: 'text', p: [t.x, t.y + 2, t.z], s: 'bloop !', c: 0x9dff8a });
          api.fx({ k: 'ring', p: [t.x, t.y - 0.8, t.z], a: 3, c: 0x9dff8a });
        }

        let vx = lv.x, vy = lv.y, vz = lv.z;
        if (hasDriver) {
          const wish = new THREE.Vector3().addScaledVector(fwd, input.f).addScaledVector(right, input.s);
          if (wish.lengthSq() > 1) wish.normalize();
          wish.multiplyScalar(MAXV);
          vx += (wish.x - vx) * 0.03;
          vz += (wish.z - vz) * 0.03;
          const up = input.th > 0 && t.y > 90 ? 0 : input.th * 12;
          vy += (up - vy) * 0.1;
          body.setAngvel({ x: 0, y: -input.yw * 2.2, z: 0 }, true);
        } else {
          vx *= 0.995; vz *= 0.995;
        }
        body.setLinvel({ x: vx, y: vy, z: vz }, true);
        setVy = vy;

        // inclinaison visuelle douce dans le sens du déplacement
        const vf = vx * fwd.x + vz * fwd.z;
        const vr = vx * right.x + vz * right.z;
        tiltX += (-(vf / MAXV) * 0.32 - tiltX) * 0.1;
        tiltZ += (-(vr / MAXV) * 0.32 - tiltZ) * 0.1;

        // rayon tracteur
        tractor = 0;
        if (hasDriver && input.m1) {
          tractor = 1;
          const c = new THREE.Vector3(t.x, t.y - BEAM_LEN / 2, t.z);
          let n = 0;
          for (const h of api.nearby(c, BEAM_LEN)) {
            if (!h.body || h.body === body) continue;
            const hp = h.body.translation();
            const dy = t.y - hp.y;
            if (dy < 0.6 || dy > BEAM_LEN) continue;
            if (Math.hypot(hp.x - t.x, hp.z - t.z) > 1.6 + dy * 0.3) continue;
            if (h.prop) { if (h.prop.frozen || h.prop.held || h.body.mass() > 60) continue; }
            else if (h.vehicle) { if (h.vehicle === self || h.body.mass() > 1500) continue; }
            else if (!h.player) continue;
            lift(h, t, 7);
            n++;
          }
          if (++beamTick % 8 === 0) {
            const g = api.raycast(new THREE.Vector3(t.x, t.y - 1, t.z), new THREE.Vector3(0, -1, 0), BEAM_LEN, body);
            const gy = g ? g.point.y : t.y - BEAM_LEN;
            api.fx({ k: 'beam', p: [t.x, t.y - 0.9, t.z], t: [t.x, gy, t.z], a: 0.25, c: 0xb6ff7a });
            if (n) api.fx({ k: 'spark', p: [t.x, t.y - 1.2, t.z], a: 0.3, c: 0xb6ff7a });
          }
        }

        // éjection radiale (front montant de m2, recharge 3 s)
        if (hasDriver && input.m2 && !prevM2 && api.time >= ejectAt) {
          ejectAt = api.time + EJECT_CD;
          const c = new THREE.Vector3(t.x, t.y, t.z);
          for (const h of api.nearby(c, EJECT_R)) {
            if (!h.body || h.body === body || h.vehicle === self) continue;
            const f = Math.max(0.3, 1 - h.dist / EJECT_R);
            const d = new THREE.Vector3(h.point.x - t.x, 0, h.point.z - t.z);
            if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
            d.normalize().multiplyScalar(0.85).setY(0.55).normalize();
            const m = h.body.mass();
            const dv = (22 * f) / (1 + m / 400);
            if (h.player) {
              h.player.scratch.kb = [d.x * dv * 0.8, d.z * dv * 0.8];
              const pv = h.body.linvel();
              h.body.setLinvel({ x: pv.x, y: pv.y + d.y * dv, z: pv.z }, true);
            } else {
              if (h.vehicle) h.vehicle.noImpactUntil = api.time + 400;
              else if (h.prop && h.prop.frozen) continue;
              h.body.applyImpulse({ x: d.x * dv * m, y: d.y * dv * m, z: d.z * dv * m }, true);
            }
          }
          body.setLinvel({ x: vx, y: vy + 5, z: vz }, true);
          self.noImpactUntil = api.time + 300;
          api.fx({ k: 'ring', p: [t.x, t.y, t.z], a: EJECT_R, c: 0x9dff8a });
          api.fx({ k: 'ring', p: [t.x, t.y - 0.5, t.z], a: EJECT_R * 0.6, c: 0xffffff });
          api.fx({ k: 'flash', p: [t.x, t.y, t.z], a: 4, c: 0xb6ff7a });
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'zap' });
        }
        prevM2 = input.m2 ? 1 : 0;
      },
      anim() {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
        const lv = body.linvel();
        return { sp: lv.x * fwd.x + lv.z * fwd.z, st: 0, a: [tiltX, tiltZ, tractor, Math.min(1, Math.max(0, 1 - (ejectAt - api.time) / EJECT_CD))] };
      },
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
