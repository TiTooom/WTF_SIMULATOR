// Tank : chenilles (pivote sur place), tourelle et canon qui suivent la caméra, obus « bouchon de champagne », mitrailleuse coaxiale.
// anim().a = [lacet tourelle (relatif au châssis), élévation canon, recul (0..1), chenille gauche (m), chenille droite (m)]
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type SimPlayer, type SimProp, type VehicleDef } from '../api';

const MASS = 8000;
const MAX_SPEED = 13;
const TURRET_RATE = 2.0; // rad/s
const GUN_RATE = 1.2;
const ELEV_MIN = -0.15;
const ELEV_MAX = 0.6;
const PIVOT_Y = 0.95; // axe de la tourelle au-dessus du centre du châssis
const BARREL_LEN = 2.6; // du pivot au bout du canon
const SHELL_SPEED = 60;
const SHELL_COOLDOWN = 1500;
const MG_INTERVAL = 1000 / 12;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const def: VehicleDef = {
  type: 'tank',
  name: 'le tank',
  emoji: '🛡️',
  enterRadius: 6,
  exitOffset: 3.4,
  seats: 2,
  maxHp: 400,
  armor: { impact: 0.4, explosion: 0.05, bullet: 0.3 },
  impact: { threshold: 9, scale: 2.5 },
  spawns: [[-25, 18, 0]],
  create(api, x, y, z, yaw) {
    const body = api.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.5).setAngularDamping(6).enabledRotations(false, true, false),
    );
    api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(1.3, 0.5, 2.1).setMass(MASS)).setCollisionGroups(grp(G.VEHICLE)), body);

    let ty = 0; // lacet tourelle relatif au châssis
    let te = 0.05; // élévation
    let recoil = 0;
    let shellAt = 0;
    let mgAt = 0;
    let hornAt = 0;
    let trackL = 0;
    let trackR = 0;
    let steer = 0;
    let tick = 0;
    const crushed = new Map<number, number>();

    const hullYaw = () => {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(api.quatOf(body));
      return Math.atan2(-f.x, -f.z);
    };
    /** Direction réelle du canon (lacet monde = lacet châssis + lacet tourelle). */
    const gunDir = (h: number, spread = 0) => {
      const w = h + ty;
      const ce = Math.cos(te);
      const d = new THREE.Vector3(-Math.sin(w) * ce, Math.sin(te), -Math.cos(w) * ce);
      if (spread) d.add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      return d.normalize();
    };
    const pivotPos = () => {
      const t = body.translation();
      return new THREE.Vector3(t.x, t.y + PIVOT_Y, t.z);
    };
    const driverOf = (): SimPlayer | null => {
      for (const p of api.players.values()) if (p.vehicle && p.vehicle.behavior.body === body && p.seat === 0) return p;
      return null;
    };

    return {
      body,
      step({ input, api }) {
        const t = body.translation();
        const h = hullYaw();
        const dt = 1 / 60;
        // --- conduite : chenilles, pivote sur place ---
        steer = -input.s;
        const sp = api.forwardSpeed(body);
        const thr = input.f > 0 && sp > MAX_SPEED ? 0 : input.f < 0 && sp < -MAX_SPEED * 0.5 ? 0 : input.f;
        api.driveArcade(body, MASS, 8, thr, steer * 1.25);
        trackL += (sp - steer * 1.25 * 1.3) * dt; // vitesse de chaque chenille (m/s)
        trackR += (sp + steer * 1.25 * 1.3) * dt;

        // --- visée : la tourelle suit la caméra (point visé par le rayon de caméra) ---
        const ao = new THREE.Vector3(...input.ao);
        const ad = new THREE.Vector3(...input.ad);
        if (ad.lengthSq() > 0.01) {
          ad.normalize();
          const piv = new THREE.Vector3(t.x, t.y + PIVOT_Y, t.z);
          let target = piv.clone().addScaledVector(ad, 150);
          if (ao.lengthSq() > 0.01) {
            const hit = api.raycast(ao, ad, 150, body);
            target = hit ? hit.point.clone() : ao.clone().addScaledVector(ad, 150);
          }
          const d = target.sub(piv);
          if (d.length() < 6) d.copy(ad); // cible trop proche : on suit la direction de la caméra
          d.normalize();
          const wantYaw = wrap(Math.atan2(-d.x, -d.z) - h);
          const wantEl = clamp(Math.asin(clamp(d.y, -1, 1)), ELEV_MIN, ELEV_MAX);
          ty = wrap(ty + clamp(wrap(wantYaw - ty), -TURRET_RATE * dt, TURRET_RATE * dt));
          te += clamp(wantEl - te, -GUN_RATE * dt, GUN_RATE * dt);
        }
        recoil = Math.max(0, recoil - dt * 2.2);

        // --- m1 : obus « pschitt » ---
        if (input.m1 && api.time >= shellAt) {
          shellAt = api.time + SHELL_COOLDOWN;
          const d = gunDir(h);
          const m = pivotPos().addScaledVector(d, BARREL_LEN);
          const lv = body.linvel();
          api.spawnProjectile({
            kind: 'shell', pos: m, vel: d.clone().multiplyScalar(SHELL_SPEED).add(new THREE.Vector3(lv.x, 0, lv.z).multiplyScalar(0.3)),
            owner: driverOf(), gravity: 4, life: 5, radius: 5, power: 20, damage: 60, trail: true,
          });
          recoil = 1;
          const p: [number, number, number] = [m.x, m.y, m.z];
          api.fx({ k: 'sound', p, s: 'pop' });
          api.fx({ k: 'sound', p, s: 'whoosh' });
          api.fx({ k: 'confetti', p, c: 0xf6e27a });
          api.fx({ k: 'confetti', p, c: 0xffffff });
          api.fx({ k: 'smoke', p });
          api.fx({ k: 'text', p: [m.x, m.y + 1, m.z], s: 'PSCHITT !' });
          body.applyImpulse({ x: -d.x * MASS * 0.8, y: 0, z: -d.z * MASS * 0.8 }, true); // petit recul du châssis
        }

        // --- m2 : mitrailleuse coaxiale ---
        if (input.m2 && api.time >= mgAt) {
          mgAt = api.time + MG_INTERVAL;
          const d = gunDir(h, 0.035);
          const m = pivotPos().addScaledVector(d, BARREL_LEN - 0.3);
          api.spawnProjectile({ kind: 'bullet', pos: m, vel: d.multiplyScalar(110), owner: driverOf(), gravity: 1, life: 1.6, damage: 4 });
          api.fx({ k: 'spark', p: [m.x, m.y, m.z] });
        }

        // --- klaxon ---
        if (input.hn && api.time > hornAt) {
          hornAt = api.time + 900;
          api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_2' });
        }

        // --- écrase les petits props légers ---
        if (++tick % 3 === 0 && Math.abs(sp) > 1.5) {
          const q = api.quatOf(body).invert();
          const c = new THREE.Vector3(t.x, t.y, t.z);
          for (const hit of api.nearby(c, 4)) {
            const pr: SimProp | undefined = hit.prop;
            if (!pr || pr.frozen || pr.held || pr.kind.mass >= 5) continue;
            const l = hit.point.clone().sub(c).applyQuaternion(q);
            if (Math.abs(l.x) > 1.9 || Math.abs(l.z) > 2.6 || l.y > 1.1) continue;
            if (api.time - (crushed.get(pr.id) ?? -1e9) < 250) continue;
            crushed.set(pr.id, api.time);
            api.damageProp(pr, 30, driverOf());
            api.fx({ k: 'spark', p: [hit.point.x, hit.point.y, hit.point.z] });
          }
          if (crushed.size > 200) for (const [id, at] of crushed) if (api.time - at > 3000) crushed.delete(id);
        }
      },
      anim: () => ({ sp: api.forwardSpeed(body), st: steer, a: [ty, te, recoil, trackL, trackR] }),
      dispose() { api.world.removeRigidBody(body); },
    };
  },
};
