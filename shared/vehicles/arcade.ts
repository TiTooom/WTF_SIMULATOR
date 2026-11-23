// PROPRIÉTAIRE : game-camera-driving
// À IMPLÉMENTER : makeArcadeCar (conduite arcade assistée : adhérence, frein à main, aide directionnelle) + les 4 véhicules (citadine, berline, camionnette, police) qui remplacent shared/vehicles/car.ts.
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';
import type { VehicleType } from '../ids';

export interface CarSpec {
  type: VehicleType;
  name: string; // « la citadine » (avec article)
  emoji: string;
  mass: number;
  accel: number;
  half: [number, number, number]; // demi-dimensions du châssis
  seats: number;
  maxHp: number;
}

/** Squelette : la physique actuelle de la citadine, paramétrée. À remplacer par la vraie conduite arcade. */
export function makeArcadeCar(spec: CarSpec): VehicleDef {
  return {
    type: spec.type, name: spec.name, emoji: spec.emoji, enterRadius: 5, exitOffset: 3.5, seats: spec.seats, maxHp: spec.maxHp,
    armor: { impact: 1, explosion: 1.3, bullet: 1 }, impact: { threshold: 7, scale: 3.5 }, spawns: [],
    create(api, x, y, z, yaw) {
      const body = api.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setLinearDamping(0.45).setAngularDamping(2.5).enabledRotations(false, true, false),
      );
      api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(...spec.half).setMass(spec.mass)).setCollisionGroups(grp(G.VEHICLE)), body);
      let steer = 0;
      return {
        body,
        step({ input, api }) {
          steer = -input.s;
          const sp = api.forwardSpeed(body);
          api.driveArcade(body, spec.mass, spec.accel, input.f, steer * Math.max(-1, Math.min(1, sp / 6)) * 1.8);
        },
        anim: () => ({ sp: api.forwardSpeed(body), st: steer, a: [] }),
        dispose() { /* jamais appelé pour un véhicule du pool */ },
      };
    },
  };
}
