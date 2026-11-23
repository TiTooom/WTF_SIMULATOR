// Suite « economie » : logique pure de shared/economy (prix, événements, tuyaux, caméras, sérialisation). Aucun serveur, aucun port.
// Lancement : npx tsx tests/economie.ts
import { DISTRICT_IDS, GANG_IDS, GOOD_IDS, type GoodId } from '../shared/ids';
import { GOODS } from '../shared/economy/goods';
import { GANGS, territoryMult, GANG_OF_DISTRICT } from '../shared/economy/gangs';
import {
  advanceMarket, applyTrade, camsIntactRatio, createEvent, eventMult, makeRng, newMarketState, parseMarket, quote, rollTip, serializeMarket, setCameras,
  tipSendProbability, unitPrice, MAX_PRICE_FACTOR, NOISE_MAX, NOISE_MIN, NOISE_PERIOD_MS, TIP_SEND_PROB,
} from '../shared/economy/prices';
import { tipOf, tipText } from '../shared/economy/tips';

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
  lo.police.golfeurs = 0;
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

// ---- 9. Pas d'argent gratuit ----
{
  const rnd = makeRng(2024);
  let worst = Infinity, ok = true;
  for (let i = 0; i < 20_000; i++) {
    const s = newMarketState();
    advanceMarket(s, NOISE_PERIOD_MS, rnd); // ε aléatoire
    for (const d of DISTRICT_IDS) s.police[d] = rnd();
    const g = pick(GOOD_IDS, rnd), d = pick(DISTRICT_IDS, rnd);
    const qty = 1 + Math.floor(rnd() * 40);
    const t0 = quote(g, d, s, 0);
    // achat de qty, impact, puis recalcul des ε (pire cas pour nous : ε passe au maximum) puis revente
    applyTrade(s, g, d, 'buy', qty);
    const same = quote(g, d, s, 0);
    ok &&= same.sell < t0.buy; // revente immédiate dans le même quartier
    s.noise[`${g}:${d}`] = NOISE_MAX; // pire cas : ε monte au plafond
    s.noise[`${g}:${d}`] = Math.max(s.noise[`${g}:${d}`], NOISE_MIN);
    // l'achat initial était fait avec ε d'origine ; le pire est ε0 = 0,92 : on vérifie ce cas extrême
    const lowBuy = (() => { const z = newMarketState(); z.police[d] = s.police[d]; z.noise[`${g}:${d}`] = NOISE_MIN; return quote(g, d, z, 0).buy; })();
    const highSell = quote(g, d, s, 0).sell;
    worst = Math.min(worst, lowBuy - highSell);
    ok &&= highSell < lowBuy;
    // et la vente fait baisser le prix
    const b = quote(g, d, s, 0).sell;
    applyTrade(s, g, d, 'sell', qty);
    ok &&= quote(g, d, s, 0).sell <= b;
  }
  check('aller-retour achat/revente : jamais de gain (même ε 0,92 -> 1,08)', ok, `marge pire cas ${worst}`);
}

// ---- 10. Sérialisation ----
{
  const rnd = makeRng(8);
  const s = newMarketState();
  for (let t = 0; t < 300_000; t += 1000) { advanceMarket(s, t, rnd); rollTip(s, t, rnd); }
  setCameras(s, 'docks', 1, 3);
  s.police.campus = 0.77;
  applyTrade(s, 'cafe_machine', 'campus', 'buy', 7);
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
}

console.log(fails === 0 ? '\neconomie : TOUT VERT' : `\neconomie : ${fails} échec(s)`);
process.exit(fails === 0 ? 0 : 1);
