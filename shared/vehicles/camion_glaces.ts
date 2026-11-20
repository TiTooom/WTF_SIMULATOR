// Camion de glaces : camionnette lourde. hn = musique (jingle en boucle), m1 = lance un cornet (crème + ralentit),
// m2 = mode disco 8 s (les véhicules légers à moins de 30 m rebondissent en rythme). Il ralentit 2 s quand il « sert ».
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { G, grp, type VehicleDef, type SimVehicle } from '../api';

const MASS = 1500;
const DISCO_MS = 8000;
const DISCO_COOLDOWN_MS = 14000;
const DISCO_RADIUS = 30;
const BEAT_MS = 500;
const JINGLE_MS = 2000;
const SERVE_SLOW_MS = 2000;
const DISCO_COLORS = [0xff4fa3, 0x4fd8ff, 0xffe14f, 0x7dff4f, 0xb04fff];

export const def: VehicleDef = {
  type: 'camion_glaces',
  name: 'le camion de glaces',
  emoji: '🍦',
  enterRadius: 5,
  exitOffset: 3.2,
  seats: 2,
  maxHp: 110,
  armor: { impact: 1, explosion: 1.2, bullet: 1 },
  impact: { threshold: 7, scale: 3 },
  spawns: [[12, -20, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + 0.2, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.45).setAngularDamping(2.5).enabledRotations(false, true, false),
    );
    api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(0.95, 0.8, 2).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);
    let steer = 0;
    let music = false;
    let nextJingle = 0;
    let prevHn = 0, prevM1 = 0, prevM2 = 0;
    let slowUntil = 0;
    let discoUntil = 0;
    let discoReady = 0;
    let nextBeat = 0;
    let beat = 0;
    let serve = 0;

    const serveSlow = () => { slowUntil = api.time + SERVE_SLOW_MS; };

    return {
      body,
      step({ input, api, dt, self }) {
        const t = body.translation();
        const pos = new THREE.Vector3(t.x, t.y, t.z);
        steer = -input.s;
        const sp = api.forwardSpeed(body);
        const slowed = api.time < slowUntil;

        // musique : front montant du klaxon
        if (input.hn && !prevHn) {
          music = !music;
          nextJingle = 0;
          api.fx({ k: 'text', p: [t.x, t.y + 3.4, t.z], s: music ? '♪ Musique ♪' : 'Musique coupée', c: 0xff8fc8 });
        }
        prevHn = input.hn;
        if (music && api.time >= nextJingle) {
          nextJingle = api.time + JINGLE_MS;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'jingle', a: 30 });
        }

        // cornet lancé
        if (input.m1 && !prevM1 && self.driver) {
          const dir = new THREE.Vector3(...input.ad);
          if (dir.lengthSq() < 0.01) dir.set(0, 0, -1).applyQuaternion(api.quatOf(body));
          dir.normalize();
          const v = body.linvel();
          const start = pos.clone().addScaledVector(dir, 3).add(new THREE.Vector3(0, 1.4, 0));
          const vel = dir.clone().multiplyScalar(26).add(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(0.5));
          vel.y += 3;
          api.spawnProjectile({
            kind: 'cone', pos: start, vel, owner: self.driver, gravity: 12, life: 4, radius: 0, damage: 0,
            onHit: (hit, at) => {
              const a: [number, number, number] = [at.x, at.y, at.z];
              api.fx({ k: 'confetti', p: a, c: 0xffffff, b: 22, a: 0.7 });
              api.fx({ k: 'confetti', p: a, c: 0xff8fc8, b: 22, a: 0.7 });
              api.fx({ k: 'sound', p: a, s: 'splat' });
              api.fx({ k: 'text', p: [a[0], a[1] + 1, a[2]], s: 'SPLOTCH !', c: 0xffc2e0 });
              if (!hit) return;
              if (hit.kind === 'player' && hit.player) api.applyMod(hit.player, { speed: 0.8 }, 3);
              else if (hit.kind === 'vehicle' && hit.vehicle && hit.vehicle !== self) {
                const b = hit.vehicle.behavior.body;
                const lv = b.linvel();
                b.setLinvel({ x: lv.x * 0.8, y: lv.y, z: lv.z * 0.8 }, true);
                if (hit.vehicle.driver) api.applyMod(hit.vehicle.driver, { speed: 0.8 }, 3);
              }
            },
          });
          serve = 1;
          serveSlow();
        }
        prevM1 = input.m1;

        // mode disco
        if (input.m2 && !prevM2 && api.time >= discoReady) {
          discoUntil = api.time + DISCO_MS;
          discoReady = api.time + DISCO_MS + DISCO_COOLDOWN_MS;
          nextBeat = api.time;
          nextJingle = api.time + 100;
          music = true;
          serveSlow();
          api.fx({ k: 'text', p: [t.x, t.y + 3.4, t.z], s: 'MODE DISCO !', c: 0xff4fa3 });
        }
        prevM2 = input.m2;
        const disco = api.time < discoUntil;
        if (disco && api.time >= nextBeat) {
          nextBeat = api.time + BEAT_MS;
          beat++;
          const col = DISCO_COLORS[beat % DISCO_COLORS.length];
          api.fx({ k: 'flash', p: [t.x, t.y + 2.4, t.z], a: 5, c: col });
          api.fx({ k: 'ring', p: [t.x, t.y - 0.5, t.z], a: 10, c: col });
          for (const o of api.vehicles as SimVehicle[]) {
            if (o === self || o.dead || !o.behavior.body) continue;
            const ob = o.behavior.body;
            const ot = ob.translation();
            if (pos.distanceTo(new THREE.Vector3(ot.x, ot.y, ot.z)) > DISCO_RADIUS) continue;
            const m = ob.mass();
            if (m > 700) continue; // seuls les véhicules légers dansent
            ob.applyImpulse({ x: 0, y: m * 2.6, z: 0 }, true);
            api.fx({ k: 'flash', p: [ot.x, ot.y + 1, ot.z], a: 2.5, c: DISCO_COLORS[(beat + 2) % DISCO_COLORS.length] });
          }
        }
        if (!disco) discoUntil = Math.min(discoUntil, api.time);
        serve = Math.max(0, serve - dt * 3);

        // conduite (camionnette)
        const turn = steer * Math.max(-1, Math.min(1, sp / 6)) * 1.3;
        api.driveArcade(body, MASS, slowed ? 4 : 9, input.f, turn);
        if (slowed) {
          const v = body.linvel();
          const k = Math.hypot(v.x, v.z);
          if (k > 5) body.setLinvel({ x: v.x * 0.985, y: v.y, z: v.z * 0.985 }, true);
        }
        if (input.jump) {
          const v = body.linvel();
          body.setLinvel({ x: v.x * 0.96, y: v.y, z: v.z * 0.96 }, true);
        }
      },
      anim: () => ({
        sp: api.forwardSpeed(body), st: steer,
        a: [music ? 1 : 0, api.time < discoUntil ? 1 : 0, serve, beat],
      }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
