// Suite « economie » : logique pure de shared/economy (prix, événements, tuyaux, caméras, sérialisation). Aucun serveur, aucun port.
// Lancement : npx tsx tests/economie.ts
import { DISTRICT_IDS, GANG_IDS, GOOD_IDS, type DistrictId, type GoodId } from '../shared/ids';
import { GOODS } from '../shared/economy/goods';
import { GANGS, territoryMult, GANG_OF_DISTRICT } from '../shared/economy/gangs';
import {
  advanceMarket, applyTrade, camsIntactRatio, createEvent, eventMult, flowOf, makeRng, newMarketState, parseMarket, quote, quoteLot, rollTip, serializeMarket, setCameras,
  tipSendProbability, tradeTotal, unitPrice, FLOW_HALF_LIFE_MS, FLOW_IMPACT, FLOW_MAX, FLOW_MIN, MAX_PRICE_FACTOR, NOISE_MAX, NOISE_MIN, NOISE_PERIOD_MS, TIP_SEND_PROB,
} from '../shared/economy/prices';
import { tipOf, tipText } from '../shared/economy/tips';
import { Sim } from '../shared/sim';
import { GameBus, parseGameMsg, type GameCtx, type GameSystem } from '../shared/game';
import { getCity } from '../shared/city/layout';
import type { GameClientMsg, GameServerEvent, PrivateState } from '../shared/protocol';
import type { SimPlayer } from '../shared/api';
import { runCommand } from '../server/commands';
import { createEconomy, type EconomySystem } from '../server/systems/economy';
import { BAG_CAP, MAX_TRADE_QTY, START_MONEY, STASH_CAP, bagVolume, bustLoss, parseAmount, rayMissDistance } from '../shared/economy/trade';

