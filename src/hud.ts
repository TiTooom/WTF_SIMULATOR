// Interface en jeu (PROPRIÉTAIRE : art-toon) : viseur, barres de vie (joueur, véhicule), flash de dégâts (éléments d'index.html, repris tels quels)
// + HUD de ville créé ici en DOM. Aucun `innerHTML`.
//
// PRINCIPE (retour de test « interface trop lourde ») : au repos, SEULS sont visibles la barre de vie (index.html), l'argent, les étoiles
// (si recherche), l'objectif courant (mission/activité, en haut à gauche) et la mini-carte. Le reste est à la demande ou éphémère :
// quartier (bandeau 3 s au changement), aide de touche (une ligne, seulement s'il y a une action possible), liste des joueurs
// (quelques secondes quand elle change, ou tant qu'on la demande), toasts (2 au plus, courts).
//
// API pour main.ts :
//   const hud = createHud();                       // une fois (inchangé)
//   hud.update({ hp, vehHp, vehName, inVehicle, x, z, yaw, mates?, cops?, search? }, me);   // chaque image
//   hud.toast('texte', 3500);                      // bandeaux courts (SMS : « Nouveau SMS » suffit, le détail est dans le PDA)
//   hud.alert('arrete' | 'ko', 3200);              // vignette d'alerte
//   hud.setHint('E : monter dans la berline');     // UNE ligne d'aide contextuelle (vide = rien). Le texte du <div id="hud"> n'est PLUS recopié.
//   hud.setPlayers(['Léa (toi)', 'Sam']);          // liste des joueurs : apparaît 5 s quand elle change ; hud.showPlayers(true/false) pour la forcer
//   hud.flash(force) ; hud.tick(dt) ; hud.setVisible(bool)
//   hud.topOffset(px)                              // décale les toasts vers le bas (le guide occupe le haut-centre pendant le tutoriel)
//   HudState.cops : flics à vue (copsInSight) ; HudState.search : état de recherche renvoyé par le serveur (libellé court près des étoiles).
import { DISTRICTS } from '../shared/city/districts';
import { PED_KINDS } from '../shared/ids';
import { PED_STRIDE, type Mark, type PrivateState } from '../shared/protocol';
import { playerColor } from './models';
import { MAP_EXTENT, MARK_STYLE, cityMapCanvas, worldToMap } from './ui/pda/carte';

export interface HudState {
  hp: number; // 0..100
  vehHp: number | null; // 0..1 du véhicule conduit
  vehName: string;
  inVehicle: boolean;
  /** Position et cap pour la mini-carte (absents : mini-carte masquée). */
  x?: number;
  z?: number;
  yaw?: number;
  mates?: { x: number; z: number; name?: string }[];
  /** Flics à vue (voir copsInSight). Absent : les étoiles clignotent dès que la recherche est active. */
  cops?: number;
  /** État de recherche (optionnel). 'repere' : « Repéré ! » ; 'recherche' : « Recherché » ; 'cache' : « Caché » ; 'libre' avec des étoiles : « Semé ». Absent : déduit de `cops`. */
  search?: 'libre' | 'repere' | 'recherche' | 'cache';
}

export type SearchKind = 'repere' | 'recherche' | 'cache' | 'seme';
/** Libellé court de l'état de recherche (null : rien à dire). Exporté pour les tests et le guide. */
export function searchLabel(stars: number, search?: HudState['search'], cops?: number): { text: string; kind: SearchKind } | null {
  if (stars <= 0) return null;
  const st = search ?? (cops === undefined ? 'recherche' : cops > 0 ? 'repere' : 'recherche');
  if (st === 'repere') return { text: 'Repéré !', kind: 'repere' };
  if (st === 'cache') return { text: 'Caché', kind: 'cache' };
  if (st === 'libre') return { text: 'Semé', kind: 'seme' };
  return { text: 'Recherché', kind: 'recherche' };
}

/** Nombre de flics (piétons 'flic' + véhicules de police) à moins de `radius` m de (x, z) : à passer dans HudState.cops. */
export function copsInSight(x: number, z: number, peds: ArrayLike<number> | undefined, vehicles: readonly { type: string; p: readonly number[]; dead: number }[], radius = 70): number {
  const r2 = radius * radius;
  let n = 0;
  const copIx = PED_KINDS.indexOf('flic');
  if (peds) for (let o = 0; o + PED_STRIDE <= peds.length; o += PED_STRIDE) {
    if (peds[o + 1] !== copIx) continue;
    const dx = peds[o + 2] - x, dz = peds[o + 3] - z;
    if (dx * dx + dz * dz < r2) n++;
  }
  for (const v of vehicles) {
    if (v.type !== 'police' || v.dead) continue;
    const dx = v.p[0] - x, dz = v.p[2] - z;
    if (dx * dx + dz * dz < r2) n++;
  }
  return n;
}

