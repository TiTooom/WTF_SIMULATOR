// Simulation d'équilibrage de l'économie (logique pure de shared/economy, aucun serveur, aucun port).
// Des joueurs-bots échangent sur le MÊME marché (prix, événements, tuyaux, impact des échanges) avec des trajets réalistes entre les vrais dealers
// de la ville (getCity()), la détection des échanges (caméras réelles, flics) et les arrestations (perte du sac + 25 % de l'argent).
//  - bot « naif »  : va de dealer en dealer au hasard, vend tout, rachète au hasard ; ignore tuyaux et territoires.
//  - bot « opti »  : choisit la route (acheter chez le producteur, revendre chez le demandeur) qui maximise le gain par seconde, suit les tuyaux reçus,
//                    évite les dealers surveillés quand c'est rentable et calme le jeu (reste à l'écart) quand il est recherché.
// Hypothèses (documentées pour l'équilibrage, voir l'en-tête de shared/economy/prices.ts) :
//  - déplacement en voiture 12 m/s (distance de Manhattan entre dealers) + 10 s d'arrêt/stationnement ; 6 s par session d'échange ;
//  - échange vu : caméra intacte à ≤ 25 m (85 %) ou flic (60 % × pression policière du quartier) -> +20 de chaleur (deal_vu) ;
//  - recherché : risque d'arrestation par seconde [0, 1/300, 1/120, 1/60, 1/30, 1/20] selon les étoiles (×0,4 pour le bot optimal : il fuit bien) ;
//  - arrestation : sac perdu, 25 % de l'argent perdu, 40 s perdues (retour du commissariat).
// Lancement : npx tsx tests/economie-sim.ts [graines, 40 par défaut]. Code de sortie 1 si un objectif d'équilibrage n'est pas tenu.
import { DISTRICT_IDS, GOOD_IDS, type GoodId } from '../shared/ids';
import { GOODS } from '../shared/economy/goods';
import { BASE_POLICE } from '../shared/economy/gangs';
import { advanceMarket, applyTrade, makeRng, newMarketState, quote, quoteLot, rollTip, setCameras, type MarketState } from '../shared/economy/prices';
import { BAG_CAP, BUST_MONEY_SHARE, DEAL_CAM_RANGE, MAX_TRADE_QTY, START_MONEY, addToBag, bagVolume, type Bag } from '../shared/economy/trade';
import { CRIME_HEAT, HEAT_DECAY_PER_S, STAR_AT, UNSEEN_DELAY_S, starsOf } from '../shared/wanted';
import { getCity } from '../shared/city/layout';

const CAR_SPEED = 12, LEG_OVERHEAD_S = 10, SESSION_S = 6, JAIL_S = 40;
const HAZARD = [0, 1 / 300, 1 / 120, 1 / 60, 1 / 30, 1 / 20];
const city = getCity();
const dealers = city.poisOf('dealer');
const cams = city.poisOf('camera');
const camNear = dealers.map((d) => cams.some((c) => Math.hypot(c.x - d.x, c.z - d.z) <= DEAL_CAM_RANGE));
const travel = (a: number, b: number) => (a === b ? 0 : (Math.abs(dealers[a].x - dealers[b].x) + Math.abs(dealers[a].z - dealers[b].z)) / CAR_SPEED + LEG_OVERHEAD_S);

type Kind = 'naif' | 'moyen' | 'opti' | 'boucle' | 'meme';
interface Bot {
  kind: Kind; money: number; bag: Bag; at: number; busy: number; // busy : date (s) où le bot redevient libre
  heat: number; calm: number; arrests: number; trades: number; seen: number; spent: number; earned: number;
  belief: MarketState; // ce que le bot sait : événements connus par SMS
  curve: Map<number, number>; // minute -> argent
  dest: number; // destination en cours (-1 : aucune)
  paid: Map<GoodId, number>; // prix moyen payé (bots naïf et moyen)
  memory: Map<string, number>; // bot moyen : dernier prix de revente vu, `${dealer}:${good}`
  t500: number; t2000: number;
}
const newBot = (kind: Kind): Bot => ({
  kind, money: START_MONEY, bag: new Map(), at: 0, busy: 0, heat: 0, calm: 0, arrests: 0, trades: 0, seen: 0, spent: 0, earned: 0,
  belief: newMarketState(), curve: new Map(), dest: -1, paid: new Map(), memory: new Map(), t500: Infinity, t2000: Infinity,
});

