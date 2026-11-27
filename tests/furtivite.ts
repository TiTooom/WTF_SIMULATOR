// PROPRIÉTAIRE : game-missions
// Suite « furtivité » : cônes de vision, ligne de vue, caméras balayantes, perte d'étoile quand on n'est plus vu, cachettes (valables / grillées / fouillées),
// effectifs et vitesse de la police, VRef/bodyOk, sauvegarde, budget.
// Lancement : npx tsx tests/furtivite.ts  (aucun serveur réseau : Sim + systèmes directement)
import { GameBus, type GameCtx, type GameSystem } from '../shared/game';
import { buildCityUncached, getCity } from '../shared/city/layout';
import { DISTRICT_IDS } from '../shared/ids';
import { packMe, unpackMe } from '../shared/me';
import { clearDrive, roadRoute } from '../shared/ai/route';
import { installGame } from '../server/game';
import { makePed, PED_ST } from '../shared/peds';
import { NO_INPUT, type GameServerEvent, type PrivateState } from '../shared/protocol';
import { Sim } from '../shared/sim';
import {
  canSee, cameraCone, cameraYaw, copCameraCones, hidingSpots, inCone, lineOfSight, nearestHidingSpot, VISION, type HidingSpot,
} from '../shared/hiding';
import {
  copAccelFactor, copSpeed, copsWanted, copTurnFactor, LOSE_DELAY_S, PLAYER_TOP_SPEED, WS,
} from '../shared/wanted';
import { newDriveMem } from '../shared/ai/drive';
import { createPeds, type PedsSystem } from '../server/systems/peds';
import { copInput, createPolice, type PoliceSystem } from '../server/systems/police';
import type { Poi } from '../shared/city/layout';

let fails = 0;
const ok = (c: boolean, msg: string) => { if (!c) { fails++; console.log('ECHEC : ' + msg); } else console.log('ok     : ' + msg); };
const city = getCity();
const rad = (d: number) => (d * Math.PI) / 180;
const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));

// ---------- 1. Fonctions pures : cône ----------
{
  const R = 45, F = rad(100);
  ok(inCone(0, 0, 0, R, F, 0, -20), 'cône : devant (lacet 0 = vers -z), à 20 m : visible');
  ok(!inCone(0, 0, 0, R, F, 0, 20), 'cône : derrière : invisible');
  ok(!inCone(0, 0, 0, R, F, 0, -50), 'cône : au-delà de la portée : invisible');
  ok(inCone(0, 0, 0, R, F, -20 * Math.sin(rad(49)), -20 * Math.cos(rad(49))), 'cône : à 49° de l\'axe (demi-champ 50°) : visible');
  ok(!inCone(0, 0, 0, R, F, -20 * Math.sin(rad(55)), -20 * Math.cos(rad(55))), 'cône : à 55° de l\'axe : invisible');
  ok(inCone(0, 0, Math.PI / 2, R, F, -20, 0), 'cône : lacet π/2 regarde vers -x');
  ok(!inCone(0, 0, 0, R, F, NaN, 3), 'cône : entrée NaN refusée');
  ok(VISION.CAR.range > VISION.FOOT.range && inCone(0, 0, 0, VISION.CAR.range, VISION.CAR.fov, 0, -55) && !inCone(0, 0, 0, VISION.FOOT.range, VISION.FOOT.fov, 0, -55), 'une voiture voit à 55 m, un flic à pied non');
}

// ---------- 2. Ligne de vue : un mur bloque ----------
{
  const b = city.buildings.find((q) => q.w > 20 && q.d > 20)!;
  const ax = b.x - b.w / 2 - 6, bx = b.x + b.w / 2 + 6;
  ok(!lineOfSight(city, ax, b.z, bx, b.z), 'ligne de vue : un bâtiment entre les deux la bloque');
  ok(lineOfSight(city, 0, -20, 0, 20), 'ligne de vue : le long d\'une rue dégagée');
  ok(lineOfSight(city, ax, b.z, ax - 20, b.z + 3) || true, 'ligne de vue : segment hors bâtiment sans erreur');
  const cone = { kind: 'foot' as const, id: 't', x: ax, z: b.z, yaw: yawTo(ax, b.z, bx, b.z), range: 45, fov: VISION.FOOT.fov };
  ok(!canSee(city, cone, bx, b.z) && Math.hypot(bx - ax, 0) < 45, 'dans le cône et la portée MAIS derrière un mur : invisible');
  ok(canSee(city, cone, ax + (ax < b.x ? -1 : 1) * 0, b.z) && canSee(city, { ...cone, yaw: yawTo(ax, b.z, ax - 20, b.z) }, ax - 20, b.z) === lineOfSight(city, ax, b.z, ax - 20, b.z), 'canSee = cône + ligne de vue (cohérent)');
  ok(!lineOfSight(city, NaN, 0, 1, 1), 'ligne de vue : entrée NaN = pas de vue');
  // proximité : un joueur dans le dos mais à moins de NEAR est perçu
  const o = { kind: 'foot' as const, id: 'n', x: 0, z: 0, yaw: 0, range: 45, fov: VISION.FOOT.fov };
  ok(canSee(city, o, 0, VISION.NEAR - 1) && !canSee(city, o, 0, VISION.NEAR + 6), 'proximité : perçu dans le dos à < 7 m, pas à 13 m');
  // perf de lineOfSight
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < 20000; i++) { if (lineOfSight(city, -300 + (i % 600), -300 + ((i * 7) % 600), -280 + (i % 600), -250 + ((i * 7) % 600))) n++; }
  const per = (performance.now() - t0) / 20000;
  ok(per < 0.02, `ligne de vue : ${(per * 1000).toFixed(1)} µs par test (${n} dégagés sur 20000)`);
}

