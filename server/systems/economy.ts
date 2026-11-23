// PROPRIÉTAIRE : game-economy
// Économie en jeu : argent et sac INDIVIDUELS (clé = pseudo), marché commun (shared/economy/prices.ts), dealers (POI `dealer`), planque (POI `planque`),
// tuyaux par SMS, caméras de surveillance (POI `camera`), détection `deal_vu`, arrestation (perte du sac et d'une part de l'argent).
// DÉCISION : argent et sac sont individuels (docs/ARCHITECTURE-GTA.md §0) ; `/donner <pseudo> <montant>` permet de partager. La planque est personnelle
// (même contenu depuis n'importe quelle planque de la ville). Le marché (prix, tuyaux) est commun à tous les joueurs.
// Aucune référence de corps Rapier n'est conservée entre deux ticks : positions lues à la demande (sim.playerPos, bodyOk pour les véhicules).
import type { SimPlayer } from '../../shared/api';
import { bodyOk } from '../../shared/guard';
import type { GameCtx, GameSystem, SystemFactory } from '../../shared/game';
import { DISTRICT_IDS, GOOD_IDS, isIn, type GoodId } from '../../shared/ids';
import type { GameClientMsg, Mark, PrivateState, Sms } from '../../shared/protocol';
import type { Poi } from '../../shared/city/layout';
import { GANG_OF_DISTRICT } from '../../shared/economy/gangs';
import { GOODS } from '../../shared/economy/goods';
import {
  advanceMarket, applyTrade, makeRng, newMarketState, parseMarket, quote, rollTip, serializeMarket, setCameras, shopGoods, type MarketState,
} from '../../shared/economy/prices';
import {
  BAG_CAP, CAMERA_RADIUS_EXPLOSION, CAMERA_RADIUS_VEHICLE, CAMERA_SHOT_RANGE, CAMERA_SHOT_WIDTH, DEAL_CAM_RANGE, DEAL_COP_RANGE, MAX_MONEY, MAX_TRADE_QTY,
  SHOP_RANGE, START_MONEY, STASH_CAP, TRADE_RANGE, addToBag, bagToObject, bagVolume, bustLoss, checkStash, checkTrade, isIntIn, parseAmount, rayMissDistance,
  type Bag, type TradeRefusal,
} from '../../shared/economy/trade';
import { registerCommand } from '../commands';
import type { PedsSystem } from './peds';

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ACCOUNTS = 64;
const MAX_UNREAD = 60;

interface Account {
  money: number;
  bag: Bag;
  stash: Bag;
  nextSms: number;
  unread: Set<number>;
}
const newAccount = (): Account => ({ money: START_MONEY, bag: new Map(), stash: new Map(), nextSms: 1, unread: new Set() });

export interface EconomySystem extends GameSystem {
  /** État du marché commun (lecture ; modifiable par les tests). */
  readonly market: MarketState;
  /** Argent actuel du joueur (0 s'il est inconnu). */
  moneyOf(p: SimPlayer): number;
  /** Ajoute (ou retire si négatif) de l'argent, borné à [0, MAX_MONEY] ; renvoie le nouveau solde. Pour les récompenses de mission / activité. */
  addMoney(p: SimPlayer, delta: number): number;
  /** Contenu du sac / de la planque (copie). */
  bagOf(p: SimPlayer): Map<GoodId, number>;
  stashOf(p: SimPlayer): Map<GoodId, number>;
  /** Nombre de caméras de surveillance détruites. */
  camerasDown(): number;
  /** Message court (toast) pour ce joueur. */
  notify(p: SimPlayer, text: string): void;
  /** Remplace le générateur aléatoire du marché (tests). */
  setRng(rnd: () => number): void;
}

// Un seul système par Sim : la commande /donner (enregistrée globalement) retrouve le bon.
const systemOf = new WeakMap<object, EconomySystem>();
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

