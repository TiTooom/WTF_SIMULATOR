// Simulation physique autoritaire (tourne sur le serveur, sans aucun rendu).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  EXC, GROUND, SPAWNS, STEP, VEHICLE_SPECS, crateLayout, treeLayout,
} from './constants';
import { NO_INPUT, type Input, type Snapshot, type VehicleSnap } from './protocol';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const clamp1 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0);
const round = (n: number, p = 100) => Math.round(n * p) / p;

interface SimPlayer {
  id: string;
  name: string;
  body: RAPIER.RigidBody;
  input: Input;
  vehicle: SimVehicle | null;
}

interface SimVehicle {
  type: 'car' | 'excavator';
  body: RAPIER.RigidBody;
  driver: SimPlayer | null;
  steer: number;
  arm: [number, number, number, number];
  step(input: Input): void;
}

export interface SaveData {
  version: 1;
  crates: { p: number[]; q: number[] }[];
  vehicles: { p: number[]; q: number[]; arm: number[] }[];
  players: Record<string, [number, number, number]>;
}

const quatOf = (b: RAPIER.RigidBody) => {
  const r = b.rotation();
  return new THREE.Quaternion(r.x, r.y, r.z, r.w);
};

export class Sim {
  readonly world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  readonly players = new Map<string, SimPlayer>();
  readonly vehicles: SimVehicle[] = [];
  readonly crates: RAPIER.RigidBody[] = [];
  private savedPlayers: SaveData['players'] = {};
  time = 0;
  private spawnCount = 0;

  static async create(): Promise<Sim> {
    await RAPIER.init();
    return new Sim();
  }

