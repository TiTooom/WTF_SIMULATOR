// Harnais physique sans rendu : pilote un véhicule avec des entrées scriptées et imprime sa télémétrie.
//   npx tsx tests/harness.ts <type> [avance|virage|tir|crash] [secondes]
// Utilisable aussi comme bibliothèque : driveScenario(typeId, inputFn, seconds).
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { VEHICLE_BY_TYPE, VEHICLES } from '../shared/vehicles';
import type { FxEvent, Input } from '../shared/protocol';
import type { SimPlayer, SimVehicle } from '../shared/api';

export type InputFn = (t: number, ctx: { sim: Sim; player: SimPlayer; vehicle: SimVehicle }) => Partial<Input>;

export interface Row { t: number; p: [number, number, number]; speed: number; alt: number; hp: number; dead: boolean; fx: string }
export interface DriveResult { sim: Sim; player: SimPlayer; vehicle: SimVehicle; rows: Row[]; fx: FxEvent[]; error?: string }

const f2 = (n: number) => n.toFixed(2).padStart(8);

/**
 * Crée un Sim, ajoute un joueur dans le véhicule `typeId` (créé devant lui si besoin), applique `inputFn(t)` à 60 Hz pendant `seconds`
 * et renvoie la télémétrie (une ligne toutes les `every` secondes, 0.5 par défaut) + tous les fx émis.
 */
export async function driveScenario(typeId: string, inputFn: InputFn, seconds: number, opts: { print?: boolean; every?: number } = {}): Promise<DriveResult> {
  const sim = await Sim.create();
  sim.log = (l) => console.log(l);
  const messages: string[] = [];
  sim.onAnnounce = (t) => messages.push(t);
  sim.addPlayer('p1', 'Testeur');
  const player = sim.players.get('p1')!;
  let vehicle = sim.vehicles.find((v) => v.def.type === typeId && !v.dead) as SimVehicle | undefined;
  const def = VEHICLE_BY_TYPE.get(typeId);
  if (!vehicle && def) vehicle = sim.spawnExtraVehicle(def, 0, -30, 0) ?? undefined;
  if (!vehicle) {
    const err = `Type de véhicule inconnu ou pas encore écrit : « ${typeId} ». Disponibles : ${VEHICLES.map((d) => d.type).join(', ')}`;
    return { sim, player, vehicle: undefined as unknown as SimVehicle, rows: [], fx: [], error: err };
  }
  for (let i = 0; i < 90; i++) sim.step(); // laisse tout se poser
  sim.enterVehicle(player, vehicle, 0);
  const rows: Row[] = [];
  const allFx: FxEvent[] = [];
  const every = Math.round((opts.every ?? 0.5) / STEP);
  const n = Math.round(seconds / STEP);
  if (opts.print) console.log(`${'t(s)'.padStart(6)} ${'x'.padStart(8)} ${'y'.padStart(8)} ${'z'.padStart(8)} ${'vit m/s'.padStart(8)} ${'alt'.padStart(8)}  hp   événements`);
  let fxBuf: string[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k * STEP;
    sim.setInput('p1', { ...inputFn(t, { sim, player, vehicle }) });
    sim.step();
    if (k % 2 === 0) { // même cadence que les snapshots : on collecte les fx
      const snap = sim.snapshot();
      for (const e of snap.fx) { allFx.push(e); fxBuf.push(e.k + (e.s ? `:${e.s}` : '')); }
    }
    if (k % every === 0) {
      const b = vehicle.behavior.body;
      const tr = vehicle.dead || !b ? { x: NaN, y: NaN, z: NaN } : b.translation();
      const lv = vehicle.dead || !b ? { x: 0, y: 0, z: 0 } : b.linvel();
      const row: Row = {
        t: +t.toFixed(2), p: [tr.x, tr.y, tr.z], speed: Math.hypot(lv.x, lv.y, lv.z), alt: tr.y,
        hp: vehicle.hp / vehicle.def.maxHp, dead: vehicle.dead, fx: [...new Set(fxBuf)].join(','),
      };
      fxBuf = [];
      rows.push(row);
      if (opts.print)
        console.log(`${t.toFixed(2).padStart(6)} ${f2(row.p[0])} ${f2(row.p[1])} ${f2(row.p[2])} ${f2(row.speed)} ${f2(row.alt)}  ${(row.hp * 100).toFixed(0).padStart(3)}%  ${row.dead ? 'DÉTRUIT ' : ''}${row.fx}`);
    }
  }
  if (opts.print && messages.length) console.log('Annonces :', messages.join(' | '));
  return { sim, player, vehicle, rows, fx: allFx };
}

/** Scénarios génériques (aéronefs : th = gaz, f > 0 = piquer). */
export const SCENARIOS: Record<string, { seconds: number; input: InputFn; help: string }> = {
  avance: { seconds: 8, help: 'tout droit, plein gaz', input: () => ({ f: 1, th: 1 }) },
  virage: { seconds: 10, help: 'avance en braquant à droite puis à gauche', input: (t) => ({ f: 1, th: 1, s: t < 5 ? 1 : -1, yw: t < 5 ? 1 : -1 }) },
  tir: { seconds: 8, help: 'avance doucement en tirant (m1) et en klaxonnant', input: (t) => ({ f: 0.4, th: 0.5, m1: Math.floor(t * 2) % 2, m2: t > 4 ? 1 : 0, hn: t > 2 && t < 2.2 ? 1 : 0 }) },
  crash: { seconds: 12, help: 'fonce tout droit puis pique : doit abîmer ou détruire', input: (t) => ({ f: t < 6 ? 1 : 1, th: 1, jump: 0 }) },
};

async function main() {
  const [type, scen = 'avance', secs] = process.argv.slice(2);
  if (!type) {
    console.log(`Usage : npx tsx tests/harness.ts <type> [${Object.keys(SCENARIOS).join('|')}] [secondes]\nTypes : ${VEHICLES.map((d) => d.type).join(', ')}`);
    return;
  }
  const sc = SCENARIOS[scen];
  if (!sc) { console.log(`Scénario inconnu : ${scen}. Choix : ${Object.keys(SCENARIOS).join(', ')}`); return; }
  console.log(`# ${type} / ${scen} — ${sc.help}`);
  const r = await driveScenario(type, sc.input, Number(secs) || sc.seconds, { print: true });
  if (r.error) { console.log(r.error); process.exitCode = 1; }
}

if (process.argv[1]?.includes('harness')) main().catch((e) => { console.error(e); process.exit(1); });
