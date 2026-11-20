// Vérifications automatiques du cœur serveur : npx tsx tests/smoke.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { PROP_INDEX, PROP_KINDS, ITEMS } from '../shared/registry';
import { VEHICLE_BY_TYPE, VEHICLES } from '../shared/vehicles';
import type { VehicleDef } from '../shared/api';
import { runCommand } from '../server/commands';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const run = (sim: Sim, seconds: number, each?: (k: number) => void) => {
  const n = Math.round(seconds / STEP);
  for (let k = 0; k < n; k++) { each?.(k); sim.step(); }
};
const errors: string[] = [];
const fresh = async () => {
  const s = await Sim.create();
  s.log = (l) => errors.push(l);
  s.onAnnounce = () => {};
  return s;
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

async function main() {
  console.log(`Véhicules enregistrés : ${VEHICLES.map((d) => d.type).join(', ')}`);

  // ---------- 1. Dégâts de choc ----------
  {
    const sim = await fresh();
    run(sim, 2);
    const cars = sim.vehicles.filter((v) => v.def.type === 'car');
    const car = cars[0];
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 3, 0.5).setTranslation(-6, 3, -40));
    car.behavior.body.setTranslation({ x: -6, y: 0.5, z: -28 }, true);
    car.behavior.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    run(sim, 1);
    check('choc : la voiture perd des PV contre un mur à 25 m/s', car.hp < car.def.maxHp * 0.8, `hp=${car.hp.toFixed(0)}/${car.def.maxHp}`);
    const car2 = cars[1];
    car2.behavior.body.setLinvel({ x: 0, y: 0, z: -3 }, true);
    run(sim, 1);
    check('choc : rouler doucement ne coûte rien', car2.hp === car2.def.maxHp, `hp=${car2.hp}`);
  }

  // ---------- 2. Explosion de véhicule + réapparition ----------
  {
    const sim = await fresh();
    run(sim, 2);
    const car = sim.vehicles.filter((v) => v.def.type === 'car')[1];
    sim.addPlayer('p1', 'Alice');
    const alice = sim.players.get('p1')!;
    sim.enterVehicle(alice, car, 0);
    sim.snapshot();
    const propsBefore = sim.props.size;
    sim.damageVehicle(car, 99999, 'explosion', null);
    const snap = sim.snapshot();
    const idx = sim.vehicles.indexOf(car);
    check('explosion : véhicule mort, fx boom émis', car.dead && snap.fx.some((e) => e.k === 'boom'));
    check('explosion : débris créés', sim.props.size > propsBefore + 5, `+${sim.props.size - propsBefore}`);
    check('explosion : occupant éjecté', alice.vehicle === null);
    check('explosion : snapshot marque dead=1, hp=0', snap.vehicles[idx].dead === 1 && snap.vehicles[idx].hp === 0);
    run(sim, 12.5);
    check('réapparition : véhicule de retour avec PV pleins après ~12 s', !car.dead && car.hp === car.def.maxHp);
    const sn2 = sim.snapshot();
    check('snapshot : joueur hp/item/sc/seat présents', sn2.players[0].hp >= 0 && typeof sn2.players[0].item === 'string' && sn2.players[0].sc === 1 && sn2.players[0].seat === 0);
    check('snapshot : props à plat stride 10', sn2.props.length % 10 === 0 && sn2.props.length > 0);
    check('snapshot : fx vidés après envoi', sim.snapshot().fx.length === 0);
  }

  // ---------- 3. Blindage : tank vs roquette ----------
  {
    const sim = await fresh();
    run(sim, 1);
    const real = VEHICLE_BY_TYPE.get('tank');
    const car = VEHICLE_BY_TYPE.get('car')!;
    const tankDef: VehicleDef = real ?? { ...car, type: 'tank_test', maxHp: 400, armor: { impact: 0.2, explosion: 0.05, bullet: 0.1 } };
    const tank = sim.spawnExtraVehicle(tankDef, 40, 30, 0)!;
    const victim = sim.spawnExtraVehicle(car, 40, 70, 0)!;
    run(sim, 2);
    for (const z of [30, 70]) sim.spawnProjectile({ kind: 'rocket', pos: V(40, 0.6, z + 12), vel: V(0, 0, -25), owner: null, radius: 6, power: 20, damage: 100 });
    run(sim, 2);
    const tf = tank.hp / tank.def.maxHp;
    check(`blindage : ${tankDef.type} quasi insensible à la roquette${real ? '' : ' (tank fictif : le vrai n\'existe pas encore)'}`, tf > 0.9, `hp=${(tf * 100).toFixed(0)}%`);
    check('blindage : la voiture, elle, prend cher', victim.hp / victim.def.maxHp < 0.7, `hp=${((victim.hp / victim.def.maxHp) * 100).toFixed(0)}%`);
  }

  // ---------- 4. Props explosifs en chaîne ----------
  {
    const sim = await fresh();
    if (!PROP_KINDS.some((k) => k.explosive)) {
      PROP_KINDS.push({ id: 'test_barrel', name: 'Baril test', shape: 'cylinder', size: [0.8, 1.2], color: 0xff0000, mass: 20, hp: 30, explosive: { radius: 5, power: 12, damage: 60 } });
      PROP_INDEX.set('test_barrel', PROP_KINDS.length - 1);
    }
    const kind = PROP_KINDS.find((k) => k.explosive)!;
    const barrels = [0, 1, 2, 3, 4].map((i) => sim.spawnProp(kind.id, V(100 + i * 2, 1, 100), undefined, undefined, null)!);
    run(sim, 1);
    sim.snapshot();
    sim.damageProp(barrels[0], 9999, null);
    let booms = 0;
    run(sim, 4, (k) => { if (k % 2 === 0) booms += sim.snapshot().fx.filter((e) => e.k === 'boom').length; });
    check('chaîne : tous les barils explosent', barrels.every((b) => !sim.props.has(b.id)) && booms >= 5, `explosions=${booms}`);
  }

  // ---------- 5. Outils : physgun, gomme, soudure ----------
  {
    const sim = await fresh();
    sim.addPlayer('p1', 'Bob');
    const bob = sim.players.get('p1')!;
    run(sim, 1);
    bob.body.setTranslation({ x: 200, y: 1, z: 200 }, true);
    run(sim, 0.5);
    const head = () => { const t = bob.body.translation(); return V(t.x, t.y + 0.7, t.z); };
    const aimAt = (p: THREE.Vector3) => p.clone().sub(head()).normalize();
    const setIn = (ad: THREE.Vector3, m1: number, m2: number, item = 'physgun', wheel = 0) => {
      const h = head();
      sim.setInput('p1', { ao: [h.x, h.y, h.z], ad: [ad.x, ad.y, ad.z], m1, m2, item, wheel });
    };
    const pos = (p: { body: RAPIER.RigidBody }) => { const t = p.body.translation(); return V(t.x, t.y, t.z); };
    const crate = sim.spawnProp('crate_m', V(200, 1, 192), undefined, undefined, null)!;
    run(sim, 1);
    run(sim, 0.3, () => setIn(aimAt(pos(crate)), 1, 0));
    const flags = (() => { const s = sim.snapshot().props; for (let i = 0; i < s.length; i += 10) if (s[i] === crate.id) return s[i + 9]; return -1; })();
    check('physgun : saisit le prop visé (held, flag 2)', crate.held && flags === 2, `flags=${flags}`);
    const y0 = pos(crate).y;
    const up = new THREE.Vector3(0, 0.5, -1).normalize();
    run(sim, 1.5, () => setIn(up, 1, 0));
    check('physgun : le prop suit la visée (monte)', pos(crate).y > y0 + 2, `y ${y0.toFixed(1)} -> ${pos(crate).y.toFixed(1)}`);
    const d0 = pos(crate).distanceTo(head());
    run(sim, 1, () => setIn(up, 1, 0, 'physgun', 1));
    check('physgun : la molette éloigne le prop', pos(crate).distanceTo(head()) > d0 + 1.5, `${d0.toFixed(1)} -> ${pos(crate).distanceTo(head()).toFixed(1)} m`);
    setIn(up, 1, 1);
    sim.step();
    run(sim, 1, () => setIn(up, 0, 0));
    const yf = pos(crate).y;
    run(sim, 1, () => setIn(up, 0, 0));
    check('physgun : m2 gèle le prop tenu (immobile en l\'air)', crate.frozen && !crate.held && Math.abs(pos(crate).y - yf) < 0.01 && yf > 2, `y=${yf.toFixed(2)}`);
    run(sim, 0.2, () => setIn(aimAt(pos(crate)), 0, 0));
    setIn(aimAt(pos(crate)), 0, 1);
    sim.step();
    check('physgun : m2 sur un prop gelé le dégèle', !crate.frozen);
    run(sim, 0.3, () => setIn(aimAt(pos(crate)), 1, 0));
    const side = new THREE.Vector3(0, 0.3, -1).normalize();
    let k = 0;
    run(sim, 0.4, () => { setIn(side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.1 * ++k), 1, 0); });
    setIn(side, 0, 0);
    sim.step();
    const lv = crate.body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    check('physgun : relâcher garde la vitesse (lancer)', !crate.held && sp > 3, `v=${sp.toFixed(1)} m/s`);
    // Gomme
    const c2 = sim.spawnProp('crate_s', V(200, 1, 192), undefined, undefined, null)!;
    run(sim, 1);
    const c2p = pos(c2);
    run(sim, 0.3, () => setIn(aimAt(c2p), 1, 0, 'remover'));
    check('gomme : supprime le prop visé', !sim.props.has(c2.id));
    // Soudure
    const w1 = sim.spawnProp('crate_m', V(200, 1, 190), undefined, undefined, null)!;
    const w2 = sim.spawnProp('crate_m', V(203, 1, 190), undefined, undefined, null)!;
    setIn(V(0, 0, -1), 0, 0, 'welder');
    run(sim, 1.5);
    const click = (p: typeof w1) => {
      run(sim, 0.1, () => setIn(aimAt(pos(p)), 0, 0, 'welder'));
      run(sim, 0.1, () => setIn(aimAt(pos(p)), 1, 0, 'welder'));
      run(sim, 0.1, () => setIn(aimAt(pos(p)), 0, 0, 'welder'));
    };
    const joints0 = sim.world.impulseJoints.len();
    click(w1);
    click(w2);
    check('soudure : 2 clics créent un joint fixe', sim.world.impulseJoints.len() === joints0 + 1, `joints ${joints0} -> ${sim.world.impulseJoints.len()}`);
    sim.removeProp(w1);
    check('soudure : le joint disparaît avec le prop', sim.world.impulseJoints.len() === joints0);
  }

  // ---------- 6. Joueur : mort, annonce, réapparition, mods ----------
  {
    const sim = await fresh();
    sim.addPlayer('p1', 'Bob');
    sim.addPlayer('p2', 'Alice');
    const bob = sim.players.get('p1')!, alice = sim.players.get('p2')!;
    const msgs: string[] = [];
    sim.onAnnounce = (t) => msgs.push(t);
    run(sim, 3);
    sim.damagePlayer(bob, 500, alice, 'explosion');
    check('joueur : mort annoncée avec le tueur', msgs.some((m) => m.includes('Bob') && m.includes('Alice')), msgs[0]);
    run(sim, 2.2);
    check('joueur : réapparaît avec 100 PV', bob.hp === 100);
    sim.damagePlayer(bob, 50, null, '');
    check('joueur : invulnérable juste après la réapparition', bob.hp === 100);
    sim.applyMod(alice, { scale: 2, speed: 2 }, 1);
    run(sim, 0.1);
    check('mods : taille reflétée dans le snapshot', sim.snapshot().players.find((p) => p.id === 'p2')!.sc === 2);
    run(sim, 1.2);
    check('mods : expiration', alice.mods.scale === 1 && alice.mods.speed === 1 && sim.snapshot().players[1].sc === 1);
  }

  // ---------- 7. Sauvegarde v2 ----------
  {
    const a = await fresh();
    run(a, 2);
    const kind = 'crate_m';
    const pr = a.spawnProp(kind, V(30, 5, 30), undefined, undefined, null)!;
    a.freezeProp(pr, true);
    const exc = a.vehicles.find((v) => v.def.type === 'excavator')!;
    exc.behavior.body.setTranslation({ x: 50, y: 1, z: 50 }, true);
    const st = exc.behavior.state!();
    st[1] += 0.2;
    exc.behavior.restore!(st);
    const extra = a.spawnExtraVehicle(VEHICLE_BY_TYPE.get('car')!, 70, 70, 0)!;
    run(a, 1);
    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = await fresh();
    b.restore(data);
    const exc2 = b.vehicles.find((v) => v.def.type === 'excavator')!;
    const t = exc2.behavior.body.translation();
    check('sauvegarde : position de la pelleteuse restaurée', Math.abs(t.x - 50) < 0.1 && Math.abs(t.z - 50) < 0.1);
    check('sauvegarde : angles du bras restaurés', Math.abs(exc2.behavior.state!()[1] - st[1]) < 1e-6);
    const pr2 = [...b.props.values()].find((p) => p.kind.id === kind && Math.abs(p.body.translation().x - 30) < 0.1);
    check('sauvegarde : props restaurés (gelé conservé)', !!pr2 && pr2.frozen);
    check('sauvegarde : véhicule /spawn recréé', b.vehicles.some((v) => v.extra && Math.abs(v.behavior.body.translation().x - 70) < 0.5) && extra.extra);
    const before = b.props.size;
    let threw = false;
    try {
      b.restore({ version: 1, crates: [], vehicles: [], players: {} } as never);
      b.restore(null as never);
      b.restore({ version: 2, props: 'x', vehicles: [{ type: 'car' }] } as never);
    } catch { threw = true; }
    check('sauvegarde : v1 / données invalides ignorées proprement', !threw && b.props.size === before);
  }

  // ---------- 8. Deux minutes simulées, joueurs aléatoires ----------
  {
    const sim = await fresh();
    errors.length = 0;
    const ids = ['p1', 'p2', 'p3', 'p4'];
    ids.forEach((id, i) => sim.addPlayer(id, `Bot${i}`));
    const itemIds = ['', ...ITEMS.map((i) => i.id)];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const state: Record<string, unknown> = {};
    let threw: unknown = null;
    const t0 = Date.now();
    try {
      run(sim, 120, (k) => {
        if (k % 30 === 0) {
          for (const id of ids) {
            const ad = new THREE.Vector3(rnd(-1, 1), rnd(-0.5, 0.5), rnd(-1, 1)).normalize();
            const t = sim.players.get(id)!.body.translation();
            state[id] = {
              f: rnd(-1, 1), s: rnd(-1, 1), sw: rnd(-1, 1), bm: rnd(-1, 1), st: rnd(-1, 1), bk: rnd(-1, 1), jump: Math.random() < 0.2 ? 1 : 0,
              yaw: rnd(-3, 3), yw: rnd(-1, 1), th: rnd(-1, 1), hn: Math.random() < 0.1 ? 1 : 0, m1: Math.random() < 0.5 ? 1 : 0, m2: Math.random() < 0.2 ? 1 : 0,
              ao: [t.x, t.y + 1, t.z], ad: [ad.x, ad.y, ad.z], item: itemIds[Math.floor(Math.random() * itemIds.length)], wheel: Math.round(rnd(-2, 2)),
            };
          }
        }
        for (const id of ids) sim.setInput(id, state[id] as never);
        if (k % 300 === 0) {
          const p = sim.players.get(ids[Math.floor(Math.random() * 4)])!;
          const cmds = ['/spawn car', '/spawn excavator', '/drive car', '/drive excavator', '/taille 2', '/gravite 3', '/gravite normal', '/help', '/tp Bot1', '/clear', '/spawn nimportequoi'];
          runCommand(sim, p, cmds[Math.floor(Math.random() * cmds.length)], () => {});
        }
        if (k % 240 === 0) sim.interact(ids[Math.floor(Math.random() * 4)]);
        if (k % 600 === 0) sim.explode(V(rnd(-20, 20), 1, rnd(-20, 20)), 8, 15, 80, null);
        if (k % 20 === 0 && sim.snapshot().props.length % 10) throw new Error('snapshot invalide');
      });
    } catch (e) { threw = e; }
    check('2 min simulées sans exception (4 joueurs, tous les objets, commandes, explosions)', !threw && errors.length === 0,
      threw ? String(threw) : errors.length ? errors[0].slice(0, 300) : `${((Date.now() - t0) / 1000).toFixed(1)} s réelles`);
  }

  console.log(fails ? `\n${fails} vérification(s) en échec` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
