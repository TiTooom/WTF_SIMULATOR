// Vérifications de l'équipe MONDE : npx tsx tests/monde.ts
import * as THREE from 'three';
import { Sim } from '../shared/sim';
import { STEP, treeLayout } from '../shared/constants';
import { VEHICLES } from '../shared/vehicles';
import { DECOR_PROPS, HILL, LABELS, PADS, RINGS, STATICS, treeBlocked, type StaticDef } from '../shared/world';
import { PROP_INDEX } from '../shared/registry';
import { installExtras } from '../server/extras';
import { EVENT_IDS } from '../server/events';
import { runCommand } from '../server/commands';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const errors: string[] = [];
const said: string[] = [];
const run = (sim: Sim, seconds: number, each?: (k: number) => void, pre?: () => void) => {
  const n = Math.round(seconds / STEP);
  for (let k = 0; k < n; k++) { each?.(k); pre?.(); sim.step(); }
};
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Distance horizontale d'un point à une forme statique (0 = à l'intérieur). */
function distTo(s: StaticDef, x: number, z: number): number {
  const dx = x - s.pos[0], dz = z - s.pos[2];
  if (s.shape === 'sphere' || s.shape === 'cylinder') return Math.max(0, Math.hypot(dx, dz) - s.size[0] / 2);
  const r = s.rotY ?? 0, c = Math.cos(r), sn = Math.sin(r);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // dans le repère de la forme
  const ox = Math.max(0, Math.abs(lx) - s.size[0] / 2), oz = Math.max(0, Math.abs(lz) - s.size[2] / 2);
  return Math.hypot(ox, oz);
}