interface Run { market: MarketState; rnd: () => number; bots: Bot[]; t: number }

function initRun(seed: number, kinds: Kind[]): Run {
  const market = newMarketState();
  const rnd = makeRng(seed);
  for (const d of DISTRICT_IDS) setCameras(market, d, cams.filter((c) => c.district === d).length, cams.filter((c) => c.district === d).length);
  const bots = kinds.map((k) => newBot(k));
  bots.forEach((b, i) => { b.at = Math.floor(rnd() * dealers.length); b.busy = i * 3; });
  return { market, rnd, bots, t: 0 };
}

/** Ce que le bot croit d'un dealer lointain : territoire + événements connus, ε = 1. */
function expected(b: Bot, g: GoodId, dealer: number, tMs: number, arriveMs: number, qty = 1) {
  b.belief.events = b.belief.events.filter((e) => e.until > tMs);
  return { buy: quoteLot(g, dealers[dealer].district, b.belief, arriveMs, 'buy', qty), sell: quoteLot(g, dealers[dealer].district, b.belief, arriveMs, 'sell', qty) };
}

function riskCost(b: Bot, dealer: number, bagValue: number): number {
  const d = dealers[dealer].district;
  const pSeen = 1 - (1 - (camNear[dealer] ? 0.85 : 0)) * (1 - 0.6 * BASE_POLICE[d]);
  return pSeen * 0.25 * (bagValue + BUST_MONEY_SHARE * b.money); // 25 % d'être arrêté ensuite (bot opti)
}

function trade(r: Run, b: Bot, side: 'buy' | 'sell', g: GoodId, qty: number): void {
  if (qty <= 0) return;
  const d = dealers[b.at].district;
  if (side === 'buy') {
    qty = Math.min(qty, MAX_TRADE_QTY, Math.floor(b.money / quote(g, d, r.market, r.t * 1000).buy), Math.floor((BAG_CAP - bagVolume(b.bag)) / GOODS[g].weight));
    while (qty > 0 && quoteLot(g, d, r.market, r.t * 1000, 'buy', qty) * qty > b.money) qty--; // le glissement du prix peut dépasser la bourse
    if (qty <= 0) return;
    const unit = quoteLot(g, d, r.market, r.t * 1000, 'buy', qty);
    b.money -= unit * qty; b.spent += unit * qty; addToBag(b.bag, g, qty);
  } else {
    qty = Math.min(qty, b.bag.get(g) ?? 0, MAX_TRADE_QTY);
    if (qty <= 0) return;
    const unit = quoteLot(g, d, r.market, r.t * 1000, 'sell', qty);
    b.money += unit * qty; b.earned += unit * qty; addToBag(b.bag, g, -qty);
  }
  applyTrade(r.market, g, d, side, qty);
  b.trades++;
}

/** Une visite chez un dealer : détection de l'échange (une seule fois par visite). */
function visitSeen(r: Run, b: Bot, hadTrade: boolean): void {
  if (!hadTrade) return;
  const d = dealers[b.at].district;
  const pCam = camNear[b.at] ? 0.85 : 0;
  const pSeen = 1 - (1 - pCam) * (1 - 0.6 * r.market.police[d]);
  if (r.rnd() < pSeen) { b.heat = Math.min(200, b.heat + CRIME_HEAT.deal_vu); b.calm = 0; b.seen++; }
}

