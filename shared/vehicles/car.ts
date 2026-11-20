// Voiture : conduite arcade (poussée, adhérence latérale, braquage proportionnel à la vitesse). Deux places.
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';

const MASS = 800;

export const def: VehicleDef = {
  type: 'car',
  name: 'la voiture',
  emoji: '🚗',
  enterRadius: 5,
  exitOffset: 3.5,
  seats: 2,
  maxHp: 100,
  armor: { impact: 1, explosion: 1.3, bullet: 1 },
  impact: { threshold: 7, scale: 3.5 },
  spawns: [[-6, -4, 0], [-3, -6, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.45).setAngularDamping(2.5).enabledRotations(false, true, false),
    );
    api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(1, 0.45, 2).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);
    let steer = 0;
    let hornAt = 0;
    return {
      body,
      step({ input, api }) {
        steer = -input.s;
        const sp = api.forwardSpeed(body);
        const turn = steer * Math.max(-1, Math.min(1, sp / 6)) * 1.8;
        api.driveArcade(body, MASS, 14, input.f, turn);
        if (input.jump) { // frein à main
          const v = body.linvel();
          body.setLinvel({ x: v.x * 0.96, y: v.y, z: v.z * 0.96 }, true);
        }
        if (input.hn && api.time > hornAt) {
          hornAt = api.time + 600;
          const t = body.translation();
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_car' });
        }
      },
      anim: () => ({ sp: api.forwardSpeed(body), st: steer, a: [] }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