registerCommand('donner', ({ sim, player, args, reply }) => {
  const eco = systemOf.get(sim);
  if (!eco) return reply('L\'économie n\'est pas prête.');
  if (args.length !== 2) return reply('Usage : /donner <pseudo> <montant>');
  const amount = parseAmount(args[1]);
  if (amount === null) return reply('Montant invalide : un nombre entier positif, par exemple « /donner Alice 50 ».');
  const w = norm(args[0]);
  const others = [...sim.players.values()].filter((q) => q !== player);
  const target = others.find((q) => norm(q.name) === w) ?? (others.filter((q) => norm(q.name).startsWith(w)).length === 1 ? others.find((q) => norm(q.name).startsWith(w)) : undefined);
  if (!target) return reply(`Personne ne s'appelle « ${args[0].slice(0, 24)} » (ou plusieurs pseudos se ressemblent).`);
  if (eco.moneyOf(player) < amount) return reply(`Tu n'as que ${eco.moneyOf(player)} €. Les dons à découvert, c'est le rôle de la banque.`);
  if (eco.moneyOf(target) + amount > MAX_MONEY) return reply(`${target.name} ne peut plus rien porter.`);
  eco.addMoney(player, -amount);
  eco.addMoney(target, amount);
  reply(`Tu as donné ${amount} € à ${target.name}.`);
  eco.notify(target, `${player.name} t'a donné ${amount} €.`);
}, '/donner <pseudo> <montant> : donner de l\'argent à un coéquipier');

const REFUSALS: Record<TradeRefusal, string> = {
  quantite: 'Quantité invalide.',
  argent: 'Pas assez d\'argent. Ici, le crédit est mal vu.',
  place: 'Ton sac est plein (ou la planque).',
  stock: 'Tu n\'as pas assez de cette marchandise.',
  prix: 'Prix indisponible.',
};

