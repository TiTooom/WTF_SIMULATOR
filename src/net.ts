import * as THREE from 'three';
import type { ChatMsg, ClientMsg, PlayerSnap, ServerMsg, Snapshot, VehicleSnap } from '../shared/protocol';

/** Les états sont rendus ~100 ms dans le passé et interpolés : mouvement fluide malgré 30 envois/s. */
const INTERP_MS = 100;

export interface Sampled {
  players: PlayerSnap[];
  vehicles: VehicleSnap[];
  crates: Float32Array;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Net {
  id = '';
  mode: 'solo' | 'multi' = 'multi';
  private ws: WebSocket | null = null;
  private snaps: { s: Snapshot; at: number }[] = [];
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

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sample(now: number): Sampled | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const last = this.snaps[n - 1];
    const renderT = Math.min(last.s.t, last.s.t - INTERP_MS + (now - last.at));
    let i = n - 1;
    while (i > 0 && this.snaps[i].s.t > renderT) i--;
    const a = this.snaps[i].s;
    const b = this.snaps[Math.min(i + 1, n - 1)].s;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t))) : 1;

    const players = b.players.map((pb) => {
      const pa = a.players.find((p) => p.id === pb.id) ?? pb;
      return {
        ...pb,
        p: [lerp(pa.p[0], pb.p[0], k), lerp(pa.p[1], pb.p[1], k), lerp(pa.p[2], pb.p[2], k)] as [number, number, number],
        yaw: lerpAngle(pa.yaw, pb.yaw, k),
      };
    });

    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const vehicles = b.vehicles.map((vb, idx) => {
      const va = a.vehicles[idx] ?? vb;
      qa.set(...va.q);
      qb.set(...vb.q);
      qa.slerp(qb, k);
      return {
        ...vb,
        p: [lerp(va.p[0], vb.p[0], k), lerp(va.p[1], vb.p[1], k), lerp(va.p[2], vb.p[2], k)] as [number, number, number],
        q: [qa.x, qa.y, qa.z, qa.w] as [number, number, number, number],
        sp: lerp(va.sp, vb.sp, k),
        a: vb.a.map((x, j) => lerp(va.a[j], x, k)) as VehicleSnap['a'],
      };
    });

    const crates = new Float32Array(b.crates.length);
    for (let c = 0; c + 6 < b.crates.length; c += 7) {
      for (let j = 0; j < 3; j++) crates[c + j] = lerp(a.crates[c + j] ?? b.crates[c + j], b.crates[c + j], k);
      qa.set(a.crates[c + 3] ?? b.crates[c + 3], a.crates[c + 4] ?? b.crates[c + 4], a.crates[c + 5] ?? b.crates[c + 5], a.crates[c + 6] ?? b.crates[c + 6]);
      qb.set(b.crates[c + 3], b.crates[c + 4], b.crates[c + 5], b.crates[c + 6]);
      qa.slerp(qb, k);
      crates[c + 3] = qa.x; crates[c + 4] = qa.y; crates[c + 5] = qa.z; crates[c + 6] = qa.w;
    }
    return { players, vehicles, crates };
  }
}