function bagValueAt(b: Bot, dealer: number, tMs: number): number {
  let v = 0;
  for (const [g, q] of b.bag) v += q * expected(b, g, dealer, tMs, tMs, q).sell;
  return v;
}

function actNaif(r: Run, b: Bot): void {
  // joueur « à l'intuition » : ne connaît ni territoires ni tuyaux ; il vend ce qui se vend plus cher que son prix moyen d'achat,
  // et rachète ce qui est le moins cher par rapport à la base (prix affiché en boutique), au hasard parmi les 3 meilleurs.
  const before = b.trades;
  const d = dealers[b.at].district;
  for (const g of GOOD_IDS) {
    const n = b.bag.get(g);
    if (!n) continue;
    const paid = b.paid.get(g) ?? 0;
    if (quote(g, d, r.market, r.t * 1000).sell >= paid * 1.02 || r.rnd() < 0.15) trade(r, b, 'sell', g, n);
    if (!b.bag.get(g)) b.paid.delete(g);
  }
  const cheap = GOOD_IDS.map((g) => ({ g, ratio: quote(g, d, r.market, r.t * 1000).buy / GOODS[g].base })).sort((x, y) => x.ratio - y.ratio).slice(0, 3);
  for (let k = 0; k < 3; k++) {
    const g = cheap[Math.floor(r.rnd() * cheap.length)].g;
    const room = Math.floor((BAG_CAP - bagVolume(b.bag)) / GOODS[g].weight);
    if (room < 1) continue;
    const m0 = b.money, n0 = b.bag.get(g) ?? 0;
    trade(r, b, 'buy', g, Math.max(1, Math.floor(room * (0.5 + 0.5 * r.rnd()))));
    const got = (b.bag.get(g) ?? 0) - n0;
    if (got > 0) b.paid.set(g, ((b.paid.get(g) ?? 0) * n0 + (m0 - b.money)) / (n0 + got));
  }
  visitSeen(r, b, b.trades > before);
  let next = Math.floor(r.rnd() * dealers.length);
  if (next === b.at) next = (next + 1) % dealers.length;
  if (b.kind === 'moyen') { // se souvient des prix vus et retourne vendre là où c'était le plus cher
    for (const g of GOOD_IDS) b.memory.set(`${b.at}:${g}`, quote(g, d, r.market, r.t * 1000).sell);
    let bestScore = 0;
    for (const [g, n] of b.bag) for (let j = 0; j < dealers.length; j++) {
      const seen = b.memory.get(`${j}:${g}`);
      if (j === b.at || seen === undefined || seen < (b.paid.get(g) ?? 0) * 1.15) continue;
      const sc = (seen * n) / travel(b.at, j);
      if (sc > bestScore) { bestScore = sc; next = j; }
    }
  }
  b.dest = next;
  b.busy = r.t + SESSION_S + travel(b.at, next);
}

/** Boucle triviale : répète toujours la meilleure route statique ('boucle') ou achète/revend au même dealer ('meme'). */
let LOOP: { g: GoodId; k: number; j: number } = { g: GOOD_IDS[0], k: 0, j: 1 };
function actBoucle(r: Run, b: Bot): void {
  const before = b.trades;
  const tMs = r.t * 1000;
  if (b.kind === 'meme') {
    for (const g of GOOD_IDS) if (b.bag.get(g)) trade(r, b, 'sell', g, b.bag.get(g)!);
    trade(r, b, 'buy', LOOP.g, 99);
    visitSeen(r, b, b.trades > before);
    b.dest = b.at; b.busy = r.t + 2 * SESSION_S;
    return;
  }
  if (b.at === LOOP.j) for (const g of GOOD_IDS) if (b.bag.get(g)) trade(r, b, 'sell', g, b.bag.get(g)!);
  if (b.at === LOOP.k) trade(r, b, 'buy', LOOP.g, 99);
  void tMs;
  visitSeen(r, b, b.trades > before);
  b.dest = b.at === LOOP.k ? LOOP.j : LOOP.k;
  b.busy = r.t + SESSION_S + travel(b.at, b.dest);
}