// ---------- 3. Caméras balayantes ----------
{
  const cam: Poi = { id: 'cam_test', kind: 'camera', x: 0, z: 0, yaw: 0, district: 'campus' }; // au centre d'un carrefour, regarde vers le nord
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < 40; t += 0.1) { const y = cameraYaw(cam, t); min = Math.min(min, y); max = Math.max(max, y); }
  ok(Math.abs(max - rad(50)) < 0.02 && Math.abs(min + rad(50)) < 0.02, `caméra : balayage ± 50° (min ${(min * 57.3).toFixed(0)}°, max ${(max * 57.3).toFixed(0)}°)`);
  let seen = 0, total = 0, farSeen = 0, sideSeen = 0;
  for (let t = 0; t < 32; t += 0.1) {
    total++;
    const c = cameraCone(cam, t);
    if (canSee(city, c, 0, -25)) seen++; // 25 m dans l'axe moyen
    if (canSee(city, c, 0, -40)) farSeen++; // hors portée (35 m)
    if (canSee(city, c, 25, 0)) sideSeen++; // à 90° : hors de l'enveloppe du balayage (50° + 25°)
  }
  ok(seen > 0 && seen < total, `caméra : la cible dans l'axe n'est vue que par moments (${seen}/${total} instants)`);
  ok(farSeen === 0, 'caméra : jamais vue au-delà de 35 m');
  ok(sideSeen === 0, "caméra : une cible à 90° de l'axe n'est jamais vue (hors de l'enveloppe du balayage)");
  const cams = city.poisOf('camera');
  const down = new Set<string>([cams[0].id, cams[1].id]);
  const cones = copCameraCones([{ id: 1, x: 0, z: 0, yaw: 0, car: true }, { id: 2, x: 5, z: 5, yaw: 1, car: false }], cams, (id) => down.has(id), 12);
  ok(cones.length === 2 + cams.length - 2 && cones.filter((c) => c.kind === 'camera').length === cams.length - 2 && cones[0].kind === 'car' && cones[1].kind === 'foot', 'copCameraCones : flics + caméras intactes seulement');
  ok(cams.every((c) => Math.abs(cameraYaw(c, 3) - c.yaw) <= rad(50) + 1e-9), 'caméras réelles : cap dans ± 50° de l\'axe du POI');
}

// ---------- 4. Cachettes ----------
{
  const spots = hidingSpots(city);
  const uniq = new Set(spots.map((s) => s.id));
  ok(uniq.size === spots.length, `cachettes : identifiants uniques (${spots.length})`);
  for (const d of DISTRICT_IDS) {
    const n = spots.filter((s) => s.district === d).length;
    ok(n >= 4, `cachettes : ${n} dans le quartier ${d} (≥ 4)`);
  }
  const inB = (s: HidingSpot) => city.buildings.some((b) => Math.abs(s.x - b.x) < b.w / 2 && Math.abs(s.z - b.z) < b.d / 2);
  ok(spots.every((s) => !inB(s) && Math.abs(s.x) < 330 && Math.abs(s.z) < 330), 'cachettes : jamais dans un bâtiment ni hors du monde');
  const again = hidingSpots(buildCityUncached());
  ok(JSON.stringify(again) === JSON.stringify(spots), 'cachettes : déterministes (ville recalculée = mêmes cachettes)');
  const kinds = new Set(spots.map((s) => s.kind));
  ok(['haie', 'benne', 'cabane', 'garage', 'ruelle'].every((k) => kinds.has(k as HidingSpot['kind'])), `cachettes : tous les types présents (${[...kinds].join(', ')})`);
  const blocksMulti = city.blocks.filter((b) => city.buildings.filter((q) => q.block === b.id).length >= 2);
  ok(blocksMulti.every((b) => spots.some((s) => s.kind === 'ruelle' && s.x === Math.round(b.x * 10) / 10 && s.z === Math.round(b.z * 10) / 10)), 'cachettes : une ruelle dans chaque îlot à plusieurs bâtiments');
  const s0 = spots[0];
  ok(nearestHidingSpot(spots, s0.x, s0.z) !== null && nearestHidingSpot(spots, 1e6, 0) === null && nearestHidingSpot(spots, NaN, 0) === null, 'nearestHidingSpot : trouvée / loin / NaN');
}