export const createEconomy: SystemFactory = (ctx: GameCtx): EconomySystem => {
  const { sim, bus, city } = ctx;
  let rnd = makeRng((Date.now() ^ 0x5bd1e995) >>> 0);
  let market: MarketState = newMarketState();
  const accounts = new Map<string, Account>();
  const dealers: Poi[] = city.poisOf('dealer');
  const planques: Poi[] = city.poisOf('planque');
  const cameras: Poi[] = city.poisOf('camera');
  const camDown = new Set<string>(); // ids de caméras détruites
  let tick = 0;

  const accountOf = (p: SimPlayer): Account => {
    let a = accounts.get(p.name);
    if (!a) {
      a = newAccount();
      if (accounts.size >= MAX_ACCOUNTS) { // purge du plus ancien compte hors ligne
        const online = new Set([...sim.players.values()].map((q) => q.name));
        for (const k of accounts.keys()) if (!online.has(k)) { accounts.delete(k); break; }
      }
      accounts.set(p.name, a);
    }
    return a;
  };

  const posOf = (p: SimPlayer): [number, number] | null => {
    try {
      const q = sim.playerPos(p);
      return Number.isFinite(q[0]) && Number.isFinite(q[2]) ? [q[0], q[2]] : null;
    } catch { return null; }
  };
  const nearest = (list: Poi[], x: number, z: number, r: number): Poi | null => {
    let best: Poi | null = null, bd = r;
    for (const o of list) { const d = Math.hypot(o.x - x, o.z - z); if (d <= bd) { bd = d; best = o; } }
    return best;
  };

  const toast = (p: SimPlayer, text: string) => ctx.sendTo(p.id, { k: 'toast', text });
  const addMoney = (p: SimPlayer, delta: number): number => {
    const a = accountOf(p);
    const d = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    a.money = Math.max(0, Math.min(MAX_MONEY, a.money + d));
    return a.money;
  };

  // ---------- Caméras de surveillance ----------
  const syncCameras = () => {
    for (const d of DISTRICT_IDS) {
      const all = cameras.filter((c) => c.district === d);
      setCameras(market, d, all.filter((c) => !camDown.has(c.id)).length, all.length);
    }
  };
  syncCameras();

  const destroyCamera = (c: Poi, by: SimPlayer | null) => {
    if (camDown.has(c.id)) return;
    camDown.add(c.id);
    syncCameras();
    ctx.broadcast({ k: 'monde', camsDown: camDown.size });
    bus.emit('cameraDestroyed', { by, id: c.id });
    if (by) bus.emit('crime', { kind: 'camera_detruite', by, x: c.x, z: c.z });
  };
  const destroyCamerasNear = (x: number, z: number, r: number, by: SimPlayer | null) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    for (const c of cameras) if (!camDown.has(c.id) && Math.hypot(c.x - x, c.z - z) <= r) destroyCamera(c, by);
  };

  bus.on('crime', (e) => {
    if (e.kind === 'explosion') destroyCamerasNear(e.x, e.z, CAMERA_RADIUS_EXPLOSION, e.by);
    else if (e.kind === 'tir') {
      const me = posOf(e.by);
      let ox = e.x, oz = e.z;
      if (!Number.isFinite(ox) || !Number.isFinite(oz) || (me && Math.hypot(ox - me[0], oz - me[1]) > 30)) { if (!me) return; [ox, oz] = me; }
      const inp = e.by.input;
      const dx = inp?.ad?.[0], dz = inp?.ad?.[2];
      if (typeof dx !== 'number' || typeof dz !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dz)) return;
      for (const c of cameras) {
        if (camDown.has(c.id)) continue;
        const miss = rayMissDistance(ox, oz, dx, dz, c.x, c.z, CAMERA_SHOT_RANGE);
        if (miss !== null && miss <= CAMERA_SHOT_WIDTH) destroyCamera(c, e.by);
      }
    }
  });
  bus.on('vehicleDestroyed', (e) => {
    const b = e.v.behavior?.body;
    if (!bodyOk(b)) return; // jamais de corps retiré ; lecture immédiate, rien n'est conservé
    const t = b.translation();
    destroyCamerasNear(t.x, t.z, CAMERA_RADIUS_VEHICLE, e.by);
  });

  // ---------- Détection d'un échange (deal_vu) ----------
  const copNear = (x: number, z: number): boolean => {
    const peds = ctx.get<PedsSystem>('peds');
    if (peds) for (const q of peds.peds) if (q.kind === 'flic' && !q.gone && Math.hypot(q.x - x, q.z - z) <= DEAL_COP_RANGE) return true;
    for (const v0 of sim.vehicles) {
      if (v0.pooled || v0.dead || v0.def.type !== 'police') continue;
      const v = sim.resolveRef(sim.refOf(v0));
      if (!v || !bodyOk(v.behavior.body)) continue;
      const t = v.behavior.body.translation();
      if (Math.hypot(t.x - x, t.z - z) <= DEAL_COP_RANGE) return true;
    }
    return false;
  };
  const cameraNear = (x: number, z: number): boolean => cameras.some((c) => !camDown.has(c.id) && Math.hypot(c.x - x, c.z - z) <= DEAL_CAM_RANGE);

  // ---------- Commerce ----------
  const refuse = (p: SimPlayer, why: TradeRefusal) => toast(p, REFUSALS[why]);

  const doTrade = (p: SimPlayer, m: Extract<GameClientMsg, { k: 'trade' }>) => {
    if (!isIn(GOOD_IDS, m.good) || (m.side !== 'buy' && m.side !== 'sell') || !isIntIn(m.qty, 1, MAX_TRADE_QTY)) return refuse(p, 'quantite');
    if (p.hp <= 0 || p.vehicle) return;
    const pos = posOf(p);
    const dealer = dealers.find((d) => d.id === m.dealer);
    if (!pos || !dealer || Math.hypot(dealer.x - pos[0], dealer.z - pos[1]) > TRADE_RANGE) return toast(p, 'Le dealer est trop loin.');
    const a = accountOf(p);
    const q = quote(m.good, dealer.district, market, sim.time);
    const unit = m.side === 'buy' ? q.buy : q.sell;
    const chk = checkTrade(m.side, m.good, m.qty, unit, a.money, a.bag, BAG_CAP);
    if (!chk.ok) return refuse(p, chk.why);
    if (m.side === 'buy') { a.money -= chk.total; addToBag(a.bag, m.good, m.qty); }
    else { a.money = Math.min(MAX_MONEY, a.money + chk.total); addToBag(a.bag, m.good, -m.qty); }
    applyTrade(market, m.good, dealer.district, m.side, m.qty);
    bus.emit('trade', { p, good: m.good, qty: m.qty, price: unit, side: m.side }); // price = prix unitaire
    if (copNear(pos[0], pos[1]) || cameraNear(pos[0], pos[1])) {
      toast(p, 'Quelqu\'un a vu l\'échange. Ça sent le roussi.');
      bus.emit('crime', { kind: 'deal_vu', by: p, x: pos[0], z: pos[1] });
    }
  };

  const doStash = (p: SimPlayer, m: Extract<GameClientMsg, { k: 'stash' }>) => {
    if (!isIn(GOOD_IDS, m.good) || (m.op !== 'put' && m.op !== 'take')) return;
    if (p.hp <= 0 || p.vehicle) return;
    const pos = posOf(p);
    if (!pos || !nearest(planques, pos[0], pos[1], TRADE_RANGE)) return toast(p, 'Pas de planque à portée.');
    const a = accountOf(p);
    const chk = checkStash(m.op, m.good, m.qty, a.bag, BAG_CAP, a.stash, STASH_CAP);
    if (!chk.ok) return refuse(p, chk.why);
    const sign = m.op === 'put' ? 1 : -1;
    addToBag(a.bag, m.good, -sign * m.qty);
    addToBag(a.stash, m.good, sign * m.qty);
  };

  // ---------- Arrestation, debug ----------
  bus.on('playerBusted', ({ p }) => {
    const a = accountOf(p);
    const loss = bustLoss(a.money);
    const lost = a.bag.size > 0;
    a.money -= loss;
    a.bag.clear();
    toast(p, lost || loss ? `Fouillé ! Tu perds ton sac et ${loss} €.` : 'Fouillé, mais tu n\'avais rien. Les flics sont déçus.');
  });
  bus.on('debug', ({ p, what, arg }) => {
    if (what !== 'money') return;
    const n = Number(arg);
    if (!Number.isInteger(n) || Math.abs(n) > MAX_MONEY) return toast(p, 'Usage : /debug money <entier>');
    addMoney(p, n);
    toast(p, `Debug : ${n >= 0 ? '+' : ''}${n} € (solde ${accountOf(p).money} €).`);
  });

  // ---------- Sauvegarde ----------
  const parseBag = (raw: unknown, cap: number): Bag => {
    const out: Bag = new Map();
    if (!Array.isArray(raw)) return out;
    for (const e of raw.slice(0, 64)) {
      if (!Array.isArray(e) || !isIn(GOOD_IDS, e[0]) || !isIntIn(e[1], 1, 9999)) continue;
      if (bagVolume(out) + GOODS[e[0]].weight * e[1] > cap) continue; // sac gonflé par une sauvegarde bricolée : l'excédent est ignoré
      addToBag(out, e[0], e[1]);
    }
    return out;
  };
  const bagPairs = (b: Bag): [string, number][] => GOOD_IDS.filter((g) => (b.get(g) ?? 0) > 0).map((g) => [g, b.get(g)!]);

  const self: EconomySystem = {
    id: 'economy',
    get market() { return market; },
    moneyOf: (p) => accountOf(p).money,
    addMoney,
    bagOf: (p) => new Map(accountOf(p).bag),
    stashOf: (p) => new Map(accountOf(p).stash),
    camerasDown: () => camDown.size,
    setRng: (r) => { rnd = r; },
    notify: toast,

    postStep() {
      tick++;
      if (tick % 10 !== 0) return;
      advanceMarket(market, sim.time, rnd);
      const t = rollTip(market, sim.time, rnd);
      if (!t) return;
      for (const p of sim.players.values()) {
        const a = accountOf(p);
        const sms: Sms = { ...t, id: a.nextSms++, at: sim.time };
        a.unread.add(sms.id);
        if (a.unread.size > MAX_UNREAD) a.unread.delete(a.unread.values().next().value as number);
        ctx.sendTo(p.id, { k: 'sms', sms });
      }
    },

    onJoin(p) {
      accountOf(p);
      ctx.sendTo(p.id, { k: 'monde', camsDown: camDown.size });
    },

    onInteract(p) {
      // Touche d'interaction près d'un dealer ou d'une planque : le client ouvre la boutique, on évite de monter dans un véhicule voisin.
      if (p.vehicle) return false;
      const pos = posOf(p);
      if (!pos || !(nearest(dealers, pos[0], pos[1], SHOP_RANGE) || nearest(planques, pos[0], pos[1], SHOP_RANGE))) return false;
      for (const v0 of sim.vehicles) {
        if (v0.pooled || v0.dead) continue;
        const v = sim.resolveRef(sim.refOf(v0));
        if (!v || !bodyOk(v.behavior.body)) continue;
        const t = v.behavior.body.translation();
        if (Math.hypot(t.x - pos[0], t.z - pos[1]) < 4.5) return false; // un véhicule est à portée : on laisse le cœur gérer
      }
      return true;
    },

    onMessage(p, m) {
      if (m.k === 'trade') doTrade(p, m);
      else if (m.k === 'stash') doStash(p, m);
      else if (m.k === 'sms_lu') accountOf(p).unread.delete(m.id);
    },

    privateView(p, out: PrivateState) {
      const a = accountOf(p);
      out.money = a.money;
      out.bag = bagToObject(a.bag);
      out.bagCap = BAG_CAP;
      out.unread = a.unread.size;
      const pos = posOf(p);
      if (!pos) return;
      const onFoot = !p.vehicle;
      const d = onFoot ? nearest(dealers, pos[0], pos[1], SHOP_RANGE) : null;
      if (d) out.shop = { dealer: d.id, district: d.district, gang: GANG_OF_DISTRICT[d.district], goods: shopGoods(d.district, market, sim.time) };
      if (onFoot && nearest(planques, pos[0], pos[1], SHOP_RANGE)) out.stash = bagToObject(a.stash);
      // Repères : dealers et planques proches (au plus 5, pour laisser de la place aux missions)
      const marks: Mark[] = [];
      for (const o of [...dealers, ...planques]) {
        if (Math.hypot(o.x - pos[0], o.z - pos[1]) <= 160 && marks.length < 5) marks.push({ x: o.x, z: o.z, k: o.kind === 'dealer' ? 'dealer' : 'planque' });
      }
      out.marks.push(...marks);
    },

    serialize() {
      const off = sim.time; // les dates du marché sont sauvées relatives à « maintenant » : le temps de simulation repart de 0 au rechargement
      const shifted: MarketState = {
        ...market, noiseAt: market.noiseAt - off, nextRollAt: market.nextRollAt - off,
        events: market.events.map((e) => ({ ...e, start: e.start - off, until: e.until - off })),
      };
      return {
        v: 1,
        market: serializeMarket(shifted),
        accounts: [...accounts].slice(0, MAX_ACCOUNTS).map(([name, a]) => [name, a.money, bagPairs(a.bag), bagPairs(a.stash), a.nextSms]),
        camsDown: [...camDown],
      };
    },

    restore(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const d = data as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(d, 'market')) {
        const m = parseMarket(d.market);
        const off = sim.time;
        m.noiseAt += off; m.nextRollAt += off;
        for (const e of m.events) { e.start += off; e.until += off; }
        market = m;
      }
      camDown.clear();
      if (Array.isArray(d.camsDown)) for (const id of d.camsDown.slice(0, 200)) if (typeof id === 'string' && cameras.some((c) => c.id === id)) camDown.add(id);
      syncCameras();
      if (Array.isArray(d.accounts)) {
        accounts.clear();
        for (const e of d.accounts.slice(0, MAX_ACCOUNTS)) {
          if (!Array.isArray(e)) continue;
          const [name, money, bag, stash, next] = e as unknown[];
          if (typeof name !== 'string' || name.length < 1 || name.length > 40 || BAD_KEYS.has(name)) continue;
          const a = newAccount();
          a.money = typeof money === 'number' && Number.isFinite(money) ? Math.max(0, Math.min(MAX_MONEY, Math.floor(money))) : START_MONEY;
          a.bag = parseBag(bag, BAG_CAP);
          a.stash = parseBag(stash, STASH_CAP);
          a.nextSms = isIntIn(next, 1, 1e9 - 1000) ? next : 1;
          accounts.set(name, a);
        }
      }
    },
  };
  systemOf.set(sim, self);
  return self;
};