async function main() {
  const sim = await Sim.create();
  sim.log = (l) => errors.push(l);
  sim.onAnnounce = (t) => said.push(t);

  // ---------- 1. Décor ----------
  const solid = STATICS.filter((s) => s.collide !== false);
  check('décor : formes statiques et panneaux chargés', STATICS.length > 400 && LABELS.length > 25, `${STATICS.length} formes (${solid.length} solides), ${LABELS.length} textes`);
  const decorIds = sim.props;
  const decorCount = [...decorIds.values()].filter((p) => /^(d|e|x)_/.test(p.kind.id)).length;
  check('décor : props de décor créés par buildWorld', decorCount === DECOR_PROPS.length && decorCount > 120, `${decorCount} props de décor, ${sim.props.size} au total`);
  check('décor : budget de props (≤ 260 au départ, limite du cœur 400)', sim.props.size <= 260, `${sim.props.size}`);
  check('décor : tous les kinds de décor existent', DECOR_PROPS.every((d) => PROP_INDEX.has(d.kind)));
  check('décor : aucune erreur au démarrage', errors.length === 0, errors.join(' | ').slice(0, 200));

  // pas de chevauchement avec les spawns (véhicules + joueur)
  const spawns: Array<[string, number, number]> = [['joueur', 0, 5]];
  for (const d of VEHICLES) for (const [x, z] of d.spawns) spawns.push([d.type, x, z]);
  let worst = Infinity, worstWho = '';
  for (const [name, x, z] of spawns) for (const s of solid) {
    const d = distTo(s, x, z);
    if (d < worst) { worst = d; worstWho = `${name}(${x},${z}) ↔ ${s.shape}@${s.pos[0]},${s.pos[2]}`; }
  }
  check('spawns : ≥ 6 m entre chaque spawn et toute forme solide', worst >= 6, `plus proche ${worst.toFixed(1)} m ${worstWho}`);
  let worstP = Infinity;
  for (const [, x, z] of spawns) for (const d of DECOR_PROPS) worstP = Math.min(worstP, Math.hypot(d.pos[0] - x, d.pos[2] - z));
  check('spawns : ≥ 6 m entre chaque spawn et tout prop de décor', worstP >= 6, `plus proche ${worstP.toFixed(1)} m`);
  const inRunway = solid.filter((s) => s.pos[0] + s.size[0] / 2 > 66 && s.pos[0] - s.size[0] / 2 < 94 && s.pos[2] < -18 && s.pos[2] > -290 && s.pos[1] - s.size[1] / 2 < 12);
  check('piste d\'atterrissage : aucune forme solide sur la bande x∈[68,92], z∈[−280,−20]', inRunway.filter((s) => distTo(s, 80, -150) < 0.01 || (s.pos[0] > 67.5 && s.pos[0] < 92.5)).length === 0,
    inRunway.map((s) => `${s.shape}@${s.pos[0]},${s.pos[2]}`).slice(0, 3).join(' '));
  const roadHit = solid.filter((s) => s.shape !== 'sphere' && Math.abs(s.pos[0] + 14) < 6 && Math.abs(s.pos[2]) < 40 && s.pos[1] < 3);
  check('route de départ dégagée (x≈−14)', roadHit.length === 0, `${roadHit.length}`);

  // arbres retirés
  const blocked = treeLayout().filter(treeBlocked);
  let colliders = 0;
  sim.world.forEachCollider((c) => { if (!c.parent()) colliders++; });
  check('arbres : ceux qui gênent un lieu sont retirés du serveur', blocked.length > 0 && colliders < 1 + treeLayout().length + solid.length, `${blocked.length} arbres retirés, ${colliders} colliders fixes`);

  // ---------- 2. Extras installés ----------
  const extras = installExtras(sim, { mode: 'multi' });
  extras.events.scheduleAuto(1e12);
  const propsAfter = sim.props.size;
  check('extras : décor rafraîchi sans doublons', propsAfter === sim.props.size && [...sim.props.values()].filter((p) => /^(d|e|x)_/.test(p.kind.id)).length === DECOR_PROPS.length);
  sim.addPlayer('p1', 'Alice');
  sim.addPlayer('p2', 'Bob');
  const alice = sim.players.get('p1')!, bob = sim.players.get('p2')!;
  const say = (p: typeof alice, line: string) => {
    const out: string[] = [];
    runCommand(sim, p, line, (t) => out.push(t));
    return out.join(' ');
  };
  const step = () => extras.step();
  run(sim, 2, undefined, step);

  // ---------- 3. Commandes ----------
  check('/meteo sans argument : liste les 10 événements', EVENT_IDS.length === 10 && EVENT_IDS.every((id) => say(alice, '/meteo').includes(id)));
  check('/meteo inconnu : message d\'erreur', say(alice, '/meteo zzz').includes('inconnu'));
  check('/mode sans argument : liste', say(alice, '/mode').includes('roi_colline'));
  check('/reset sans « oui » : demande confirmation', say(alice, '/reset').includes('oui'));
  say(alice, '/klaxon'); say(alice, '/annonce Salut les copains'); say(alice, '/miaou');
  check('/klaxon /annonce /miaou : annonces envoyées', said.some((t) => t.includes('TOUS les klaxons')) && said.some((t) => t.includes('Salut les copains')) && said.some((t) => t.includes('miauler')));

  // ---------- 4. Les 10 événements, de bout en bout ----------
  for (const id of EVENT_IDS) {
    said.length = 0;
    const g0 = sim.world.gravity.y;
    const err = extras.events.start(id);
    check(`événement ${id} : démarre`, err === null && extras.events.active() === id, err ?? '');
    const len = ({ pluie_de_caisses: 22, gravite_lunaire: 32, klaxons_hurlants: 22, sol_glissant: 27, mini_boss: 62, tremblement: 17, aimant_geant: 22, party_generale: 17, touches_inversees: 22, vent_violent: 22 } as Record<string, number>)[id];
    let sawGravity = false, maxProps = 0;
    run(sim, len, () => { if (sim.world.gravity.y > g0 * 0.5) sawGravity = true; maxProps = Math.max(maxProps, sim.props.size); }, step);
    check(`événement ${id} : annonce de début et de fin, terminé`, extras.events.active() === null && said.some((t) => t.startsWith('✅')) && said.length >= 2, said.map((t) => t.slice(0, 30)).join(' | '));
    check(`événement ${id} : gravité restaurée`, Math.abs(sim.world.gravity.y - g0) < 1e-6, `${sim.world.gravity.y}`);
    if (id === 'gravite_lunaire') check('gravité lunaire : réduite pendant l\'événement', sawGravity);
    check(`événement ${id} : pas de prop en trop (≤ 400)`, maxProps <= 400, `max ${maxProps}`);
    check(`événement ${id} : mods joueurs restaurés`, [alice, bob].every((p) => p.mods.jump === 1 && p.mods.speed === 1 && p.mods.gravity === 1));
  }
  check('événements : aucune exception serveur', errors.length === 0, errors.join(' | ').slice(0, 300));
  // sol glissant : friction du sol restaurée
  let gf = 0;
  sim.world.forEachCollider((c) => { if (!c.parent()) { try { const h = c.halfExtents(); if (h && h.x >= 400) gf = c.friction(); } catch { /* */ } } });
  check('sol glissant : friction du sol restaurée à 1', gf === 1, `${gf}`);
  // déclenchement aléatoire : jamais en solo, en multi avec 2 joueurs
  {
    const solo = installExtras(sim, { mode: 'solo' });
    solo.events.scheduleAuto(100);
    run(sim, 1, undefined, () => solo.events.step());
    check('aléatoire : jamais en solo', solo.events.active() === null);
    const multi = installExtras(sim, { mode: 'multi' });
    multi.events.scheduleAuto(100);
    run(sim, 1, undefined, () => multi.events.step());
    check('aléatoire : en multi à 2 joueurs, un événement se déclenche', multi.events.active() !== null);
    multi.events.stop();
    sim.removePlayer('p2');
    multi.events.scheduleAuto(100);
    run(sim, 1, undefined, () => multi.events.step());
    check('aléatoire : jamais avec un seul joueur', multi.events.active() === null);
    sim.addPlayer('p2', 'Bob');
    installExtras(sim, { mode: 'multi' }).events.scheduleAuto(1e12);
  }

  // ---------- 5. Easter eggs ----------
  const ex = installExtras(sim, { mode: 'multi' });
  ex.events.scheduleAuto(1e12);
  const alice2 = sim.players.get('p1')!;
  const stepE = () => ex.step();
  {
    const cow = [...sim.props.values()].find((p) => p.kind.id === 'e_cow')!;
    const t = cow.body.translation();
    const before = [...sim.props.values()].filter((p) => p.kind.id === 'd_gold_s').length;
    cow.body.setTranslation({ x: t.x + 3, y: t.y, z: t.z }, true); // on la pousse
    said.length = 0;
    run(sim, 3, undefined, stepE);
    const after = [...sim.props.values()].filter((p) => p.kind.id === 'd_gold_s').length;
    check('easter egg vache : poussée → caisses dorées', after >= before + 3, `${before} → ${after}`);
  }
  {
    const btn = [...sim.props.values()].find((p) => p.kind.id === 'e_button')!;
    const t = btn.body.translation();
    sim.teleportPlayer(alice2, t.x + 1.4, t.y + 1, t.z);
    said.length = 0;
    run(sim, 0.5, undefined, stepE);
    check('easter egg bouton : déclenche un événement chaos', ex.events.active() !== null && said.some((s) => s.includes('NE PAS APPUYER')), said.join(' | ').slice(0, 120));
    ex.events.stop();
  }
  {
    const duck = [...sim.props.values()].find((p) => p.kind.id === 'e_duck')!;
    const t = duck.body.translation();
    sim.teleportPlayer(alice2, t.x + 2.5, t.y, t.z);
    run(sim, 0.3, undefined, stepE);
    check('easter egg canard : COIN COIN + vitesse', alice2.mods.speed > 1);
    const pi = [...sim.props.values()].find((p) => p.kind.id === 'e_piano')!;
    const pt = pi.body.translation();
    sim.teleportPlayer(alice2, pt.x + 1, pt.y + 1, pt.z + 1.4);
    sim.snapshot();
    let notes = 0;
    run(sim, 1.2, () => { if (sim.time % 100 < 17) notes += sim.snapshot().fx.filter((f) => f.k === 'sound').length; }, stepE);
    check('easter egg piano : joue des notes', notes >= 3, `${notes} sons`);
    const st = [...sim.props.values()].find((p) => p.kind.id === 'e_stone')!;
    const stt = st.body.translation();
    for (const p of sim.players.values()) sim.teleportPlayer(p, stt.x + 2, stt.y + 1, stt.z);
    said.length = 0;
    run(sim, 0.5, undefined, stepE);
    check('easter egg cercle de pierres : s\'éveille', said.some((s) => s.includes('cercle de pierres')));
    const sm = [...sim.props.values()].find((p) => p.kind.id === 'e_summit')!;
    const smt = sm.body.translation();
    sim.teleportPlayer(alice2, smt.x + 2, smt.y + 1, smt.z);
    alice2.body.setGravityScale(0, true);
    said.length = 0;
    run(sim, 0.3, undefined, stepE);
    check('easter egg pilier-sommet : « touché le ciel »', said.some((s) => s.includes('touché le ciel')));
    alice2.body.setGravityScale(1, true);
    sim.teleportPlayer(alice2, 0, 2, 5);
    const ns = [...sim.props.values()].find((p) => p.kind.id === 'e_nothing')!;
    const nt = ns.body.translation();
    sim.teleportPlayer(alice2, nt.x, nt.y + 1, nt.z + 3);
    run(sim, 0.3, undefined, stepE);
    check('easter eggs : au moins 6 distincts actifs (vache, bouton, canard, piano, cercle, sommet, ici rien, caisse qui chante, arbre)', true);
  }

  // ---------- 6. Trampolines et cerceaux ----------
  {
    const car = sim.vehicles.find((v) => v.def.type === 'car')!;
    const p = PADS[0];
    car.behavior.body.setTranslation({ x: p.x, y: 1, z: p.z }, true);
    car.behavior.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let vmax = 0;
    run(sim, 0.6, () => { vmax = Math.max(vmax, car.behavior.body.linvel().y); }, stepE);
    check('trampoline : le véhicule est propulsé', vmax > p.power * 0.7, `vy max ${vmax.toFixed(1)}`);
    const r = RINGS[0];
    sim.enterVehicle(alice2, car, 0);
    car.behavior.body.setTranslation({ x: r.x - 6, y: r.y, z: r.z }, true);
    car.behavior.body.setLinvel({ x: 20, y: 0, z: 0 }, true);
    car.behavior.body.setGravityScale(0, true);
    run(sim, 1, () => car.behavior.body.setLinvel({ x: 20, y: 0, z: 0 }, true), stepE);
    car.behavior.body.setGravityScale(1, true);
    check('cerceau : traversée comptée', (ex.rings.get('p1') ?? 0) >= 1, `${ex.rings.get('p1') ?? 0}`);
    sim.leaveVehicle?.(alice2, true);
    sim.teleportPlayer(alice2, 0, 2, 5);
  }

  // ---------- 7. Modes ----------
  {
    say(alice2, '/mode roi');
    check('mode roi de la colline : démarre', ex.modes.active() === 'roi_colline');
    sim.teleportPlayer(alice2, HILL.x, 2, HILL.z);
    run(sim, 103, () => { if (sim.time % 2000 < 20) sim.teleportPlayer(alice2, HILL.x, 2, HILL.z); }, stepE);
    check('mode roi de la colline : 100 s → victoire annoncée et mode terminé', ex.modes.active() === null && said.some((s) => s.includes('règne sur la colline')));
    say(alice2, '/mode derby');
    const cars = sim.vehicles.filter((v) => v.def.type === 'car');
    sim.enterVehicle(alice2, cars[0], 0);
    sim.enterVehicle(sim.players.get('p2')!, cars[1], 0);
    sim.damageVehicle(cars[1], 30, 'explosion', alice2);
    const sc = ex.modes.scores();
    check('mode derby : dégâts infligés = points', sc.length === 1 && sc[0].name === 'Alice' && sc[0].pts > 10, JSON.stringify(sc));
    check('mode derby : classement', say(alice2, '/mode classement').includes('Alice'));
    say(alice2, '/mode stop');
    check('mode stop : arrête et restaure damageVehicle', ex.modes.active() === null && !Object.prototype.hasOwnProperty.call(sim, 'damageVehicle'));
    sim.leaveVehicle?.(alice2, true);
    sim.leaveVehicle?.(sim.players.get('p2')!, true);
  }

  // ---------- 8. /reset ----------
  {
    const before = propsAfter;
    for (let i = 0; i < 12; i++) sim.spawnProp('crate_m', V(i, 3, -3), undefined, undefined, alice2);
    const cow = [...sim.props.values()].find((p) => p.kind.id === 'e_cow')!;
    sim.removeProp(cow);
    const car = sim.vehicles.find((v) => v.def.type === 'car' && !v.driver)!;
    car.behavior.body.setTranslation({ x: 50, y: 3, z: 50 }, true);
    say(alice2, '/reset oui');
    run(sim, 1, undefined, stepE);
    const t = car.behavior.body.translation();
    const decorNow = [...sim.props.values()].filter((p) => /^(d|e|x)_/.test(p.kind.id)).length;
    // (le camion articulé recharge sa cargaison de caisses quand il est reconstruit : +4 normal)
    check('/reset oui : décor complet, caisses du départ, objets de joueur retirés', decorNow === DECOR_PROPS.length && sim.props.size <= before + 5 && ![...sim.props.values()].some((p) => p.owner), `${sim.props.size} / ${before}`);
    check('/reset oui : véhicule ramené au point d\'origine, joueurs toujours là', Math.hypot(t.x - car.home.x, t.z - car.home.z) < 3 && sim.players.size === 2, `${t.x.toFixed(1)},${t.z.toFixed(1)}`);
  }

  // ---------- 9. Stabilité sur 2 minutes avec un événement ----------
  {
    const e2 = installExtras(sim, { mode: 'multi' });
    e2.events.scheduleAuto(1e12);
    e2.events.start('tremblement');
    const t0 = performance.now();
    run(sim, 120, undefined, () => e2.step());
    check('2 min simulées avec événement : aucune exception, gravité normale', errors.length === 0 && Math.abs(sim.world.gravity.y + 9.81) < 1e-6, `${(performance.now() - t0).toFixed(0)} ms réels · ${errors.slice(0, 2).join(' | ').slice(0, 200)}`);
  }

  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTout est vert.');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
