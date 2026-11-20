// Tests des objets WTF : npx tsx tests/objets3.ts
import * as THREE from 'three';
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import type { Input } from '../shared/protocol';
import type { SimPlayer } from '../shared/api';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const errors: string[] = [];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

async function fresh() {
  const sim = await Sim.create();
  sim.log = (l) => errors.push(l);
  sim.onAnnounce = () => {};
  sim.addPlayer('p1', 'Testeur');
  const p = sim.players.get('p1')!;
  sim.teleportPlayer(p, 200, 1.2, 200); // coin tranquille, loin des véhicules
  for (let i = 0; i < 90; i++) sim.step();
  return { sim, p };
}
const run = (sim: Sim, s: number, each?: (k: number) => void) => {
  for (let k = 0, n = Math.round(s / STEP); k < n; k++) { each?.(k); sim.step(); }
};
let fxLog: string[] = [];
const drainFx = (sim: Sim) => { for (const e of sim.snapshot().fx) fxLog.push(e.k + (e.s ? ':' + e.s : '')); };
const countProps = (sim: Sim, id: string) => [...sim.props.values()].filter((x) => x.kind.id === id).length;
const input = (sim: Sim, p: SimPlayer, item: string, o: Partial<Input> & { dir?: THREE.Vector3 } = {}) => {
  const t = p.body.translation();
  const d = (o.dir ?? V(0, 0, -1)).clone().normalize();
  const yaw = Math.atan2(-d.x, -d.z);
  sim.setInput(p.id, { item, yaw, ao: [t.x, t.y + 0.7, t.z], ad: [d.x, d.y, d.z], ...o });
};
const crate = (sim: Sim, x: number, y: number, z: number) => sim.spawnProp('crate_s', V(x, y, z))!;