let fails = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' : ' + detail : ''}`);
  if (!ok) fails++;
}
const pick = <T>(l: readonly T[], r: () => number): T => l[Math.min(l.length - 1, Math.floor(r() * l.length))];

// ---- 1. Tables ----
{
  let ok = true;
  for (const g of GOOD_IDS) { const d = GOODS[g]; ok &&= d.id === g && d.base >= 1 && Number.isInteger(d.base) && d.weight >= 1 && d.name.length > 0 && d.emoji.length > 0; }
  check('goods : une entrée valide par marchandise', ok);
  let okG = true;
  for (const gid of GANG_IDS) {
    const g = GANGS[gid];
    okG &&= g.produceMult >= 0.5 && g.produceMult <= 0.7 && g.wantMult >= 1.4 && g.wantMult <= 1.8 && g.policePressure >= 0 && g.policePressure <= 1;
    okG &&= g.produces.length > 0 && g.wants.length > 0 && !g.produces.some((x) => g.wants.includes(x));
    okG &&= GANG_OF_DISTRICT[g.district] === gid;
  }
  check('gangs : multiplicateurs dans les plages, offre et demande disjointes', okG);
  const prod = new Map<GoodId, number>(), want = new Map<GoodId, number>();
  for (const gid of GANG_IDS) { for (const x of GANGS[gid].produces) prod.set(x, (prod.get(x) ?? 0) + 1); for (const x of GANGS[gid].wants) want.set(x, (want.get(x) ?? 0) + 1); }
  check('chaque marchandise est produite et demandée au moins une fois', GOOD_IDS.every((g) => (prod.get(g) ?? 0) >= 1 && (want.get(g) ?? 0) >= 1));
  const banned = /coca|hero|canna|weed|opium|lsd|crack|meth|ecstasy|drogue|cocaine/i;
  check('aucun nom de drogue', GOOD_IDS.every((g) => !banned.test(GOODS[g].name + GOODS[g].blurb + g)));
}

// ---- 2. Multiplicateurs de territoire ----
{
  let ok = true;
  for (const d of DISTRICT_IDS) for (const g of GOOD_IDS) {
    const m = territoryMult(g, d), gang = GANGS[GANG_OF_DISTRICT[d]];
    if (gang.produces.includes(g)) ok &&= m >= 0.5 && m <= 0.7;
    else if (gang.wants.includes(g)) ok &&= m >= 1.4 && m <= 1.8;
    else ok &&= m === 1;
  }
  check('territoire : 0,5-0,7 produit / 1,4-1,8 demandé / 1,0 sinon', ok);
  const s = newMarketState();
  const g = GANGS.golfeurs.produces[0], w = GANGS.golfeurs.wants[0];
  check('prix : le producteur vend moins cher que le demandeur', unitPrice(g, 'les_hauts', s, 0) < GOODS[g].base && unitPrice(w, 'les_hauts', s, 0) > GOODS[w].base);
}

// ---- 3. Bornes sur 10 000 tirages (états aléatoires) ----
{
  const rnd = makeRng(42);
  let ok = true, minP = Infinity, maxRatio = 0, noiseOk = true;
  const s = newMarketState();
  let now = 0;
  for (let i = 0; i < 10_000; i++) {
    now += 1000 + rnd() * 4000;
    advanceMarket(s, now, rnd);
    rollTip(s, now, rnd);
    for (const d of DISTRICT_IDS) s.police[d] = rnd();
    const g = pick(GOOD_IDS, rnd), d = pick(DISTRICT_IDS, rnd);
    const p = unitPrice(g, d, s, now), q = quote(g, d, s, now);
    minP = Math.min(minP, p);
    maxRatio = Math.max(maxRatio, p / GOODS[g].base);
    ok &&= Number.isInteger(p) && p >= 1 && p <= GOODS[g].base * MAX_PRICE_FACTOR && Number.isInteger(q.buy) && Number.isInteger(q.sell) && q.sell >= 1 && q.buy > q.sell;
    for (const e of Object.values(s.noise)) noiseOk &&= e >= NOISE_MIN && e <= NOISE_MAX;
    ok &&= s.events.length <= 5;
  }
  check('10 000 tirages : prix entier >= 1, borné, buy > sell >= 1', ok, `min ${minP}, max x${maxRatio.toFixed(2)} de la base`);
  check('10 000 tirages : ε toujours dans [0,92 ; 1,08]', noiseOk);
  // pire cas : tous les extrêmes
  const w = newMarketState();
  for (const d of DISTRICT_IDS) w.police[d] = 1;
  const g: GoodId = 'copies_blanches';
  w.events.push({ good: g, district: 'les_hauts', mult: 3.5, start: 0, until: 1e9 });
  w.noise[`${g}:les_hauts`] = NOISE_MAX;
  check('pire cas haut : plafonné', unitPrice(g, 'les_hauts', w, 10) <= GOODS[g].base * MAX_PRICE_FACTOR);
  const lo = newMarketState();
  lo.police.zone_indus = 0;
  lo.events.push({ good: 'ecrous_de_12', district: 'zone_indus', mult: 0.35, start: 0, until: 1e9 });
  lo.noise['ecrous_de_12:zone_indus'] = NOISE_MIN;
  check('pire cas bas : jamais négatif ni nul', unitPrice('ecrous_de_12', 'zone_indus', lo, 10) >= 1 && quote('ecrous_de_12', 'zone_indus', lo, 10).sell >= 1);
}

// ---- 4. Formule exacte ----
{
  const s = newMarketState();
  s.police.docks = 0.5;
  s.noise['sardines_de_quai:docks'] = 1.05;
  s.events.push({ good: 'sardines_de_quai', district: 'docks', mult: 3, start: 100, until: 500 });
  const m = GANGS.mouettes.produceMult;
  const exp = Math.round(GOODS.sardines_de_quai.base * m * 3 * (1 + 0.3 * 0.5) * 1.05);
  check('formule : Pbase × Mterr × Mév × (1+0,3R) × ε', unitPrice('sardines_de_quai', 'docks', s, 200) === exp, `${unitPrice('sardines_de_quai', 'docks', s, 200)} vs ${exp}`);
  const before = unitPrice('sardines_de_quai', 'docks', s, 50);
  check('événement pas encore démarré : sans effet', eventMult(s, 'sardines_de_quai', 'docks', 50) === 1 && before < unitPrice('sardines_de_quai', 'docks', s, 200));
}

// ---- 5. Expiration des événements ----
{
  const rnd = makeRng(7);
  const s = newMarketState();
  s.events.push({ good: 'cafe_machine', district: 'campus', mult: 3, start: 0, until: 1000 });
  s.events.push({ good: 'cables_hdmi', district: 'docks', mult: 0.35, start: 0, until: 5000 });
  const during = unitPrice('cafe_machine', 'campus', s, 999);
  check('événement actif avant la fin', eventMult(s, 'cafe_machine', 'campus', 999) === 3);
  check('événement inactif à `until` exactement', eventMult(s, 'cafe_machine', 'campus', 1000) === 1);
  const gone = advanceMarket(s, 1000, rnd);
  check('advanceMarket retire et renvoie l\'événement expiré', gone.length === 1 && s.events.length === 1 && gone[0].good === 'cafe_machine');
  check('le prix retombe après expiration', unitPrice('cafe_machine', 'campus', s, 1000) < during);
  advanceMarket(s, 6000, rnd);
  check('tous expirés', s.events.length === 0);
  // durée et multiplicateurs des événements créés
  let okE = true, pen = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const st = newMarketState();
    const e = createEvent(st, 1000, rnd)!;
    n++;
    okE &&= e.start > 1000 && e.until - e.start >= 90_000 && e.until - e.start <= 180_000;
    if (e.mult >= 2.5 && e.mult <= 3.5) pen++; else okE &&= e.mult === 0.35;
  }
  check('événements créés : mult 2,5-3,5 ou 0,35, durée 90-180 s', okE);
  check('tirage ~70 % pénurie', Math.abs(pen / n - 0.7) < 0.03, `${(100 * pen / n).toFixed(1)} %`);
  // pas de doublon ni de dépassement
  const st = newMarketState();
  for (let i = 0; i < 50; i++) createEvent(st, 0, rnd);
  const keys = new Set(st.events.map((e) => `${e.good}:${e.district}`));
  check('au plus 5 événements, sans doublon', st.events.length <= 5 && keys.size === st.events.length);
}

// ---- 6. Bruit recalculé périodiquement ----
{
  const rnd = makeRng(3);
  const s = newMarketState();
  advanceMarket(s, NOISE_PERIOD_MS, rnd);
  const a = JSON.stringify(s.noise);
  advanceMarket(s, NOISE_PERIOD_MS + 1000, rnd);
  check('ε inchangé avant la fin de la période', JSON.stringify(s.noise) === a);
  advanceMarket(s, NOISE_PERIOD_MS * 2 + 1, rnd);
  check('ε recalculé après la période', JSON.stringify(s.noise) !== a);
}

// ---- 7. Règle des caméras (statistique) ----
{
  const run = (intact: number, total: number, seed: number) => {
    const rnd = makeRng(seed);
    let events = 0, sms = 0;
    for (let i = 0; i < 30_000; i++) {
      const s = newMarketState();
      for (const d of DISTRICT_IDS) setCameras(s, d, intact, total);
      s.nextRollAt = 0;
      const t = rollTip(s, 0, rnd);
      if (s.events.length) { events++; if (t) sms++; }
    }
    return sms / events;
  };
  const hi = run(3, 4, 11), lo = run(1, 4, 12), edge = run(2, 4, 13);
  check('caméras > 50 % intactes : probabilité divisée par 2', Math.abs(hi - TIP_SEND_PROB / 2) < 0.015, `${hi.toFixed(3)} (attendu ${(TIP_SEND_PROB / 2).toFixed(3)})`);
  check('caméras <= 50 % intactes : probabilité pleine', Math.abs(lo - TIP_SEND_PROB) < 0.015, `${lo.toFixed(3)}`);
  check('exactement 50 % : pas de réduction', Math.abs(edge - TIP_SEND_PROB) < 0.015, `${edge.toFixed(3)}`);
  check('rapport hi/lo ≈ 0,5', Math.abs(hi / lo - 0.5) < 0.04, (hi / lo).toFixed(3));
  const s = newMarketState();
  setCameras(s, 'campus', 3, 3);
  const p3 = tipSendProbability(s, 'campus');
  setCameras(s, 'campus', 1, 3);
  check('détruire des caméras remonte la probabilité', tipSendProbability(s, 'campus') === p3 * 2 && camsIntactRatio(s, 'campus') < 0.5);
  setCameras(s, 'campus', 99, 3);
  check('setCameras borne intact <= total', s.camsUp.campus === 3);
  const sms = (() => { const r = makeRng(5); for (let i = 0; i < 1000; i++) { const st = newMarketState(); st.nextRollAt = 0; const t = rollTip(st, 0, r); if (t) return { t, st }; } return null; })()!;
  const tip = tipOf(sms.t);
  check('SMS structuré : expéditeur, texte non vide, tip {good,district,kind}', sms.t.from.length > 0 && sms.t.text.length > 10 && !!tip && isFinite(sms.t.tip!.until) && (tip.kind === 'penurie' || tip.kind === 'surplus'), sms.t.text);
  check('texte de pénurie et de surplus distincts', tipText('cafe_machine', 'campus', true) !== tipText('cafe_machine', 'campus', false));
}

// ---- 8. Déterminisme ----
{
  const simulate = (seed: number) => {
    const rnd = makeRng(seed), s = newMarketState(), log: unknown[] = [];
    for (let t = 0; t < 600_000; t += 1000) {
      advanceMarket(s, t, rnd);
      const sms = rollTip(s, t, rnd);
      if (sms) log.push(sms);
    }
    return JSON.stringify([log, serializeMarket(s)]);
  };
  check('même graine -> même marché et mêmes SMS', simulate(99) === simulate(99));
  check('graines différentes -> marchés différents', simulate(99) !== simulate(100));
}

// ---- 9. Pas d'argent gratuit (lot facturé au prix moyen du glissement) ----
{
  const rnd = makeRng(2024);
  let worst = Infinity, ok = true, okMono = true;
  for (let i = 0; i < 20_000; i++) {
    const s = newMarketState();
    advanceMarket(s, NOISE_PERIOD_MS, rnd); // ε aléatoire
    for (const d of DISTRICT_IDS) s.police[d] = rnd();
    const g = pick(GOOD_IDS, rnd), d = pick(DISTRICT_IDS, rnd);
    if (rnd() < 0.5) applyTrade(s, g, d, rnd() < 0.5 ? 'buy' : 'sell', 1 + Math.floor(rnd() * 40)); // marché déjà saturé dans un sens ou l'autre
    const qty = 1 + Math.floor(rnd() * 40);
    const buyUnit = quoteLot(g, d, s, 0, 'buy', qty);
    applyTrade(s, g, d, 'buy', qty);
    const sellUnit = quoteLot(g, d, s, 0, 'sell', qty); // revente immédiate de la même quantité, même quartier
    ok &&= sellUnit < buyUnit;
    worst = Math.min(worst, buyUnit - sellUnit);
    // pire cas : ε passe de 0,92 (achat) à 1,08 (revente) entre-temps
    const z = newMarketState(); z.police[d] = s.police[d];
    z.noise[`${g}:${d}`] = NOISE_MIN;
    const lowBuy = quoteLot(g, d, z, 0, 'buy', qty);
    z.noise[`${g}:${d}`] = NOISE_MAX;
    applyTrade(z, g, d, 'buy', qty);
    const highSell = quoteLot(g, d, z, 0, 'sell', qty);
    ok &&= highSell < lowBuy;
    // acheter fait monter le prix, vendre le fait baisser, jamais hors bornes
    const before = flowOf(s, g, d);
    applyTrade(s, g, d, 'sell', qty);
    okMono &&= flowOf(s, g, d) <= before && flowOf(s, g, d) >= FLOW_MIN && flowOf(s, g, d) <= FLOW_MAX;
  }
  check("aller-retour achat/revente d'un lot : jamais de gain (même ε 0,92 -> 1,08, même marché saturé)", ok, `marge pire cas ${worst} €/pièce`);
  check('flux Φ : acheter monte, vendre baisse, toujours dans [0,6 ; 1,5]', okMono);
  const f = newMarketState();
  const k0 = quote('cafe_machine', 'campus', f, 0).buy;
  applyTrade(f, 'cafe_machine', 'campus', 'buy', 5);
  check('acheter 5 unités fait monter le prix de la suivante', quote('cafe_machine', 'campus', f, 0).buy > k0 && Math.abs(flowOf(f, 'cafe_machine', 'campus') - (1 + 5 * FLOW_IMPACT)) < 1e-9);
  const m1 = tradeTotal('annales_secretes', 'les_hauts', f, 0, 'buy', 5);
  check('tradeTotal : prix du lot = prix moyen × quantité, jamais moins que 5 × la 1re unité', m1 >= 5 * quote('annales_secretes', 'les_hauts', f, 0).buy);
  const r2 = newMarketState();
  applyTrade(r2, 'cafe_machine', 'campus', 'buy', 10);
  const f0 = flowOf(r2, 'cafe_machine', 'campus') - 1;
  advanceMarket(r2, FLOW_HALF_LIFE_MS, makeRng(1));
  const f1 = flowOf(r2, 'cafe_machine', 'campus') - 1;
  check('flux Φ : revient vers 1 avec la demi-vie annoncée', Math.abs(f1 / f0 - 0.5) < 0.02, `${(f1 / f0).toFixed(3)}`);
  advanceMarket(r2, FLOW_HALF_LIFE_MS * 30, makeRng(1));
  check('flux Φ : retombe à 1 (clé effacée) bien après', flowOf(r2, 'cafe_machine', 'campus') === 1 && Object.keys(r2.flow).length === 0);
  const sat = newMarketState();
  for (let i = 0; i < 50; i++) applyTrade(sat, 'cafe_machine', 'campus', 'buy', 100);
  check('flux Φ saturé : plafonné à ×1,5 et prix <= base × 10', flowOf(sat, 'cafe_machine', 'campus') === FLOW_MAX && unitPrice('cafe_machine', 'campus', sat, 0) <= GOODS.cafe_machine.base * MAX_PRICE_FACTOR);
  for (let i = 0; i < 50; i++) applyTrade(sat, 'cafe_machine', 'campus', 'sell', 100);
  check('flux Φ vidé : plancher ×0,6 et prix >= 1', flowOf(sat, 'cafe_machine', 'campus') === FLOW_MIN && quote('cafe_machine', 'campus', sat, 0).sell >= 1);
}

// ---- 10. Sérialisation ----
{
  const rnd = makeRng(8);
  const s = newMarketState();
  for (let t = 0; t < 300_000; t += 1000) { advanceMarket(s, t, rnd); rollTip(s, t, rnd); }
  setCameras(s, 'docks', 1, 3);
  s.police.campus = 0.77;
  applyTrade(s, 'cafe_machine', 'campus', 'buy', 7);
  check('sérialisation : le flux Φ est sauvegardé', serializeMarket(s).flow!.length >= 1);
  const save = JSON.parse(JSON.stringify(serializeMarket(s)));
  const back = parseMarket(save);
  check('aller-retour JSON identique', JSON.stringify(serializeMarket(back)) === JSON.stringify(serializeMarket(s)));
  check('prix identiques après rechargement', GOOD_IDS.every((g) => DISTRICT_IDS.every((d) => unitPrice(g, d, back, 300_000) === unitPrice(g, d, s, 300_000))));
  check('la sauvegarde ne contient que des tableaux et des nombres', (() => {
    const bad = (v: unknown): boolean => (Array.isArray(v) ? v.some(bad) : typeof v === 'string' || typeof v === 'number' ? false : true);
    return bad(save.noise) === false && bad(save.events) === false && bad(save.cams) === false && bad(save.police) === false;
  })());
  // données hostiles : ne jette jamais, état valide
  const evil: unknown[] = [null, 5, 'x', [], {}, { noise: 'x', events: [[1]], cams: [['__proto__', 1, 2]], police: [['campus', 'NaN']] },
    JSON.parse('{"noise":[["__proto__","campus",9],["cafe_machine","campus",99],["cafe_machine","campus",null]],"events":[["cafe_machine","campus",1e99,-1,1e99],["zzz","campus",1,1,1]],"cams":[["campus",-5,1e9]],"police":[["campus",42],["__proto__",1]],"noiseAt":"a"}')];
  let ok = true;
  for (const e of evil) {
    try {
      const m = parseMarket(e);
      for (const d of DISTRICT_IDS) ok &&= m.police[d] >= 0 && m.police[d] <= 1 && m.camsUp[d] >= 0 && m.camsUp[d] <= m.camsTotal[d];
      for (const g of GOOD_IDS) for (const d of DISTRICT_IDS) { const p = unitPrice(g, d, m, 0); ok &&= Number.isFinite(p) && p >= 1; }
      ok &&= m.events.every((v) => v.mult >= 0.35 && v.mult <= 3.5) && ({} as Record<string, unknown>).polluted === undefined;
    } catch { ok = false; }
  }
  check('parseMarket résiste aux données hostiles', ok);
  const hostile = parseMarket(JSON.parse('{"flow":[["cafe_machine","campus",1e99],["__proto__","campus",2],["cafe_machine","campus","x"]],"flowAt":"y","events":[["cafe_machine","campus",3,5,1],["cafe_machine","campus",3,0,1e15],["cafe_machine","docks",3,10,20]]}'));
  check('parseMarket : flux borné, événements sans durée positive ignorés, durée plafonnée', flowOf(hostile, 'cafe_machine', 'campus') <= FLOW_MAX && hostile.events.length === 2 && hostile.events.every((e) => e.until > e.start && e.until - e.start <= 2 * 180_000));
}


// ---- 11. Règles pures du commerce ----
{
  check('parseAmount : refuse négatif, décimal, exposant, hexadécimal, vide', ['-5', '2.5', '1e3', '0x10', '', '0', ' 5', '9999999999'].every((x) => parseAmount(x) === null) && parseAmount('50') === 50 && parseAmount(50 as unknown) === null);
  check('bustLoss : 25 % de l\'argent, jamais négatif ni supérieur au solde', bustLoss(1000) === 250 && bustLoss(0) === 0 && bustLoss(1) === 0 && bustLoss(-5) === 0 && bustLoss(NaN) === 0);
  check('rayMissDistance : devant / derrière / hors portée', rayMissDistance(0, 0, 0, -1, 0, -10, 45) === 0 && rayMissDistance(0, 0, 0, -1, 0, 10, 45) === null && rayMissDistance(0, 0, 0, -1, 0, -100, 45) === null && rayMissDistance(0, 0, 0, 0, 0, -5, 45) === null);
}

// ---- 12. Système serveur sur un vrai Sim (sans réseau, sans port) ----
async function serverSuite(): Promise<void> {
  const sim = await Sim.create();
  sim.log = () => {};
  sim.onAnnounce = () => {};
  sim.addPlayer('p1', 'Alice');
  sim.addPlayer('p2', 'Bob');
  const p1 = sim.players.get('p1')!, p2 = sim.players.get('p2')!;
  const city = getCity();
  const dealers = city.poisOf('dealer'), planques = city.poisOf('planque'), cams = city.poisOf('camera');
  const out: { to: string; ev: GameServerEvent }[] = [];
  const mk = () => {
    const bus = new GameBus();
    const systems = new Map<string, GameSystem>();
    const ctx: GameCtx = {
      sim, bus, city, mode: 'multi',
      sendTo: (to, ev) => out.push({ to, ev }), broadcast: (ev) => out.push({ to: '*', ev }),
      get: ((id: string) => systems.get(id)) as GameCtx['get'],
    };
    const eco = createEconomy(ctx) as EconomySystem;
    systems.set('economy', eco);
    return { bus, systems, eco };
  };
  const { bus, systems, eco } = mk();
  const crimes: string[] = [];
  const trades: unknown[] = [];
  bus.on('crime', (e) => crimes.push(e.kind));
  bus.on('trade', (e) => trades.push(e));
  eco.onJoin?.(p1); eco.onJoin?.(p2);
  const at = (p: SimPlayer, x: number, z: number) => sim.teleportPlayer(p, x, 1, z);
  const blank = (): PrivateState => ({ money: 0, bag: {}, bagCap: 0, stars: 0, starProgress: 0, district: 'campus', marks: [], medals: {}, unread: 0 });
  const view = (p: SimPlayer): PrivateState => { const o = blank(); eco.privateView!(p, o); return o; };
  // Le serveur ignore une 2e transaction du même joueur dans les 200 ms (double clic) : les tests laissent passer ~230 ms de temps simulé entre deux transactions.
  const pass = (steps = 14) => { for (let i = 0; i < steps; i++) sim.step(); };
  const isTrade = (raw: unknown) => !!raw && typeof raw === 'object' && (raw as { k?: unknown }).k === 'trade';
  const msg = (p: SimPlayer, raw: unknown) => { if (isTrade(raw)) pass(); const m = parseGameMsg(raw); if (m) eco.onMessage!(p, m); return m; };
  const direct = (p: SimPlayer, m: unknown) => { if (isTrade(m)) pass(); eco.onMessage!(p, m as GameClientMsg); }; // contourne parseGameMsg (défense en profondeur)
  const snap = () => JSON.stringify([eco.moneyOf(p1), [...eco.bagOf(p1)]]);
  const D = dealers[0]; // dealer_campus_0 : loin de toute caméra
  const D2 = dealers[2];
  at(p2, 0, 0);

  at(p1, 40, 40);
  let v = view(p1);
  check('départ : 200 €, sac vide, capacité 30, pas de boutique ni de planque au loin', v.money === START_MONEY && Object.keys(v.bag).length === 0 && v.bagCap === BAG_CAP && !v.shop && !v.stash);
  at(p1, D.x + 1, D.z + 1);
  v = view(p1);
  check('à moins de 3 m d\'un dealer : shop rempli (un prix par marchandise)', !!v.shop && v.shop.dealer === D.id && v.shop.goods.length === GOOD_IDS.length && v.shop.district === D.district);
  at(p1, D.x + 5, D.z);
  check('à 5 m : boutique fermée', !view(p1).shop);
  at(p1, D.x + 1, D.z);
  check('argent individuel : Bob a aussi 200 €', view(p2).money === START_MONEY && eco.moneyOf(p1) === START_MONEY);

  const cafe: GoodId = 'cafe_machine'; // poids 2
  const q0 = quoteLot(cafe, D.district, eco.market, sim.time, 'buy', 3);
  const toasts0 = out.length;
  msg(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 3, side: 'buy' });
  check('achat valide : argent débité au prix moyen du lot, sac crédité, événement trade, toast de confirmation', eco.moneyOf(p1) === START_MONEY - q0 * 3 && out.slice(toasts0).some((o) => o.to === 'p1' && o.ev.k === 'toast' && /Acheté 3/.test(o.ev.text)) && eco.bagOf(p1).get(cafe) === 3 && trades.length === 1);
  check('privateView reflète le sac', view(p1).bag[cafe] === 3);
  const before = snap();
  for (const bad of [0, -1, 1.5, NaN, Infinity, MAX_TRADE_QTY + 1, 1e9, '3', null, undefined, [1], {}]) direct(p1, { k: 'trade', dealer: D.id, good: cafe, qty: bad, side: 'buy' });
  direct(p1, { k: 'trade', dealer: D.id, good: 'bombe', qty: 1, side: 'buy' });
  direct(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 1, side: 'donne' });
  direct(p1, { k: 'trade', dealer: '__proto__', good: cafe, qty: 1, side: 'buy' });
  direct(p1, { k: 'trade', dealer: 'nimporte', good: cafe, qty: 1, side: 'buy' });
  check('quantités invalides, marchandise/côté/dealer inconnus : rien ne change', before === snap());
  check('parseGameMsg refuse qty fractionnaire / négatif / NaN', parseGameMsg({ k: 'trade', dealer: D.id, good: cafe, qty: 1.5, side: 'buy' }) === null && parseGameMsg({ k: 'trade', dealer: D.id, good: cafe, qty: -2, side: 'sell' }) === null && parseGameMsg({ k: 'trade', dealer: D.id, good: cafe, qty: NaN, side: 'buy' }) === null);
  msg(p1, { k: 'trade', dealer: D2.id, good: cafe, qty: 1, side: 'buy' });
  check('dealer trop loin : refusé', before === snap());
  at(p1, D.x + 6, D.z);
  msg(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 1, side: 'buy' });
  check('à 6 m du bon dealer : refusé', before === snap());
  at(p1, D.x + 1, D.z);

  eco.addMoney(p1, -eco.moneyOf(p1) + 10);
  const b2 = eco.bagOf(p1).get(cafe);
  msg(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 5, side: 'buy' });
  check('impossible d\'acheter à découvert (10 € pour 5 cafés)', eco.moneyOf(p1) === 10 && eco.bagOf(p1).get(cafe) === b2);
  check('l\'argent ne devient jamais négatif', eco.addMoney(p1, -1e12) === 0 && eco.moneyOf(p1) === 0);

  eco.addMoney(p1, 100000);
  for (let i = 0; i < 6; i++) msg(p1, { k: 'trade', dealer: D.id, good: 'fromage_clandestin', qty: 1, side: 'buy' });
  const vol = bagVolume(eco.bagOf(p1));
  check('sac plein : le volume ne dépasse jamais la capacité', vol <= BAG_CAP && vol >= BAG_CAP - 5, `volume ${vol}/${BAG_CAP}`);
  const money1 = eco.moneyOf(p1);
  msg(p1, { k: 'trade', dealer: D.id, good: 'fromage_clandestin', qty: 50, side: 'buy' });
  check('sac plein : achat refusé sans débit', eco.moneyOf(p1) === money1 && bagVolume(eco.bagOf(p1)) === vol);

  const own = eco.bagOf(p1).get('fromage_clandestin')!;
  msg(p1, { k: 'trade', dealer: D.id, good: 'fromage_clandestin', qty: own + 1, side: 'sell' });
  check('vente de plus que le stock : refusée', eco.moneyOf(p1) === money1 && eco.bagOf(p1).get('fromage_clandestin') === own);
  msg(p1, { k: 'trade', dealer: D.id, good: 'copies_blanches', qty: 1, side: 'sell' });
  check('vente d\'une marchandise absente : refusée', eco.moneyOf(p1) === money1);
  const qs = quoteLot('fromage_clandestin', D.district, eco.market, sim.time, 'sell', own);
  msg(p1, { k: 'trade', dealer: D.id, good: 'fromage_clandestin', qty: own, side: 'sell' });
  check('vente valide : crédit au prix moyen du lot', eco.moneyOf(p1) === money1 + qs * own && !eco.bagOf(p1).has('fromage_clandestin'));

  // planque
  const PL = planques[0];
  at(p1, 40, 40);
  const bagBefore = JSON.stringify([...eco.bagOf(p1)]);
  msg(p1, { k: 'stash', op: 'put', good: cafe, qty: 1 });
  check('planque trop loin : dépôt refusé', JSON.stringify([...eco.bagOf(p1)]) === bagBefore && eco.stashOf(p1).size === 0);
  at(p1, PL.x + 1, PL.z);
  check('près d\'une planque : privateView.stash présent, pas de boutique', view(p1).stash !== undefined && !view(p1).shop);
  msg(p1, { k: 'stash', op: 'put', good: cafe, qty: 2 });
  check('dépôt : sac -> planque', eco.stashOf(p1).get(cafe) === 2 && eco.bagOf(p1).get(cafe) === 1 && view(p1).stash![cafe] === 2);
  msg(p1, { k: 'stash', op: 'put', good: cafe, qty: 5 });
  msg(p1, { k: 'stash', op: 'take', good: cafe, qty: 3 });
  msg(p1, { k: 'stash', op: 'put', good: 'copies_blanches', qty: 1 });
  for (const bad of [0, -1, 0.5, NaN, 1e6]) direct(p1, { k: 'stash', op: 'take', good: cafe, qty: bad });
  check('planque : excès et quantités invalides refusés', eco.stashOf(p1).get(cafe) === 2 && eco.bagOf(p1).get(cafe) === 1);
  // sac presque plein puis retrait refusé
  at(p1, D.x + 1, D.z);
  for (let i = 0; i < 12; i++) msg(p1, { k: 'trade', dealer: D.id, good: 'balles_dorees', qty: 1, side: 'buy' });
  at(p1, PL.x + 1, PL.z);
  const full = bagVolume(eco.bagOf(p1));
  msg(p1, { k: 'stash', op: 'take', good: cafe, qty: 2 });
  check('retrait refusé si le sac n\'a pas la place', full + 4 > BAG_CAP ? eco.stashOf(p1).get(cafe) === 2 : true, `sac ${full}/${BAG_CAP}`);

  // sauvegarde / restauration
  eco.addMoney(p2, 123);
  const stashBefore = [...eco.stashOf(p1)], bagB = [...eco.bagOf(p1)], mA = eco.moneyOf(p1), mB = eco.moneyOf(p2);
  const saved = JSON.parse(JSON.stringify(eco.serialize!()));
  const second = mk();
  second.eco.restore!(saved);
  check('restauration : argent, sac et planque de chaque joueur', second.eco.moneyOf(p1) === mA && second.eco.moneyOf(p2) === mB && JSON.stringify([...second.eco.stashOf(p1)]) === JSON.stringify(stashBefore) && JSON.stringify([...second.eco.bagOf(p1)]) === JSON.stringify(bagB));
  check('restauration : marché identique', JSON.stringify(serializeMarket(second.eco.market)) === JSON.stringify(serializeMarket(eco.market)));
  check('la sauvegarde est un JSON pur sans Rapier', !/body|world|Rapier/i.test(JSON.stringify(saved)));
  const evil: unknown[] = [null, 5, 'x', [], {}, { accounts: 'x' },
    { accounts: [null, 5, ['__proto__', 1e99, [['cafe_machine', 5]], [], 1], ['constructor', 5], ['Eve', -50, [['cafe_machine', 1e9], ['zzz', 3], ['cafe_machine', -1], ['fromage_clandestin', 1.5]], 'x', 'y']], market: { events: [[1]] }, camsDown: ['x', 3, '__proto__'] },
    JSON.parse('{"accounts":[["__proto__",5,[],[],1],["Zed",null,[["cafe_machine",null]],[["copies_blanches",4]],-3]],"market":"x"}')];
  let okEvil = true;
  for (const e of evil) {
    const t = mk();
    try {
      t.eco.restore!(e);
      for (const p of [p1, p2]) { const m = t.eco.moneyOf(p); okEvil &&= Number.isInteger(m) && m >= 0 && bagVolume(t.eco.bagOf(p)) <= BAG_CAP && bagVolume(t.eco.stashOf(p)) <= STASH_CAP; }
      okEvil &&= ({} as Record<string, unknown>).polluted === undefined;
    } catch { okEvil = false; }
  }
  check('restore résiste aux données hostiles', okEvil);
  const np = mk();
  np.eco.restore!(JSON.parse('{"accounts":[["__proto__",999,[],[],1],["Eve",-50,[["cafe_machine",1e9]],[],1]]}'));
  const as = (name: string) => ({ ...p1, name }) as SimPlayer;
  check('restore : « __proto__ » ignoré, argent négatif et quantités folles bornés', np.eco.moneyOf(as('__proto__')) === START_MONEY && np.eco.moneyOf(as('Eve')) === 0 && bagVolume(np.eco.bagOf(as('Eve'))) === 0);
  {
    const t = mk();
    t.eco.market.events.push({ good: 'cafe_machine', district: 'campus', mult: 3, start: sim.time, until: sim.time + 100_000 });
    const t2 = mk();
    t2.eco.restore!(JSON.parse(JSON.stringify(t.eco.serialize!())));
    const e = t2.eco.market.events.find((x) => x.good === 'cafe_machine' && x.district === 'campus');
    check('événement de marché restauré avec sa durée restante', !!e && Math.abs(e.until - e.start - 100_000) < 1);
  }

  // /donner (la commande vise le dernier système créé pour ce Sim : on en crée un dédié)
  const dn = mk();
  const replies: string[] = [];
  const say = (p: SimPlayer, line: string) => { replies.length = 0; runCommand(sim, p, line, (t) => replies.push(t)); return replies.join(' | '); };
  dn.eco.addMoney(p1, -dn.eco.moneyOf(p1) + 100);
  const bobBefore = dn.eco.moneyOf(p2);
  const b1 = [dn.eco.moneyOf(p1), dn.eco.moneyOf(p2)];
  for (const l of ['/donner', '/donner Bob', '/donner Bob -5', '/donner Bob 2.5', '/donner Bob 1e3', '/donner Bob 0', '/donner Bob abc', '/donner Bob 101', '/donner Bob 99999999999', '/donner Alice 5', '/donner Zorglub 5', '/donner Bob 5 6']) say(p1, l);
  check('/donner invalide (montant, découvert, soi-même, inconnu) : rien ne bouge', dn.eco.moneyOf(p1) === b1[0] && dn.eco.moneyOf(p2) === b1[1]);
  const r = say(p1, '/donner bo 40');
  check('/donner valide : transfert exact et receveur prévenu', dn.eco.moneyOf(p1) === 60 && dn.eco.moneyOf(p2) === bobBefore + 40 && /40/.test(r) && out.some((o) => o.to === 'p2' && o.ev.k === 'toast' && /40/.test(o.ev.text)), r);

  eco.addMoney(p1, -eco.moneyOf(p1) + 60);
  bus.emit('debug', { p: p1, what: 'money', arg: '500' });
  check('/debug money 500 : +500 €', eco.moneyOf(p1) === 560);
  bus.emit('debug', { p: p1, what: 'money', arg: 'abc' });
  bus.emit('debug', { p: p1, what: 'stars', arg: '3' });
  check('/debug invalide ou autre sujet : ignoré', eco.moneyOf(p1) === 560);

  // arrestation
  at(p1, D.x + 1, D.z);
  msg(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 2, side: 'buy' });
  const mm = eco.moneyOf(p1), hadBag = eco.bagOf(p1).size > 0;
  bus.emit('playerBusted', { p: p1 });
  check('arrestation : sac perdu et 25 % de l\'argent', hadBag && eco.bagOf(p1).size === 0 && eco.moneyOf(p1) === mm - Math.floor(mm * 0.25));
  pass(120); // l'arrestation gèle les transactions 1,5 s : on laisse passer ce délai pour la suite

  // caméras
  const fakePeds = { id: 'peds', peds: [] as { kind: string; x: number; z: number; gone?: boolean }[] };
  systems.set('peds', fakePeds as unknown as GameSystem);
  crimes.length = 0;
  const camDownEvents: string[] = [];
  bus.on('cameraDestroyed', (e) => camDownEvents.push(e.id));
  const m0 = out.length;
  for (const c of cams) bus.emit('crime', { kind: 'explosion', by: p2, x: c.x + 3, z: c.z });
  check('toutes les caméras détruites par explosion : cameraDestroyed + diffusion monde', camDownEvents.length === cams.length && eco.camerasDown() === cams.length && out.slice(m0).some((o) => o.to === '*' && o.ev.k === 'monde' && o.ev.camsDown === cams.length));
  check('chaque destruction produit un crime camera_detruite', crimes.filter((c) => c === 'camera_detruite').length === cams.length);
  check('marché : 0 caméra intacte partout', DISTRICT_IDS.every((d) => eco.market.camsUp[d] === 0 && eco.market.camsTotal[d] === 3));
  bus.emit('crime', { kind: 'explosion', by: p2, x: cams[0].x, z: cams[0].z });
  check('une caméra déjà détruite ne l\'est pas deux fois', camDownEvents.length === cams.length);

  // deal_vu
  eco.addMoney(p1, 1000);
  at(p1, D.x + 1, D.z);
  crimes.length = 0;
  const buy1 = () => msg(p1, { k: 'trade', dealer: D.id, good: cafe, qty: 1, side: 'buy' });
  const seenCount = () => crimes.filter((c) => c === 'deal_vu').length;
  buy1();
  check('échange sans témoin : pas de deal_vu', seenCount() === 0);
  fakePeds.peds.push({ kind: 'flic', x: D.x + 30, z: D.z, gone: false });
  buy1();
  check('flic à 30 m : deal_vu', seenCount() === 1);
  fakePeds.peds[0].x = D.x + 40;
  buy1();
  check('flic à 40 m : pas de deal_vu', seenCount() === 1);
  fakePeds.peds[0] = { kind: 'passant', x: D.x + 5, z: D.z, gone: false };
  buy1();
  check('un passant ne compte pas', seenCount() === 1);

  {
    const t = mk();
    const c2: string[] = [];
    t.bus.on('crime', (e) => c2.push(e.kind));
    const DV = dealers.find((d) => d.id === 'dealer_vieux_bourg_1')!;
    const cam = cams.map((c) => ({ c, d: Math.hypot(c.x - DV.x, c.z - DV.z) })).sort((a, b) => a.d - b.d)[0];
    t.eco.addMoney(p1, 1000);
    at(p1, DV.x + 1, DV.z);
    t.eco.onMessage!(p1, parseGameMsg({ k: 'trade', dealer: DV.id, good: cafe, qty: 1, side: 'buy' })!);
    check(`caméra intacte à ${cam.d.toFixed(0)} m : deal_vu`, cam.d < 25 && c2.includes('deal_vu'));
    const camPos = { x: cam.c.x, z: cam.c.z };
    at(p1, camPos.x - 12, camPos.z);
    p1.input = { ...p1.input, ad: [1, 0, 0] };
    t.bus.emit('crime', { kind: 'tir', by: p1, x: camPos.x - 12, z: camPos.z });
    check('tir dans l\'axe : la caméra est détruite', t.eco.camerasDown() >= 1);
    const n0 = t.eco.camerasDown();
    const other = cams.find((c) => c.id !== cam.c.id && Math.hypot(c.x - camPos.x, c.z - camPos.z) > 60)!;
    at(p1, other.x - 12, other.z + 20);
    t.bus.emit('crime', { kind: 'tir', by: p1, x: other.x - 12, z: other.z + 20 });
    check('tir à 20 m de travers : caméra intacte', t.eco.camerasDown() === n0);
    p1.input = { ...p1.input, ad: [NaN, 0, NaN] };
    t.bus.emit('crime', { kind: 'tir', by: p1, x: other.x, z: other.z });
    check('tir avec direction NaN : ignoré', t.eco.camerasDown() === n0);
  }

  // caméras détruites -> probabilité de tuyau
  {
    const d: DistrictId = 'campus';
    const intact = newMarketState();
    setCameras(intact, d, 3, 3);
    const down = eco.market;
    check('caméras intactes : proba /2 ; détruites : proba pleine', tipSendProbability(intact, d) === TIP_SEND_PROB / 2 && tipSendProbability(down, d) === TIP_SEND_PROB);
    const sample = (st: ReturnType<typeof newMarketState>, seed: number) => {
      const rr = makeRng(seed);
      let ev = 0, sm = 0;
      for (let i = 0; i < 20_000; i++) {
        const s2 = newMarketState();
        for (const x of DISTRICT_IDS) setCameras(s2, x, st.camsUp[x], st.camsTotal[x]);
        s2.nextRollAt = 0;
        const t = rollTip(s2, 0, rr);
        if (s2.events.length) { ev++; if (t) sm++; }
      }
      return sm / ev;
    };
    const rHi = sample(intact, 77), rLo = sample(down, 78);
    check('statistique : caméras détruites -> environ 2 fois plus de SMS', rLo / rHi > 1.8 && rLo / rHi < 2.2, `${rHi.toFixed(3)} -> ${rLo.toFixed(3)}`);
  }

  // SMS
  {
    const t = mk();
    t.eco.setRng(makeRng(5));
    const start = out.length;
    for (let i = 0; i < 600 && !out.slice(start).some((o) => o.ev.k === 'sms'); i++) {
      t.eco.market.events.length = 0;
      t.eco.market.nextRollAt = 0;
      for (let k = 0; k < 10; k++) t.eco.postStep!();
    }
    const sms = out.slice(start).filter((o) => o.ev.k === 'sms');
    const dests = new Set(sms.map((o) => o.to));
    check('tuyau : SMS envoyé à chaque joueur (id, date, tip)', dests.has('p1') && dests.has('p2') && sms.every((o) => o.ev.k === 'sms' && o.ev.sms.id >= 1 && Number.isFinite(o.ev.sms.at) && !!o.ev.sms.tip));
    const o = blank();
    t.eco.privateView!(p1, o);
    const n = o.unread;
    const first = sms.find((x) => x.to === 'p1')!.ev as Extract<GameServerEvent, { k: 'sms' }>;
    t.eco.onMessage!(p1, { k: 'sms_lu', id: first.sms.id });
    t.eco.privateView!(p1, o);
    check('unread compte les SMS, sms_lu le décrémente', n >= 1 && o.unread === n - 1);
    const ev0 = t.eco.market.events.length;
    advanceMarket(t.eco.market, sim.time + 10 * 60_000, makeRng(1));
    check('les événements créés expirent', ev0 >= 1 && t.eco.market.events.length === 0);
  }
  {
    const t = mk();
    for (let i = 0; i < 6000; i++) t.eco.postStep!();
    let ok = true;
    for (const e of Object.values(t.eco.market.noise)) ok &&= e >= NOISE_MIN && e <= NOISE_MAX;
    check('6000 ticks de postStep : marché valide', ok);
  }
  // ---- Cas limites ----
  {
    const t = mk();
    const e = t.eco;
    const tradeMsg = (p: SimPlayer, qty = 1, side: 'buy' | 'sell' = 'buy', good: GoodId = cafe) => { const m = parseGameMsg({ k: 'trade', dealer: D.id, good, qty, side }); if (m) e.onMessage!(p, m); };
    at(p1, D.x + 1, D.z);
    pass(30);
    // double clic : une seule transaction dans les 200 ms, la suivante passe après
    tradeMsg(p1); tradeMsg(p1);
    check('double clic : la 2e transaction du même instant est ignorée', e.bagOf(p1).get(cafe) === 1);
    pass(14); tradeMsg(p1);
    check('après 200 ms une nouvelle transaction passe', e.bagOf(p1).get(cafe) === 2);
    // arrestation : transactions gelées 1,5 s même si le joueur est encore devant le dealer (message déjà en vol)
    const mBefore = e.moneyOf(p1);
    t.bus.emit('playerBusted', { p: p1 });
    const mBusted = e.moneyOf(p1);
    pass(14); tradeMsg(p1);
    check('arrestation : le sac est vidé et une transaction envoyée juste après est refusée', e.bagOf(p1).size === 0 && e.moneyOf(p1) === mBusted && mBusted === mBefore - Math.floor(mBefore * 0.25));
    pass(90); tradeMsg(p1);
    check('arrestation : le gel (1,5 s) n\'est pas définitif', e.bagOf(p1).get(cafe) === 1);
    // mort : même protection, et hp <= 0 refuse aussi la planque
    t.bus.emit('playerDied', { p: p1, by: null, cause: 'test' });
    pass(14); tradeMsg(p1);
    check('mort : transaction refusée juste après', e.bagOf(p1).get(cafe) === 1);
    pass(120);
    const hp0 = p1.hp;
    p1.hp = 0; pass(14); tradeMsg(p1);
    check('joueur à 0 pv : transaction refusée', e.bagOf(p1).get(cafe) === 1);
    p1.hp = hp0;
    // pendant une arrestation en cours, le client peut envoyer n'importe quoi : un dealer inexistant ou un joueur sans compte ne crée rien
    const ghost = { ...p2, id: 'zzz', name: 'Fantome' } as SimPlayer;
    const nAcc = e.accountNames().length;
    e.onMessage!(ghost, { k: 'trade', dealer: D.id, good: cafe, qty: 1, side: 'buy' });
    e.onMessage!(ghost, { k: 'stash', op: 'put', good: cafe, qty: 1 });
    e.onMessage!(ghost, { k: 'sms_lu', id: 1 });
    check('message d\'un joueur absent du jeu : ignoré, aucun compte créé', e.accountNames().length === nAcc && !e.accountNames().includes('Fantome'));
  }
  {
    // déconnexion pendant la boutique : le compte reste (clé = pseudo), les messages en vol sont ignorés, le retour retrouve argent et sac
    const t = mk();
    const e = t.eco;
    sim.addPlayer('p3', 'Carl');
    const p3 = sim.players.get('p3')!;
    e.onJoin!(p3);
    at(p3, D.x + 1, D.z);
    pass(14);
    const buy3 = () => { const m = parseGameMsg({ k: 'trade', dealer: D.id, good: cafe, qty: 2, side: 'buy' }); if (m) e.onMessage!(p3, m); };
    buy3();
    const moneyCarl = e.moneyOf(p3), bagCarl = JSON.stringify([...e.bagOf(p3)]);
    check('Carl a acheté 2 cafés', e.bagOf(p3).get(cafe) === 2 && moneyCarl < START_MONEY);
    e.onLeave!(p3);
    sim.removePlayer('p3');
    pass(14); buy3();
    check('déconnexion pendant la boutique : le message en vol d\'un joueur parti est ignoré', e.moneyOf(p3) === moneyCarl && JSON.stringify([...e.bagOf(p3)]) === bagCarl);
    check('le compte d\'un joueur parti est conservé', e.accountNames().includes('Carl'));
    // /donner vers un joueur déconnecté
    const r1 = say(p1, '/donner Carl 5');
    check('/donner vers un joueur déconnecté : refusé avec un message clair, rien ne bouge', /hors ligne/.test(r1) && e.moneyOf(p3) === moneyCarl, r1);
    const r1b = say(p1, '/donner Alice 5');
    check('/donner à soi-même : refusé', /soi-même/.test(r1b), r1b);
    // retour du joueur : retrouve ses affaires
    sim.addPlayer('p3', 'Carl');
    const p3b = sim.players.get('p3')!;
    e.onJoin!(p3b);
    check('retour du joueur : argent et sac retrouvés', e.moneyOf(p3b) === moneyCarl && JSON.stringify([...e.bagOf(p3b)]) === bagCarl);
    e.onLeave!(p3b);
    sim.removePlayer('p3');
  }
  {
    // restauration d'une sauvegarde corrompue : atomique, ne casse rien
    const t = mk();
    const e = t.eco;
    e.addMoney(p1, 77);
    t.bus.emit('crime', { kind: 'explosion', by: p2, x: cams[0].x, z: cams[0].z });
    const state = () => JSON.stringify([...e.accountNames().map((n) => [n, e.moneyOf({ ...p1, name: n } as SimPlayer)]), e.camerasDown(), JSON.stringify(serializeMarket(e.market).events)]);
    const s0 = state();
    const bads: unknown[] = ['{"accounts"', 5, null, true, [], [[]], { accounts: 'x' }, { accounts: 5, camsDown: 7 }, { camsDown: 'x' },
      { get accounts(): unknown { throw new Error('boum'); } }, { accounts: [{ get length(): number { throw new Error('boum'); } }] }];
    let threw = false;
    for (const b of bads) { try { e.restore!(b); } catch { threw = true; } }
    check('sauvegarde corrompue (types inattendus, getters qui jettent) : ne jette jamais et ne modifie rien', !threw && state() === s0);
    const before = e.camerasDown();
    e.restore!({ accounts: [['Zed', 5, [], [], 1]] });
    check('sauvegarde partielle : seuls les comptes sont remplacés, caméras et marché conservés', e.camerasDown() === before && e.accountNames().join() === 'Zed');
    e.restore!({ market: { events: [['cafe_machine', 'campus', 3, 5, 1], ['cafe_machine', 'campus', 3, 0, 1e15]], flow: [['cafe_machine', 'campus', 1e99]] } });
    check('marché corrompu : événements invalides ignorés, flux borné', e.market.events.length === 1 && e.market.events.every((v) => v.until > v.start) && flowOf(e.market, 'cafe_machine', 'campus') <= FLOW_MAX);
    const t2 = mk();
    t2.eco.restore!(JSON.parse('{"accounts":[["Zed",5,[],[],1],["Zed",999999,[],[],1]]}'));
    check('doublon de pseudo dans la sauvegarde : le premier gagne', t2.eco.moneyOf({ ...p1, name: 'Zed' } as SimPlayer) === 5);
  }
  {
    // flux sauvegardé / restauré avec le temps relatif
    const t = mk();
    applyTrade(t.eco.market, 'cafe_machine', 'campus', 'buy', 6);
    t.eco.market.flowAt = sim.time;
    const t2 = mk();
    t2.eco.restore!(JSON.parse(JSON.stringify(t.eco.serialize!())));
    check('flux Φ restauré avec la sauvegarde', Math.abs(flowOf(t2.eco.market, 'cafe_machine', 'campus') - flowOf(t.eco.market, 'cafe_machine', 'campus')) < 1e-9);
  }
  {
    // budget réseau : repères et boutique
    const t = mk();
    const e = t.eco;
    const viewOf = (p: SimPlayer) => { const o = blank(); e.privateView!(p, o); return o; };
    at(p1, 0, 0);
    const v0 = viewOf(p1);
    const dist = (m: { x: number; z: number }) => Math.hypot(m.x, m.z);
    check('repères : au plus 4, dealers/planques, du plus proche au plus lointain', v0.marks.length <= 4 && v0.marks.every((m) => m.k === 'dealer' || m.k === 'planque') && v0.marks.every((m, i) => i === 0 || dist(v0.marks[i - 1]) <= dist(m) + 1e-6));
    at(p1, PL.x + 1, PL.z);
    check('repères : à la planque, la plus proche est la première', viewOf(p1).marks.length >= 1);
    at(p1, D.x + 1, D.z);
    const v1 = viewOf(p1);
    v1.stars = 5; v1.starProgress = 0.5; v1.medals = { m1: 'or', m2: 'argent' } as PrivateState['medals']; v1.unread = 12;
    check('boutique ouverte : pas de repères superflus et `me` reste largement sous 1 Ko', v1.marks.length === 0 && Buffer.byteLength(JSON.stringify(v1)) < 800, `${Buffer.byteLength(JSON.stringify(v1))} o`);
    at(p1, 40, 40);
    const v2 = viewOf(p1);
    check('à pied en ville : `me` (repères inclus) < 500 o avec l\'économie seule', Buffer.byteLength(JSON.stringify(v2)) < 500, `${Buffer.byteLength(JSON.stringify(v2))} o`);
  }

  at(p1, D.x + 1, D.z);
  const nearOk = eco.onInteract!(p1) === true;
  at(p1, 40, 40);
  check('onInteract : traité près d\'un dealer, ignoré au loin', nearOk && eco.onInteract!(p1) === false);
}

serverSuite().then(() => {
  console.log(fails === 0 ? '\neconomie : TOUT VERT' : `\neconomie : ${fails} échec(s)`);
  process.exit(fails === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
