// Camion articulé : cabine (api.driveArcade) + remorque = second corps Rapier relié par un joint pivot vertical (vraie articulation).
// m1 : largue / rattache la remorque · m2 : ouvre la benne (6 caisses) · hn : klaxon « pouêt-pouêt » en 3 tons.
// Freinage fort à vitesse élevée = jackknife (la remorque se met en travers), récupérable en relâchant puis en accélérant.
// anim().a = [angle remorque/cabine, benne (0..1), attelée (0|1), x, y, z de la remorque dans le repère de la cabine, hayon (0..1)]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type SimPlayer, type VehicleDef } from '../api';

const CAB_MASS = 2500;
const TR_MASS = 3500;
const MAX_SPEED = 22;
const HITCH_Z = 2.0; // point d'attelage dans le repère de la cabine
const CAB_HY = 0.75; // demi-hauteur du collider de la cabine (sol = -0.75)
const TR_HY = 1.4;
const TR_ANCHOR: [number, number, number] = [0, -0.65, -3.8]; // point d'attelage dans le repère de la remorque
const AXLE_Z = 3.0; // essieu arrière de la remorque (repère remorque)
const TR_INERTIA_K = (2.6 * 2.6 + 8 * 8) / 12; // I/m d'une boîte 2,6 × 8 m autour de y
const LIMIT = 1.35; // angle max cabine/remorque (rad)
const DUMP_RELOAD_MS = 20000;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const yawQ = (y: number) => ({ x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) });