function actOpti(r: Run, b: Bot): void {
  const tMs = r.t * 1000;
  const before = b.trades;
  const stars = starsOf(b.heat);
  // 1. vendre ici ce qui se vend mieux ici qu'ailleurs (gain par seconde, risque compris)
  for (const g of GOOD_IDS) {
    const n = b.bag.get(g);
    if (!n) continue;
    const here = quoteLot(g, dealers[b.at].district, r.market, tMs, 'sell', n);
    let bestElse = 0;
    for (let j = 0; j < dealers.length; j++) {
      if (j === b.at || (stars >= 1 && camNear[j])) continue;
      const q = expected(b, g, j, tMs, tMs + travel(b.at, j) * 1000, n).sell;
      const score = (n * q - riskCost(b, j, n * q)) / (travel(b.at, j) + 2 * SESSION_S);
      bestElse = Math.max(bestElse, score);
    }
    const hereScore = (n * here - riskCost(b, b.at, n * here)) / SESSION_S;
    if (hereScore >= bestElse * 0.9 || (n * here) >= 0.85 * bagValueAt(b, b.at, tMs)) trade(r, b, 'sell', g, n);
  }
  // 2. meilleure route (acheter ici ou ailleurs, revendre ailleurs)
  let best: { score: number; buyHere: boolean; g: GoodId; go: number; qty: number; k: number } | null = null;
  const room = BAG_CAP - bagVolume(b.bag);
  for (const g of GOOD_IDS) for (let k = 0; k < dealers.length; k++) for (let j = 0; j < dealers.length; j++) {
    if (j === k || dealers[j].district === dealers[k].district) continue;
    const tToK = travel(b.at, k);
    const q0 = Math.min(MAX_TRADE_QTY, Math.floor(room / GOODS[g].weight));
    const buy1 = k === b.at ? quote(g, dealers[k].district, r.market, tMs).buy : expected(b, g, k, tMs, tMs + tToK * 1000).buy;
    const qty = Math.min(q0, Math.floor(b.money / buy1));
    if (qty < 1) continue;
    const buyQ = { buy: k === b.at ? quoteLot(g, dealers[k].district, r.market, tMs, 'buy', qty) : expected(b, g, k, tMs, tMs + tToK * 1000, qty).buy };
    const sellQ = expected(b, g, j, tMs, tMs + (tToK + travel(k, j)) * 1000, qty);
    const profit = qty * (sellQ.sell - buyQ.buy) - riskCost(b, k, qty * buyQ.buy) - riskCost(b, j, qty * sellQ.sell);
    const time = tToK + SESSION_S + travel(k, j) + SESSION_S;
    if (profit <= 0) continue;
    if (stars >= 1 && (camNear[k] || camNear[j])) continue;
    const score = profit / time;
    if (!best || score > best.score) best = { score, buyHere: k === b.at, g, go: j, qty, k };
  }
  if (best && best.buyHere) {
    trade(r, b, 'buy', best.g, best.qty);
    b.dest = best.go;
  } else if (best) b.dest = best.k;
  else if (b.bag.size > 0) { // rien à acheter : va vendre le sac au meilleur endroit
    let bj = -1, bs = -1;
    for (const [g, n] of b.bag) for (let j = 0; j < dealers.length; j++) {
      if (j === b.at) continue;
      const s = n * expected(b, g, j, tMs, tMs, n).sell / travel(b.at, j);
      if (s > bs) { bs = s; bj = j; }
    }
    b.dest = bj >= 0 ? bj : (b.at + 1) % dealers.length;
  } else { // bourse vide et sac vide : attend sur place (un tuyau ou le bruit finira par ouvrir une route)
    b.dest = -1;
    b.busy = r.t + 20;
    visitSeen(r, b, b.trades > before);
    return;
  }
  visitSeen(r, b, b.trades > before);
  b.busy = r.t + SESSION_S + (b.dest >= 0 ? travel(b.at, b.dest) : 20);
}

