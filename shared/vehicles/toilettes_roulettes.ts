// Toilettes à roulettes : lourdes (10 m/s max) et très stables. m1 maintenu = ventouse qui tire un prop/véhicule léger,
// m2 = chasse d'eau (poussée vers l'arrière 1,5 s, recharge 8 s). Le couvercle s'ouvre tout seul dans les virages.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { G, grp, type VehicleDef, type SimProp, type SimVehicle } from '../api';
import { bodyOk } from '../guard';

const MASS = 650;
const MAX_SPEED = 10;
const FLUSH_MS = 1500;
const FLUSH_COOLDOWN_MS = 8000;
const SUCK_RANGE = 20;
const SUCK_MAX_MASS = 700;

export const def: VehicleDef = {
  type: 'toilettes_roulettes',
  name: 'les toilettes à roulettes',
  emoji: '🚽',
  enterRadius: 4,
  exitOffset: 2.8,
  seats: 1,
  maxHp: 200,
  armor: { impact: 0.6, explosion: 1.3, bullet: 0.7 },
  impact: { threshold: 9, scale: 2 },
  spawns: [[6, 20, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + 0.2, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.5).setAngularDamping(4).enabledRotations(false, true, false),
    );
    api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(0.6, 0.65, 0.7).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);
    let steer = 0;
    let lid = 0; // 0 fermé .. 1 ouvert
    let flushUntil = 0;
    let flushReady = 0;
    let prevM2 = 0;
    let target: { prop?: SimProp; veh?: SimVehicle } | null = null;
    let sucking = 0;
    let nextSuckFx = 0;

    const targetBody = (): RAPIER.RigidBody | null => {
      if (!target) return null;
      if (target.prop) return api.props.get(target.prop.id) === target.prop && bodyOk(target.prop.body) ? target.prop.body : null;
      if (target.veh && !target.veh.dead) return bodyOk(target.veh.behavior.body) ? target.veh.behavior.body : null;
      return null;
    };

    return {
      body,
      step({ input, api, dt, self }) {
        const t = body.translation();
        const pos = new THREE.Vector3(t.x, t.y, t.z);
        const q = api.quatOf(body);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        steer = -input.s;
        const sp = api.forwardSpeed(body);

        // chasse d'eau
        if (input.m2 && !prevM2 && api.time >= flushReady) {
          flushUntil = api.time + FLUSH_MS;
          flushReady = api.time + FLUSH_MS + FLUSH_COOLDOWN_MS;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh', a: 10 });
          api.fx({ k: 'text', p: [t.x, t.y + 2, t.z], s: 'CHASSE D\'EAU !', c: 0x9fe3ff });
        }
        prevM2 = input.m2;
        const flushing = api.time < flushUntil;

        if (flushing) {
          api.driveArcade(body, MASS, 22, -1, steer * 0.8);
          if (Math.round(api.time / dt) % 2 === 0) {
            const jet = pos.clone().addScaledVector(fwd, 0.8).add(new THREE.Vector3(0, 0.5, 0));
            api.fx({ k: 'smoke', p: [jet.x, jet.y, jet.z], a: 0.7, b: 2, c: 0xbfeaff });
            api.fx({ k: 'spark', p: [jet.x, jet.y + 0.3, jet.z], a: 1.2, b: 6, c: 0x9fe3ff });
          }
          if (Math.round(api.time / dt) % 20 === 0) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh', a: 10 });
        } else {
          const turn = steer * Math.max(-1, Math.min(1, Math.abs(sp) / 3)) * Math.sign(sp || 1) * 1.1;
          api.driveArcade(body, MASS, 6, input.f, turn);
          const v = body.linvel();
          const h = Math.hypot(v.x, v.z);
          if (h > MAX_SPEED) body.setLinvel({ x: (v.x / h) * MAX_SPEED, y: v.y, z: (v.z / h) * MAX_SPEED }, true);
        }
        if (input.jump) {
          const v = body.linvel();
          body.setLinvel({ x: v.x * 0.94, y: v.y, z: v.z * 0.94 }, true);
        }

        // ventouse
        sucking = 0;
        if (input.m1 && self.driver) {
          let tb = targetBody();
          if (tb) {
            const tp = tb.translation();
            if (pos.distanceTo(new THREE.Vector3(tp.x, tp.y, tp.z)) > SUCK_RANGE + 6) { target = null; tb = null; }
          }
          if (!tb) {
            const dir = new THREE.Vector3(...input.ad);
            if (dir.lengthSq() < 0.01) dir.copy(fwd);
            dir.normalize();
            // 1) rayon de visée de la caméra, 2) à défaut deux rayons droit devant (bas puis haut) : 20 m de portée
            const cam = new THREE.Vector3(...input.ao);
            let hit = cam.lengthSq() > 0.01 ? api.raycast(cam, dir, SUCK_RANGE + 12, body) : null;
            if (hit && hit.point.distanceTo(pos) > SUCK_RANGE) hit = null;
            if (!hit || (hit.kind !== 'prop' && hit.kind !== 'vehicle')) {
              for (const h of [0.2, 1.2]) {
                const o = pos.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(fwd, 1.2);
                const hh = api.raycast(o, fwd, SUCK_RANGE, body);
                if (hh && (hh.kind === 'prop' || hh.kind === 'vehicle')) { hit = hh; break; }
              }
            }
            target = null;
            if (hit?.kind === 'prop' && hit.prop && !hit.prop.frozen && !hit.prop.held && hit.prop.body.mass() <= SUCK_MAX_MASS) target = { prop: hit.prop };
            else if (hit?.kind === 'vehicle' && hit.vehicle && hit.vehicle !== self && !hit.vehicle.dead
              && (hit.vehicle.behavior.body?.mass() ?? 1e9) <= SUCK_MAX_MASS) target = { veh: hit.vehicle };
            tb = targetBody();
            if (tb) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
          }
          if (tb) {
            const tp = tb.translation();
            const to = pos.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(new THREE.Vector3(tp.x, tp.y, tp.z));
            const d = to.length();
            const lv = tb.linvel();
            if (d > 2.4) {
              to.normalize();
              // impulsions douces : Δv ≈ 0,5 m/s par pas, vitesse d'approche plafonnée à 12 m/s
              const m = tb.mass();
              const along = lv.x * to.x + lv.y * to.y + lv.z * to.z;
              if (along < 12) tb.applyImpulse({ x: to.x * m * 0.5, y: to.y * m * 0.5 + m * 0.16, z: to.z * m * 0.5 }, true);
            } else {
              tb.setLinvel({ x: lv.x * 0.8, y: lv.y * 0.8, z: lv.z * 0.8 }, true); // collé aux toilettes
            }
            sucking = 1;
            if (target?.veh) target.veh.noImpactUntil = api.time + 400;
            if (api.time > nextSuckFx) {
              nextSuckFx = api.time + 120;
              api.fx({ k: 'beam', p: [t.x, t.y + 1, t.z], t: [tp.x, tp.y, tp.z], a: 0.07, c: 0x8fd0ff });
            }
          }
        } else {
          target = null;
        }

        // couvercle : s'ouvre dans les virages (glou)
        const want = Math.abs(steer) > 0.3 && Math.abs(sp) > 1.5 ? 1 : 0;
        const prevLid = lid;
        lid += (want - lid) * Math.min(1, dt * 6);
        if (prevLid < 0.5 && lid >= 0.5) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' }); // « glou »
        if (prevLid >= 0.5 && lid < 0.5) api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
      },
      anim: () => ({
        sp: api.forwardSpeed(body), st: steer,
        a: [lid, api.time < flushUntil ? 1 : 0, Math.max(0, Math.min(1, (flushReady - api.time) / (FLUSH_MS + FLUSH_COOLDOWN_MS))), sucking],
      }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