const MAP_PX = 176; // taille d'affichage de la mini-carte
const MAP_BASE = 768; // taille du fond partagé
const MAP_RADIUS = 105; // demi-largeur visible (m)
const MAX_TOASTS = 2;

const CSS = `
#gta-hud{position:fixed;inset:0;pointer-events:none;z-index:6;font-family:"Segoe UI",Verdana,sans-serif;font-weight:900}
#gta-hud .gh-right{position:absolute;right:14px;bottom:18px;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
#gta-hud .gh-stars{display:none;align-items:center;gap:8px}
#gta-hud .gh-stars.on{display:flex}
#gta-hud .gh-starrow{display:flex;gap:2px;align-items:center}
#gta-hud .gh-star{font-size:28px;line-height:1;color:#2b2b3d;-webkit-text-stroke:2px #000;text-shadow:2px 2px 0 #000}
#gta-hud .gh-star.on{color:#ffd23f}
#gta-hud .gh-star.blink{animation:ghblink .5s steps(2,jump-none) infinite}
#gta-hud .gh-star.dim{opacity:.6}
@keyframes ghblink{50%{opacity:.25}}
#gta-hud .gh-slabel{padding:1px 10px;border:3px solid #000;border-radius:8px;font-size:15px;box-shadow:2px 2px 0 #000;color:#1b1b2b;background:#ffd23f}
#gta-hud .gh-slabel.repere{background:#ff3b30;color:#fff;animation:ghblink .5s steps(2,jump-none) infinite}
#gta-hud .gh-slabel.cache{background:#74d3ff}
#gta-hud .gh-slabel.seme{background:#69db7c}
#gta-hud .gh-prog{width:130px;height:7px;border:3px solid #000;border-radius:6px;background:#2b2b3d;overflow:hidden;box-shadow:2px 2px 0 #000}
#gta-hud .gh-prog>div{height:100%;width:0;background:#e63946}
#gta-hud .gh-money{position:relative;font-size:32px;color:#ffd23f;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:3px 3px 0 #000;letter-spacing:.02em}
#gta-hud .gh-delta{position:absolute;right:0;top:-6px;font-size:22px;animation:ghfloat 1.4s ease-out forwards;white-space:nowrap}
#gta-hud .gh-delta.up{color:#69db7c}#gta-hud .gh-delta.down{color:#ff6b6b}
@keyframes ghfloat{from{transform:translateY(0);opacity:1}to{transform:translateY(-34px);opacity:0}}
#gta-hud .gh-map{width:${MAP_PX}px;height:${MAP_PX}px;border:5px solid #000;border-radius:16px;box-shadow:5px 5px 0 #000;background:#2a8fe0;overflow:hidden}
#gta-hud .gh-map canvas{display:block;width:100%;height:100%}
#gta-hud .gh-top{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;max-width:min(520px,70vw)}
#gta-hud .gh-box{padding:6px 14px;border:4px solid #000;border-radius:10px;background:#fff6dc;color:#1b1b2b;font-size:16px;box-shadow:4px 4px 0 #000;text-align:center}
#gta-hud .gh-obj{position:absolute;left:14px;top:14px;display:none;max-width:min(340px,38vw);text-align:left;padding:6px 14px 7px}
#gta-hud .gh-obj b{display:block;font-size:12px;letter-spacing:.1em;color:#c92a35}
#gta-hud .gh-obj .gh-otext{font-size:17px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#gta-hud .gh-obj .gh-osub{margin-top:2px;font-size:13px;color:#4a4d6a}
#gta-hud .gh-obj .gh-osub.low{color:#c92a35;animation:ghblink .5s steps(2,jump-none) infinite}
#gta-hud .gh-toast{background:#ffd23f;font-size:15px;animation:ghpop .25s ease-out}
@keyframes ghpop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
#gta-hud .gh-banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:6px 26px;border:5px solid #000;border-radius:12px;font-size:30px;color:#fff;text-shadow:3px 3px 0 #000;box-shadow:6px 6px 0 #000;opacity:0;transition:opacity .5s;text-align:center;white-space:nowrap}
#gta-hud .gh-banner small{display:block;font-size:14px}
#gta-hud .gh-star.cop{animation:ghcop .45s steps(2,jump-none) infinite}
@keyframes ghcop{0%{color:#ff3b30}50%{color:#3b82ff}}
#gta-hud .gh-hint{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(480px,50vw);padding:5px 16px;border:3px solid #000;border-radius:10px;background:rgba(255,246,220,.95);color:#1b1b2b;font-size:16px;font-weight:900;text-align:center;box-shadow:3px 3px 0 #000;display:none}
#gta-hud .gh-players{position:absolute;right:54px;top:14px;display:none;padding:5px 12px;border:3px solid #000;border-radius:10px;background:rgba(255,246,220,.92);color:#1b1b2b;font-size:14px;font-weight:800;white-space:pre;text-align:right;box-shadow:3px 3px 0 #000;max-height:40vh;overflow:hidden}
#gta-hud .gh-alert{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;opacity:0;transition:opacity .25s}
#gta-hud .gh-alert.ko{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(200,20,30,.75) 100%)}
#gta-hud .gh-alert.arrete{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 35%,rgba(30,70,220,.75) 100%)}
#gta-hud .gh-alert b{font-size:68px;color:#fff;-webkit-text-stroke:3px #000;paint-order:stroke fill;text-shadow:6px 6px 0 #000;transform:rotate(-4deg);letter-spacing:.04em}
#gta-hud .gh-alert small{margin-top:8px;padding:4px 18px;border:4px solid #000;border-radius:8px;background:#ffd23f;color:#1b1b2b;font-size:18px;box-shadow:4px 4px 0 #000}
@media (max-height:600px){#gta-hud .gh-map{width:130px;height:130px}}
`;