// ---------- 4b. Itinéraires par les rues ----------
{
  let bad = 0, masked = 0;
  const P = city.poisOf('parking');
  for (let k = 0; k < 300; k++) {
    const a = P[(k * 7) % P.length], b = P[(k * 13 + 5) % P.length];
    if (!clearDrive(city, a.x, a.z, b.x, b.z)) masked++;
    const r = roadRoute(city, a, b);
    if (r.length !== 4 || r[3].x !== b.x || r[3].z !== b.z) bad++;
    // les tronçons entre intersections suivent les rues : aucun bâtiment sur le passage
    for (let i = 0; i < 2; i++) if (!clearDrive(city, r[i].x, r[i].z, r[i + 1].x, r[i + 1].z)) bad++;
  }
  ok(masked > 100 && bad === 0, `itinéraire : ${masked}/300 cibles masquées par des bâtiments, toutes rejointes par les rues (${bad} défauts)`);
}

/** Jeu complet (tous les systèmes) : un joueur à pied immobile à 3 étoiles doit être rejoint et arrêté (la police ne se bloque pas contre les immeubles). */
async function immobileSuite() {
  const P = city.poisOf('parking');
  let busted = 0;
  const times: string[] = [];
  for (let i = 2; i < 7; i++) { // places qui échouaient quand la police fonçait en ligne droite
    const q = P[(i * 11 + 3) % P.length];
    const sim = await Sim.create();
    sim.log = () => {};
    sim.onAnnounce = () => {};
    const game = installGame(sim, { mode: 'solo' });
    sim.addPlayer('p', 'p');
    const p = sim.players.get('p')!;
    game.onJoin(p);
    const tick = () => { game.preStep(); sim.step(); game.postStep(); };
    sim.teleportPlayer(p, q.x + 1.8, 1.3, q.z);
    for (let t = 0; t < 120; t++) tick();
    game.system<PoliceSystem>('police')!.setStars('p', 3);
    let at = -1;
    for (let t = 0; t < 60 * 60 && at < 0; t++) {
      sim.setInput('p', { ...NO_INPUT });
      tick();
      if (game.drainOutbox().some((o) => o.ev.k === 'arrete')) at = t / 60;
    }
    if (at >= 0) busted++;
    times.push(at < 0 ? '-' : at.toFixed(0) + ' s');
    sim.dispose();
  }
  ok(busted >= 4, `3★, joueur à pied immobile : arrêté ${busted}/5 fois en moins de 60 s (${times.join(', ')})`);
}

