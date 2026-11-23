// PROPRIÉTAIRE : game-minigames
// Suite « minijeux » : npx tsx tests/minijeux.ts
// Système serveur testé sur un vrai Sim (temps de simulation = 60 pas/s), sans réseau ni port : le contexte de jeu est reconstitué à la main.
// Couvre : résultat trop rapide refusé, sid inconnu/rejoué/d'un autre joueur ignoré, annulation (éloignement, touché, mort, expiration),
// un seul mini-jeu actif par joueur, validations déterministes par graine pour les 8 jeux, parseGameMsg, serialize sans session.
import { Sim } from '../shared/sim';
import { GameBus, parseGameMsg, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { MINIGAME_KINDS, type MinigameKind } from '../shared/ids';
import {
  DIGI_COLS, RULES, briseGlaceSpec, desamorcageSpec, digicodePos, digicodeSpec, dosageSpec, fouilleSpec, liassesSpec, rng, tournevisSpec,
} from '../shared/minigames/rules';
import type { GameServerEvent, MinigameResult } from '../shared/protocol';
import { createMinigames, type MinigameDone, type MinigamesSystem } from '../server/systems/minigames';
import { createTheft, profileOf } from '../server/systems/theft';

let fails = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** Données de réussite valides pour un jeu, construites à partir de la graine (comme le ferait un client honnête). */
function honest(kind: MinigameKind, seed: number, d: number): { data: number[]; ms: number } {
  switch (kind) {
    case 'tournevis': return { data: [tournevisSpec(seed, d).turns, 200], ms: 1500 };
    case 'court_circuit': return { data: [1000], ms: 1500 };
    case 'digicode': {
      const s = digicodeSpec(seed, d);
      const stops: number[] = [];
      let t = 300;
      for (let i = 0; i < DIGI_COLS; i++) {
        while (Math.abs(digicodePos(s.cols[i], t) - s.cols[i].center) > s.cols[i].half * 0.5) t += 5;
        stops.push(t);
        t += 150;
      }
      return { data: stops, ms: Math.max(1200, stops[DIGI_COLS - 1] + 100) };
    }
    case 'dosage': return { data: dosageSpec(seed, d).targets, ms: 2600 };
    case 'fouille': { const s = fouilleSpec(seed); return { data: [s.slot, s.swipes], ms: 1000 }; }
    case 'brise_glace': return { data: [briseGlaceSpec(seed, d).hits], ms: 900 };
    case 'desamorcage': return { data: [desamorcageSpec(seed).wire], ms: 1000 };
    case 'liasses': return { data: [liassesSpec(seed).target], ms: 1100 };
  }
}

async function main() {
  const sim = await Sim.create();
  const errors: string[] = [];
  sim.log = (l) => errors.push(l);
  sim.onAnnounce = () => {};
  sim.addPlayer('p1', 'Alice');
  sim.addPlayer('p2', 'Bob');
  const p1 = sim.players.get('p1')!;
  const p2 = sim.players.get('p2')!;
  sim.teleportPlayer(p2, 40, 1, 40);

  const bus = new GameBus();
  const out: { to: string; ev: GameServerEvent }[] = [];
  const systems = new Map<string, GameSystem>();
  const ctx: GameCtx = {
    sim, bus, city: getCity(), mode: 'solo',
    sendTo: (to, ev) => out.push({ to, ev }),
    broadcast: (ev) => out.push({ to: '*', ev }),
    get: ((id: string) => systems.get(id)) as GameCtx['get'],
  };
  const mg = createMinigames(ctx) as MinigamesSystem;
  systems.set('minigames', mg);
  const doneBus: { kind: string; ok: boolean }[] = [];
  bus.on('minigameDone', (e) => doneBus.push({ kind: e.kind, ok: e.ok }));
  const dones: MinigameDone[] = [];
  mg.onDone((e) => dones.push(e));

  const step = (ms: number) => { for (let i = 0; i < Math.ceil(ms / (1000 / 60)); i++) { sim.step(); mg.postStep?.(); } };
  step(500); // laisse tout se poser
  const ends = (to = 'p1') => out.filter((o) => o.to === to && o.ev.k === 'mg_end').map((o) => o.ev as Extract<GameServerEvent, { k: 'mg_end' }>);
  const starts = (to = 'p1') => out.filter((o) => o.to === to && o.ev.k === 'mg_start').map((o) => (o.ev as Extract<GameServerEvent, { k: 'mg_start' }>).s);
  const send = (id: string, r: MinigameResult) => {
    const p = sim.players.get(id)!;
    const m = parseGameMsg({ k: 'mg', r });
    if (m) mg.onMessage!(p, m);
    return !!m;
  };
  const reset = () => { out.length = 0; dones.length = 0; doneBus.length = 0; };

  // ---- 1. démarrage, un seul actif par joueur ----
  reset();
  const sid1 = mg.startMinigame(p1, 'desamorcage', 'test', 0.5, undefined, 777);
  check('startMinigame renvoie un sid et émet mg_start', typeof sid1 === 'number' && starts().length === 1 && starts()[0].sid === sid1 && starts()[0].seed === 777 && starts()[0].kind === 'desamorcage');
  check('mg_start annonce maxMs de la règle', starts()[0].maxMs === RULES.desamorcage.maxMs);
  check('un seul mini-jeu actif par joueur', mg.startMinigame(p1, 'digicode', 'bis', 0.5) === null && starts().length === 1 && mg.activeOf(p1)?.sid === sid1);
  check('un autre joueur peut jouer en même temps', typeof mg.startMinigame(p2, 'fouille', 'p2', 0.2) === 'number');
  check('un kind inconnu est refusé', mg.startMinigame(p1, 'nimporte' as MinigameKind, 'x', 0) === null);
  check('serialize sans état de session', !/sid|seed|tag/.test(JSON.stringify(mg.serialize!())));
  check('interaction et montée en véhicule bloquées pendant la session', mg.onInteract!(p1) === true && mg.canEnter!(p1, undefined as never) === false);

  // ---- 2. trop rapide, sid inconnu, rejeu ----
  const wire = desamorcageSpec(777).wire;
  reset();
  send('p1', { sid: sid1!, ok: true, ms: 100, data: [wire] });
  check('résultat trop rapide refusé (mg_end ok=false, minigameDone ok=false)', ends().length === 1 && !ends()[0].ok && doneBus.length === 1 && !doneBus[0].ok && dones[0].reason === 'trop_rapide');
  check('session close après le résultat', mg.activeOf(p1) === null);
  reset();
  send('p1', { sid: sid1!, ok: true, ms: 1000, data: [wire] });
  check('sid rejoué ignoré (aucun événement)', out.length === 0 && dones.length === 0);

  const sid2 = mg.startMinigame(p1, 'desamorcage', 'test2', 0.5, undefined, 777)!;
  check('nouveau sid strictement croissant', sid2 > sid1!);
  reset();
  send('p1', { sid: sid2 + 999, ok: true, ms: 1000, data: [wire] });
  check('sid inconnu ignoré, session intacte', out.length === 0 && mg.activeOf(p1)?.sid === sid2);
  send('p2', { sid: sid2, ok: true, ms: 1000, data: [wire] });
  check('sid d\'un autre joueur ignoré', out.length === 0 && mg.activeOf(p1)?.sid === sid2);
  check('message mg malformé rejeté par parseGameMsg', !send('p1', { sid: -1, ok: true, ms: 10 }) && !send('p1', { sid: 1, ok: 'oui' as never, ms: 10 }) && !send('p1', { sid: 1, ok: true, ms: 1, data: 'x' as never }));
  step(1100);
  send('p1', { sid: sid2, ok: true, ms: 1050, data: [(wire + 1) % 4] });
  check('mauvais fil refusé', ends().length === 1 && !ends()[0].ok && dones[0].reason === 'invalide');

  // ---- 3. réussite honnête pour les 8 jeux, + les triches ----
  for (const kind of MINIGAME_KINDS) {
    const seed = 1000 + MINIGAME_KINDS.indexOf(kind) * 37;
    const d = 0.6;
    reset();
    const sid = mg.startMinigame(p1, kind, `ok:${kind}`, d, undefined, seed)!;
    const h = honest(kind, seed, d);
    step(h.ms);
    send('p1', { sid, ok: true, ms: h.ms, data: h.data });
    check(`réussite valide acceptée : ${kind}`, ends().length === 1 && ends()[0].ok && dones[0]?.ok === true && dones[0].tag === `ok:${kind}`, dones[0]?.reason);
    // même résultat, mais sans le temps nécessaire côté serveur : refusé
    reset();
    const sid3 = mg.startMinigame(p1, kind, 'rapide', d, undefined, seed)!;
    send('p1', { sid: sid3, ok: true, ms: h.ms, data: h.data });
    check(`résultat annoncé plus long que la session (triche) refusé : ${kind}`, ends().length === 1 && !ends()[0].ok, dones[0]?.reason);
    // données sans rapport avec la graine
    reset();
    const sid4 = mg.startMinigame(p1, kind, 'faux', d, undefined, seed)!;
    step(h.ms);
    send('p1', { sid: sid4, ok: true, ms: h.ms, data: [0, 0, 0] });
    check(`données incohérentes refusées : ${kind}`, ends().length === 1 && !ends()[0].ok, dones[0]?.reason);
    reset();
    const sid5 = mg.startMinigame(p1, kind, 'sans', d, undefined, seed)!;
    step(h.ms);
    send('p1', { sid: sid5, ok: true, ms: h.ms });
    check(`réussite sans données refusée : ${kind}`, ends().length === 1 && !ends()[0].ok);
  }

  // ---- 4. déterminisme des règles ----
  {
    let same = true;
    let varies = false;
    for (const kind of MINIGAME_KINDS) {
      for (const seed of [1, 2, 3, 4242, 0x7ffffffe]) {
        const h = honest(kind, seed, 0.4);
        const r: MinigameResult = { sid: 1, ok: true, ms: h.ms, data: h.data };
        const a = RULES[kind].validate(seed, 0.4, r);
        const b = RULES[kind].validate(seed, 0.4, { ...r });
        if (a !== b || !a) same = false;
      }
    }
    check('validate déterministe et honnête accepté (8 jeux x 5 graines)', same);
    const w = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => desamorcageSpec(s).wire);
    varies = new Set(w).size > 1;
    check('la couleur du fil dépend de la graine', varies && desamorcageSpec(5).wire === desamorcageSpec(5).wire);
    const r1 = rng(99);
    const r2 = rng(99);
    check('rng reproductible', r1() === r2() && r1() === r2());
    const wrong = (desamorcageSpec(3).wire + 1) % 4;
    check('desamorcage : la bonne graine seule valide', RULES.desamorcage.validate(3, 0, { sid: 1, ok: true, ms: 1000, data: [desamorcageSpec(3).wire] }) && !RULES.desamorcage.validate(3, 0, { sid: 1, ok: true, ms: 1000, data: [wrong] }));
    check('digicode : séquence dérivée de la graine (autre graine refusée)', (() => {
      const h = honest('digicode', 11, 0.5);
      return RULES.digicode.validate(11, 0.5, { sid: 1, ok: true, ms: h.ms, data: h.data }) && !RULES.digicode.validate(12, 0.5, { sid: 1, ok: true, ms: h.ms, data: h.data });
    })());
    check('ok=false ne valide jamais', MINIGAME_KINDS.every((k) => { const h = honest(k, 5, 0.5); return !RULES[k].validate(5, 0.5, { sid: 1, ok: false, ms: h.ms, data: h.data }); }));
    check('durées < 4,5 s et minMs < maxMs', MINIGAME_KINDS.every((k) => RULES[k].minMs < RULES[k].maxMs && RULES[k].maxMs <= 4500));
  }

  // ---- 5. annulations ----
  reset();
  p1.hp = 100;
  const sidA = mg.startMinigame(p1, 'tournevis', 'loin', 0.3)!;
  const here = sim.playerPos(p1);
  sim.teleportPlayer(p1, here[0] + RULES.tournevis.cancelDist + 3, here[1], here[2]);
  step(100);
  check('s\'éloigner annule (mg_end ok=false, raison eloigne)', ends().length === 1 && !ends()[0].ok && ends()[0].sid === sidA && dones[0]?.reason === 'eloigne' && mg.activeOf(p1) === null);
  reset();
  const sidB = mg.startMinigame(p1, 'tournevis', 'touche', 0.3)!;
  step(100);
  check('rester en place ne l\'annule pas', ends().length === 0 && mg.activeOf(p1)?.sid === sidB);
  sim.damagePlayer(p1, 15, null, 'test');
  step(50);
  check('être touché annule', ends().length === 1 && !ends()[0].ok && dones[0]?.reason === 'touche');
  reset();
  mg.startMinigame(p1, 'tournevis', 'mort', 0.3);
  sim.damagePlayer(p1, 999, null, 'test');
  step(50);
  check('mourir annule', ends().length === 1 && !ends()[0].ok && (dones[0]?.reason === 'mort'), dones[0]?.reason);
  step(6000); // respawn
  reset();
  const sidC = mg.startMinigame(p2, 'brise_glace', 'exp', 0.3)!;
  step(RULES.brise_glace.maxMs + 2000);
  check('session expirée (ttl) : fin automatique en échec', ends('p2').some((e) => e.sid === sidC && !e.ok) && mg.activeOf(p2) === null);
  reset();
  mg.startMinigame(p2, 'brise_glace', 'depart', 0.3);
  mg.onLeave!(p2);
  check('départ du joueur : session libérée sans message', mg.activeOf(p2) === null && ends('p2').length === 0 && dones[0]?.reason === 'depart');
  reset();
  const r = mg.cancel(p1);
  check('cancel sans session retourne false', r === false && out.length === 0);

  // ---- 6. API pour les autres systèmes : callback et debug ----
  reset();
  let cb: MinigameDone | null = null;
  const sidD = mg.startMinigame(p1, 'liasses', 'vol:42', 0.5, (e) => { cb = e; }, 5)!;
  const h = honest('liasses', 5, 0.5);
  step(h.ms);
  send('p1', { sid: sidD, ok: true, ms: h.ms, data: h.data });
  check('onDone reçoit tag, ok, durée', cb !== null && (cb as MinigameDone).tag === 'vol:42' && (cb as MinigameDone).ok && (cb as MinigameDone).ms === h.ms);
  reset();
  bus.emit('debug', { p: p1, what: 'mg', arg: 'digicode' });
  check('/debug mg <kind> démarre le jeu demandé', starts().length === 1 && starts()[0].kind === 'digicode');
  mg.cancel(p1);

  // ---- 7. nouveaux jeux : bornes et anti-triche ----
  {
    const ok = (k: MinigameKind, seed: number, d: number, data: number[], ms: number) => RULES[k].validate(seed, d, { sid: 1, ok: true, ms, data });
    const ds = dosageSpec(21, 0.5);
    check('dosage : niveaux sur la ligne acceptés', ok('dosage', 21, 0.5, ds.targets, 2600));
    check('dosage : débordement refusé', !ok('dosage', 21, 0.5, [1.2, ds.targets[1], ds.targets[2]], 3000));
    check('dosage : loin de la ligne refusé', !ok('dosage', 21, 0.5, [ds.targets[0] + 0.3, ds.targets[1], ds.targets[2]], 3000));
    check('dosage : remplissage plus rapide que la pompe refusé', !ok('dosage', 21, 0.5, ds.targets, 1000));
    check('dosage : mauvais nombre de bouteilles refusé', !ok('dosage', 21, 0.5, ds.targets.slice(0, 2), 2600));
    const fs = fouilleSpec(8);
    check('fouille : bon tas + 3 balayages acceptés', ok('fouille', 8, 0, [fs.slot, 3], 1500));
    check('fouille : mauvais tas refusé', !ok('fouille', 8, 0, [(fs.slot + 1) % 5, 3], 1500));
    check('fouille : balayages insuffisants refusés', !ok('fouille', 8, 0, [fs.slot, 1], 1500));
    const bs = briseGlaceSpec(8, 1);
    check('brise_glace : 5 à 6 coups (difficulté max = 6)', briseGlaceSpec(1, 0).hits === 5 && bs.hits === 6);
    check('brise_glace : assez de coups acceptés', ok('brise_glace', 8, 1, [bs.hits], 1000));
    check('brise_glace : trop peu de coups refusé', !ok('brise_glace', 8, 1, [bs.hits - 1], 1000));
    check('brise_glace : cadence impossible refusée', !ok('brise_glace', 8, 1, [bs.hits], 100) && !ok('brise_glace', 8, 1, [200], 700));
    const ls = liassesSpec(5);
    check('liasses : cible exacte acceptée', ok('liasses', 5, 0, [ls.target], 1500));
    check('liasses : une de trop tolérée', ok('liasses', 5, 0, [ls.target + 1], 1500));
    check('liasses : deux de trop refusées', !ok('liasses', 5, 0, [ls.target + 2], 1500));
    check('liasses : trop peu ou non entier refusé', !ok('liasses', 5, 0, [ls.target - 1], 1500) && !ok('liasses', 5, 0, [ls.target + 0.5], 1500));
    check('desamorcage : réponse avant la fin du flash refusée', !RULES.desamorcage.validate(3, 0, { sid: 1, ok: true, ms: 300, data: [desamorcageSpec(3).wire] }));
    check('NaN dans data refusés partout', MINIGAME_KINDS.every((k) => !RULES[k].validate(5, 0.5, { sid: 1, ok: true, ms: 3000, data: [NaN, NaN, NaN] })));
  }

  // ---- 8. vol de voiture ----
  {
    const theft = createTheft(ctx);
    systems.set('theft', theft);
    const unlocked: number[] = [];
    systems.set('traffic', { id: 'traffic', unlock: (v: { id: number }) => { unlocked.push(v.id); } } as unknown as GameSystem);
    sim.hooks.onInteract = (p) => !!(mg.onInteract?.(p) || theft.onInteract?.(p));
    sim.hooks.canEnter = (p, v) => mg.canEnter?.(p, v);
    sim.hooks.onEnter = (p, v) => bus.emit('enteredVehicle', { p, v });
    const crimes: { kind: string; by: string }[] = [];
    bus.on('crime', (c) => crimes.push({ kind: c.kind, by: c.by.id }));
    const stepAll = (ms: number) => { for (let i = 0; i < Math.ceil(ms / (1000 / 60)); i++) { sim.step(); mg.postStep?.(); theft.postStep?.(); } };
    if (sim.isDead(p1)) sim.respawnPlayer(p1);
    p1.hp = 100;
    p2.hp = 100;
    sim.teleportPlayer(p1, 200, 1, 200);
    sim.teleportPlayer(p2, -200, 1, -200);
    const car = sim.acquireVehicle('citadine', 203, 200, 0, { locked: true });
    const car2 = sim.acquireVehicle('berline', -197, -200, 0, { locked: true });
    check('véhicules verrouillés créés pour le test', !!car && !!car2 && car.locked && car2.locked);
    if (!car || !car2) { console.log('abandon : pool vide'); process.exit(1); }
    stepAll(500);
    reset();
    check('profil : ancienne = tournevis, moderne = court_circuit', profileOf('citadine').kind === 'tournevis' && profileOf('berline').kind === 'court_circuit' && profileOf('inconnu').kind === 'court_circuit');

    sim.teleportPlayer(p1, 230, 1, 200);
    sim.interact('p1');
    check('vol hors de portée refusé', starts().length === 0 && car.locked && p1.vehicle === null);
    sim.teleportPlayer(p1, 200, 1, 200);
    stepAll(200);

    sim.interact('p1');
    const s1 = starts();
    check('E près d\'un véhicule verrouillé : mini-jeu du type (tournevis)', s1.length === 1 && s1[0].kind === 'tournevis' && mg.activeOf(p1)?.tag === `vol:${car.id}`);
    check('véhicule resté verrouillé pendant le jeu', car.locked && p1.vehicle === null);
    sim.interact('p1');
    check('double vol refusé (même joueur)', starts().length === 1);
    sim.teleportPlayer(p2, 201, 1, 201);
    sim.interact('p2');
    check('double vol refusé (autre joueur, même véhicule)', starts('p2').length === 0 && mg.activeOf(p2) === null);
    sim.teleportPlayer(p2, -200, 1, -200);
    const h1 = honest('tournevis', s1[0].seed, s1[0].difficulty);
    stepAll(h1.ms);
    send('p1', { sid: s1[0].sid, ok: true, ms: h1.ms, data: h1.data });
    check('vol réussi : déverrouillé, au volant, traffic.unlock appelé', !car.locked && p1.vehicle === car && car.driver === p1 && unlocked.includes(car.id));
    check('vol réussi : crime vol_vehicule émis', crimes.some((c) => c.kind === 'vol_vehicule' && c.by === 'p1'));
    check('vol réussi : session propre', mg.activeOf(p1) === null && theft.stealing!(p1) === null && dones.at(-1)?.ok === true);

    reset();
    sim.interact('p1');
    check('E au volant descend, aucun mini-jeu', p1.vehicle === null && starts().length === 0);
    sim.interact('p1');
    check('véhicule désormais ouvert : E monte sans mini-jeu', starts().length === 0 && p1.vehicle === car);
    sim.interact('p1');

    reset();
    const unlockedBefore = unlocked.length;
    sim.interact('p2');
    const s2 = starts('p2');
    check('berline : court_circuit', s2.length === 1 && s2[0].kind === 'court_circuit');
    stepAll(1500);
    send('p2', { sid: s2[0].sid, ok: false, ms: 1500 });
    check('vol échoué : reste verrouillé, à pied, aucun crime', car2.locked && p2.vehicle === null && !crimes.some((c) => c.by === 'p2') && unlocked.length === unlockedBefore);
    let honks = 0;
    const origFx = sim.fx.bind(sim);
    sim.fx = (ev) => { if (ev.s === 'horn_5') honks++; origFx(ev); };
    stepAll(1500);
    sim.fx = origFx;
    check('vol échoué : alarme (klaxon répété via fx)', honks >= 2, `${honks} klaxons`);

    reset();
    sim.interact('p2');
    check('nouvel essai possible après un échec', starts('p2').length === 1);
    sim.teleportPlayer(p2, -200 + RULES.court_circuit.cancelDist + 6, 1, 400);
    stepAll(100);
    check('s\'éloigner annule le vol (véhicule verrouillé)', mg.activeOf(p2) === null && car2.locked && p2.vehicle === null);
    sim.teleportPlayer(p2, -200, 1, -200);
    stepAll(100);
    reset();
    mg.startMinigame(p2, 'digicode', 'autre', 0.2);
    sim.interact('p2');
    check('vol impossible pendant un autre mini-jeu', starts('p2').length === 1 && starts('p2')[0].kind === 'digicode');
    mg.cancel(p2);

    reset();
    sim.interact('p2');
    const s3 = starts('p2')[0];
    sim.releaseVehicle(car2);
    const h3 = honest(s3.kind, s3.seed, s3.difficulty);
    stepAll(h3.ms);
    send('p2', { sid: s3.sid, ok: true, ms: h3.ms, data: h3.data });
    check('véhicule rangé pendant le vol : pas d\'entrée, pas de plantage', p2.vehicle === null && !sim.broken);
    reset();
    sim.interact('p2');
    check('véhicule rangé : plus de vol possible', starts('p2').length === 0);
    check('theft : serialize sans état', JSON.stringify(theft.serialize!()) === '{"v":1}');
  }

  check('aucune erreur de simulation', errors.length === 0 && !sim.broken, errors.slice(0, 2).join(' | '));
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUT VERT');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