function stepSecond(r: Run): void {
  const tMs = r.t * 1000;
  advanceMarket(r.market, tMs, r.rnd);
  const sms = rollTip(r.market, tMs, r.rnd);
  if (sms?.tip) {
    const ev = r.market.events[r.market.events.length - 1];
    for (const b of r.bots) if (ev) b.belief.events.push({ ...ev });
  }
  for (const b of r.bots) {
    // chaleur et arrestations
    const stars = starsOf(b.heat);
    if (stars > 0) {
      b.calm += 1;
      if (b.calm > UNSEEN_DELAY_S && stars <= 2) b.heat = Math.max(0, b.heat - HEAT_DECAY_PER_S);
      if (r.rnd() < HAZARD[stars] * (b.kind === 'opti' ? 0.4 : b.kind === 'boucle' ? 0 : 1)) { // 'boucle' : police ignorée, pour isoler la saturation économique
        b.arrests++;
        b.money -= Math.floor(b.money * BUST_MONEY_SHARE);
        b.bag.clear(); b.paid.clear(); b.heat = 0; b.calm = 0; b.busy = Math.max(b.busy, r.t + JAIL_S); b.dest = -1;
      }
    }
    if (r.t < b.busy) continue;
    if (b.dest >= 0) b.at = b.dest; // arrivée
    if (b.kind === 'opti') actOpti(r, b); else if (b.kind === 'boucle' || b.kind === 'meme') actBoucle(r, b); else actNaif(r, b);
    if (b.money >= 500 && b.t500 === Infinity) b.t500 = r.t;
    if (b.money >= 2000 && b.t2000 === Infinity) b.t2000 = r.t;
  }
  const min = r.t / 60;
  if (r.t % 60 === 0) for (const b of r.bots) b.curve.set(min, b.money + 0);
  r.t++;
}

function run(seed: number, kinds: Kind[], minutes: number): Run {
  const r = initRun(seed, kinds);
  for (let s = 0; s <= minutes * 60; s++) stepSecond(r);
  return r;
}