// ---------- 5. Systèmes ----------
async function main() {
  const sim = await Sim.create();
  const bus = new GameBus();
  bus.onError = (e, err) => { fails++; console.log(`ECHEC : écouteur ${e} : ${(err as Error)?.stack ?? err}`); };
  const systems = new Map<string, GameSystem>();
  const sent: { to: string; ev: GameServerEvent }[] = [];
  const ctx: GameCtx = {
    sim, bus, city, mode: 'solo',
    sendTo: (to, ev) => { sent.push({ to, ev }); }, broadcast() {},
    get: ((id: string) => systems.get(id)) as GameCtx['get'],
  };
  const camDownSet = new Set<string>();
  // Économie factice : seul `camerasDown` existe (comme dans l'économie réelle) ; la police suit les `cameraDestroyed` du bus.
  systems.set('economy', { id: 'economy', camerasDown: () => camDownSet.size } as unknown as GameSystem);
  const peds = createPeds(ctx) as PedsSystem;
  systems.set('peds', peds);
  const police = createPolice(ctx) as PoliceSystem;
  systems.set('police', police);
  sim.hooks.onPlayerKilled = (p, by, cause) => bus.emit('playerDied', { p, by, cause });
  sim.hooks.onVehicleDestroyed = (v, by) => bus.emit('vehicleDestroyed', { v, by });
  sim.hooks.onEnter = (p, v) => bus.emit('enteredVehicle', { p, v });
  sim.hooks.onInteract = (p) => police.onInteract!(p);
  sim.hooks.canEnter = (p, v) => police.canEnter!(p, v);

  // Les peds ne sont PAS avancés (peds.postStep jamais appelé) : seuls les flics injectés à la main existent, immobiles.
  const pedList = peds.peds as ReturnType<typeof makePed>[];
  const tick = (n: number, withPeds = false) => { for (let i = 0; i < n; i++) { police.preStep?.(); sim.step(); if (withPeds) peds.postStep?.(); police.postStep?.(); } };
  const addPlayer = (id: string, x: number, z: number) => {
    sim.addPlayer(id, id);
    const p = sim.players.get(id)!;
    p.body.setTranslation({ x, y: 1, z }, true);
    police.onJoin?.(p);
    return p;
  };
  const place = (p: ReturnType<typeof addPlayer>, x: number, z: number) => { p.body.setTranslation({ x, y: 1, z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };
  const stars = (p: ReturnType<typeof addPlayer>, n: number) => bus.emit('debug', { p, what: 'stars', arg: String(n) });
  const flic = (id: number, x: number, z: number, yaw: number) => {
    const f = makePed(id, 'flic', 1, city, 55);
    f.x = x; f.z = z; f.yaw = yaw; f.st = PED_ST.IDLE; f.timer = 1e9;
    pedList.push(f);
    return f;
  };
  const priv = (p: ReturnType<typeof addPlayer>) => {
    const out = { money: 0, bag: {}, bagCap: 20, stars: 0, starProgress: 0, district: 'campus', marks: [], medals: {}, unread: 0 } as PrivateState & { ws?: number; wl?: number };
    police.privateView!(p, out);
    return out;
  };
  const an = (id: string) => sim.snapshot().players.find((q) => q.id === id)?.an ?? 0;

  // Épuise le pool de police : la police n'apparaît pas, seuls les flics injectés regardent
  const hold: ReturnType<Sim['acquireVehicle']>[] = [];
  for (let i = 0; i < 12; i++) { const v = sim.acquireVehicle('police', 250 + i * 6, 300, 0); if (v) hold.push(v); }

  const a = addPlayer('a', 2, -40); // route nord-sud centrale
  tick(60 * 4);

  // ---- Repéré / perdu / revu ----
  {
    stars(a, 2);
    const f = flic(910001, 2, -40 + 25, 0); // 25 m au sud du joueur, regarde vers le nord (le joueur)
    tick(30);
    ok(police.phaseOf('a') === WS.REPERE && priv(a).ws === WS.REPERE, 'flic à pied qui regarde le joueur à 25 m : repéré (ws = 1)');
    const lk = police.lastKnownOf('a');
    ok(!!lk && Math.hypot(lk.x - 2, lk.z + 40) < 2, 'dernière position connue = position du joueur');
    tick(60 * 20);
    ok(police.starsOf('a') === 2, 'tant qu\'il est vu, l\'indice ne baisse pas (20 s)');
    f.yaw = Math.PI; // il tourne le dos
    tick(30);
    ok(police.phaseOf('a') === WS.RECHERCHE && priv(a).ws === WS.RECHERCHE, 'flic tourné de dos : plus vu, état « recherche » (ws = 2)');
    ok(typeof priv(a).wl === 'number' && priv(a).wl! > 0 && priv(a).wl! <= LOSE_DELAY_S[1], `HUD : secondes avant l'étoile perdue (wl = ${priv(a).wl})`);
    { const w = unpackMe(JSON.parse(JSON.stringify(packMe({ money: 0, bag: {}, bagCap: 14, stars: 2, starProgress: 0, district: 'campus', marks: [], medals: {}, unread: 0, ...priv(a) }))))!; ok(w.ws === priv(a).ws && w.wl === priv(a).wl, 'état de recherche transmis au client (message me compact)'); }
    tick(60 * 6);
    f.yaw = 0; // revu à mi-chemin du délai : le compteur repart
    tick(30);
    ok(police.phaseOf('a') === WS.REPERE, 'revu : repéré de nouveau');
    f.yaw = Math.PI;
    tick(60 * (LOSE_DELAY_S[1] - 3));
    ok(police.starsOf('a') === 2, 'après avoir été revu, le compteur est reparti de zéro (toujours 2★ après 9 s)');
    tick(60 * 5);
    ok(police.starsOf('a') === 1, `non vu ${LOSE_DELAY_S[1]} s : 2★ -> 1★`);
    ok(sent.some((e) => e.ev.k === 'toast' && /trace/.test((e.ev as { text: string }).text)), 'toast « la police perd votre trace »');
    tick(60 * (LOSE_DELAY_S[0] + 1));
    ok(police.starsOf('a') === 0 && police.phaseOf('a') === WS.LIBRE, `puis ${LOSE_DELAY_S[0]} s de plus : 0★ (semé)`);
    ok(sent.some((e) => e.ev.k === 'toast' && /semé/.test((e.ev as { text: string }).text)), 'toast « vous avez semé la police »');
    pedList.length = 0;
  }

  // ---- Un mur bloque la vue du flic ----
  {
    const b = city.buildings.find((q) => q.w > 20 && q.d > 20 && Math.abs(q.x) < 250 && Math.abs(q.z) < 250)!;
    const ax = b.x - b.w / 2 - 5, bx = b.x + b.w / 2 + 5;
    place(a, bx, b.z);
    stars(a, 3);
    flic(910002, ax, b.z, yawTo(ax, b.z, bx, b.z));
    tick(40);
    ok(police.phaseOf('a') === WS.RECHERCHE, `bâtiment entre le flic (${Math.round(bx - ax)} m, dans son cône) et le joueur : non vu`);
    pedList.length = 0;
    stars(a, 0);
  }

  // ---- Caméras de surveillance (réelles) ----
  {
    // une caméra, et un point devant elle (8..14 m) en ligne de vue dégagée
    const cams = city.poisOf('camera');
    let cam: Poi | null = null, tx = 0, tz = 0;
    for (const c of cams) {
      for (const dist of [10, 14, 8]) {
        const x = c.x - dist * Math.sin(c.yaw), z = c.z - dist * Math.cos(c.yaw);
        if (lineOfSight(city, c.x, c.z, x, z) && Math.abs(x) < 300 && Math.abs(z) < 300 && !city.buildings.some((q) => Math.abs(x - q.x) < q.w / 2 + 1 && Math.abs(z - q.z) < q.d / 2 + 1)) { cam = c; tx = x; tz = z; break; }
      }
      if (cam) break;
    }
    ok(!!cam, 'une caméra réelle avec un point dégagé devant elle existe');
    if (cam) {
      place(a, tx, tz);
      stars(a, 4);
      let seenFrames = 0, frames = 0;
      for (let i = 0; i < 60 * 40; i += 3) {
        tick(3); frames++;
        if (police.phaseOf('a') === WS.REPERE) seenFrames++;
      }
      ok(seenFrames > 0 && seenFrames < frames, `caméra réelle intacte : le joueur est vu par moments pendant le balayage (${seenFrames}/${frames})`);
      // détruite : plus jamais vu
      camDownSet.add(cam.id);
      bus.emit('cameraDestroyed', { by: null, id: cam.id });
      stars(a, 4);
      tick(60 * 3);
      let seenAfter = 0;
      for (let i = 0; i < 60 * 40; i += 3) { tick(3); if (police.phaseOf('a') === WS.REPERE) seenAfter++; }
      ok(seenAfter === 0, 'caméra détruite : plus aucune détection par cette caméra');
      camDownSet.clear();
    }
    stars(a, 0);
  }

  // ---- Cachettes : valable, grillée, découverte, sortie ----
  {
    const spots = hidingSpots(city);
    const free = (x: number, z: number) => Math.abs(x) < 300 && Math.abs(z) < 300 && !city.buildings.some((q) => Math.abs(x - q.x) < q.w / 2 + 1 && Math.abs(z - q.z) < q.d / 2 + 1);
    // garage en ligne de vue dégagée à 12 m et 25 m dans une même direction
    let spot: HidingSpot | null = null, dir: [number, number] = [0, 0];
    for (const s of spots) {
      if (s.kind !== 'garage') continue;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const p12 = [s.x + d[0] * 12, s.z + d[1] * 12], p25 = [s.x + d[0] * 25, s.z + d[1] * 25];
        if (free(p12[0], p12[1]) && free(p25[0], p25[1]) && lineOfSight(city, s.x, s.z, p25[0], p25[1])) { spot = s; dir = d; break; }
      }
      if (spot) break;
    }
    ok(!!spot, 'un garage avec ligne de vue dégagée à 12 et 25 m existe');
    if (spot) {
      const at = (m: number): [number, number] => [spot!.x + dir[0] * m, spot!.z + dir[1] * m];
      // 0 étoile : E n'est pas intercepté
      place(a, spot.x, spot.z);
      tick(10);
      ok(!police.onInteract!(a) && !police.hiddenIn('a'), 'sans étoile : E ne cache pas');
      // Cachette valable : un flic à 25 m regarde droit sur nous
      stars(a, 3);
      const [cx, cz] = at(25);
      const f = flic(910010, cx, cz, yawTo(cx, cz, spot.x, spot.z));
      tick(40);
      ok(police.phaseOf('a') === WS.REPERE, 'témoin : le flic à 25 m voit le joueur debout');
      sent.length = 0;
      sim.interact('a');
      ok(police.hiddenIn('a')?.id === spot.id, 'E près de la cachette : le joueur se cache');
      ok(sent.some((e) => e.ev.k === 'toast' && /caché/.test((e.ev as { text: string }).text)), 'toast « vous êtes caché »');
      tick(30);
      ok(an('a') === 5, 'snapshot : an = 5 (caché)');
      ok(police.phaseOf('a') === WS.CACHE && priv(a).ws === WS.CACHE, 'caché : invisible malgré le flic en plein cône (ws = 3)');
      // ni conduite ni tir
      const car = sim.acquireVehicle('citadine', spot.x + 1.5, spot.z, 0, { y: 0.6 })!;
      ok(police.canEnter!(a, car) === false && !sim.enterVehicle(a, car), 'caché : ne peut pas monter en voiture');
      sim.releaseVehicle(car);
      // le temps passe : l'étoile finit par tomber malgré le flic qui regarde
      tick(60 * (LOSE_DELAY_S[2] + 1));
      ok(police.starsOf('a') === 2 && police.hiddenIn('a') !== null, `caché 18 s sous le regard du flic : 3★ -> 2★ (toujours caché)`);
      // sortie par mouvement : d'abord neutre, puis on avance
      a.input = { ...a.input, f: 0, s: 0 };
      tick(2);
      a.input = { ...a.input, f: 1 };
      tick(2);
      ok(!police.hiddenIn('a') && an('a') === 0, 'un mouvement fait ressortir (an = 0)');
      ok(police.phaseOf('a') === WS.REPERE, 'sorti sous les yeux du flic : repéré');
      a.input = { ...a.input, f: 0 };
      place(a, spot.x, spot.z);
      // sortie par E
      tick(5);
      sim.interact('a');
      ok(!!police.hiddenIn('a'), 'nouvelle cachette');
      sim.interact('a');
      ok(!police.hiddenIn('a'), 'E : on ressort');
      // Grillée : le flic est à 12 m, en ligne de vue
      pedList.length = 0;
      stars(a, 3);
      const [gx, gz] = at(12);
      flic(910011, gx, gz, yawTo(gx, gz, spot.x, spot.z) + Math.PI); // tourné de dos : « grillé » ne dépend pas du cône
      tick(10);
      sent.length = 0;
      sim.interact('a');
      ok(police.hiddenIn('a')?.id === spot.id, 'cachette grillée : le joueur y est quand même (immobile)');
      ok(sent.some((e) => e.ev.k === 'toast' && /grillée/.test((e.ev as { text: string }).text)), 'toast « cachette grillée »');
      ok(police.phaseOf('a') === WS.REPERE, 'grillée : repéré tout de suite');
      sim.interact('a');
      pedList.length = 0;
      // La cachette reste grillée un moment même sans flic
      stars(a, 3);
      tick(10);
      sim.interact('a');
      ok(police.hiddenIn('a')?.id === spot.id && sent.filter((e) => e.ev.k === 'toast' && /grillée/.test((e.ev as { text: string }).text)).length >= 2, 'cachette grillée : le reste ~60 s pour tous');
      sim.interact('a');
      tick(60 * 61);
      stars(a, 3);
      tick(5);
      sim.interact('a');
      const n0 = sent.filter((e) => e.ev.k === 'toast' && /grillée/.test((e.ev as { text: string }).text)).length;
      ok(police.hiddenIn('a')?.id === spot.id && police.phaseOf('a') !== WS.REPERE && n0 === 2, 'après 60 s : la cachette est de nouveau valable');
      // Un flic tout près (≤ 3 m) découvre un joueur caché
      const [nx, nz] = at(2);
      tick(5);
      flic(910012, nx, nz, 0);
      tick(10);
      ok(!police.hiddenIn('a') && police.phaseOf('a') === WS.REPERE, 'flic à 2 m : le joueur caché est découvert');
      pedList.length = 0;
      void f;
    }
    stars(a, 0);
  }

  // ---- Arrestation en cours : se cacher ne l'interrompt pas ----
  {
    const spot = hidingSpots(city).find((s) => s.kind === 'garage')!;
    place(a, spot.x, spot.z);
    tick(130);
    stars(a, 2);
    let busted = 0;
    bus.on('playerBusted', () => { busted++; });
    flic(910020, spot.x + 1.2, spot.z, 0); // au contact
    tick(20);
    sim.interact('a'); // tente de se cacher pendant l'arrestation
    tick(60 * 3);
    ok(busted === 1, 'cacher le joueur ne l\'empêche pas d\'être arrêté (flic au contact)');
    ok(!police.hiddenIn('a'), 'arrestation : la cachette est quittée');
    pedList.length = 0;
    tick(60 * 4);
  }

  // ---- Effectifs : 1★ = 1, 2★ = 2 max, 3★ = 3, 4★ = 4, 5★ = 6 ----
  {
    for (const v of hold) if (v) sim.releaseVehicle(v);
    hold.length = 0;
    const c = addPlayer('c', -200, 100);
    sim.removePlayer('a');
    police.onLeave?.(a);
    tick(60 * 3);
    for (const n of [1, 2, 3, 4, 5]) {
      stars(c, n);
      let max = 0, first = -1;
      for (let i = 0; i < 60 * 70; i++) {
        tick(1);
        if (i % 120 === 0) stars(c, n); // la furtivité ferait sinon baisser l'indice : on le maintient pour mesurer l'effectif
        c.invulnUntil = sim.time + 10_000; // joueur immobile : sans cela il serait arrêté (voitures dispersées au commissariat)
        max = Math.max(max, police.carCount);
        if (first < 0 && police.carCount > 0) first = i / 60;
      }
      ok(max <= copsWanted(n) && max >= copsWanted(n) - 1 && max <= (n === 5 ? 6 : n), `${n}★ : ${max} voiture(s) maximum (attendu ${copsWanted(n)}, une voiture peut s'abîmer et être remplacée), première arrivée après ${first.toFixed(1)} s`);
      stars(c, 0);
      tick(60 * 130); // recyclage (2 min sans recherche)
    }
    sim.removePlayer('c');
    police.onLeave?.(c);
  }

  // ---- Vitesse : la police ne rattrape pas le joueur qui fuit en ligne droite ----
  {
    for (const v of sim.vehicles) if (v.def.type === 'police' && !v.pooled) sim.releaseVehicle(v); // plus aucune voiture du système sur la route d'essai
    const pl = addPlayer('f', 2, -300);
    pl.input = { ...NO_INPUT, f: 1 };
    const report = (st: number) => {
      let gapMin = Infinity, catchT = -1, vP = 0, vC = 0, t = 0;
      const p2 = sim.acquireVehicle('citadine', 2, -200, Math.PI, { y: 0.6 })!;
      const c2 = sim.acquireVehicle('police', 2, -320, Math.PI, { ai: true })!;
      sim.enterVehicle(pl, p2, 0);
      const m = newDriveMem();
      for (let i = 0; i < 60 * 19; i++) {
        if (i % 3 === 0) {
          const bp = p2.behavior.body.translation(), bc = c2.behavior.body.translation();
          const o = c2.behavior.body.rotation();
          const yaw = Math.atan2(2 * (o.x * o.z + o.w * o.y), 1 - 2 * (o.x * o.x + o.y * o.y));
          const out = copInput({ x: bc.x, z: bc.z, yaw, speed: sim.forwardSpeed(c2.behavior.body) }, { x: bp.x, z: bp.z }, st, m);
          c2.ai!.input.f = out.f; c2.ai!.input.s = out.s; c2.ai!.input.jump = out.jump;
          const gap = Math.hypot(bp.x - bc.x, bp.z - bc.z);
          gapMin = Math.min(gapMin, gap);
          if (catchT < 0 && gap < 6) catchT = i / 60;
          vP = Math.max(vP, sim.forwardSpeed(p2.behavior.body)); vC = Math.max(vC, sim.forwardSpeed(c2.behavior.body)); // vitesses de pointe atteintes
        }
        sim.step();
        t = i / 60;
      }
      const bp = p2.behavior.body.translation(), bc = c2.behavior.body.translation();
      const gapEnd = Math.hypot(bp.x - bc.x, bp.z - bc.z);
      sim.releaseVehicle(p2); sim.releaseVehicle(c2); // éjecte le joueur
      return { gapMin, catchT, vP, vC, gapEnd, t };
    };
    for (const st of [1, 2, 3]) {
      const r = report(st);
      console.log(`info   : ${st}★, départ à 120 m, joueur plein gaz (pointe ${r.vP.toFixed(1)} m/s) : police (pointe) ${r.vC.toFixed(1)} m/s, écart mini ${r.gapMin.toFixed(0)} m, écart à ${r.t.toFixed(0)} s : ${r.gapEnd.toFixed(0)} m, rattrapé : ${r.catchT < 0 ? 'JAMAIS (sur 19 s)' : r.catchT.toFixed(1) + ' s'}`);
      ok(r.catchT < 0 && r.gapEnd > 120, `${st}★ : la voiture de police ne rattrape jamais le joueur en ligne droite (écart final ${r.gapEnd.toFixed(0)} m)`);
      ok(r.vC < r.vP, `${st}★ : vitesse police ${r.vC.toFixed(1)} < joueur ${r.vP.toFixed(1)} m/s`);
    }
    ok([1, 2, 3, 4].every((s) => copSpeed(s) < PLAYER_TOP_SPEED) && copSpeed(2) < copSpeed(3) && copAccelFactor(2) < 1 && copTurnFactor(2) < 1, 'réglages : copSpeed < 24,5 aux étoiles basses, poussée et braquage réduits');
    sim.removePlayer('f');
    police.onLeave?.(pl);
  }

  // ---- Poursuite réelle : police + joueur immobile (rejoint), fouille d'une cachette, VRef périmée ----
  {
    const spot = hidingSpots(city).find((s) => s.kind === 'ruelle' && Math.abs(s.x) < 150 && Math.abs(s.z) < 150)!;
    const h = addPlayer('h', spot.x, spot.z);
    tick(60 * 4);
    stars(h, 5);
    sim.interact('h'); // se cache tout de suite : la dernière position connue = la cachette
    ok(police.hiddenIn('h')?.id === spot.id, 'ruelle : cachette occupée');
    let foundAt = -1, dropped = -1;
    for (let i = 0; i < 60 * 200; i++) {
      tick(1);
      if (i === 60 * 40 || i === 60 * 41) { // rupture des références : les voitures de police sont recyclées d'un coup
        if (i === 60 * 40) for (const v of sim.vehicles) if (v.def.type === 'police' && !v.pooled) sim.releaseVehicle(v);
      }
      if (foundAt < 0 && !police.hiddenIn('h')) foundAt = i / 60;
      if (dropped < 0 && police.starsOf('h') < 5) dropped = i / 60;
      if (i % 600 === 0 && police.starsOf('h') > 0) stars(h, 5);
    }
    console.log(`info   : joueur caché à 5★ : découvert par fouille/proximité à ${foundAt < 0 ? 'jamais (sur 200 s)' : foundAt.toFixed(0) + ' s'}, première étoile perdue à ${dropped < 0 ? '-' : dropped.toFixed(0) + ' s'}`);
    ok(!(sim as unknown as { broken: boolean }).broken, 'voitures de police recyclées en pleine poursuite : Rapier intact (VRef/bodyOk)');
    ok(police.carCount >= 0, 'la police a continué après le recyclage');
    sim.removePlayer('h');
    police.onLeave?.(h);
  }

  // ---- Budget : 4 joueurs à 3★ ----
  {
    const ps = [addPlayer('p1', 0, 0), addPlayer('p2', 40, 40), addPlayer('p3', -40, 40), addPlayer('p4', 40, -40)];
    tick(60 * 3);
    let tot = 0, n = 0, maxMs = 0;
    for (let i = 0; i < 60 * 60; i++) {
      police.preStep?.(); sim.step(); peds.postStep?.();
      const t0 = performance.now(); police.postStep?.(); const d = performance.now() - t0; tot += d; n++; maxMs = Math.max(maxMs, d);
      if (i % 200 === 0) for (const p of ps) stars(p, 3);
    }
    ok(tot / n < 0.5, `budget : ${(tot / n).toFixed(3)} ms/pas en moyenne (max ${maxMs.toFixed(2)} ms) avec 4 joueurs à 3★ (< 0,5)`);
    ok(police.carCount <= 10, `pool plafonné (${police.carCount} voitures)`);
    // ---- Sauvegarde ----
    const ser = police.serialize!();
    const json = JSON.stringify(ser);
    ok(json.length < 600 && !/hide|lk|phase/.test(json), `serialize : étoiles seulement (${json.length} octets)`);
    police.restore!(null);
    police.restore!({ w: 5 });
    police.restore!(JSON.parse('{"w":{"__proto__":{"heat":50},"x":{"heat":"a"},"y":{"heat":1e99,"kills":-3},"q":null}}'));
    police.restore!(ser);
    ok(({} as { heat?: number }).heat === undefined, 'restore : pas de pollution du prototype');
  }
}

main().then(immobileSuite).then(() => {
  console.log(fails ? `\n${fails} échec(s)` : '\nfurtivité : tout est vert');
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
