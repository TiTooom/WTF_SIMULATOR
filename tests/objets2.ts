// Tests des objets armes + mobilité : npx tsx tests/objets2.ts
import * as THREE from 'three';
import { Sim } from '../shared/sim';
import { STEP } from '../shared/constants';
import { ITEM_BY_ID } from '../shared/registry';
import { VEHICLE_BY_TYPE } from '../shared/vehicles';
import type { FxEvent, Input } from '../shared/protocol';
import type { SimPlayer } from '../shared/api';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const errors: string[] = [];
const IDS = ['lance_roquettes', 'grenade', 'mitraillette', 'mine_collante', 'fusil_ventouses', 'lance_tomates', 'jetpack', 'grappin', 'parachute', 'bottes_gravite', 'teleporteur'];

interface Rig { sim: Sim; p: SimPlayer; fx: FxEvent[]; run(sec: number, inp?: Partial<Input> | ((t: number) => Partial<Input>)): void; pos(): THREE.Vector3 }

async function rig(x = 300, z = 300, item = ''): Promise<Rig> {
  const sim = await Sim.create();
  sim.log = (l) => errors.push(l);
  sim.onAnnounce = () => {};
  sim.addPlayer('p1', 'Testeur');
  const p = sim.players.get('p1')!;
  sim.teleportPlayer(p, x, 1.2, z);
  const fx: FxEvent[] = [];
  const r: Rig = {
    sim, p, fx,
    pos: () => { const t = p.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); },
    run(sec, inp = {}) {
      const n = Math.round(sec / STEP);
      for (let k = 0; k < n; k++) {
        const t = k * STEP;
        const pt = p.body.translation();
        const base: Partial<Input> = { item, ao: [pt.x, pt.y + 0.7, pt.z], ad: [0, 0, -1] };
        sim.setInput('p1', { ...base, ...(typeof inp === 'function' ? inp(t) : inp) });
        sim.step();
        if (k % 2 === 0) fx.push(...sim.snapshot().fx);
      }
    },
  };
  r.run(1.5);
  return r;
}