  private constructor() {
    const w = this.world;
    w.createCollider(RAPIER.ColliderDesc.cuboid(GROUND, 0.5, GROUND).setTranslation(0, -0.5, 0).setFriction(1));
    for (const t of treeLayout())
      w.createCollider(RAPIER.ColliderDesc.cylinder(1.5 * t.s, 0.4 * t.s).setTranslation(t.x, 1.5 * t.s, t.z));
    for (const c of crateLayout()) {
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z));
      w.createCollider(RAPIER.ColliderDesc.cuboid(c.s / 2, c.s / 2, c.s / 2).setMass(c.mass), body);
      this.crates.push(body);
    }
    this.vehicles.push(this.makeCar(...SPAWNS.car), this.makeExcavator(...SPAWNS.excavator));
  }

  // ---------- Joueurs ----------
  addPlayer(id: string, name: string) {
    const saved = this.savedPlayers[name];
    // Chaque nouveau joueur apparaît à une place différente autour du point de départ
    const a = (this.spawnCount++ % 8) * (Math.PI / 4);
    const [x, y, z] = saved ?? [SPAWNS.player[0] + Math.cos(a) * 2.5, SPAWNS.player[1], SPAWNS.player[2] + Math.sin(a) * 2.5];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + (saved ? 0.5 : 0), z).lockRotations().setLinearDamping(0),
    );
    this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35).setFriction(0), body);
    this.players.set(id, { id, name, body, input: { ...NO_INPUT }, vehicle: null });
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.rememberPlayer(p);
    if (p.vehicle) this.exitVehicle(p);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }

  private rememberPlayer(p: SimPlayer) {
    const t = p.vehicle ? p.vehicle.body.translation() : p.body.translation();
    this.savedPlayers[p.name] = [round(t.x), round(Math.max(t.y, 1)), round(t.z)];
  }

  setInput(id: string, raw: Partial<Input>) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = {
      f: clamp1(raw.f), s: clamp1(raw.s), sw: clamp1(raw.sw), bm: clamp1(raw.bm),
      st: clamp1(raw.st), bk: clamp1(raw.bk), jump: raw.jump ? 1 : 0,
      yaw: typeof raw.yaw === 'number' && Number.isFinite(raw.yaw) ? raw.yaw : 0,
    };
  }

  /** Monter dans le véhicule le plus proche libre, ou descendre. */
  interact(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.vehicle) return this.exitVehicle(p);
    const t = p.body.translation();
    let best: SimVehicle | null = null;
    let bestDist = Infinity;
    for (const v of this.vehicles) {
      if (v.driver) continue;
      const vt = v.body.translation();
      const d = Math.hypot(t.x - vt.x, t.z - vt.z);
      if (d < VEHICLE_SPECS[v.type].enterRadius && d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
    if (!best) return;
    best.driver = p;
    p.vehicle = best;
    p.body.setEnabled(false);
  }

  private exitVehicle(p: SimPlayer) {
    const v = p.vehicle;
    if (!v) return;
    const c = v.body.translation();
    const side = new THREE.Vector3(VEHICLE_SPECS[v.type].exitOffset, 0, 0).applyQuaternion(quatOf(v.body));
    v.driver = null;
    v.steer = 0;
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.vehicle = null;
    p.body.setEnabled(true);
    p.body.setTranslation({ x: c.x + side.x, y: c.y + 1.5, z: c.z + side.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  // ---------- Pas de simulation ----------
  step() {
    for (const p of this.players.values()) if (!p.vehicle) this.stepPlayer(p);
    for (const v of this.vehicles) v.step(v.driver ? v.driver.input : NO_INPUT);
    this.world.step();
    this.time += STEP * 1000;
    // Filet de sécurité : retour au point de départ en cas de chute hors du monde
    for (const p of this.players.values()) {
      if (!p.vehicle && p.body.translation().y < -30) {
        p.body.setTranslation({ x: SPAWNS.player[0], y: SPAWNS.player[1], z: SPAWNS.player[2] }, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  private stepPlayer(p: SimPlayer) {
    const i = p.input;
    const dir = new THREE.Vector3(i.s, 0, -i.f).applyAxisAngle(Y_AXIS, i.yaw);
    if (dir.lengthSq() > 1) dir.normalize();
    dir.multiplyScalar(6);
    const v = p.body.linvel();
    const grounded = Math.abs(v.y) < 0.05;
    p.body.setLinvel({ x: dir.x, y: i.jump && grounded ? 6 : v.y, z: dir.z }, true);
  }

  // ---------- Conduite arcade commune ----------
  private driveArcade(body: RAPIER.RigidBody, mass: number, accel: number, throttle: number, turn: number) {
    const q = quatOf(body);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const v = body.linvel();
    const lateral = v.x * right.x + v.z * right.z;
    if (throttle) body.applyImpulse(fwd.clone().multiplyScalar(throttle * accel * mass * STEP), true);
    else body.applyImpulse(fwd.clone().multiplyScalar(-(v.x * fwd.x + v.z * fwd.z) * mass * 1.5 * STEP), true); // frottement de roulement
    body.applyImpulse(right.multiplyScalar(-lateral * mass * 0.9), true);
    body.setAngvel({ x: 0, y: turn, z: 0 }, true);
  }

  // Friction nulle (règle Min) : sinon le frottement du châssis le bloque au sol.
  private sliding(desc: RAPIER.ColliderDesc) {
    return desc.setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
  }

  private makeCar(x: number, y: number, z: number): SimVehicle {
    const MASS = 800;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.45).setAngularDamping(2.5)
        .enabledRotations(false, true, false),
    );
    this.world.createCollider(this.sliding(RAPIER.ColliderDesc.cuboid(1, 0.45, 2).setMass(MASS)), body);
    const self: SimVehicle = {
      type: 'car', body, driver: null, steer: 0, arm: [0, 0, 0, 0],
      step: (input) => {
        self.steer = -input.s;
        const fwdSpeed = this.forwardSpeed(body);
        const turn = self.steer * Math.max(-1, Math.min(1, fwdSpeed / 6)) * 1.8;
        this.driveArcade(body, MASS, 14, input.f, turn);
      },
    };
    return self;
  }

  forwardSpeed(b: RAPIER.RigidBody) {
    const v = b.linvel();
    return new THREE.Vector3(v.x, v.y, v.z).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(quatOf(b)));
  }

  // Pelleteuse : chenilles arcade + bras dont chaque pièce est un corps cinématique (pousse et soulève les caisses).
  private makeExcavator(x: number, y: number, z: number): SimVehicle {
    const MASS = 5000;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.9).setAngularDamping(4)
        .enabledRotations(false, true, false),
    );
    const BODY_GROUP = 0x0002;
    this.world.createCollider(
      this.sliding(RAPIER.ColliderDesc.cuboid(1.75, 0.5, 2.3).setMass(MASS)).setCollisionGroups((BODY_GROUP << 16) | 0xffff),
      body,
    );

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

    const ARM_FILTER = (0x0004 << 16) | (0xffff & ~BODY_GROUP); // ne collisionne pas avec le châssis
    const armPart = (colliders: RAPIER.ColliderDesc[]) => {
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      for (const c of colliders) this.world.createCollider(c.setCollisionGroups(ARM_FILTER), b);
      return b;
    };
    const cub = (hx: number, hy: number, hz: number, px: number, py: number, pz: number) =>
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(px, py, pz);
    const armBodies: [THREE.Object3D, RAPIER.RigidBody][] = [
      [boomPivot, armPart([cub(0.25, 0.3, L1 / 2, 0, 0, -L1 / 2)])],
      [stickPivot, armPart([cub(0.19, 0.25, L2 / 2, 0, 0, -L2 / 2)])],
      [bucketPivot, armPart([
        cub(0.7, 0.05, 0.55, 0, -0.05, -0.55),
        cub(0.7, 0.35, 0.05, 0, 0.3, -0.05),
        cub(0.05, 0.35, 0.55, -0.7, 0.3, -0.55),
        cub(0.05, 0.35, 0.55, 0.7, 0.3, -0.55),
      ])],
    ];

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

    const self: SimVehicle = {
      type: 'excavator', body, driver: null, steer: 0,
      arm: [EXC.rest.swing, EXC.rest.boom, EXC.rest.stick, EXC.rest.bucket],
      step: (input) => {
        const A = self.arm;
        this.driveArcade(body, MASS, 7, input.f, -input.s * 0.9);
        const prev = [...A] as typeof A;
        const cl = (v: number, [lo, hi]: readonly number[]) => Math.max(lo, Math.min(hi, v));
        A[0] += input.sw * 0.9 * STEP;
        A[1] = cl(A[1] + input.bm * 0.7 * STEP, EXC.limits.boom);
        A[2] = cl(A[2] + input.st * 0.9 * STEP, EXC.limits.stick);
        A[3] = cl(A[3] + input.bk * 1.4 * STEP, EXC.limits.bucket);
        applyPose();
        if (underground()) {
          // Le godet ne s'enfonce pas dans le sol
          for (let k = 0; k < 4; k++) A[k] = prev[k];
          applyPose();
        }
        syncArm(false);
      },
    };
    const applyPose = () => {
      const t = body.translation();
      root.position.set(t.x, t.y, t.z);
      root.quaternion.copy(quatOf(body));
      turret.rotation.y = self.arm[0];
      boomPivot.rotation.x = self.arm[1];
      stickPivot.rotation.x = self.arm[2];
      bucketPivot.rotation.x = self.arm[3];
      root.updateMatrixWorld(true);
    };
    const underground = () => {
      for (const o of [bucketPivot, tip, heel]) {
        o.getWorldPosition(wp);
        if (wp.y < 0.08) return true;
      }
      return false;
    };
    applyPose();
    syncArm(true);
    // Après une restauration de sauvegarde ou un déplacement : replace le bras.
    (self as SimVehicle & { resync?: () => void }).resync = () => {
      applyPose();
      syncArm(true);
    };
    return self;
  }

  // ---------- État envoyé aux clients ----------
  snapshot(): Snapshot {
    const players = [...this.players.values()].map((p) => {
      const t = (p.vehicle ?? p).body.translation();
      return {
        id: p.id, name: p.name, p: [round(t.x), round(t.y), round(t.z)] as [number, number, number],
        yaw: round(p.input.yaw, 1000), veh: p.vehicle ? this.vehicles.indexOf(p.vehicle) : -1,
      };
    });
    const vehicles: VehicleSnap[] = this.vehicles.map((v) => {
      const t = v.body.translation();
      const r = v.body.rotation();
      return {
        type: v.type, p: [round(t.x), round(t.y), round(t.z)],
        q: [round(r.x, 1000), round(r.y, 1000), round(r.z, 1000), round(r.w, 1000)],
        drv: v.driver?.id ?? '', sp: round(this.forwardSpeed(v.body)), st: v.steer,
        a: v.arm.map((n) => round(n, 1000)) as VehicleSnap['a'],
      };
    });
    const crates: number[] = [];
    for (const b of this.crates) {
      const t = b.translation();
      const r = b.rotation();
      crates.push(round(t.x), round(t.y), round(t.z), round(r.x, 1000), round(r.y, 1000), round(r.z, 1000), round(r.w, 1000));
    }
    return { t: Math.round(this.time), players, vehicles, crates };
  }

  // ---------- Sauvegarde ----------
  serialize(): SaveData {
    for (const p of this.players.values()) this.rememberPlayer(p);
    const pose = (b: RAPIER.RigidBody) => {
      const t = b.translation();
      const r = b.rotation();
      return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
    };
    return {
      version: 1,
      crates: this.crates.map(pose),
      vehicles: this.vehicles.map((v) => ({ ...pose(v.body), arm: [...v.arm] })),
      players: this.savedPlayers,
    };
  }

  restore(data: SaveData) {
    if (data?.version !== 1) return;
    const place = (b: RAPIER.RigidBody, s?: { p: number[]; q: number[] }) => {
      if (!s || s.p.length !== 3 || s.q.length !== 4 || ![...s.p, ...s.q].every(Number.isFinite)) return;
      b.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
      b.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };
    this.crates.forEach((b, i) => place(b, data.crates?.[i]));
    this.vehicles.forEach((v, i) => {
      const s = data.vehicles?.[i];
      place(v.body, s);
      if (s?.arm?.length === 4 && s.arm.every(Number.isFinite)) v.arm = s.arm as SimVehicle['arm'];
      (v as SimVehicle & { resync?: () => void }).resync?.();
    });
    this.savedPlayers = data.players ?? {};
  }
}