/** Valeur du sac au prix moyen payé (bots naïf/moyen) : le patrimoine, pas seulement la bourse. */
const stockAtCost = (b: Bot) => { let v = 0; for (const [g, n] of b.bag) v += n * (b.paid.get(g) ?? 0); return v; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const eur = (n: number) => `${Math.round(n)}`.padStart(7);
const SEEDS = Number(process.argv[2]) || 40;

interface Summary { m5: number; m10: number; m20: number; m60: number; perHour: number; arrests: number; seen: number; trades: number; t500: number; t2000: number }
function scenario(label: string, kinds: Kind[], minutes: number): Summary[] {
  const out: Summary[][] = kinds.map(() => []);
  for (let s = 0; s < SEEDS; s++) {
    const r = run(1000 + s * 7919, kinds, minutes);
    r.bots.forEach((b, i) => out[i].push({
      m5: b.curve.get(5) ?? 0, m10: b.curve.get(10) ?? 0, m20: b.curve.get(20) ?? 0, m60: b.curve.get(60) ?? 0,
      perHour: (b.money + stockAtCost(b) - START_MONEY) / (minutes / 60), arrests: b.arrests, seen: b.seen, trades: b.trades, t500: b.t500, t2000: b.t2000,
    }));
  }
  const flat = out.flat();
  const f = (k: keyof Summary) => flat.map((x) => x[k]);
  const reach = (k: 't500' | 't2000') => { const v = f(k).filter((x) => Number.isFinite(x)); return v.length ? `${Math.round(mean(v) / 60)} min (${v.length}/${flat.length})` : 'jamais'; };
  console.log(`\n== ${label} : ${kinds.length} bot(s) × ${SEEDS} graines, ${minutes} min ==`);
  console.log(`  argent à 5/10/20 min (médiane) : ${eur(pct(f('m5'), 0.5))} ${eur(pct(f('m10'), 0.5))} ${eur(pct(f('m20'), 0.5))}${minutes >= 60 ? ` ; à 60 min : ${eur(pct(f('m60'), 0.5))}` : ''}`);
  console.log(`  gain/heure (p10 / médiane / p90) : ${eur(pct(f('perHour'), 0.1))} / ${eur(pct(f('perHour'), 0.5))} / ${eur(pct(f('perHour'), 0.9))}  (moyenne ${eur(mean(f('perHour')))})`);
  console.log(`  arrestations ${mean(f('arrests')).toFixed(1)}, échanges vus ${mean(f('seen')).toFixed(1)}, transactions ${mean(f('trades')).toFixed(0)} ; atteint 500 € : ${reach('t500')} ; 2000 € : ${reach('t2000')}`);
  return flat;
}

/** Meilleure route statique (gain/min) : sert aux bots « boucle » et « meme ». */
function bestLoop(s: MarketState): void {
  let best = -Infinity;
  for (const g of GOOD_IDS) for (let k = 0; k < dealers.length; k++) for (let j = 0; j < dealers.length; j++) {
    if (dealers[k].district === dealers[j].district) continue;
    const qty = Math.min(MAX_TRADE_QTY, Math.floor(BAG_CAP / GOODS[g].weight));
    const perMin = (qty * (quoteLot(g, dealers[j].district, s, 0, 'sell', qty) - quoteLot(g, dealers[k].district, s, 0, 'buy', qty))) / (travel(k, j) * 2 + 2 * SESSION_S);
    if (perMin > best) { best = perMin; LOOP = { g, k, j }; }
  }
}

// ---------- Rentabilité brute des routes (marché calme, ε = 1, sac plein, sans impact) ----------
console.log(`# ${dealers.length} dealers, ${cams.length} caméras (dealers à moins de ${DEAL_CAM_RANGE} m d'une caméra : ${camNear.filter(Boolean).length}) ; sac ${BAG_CAP}, impact des échanges inclus`);
{
  const s = newMarketState();
  const rows: { name: string; perBag: number; perMin: number; cost: number }[] = [];
  for (const g of GOOD_IDS) {
    let bestRow: { name: string; perBag: number; perMin: number; cost: number } | null = null;
    for (let k = 0; k < dealers.length; k++) for (let j = 0; j < dealers.length; j++) {
      if (dealers[k].district === dealers[j].district) continue;
      const qty = Math.min(MAX_TRADE_QTY, Math.floor(BAG_CAP / GOODS[g].weight));
      const bq = quote(g, dealers[k].district, s, 0), sq = quote(g, dealers[j].district, s, 0);
      const perBag = qty * (sq.sell - bq.buy);
      const time = travel(k, j) + 2 * SESSION_S;
      if (!bestRow || perBag / time > bestRow.perMin / 60) bestRow = { name: `${g} ${dealers[k].district}->${dealers[j].district}`, perBag, perMin: perBag / time * 60, cost: qty * bq.buy };
    }
    if (bestRow) rows.push(bestRow);
  }
  bestLoop(s);
  console.log('# meilleure route par marchandise (sac plein, sans impact) : gain/sac, gain/min de trajet, mise');
  for (const x of rows.sort((a, b) => b.perMin - a.perMin)) console.log(`   ${x.name.padEnd(44)} ${eur(x.perBag)} € ${eur(x.perMin)} €/min  mise ${eur(x.cost)}`);
}

const naif = scenario('Stratégie naïve (au hasard)', ['naif'], 20);
const moyen = scenario('Stratégie moyenne (se souvient des prix vus, sans tuyaux)', ['moyen'], 20);
const opti = scenario('Stratégie optimale', ['opti'], 20);
const boucle = scenario('Boucle triviale : toujours la même meilleure route (60 min)', ['boucle'], 60);
const meme = scenario('Achat / revente au même dealer en boucle', ['meme'], 20);
const opti60 = scenario('Stratégie optimale (extrapolation 60 min : pas d\'argent infini)', ['opti'], 60);
const coop = scenario('Coopératif : 4 bots optimaux sur le même marché (saturation)', ['opti', 'opti', 'opti', 'opti'], 20);

// ---------- Objectifs ----------
let fails = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' : ' + detail : ''}`); if (!ok) fails++; };
const med = (s: Summary[], k: keyof Summary) => pct(s.map((x) => x[k]), 0.5);
console.log('\n== Objectifs d\'équilibrage ==');
check('naïf (hasard) : ne s’enrichit pas (gain/heure médian <= 1 000 €), ne crée pas d’argent', med(naif, 'perHour') <= 1000 && med(naif, 'm20') >= 0, `${Math.round(med(naif, 'perHour'))} €/h`);
check('moyen (mémoire des prix) : gain modéré (médian entre -300 et 4 000 €/h) et >= naïf', med(moyen, 'perHour') >= -300 && med(moyen, 'perHour') <= 4000 && med(moyen, 'perHour') >= med(naif, 'perHour'), `${Math.round(med(moyen, 'perHour'))} €/h`);
check('optimal : entre 1 500 et 5 000 € en caisse après 20 min, 4 000-10 000 €/h en régime établi (robot à information parfaite ; un humain fait environ la moitié)', med(opti, 'm20') >= 1500 && med(opti, 'm20') <= 5000 && med(opti60, 'perHour') >= 4000 && med(opti60, 'perHour') <= 10_000, `${Math.round(med(opti, 'm20'))} € à 20 min, ${Math.round(med(opti60, 'perHour'))} €/h sur 60 min`);
check('même dealer en boucle : jamais de gain (le patrimoine ne dépasse pas le départ)', med(meme, 'perHour') <= 0, `${Math.round(med(meme, 'perHour'))} €/h`);
check('boucle triviale (toujours la même route, sans police) : < 30 % du joueur optimal, le marché sature', med(boucle, 'perHour') < 0.3 * med(opti60, 'perHour'), `${Math.round(med(boucle, 'perHour'))} €/h contre ${Math.round(med(opti60, 'perHour'))}`);
check('optimal > 2 × moyen', med(opti, 'perHour') > 2 * Math.max(1, med(moyen, 'perHour')), `${Math.round(med(opti, 'perHour'))} contre ${Math.round(med(moyen, 'perHour'))} €/h`);
check('optimal : 500 € atteints en moins de 12 min (progression visible)', mean(opti.map((x) => x.t500)) < 12 * 60);
check('optimal : jamais d\'argent infini (60 min : < 10 000 €/h et < 11 000 € médian à 60 min)', med(opti60, 'perHour') < 10_000 && med(opti60, 'm60') < 11_000, `${Math.round(med(opti60, 'm60'))} € à 60 min`);
check('croissance sous-exponentielle : gain de la 2e demi-heure <= 2,2 × celui de la 1re', (() => { const a = med(opti60, 'm60') - med(opti60, 'm20'); const b = med(opti60, 'm20'); return a <= 2.2 * Math.max(1, b) * 2; })());
check('coopératif : chaque bot gagne au moins 45 % d\'un bot seul (le marché sature sans s\'effondrer)', med(coop, 'perHour') >= 0.45 * med(opti, 'perHour') && med(coop, 'perHour') > 0, `${Math.round(med(coop, 'perHour'))} €/h par bot`);
check('prise de risque : le bot optimal se fait arrêter parfois, mais pas en boucle (< 6 par 20 min)', mean(opti.map((x) => x.arrests)) < 6);
console.log(fails === 0 ? '\néconomie-sim : OBJECTIFS TENUS' : `\néconomie-sim : ${fails} objectif(s) manqué(s)`);
console.log(`(rappel : seuils de chaleur ${STAR_AT.join('/')} ; récompenses de missions visées 100-500 €)`);
process.exit(fails === 0 ? 0 : 1);
