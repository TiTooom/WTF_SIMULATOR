import * as THREE from 'three';
import {
  PROJ_STRIDE, PROP_STRIDE,
  type ChatMsg, type ClientMsg, type FxEvent, type Input, type PlayerSnap, type ServerMsg, type Snapshot, type VehicleSnap, type Vec3,
} from '../shared/protocol';

/** Les états sont rendus ~100 ms dans le passé et interpolés : mouvement fluide malgré 30 envois/s. */
const INTERP_MS = 100;
const TELEPORT_D2 = 20 * 20; // au-delà : pas d'interpolation (téléportation)

export interface Sampled {
  players: PlayerSnap[];
  vehicles: VehicleSnap[];
  /** Props interpolés par id, même disposition que le snapshot (PROP_STRIDE) : id, kind, x, y, z, qx, qy, qz, qw, flags. */
  props: Float32Array;
  /** Projectiles (PROJ_STRIDE) : id, kind, x, y, z, vx, vy, vz. */
  proj: Float32Array;
}

interface Entry {
  s: Snapshot;
  at: number;
  propIdx?: Map<number, number>;
  projIdx?: Map<number, number>;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const lerpV = (a: Vec3, b: Vec3, k: number): Vec3 => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  if (dx * dx + dy * dy + dz * dz > TELEPORT_D2) return [b[0], b[1], b[2]];
  return [a[0] + dx * k, a[1] + dy * k, a[2] + dz * k];
};
function indexOf(flat: number[], stride: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let o = 0; o + stride <= flat.length; o += stride) m.set(flat[o], o);
  return m;
}

