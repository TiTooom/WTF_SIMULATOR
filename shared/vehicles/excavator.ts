// Pelleteuse : chenilles arcade + bras dont chaque pièce est un corps cinématique (pousse et soulève les caisses).
// anim().a = [pivot cabine, flèche, bras, godet] (radians) — lu par le client.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EXC, STEP } from '../constants';
import { G, grp, type VehicleDef } from '../api';

const MASS = 5000;

export const def: VehicleDef = {
  type: 'excavator',
  name: 'la pelleteuse',
  emoji: '🚜',
  enterRadius: 7,
  exitOffset: 4.5,
  seats: 1,
  maxHp: 220,
  armor: { impact: 0.6, explosion: 0.7, bullet: 0.4 },
  impact: { threshold: 6, scale: 5 },
  spawns: [[16, 12, 0]],
  create(api, x, y, z, yaw) {
    const world = api.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.9).setAngularDamping(4).enabledRotations(false, true, false),
    );
    world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(1.75, 0.5, 2.3).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);

    // Hiérarchie sans géométrie : sert uniquement à calculer les poses du bras.
    const { L1, L2 } = EXC;
    const root = new THREE.Group();
    const turret = new THREE.Group();
    turret.position.y = EXC.turretY;
    root.add(turret);
    const boomPivot = new THREE.Group();
    boomPivot.position.set(...EXC.boomPivot);
    turret.add(boomPivot);
    const stickPivot = new THREE.Group();
    stickPivot.position.z = -L1;
    boomPivot.add(stickPivot);
    const bucketPivot = new THREE.Group();
    bucketPivot.position.z = -L2;
    stickPivot.add(bucketPivot);
    const tip = new THREE.Object3D();
    tip.position.set(0, -0.1, -1.3);
    bucketPivot.add(tip);
    const heel = new THREE.Object3D();
    heel.position.set(0, -0.1, 0.1);
    bucketPivot.add(heel);

    // Pièces mobiles : groupe PART, ne heurtent pas le châssis (VEHICLE).
    const ARM_FILTER = grp(G.PART, G.ALL & ~G.VEHICLE);
    const armBodies: [THREE.Object3D, RAPIER.RigidBody][] = [];
    const cub = (hx: number, hy: number, hz: number, px: number, py: number, pz: number) =>
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(px, py, pz);
    const armPart = (pivot: THREE.Object3D, colliders: RAPIER.ColliderDesc[]) => {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      for (const c of colliders) world.createCollider(c.setCollisionGroups(ARM_FILTER), b);
      armBodies.push([pivot, b]);
    };
    armPart(boomPivot, [cub(0.25, 0.3, L1 / 2, 0, 0, -L1 / 2)]);
    armPart(stickPivot, [cub(0.19, 0.25, L2 / 2, 0, 0, -L2 / 2)]);
    armPart(bucketPivot, [
      cub(0.7, 0.05, 0.55, 0, -0.05, -0.55),
      cub(0.7, 0.35, 0.05, 0, 0.3, -0.05),
      cub(0.05, 0.35, 0.55, -0.7, 0.3, -0.55),
      cub(0.05, 0.35, 0.55, 0.7, 0.3, -0.55),
    ]);

    const A = [EXC.rest.swing, EXC.rest.boom, EXC.rest.stick, EXC.rest.bucket];
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const syncArm = (teleport: boolean) => {
      for (const [pivot, b] of armBodies) {
        pivot.getWorldPosition(wp);
        pivot.getWorldQuaternion(wq);
        if (teleport) {
          b.setTranslation(wp, true);
          b.setRotation(wq, true);
        } else {
          b.setNextKinematicTranslation(wp);
          b.setNextKinematicRotation(wq);
        }
      }
    };
    const applyPose = () => {
      const t = body.translation();
      root.position.set(t.x, t.y, t.z);
      root.quaternion.copy(api.quatOf(body));
      turret.rotation.y = A[0];
      boomPivot.rotation.x = A[1];
      stickPivot.rotation.x = A[2];
      bucketPivot.rotation.x = A[3];
      root.updateMatrixWorld(true);
    };
    const underground = () => {
      for (const o of [bucketPivot, tip, heel]) {
        o.getWorldPosition(wp);
        if (wp.y < 0.08) return true;
      }
      return false;
    };
    const cl = (v: number, [lo, hi]: readonly number[]) => Math.max(lo, Math.min(hi, v));
    let steer = 0;
    applyPose();
    syncArm(true);

    return {
      body,
      step({ input, api }) {
        steer = -input.s;
        api.driveArcade(body, MASS, 7, input.f, steer * 0.9);
        const prev = [...A];
        A[0] += input.sw * 0.9 * STEP;
        A[1] = cl(A[1] + input.bm * 0.7 * STEP, EXC.limits.boom);
        A[2] = cl(A[2] + input.st * 0.9 * STEP, EXC.limits.stick);
        A[3] = cl(A[3] + input.bk * 1.4 * STEP, EXC.limits.bucket);
        applyPose();
        if (underground()) { // le godet ne s'enfonce pas dans le sol
          for (let k = 0; k < 4; k++) A[k] = prev[k];
          applyPose();
        }
        syncArm(false);
      },
      anim: () => ({ sp: api.forwardSpeed(body), st: steer, a: [...A] }),
      dispose() {
        for (const [, b] of armBodies) world.removeRigidBody(b);
        world.removeRigidBody(body);
      },
      state: () => [...A],
      restore(s) {
        if (s.length === 4 && s.every(Number.isFinite)) for (let k = 0; k < 4; k++) A[k] = s[k];
        applyPose();
        syncArm(true);
      },
    };
  },
};