export const def: VehicleDef = {
  type: 'camion_articule',
  name: 'le camion articulé',
  emoji: '🚚',
  enterRadius: 6,
  exitOffset: 3,
  seats: 2,
  maxHp: 300,
  armor: { impact: 0.5, explosion: 0.8, bullet: 0.5 },
  impact: { threshold: 9, scale: 3 },
  spawns: [[-40, -25, 0]],
  create(api, x, y, z, yaw) {
    const world = api.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(yawQ(yaw))
        .setLinearDamping(0.12).setAngularDamping(4).enabledRotations(false, true, false),
    );
    world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(1.3, CAB_HY, 1.6).setMass(CAB_MASS)).setCollisionGroups(grp(G.VEHICLE)), body);

    // Remorque, posée derrière la cabine
    const cabFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
    const trAnchorW = new THREE.Vector3(x, y, z).addScaledVector(cabFwd, -HITCH_Z);
    const trPos = trAnchorW.clone().add(new THREE.Vector3(-TR_ANCHOR[0], -TR_ANCHOR[1], -TR_ANCHOR[2]).applyQuaternion(api.quatOf(body)));
    const trailer = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(trPos.x, y - CAB_HY + TR_HY + 0.05, trPos.z).setRotation(yawQ(yaw))
        .setLinearDamping(0.25).setAngularDamping(1.5).enabledRotations(false, true, false),
    );
    world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(1.3, TR_HY, 4).setMass(TR_MASS)).setCollisionGroups(grp(G.VEHICLE)), trailer);

    let joint: RAPIER.ImpulseJoint | null = null;
    const attach = () => {
      const params = RAPIER.JointData.spherical({ x: 0, y: 0, z: HITCH_Z }, { x: TR_ANCHOR[0], y: TR_ANCHOR[1], z: TR_ANCHOR[2] });
      joint = world.createImpulseJoint(params, body, trailer, true);
      joint.setContactsEnabled(false);
    };
    const detach = () => {
      if (joint) { try { world.removeImpulseJoint(joint, true); } catch { /* déjà retiré */ } }
      joint = null;
    };
    attach();

    const yawOf = (b: RAPIER.RigidBody) => {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(b));
      return Math.atan2(-f.x, -f.z);
    };
    const cabHitchW = () => {
      const t = body.translation();
      return new THREE.Vector3(0, 0, HITCH_Z).applyQuaternion(api.quatOf(body)).add(new THREE.Vector3(t.x, t.y, t.z));
    };
    const trailerAnchorW = () => {
      const t = trailer.translation();
      return new THREE.Vector3(...TR_ANCHOR).applyQuaternion(api.quatOf(trailer)).add(new THREE.Vector3(t.x, t.y, t.z));
    };
    /** Replace la remorque pour que son point d'attelage coïncide avec celui de la cabine (angle borné). */
    const snapTrailer = (keepYaw: boolean) => {
      const hc = yawOf(body);
      const rel = keepYaw ? clamp(wrap(yawOf(trailer) - hc), -LIMIT * 0.9, LIMIT * 0.9) : 0;
      const q = yawQ(hc + rel);
      trailer.setRotation(q, true);
      const anchor = cabHitchW();
      const off = new THREE.Vector3(...TR_ANCHOR).applyQuaternion(api.quatOf(trailer));
      trailer.setTranslation({ x: anchor.x - off.x, y: anchor.y - off.y, z: anchor.z - off.z }, true);
      const lv = body.linvel();
      trailer.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
      trailer.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };

    let steer = 0;
    let hornAt = 0;
    let hornQueue: Array<[number, string]> = [];
    let prevM1 = 0;
    let prevM2 = 0;
    let bed = 0; // 0..1
    let bedWant = 0;
    let dumpedAt = -1e9;
    let crateQueue: Array<[number, number]> = []; // [heure, index]
    let detachedAt = -1e9;
    let jack = 0; // 0..1 : intensité du jackknife en cours
    let jackSide = 1;

    const driverOf = (): SimPlayer | null => {
      for (const p of api.players.values()) if (p.vehicle && p.vehicle.behavior.body === body && p.seat === 0) return p;
      return null;
    };
    const trailerRight = () => new THREE.Vector3(1, 0, 0).applyQuaternion(api.quatOf(trailer));
    const spawnCrate = (i: number) => {
      const t = trailer.translation();
      const q = api.quatOf(trailer);
      const local = new THREE.Vector3(-0.85 + (i % 3) * 0.85, 1.3 + (i >= 3 ? 1.25 : 0), 4.6);
      const pos = local.applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const lv = trailer.linvel();
      const vel = new THREE.Vector3(lv.x, 0.5, lv.z).addScaledVector(back, 2.5 + Math.random());
      api.spawnProp('crate_m', pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, 0)), vel, driverOf());
    };

    return {
      body,
      step({ input, api }) {
        const dt = 1 / 60;
        const t = body.translation();
        const attached = joint !== null;
        const sp = api.forwardSpeed(body);

        // --- sécurités : remorque dans le décor / loin de son joint ---
        const tt = trailer.translation();
        if (!Number.isFinite(tt.x + tt.y + tt.z) || tt.y < -20 || (attached && cabHitchW().distanceTo(trailerAnchorW()) > 2.5)) {
          detach();
          snapTrailer(false);
          attach();
        }

        // --- m1 : largue / rattache ---
        if (input.m1 && !prevM1) {
          if (joint) {
            detach();
            detachedAt = api.time;
            const f = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
            body.applyImpulse({ x: f.x * CAB_MASS * 1.2, y: 0, z: f.z * CAB_MASS * 1.2 }, true);
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'boing' });
            api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Remorque larguée !' });
          } else if (cabHitchW().distanceTo(trailerAnchorW()) < 4.5) {
            snapTrailer(true);
            attach();
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
            api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Attelé !' });
          } else api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Reculez vers la remorque' });
        }
        prevM1 = input.m1;
        // rattelage automatique : la cabine revient doucement sous la remorque
        if (!joint && api.time - detachedAt > 3000 && cabHitchW().distanceTo(trailerAnchorW()) < 1.1 && Math.abs(sp) < 3
          && Math.abs(wrap(yawOf(trailer) - yawOf(body))) < 0.9) {
          snapTrailer(true);
          attach();
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'pop' });
          api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Clac ! Attelé' });
        }

        // --- m2 : benne ---
        if (input.m2 && !prevM2) {
          if (bedWant === 0) {
            bedWant = 1;
            if (api.time - dumpedAt > DUMP_RELOAD_MS) {
              dumpedAt = api.time;
              crateQueue = Array.from({ length: 6 }, (_, i) => [api.time + 900 + i * 220, i] as [number, number]);
              api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
            } else api.fx({ k: 'text', p: [t.x, t.y + 3, t.z], s: 'Benne vide !' });
          } else bedWant = 0;
        }
        prevM2 = input.m2;
        bed += clamp(bedWant - bed, -dt * 0.5, dt * 0.45);
        if (crateQueue.length && api.time >= crateQueue[0][0]) spawnCrate(crateQueue.shift()![1]);

        // --- klaxon en 3 tons ---
        if (input.hn && api.time > hornAt) {
          hornAt = api.time + 1400;
          hornQueue = [[api.time, 'horn_1'], [api.time + 230, 'horn_1'], [api.time + 520, 'horn_2']];
        }
        while (hornQueue.length && api.time >= hornQueue[0][0]) {
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: hornQueue.shift()![1] });
        }

        // --- conduite de la cabine ---
        steer = -input.s;
        const hard = (input.f < 0 && sp > 8) || (input.jump && sp > 8); // freinage fort à vitesse élevée
        const rel = wrap(yawOf(trailer) - yawOf(body));
        const thr = input.f > 0 && sp > MAX_SPEED ? 0 : input.f < 0 && sp < -7 ? 0 : input.f;
        const authority = clamp(Math.abs(sp) / 5, 0, 1) * (sp < 0 ? -1 : 1);
        let turn = steer * authority * (1.0 - 0.45 * clamp(Math.abs(sp) / MAX_SPEED, 0, 1));
        // jackknife : la remorque, plus lourde, tire la cabine de travers
        if (attached && hard) {
          if (Math.abs(rel) > 0.05) jackSide = Math.sign(rel);
          else if (Math.abs(steer) > 0.1) jackSide = Math.sign(steer) * -1;
          jack = Math.min(1, jack + dt * 1.6);
        } else jack = Math.max(0, jack - dt * 1.2);
        if (attached) turn += jack * jackSide * 0.55 * clamp(sp / 12, 0, 1.2);
        api.driveArcade(body, CAB_MASS, attached ? 15 : 12, thr, turn);
        if (hard) { // gros frein : décélération supplémentaire sur la cabine
          const v = body.linvel();
          const k = (input.jump ? 0.05 : 0.025);
          body.setLinvel({ x: v.x * (1 - k), y: v.y, z: v.z * (1 - k) }, true);
        }

        // butée d'articulation (joint sphérique : l'angle est borné ici, la remorque ne traverse pas la cabine)
        if (attached && Math.abs(rel) > LIMIT) {
          const w = trailer.angvel().y;
          const over = rel - Math.sign(rel) * LIMIT;
          trailer.setAngvel({ x: 0, y: Math.sign(rel) * w > 0 ? body.angvel().y : w - over * 6, z: 0 }, true);
        }

        // --- remorque : adhérence latérale à l'essieu arrière (sinon elle glisse), moins quand on freine fort ---
        const q = api.quatOf(trailer);
        const right = trailerRight();
        const r = new THREE.Vector3(0, 0, AXLE_Z).applyQuaternion(q);
        const lv = trailer.linvel();
        const wy = trailer.angvel().y;
        const vLat = (lv.x + wy * r.z) * right.x + (lv.z - wy * r.x) * right.z;
        const grip = 0.8 * (1 - 0.88 * jack);
        const effMass = TR_MASS / (1 + (AXLE_Z * AXLE_Z) / TR_INERTIA_K);
        const imp = -vLat * effMass * grip;
        trailer.applyImpulseAtPoint({ x: right.x * imp, y: 0, z: right.z * imp }, { x: tt.x + r.x, y: tt.y, z: tt.z + r.z }, true);
        if (!attached) { // remorque seule : frottement de roulement + patins d'appui
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          const vf = lv.x * f.x + lv.z * f.z;
          trailer.applyImpulse({ x: -f.x * vf * TR_MASS * 0.02, y: 0, z: -f.z * vf * TR_MASS * 0.02 }, true);
        } else if (jack > 0.2) { // l'élan de la remorque la met en travers
          trailer.applyTorqueImpulse({ x: 0, y: jack * jackSide * TR_MASS * 1.2 * dt * 10, z: 0 }, true);
        }
        // frottement de roulement de la remorque quand la cabine ne pousse pas
        if (attached && !input.f) {
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          const vf = lv.x * f.x + lv.z * f.z;
          trailer.applyImpulse({ x: -f.x * vf * TR_MASS * 0.015, y: 0, z: -f.z * vf * TR_MASS * 0.015 }, true);
        }
      },
      anim() {
        const hc = body.translation();
        const tt = trailer.translation();
        const d = new THREE.Vector3(tt.x - hc.x, tt.y - hc.y, tt.z - hc.z).applyQuaternion(api.quatOf(body).invert());
        const rel = wrap(yawOf(trailer) - yawOf(body));
        return { sp: api.forwardSpeed(body), st: steer, a: [rel, bed, joint ? 1 : 0, d.x, d.y, d.z] };
      },
      dispose() {
        // Cabine détruite : la remorque ne peut pas rester (elle n'est pas un véhicule du monde) ; son chargement se répand.
        if (bed === 0 && api.time - dumpedAt > DUMP_RELOAD_MS) for (let i = 0; i < 4; i++) spawnCrate(i);
        detach();
        world.removeRigidBody(trailer);
        world.removeRigidBody(body);
      },
    };
  },
};
