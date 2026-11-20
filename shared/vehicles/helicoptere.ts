// Hélicoptère : collectif `th` (vitesse verticale visée, stationnaire assisté sans commande), inclinaison f/s, lacet yw,
// treuil (m1 accroche sous l'appareil, m2 largue), souffle du rotor près du sol, 3 places.
// anim().a = [puissance rotor 0..1, tangage visé, roulis visé, accroché 0|1, charge x, y, z (repère de l'hélico)]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type SimProp, type SimVehicle, type VehicleDef } from '../api';
import { STEP } from '../constants';

const GRAV = 9.81;
const WINCH_RANGE = 25;
const ROPE_LEN = 6.5;
const MAX_CARGO_MASS = 1200;
const WASH_ALT = 15;
const WASH_RADIUS = 13;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

type Cargo = { kind: 'prop'; prop: SimProp } | { kind: 'veh'; veh: SimVehicle };

export const def: VehicleDef = {
  type: 'helicoptere',
  name: "l'hélicoptère",
  emoji: '🚁',
  enterRadius: 7,
  exitOffset: 4,
  seats: 3,
  maxHp: 100,
  armor: { impact: 1, explosion: 1.4, bullet: 1 },
  impact: { threshold: 8, scale: 9 },
  spawns: [[110, -40, 0]],
  create(api, x, y, z, yaw) {
    const world = api.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0).setAngularDamping(0.5).setCanSleep(false),
    );
    const cg = grp(G.VEHICLE);
    const part = (d: RAPIER.ColliderDesc, mass: number, sliding = false) => {
      d = (sliding ? api.sliding(d) : d.setFriction(0.5)).setMass(mass).setRestitution(0).setCollisionGroups(cg);
      return world.createCollider(d, body);
    };
    part(RAPIER.ColliderDesc.cuboid(1.1, 0.85, 1.9).setTranslation(0, 0.1, -1.0), 1100); // cabine
    part(RAPIER.ColliderDesc.cuboid(0.25, 0.3, 2.0).setTranslation(0, 0.5, 2.6), 150); // poutre de queue
    part(RAPIER.ColliderDesc.cuboid(0.12, 0.08, 1.9).setTranslation(-1.2, -1.15, -0.6), 60); // patins
    part(RAPIER.ColliderDesc.cuboid(0.12, 0.08, 1.9).setTranslation(1.2, -1.15, -0.6), 60);

    const mass = body.mass();
    let power = 0;
    let tiltF = 0, tiltS = 0;
    let hornAt = 0;
    let cargo: Cargo | null = null;
    let rope = ROPE_LEN;
    let reactY = 0; // accélération verticale subie par l'hélico à cause de la charge (m/s²)
    let washTick = 0;
    let cargoLocal = new THREE.Vector3();

    const cargoBody = (c: Cargo) => (c.kind === 'prop' ? c.prop.body : c.veh.behavior.body);
    const cargoValid = (c: Cargo) =>
      c.kind === 'prop' ? api.props.get(c.prop.id) === c.prop && !c.prop.frozen : !c.veh.dead && !!c.veh.behavior.body && !c.veh.driver;

    const release = (t: { x: number; y: number; z: number }) => {
      if (!cargo) return;
      if (cargo.kind === 'veh') cargo.veh.noImpactUntil = api.time + 800;
      cargo = null;
      reactY = 0;
      api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'whoosh' });
    };

    const tryHook = (pos: THREE.Vector3, selfV: SimVehicle) => {
      const origin = pos.clone().add(new THREE.Vector3(0, -1.4, 0));
      const down = new THREE.Vector3(0, -1, 0);
      const hit = api.raycast(origin, down, WINCH_RANGE, body);
      const probe = hit ? hit.point : origin.clone().addScaledVector(down, 10);
      const cand = [...(hit ? [hit] : []), ...api.nearby(probe, 4).filter((h) => h.point.y < pos.y - 1)];
      for (const h of cand) {
        if (h.kind === 'prop' && h.prop && !h.prop.frozen && !h.prop.held && h.prop.body.mass() <= MAX_CARGO_MASS) {
          cargo = { kind: 'prop', prop: h.prop };
        } else if (h.kind === 'vehicle' && h.vehicle && h.vehicle !== selfV && !h.vehicle.dead && !h.vehicle.driver && h.vehicle.behavior.body.mass() <= MAX_CARGO_MASS) {
          cargo = { kind: 'veh', veh: h.vehicle };
        } else continue;
        rope = Math.min(WINCH_RANGE, Math.max(ROPE_LEN, pos.y - cargoBody(cargo).translation().y));
        api.fx({ k: 'sound', p: [pos.x, pos.y, pos.z], s: 'bloop' });
        api.fx({ k: 'text', p: [pos.x, pos.y - 2, pos.z], s: 'Accroché !' });
        return;
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
        const v = new THREE.Vector3(lin.x, lin.y, lin.z);
        const pos = new THREE.Vector3(t.x, t.y, t.z);
        const ray = api.raycast(pos, new THREE.Vector3(0, -1, 0), 60, body);
        const h = ray && ray.kind === 'static' ? ray.dist : Math.max(0.2, t.y - 0.0); // props/véhicules sous l'hélico ne comptent pas comme sol

        // ---- rotor : monte en régime avec un pilote, retombe sans ----
        power = clamp(power + (driver ? 0.8 : -0.35) * STEP, 0, 1);
        const pw = clamp01((power - 0.55) / 0.4);
        const f = driver ? input.f : 0, s = driver ? input.s : 0, yw = driver ? input.yw : 0, th = driver ? input.th : 0;
        tiltF = -f * 0.42;
        tiltS = -s * 0.38;

        // ---- poussée du rotor : le collectif vise une vitesse verticale, sans commande = stationnaire ----
        const ceiling = t.y > 160 ? -clamp01((t.y - 160) / 40) : 0;
        const vzT = th > 0 ? th * 8 : th * 6;
        const tz = clamp(GRAV + 3.2 * ((vzT + ceiling * 5) - lin.y) - reactY, 0.15 * GRAV, 2.4 * GRAV);
        const a = new THREE.Vector3().addScaledVector(up, (tz / Math.max(up.y, 0.55)) * pw);
        // traînée horizontale : forte sans commande (le stationnaire se fige), faible en vol
        const hold = 1 - Math.max(Math.abs(f), Math.abs(s));
        const dragK = 0.14 + 0.55 * hold + (h < 0.8 ? 1.2 : 0);
        a.x -= v.x * dragK;
        a.z -= v.z * dragK;
        v.addScaledVector(a, STEP);
        v.y = clamp(v.y, -40, 25);
        const hs = Math.hypot(v.x, v.z);
        if (hs > 38) { v.x *= 38 / hs; v.z *= 38 / hs; }
        body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);

        // ---- attitude : angles visés (tangage, roulis), lacet en vitesse ----
        const pitch = Math.asin(clamp(fw.y, -1, 1));
        const roll = Math.atan2(right.y, up.y);
        const wx = clamp(4.5 * (tiltF - pitch), -2.2, 2.2);
        const wz = clamp(4.5 * (tiltS - roll), -2.2, 2.2);
        const tgt = new THREE.Vector3(wx, 0, wz).add(new THREE.Vector3(0, -yw * 1.3 * clamp01(power * 1.2), 0).applyQuaternion(invQ));
        if (power < 0.3) tgt.multiplyScalar(0);
        const av = body.angvel();
        const loc = new THREE.Vector3(av.x, av.y, av.z).applyQuaternion(invQ);
        loc.lerp(tgt, 1 - Math.exp(-8 * STEP));
        const wv = loc.applyQuaternion(q);
        if (wv.length() > 3) wv.multiplyScalar(3 / wv.length());
        body.setAngvel({ x: wv.x, y: wv.y, z: wv.z }, true);

        // ---- klaxon ----
        if (driver && input.hn && api.time > hornAt) {
          hornAt = api.time + 700;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_4' });
        }

        // ---- treuil ----
        if (cargo && !cargoValid(cargo)) release(t);
        if (driver && input.m2 && cargo) { release(t); api.fx({ k: 'text', p: [t.x, t.y - 2, t.z], s: 'Largué !' }); }
        else if (driver && input.m1 && !cargo) tryHook(pos, self);
        if (cargo) {
          const cb = cargoBody(cargo);
          const ct = cb.translation();
          const cv = cb.linvel();
          rope = Math.max(ROPE_LEN, rope - 5 * STEP); // le treuil remonte
          const P = new THREE.Vector3(t.x, t.y - rope, t.z);
          const m = cb.mass();
          const acc = new THREE.Vector3((P.x - ct.x) * 7 - cv.x * 2.6, (P.y - ct.y) * 7 - cv.y * 2.6, (P.z - ct.z) * 7 - cv.z * 2.6);
          const al = acc.length();
          if (al > 28) acc.multiplyScalar(28 / al);
          cb.applyImpulse({ x: acc.x * m * STEP, y: acc.y * m * STEP, z: acc.z * m * STEP }, true);
          cb.wakeUp();
          if (cargo.kind === 'veh') cargo.veh.noImpactUntil = api.time + 300;
          // réaction sur l'hélico : la charge pèse (sans compter le poids propre, déjà dans la gravité de la charge)
          const react = new THREE.Vector3(-acc.x, -acc.y, -acc.z).multiplyScalar(m / mass);
          body.applyImpulse({ x: react.x * mass * STEP, y: react.y * mass * STEP, z: react.z * mass * STEP }, true);
          reactY = clamp(0.8 * reactY + 0.2 * (-(acc.y + GRAV) * m / mass), -GRAV, 0.5); // < 0 : la charge tire vers le bas
          cargoLocal = new THREE.Vector3(ct.x - t.x, ct.y - t.y, ct.z - t.z).applyQuaternion(invQ);
        }

        // ---- souffle du rotor : pousse props légers et joueurs sous l'hélico ----
        if (power > 0.6 && h < WASH_ALT && ++washTick % 2 === 0) {
          const st = (1 - h / WASH_ALT) * power;
          const below = new THREE.Vector3(t.x, t.y - Math.min(h, 12) * 0.6, t.z);
          for (const hit of api.nearby(below, WASH_RADIUS + 4)) {
            if (hit.point.y > t.y) continue;
            const dx = hit.point.x - t.x, dz = hit.point.z - t.z;
            const d = Math.hypot(dx, dz);
            if (d > WASH_RADIUS) continue;
            const nx = d > 0.2 ? dx / d : 0, nz = d > 0.2 ? dz / d : 0;
            const fall = st * (1 - d / WASH_RADIUS);
            if (hit.kind === 'prop' && hit.prop && !hit.prop.frozen && !hit.prop.held && !(cargo && cargo.kind === 'prop' && cargo.prop === hit.prop)) {
              const m = hit.prop.body.mass();
              const acc = (34 * fall) / (1 + m / 60);
              const imp = m * acc * STEP * 2;
              hit.prop.body.applyImpulse({ x: nx * imp, y: imp * 0.7, z: nz * imp }, true);
              hit.prop.body.wakeUp();
            } else if (hit.kind === 'player' && hit.player) {
              hit.player.scratch.kb = [nx * 11 * fall, nz * 11 * fall];
            }
          }
        }
      },
      anim: () => ({
        sp: power * 18,
        st: tiltS,
        a: [power, tiltF, tiltS, cargo ? 1 : 0, cargoLocal.x, cargoLocal.y, cargoLocal.z],
      }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