const $ = (id: string) => document.getElementById(id);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const ACTIVITY_NAMES: Record<string, string> = { taxi: 'TAXI', ambulance: 'AMBULANCE', pompier: 'POMPIERS', justicier: 'JUSTICIER' };

export function createHud() {
  const crosshair = $('crosshair');
  const hpFill = $('hpFill');
  const hpText = $('hpText');
  const vehBox = $('vehBox');
  const vehFill = $('vehFill');
  const vehLabel = $('vehLabel');
  const damage = $('damage');
  const vitals = $('vitals');
  let flashT = 0;

  if (!document.getElementById('gta-hud-css')) {
    const st = document.createElement('style');
    st.id = 'gta-hud-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'gta-hud';
  root.style.display = 'none';
  const right = document.createElement('div'); right.className = 'gh-right';
  const starsEl = document.createElement('div'); starsEl.className = 'gh-stars';
  const starRow = document.createElement('div'); starRow.className = 'gh-starrow';
  const starNodes: HTMLSpanElement[] = [];
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.className = 'gh-star';
    s.textContent = '★';
    starRow.appendChild(s);
    starNodes.push(s);
  }
  const sLabel = document.createElement('span'); sLabel.className = 'gh-slabel';
  starsEl.append(sLabel, starRow);
  const prog = document.createElement('div'); prog.className = 'gh-prog';
  const progFill = document.createElement('div'); prog.appendChild(progFill);
  const money = document.createElement('div'); money.className = 'gh-money';
  const moneyText = document.createElement('span');
  money.appendChild(moneyText);
  const mapBox = document.createElement('div'); mapBox.className = 'gh-map';
  const map = document.createElement('canvas');
  map.width = map.height = MAP_PX * 2;
  mapBox.appendChild(map);
  right.append(starsEl, prog, money, mapBox);
  // Objectif courant (mission ou activité) : en haut à gauche, 2 lignes au plus
  const objBox = document.createElement('div'); objBox.className = 'gh-box gh-obj';
  const objTag = document.createElement('b');
  const objText = document.createElement('div'); objText.className = 'gh-otext';
  const objSub = document.createElement('div'); objSub.className = 'gh-osub';
  objBox.append(objTag, objText, objSub);
  const top = document.createElement('div'); top.className = 'gh-top';
  const banner = document.createElement('div'); banner.className = 'gh-banner';
  const hint = document.createElement('div'); hint.className = 'gh-hint';
  const playersEl = document.createElement('div'); playersEl.className = 'gh-players';
  const alertEl = document.createElement('div'); alertEl.className = 'gh-alert';
  const alertMain = document.createElement('b'), alertSub = document.createElement('small');
  alertEl.append(alertMain, alertSub);
  root.append(right, objBox, top, banner, hint, playersEl, alertEl);
  document.body.appendChild(root);

  const g = map.getContext('2d')!;
  let lastMapDraw = 0;
  let lastMoney = -1;
  let lastDistrict = '';
  let bannerT = 0;
  let visible = true;
  let copsSeen: number | undefined;
  let searchState: HudState['search'];
  let alertT = 0;
  let alertText = '';
  let playersT = 0;
  let playersForced = false;
  let playersKey = '';
  let semeT = 0; // « Semé » reste affiché un instant après la perte des étoiles
  let lastStars = 0;
  const setHint = (t: string) => {
    const txt = String(t ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 1).join('');
    if (hint.textContent === txt) return;
    hint.textContent = txt;
    hint.style.display = txt && visible ? 'block' : 'none';
  };
  // L'ancien <div id="hud"> (aide permanente) est masqué : les textes contextuels passent par setHint, les touches par l'aide F1.
  const oldHud = $('hud');
  if (oldHud) oldHud.style.display = 'none';
  const oldPlayers = $('players');
  if (oldPlayers) oldPlayers.style.display = 'none';

  function drawMap(s: HudState, me: PrivateState | null) {
    const now = performance.now();
    if (now - lastMapDraw < 50) return;
    lastMapDraw = now;
    const W = map.width;
    const base = cityMapCanvas(MAP_BASE, false);
    const k = MAP_BASE / (2 * MAP_EXTENT);
    g.fillStyle = '#2a8fe0';
    g.fillRect(0, 0, W, W);
    const x = s.x!, z = s.z!;
    // zone source clipée aux bords du fond (la partie hors de la carte reste de l'eau)
    let sx = worldToMap(x - MAP_RADIUS, MAP_BASE), sy = worldToMap(z - MAP_RADIUS, MAP_BASE);
    const sw = MAP_RADIUS * 2 * k;
    let dx = 0, dy = 0, dw = W, dh = W, w = sw, h = sw;
    if (sx < 0) { dx = (-sx / sw) * W; dw -= dx; w += sx; sx = 0; }
    if (sy < 0) { dy = (-sy / sw) * W; dh -= dy; h += sy; sy = 0; }
    if (sx + w > MAP_BASE) { const ex = sx + w - MAP_BASE; dw -= (ex / sw) * W; w -= ex; }
    if (sy + h > MAP_BASE) { const ey = sy + h - MAP_BASE; dh -= (ey / sw) * W; h -= ey; }
    if (w > 1 && h > 1) g.drawImage(base, sx, sy, w, h, dx, dy, dw, dh);
    const toPx = (wx: number, wz: number): [number, number] => [((wx - x) / (MAP_RADIUS * 2) + 0.5) * W, ((wz - z) / (MAP_RADIUS * 2) + 0.5) * W];
    const dot = (wx: number, wz: number, color: string, r: number, clamp: boolean) => {
      let [px, py] = toPx(wx, wz);
      const m = r + 4;
      if (px < m || px > W - m || py < m || py > W - m) {
        if (!clamp) return;
        px = Math.max(m, Math.min(W - m, px)); py = Math.max(m, Math.min(W - m, py));
      }
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2);
      g.fillStyle = color; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#14141f'; g.stroke();
    };
    if (me) for (const m of me.marks as readonly Mark[]) {
      const st = MARK_STYLE[m.k] ?? MARK_STYLE.autre;
      dot(m.x, m.z, st.color, 9, m.k === 'mission' || m.k === 'cible');
    }
    for (const mate of s.mates ?? []) dot(mate.x, mate.z, mate.name ? `#${playerColor(mate.name).toString(16).padStart(6, '0')}` : '#4dabf7', 8, false);
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(-(s.yaw ?? 0));
    g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath();
    g.fillStyle = '#ff3b30'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
    g.lineWidth = 2; g.strokeStyle = '#14141f'; g.stroke();
    g.restore();
  }

  function applyStars(stars: number, progress: number) {
    // Si la recherche vient de tomber à 0 : « Semé » 3 s (puis la rangée disparaît ; au repos, aucune étoile à l'écran)
    if (lastStars > 0 && stars === 0) semeT = 3;
    lastStars = stars;
    const showSeme = stars === 0 && semeT > 0;
    const lab = showSeme ? { text: 'Semé', kind: 'seme' as SearchKind } : searchLabel(stars, searchState, copsSeen);
    starsEl.classList.toggle('on', stars > 0 || showSeme);
    sLabel.style.display = lab ? '' : 'none';
    if (lab) { sLabel.textContent = lab.text; sLabel.className = 'gh-slabel ' + lab.kind; }
    const seen = lab?.kind === 'repere';
    const hidden = lab?.kind === 'cache';
    starNodes.forEach((s, i) => {
      s.classList.toggle('on', i < stars);
      s.classList.toggle('cop', seen && i < stars); // crans allumés alternés rouge/bleu tant qu'un flic voit le joueur
      s.classList.toggle('dim', hidden && i < stars);
      s.classList.toggle('blink', lab?.kind === 'recherche' && i === stars - 1);
    });
    starRow.style.display = stars > 0 ? '' : 'none';
    progFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    prog.style.display = stars > 0 ? '' : 'none';
  }

  function applyMe(me: PrivateState) {
    const m = Math.round(me.money);
    if (m !== lastMoney) {
      moneyText.textContent = `${m.toLocaleString('fr-FR')} €`;
      if (lastMoney >= 0 && m !== lastMoney) {
        const d = document.createElement('span');
        d.className = 'gh-delta ' + (m > lastMoney ? 'up' : 'down');
        d.textContent = `${m > lastMoney ? '+' : '−'}${Math.abs(m - lastMoney).toLocaleString('fr-FR')} €`;
        money.appendChild(d);
        setTimeout(() => d.remove(), 1500);
      }
      lastMoney = m;
    }
    applyStars(Math.max(0, Math.min(5, Math.round(me.stars))), me.starProgress);
    const d = DISTRICTS[me.district];
    if (d && me.district !== lastDistrict) {
      if (lastDistrict) {
        banner.textContent = d.name.toUpperCase();
        const sub = document.createElement('small');
        sub.textContent = d.gangName;
        banner.appendChild(sub);
        banner.style.background = hex(d.color);
        banner.style.opacity = '1';
        bannerT = 3;
      }
      lastDistrict = me.district;
      mapBox.title = `${d.name} (${d.gangName})`;
    }
    const ms = me.mission, ac = me.activity;
    if (ms) {
      objBox.style.display = 'block';
      objTag.textContent = 'MISSION';
      objText.textContent = ms.text;
      const left = ms.timeLimitMs ? ms.timeLimitMs - ms.ms : 0;
      const step = ms.steps > 1 ? `Étape ${Math.min(ms.step, ms.steps)} sur ${ms.steps}` : '';
      const time = ms.timeLimitMs ? `Temps : ${fmtMs(Math.max(0, left))}` : '';
      objSub.textContent = [step, time].filter(Boolean).join(' · ');
      objSub.className = 'gh-osub' + (ms.timeLimitMs && left < 30000 ? ' low' : '');
      objSub.style.display = objSub.textContent ? '' : 'none';
    } else if (ac) {
      objBox.style.display = 'block';
      objTag.textContent = ACTIVITY_NAMES[ac.kind] ?? ac.kind.toUpperCase();
      objText.textContent = ac.text;
      objSub.className = 'gh-osub';
      objSub.textContent = `Score : ${ac.score}`;
      objSub.style.display = '';
    } else objBox.style.display = 'none';
  }

  function refreshPlayers() {
    playersEl.style.display = visible && (playersForced || playersT > 0) && playersEl.textContent ? 'block' : 'none';
  }

  return {
    setVisible(v: boolean) {
      visible = v;
      for (const e of [crosshair, vitals]) if (e) e.style.display = v ? '' : 'none';
      root.style.display = v ? '' : 'none';
      hint.style.display = v && hint.textContent ? 'block' : 'none';
    },
    /** Met à jour tout le HUD. `me` : dernier état privé (null tant qu'aucun n'est reçu). */
    update(s: HudState, me?: PrivateState | null) {
      crosshair?.classList.toggle('veh', s.inVehicle);
      const hp = Math.max(0, Math.min(100, s.hp));
      if (hpFill) {
        hpFill.style.width = hp + '%';
        hpFill.style.background = hp > 55 ? '#4cd964' : hp > 25 ? '#ffcc00' : '#ff3b30';
      }
      if (hpText) hpText.textContent = String(Math.ceil(hp));
      if (vehBox) vehBox.style.display = s.vehHp === null ? 'none' : '';
      if (s.vehHp !== null && vehFill && vehLabel) {
        const v = Math.max(0, Math.min(1, s.vehHp));
        vehFill.style.width = v * 100 + '%';
        vehFill.style.background = v > 0.5 ? '#4cd964' : v > 0.25 ? '#ffcc00' : '#ff3b30';
        vehLabel.textContent = s.vehName;
      }
      if (!visible) return;
      copsSeen = s.cops;
      searchState = s.search;
      if (me) applyMe(me);
      const hasPos = Number.isFinite(s.x) && Number.isFinite(s.z);
      mapBox.style.display = hasPos ? '' : 'none';
      if (hasPos) drawMap(s, me ?? null);
    },
    /** Bandeau temporaire (texte brut, 2 au plus : le plus ancien disparaît). */
    toast(text: string, ms = 3000) {
      const txt = String(text).slice(0, 90);
      if (alertT > 0 && alertText && txt.toLowerCase().replace(/[ !.]/g, '').includes(alertText)) return; // déjà dit par la vignette d'alerte
      for (const c of Array.from(top.children) as HTMLElement[]) {
        if (c.textContent === txt) { // même toast : on prolonge au lieu de dupliquer
          clearTimeout(Number(c.dataset.t));
          c.dataset.t = String(setTimeout(() => c.remove(), ms));
          return;
        }
      }
      const t = document.createElement('div');
      t.className = 'gh-box gh-toast';
      t.textContent = txt;
      top.appendChild(t);
      while (top.children.length > MAX_TOASTS) top.firstElementChild?.remove();
      t.dataset.t = String(setTimeout(() => t.remove(), ms));
    },
    setHint,
    /** Décale les toasts vers le bas (px) : le guide occupe le haut-centre pendant le tutoriel. */
    topOffset(px: number) { top.style.top = `${14 + Math.max(0, px)}px`; },
    /** Liste des joueurs (une ligne chacun). Réaffichée 5 s quand elle change ; `showPlayers(true)` la maintient. */
    setPlayers(lines: readonly string[]) {
      const txt = lines.slice(0, 12).join('\n');
      const key = lines.length > 1 ? txt : ''; // seul : rien à lister
      playersEl.textContent = lines.length > 1 ? txt : '';
      if (key !== playersKey) { playersKey = key; if (key) playersT = 5; }
      refreshPlayers();
    },
    showPlayers(v: boolean) { playersForced = v; refreshPlayers(); },
    /** Vignette d'alerte plein écran (bleue : arrêté ; rouge : K.O.). */
    alert(kind: 'arrete' | 'ko', ms = 3200) {
      alertEl.className = 'gh-alert ' + kind;
      alertMain.textContent = kind === 'ko' ? 'K.O. !' : 'ARRÊTÉ !';
      alertSub.textContent = kind === 'ko' ? "Direction l'hôpital..." : 'Les flics te passent les menottes';
      alertText = kind === 'ko' ? 'ko' : 'arrêté';
      alertEl.style.display = 'flex';
      requestAnimationFrame(() => { alertEl.style.opacity = '1'; });
      alertT = ms / 1000;
    },
    /** Flash rouge de dégâts (1 = mort). */
    flash(strength: number) {
      flashT = Math.max(flashT, strength);
      if (damage) damage.style.opacity = String(Math.min(0.75, flashT * 0.6));
    },
    tick(dt: number) {
      if (flashT > 0) {
        flashT = Math.max(0, flashT - dt * 1.4);
        if (damage) damage.style.opacity = String(Math.min(0.75, flashT * 0.6));
      }
      if (alertT > 0) {
        alertT -= dt;
        if (alertT <= 0) { alertEl.style.opacity = '0'; setTimeout(() => { if (alertT <= 0) alertEl.style.display = 'none'; }, 300); }
      }
      if (bannerT > 0) {
        bannerT -= dt;
        if (bannerT <= 0) banner.style.opacity = '0';
      }
      if (semeT > 0) { semeT -= dt; if (semeT <= 0) applyStars(0, 0); }
      if (playersT > 0) { playersT -= dt; if (playersT <= 0) refreshPlayers(); }
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
