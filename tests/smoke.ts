// Vérifications automatiques du cœur serveur (vague 1 : ville, pool de véhicules, sauvegarde v3, contrats de jeu) : npx tsx tests/smoke.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, type SaveData } from '../shared/sim';
import { CITY, buildCityUncached, getCity } from '../shared/city/layout';
import { DISTRICT_IDS } from '../shared/ids';
import { GROUND, VEHICLE_POOL } from '../shared/constants';
import { parseGameMsg } from '../shared/game';
import { PED_STRIDE } from '../shared/protocol';
import { STEP } from '../shared/constants';
import { NO_INPUT } from '../shared/protocol';
import { PROP_INDEX, PROP_KINDS } from '../shared/registry';
import { VEHICLES } from '../shared/vehicles';
import { ACTIONS, defaultSettings, sanitizeSettings } from '../shared/settings';
import { runCommand } from '../server/commands';
import { SYSTEMS, installGame } from '../server/game';
import { GameBus, type SystemFactory } from '../shared/game';
import { bodyOk } from '../shared/guard';
import type { SimVehicle } from '../shared/api';

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
  check('un seul type de véhicule défini (vague 1, temporaire) : citadine', VEHICLES.length === 1 && VEHICLES[0].type === 'citadine');

  // ---------- 1. Dégâts de choc ----------
  {
    const sim = await fresh();
    run(sim, 2);
    const cars = sim.vehicles.filter((v) => v.def.type === 'citadine' && !v.pooled);
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
    const car = sim.vehicles.filter((v) => v.def.type === 'citadine' && !v.pooled)[1];
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
    const p0 = sn2.players[0] as unknown as Record<string, unknown>;
    check('snapshot : joueur hp/seat présents, plus d\'item ni de sc', sn2.players[0].hp >= 0 && sn2.players[0].seat === 0 && !('item' in p0) && !('sc' in p0));
    check('snapshot : props à plat stride 10', sn2.props.length % 10 === 0 && sn2.props.length > 0);
    check('snapshot : fx vidés après envoi', sim.snapshot().fx.length === 0);
  }

  // ---------- 3. Roquette contre une voiture (explosion avec dégâts) ----------
  {
    const sim = await fresh();
    run(sim, 1);
    const car = sim.vehicles.find((v) => v.def.type === 'citadine' && !v.pooled)!;
    const t = car.behavior.body.translation();
    sim.spawnProjectile({ kind: 'rocket', pos: V(t.x, 0.6, t.z + 12), vel: V(0, 0, -25), owner: null, radius: 6, power: 20, damage: 100 });
    run(sim, 2);
    check('roquette : la voiture prend cher', car.hp / car.def.maxHp < 0.7, `hp=${((car.hp / car.def.maxHp) * 100).toFixed(0)}%`);
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

  // ---------- 5. Joueur : marche, course, mort, annonce, réapparition ----------
  {
    const sim = await fresh();
    sim.addPlayer('p1', 'Bob');
    sim.addPlayer('p2', 'Alice');
    const bob = sim.players.get('p1')!, alice = sim.players.get('p2')!;
    const msgs: string[] = [];
    sim.onAnnounce = (t) => msgs.push(t);
    run(sim, 3);
    // Marche vs course (avant = -z avec yaw 0)
    const dist = (name: 'p1' | 'p2', run_: number) => {
      const p = sim.players.get(name)!;
      p.body.setTranslation({ x: name === 'p1' ? 200 : 220, y: 1, z: 200 }, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      sim.setInput(name, { f: 1, run: run_ });
      const z0 = p.body.translation().z;
      run(sim, 0.1);
      const z1 = p.body.translation().z;
      run(sim, 1);
      const z2 = p.body.translation().z;
      sim.setInput(name, NO_INPUT);
      return { z0, z1, z2 };
    };
    const walk = dist('p1', 0), sprint = dist('p2', 1);
    const dw = walk.z1 - walk.z2, ds = sprint.z1 - sprint.z2;
    check('marche : avance vers -z à ~6 m/s', dw > 4.5 && dw < 7, `${dw.toFixed(2)} m/s`);
    check('course (run) : plus rapide que la marche', ds > dw * 1.3, `${ds.toFixed(2)} m/s`);
    sim.damagePlayer(bob, 500, alice, 'explosion');
    check('joueur : mort annoncée avec le tueur', msgs.some((m) => m.includes('Bob') && m.includes('Alice')), msgs[0]);
    run(sim, 2.2);
    check('joueur : réapparaît avec 100 PV', bob.hp === 100);
    sim.damagePlayer(bob, 50, null, '');
    check('joueur : invulnérable juste après la réapparition', bob.hp === 100);
  }

  // ---------- 6. Input réduit : validation réseau ----------
  {
    const sim = await fresh();
    sim.addPlayer('p1', 'Bob');
    const bob = sim.players.get('p1')!;
    sim.setInput('p1', { f: 99, s: -99, jump: 5 as never, run: 'oui' as never, hn: 1, act: 1, m1: 1, m2: 0, yaw: NaN, ao: [1e9, 1e9, 1e9], ad: [0, 0, 0],
      sw: 1, item: 'physgun', wheel: 9 } as never);
    const i = bob.input as unknown as Record<string, unknown>;
    check('input : valeurs bornées (f, s dans [-1,1], booléens 0/1)', i.f === 1 && i.s === -1 && i.jump === 1 && i.run === 1 && i.hn === 1 && i.act === 1 && i.m1 === 1 && i.m2 === 0);
    check('input : yaw NaN ramené à 0, visée nulle ramenée à -z', i.yaw === 0 && JSON.stringify(i.ad) === '[0,0,-1]');
    check('input : anciens champs (sw, item, wheel…) rejetés', !('sw' in i) && !('item' in i) && !('wheel' in i) && !('th' in i));
    const ao = i.ao as number[];
    check('input : origine de visée bornée près du joueur', Math.hypot(...ao) < 1000);
    sim.setInput('p1', null as never);
    sim.setInput('p1', 'x' as never);
    check('input : valeurs absurdes ignorées sans exception', true);
  }

  // ---------- 7. Réglages : actions inconnues ignorées ----------
  {
    const ids = ACTIONS.map((a) => a.id as string);
    check('réglages : actions attendues', ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'interact', 'horn', 'activity', 'pda', 'chat'].every((a) => ids.includes(a)) && ids.length === 11);
    check('réglages : groupes À pied / Véhicules / Général', ACTIONS.every((a) => ['À pied', 'Véhicules', 'Général'].includes(a.group)));
    const old = { keys: { forward: 'KeyZ', inventory: 'Tab', slot1: 'Digit1', swingLeft: 'ArrowLeft', throttleUp: 'KeyW' }, hotbar: ['physgun', '', '', '', '', '', '', '', ''], sensitivity: 2 };
    const s = sanitizeSettings(old) as unknown as Record<string, unknown> & { keys: Record<string, string> };
    check('réglages : ancien settings.json (inventaire, pelleteuse, hotbar) nettoyé', s.keys.forward === 'KeyZ' && !('inventory' in s.keys) && !('slot1' in s.keys) && !('hotbar' in s) && s.sensitivity === 2);
    const keys = Object.values(s.keys).filter(Boolean);
    check('réglages : une touche = une action', new Set(keys).size === keys.length);
    const d = defaultSettings();
    check('réglages : défauts sans doublon', new Set(Object.values(d.keys)).size === ACTIONS.length);
  }

  // ---------- 8. Ville : déterminisme, géométrie, POI ----------
  {
    const c1 = getCity(), c2 = buildCityUncached(), c3 = buildCityUncached();
    check('ville : mémoïsée (même objet)', getCity() === c1);
    check('ville : identique sur deux calculs indépendants (hash + contenu)', c2.hash === c3.hash && c1.hash === c2.hash
      && JSON.stringify([c2.buildings, c2.pois, c2.blocks]) === JSON.stringify([c3.buildings, c3.pois, c3.blocks]), c1.hash);
    check('ville : 100 îlots, 121 intersections, 220 tronçons', c1.blocks.length === 100 && c1.nodes.length === 121 && c1.edges.length === 220,
      `${c1.blocks.length}/${c1.nodes.length}/${c1.edges.length}`);
    check('ville : ~300 bâtiments (200 à 400)', c1.buildings.length >= 200 && c1.buildings.length <= 400, String(c1.buildings.length));
    const parks = c1.blocks.filter((b) => b.kind !== 'batiments').length;
    check('ville : ~8 % d\'îlots parc/place', parks >= 4 && parks <= 14, String(parks));
    check('monde : GROUND = CITY.BORDER', GROUND === CITY.BORDER);
    check('ville : 5 quartiers présents', DISTRICT_IDS.every((d) => c1.blocks.some((b) => b.district === d)));
    // bâtiments : jamais sur une rue, jamais l'un sur l'autre, dans le monde
    const lines: number[] = [];
    for (let k = 0; k <= CITY.N; k++) lines.push(-CITY.HALF + CITY.CELL * k);
    const hitsRoad = (lo: number, hi: number) => lines.some((l) => lo < l + CITY.ROAD / 2 && hi > l - CITY.ROAD / 2);
    const onRoad = c1.buildings.filter((b) => hitsRoad(b.x - b.w / 2, b.x + b.w / 2) || hitsRoad(b.z - b.d / 2, b.z + b.d / 2));
    check('ville : aucun bâtiment ne chevauche une rue', onRoad.length === 0, String(onRoad.length));
    let overlaps = 0;
    for (let i = 0; i < c1.buildings.length; i++) for (let j = i + 1; j < c1.buildings.length; j++) {
      const a = c1.buildings[i], b = c1.buildings[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2) overlaps++;
    }
    check('ville : aucun chevauchement entre bâtiments', overlaps === 0, String(overlaps));
    check('ville : bâtiments dans l\'enceinte', c1.buildings.every((b) => Math.abs(b.x) + b.w / 2 < CITY.HALF && Math.abs(b.z) + b.d / 2 < CITY.HALF && b.h > 3));
    // POI garantis
    const cnt = (k: string, d?: string) => c1.pois.filter((p) => p.kind === k && (!d || p.district === d)).length;
    check('POI : 2 dealers, 1 planque, 3 caméras, 1 donneur par quartier',
      DISTRICT_IDS.every((d) => cnt('dealer', d) === 2 && cnt('planque', d) === 1 && cnt('camera', d) === 3 && cnt('donneur', d) === 1));
    check('POI : 1 commissariat, 1 hôpital, ~20 parkings', cnt('commissariat') === 1 && cnt('hopital') === 1 && cnt('parking') >= 18 && cnt('parking') <= 22, `parkings=${cnt('parking')}`);
    check('POI : points d\'apparition joueur (≥ 8) et voiture (≥ 2)',
      c1.pois.filter((p) => p.kind === 'spawn' && p.tag === 'player').length >= 8 && c1.pois.filter((p) => p.kind === 'spawn' && p.tag === 'car').length >= 2);
    const inB = (x: number, z: number, m = 0.2) => c1.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
    check('POI : aucun dans un bâtiment', c1.pois.every((p) => !inB(p.x, p.z)), c1.pois.filter((p) => inB(p.x, p.z)).map((p) => p.id).join(','));
    const roadDist = (x: number, z: number) => Math.min(...lines.map((l) => Math.min(Math.abs(x - l), Math.abs(z - l))));
    check('POI : apparitions et parkings sur la chaussée', c1.pois.filter((p) => p.kind === 'spawn' || p.kind === 'parking').every((p) => roadDist(p.x, p.z) <= CITY.ROAD / 2));
    check('POI : tous dans l\'enceinte', c1.pois.every((p) => Math.abs(p.x) < CITY.BORDER && Math.abs(p.z) < CITY.BORDER));
    const ids = new Set(c1.pois.map((p) => p.id));
    check('POI : identifiants uniques', ids.size === c1.pois.length);
    // requêtes
    const b0 = c1.blocks[37];
    check('districtAt / blockAt / chunkOf / nearestNode cohérents',
      c1.districtAt(b0.x, b0.z) === b0.district && c1.blockAt(b0.x, b0.z)?.id === b0.id && c1.blockAt(CITY.HALF + 5, 0) === null
      && c1.chunkOf(-CITY.HALF + 1, -CITY.HALF + 1).id === 0 && c1.chunkOf(CITY.HALF - 1, CITY.HALF - 1).id === 24
      && c1.nearestNode(0, 0).x === 0 && c1.nearestNode(0, 0).z === 0 && c1.nearestNode(1e6, -1e6).id === 10);
    // physique : bâtiments solides, joueurs et voitures de départ sur la chaussée
    const sim = await fresh();
    sim.addPlayer('p1', 'Alice');
    sim.addPlayer('p2', 'Bob');
    run(sim, 2);
    const ta = sim.players.get('p1')!.body.translation(), tb = sim.players.get('p2')!.body.translation();
    check('joueurs : apparaissent sur des rues différentes, posés au sol', Math.hypot(ta.x - tb.x, ta.z - tb.z) > 10 && ta.y > 0.7 && ta.y < 1.6 && !inB(ta.x, ta.z, 0));
    const wc = sim.vehicles.filter((v) => !v.pooled && !v.dead);
    check('monde : 2 voitures de départ sur la chaussée, posées', wc.length === 2 && wc.every((v) => { const t = v.behavior.body.translation(); return t.y > 0.3 && t.y < 1.6 && roadDist(t.x, t.z) <= CITY.ROAD / 2 && !inB(t.x, t.z); }));
    const bd = c1.buildings.find((b) => ![1, 2, 3, 4, 5, 6].some((d) => inB(b.x - b.w / 2 - d, b.z, 0.5)) && b.x - b.w / 2 - 6 > -CITY.HALF)!;
    const pl = sim.players.get('p1')!;
    pl.body.setTranslation({ x: bd.x - bd.w / 2 - 6, y: 1.2, z: bd.z }, true);
    sim.setInput('p1', { f: 0, s: 1, yaw: 0 });
    run(sim, 3);
    check('bâtiment solide : le joueur ne le traverse pas', pl.body.translation().x < bd.x - bd.w / 2 + 0.01, `x=${pl.body.translation().x.toFixed(2)} face=${(bd.x - bd.w / 2).toFixed(2)}`);
    const pw = sim.players.get('p2')!;
    pw.body.setTranslation({ x: CITY.BORDER - 8, y: 1.2, z: 0 }, true);
    sim.setInput('p2', { f: 0, s: 1, yaw: 0 });
    run(sim, 3);
    check('mur de bordure : le joueur ne sort pas du monde', pw.body.translation().x < CITY.BORDER, `x=${pw.body.translation().x.toFixed(1)}`);
  }

  // ---------- 8b. Pool de véhicules ----------
  {
    const sim = await fresh();
    const total = sim.vehicles.length;
    check('pool : taille = VEHICLE_POOL des types définis', total === VEHICLE_POOL.citadine, `${total}`);
    check('pool : 2 voitures prises pour le monde de départ, le reste rangé', sim.vehicles.filter((v) => v.pooled).length === total - 2);
    const t0 = performance.now();
    const bodies0 = sim.world.bodies.len();
    let threw: unknown = null;
    try {
      for (let i = 0; i < 10_000; i++) {
        const v = sim.acquireVehicle('citadine', -32 + (i % 7), -40 + (i % 5), (i % 8) * 0.7, { livery: i % 3, locked: i % 2 === 0, ai: i % 4 === 0 });
        if (!v) throw new Error(`pool vide à l'itération ${i}`);
        if (i % 500 === 0) sim.step();
        sim.releaseVehicle(v);
        if (i % 1000 === 999) sim.step();
      }
    } catch (e) { threw = e; }
    check('pool : 10 000 acquire/release sans exception, monde sain', !threw && !sim.broken, threw ? String(threw) : `${(performance.now() - t0).toFixed(0)} ms`);
    check('pool : world.bodies.len() constant après 10 000 acquire/release', sim.world.bodies.len() === bodies0 && sim.vehicles.length === total, `${bodies0} -> ${sim.world.bodies.len()}`);
    check('pool : tous les véhicules reviennent rangés', sim.vehicles.filter((v) => v.pooled).length === total - 2);
    run(sim, 1);
    check('pool : simulation saine après le brassage', !sim.broken && errors.length === 0, errors[0]);

    // VRef : valide, puis nulle après recyclage (même si le même corps est ré-acquis)
    const v = sim.acquireVehicle('citadine', 40, -40, 0)!;
    const ref = sim.refOf(v);
    check('resolveRef : valide tant que le véhicule est en jeu', sim.resolveRef(ref) === v && sim.resolveRef({ ...ref }) === v);
    sim.releaseVehicle(v);
    check('resolveRef : null après releaseVehicle', sim.resolveRef(ref) === null && v.gen === ref.gen + 1 && v.pooled);
    const v2 = sim.acquireVehicle('citadine', 40, -40, 0)!;
    check('resolveRef : une ancienne référence reste nulle après ré-acquisition du même corps', v2 === v && sim.resolveRef(ref) === null && sim.resolveRef(sim.refOf(v2)) === v2);
    check('resolveRef : entrées absurdes → null', [null, undefined, { id: -1, gen: 0 }, { id: 9999, gen: 0 }, { id: 1.5, gen: 0 }, { id: 0, gen: NaN }, {} as never].every((r) => sim.resolveRef(r as never) === null));
    sim.releaseVehicle(v2);
    sim.releaseVehicle(v2); // idempotent
    check('releaseVehicle idempotent', v2.pooled && v2.gen === ref.gen + 2);

    // véhicule détruit : désactivé (corps toujours dans le monde), puis recyclé / réapparu selon son origine
    const n0 = sim.world.bodies.len();
    const a = sim.acquireVehicle('citadine', 40, -40, 0)!;
    const aRef = sim.refOf(a);
    sim.damageVehicle(a, 99999, 'explosion', null);
    check('destruction : mort, référence invalide, corps conservé (désactivé)', a.dead && sim.resolveRef(aRef) === null && a.behavior.body.isEnabled() === false);
    run(sim, 12.5);
    check('destruction : un véhicule non « keep » retourne au pool après 12 s', a.pooled && !a.dead);
    const keep = sim.vehicles.find((q) => !q.pooled)!;
    const kRef = sim.refOf(keep);
    sim.damageVehicle(keep, 99999, 'explosion', null);
    run(sim, 12.5);
    check('destruction : un véhicule du monde de départ réapparaît (nouvelle génération)', !keep.dead && !keep.pooled && sim.resolveRef(kRef) === null && sim.resolveRef(sim.refOf(keep)) === keep);
    check('destruction : monde sain, corps du pool toujours présents', sim.world.bodies.len() >= n0 && !sim.broken);

    // snapshot : rangé = dead 2, en jeu avec options
    const w = sim.acquireVehicle('citadine', 60, -40, 0, { livery: 2, locked: true, ai: true })!;
    const snap = sim.snapshotFull();
    const ws = snap.vehicles[(sim.vehicles as SimVehicle[]).indexOf(w)];
    check('snapshot : rangé = dead 2 ; livrée / verrou / IA exposés', snap.vehicles.some((q) => q.dead === 2) && ws.lv === 2 && ws.lk === 1 && ws.ai === 1 && ws.dead === 0);
    const plain = snap.vehicles[sim.vehicles.indexOf(keep)];
    check('snapshot : champs optionnels absents par défaut', plain.lv === undefined && plain.lk === undefined && plain.ai === undefined);

    // ai.input : mène le véhicule ; un conducteur humain a priorité
    const p = (sim.addPlayer('d1', 'Dan'), sim.players.get('d1')!);
    w.ai!.input = { ...NO_INPUT, f: 1 };
    const x0 = w.behavior.body.translation().z;
    run(sim, 2);
    check('ai.input : la voiture pilotée par IA avance', Math.abs(w.behavior.body.translation().z - x0) > 3, `${(w.behavior.body.translation().z - x0).toFixed(1)} m`);
    sim.releaseVehicle(w);
    const w2 = sim.acquireVehicle('citadine', 60, -40, 0, { ai: true })!;
    w2.ai!.input = { ...NO_INPUT, f: 1 };
    p.body.setTranslation({ x: 60, y: 1, z: -40 }, true);
    check('enterVehicle : refusé dans un véhicule rangé dans le pool', !sim.enterVehicle(p, sim.vehicles.find((q) => q.pooled)!, 0));
    check('enterVehicle : accepté dans un véhicule en jeu', sim.enterVehicle(p, w2, 0));
    sim.setInput('d1', { f: 0 });
    const z1 = w2.behavior.body.translation().z;
    run(sim, 2);
    check('ai.input : le conducteur humain (immobile) a priorité sur l\'IA', Math.abs(w2.behavior.body.translation().z - z1) < 1.5, `${(w2.behavior.body.translation().z - z1).toFixed(2)} m`);
    sim.releaseVehicle(w2);
    check('releaseVehicle : le conducteur est éjecté proprement', p.vehicle === null && bodyOk(p.body) && p.body.isEnabled());
    run(sim, 1);
    check('pool : monde sain après tout cela', !sim.broken && errors.length === 0, errors[0]);
  }

  // ---------- 8c. Crochets du jeu (SimHooks) ----------
  {
    const sim = await fresh();
    sim.addPlayer('p1', 'Eve');
    const eve = sim.players.get('p1')!;
    const car = sim.acquireVehicle('citadine', 40, -40, 0)!;
    const seen: string[] = [];
    eve.body.setTranslation({ x: 42, y: 1, z: -40 }, true);
    run(sim, 0.5);
    sim.hooks = { onInteract: () => { seen.push('interact'); return true; }, onEnter: () => seen.push('enter') };
    sim.interact('p1');
    check('hook onInteract : traité => on ne monte pas', eve.vehicle === null && seen.join() === 'interact');
    sim.hooks = { canEnter: () => false, onEnter: () => seen.push('enter') };
    sim.interact('p1');
    check('hook canEnter=false : refusé', eve.vehicle === null);
    sim.hooks = { onEnter: () => seen.push('enter') };
    sim.interact('p1');
    check('hook onEnter appelé à la montée', eve.vehicle === car && seen.includes('enter'));
    sim.interact('p1');
    car.locked = true;
    sim.interact('p1');
    check('verrouillé : E ne monte pas', eve.vehicle === null);
    sim.hooks = { canEnter: () => true };
    check('verrouillé : canEnter=true l\'autorise', sim.enterVehicle(eve, car, 0) && eve.vehicle === car);
    sim.interact('p1');
    sim.hooks = {};
    car.locked = true;
    check('verrouillé : enterVehicle(force) passe outre', sim.enterVehicle(eve, car, 0, true));
    sim.interact('p1');
    let destroyedBy: unknown = 'x';
    let killed = '';
    let shot = 0;
    sim.hooks = {
      onVehicleDestroyed: (_v, by) => { destroyedBy = by; },
      onPlayerKilled: (p, _by, cause) => { killed = `${p.name}:${cause}`; },
      onShot: () => { shot++; },
    };
    sim.damageVehicle(car, 9999, 'bullet', eve);
    check('hook onVehicleDestroyed (avec le responsable)', car.dead && destroyedBy === eve && car.lastHitBy === 'p1');
    run(sim, 1);
    eve.body.setTranslation({ x: 0, y: 1, z: -32 }, true);
    sim.setInput('p1', { m1: 1 });
    run(sim, 0.1);
    sim.setInput('p1', { m1: 0 });
    run(sim, 0.1);
    sim.setInput('p1', { m1: 1 });
    run(sim, 0.1);
    check('hook onShot : un appel par front montant de m1 (à pied)', shot === 2, String(shot));
    run(sim, 3);
    sim.damagePlayer(eve, 999, null, 'bullet');
    check('hook onPlayerKilled', killed === 'Eve:bullet', killed);
    sim.hooks = { onInteract: () => { throw new Error('boum'); }, onPlayerKilled: () => { throw new Error('boum'); } };
    run(sim, 2.2);
    sim.interact('p1');
    sim.damagePlayer(eve, 999, null, 'bullet');
    run(sim, 1);
    check('hooks : une exception dans un crochet ne casse pas la simulation', !sim.broken);
  }

  // ---------- 8d. Sauvegarde v3 ----------
  {
    const a = await fresh();
    a.addPlayer('p1', 'Zoé');
    run(a, 31); // > 30 s : mémorisée au départ
    a.players.get('p1')!.body.setTranslation({ x: 0, y: 1, z: 32 }, true);
    run(a, 0.5);
    a.removePlayer('p1');
    const data = JSON.parse(JSON.stringify(a.serialize())) as SaveData;
    check('sauvegarde v3 : forme { version, players, systems }', data.version === 3 && !!data.players && typeof data.systems === 'object' && !('props' in data) && !('vehicles' in data));
    const b = await fresh();
    b.restore(data);
    b.addPlayer('r1', 'Zoé');
    const t = b.players.get('r1')!.body.translation();
    check('sauvegarde v3 : aller-retour de la position du joueur', Math.abs(t.x) < 1 && Math.abs(t.z - 32) < 1, `x=${t.x.toFixed(1)} z=${t.z.toFixed(1)}`);
    // anciennes sauvegardes ignorées sans erreur
    const c = await fresh();
    let threw = false;
    try {
      c.restore({ version: 2, props: [], vehicles: [], players: { Vieux: [5, 5, 5] } } as never);
      c.restore({ version: 1, crates: [], players: { Vieux: [5, 5, 5] } } as never);
      c.restore(null as never); c.restore('x' as never); c.restore({ version: 3, players: 'x', systems: 4 } as never);
    } catch { threw = true; }
    check('sauvegarde v1/v2 ou invalide : ignorée sans erreur', !threw && !('Vieux' in c.serialize().players));
    const before = c.vehicles.length;
    check('sauvegarde : le pool n\'est pas touché par restore', c.vehicles.length === before && !c.broken);
    // systèmes : aller-retour par installGame avec un système de test, clés dangereuses ignorées
    const saved = SYSTEMS.splice(0, SYSTEMS.length, (((): SystemFactory => () => {
      let n = 0;
      return {
        id: 'economy',
        serialize: () => ({ n }),
        restore: (d) => { const v = (d as { n?: unknown } | null)?.n; if (typeof v === 'number' && Number.isFinite(v)) n = v; },
      };
    })()));
    try {
      const s1 = await fresh();
      const g1 = installGame(s1, { mode: 'solo' });
      const out0 = g1.serialize();
      const s2 = await fresh();
      const g2 = installGame(s2, { mode: 'solo', saved: { economy: { n: 42 } } });
      check('game : état d\'un système restauré puis re-sérialisé', (g2.serialize().economy as { n: number }).n === 42 && (out0.economy as { n: number }).n === 0);
      const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"n":1},"economy":{"n":"x","__proto__":{"polluted":2}},"traffic":{"n":9}}');
      const g3 = installGame(await fresh(), { mode: 'solo' });
      g3.restore(hostile);
      g3.restore('n\'importe quoi'); g3.restore(null); g3.restore([1, 2]); g3.restore(12);
      check('game : restore hostile (__proto__, types faux) sans effet ni pollution', ({} as Record<string, unknown>).polluted === undefined
        && (g3.serialize().economy as { n: number }).n === 0 && Object.keys(g3.serialize()).join() === 'economy');
    } finally { SYSTEMS.splice(0, SYSTEMS.length, ...saved); }
  }

  // ---------- 8e. Contrats de jeu : messages client, bus, PrivateState, peds ----------
  {
    const ok = parseGameMsg({ k: 'trade', dealer: 'dealer_campus_0', good: 'cafe_machine', qty: 3, side: 'buy' });
    check('parseGameMsg : trade valide', ok?.k === 'trade' && ok.qty === 3);
    const bad: unknown[] = [
      null, 5, 'x', [], {}, { k: 'trade' }, { k: 'inconnu' }, { k: 'trade', dealer: 'd', good: 'cocaine', qty: 1, side: 'buy' },
      { k: 'trade', dealer: 'd', good: 'cafe_machine', qty: -1, side: 'buy' }, { k: 'trade', dealer: 'd', good: 'cafe_machine', qty: 1.5, side: 'buy' },
      { k: 'trade', dealer: 'd', good: 'cafe_machine', qty: 1e9, side: 'buy' }, { k: 'trade', dealer: 'd', good: 'cafe_machine', qty: '3', side: 'buy' },
      { k: 'trade', dealer: 'd'.repeat(500), good: 'cafe_machine', qty: 3, side: 'buy' }, { k: 'trade', dealer: 'd', good: 'cafe_machine', qty: 3, side: 'vol' },
      { k: 'mg', r: { sid: 1, ok: 'oui', ms: 100 } }, { k: 'mg', r: { sid: 1, ok: true, ms: NaN } }, { k: 'mg', r: { sid: 1, ok: true, ms: 100, data: new Array(99).fill(1) } },
      { k: 'sms_lu', id: -3 }, { k: 'mission', op: 'tricher', id: 'm1' }, { k: 'stash', op: 'put', good: 'x', qty: 1 },
      JSON.parse('{"k":"sms_lu","id":1,"__proto__":{"x":1}}'),
    ];
    check('parseGameMsg : types faux, valeurs hors bornes, clés dangereuses → null', bad.every((m) => parseGameMsg(m) === null), String(bad.findIndex((m) => parseGameMsg(m) !== null)));
    const clean = parseGameMsg({ k: 'sms_lu', id: 4, extra: 'x', admin: true }) as unknown as Record<string, unknown>;
    check('parseGameMsg : champs inconnus supprimés', clean && JSON.stringify(clean) === '{"k":"sms_lu","id":4}');
    check('parseGameMsg : mini-jeu valide', parseGameMsg({ k: 'mg', r: { sid: 2, ok: true, ms: 1500, data: [1, 2] } })?.k === 'mg');

    const sim = await fresh();
    sim.addPlayer('p1', 'Gus');
    const g = installGame(sim, { mode: 'solo' });
    const pl = sim.players.get('p1')!;
    const me = g.privateFor(pl);
    check('PrivateState de base : district, 0 étoile, repères vides', me.stars === 0 && me.marks.length === 0 && DISTRICT_IDS.includes(me.district) && me.money === 0 && me.unread === 0);
    let threw = false;
    try { for (const m of bad) g.onMessage(pl, m); g.onMessage(pl, ok); } catch { threw = true; }
    check('game.onMessage : messages invalides sans effet ni exception', !threw && g.drainOutbox().length === 0);
    check('game.pedsFlat : vide sans système de piétons (stride 6)', g.pedsFlat().length === 0 && PED_STRIDE === 6);
    // bus : un écouteur qui lève n'empêche pas les autres
    const bus = new GameBus();
    let hits = 0;
    bus.onError = () => { hits += 10; };
    bus.on('debug', () => { throw new Error('x'); });
    bus.on('debug', () => { hits++; });
    bus.emit('debug', { p: pl, what: 'stars', arg: '3' });
    check('GameBus : isolation des écouteurs', hits === 11);
    // /debug inerte mais enregistré (hôte seulement)
    const replies: string[] = [];
    runCommand(sim, pl, '/debug stars 3', (t) => replies.push(t));
    runCommand(sim, pl, '/debug bidon', (t) => replies.push(t));
    check('commande /debug enregistrée (inerte)', replies.length === 2 && /transmis/.test(replies[0]) && /Usage/.test(replies[1]), replies.join(' | '));
  }

  // ---------- 9. Game minimal ----------
  {
    const sim = await fresh();
    const g = installGame(sim, { mode: 'solo' });
    sim.addPlayer('p1', 'Bob');
    let threw = false;
    try {
      g.onJoin(sim.players.get('p1')!);
      g.preStep(); sim.step(); g.postStep();
      g.restore(JSON.parse(JSON.stringify(g.serialize())));
      g.restore('n\'importe quoi');
      g.onLeave(sim.players.get('p1')!);
    } catch { threw = true; }
    check('game : hooks vides appelables, restore robuste', !threw);
  }

  // ---------- 10. Deux minutes simulées, joueurs aléatoires ----------
  {
    const sim = await fresh();
    errors.length = 0;
    const ids = ['p1', 'p2', 'p3', 'p4'];
    ids.forEach((id, i) => sim.addPlayer(id, `Bot${i}`));
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
              f: rnd(-1, 1), s: rnd(-1, 1), jump: Math.random() < 0.2 ? 1 : 0, run: Math.random() < 0.3 ? 1 : 0,
              yaw: rnd(-3, 3), hn: Math.random() < 0.1 ? 1 : 0, act: Math.random() < 0.1 ? 1 : 0, m1: Math.random() < 0.5 ? 1 : 0, m2: Math.random() < 0.2 ? 1 : 0,
              ao: [t.x, t.y + 1, t.z], ad: [ad.x, ad.y, ad.z],
            };
          }
        }
        for (const id of ids) sim.setInput(id, state[id] as never);
        if (k % 300 === 0) {
          const p = sim.players.get(ids[Math.floor(Math.random() * 4)])!;
          const cmds = ['/drive car', '/help', '/tp Bot1', '/tp car', '/spawn car', '/drive nimportequoi'];
          runCommand(sim, p, cmds[Math.floor(Math.random() * cmds.length)], () => {});
        }
        if (k % 240 === 0) sim.interact(ids[Math.floor(Math.random() * 4)]);
        if (k % 600 === 0) sim.explode(V(rnd(-20, 20), 1, rnd(-20, 20)), 8, 15, 80, null);
        if (k % 20 === 0 && sim.snapshot().props.length % 10) throw new Error('snapshot invalide');
      });
    } catch (e) { threw = e; }
    check('2 min simulées sans exception (4 joueurs, commandes, explosions)', !threw && errors.length === 0,
      threw ? String(threw) : errors.length ? errors[0].slice(0, 300) : `${((Date.now() - t0) / 1000).toFixed(1)} s réelles`);
  }

  console.log(fails ? `\n${fails} vérification(s) en échec` : '\nTout est PASS');
  process.exit(fails ? 1 : 0);
}


main().catch((e) => { console.error(e); process.exit(2); });
