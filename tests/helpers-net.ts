// PROPRIÉTAIRE : intégrateur. Outils communs des suites réseau (disjoncteur, sauvegarde, reseau) : vrai serveur + clients `ws` jetables.
import RAPIER from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { unpackMe } from '../shared/me';
import type { PrivateState, GameServerEvent } from '../shared/protocol';
import type { Sim } from '../shared/sim';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(25); return f(); };

let fails = 0;
export const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
export const failCount = () => fails;

/** Provoque la panique Rapier : lecture d'un corps retiré du monde (EMPOISONNE ce monde). */
export function poison(sim: Sim) {
  const b = sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  sim.world.removeRigidBody(b);
  try { b.translation(); } catch { /* attendu */ }
}

export interface Client {
  name: string;
  ws: WebSocket;
  id: string;
  closed: boolean;
  closedAt: number;
  msgs: { type: string; [k: string]: unknown }[];
  chats: string[];
  events: GameServerEvent[];
  me: PrivateState | null;
  meCount: number;
  meMaxBytes: number;
  snaps: number;
  fullSnaps: number;
  snapBytes: number[]; // taille des snapshots delta reçus
  lastSnap: { t?: number; players?: { id: string; p: number[] }[]; vi?: number[]; vn?: number; d?: number; vehicles?: unknown[] } | null;
  errors: string[];
  send(m: unknown): void;
  chat(text: string): void;
  game(m: unknown): void;
}

export function connect(port: number, opts: { host?: string; localAddress?: string; autoPong?: boolean; origin?: string } = {}): Promise<Client> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${opts.host ?? '127.0.0.1'}:${port}/ws`, { ...(opts.localAddress ? { localAddress: opts.localAddress } : {}), ...(opts.autoPong === false ? { autoPong: false } : {}), ...(opts.origin ? { headers: { Origin: opts.origin } } : {}) } as never);
    const c: Client = {
      name: '', ws, id: '', closed: false, closedAt: 0, msgs: [], chats: [], events: [], me: null, meCount: 0, meMaxBytes: 0, snaps: 0, fullSnaps: 0,
      snapBytes: [], lastSnap: null, errors: [],
      send: (m) => { try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* fermé */ } },
      chat: (text) => c.send({ type: 'chat', text }),
      game: (m) => c.send({ type: 'game', m }),
    };
    ws.on('message', (d) => {
      try {
        const raw = d.toString();
        const m = JSON.parse(raw);
        if (m.type === 'snap') {
          c.snaps++;
          c.lastSnap = m.s;
          if (!m.s.d) c.fullSnaps++; else c.snapBytes.push(Buffer.byteLength(raw));
          return;
        }
        if (m.type === 'me') { c.meCount++; c.meMaxBytes = Math.max(c.meMaxBytes, Buffer.byteLength(raw)); c.me = unpackMe(m.s); return; }
        if (m.type === 'game') { c.events.push(m.e); return; }
        if (m.type === 'chat') c.chats.push(String(m.m?.text ?? ''));
        if (m.type === 'welcome') c.id = m.id;
        if (m.type === 'error') c.errors.push(String(m.message));
        c.msgs.push(m);
      } catch { /* ignoré */ }
    });
    ws.on('close', () => { c.closed = true; c.closedAt = Date.now(); });
    ws.on('error', () => { c.closed = true; resolve(c); });
    ws.on('open', () => resolve(c));
  });
}

/** Se connecte et rejoint ; attend « welcome ». */
export async function join(port: number, name: string, opts: Parameters<typeof connect>[1] = {}): Promise<Client> {
  const c = await connect(port, opts);
  c.name = name;
  c.send({ type: 'join', name });
  await until(() => !!c.id || c.closed || c.errors.length > 0, 3000);
  return c;
}

export function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const pub = path.join(dir, 'public');
  fs.mkdirSync(pub);
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>t</title>');
  return { dir, pub, saves: path.join(dir, 'saves'), clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export async function info(port: number) {
  try { return (await (await fetch(`http://127.0.0.1:${port}/info`)).json()) as { game?: string; players: number; name?: string; mode?: string; port?: number; urls?: string[] }; } catch { return null; }
}