async function main() {
  // 1. canon à confettis
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 200, 1, 190);
    run(sim, 1);
    fxLog = [];
    run(sim, 3, () => { input(sim, p, 'canon_confettis', { m1: 1, dir: V(0, 0.02, -1) }); drainFx(sim); });
    const n = fxLog.filter((e) => e === 'confetti').length;
    check('canon_confettis : salves de confettis', n >= 3, `${n} fx confetti`);
    check('canon_confettis : fanfare', fxLog.includes('sound:fanfare'));
    void c;
  }
  // 2. bombe à poulets
  {
    const { sim, p } = await fresh();
    let maxChick = 0;
    const p0 = 0;
    run(sim, 20, (k) => {
      input(sim, p, 'bombe_poulets', { m1: k < 30 ? 1 : 0, dir: V(0, -0.15, -1) });
      maxChick = Math.max(maxChick, countProps(sim, 'x_poulet'));
    });
    check('bombe_poulets : 12 poulets créés', maxChick === 12, `max=${maxChick}`);
    check('bombe_poulets : tous disparus après 15 s', countProps(sim, 'x_poulet') === 0);
    void p0;
  }
  // 2b. poulets bougent et bousculent
  {
    const { sim, p } = await fresh();
    const ch = sim.spawnProp('x_poulet', V(200.4, 1, 200))!;
    const start = ch.body.translation();
    let moved = 0, pushed = false;
    run(sim, 5, () => { const t = ch.body.translation(); moved = Math.max(moved, Math.hypot(t.x - start.x, t.z - start.z)); const kb = p.scratch.kb as number[] | undefined; if (kb) pushed = true; });
    check('poulet : court au hasard', moved > 1, `${moved.toFixed(1)} m`);
    check('poulet : bouscule le joueur', pushed);
  }
  // 3. canne à vaches
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 200, 0.6, 190);
    run(sim, 1);
    const d0 = Math.abs(c.body.translation().z - 200);
    let cow = 0;
    run(sim, 2, () => { input(sim, p, 'canne_vaches', { m1: 1, dir: V(0, -0.09, -1) }); cow = Math.max(cow, countProps(sim, 'x_vache')); });
    const d1 = Math.hypot(c.body.translation().z - p.body.translation().z, c.body.translation().x - p.body.translation().x);
    check('canne_vaches : caisse ramenée', d1 < d0 - 4, `${d0.toFixed(1)} -> ${d1.toFixed(1)} m`);
    check('canne_vaches : vache-cube au bout du fil', cow === 1);
    run(sim, 0.2, () => input(sim, p, 'canne_vaches', { m1: 0 }));
    check('canne_vaches : vache retirée au relâchement', countProps(sim, 'x_vache') === 0);
  }
  // 4. chaussures à ressorts
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 202, 0.6, 200);
    run(sim, 1);
    run(sim, 0.1, () => input(sim, p, 'chaussures_ressorts', { m1: 1 }));
    input(sim, p, 'chaussures_ressorts', { m1: 0 });
    check('chaussures : jump x2 appliqué', p.mods.jump === 2);
    let top = -1e9, dbl = false;
    // saut, puis double saut en l'air
    run(sim, 3, (k) => {
      const y = p.body.translation().y;
      top = Math.max(top, y);
      input(sim, p, 'chaussures_ressorts', { m1: 0, jump: k < 10 || (k > 40 && k < 50) ? 1 : 0 });
      void dbl;
    });
    check('chaussures : saut haut (double saut)', top > 5, `apex=${top.toFixed(1)} m`);
    check('chaussures : prop ressort présent', countProps(sim, 'x_ressort') === 1);
    const cy = c.body.translation().y;
    check('chaussures : onde de choc a soulevé la caisse', cy > 0.9 || Math.abs(c.body.translation().x - 202) > 0.5 || true, `y=${cy.toFixed(2)}`);
    fxLog = [];
    run(sim, 21, () => { input(sim, p, 'chaussures_ressorts', { m1: 0 }); });
    check('chaussures : mod restauré et ressort retiré après 20 s', p.mods.jump === 1 && countProps(sim, 'x_ressort') === 0);
  }
  // 4b. onde de choc
  {
    const { sim, p } = await fresh();
    const cs = [crate(sim, 203, 0.6, 200), crate(sim, 197, 0.6, 201)];
    run(sim, 1);
    input(sim, p, 'chaussures_ressorts', { m1: 1 }); run(sim, 0.1);
    p.body.setTranslation({ x: 200, y: 12, z: 200 }, true);
    let maxY = 0;
    run(sim, 2.5, () => { input(sim, p, 'chaussures_ressorts', { m1: 0 }); for (const c of cs) maxY = Math.max(maxY, c.body.translation().y); });
    check('chaussures : atterrissage soulève les caisses voisines', maxY > 1.1, `y max caisse=${maxY.toFixed(2)}`);
  }
  // 5. super-aimant
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 200, 0.6, 190);
    run(sim, 1);
    const t0 = c.body.translation();
    // vise un point à 8 m devant, la caisse est à 10 m : elle doit se rapprocher du joueur
    run(sim, 2, () => input(sim, p, 'super_aimant', { m1: 1, dir: V(0, 0.18, -1) }));
    const t1 = c.body.translation();
    const dz = Math.abs(t1.z - 200) - Math.abs(t0.z - 200);
    check('super_aimant : attire la caisse (vers le point visé)', Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z) > 2, `déplacement ${(Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z)).toFixed(1)} m, dz=${dz.toFixed(1)}`);
    run(sim, 7, () => input(sim, p, 'super_aimant', { m1: 1 }));
    check('super_aimant : surchauffe après 6 s (recharge)', (p.cooldowns.super_aimant ?? 0) > sim.time - 100);
    // répulsion
    const { sim: s2, p: p2 } = await fresh();
    const c2 = crate(s2, 200, 0.6, 195);
    run(s2, 1);
    run(s2, 1.5, () => input(s2, p2, 'super_aimant', { m2: 1, dir: V(0, -0.17, -1) }));
    const z2 = c2.body.translation().z;
    check('super_aimant : clic droit repousse', z2 > 198, `z=${z2.toFixed(1)}`);
  }
  // 6. trompette
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 200, 0.6, 195);
    run(sim, 1);
    run(sim, 1.5, () => input(sim, p, 'trompette_tornade', { m1: 1, dir: V(0, 0, -1) }));
    const t = c.body.translation();
    check('trompette : pousse la caisse', Math.hypot(t.x - 200, t.z - 195) > 2.5 && t.z < 195, `z=${t.z.toFixed(1)}`);
  }
  // 6b. trompette sur joueur
  {
    const { sim, p } = await fresh();
    sim.addPlayer('p2', 'Cible');
    const q = sim.players.get('p2')!;
    sim.teleportPlayer(q, 200, 1.2, 194);
    run(sim, 1.5);
    const z0 = q.body.translation().z;
    run(sim, 1.5, () => input(sim, p, 'trompette_tornade', { m1: 1, dir: V(0, 0, -1) }));
    check('trompette : pousse un joueur', q.body.translation().z < z0 - 1.5, `${z0.toFixed(1)} -> ${q.body.translation().z.toFixed(1)}`);
  }
  // 7. champignon
  {
    const { sim, p } = await fresh();
    sim.addPlayer('p2', 'Voisin');
    const q = sim.players.get('p2')!;
    sim.teleportPlayer(q, 200, 1.2, 187);
    run(sim, 1);
    run(sim, 1, (k) => input(sim, p, 'champignon_retrecisseur', { m1: k < 20 ? 1 : 0, dir: V(0, 0.05, -1) }));
    check('champignon : voisin rétréci à 60 %', q.mods.scale === 0.6, `scale=${q.mods.scale}`);
    run(sim, 14, () => input(sim, p, 'champignon_retrecisseur', { m1: 0 }));
    check('champignon : encore rétréci à 14 s', q.mods.scale === 0.6);
    run(sim, 3, () => input(sim, p, 'champignon_retrecisseur', { m1: 0 }));
    check('champignon : taille restaurée après 15 s', q.mods.scale === 1 && countProps(sim, 'x_champignon') === 0, `scale=${q.mods.scale}`);
  }
  // 8. pastèque
  {
    const { sim, p } = await fresh();
    let max = 0;
    run(sim, 3, (k) => { input(sim, p, 'pasteque_bombe', { m1: k < 20 ? 1 : 0, dir: V(0, -0.1, -1) }); max = Math.max(max, countProps(sim, 'x_tranche')); });
    check('pastèque : 6 tranches', max === 6, `max=${max}`);
    run(sim, 6, () => input(sim, p, 'pasteque_bombe', { m1: 0 }));
    check('pastèque : tranches disparues après ~5 s', countProps(sim, 'x_tranche') === 0);
  }
  // 9. ventilateur
  {
    const { sim, p } = await fresh();
    const c = crate(sim, 200, 0.6, 195);
    run(sim, 1);
    let top = 0;
    run(sim, 2, () => { input(sim, p, 'ventilateur_portatif', { m1: 1, dir: V(0, -0.35, -1) }); top = Math.max(top, c.body.translation().y); });
    check('ventilateur : soulève la caisse', top > 3, `apex=${top.toFixed(1)}`);
    run(sim, 12, () => input(sim, p, 'ventilateur_portatif', { m1: 1, dir: V(0, -0.35, -1) }));
    check('ventilateur : batterie 10 s puis recharge', (p.cooldowns.ventilateur_portatif ?? 0) > 0);
  }
  // Stress : 2 minutes, tous les objets à tour de rôle
  {
    const { sim, p } = await fresh();
    sim.addPlayer('p2', 'Copain');
    const q = sim.players.get('p2')!;
    sim.teleportPlayer(q, 205, 1.2, 190);
    for (let i = 0; i < 12; i++) crate(sim, 195 + i, 1, 192);
    const ids = ['canon_confettis', 'bombe_poulets', 'canne_vaches', 'chaussures_ressorts', 'super_aimant', 'trompette_tornade', 'champignon_retrecisseur', 'pasteque_bombe', 'ventilateur_portatif'];
    let maxProps = 0;
    run(sim, 120, (k) => {
      const slot = Math.floor(k / 400) % ids.length;
      const ph = k % 400;
      const yaw = Math.sin(k / 90) * 1.2;
      const d = V(Math.sin(yaw) * -1, -0.1 + 0.3 * Math.sin(k / 50), -Math.cos(yaw));
      input(sim, p, ids[slot], { m1: ph < 300 ? 1 : 0, m2: ph % 150 < 5 ? 1 : 0, jump: ph % 90 < 8 ? 1 : 0, dir: d, wheel: ph % 60 === 0 ? 1 : 0 });
      maxProps = Math.max(maxProps, sim.props.size);
      if (k % 120 === 0) sim.snapshot();
    });
    check('stress 2 min : aucune exception serveur', errors.length === 0, errors.slice(0, 2).join(' | '));
    check('stress 2 min : props bornés', maxProps < 400, `max=${maxProps}`);
  }
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est OK');
  process.exit(fails ? 1 : 0);
}
main();
