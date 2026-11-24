// PROPRIÉTAIRE : game-minigames
// Suite « minijeux » : npx tsx tests/minijeux.ts
// Système serveur testé sur un vrai Sim (temps de simulation = 60 pas/s), sans réseau ni port : le contexte de jeu est reconstitué à la main.
// Couvre : résultat trop rapide refusé, sid inconnu/rejoué/d'un autre joueur ignoré, annulation (éloignement, touché, mort), TEMPS ILLIMITÉ (une partie
// de 9 s ou de plus d'une minute est valide ; seul le garde-fou de 10 min clôt une session fantôme), ABANDON sans punition (ni alarme de vol),
// un seul mini-jeu actif par joueur, validations déterministes par graine pour les 8 jeux, parseGameMsg, serialize sans session, consignes (help.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sim } from '../shared/sim';
import { GameBus, parseGameMsg, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import { MINIGAME_KINDS, type MinigameKind } from '../shared/ids';
import {
  ABANDON_MARK, DIGI_COLS, DOSAGE_CLIENT_RATE, DOSAGE_FILL_RATE, MS_CAP, RULES, SESSION_GUARD_MS, briseGlaceSpec, courtCircuitSpec, desamorcageSpec, digicodePos, digicodeSpec, dosageSpec, fouilleSpec, liassesSpec, rng, tournevisSpec,
} from '../shared/minigames/rules';
import type { GameServerEvent, MinigameResult } from '../shared/protocol';
import { helpFor, dejaVu, marquerVu } from '../src/minigames/help';
import { createMinigames, type MinigameDone, type MinigamesSystem } from '../server/systems/minigames';
import { THEFT_PROFILE, createTheft, profileOf } from '../server/systems/theft';

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
    case 'fouille': { const s = fouilleSpec(seed, d); return { data: [s.slot, s.swipes], ms: 1000 }; }
    case 'brise_glace': return { data: [briseGlaceSpec(seed, d).hits], ms: 900 };
    case 'desamorcage': return { data: [desamorcageSpec(seed, d).wire], ms: 1000 };
    case 'liasses': return { data: [liassesSpec(seed, d).target], ms: 1100 };
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
  check('mg_start n\'annonce plus de durée de jeu : seulement le garde-fou (10 min)', starts()[0].maxMs === SESSION_GUARD_MS && !('maxMs' in RULES.desamorcage));
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
    check('aucune durée maximale dans les règles, minMs plausible conservé', MINIGAME_KINDS.every((k) => !('maxMs' in RULES[k]) && RULES[k].minMs >= 600 && RULES[k].minMs <= 2000));
    check('digicode : une partie de plus d\'une minute reste valide (ms plafonné à MS_CAP)', (() => {
      const s = digicodeSpec(31, 0.4);
      const stops: number[] = [];
      let t = 70_000;
      for (let i = 0; i < DIGI_COLS; i++) {
        while (Math.abs(digicodePos(s.cols[i], t) - s.cols[i].center) > s.cols[i].half * 0.5) t += 5;
        stops.push(t);
        t += 150;
      }
      return RULES.digicode.validate(31, 0.4, { sid: 1, ok: true, ms: MS_CAP, data: stops }) && !RULES.digicode.validate(31, 0.4, { sid: 1, ok: true, ms: 5000, data: stops });
    })());
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
  mg.cancel(p2); // la session « fouille » du début de test n'expire plus toute seule (temps illimité)
  reset();
  const sidC = mg.startMinigame(p2, 'brise_glace', 'exp', 0.3, undefined, 4242)!;
  step(9000);
  check('temps illimité : encore ouverte après 9 s (plus d\'expiration à 4,5 s)', ends('p2').length === 0 && mg.activeOf(p2)?.sid === sidC);
  send('p2', { sid: sidC, ok: true, ms: 8900, data: honest('brise_glace', 4242, 0.3).data });
  check('temps illimité : une réussite après 9 s est acceptée', ends('p2').length === 1 && ends('p2')[0].ok && dones[0]?.reason === 'ok');
  reset();
  const sidG = mg.startMinigame(p2, 'dosage', 'fantome', 0.3)!;
  step(SESSION_GUARD_MS - 5000);
  check('garde-fou : toujours ouverte juste avant 10 min', mg.activeOf(p2)?.sid === sidG);
  step(8000);
  check('garde-fou : session fantôme close après 10 min (reason expire), plus aucune session', ends('p2').some((e) => e.sid === sidG && !e.ok) && dones.at(-1)?.reason === 'expire' && mg.activeOf(p2) === null);
  reset();
  const sidAb = mg.startMinigame(p2, 'liasses', 'abandon', 0.3)!;
  step(700);
  send('p2', { sid: sidAb, ok: false, ms: 600, data: [ABANDON_MARK] });
  check('abandon : mg_end ok=false, raison abandon, session libérée', ends('p2').length === 1 && !ends('p2')[0].ok && dones[0]?.reason === 'abandon' && mg.activeOf(p2) === null);
  reset();
  const sidAb2 = mg.startMinigame(p2, 'liasses', 'abandon2', 0.3)!;
  send('p2', { sid: sidAb2, ok: false, ms: 0, data: [ABANDON_MARK] });
  check('abandon pendant la consigne (ms = 0) : accepté', dones[0]?.reason === 'abandon' && mg.activeOf(p2) === null);
  reset();
  const sidFl = mg.startMinigame(p2, 'liasses', 'echec', 0.3)!;
  send('p2', { sid: sidFl, ok: false, ms: 800 });
  check('ok=false sans marque d\'abandon : raison echec (distincte)', dones[0]?.reason === 'echec');
  const sidAb3 = mg.startMinigame(p2, 'dosage', 'abandon3', 0.3)!;
  send('p2', { sid: sidAb3, ok: false, ms: 100, data: [3] });
  check('data d\'abandon falsifiée : pas un abandon', dones.at(-1)?.reason === 'echec');
  reset();
  void DOSAGE_FILL_RATE;
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
    check('vol échoué (échec réel) : reste verrouillé, à pied, aucun crime', car2.locked && p2.vehicle === null && !crimes.some((c) => c.by === 'p2') && unlocked.length === unlockedBefore);
    let honks = 0;
    const origFx = sim.fx.bind(sim);
    sim.fx = (ev) => { if (ev.s === 'horn_5') honks++; origFx(ev); };
    stepAll(1500);
    sim.fx = origFx;
    check('vol échoué : alarme (klaxon répété via fx)', honks >= 2, `${honks} klaxons`);

    // abandon d'un vol : aucune alarme, nouvel essai possible aussitôt
    reset();
    sim.interact('p2');
    const sAb = starts('p2')[0];
    stepAll(500);
    honks = 0;
    sim.fx = (ev) => { if (ev.s === 'horn_5') honks++; origFx(ev); };
    send('p2', { sid: sAb.sid, ok: false, ms: 400, data: [ABANDON_MARK] });
    stepAll(3000);
    sim.fx = origFx;
    check('abandon d\'un vol : pas d\'alarme, véhicule verrouillé, à pied, aucun crime', honks === 0 && car2.locked && p2.vehicle === null && mg.activeOf(p2) === null && dones.at(-1)?.reason === 'abandon' && !crimes.some((c) => c.by === 'p2'), `${honks} klaxons`);

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

  // ---- 9. robustesse : boucle, mort/arrestation, deux joueurs, déconnexion, résultats tardifs ----
  {
    const stepAll = (ms: number) => { for (let i = 0; i < Math.ceil(ms / (1000 / 60)); i++) { sim.step(); mg.postStep?.(); } };
    if (p1.vehicle) sim.interact('p1');
    if (p2.vehicle) sim.interact('p2');
    if (sim.isDead(p1)) sim.respawnPlayer(p1);
    if (sim.isDead(p2)) sim.respawnPlayer(p2);
    sim.teleportPlayer(p1, -100, 1, 100);
    sim.teleportPlayer(p2, 100, 1, -100);
    p1.hp = 100;
    p2.hp = 100;
    stepAll(300);
    mg.cancel(p1);
    mg.cancel(p2);

    // 9a. relancé en boucle : démarrer / annuler / mal répondre 400 fois, rien ne fuit
    reset();
    let lastSid = 0;
    let monotone = true;
    let started = 0;
    for (let i = 0; i < 400; i++) {
      const kind = MINIGAME_KINDS[i % MINIGAME_KINDS.length];
      const sid = mg.startMinigame(p1, kind, `boucle:${i}`, (i % 11) / 10, undefined, i);
      if (sid === null) continue;
      started++;
      if (sid <= lastSid) monotone = false;
      lastSid = sid;
      if (mg.startMinigame(p1, kind, 'doublon', 0.5) !== null) monotone = false; // jamais deux sessions pour un joueur
      if (i % 3 === 0) mg.cancel(p1, 'boucle');
      else if (i % 3 === 1) send('p1', { sid, ok: true, ms: 5, data: [1, 2, 3] }); // trop rapide
      else { send('p1', { sid, ok: false, ms: 5 }); send('p1', { sid, ok: true, ms: 900, data: [1] }); } // échec puis rejeu ignoré
      if (i % 50 === 0) stepAll(20);
    }
    check('boucle de 400 sessions : toutes démarrées, sid croissants, jamais deux sessions', started === 400 && monotone && mg.activeOf(p1) === null);
    check('boucle : une fin par session, aucune réussite par accident', dones.length === 400 && dones.every((d) => !d.ok) && doneBus.length === 400);
    check('boucle : aucune fuite de session après coup', mg.activeOf(p1) === null && !sim.broken);
    reset();

    // 9b. joueur mort : aucun démarrage ; arrêté : la session en cours est annulée, la suivante peut démarrer
    sim.damagePlayer(p1, 999, null, 'test');
    stepAll(50);
    check('mini-jeu refusé pendant la mort', mg.startMinigame(p1, 'tournevis', 'mort', 0.3) === null && starts().length === 0);
    send('p1', { sid: lastSid, ok: true, ms: 2000, data: [3, 500] });
    check('résultat envoyé par un joueur mort : ignoré', out.length === 0);
    stepAll(6000); // réapparition
    p1.hp = 100;
    sim.teleportPlayer(p1, -100, 1, 100);
    stepAll(100);
    const sidBust = mg.startMinigame(p1, 'digicode', 'arret', 0.3)!;
    check('après réapparition le mini-jeu redémarre', typeof sidBust === 'number');
    reset();
    bus.emit('playerBusted', { p: p1 });
    check('arrestation : session annulée (mg_end ok=false, raison arrete)', ends().length === 1 && !ends()[0].ok && dones[0]?.reason === 'arrete' && mg.activeOf(p1) === null);
    const sidAfter = mg.startMinigame(p1, 'liasses', 'apres_arret', 0.3);
    check('démarrage possible juste après l\'arrestation (joueur vivant)', typeof sidAfter === 'number');
    const hereB = sim.playerPos(p1);
    sim.teleportPlayer(p1, hereB[0] + 150, 1, hereB[2]); // retour au commissariat : loin de la scène
    stepAll(60);
    check('transporté au commissariat pendant le jeu : annulé (eloigne)', mg.activeOf(p1) === null && dones.at(-1)?.reason === 'eloigne');
    sim.teleportPlayer(p1, -100, 1, 100);
    stepAll(60);
    reset();

    // 9c. deux joueurs en même temps : résultats indépendants
    {
      const a = mg.startMinigame(p1, 'brise_glace', 'duo', 0.3, undefined, 31)!;
      const b = mg.startMinigame(p2, 'desamorcage', 'duo', 0.3, undefined, 32)!;
      check('deux sessions simultanées, sid distincts', a !== b && mg.activeOf(p1)?.sid === a && mg.activeOf(p2)?.sid === b);
      reset();
      const ha = honest('brise_glace', 31, 0.3);
      stepAll(ha.ms);
      send('p2', { sid: a, ok: true, ms: ha.ms, data: ha.data }); // le sid de l'autre : ignoré
      check('le sid d\'un autre joueur ne clôt rien', mg.activeOf(p1)?.sid === a && mg.activeOf(p2)?.sid === b && out.length === 0);
      send('p1', { sid: a, ok: true, ms: ha.ms, data: ha.data });
      check('p1 réussit pendant que p2 joue encore', ends('p1').length === 1 && ends('p1')[0].ok && ends('p2').length === 0 && mg.activeOf(p2)?.sid === b);
      sim.damagePlayer(p2, 10, null, 'test');
      stepAll(50);
      check('p2 touché : annulé sans toucher p1', ends('p2').length === 1 && !ends('p2')[0].ok && ends('p1').length === 1 && dones.some((d) => d.p === p2 && d.reason === 'touche'));
      p2.hp = 100;
      reset();
    }

    // 9d. déconnexion pendant un jeu
    {
      let cb2: MinigameDone | null = null;
      const sid = mg.startMinigame(p2, 'fouille', 'depart', 0.2, (e) => { cb2 = e; }, 9)!;
      mg.onLeave!(p2);
      check('déconnexion : session close, onDone « depart » une seule fois', mg.activeOf(p2) === null && dones.length === 1 && dones[0].reason === 'depart' && ends('p2').length === 0 && cb2 !== null);
      const hf = honest('fouille', 9, 0.2);
      reset();
      send('p2', { sid, ok: true, ms: hf.ms, data: hf.data }); // résultat arrivé après la déconnexion
      check('résultat reçu après la déconnexion : ignoré', out.length === 0 && dones.length === 0);
      // joueur supprimé sans passer par onLeave : la session est close en silence au tick suivant
      sim.addPlayer('p3', 'Carl');
      const p3 = sim.players.get('p3')!;
      let called = 0;
      mg.startMinigame(p3, 'digicode', 'fantome', 0.2, () => { called++; });
      sim.removePlayer('p3');
      stepAll(100);
      check('joueur supprimé sans onLeave : session close en silence, onDone une fois', called === 1 && mg.activeOf(p3) === null && ends('p3').length === 0 && !sim.broken);
      // même identifiant, nouveau joueur (reconnexion) : l'ancien sid n'est pas rejoué
      sim.addPlayer('p3', 'Carl');
      const p3b = sim.players.get('p3')!;
      const sidB = mg.startMinigame(p3b, 'brise_glace', 'retour', 0.2, undefined, 77)!;
      reset();
      send('p3', { sid: sidB - 1, ok: true, ms: 900, data: [5] });
      check('reconnexion : ancien sid ignoré, nouvelle session intacte', out.length === 0 && mg.activeOf(p3b)?.sid === sidB);
      mg.cancel(p3b);
      sim.removePlayer('p3');
      stepAll(30);
      reset();
    }

    // 9e. résultats tardifs
    {
      const seedL = 4242;
      const sidL = mg.startMinigame(p1, 'brise_glace', 'tard', 0.2, undefined, seedL)!;
      stepAll(30_000); // une partie très lente : aucune limite de durée
      const hl = honest('brise_glace', seedL, 0.2);
      send('p1', { sid: sidL, ok: true, ms: 29_900, data: hl.data });
      check('résultat après 30 s accepté (temps illimité)', ends().length === 1 && ends()[0].ok && dones[0]?.reason === 'ok', dones[0]?.reason);
      reset();
      const sidE = mg.startMinigame(p1, 'brise_glace', 'expire', 0.2, undefined, seedL)!;
      stepAll(SESSION_GUARD_MS + 500);
      check('session fantôme close toute seule par le garde-fou (reason expire)', ends().length === 1 && !ends()[0].ok && dones[0]?.reason === 'expire' && mg.activeOf(p1) === null);
      reset();
      send('p1', { sid: sidE, ok: true, ms: 900, data: hl.data });
      check('résultat reçu après l\'expiration : ignoré, aucun événement', out.length === 0 && dones.length === 0);
      check('nouvelle session aussitôt après une expiration', typeof mg.startMinigame(p1, 'digicode', 'suite', 0.2) === 'number');
      mg.cancel(p1);
      reset();
    }

    // 9f. difficulté 0..1 effective dans chaque jeu (spec monotone et plausible)
    {
      const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 3);
      check('tournevis : 3 tours en facile, 5 en difficile', tournevisSpec(1, 0).turns === 3 && tournevisSpec(1, 1).turns === 5);
      check('digicode : zone plus étroite et colonnes plus rapides avec la difficulté', digicodeSpec(5, 1).cols[0].half < digicodeSpec(5, 0).cols[0].half && digicodeSpec(5, 1).cols[0].speed > digicodeSpec(5, 0).cols[0].speed);
      check('dosage : tolérance plus faible avec la difficulté', dosageSpec(5, 1).tol < dosageSpec(5, 0).tol && dosageSpec(5, 1).tol > 0.03);
      check('brise_glace : 5 coups en facile, 6 en difficile', briseGlaceSpec(5, 0).hits === 5 && briseGlaceSpec(5, 1).hits === 6);
      check('court_circuit : zone et contact plus étroits, jauge qui retombe plus vite', courtCircuitSpec(5, 1).zoneR < courtCircuitSpec(5, 0).zoneR && courtCircuitSpec(5, 1).contact < courtCircuitSpec(5, 0).contact && courtCircuitSpec(5, 1).decay > courtCircuitSpec(5, 0).decay);
      check('fouille : 3 balayages en facile, 4 en difficile', fouilleSpec(5, 0).swipes === 3 && fouilleSpec(5, 1).swipes === 4);
      check('desamorcage : flash plus court avec la difficulté (jamais sous 300 ms)', desamorcageSpec(5, 1).flashMs < desamorcageSpec(5, 0).flashMs && desamorcageSpec(5, 1).flashMs >= 300);
      check('liasses : cible 3..5, tolérance 1 puis 0', seeds.every((s) => { const a = liassesSpec(s, 0).target; const b = liassesSpec(s, 1).target; return a >= 3 && a <= 4 && b >= 4 && b <= 5; }) && liassesSpec(1, 0).maxOver === 1 && liassesSpec(1, 1).maxOver === 0);
      // le client ne remplit jamais plus vite que la pompe autorisée par le serveur ; les cibles restent atteignables
      check('dosage : cadence du client sous la limite serveur', DOSAGE_CLIENT_RATE <= DOSAGE_FILL_RATE && seeds.every((s) => dosageSpec(s, 1).targets.every((x) => x > 0.5 && x < 0.95)));
      // la difficulté est bien lue par validate (sinon un client facile gagnerait en difficile)
      check('validate lit la difficulté : fouille difficile exige 4 balayages', !RULES.fouille.validate(8, 1, { sid: 1, ok: true, ms: 1500, data: [fouilleSpec(8).slot, 3] }) && RULES.fouille.validate(8, 1, { sid: 1, ok: true, ms: 1500, data: [fouilleSpec(8).slot, 4] }));
      check('validate lit la difficulté : liasses difficile refuse une liasse de trop', !RULES.liasses.validate(5, 1, { sid: 1, ok: true, ms: 1500, data: [liassesSpec(5, 1).target + 1] }) && RULES.liasses.validate(5, 0, { sid: 1, ok: true, ms: 1500, data: [liassesSpec(5, 0).target + 1] }));
      check('theft : chaque profil utilise un mini-jeu de vol et une difficulté 0..1', Object.values(THEFT_PROFILE).every((pr) => (pr.kind === 'tournevis' || pr.kind === 'court_circuit') && pr.difficulty >= 0 && pr.difficulty <= 1));
    }

    // 9f2. consignes (help.ts) : une par jeu, en français, courtes ; « déjà vu » sans localStorage ne plante pas
    {
      let okAll = true;
      let detail = '';
      for (const kind of MINIGAME_KINDS) {
        for (const d of [0, 1]) {
          const h = helpFor({ sid: 1, kind, seed: 17, difficulty: d, maxMs: SESSION_GUARD_MS });
          const good = h.title.length >= 4 && h.steps.length >= 3 && h.steps.length <= 4 && h.steps.every((x) => x.length >= 20 && x.length <= 150 && /[.!?]$/.test(x)) && h.short.length >= 30 && h.short.length <= 160;
          if (!good) { okAll = false; detail += `${kind} `; }
        }
      }
      check('consignes : titre, 3-4 étapes d\'une phrase et rappel court pour chacun des 8 jeux', okAll, detail);
      check('consignes : le sens du verrou et le nombre de tours sont donnés (tournevis)', (() => {
        const a = helpFor({ sid: 1, kind: 'tournevis', seed: 2, difficulty: 0, maxMs: 1 }).steps.join(' ');
        const b = helpFor({ sid: 1, kind: 'tournevis', seed: 3, difficulty: 1, maxMs: 1 }).steps.join(' ');
        return /aiguilles/.test(a) && /aiguilles/.test(b) && a.includes('sens inverse') !== b.includes('sens inverse') && a.includes('3 tours') && b.includes('5 tours');
      })());
      check('consignes : « déjà vu » sûr sans localStorage (try/catch)', dejaVu('digicode') === false && (() => { marquerVu('digicode'); return true; })());
    }

    // 9g. contrôles statiques du client (aucune exécution de navigateur ici) : sons distincts, pas de HTML injecté, pas de tactile, écouteurs appariés
    {
      const dir = join(process.cwd(), 'src', 'minigames');
      const read = (f: string) => readFileSync(join(dir, f), 'utf8');
      const names = (src: string) => new Set([...src.matchAll(/env\.sfx\('([a-z_]+)'/g)].map((m) => m[1]));
      const per = new Map<string, Set<string>>(MINIGAME_KINDS.map((k) => [k, names(read(`${k}.ts`))]));
      const registered = new Set([...read('sounds.ts').matchAll(/registerSound\('([a-z_]+)'/g)].map((m) => m[1]));
      const used = new Set<string>();
      per.forEach((s) => s.forEach((n) => used.add(n)));
      check('tous les sons utilisés par les jeux sont enregistrés', [...used].every((n) => registered.has(n)), [...used].filter((n) => !registered.has(n)).join(','));
      const signature = MINIGAME_KINDS.map((k) => {
        const others = new Set<string>();
        per.forEach((s, o) => { if (o !== k) s.forEach((n) => others.add(n)); });
        return [k, [...per.get(k)!].filter((n) => !others.has(n))] as const;
      });
      check('chaque jeu a au moins un son bien à lui', signature.every(([, own]) => own.length >= 1), signature.filter(([, o]) => !o.length).map(([k]) => k).join(','));
      const all = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => read(f)).join('\n');
      check('aucun innerHTML / insertAdjacentHTML / eval dans les mini-jeux', !/innerHTML|insertAdjacentHTML|outerHTML|\beval\(|new Function/.test(all));
      check('aucun mini-jeu ne se termine par un échec définitif (retour « recommence ») ni ne lit maxMs', MINIGAME_KINDS.every((k) => !/finish\(false/.test(read(`${k}.ts`)) && !/maxMs/.test(read(`${k}.ts`))) && !/\.maxMs/.test(read('index.ts')));
      check('bouton « Abandonner (Échap) », bouton « Compris, c\'est parti » et ligne d\'aide présents, indice dans chaque jeu', /Abandonner \(Échap\)/.test(read('index.ts')) && /Compris, c'est parti/.test(read('index.ts')) && /drawStrip/.test(read('index.ts')) && MINIGAME_KINDS.every((k) => /hint/.test(read(`${k}.ts`))));
      check('aucune entrée tactile dans les mini-jeux (souris et clavier seulement)', !/touchstart|touchmove|touchend|pointerdown|pointermove|TouchEvent/.test(all));
      const idx = read('index.ts');
      const adds = [...idx.matchAll(/addEventListener\('([a-z]+)'/g)].map((m) => m[1]).sort();
      const rems = [...idx.matchAll(/removeEventListener\('([a-z]+)'/g)].map((m) => m[1]).sort();
      check('index.ts : chaque addEventListener a son removeEventListener', JSON.stringify(adds) === JSON.stringify(rems), `${adds.join(',')} / ${rems.join(',')}`);
    }
  }

  check('aucune erreur de simulation', errors.length === 0 && !sim.broken, errors.slice(0, 2).join(' | '));
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUT VERT');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