export class Net {
  id = '';
  mode: 'solo' | 'multi' = 'multi';
  private ws: WebSocket | null = null;
  private snaps: Entry[] = [];
  private fxQueue: FxEvent[] = [];
  // Reconstruction des snapshots différentiels (Snapshot.d) : état complet courant
  private propState = new Map<number, number[]>();
  private vehState: VehicleSnap[] = [];
  private names = new Map<string, string>();
  private wheelAcc = 0;
  /** Compteurs pour les tests. */
  snapCount = 0;
  onWelcome: () => void = () => {};
  onChat: (m: ChatMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  onError: (message: string) => void = () => {};

  connect(name: string) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => this.send({ type: 'join', name });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      if (msg.type === 'welcome') {
        this.id = msg.id;
        this.mode = msg.mode;
        this.onWelcome();
      } else if (msg.type === 'snap') {
        this.snapCount++;
        this.expand(msg.s);
        // Chaque snapshot reçu apporte ses événements une seule fois
        if (msg.s.fx?.length) for (const f of msg.s.fx) this.fxQueue.push(f);
        if (this.fxQueue.length > 200) this.fxQueue.splice(0, this.fxQueue.length - 200);
        this.snaps.push({ s: msg.s, at: performance.now() });
        if (this.snaps.length > 30) this.snaps.shift();
      } else if (msg.type === 'chat') {
        this.onChat(msg.m);
      } else if (msg.type === 'error') {
        this.onError(msg.message);
      }
    };
    ws.onclose = () => this.onClose('Connexion au serveur perdue.');
    ws.onerror = () => this.onError('Impossible de joindre le serveur.');
  }

  /** Transforme un snapshot différentiel en snapshot complet (props, véhicules, noms) ; un snapshot complet remet l'état à zéro. */
  private expand(s: Snapshot) {
    s.fx ??= [];
    for (const p of s.players) {
      if (p.name === undefined) p.name = this.names.get(p.id) ?? '';
      else this.names.set(p.id, p.name);
    }
    if (this.names.size > 64) for (const id of this.names.keys()) if (!s.players.some((p) => p.id === id)) this.names.delete(id);
    const full = !s.d;
    if (full) { this.propState.clear(); this.vehState = []; }
    for (const id of s.rm ?? []) this.propState.delete(id);
    const pr = s.props;
    for (let o = 0; o + PROP_STRIDE <= pr.length; o += PROP_STRIDE) this.propState.set(pr[o], pr.slice(o, o + PROP_STRIDE));
    if (s.d) {
      const idx = s.vi ?? [];
      idx.forEach((vi, j) => { this.vehState[vi] = s.vehicles[j]; });
      this.vehState.length = s.vn ?? this.vehState.length;
      s.vehicles = this.vehState.slice();
      const flat: number[] = [];
      for (const a of this.propState.values()) for (let j = 0; j < PROP_STRIDE; j++) flat.push(a[j]);
      s.props = flat;
    } else this.vehState = s.vehicles.slice();
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Cumule des crans de molette ; envoyés (puis remis à zéro) avec le prochain Input. */
  addWheel(n: number) {
    this.wheelAcc += n;
  }

  /** Envoie l'Input v2 ; le cumul de molette part avec et repart à zéro. */
  sendInput(i: Omit<Input, 'wheel'>) {
    this.send({ type: 'input', i: { ...i, wheel: this.wheelAcc } });
    this.wheelAcc = 0;
  }

  /** Événements fx reçus depuis le dernier appel (chacun n'est rendu qu'une fois). */
  drainFx(): FxEvent[] {
    if (!this.fxQueue.length) return this.fxQueue;
    const q = this.fxQueue;
    this.fxQueue = [];
    return q;
  }

  sample(now: number): Sampled | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const last = this.snaps[n - 1];
    const renderT = Math.min(last.s.t, last.s.t - INTERP_MS + (now - last.at));
    let i = n - 1;
    while (i > 0 && this.snaps[i].s.t > renderT) i--;
    const ea = this.snaps[i], eb = this.snaps[Math.min(i + 1, n - 1)];
    const a = ea.s, b = eb.s;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t))) : 1;

    const players = b.players.map((pb) => {
      const pa = a.players.find((p) => p.id === pb.id) ?? pb;
      return { ...pb, p: lerpV(pa.p, pb.p, k), yaw: lerpAngle(pa.yaw, pb.yaw, k), sc: lerp(pa.sc ?? pb.sc ?? 1, pb.sc ?? 1, k) };
    });

    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const vehicles = b.vehicles.map((vb, idx) => {
      const va = a.vehicles[idx] && a.vehicles[idx].type === vb.type ? a.vehicles[idx] : vb;
      qa.set(...va.q);
      qb.set(...vb.q);
      qa.slerp(qb, k);
      return {
        ...vb,
        p: lerpV(va.p, vb.p, k),
        q: [qa.x, qa.y, qa.z, qa.w] as VehicleSnap['q'],
        sp: lerp(va.sp, vb.sp, k),
        st: lerp(va.st, vb.st, k),
        hp: lerp(va.hp, vb.hp, k),
        a: vb.a.map((x, j) => lerp(va.a[j] ?? x, x, k)),
      };
    });

    // Props : un par id (ils apparaissent et disparaissent entre deux snapshots)
    ea.propIdx ??= indexOf(a.props, PROP_STRIDE);
    const pa = a.props, pb = b.props;
    const np = Math.floor(pb.length / PROP_STRIDE);
    const props = new Float32Array(np * PROP_STRIDE);
    for (let c = 0; c < np; c++) {
      const o = c * PROP_STRIDE;
      const oa = ea.propIdx.get(pb[o]);
      for (let j = 0; j < PROP_STRIDE; j++) props[o + j] = pb[o + j];
      if (oa === undefined) continue;
      const dx = pb[o + 2] - pa[oa + 2], dy = pb[o + 3] - pa[oa + 3], dz = pb[o + 4] - pa[oa + 4];
      if (dx * dx + dy * dy + dz * dz > TELEPORT_D2) continue;
      props[o + 2] = pa[oa + 2] + dx * k;
      props[o + 3] = pa[oa + 3] + dy * k;
      props[o + 4] = pa[oa + 4] + dz * k;
      qa.set(pa[oa + 5], pa[oa + 6], pa[oa + 7], pa[oa + 8]);
      qb.set(pb[o + 5], pb[o + 6], pb[o + 7], pb[o + 8]);
      qa.slerp(qb, k);
      props[o + 5] = qa.x; props[o + 6] = qa.y; props[o + 7] = qa.z; props[o + 8] = qa.w;
    }

    ea.projIdx ??= indexOf(a.proj, PROJ_STRIDE);
    const ja = a.proj, jb = b.proj;
    const nj = Math.floor(jb.length / PROJ_STRIDE);
    const proj = new Float32Array(nj * PROJ_STRIDE);
    for (let c = 0; c < nj; c++) {
      const o = c * PROJ_STRIDE;
      const oa = ea.projIdx.get(jb[o]);
      for (let j = 0; j < PROJ_STRIDE; j++) proj[o + j] = jb[o + j];
      if (oa === undefined) continue;
      for (let j = 2; j < 5; j++) proj[o + j] = lerp(ja[oa + j], jb[o + j], k);
    }
    return { players, vehicles, props, proj };
  }
}
