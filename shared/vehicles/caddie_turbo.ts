// Caddie turbo : très léger et nerveux. Dérapage (Espace), klaxon « bip-bip » (m1), turbo 3 s / recharge 10 s (m2).
// Deux places : le passager est debout dans le panier. Chaque choc fait « bip », les roues crient dans les virages.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { G, grp, type VehicleDef } from '../api';

const MASS = 120;
const ACCEL = 20;
const TURBO_ACCEL = 34;
const TURBO_MS = 3000;
const TURBO_RECHARGE_MS = 10000;

export const def: VehicleDef = {
  type: 'caddie_turbo',
  name: 'le caddie turbo',
  emoji: '🛒',
  enterRadius: 4,
  exitOffset: 2.2,
  seats: 2,
  maxHp: 50,
  armor: { impact: 1, explosion: 2.6, bullet: 1.2 },
  impact: { threshold: 6, scale: 2.2 },
  spawns: [[-4, 14, 0], [0, 14, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + 0.2, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.7).setAngularDamping(3).enabledRotations(false, true, false),
    );
    api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(0.42, 0.4, 0.6).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);
    let steer = 0;
    let hornAt = 0;
    let turboUntil = 0;
    let turboReady = 0;
    let screechAt = 0;
    let bipAt = 0;
    let drift = 0;
    let hornPulse = 0;
    let prevM2 = 0;

    return {
      body,
      step({ input, api, dt }) {
        const t = body.translation();
        const q = api.quatOf(body);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const v = body.linvel();
        const lateral = v.x * right.x + v.z * right.z;
        const sp = api.forwardSpeed(body);
        steer = -input.s;

        // turbo (front montant de m2)
        if (input.m2 && !prevM2 && api.time >= turboReady) {
          turboUntil = api.time + TURBO_MS;
          turboReady = api.time + TURBO_MS + TURBO_RECHARGE_MS;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
          api.fx({ k: 'text', p: [t.x, t.y + 1.6, t.z], s: 'TURBO !', c: 0xff8a1a });
        }
        prevM2 = input.m2;
        const turbo = api.time < turboUntil;

        const turn = steer * Math.max(-1, Math.min(1, sp / 4)) * (turbo ? 2.0 : 2.4);
        api.driveArcade(body, MASS, turbo ? TURBO_ACCEL : ACCEL, turbo ? (input.f || 1) : input.f, turn);

        // dérapage : on rend 85 % de l'adhérence latérale retirée par driveArcade
        drift = 0;
        if (input.jump) {
          body.applyImpulse(right.clone().multiplyScalar(lateral * MASS * 0.9 * 0.85), true);
          body.setAngvel({ x: 0, y: turn * 1.6, z: 0 }, true);
          drift = 1;
        }
        // survirage : petit lacet supplémentaire quand on glisse (le caddie "chasse")
        const sliding = Math.abs(lateral) > 4 && Math.hypot(v.x, v.z) > 6;
        if (sliding && api.time > screechAt) {
          screechAt = api.time + 650;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh', a: 4 }); // crissement (pas de son « squeal » dédié)
          api.fx({ k: 'smoke', p: [t.x - fwd.x * 0.5, t.y - 0.2, t.z - fwd.z * 0.5], a: 0.5, b: 2 });
        }

        if (turbo) {
          if (Math.round(api.time / dt) % 3 === 0) {
            api.fx({ k: 'smoke', p: [t.x - fwd.x * 0.9, t.y + 0.1, t.z - fwd.z * 0.9], a: 0.7, b: 2 });
            api.fx({ k: 'spark', p: [t.x - fwd.x * 0.9, t.y, t.z - fwd.z * 0.9], a: 0.6, b: 4, c: 0xff7a1a });
          }
        }

        hornPulse = Math.max(0, hornPulse - dt * 4);
        if (input.m1 && api.time > hornAt) {
          hornAt = api.time + 600;
          hornPulse = 1;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_5' });
        }
      },
      onImpact(dv, ctx) {
        if (ctx.api.time < bipAt) return;
        bipAt = ctx.api.time + 250;
        const t = body.translation();
        ctx.api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'bloop' }); // « bip » de caisse de supermarché
        if (dv > 9) ctx.api.fx({ k: 'text', p: [t.x, t.y + 1.3, t.z], s: 'BIP !', c: 0xffe066 });
      },
      anim: () => ({
        sp: api.forwardSpeed(body), st: steer,
        a: [api.time < turboUntil ? 1 : 0, drift, hornPulse, Math.max(0, Math.min(1, (turboReady - api.time) / (TURBO_MS + TURBO_RECHARGE_MS)))],
      }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