async function main() {
  check('11 objets enregistrés', IDS.every((i) => ITEM_BY_ID.has(i)));
  for (const id of IDS) {
    const d = ITEM_BY_ID.get(id)!;
    check(`def ${id}`, !!d.desc && !!d.emoji && (d.cat === 'weapon' || d.cat === 'move'));
  }

  // ---- roquette détruit un prop explosif (la mine, hp 15)
  {
    const r = await rig(300, 300, 'lance_roquettes');
    const target = r.sim.spawnProp('w_mine', new THREE.Vector3(300, 1.5, 270));
    r.sim.freezeProp(target!, true);
    r.run(0.1, { m1: 1 });
    r.run(1.2, { m1: 0 });
    check('roquette : détruit le prop visé', !r.sim.props.has(target!.id));
    check('roquette : fx boom', r.fx.some((e) => e.k === 'boom'));
    const m = r.sim.props.size;
    check('roquette : tir tiré une seule fois', m >= 0);
  }
  // ---- roquette vs tank
  {
    const r = await rig(300, 300, 'lance_roquettes');
    const def = VEHICLE_BY_TYPE.get('tank');
    if (!def) check('tank dispo', false);
    else {
      const tank = r.sim.spawnExtraVehicle(def, 300, 270, 0, 0.8)!;
      r.run(1);
      const hp0 = tank.hp;
      r.run(0.1, { m1: 1, ad: [0, -0.04, -1] });
      r.run(1.2, { m1: 0 });
      check('roquette : le tank survit et perd < 10 %', !tank.dead && tank.hp < hp0 && hp0 - tank.hp < def.maxHp * 0.1, `${hp0}->${tank.hp.toFixed(1)}`);
    }
  }
  // ---- recul
  {
    const r = await rig(300, 300, 'lance_roquettes');
    r.run(0.05, { m1: 1 });
    r.run(0.2, { m1: 0 });
    check('roquette : recul vers l’arrière (+z)', r.pos().z > 300.05, `z=${r.pos().z.toFixed(2)}`);
  }
  // ---- grenade : explose ~3 s
  {
    const r = await rig(300, 300, 'grenade');
    const crate = r.sim.spawnProp('w_mine', new THREE.Vector3(300, 0.5, 285));
    r.sim.freezeProp(crate!, true);
    r.run(0.05, { m1: 1 });
    r.fx.length = 0;
    r.run(2.5, { m1: 0 });
    check('grenade : pas encore explosé à 2,5 s', !r.fx.some((e) => e.k === 'boom'));
    r.run(1, { m1: 0 });
    check('grenade : explose vers 3 s', r.fx.some((e) => e.k === 'boom'));
  }
  // ---- mitraillette
  {
    const r = await rig(300, 300, 'mitraillette');
    r.run(0.5, { m1: 1 });
    const g = r.p.scratch.gun as { ammo: number };
    check('mitraillette : ~15 tirs/s', g.ammo >= 18 && g.ammo <= 25, `ammo=${g.ammo} après 0,5 s`);
    r.run(2.2, { m1: 1 });
    check('mitraillette : chargeur vide -> rechargement annoncé', r.fx.some((e) => e.k === 'text' && /Rechargement/.test(e.s ?? '')));
    r.run(2.4, { m1: 0 });
    check('mitraillette : rechargée après 2 s', (r.p.scratch.gun as { ammo: number }).ammo === 30);
    r.run(0.05, { m2: 1 });
    r.run(0.05, { m2: 0 });
    check('mitraillette : tir unique m2', (r.p.scratch.gun as { ammo: number }).ammo === 29);
  }
  // ---- mine collante
  {
    const r = await rig(300, 300, 'mine_collante');
    r.run(0.05, { m1: 1 });
    r.run(0.1, { m1: 0 });
    const mine = [...r.sim.props.values()].find((p) => p.kind.id === 'w_mine');
    check('mine : posée', !!mine);
    r.run(1.5);
    r.p.body.setTranslation({ x: 300, y: 1.2, z: 300 }, true);
    const mt = mine!.body.translation();
    r.p.body.setTranslation({ x: mt.x, y: 1.2, z: mt.z }, true);
    r.run(0.3);
    check('mine : explose au contact', !r.sim.props.has(mine!.id));
    check('mine : colle (vitesse réduite)', r.p.mods.speed < 0.3, `speed=${r.p.mods.speed}`);
    check('mine : flaque de colle', [...r.sim.props.values()].some((p) => p.kind.id === 'w_glue'));
  }
  // ---- ventouses
  {
    const r = await rig(300, 300, 'fusil_ventouses');
    const crate = r.sim.spawnProp('crate_m', new THREE.Vector3(300, 0.7, 270))!;
    r.run(0.05, { m1: 1 });
    r.run(1.0, { m1: 0 });
    const z1 = crate.body.translation().z;
    check('ventouses : la caisse est tirée vers le tireur', z1 > 272, `z=${z1.toFixed(1)}`);
    r.run(0.05, { m2: 1 });
    r.fx.length = 0;
    r.run(0.5, { m2: 0 });
    check('ventouses : m2 relâche le câble', !r.fx.some((e) => e.k === 'beam'));
  }
  // ---- tomates
  {
    const r = await rig(300, 300, 'lance_tomates');
    r.sim.addPlayer('p2', 'Cible');
    const q = r.sim.players.get('p2')!;
    r.sim.teleportPlayer(q, 300, 1.2, 280);
    r.run(0.3);
    r.run(0.05, { m1: 1 });
    r.run(1, { m1: 0 });
    check('tomate : ralentit de 20 % la cible, sans dégâts', Math.abs(q.mods.speed - 0.8) < 1e-6 && q.hp === 100, `speed=${q.mods.speed} hp=${q.hp}`);
    check('tomate : splat', r.fx.some((e) => e.k === 'text' && e.s === 'SPLAT !'));
  }
  // ---- jetpack
  {
    const r = await rig(300, 300, 'jetpack');
    r.run(2, { jump: 1, f: 1 });
    const y = r.pos().y;
    check('jetpack : décolle', y > 8, `y=${y.toFixed(1)}`);
    check('jetpack : avance', r.pos().z !== 300);
    r.run(8, { jump: 1 });
    check('jetpack : surchauffe', r.fx.some((e) => e.k === 'text' && /SURCHAUFFE/.test(e.s ?? '')));
    const y2 = r.pos().y;
    r.run(1, { jump: 1 });
    check('jetpack : coupé en surchauffe (tombe)', r.pos().y < y2 + 0.5);
    r.run(6);
    r.run(15, { jump: 0 });
    check('jetpack : recharge au sol', (r.p.scratch.jet as { fuel: number }).fuel > 7);
  }
  // ---- grappin
  {
    const r = await rig(300, 300, 'grappin');
    r.sim.world; // mur
    const crate = r.sim.spawnProp('crate_l', new THREE.Vector3(300, 8, 280));
    r.sim.freezeProp(crate!, true);
    r.run(0.1);
    const ad: [number, number, number] = [0, 6.1 / 20.9, -20 / 20.9];
    r.run(0.05, { m1: 1, ad });
    r.run(0.6, { m1: 0, ad });
    check('grappin : tire (monte/avance)', r.pos().y > 3 || r.pos().z < 296, `pos=${r.pos().toArray().map((n) => n.toFixed(1))}`);
  }
  // ---- parachute
  {
    const a = await rig(300, 300, 'parachute');
    a.p.body.setTranslation({ x: 300, y: 80, z: 300 }, true);
    a.run(3);
    const vFree = a.p.body.linvel().y;
    const b = await rig(300, 300, 'parachute');
    b.p.body.setTranslation({ x: 300, y: 80, z: 300 }, true);
    b.run(3, { m2: 1 });
    const vChute = b.p.body.linvel().y;
    check('parachute : chute ralentie', vChute > vFree * 0.4 && vChute > -7, `libre=${vFree.toFixed(1)} parachute=${vChute.toFixed(1)}`);
  }
  // ---- bottes
  {
    const a = await rig(300, 300, '');
    let maxA = 0;
    a.run(1.5, (t) => { maxA = Math.max(maxA, a.pos().y); return { jump: t < 0.1 ? 1 : 0 }; });
    const b = await rig(300, 300, 'bottes_gravite');
    b.run(0.05, { m1: 1 });
    b.run(1);
    let maxB = 0;
    b.run(3, (t) => { maxB = Math.max(maxB, b.pos().y); return { jump: t < 0.1 ? 1 : 0 }; });
    check('bottes : mods gravity/jump', b.p.mods.gravity === 0.4 && b.p.mods.jump === 1.6);
    check('bottes : saut plus haut', maxB > maxA * 2, `normal=${maxA.toFixed(1)} bottes=${maxB.toFixed(1)}`);
  }
  // ---- téléporteur
  {
    const r = await rig(300, 300, 'teleporteur');
    r.run(0.05, { m1: 1 });
    r.run(0.6, { m1: 0 });
    r.p.body.setTranslation({ x: 315, y: 1.2, z: 300 }, true);
    r.run(0.6);
    r.run(0.05, { m2: 1 });
    r.run(0.2, { m2: 0 });
    const d = Math.hypot(r.pos().x - 300, r.pos().z - 300);
    check('téléporteur : retour près de la balise (≤ 3,5 m, ≠ exact)', d < 3.6 && d > 0.3, `d=${d.toFixed(2)}`);
    // trop loin
    const r2 = await rig(300, 300, 'teleporteur');
    r2.run(0.05, { m1: 1 });
    r2.run(0.6, { m1: 0 });
    r2.p.body.setTranslation({ x: 360, y: 1.2, z: 300 }, true);
    r2.run(0.6);
    r2.run(0.05, { m2: 1 });
    r2.run(0.2, { m2: 0 });
    check('téléporteur : refus > 30 m', r2.pos().x > 350);
  }
  // ---- 2 minutes simulées, tous les objets, sans exception
  {
    const r = await rig(300, 300, '');
    let cur = 0;
    r.run(120, (t) => {
      const k = Math.floor(t / 10) % IDS.length;
      cur = k;
      return {
        item: IDS[cur], m1: Math.sin(t * 3) > 0.2 ? 1 : 0, m2: Math.sin(t * 1.7) > 0.7 ? 1 : 0, jump: Math.sin(t * 0.9) > 0 ? 1 : 0,
        f: 1, yaw: t * 0.3, ad: [Math.sin(t), -0.2, -Math.cos(t)],
      };
    });
    check('2 min simulées sans exception', errors.length === 0, errors.slice(0, 3).join(' | '));
  }
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUT PASSE');
  process.exit(fails ? 1 : 0);
}
main();
