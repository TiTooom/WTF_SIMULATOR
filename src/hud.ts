// Interface en jeu (PROPRIÉTAIRE : art-toon) : viseur, barres de vie (joueur, véhicule), flash de dégâts (éléments d'index.html, repris tels quels)
// + HUD de ville créé ici en DOM : argent, étoiles de recherche (+ progression), quartier, mini-carte, objectif de mission, toasts. Aucun `innerHTML`.
//
// API pour main.ts :
//   const hud = createHud();                       // une fois (inchangé)
//   hud.update({ hp, vehHp, vehName, inVehicle, x, z, yaw, mates? }, me);   // chaque image ; `me` = dernier PrivateState (null avant le premier message `me`)
//        x, z, yaw : position et cap du joueur (ou du véhicule) pour la mini-carte ; mates : coéquipiers [{ x, z, name }]
//   hud.toast('texte', 3500);                      // SEUL chemin des bandeaux (SMS, médaille...) : un texte identique déjà affiché est prolongé, jamais dupliqué
//   hud.alert('arrete' | 'ko', 3200);              // vignette d'alerte (remplace le toast « Arrêté ! » / « K.O. ! » : toast équivalent ignoré pendant l'alerte)
//   hud.setHint('texte');                          // aide contextuelle (une seule zone, haut gauche). Le texte du <div id="hud"> d'index.html y est recopié
//                                                  // automatiquement et l'original est masqué : plus de double affichage.
//   hud.flash(force) ; hud.tick(dt) ; hud.setVisible(bool)
//   HudState.cops : nombre de flics à vue (copsInSight(...) ci-dessous) ; défini => les étoiles alternent rouge/bleu seulement si cops > 0.
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

const CSS = `
#gta-hud{position:fixed;inset:0;pointer-events:none;z-index:6;font-family:"Segoe UI",Verdana,sans-serif;font-weight:900}
#gta-hud .gh-right{position:absolute;right:14px;bottom:18px;display:flex;flex-direction:column;align-items:flex-end;gap:7px}
#gta-hud .gh-stars{display:flex;gap:3px;align-items:center}
#gta-hud .gh-star{font-size:30px;line-height:1;color:#2b2b3d;-webkit-text-stroke:2px #000;text-shadow:2px 2px 0 #000}
#gta-hud .gh-star.on{color:#ffd23f}
#gta-hud .gh-star.blink{animation:ghblink .5s steps(2,jump-none) infinite}
@keyframes ghblink{50%{opacity:.25}}
#gta-hud .gh-prog{width:150px;height:8px;border:3px solid #000;border-radius:6px;background:#2b2b3d;overflow:hidden;box-shadow:2px 2px 0 #000}
#gta-hud .gh-prog>div{height:100%;width:0;background:#e63946}
#gta-hud .gh-money{position:relative;font-size:30px;color:#ffd23f;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:3px 3px 0 #000;letter-spacing:.02em}
#gta-hud .gh-delta{position:absolute;right:0;top:-6px;font-size:22px;animation:ghfloat 1.4s ease-out forwards;white-space:nowrap}
#gta-hud .gh-delta.up{color:#69db7c}#gta-hud .gh-delta.down{color:#ff6b6b}
@keyframes ghfloat{from{transform:translateY(0);opacity:1}to{transform:translateY(-34px);opacity:0}}
#gta-hud .gh-map{width:${MAP_PX}px;height:${MAP_PX}px;border:5px solid #000;border-radius:16px;box-shadow:5px 5px 0 #000;background:#2a8fe0;overflow:hidden}
#gta-hud .gh-map canvas{display:block;width:100%;height:100%}
#gta-hud .gh-district{padding:2px 12px;border:4px solid #000;border-radius:8px;font-size:14px;color:#fff;text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;box-shadow:3px 3px 0 #000;max-width:${MAP_PX + 10}px;text-align:center}
#gta-hud .gh-top{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(560px,70vw)}
#gta-hud .gh-box{padding:7px 16px;border:4px solid #000;border-radius:10px;background:#fff6dc;color:#1b1b2b;font-size:16px;box-shadow:4px 4px 0 #000;text-align:center}
#gta-hud .gh-mission{display:none}
#gta-hud .gh-mission small{display:block;font-size:12px;color:#5a5d7a}
#gta-hud .gh-toast{background:#ffd23f;animation:ghpop .25s ease-out}
@keyframes ghpop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
#gta-hud .gh-banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:6px 26px;border:5px solid #000;border-radius:12px;font-size:30px;color:#fff;text-shadow:3px 3px 0 #000;box-shadow:6px 6px 0 #000;opacity:0;transition:opacity .5s;text-align:center;white-space:nowrap}
#gta-hud .gh-banner small{display:block;font-size:14px}
#gta-hud .gh-star.cop{animation:ghcop .45s steps(2,jump-none) infinite}
@keyframes ghcop{0%{color:#ff3b30}50%{color:#3b82ff}}
#gta-hud .gh-hint{position:absolute;left:14px;top:12px;max-width:min(520px,45vw);padding:6px 12px;border:3px solid #000;border-radius:10px;background:rgba(255,246,220,.92);color:#1b1b2b;font-size:13px;font-weight:800;white-space:pre-wrap;box-shadow:3px 3px 0 #000;display:none}
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
  const starNodes: HTMLSpanElement[] = [];
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.className = 'gh-star';
    s.textContent = '★';
    starsEl.appendChild(s);
    starNodes.push(s);
  }
  const prog = document.createElement('div'); prog.className = 'gh-prog';
  const progFill = document.createElement('div'); prog.appendChild(progFill);
  const money = document.createElement('div'); money.className = 'gh-money';
  const moneyText = document.createElement('span');
  money.appendChild(moneyText);
  const mapBox = document.createElement('div'); mapBox.className = 'gh-map';
  const map = document.createElement('canvas');
  map.width = map.height = MAP_PX * 2;
  mapBox.appendChild(map);
  const districtTag = document.createElement('div'); districtTag.className = 'gh-district';
  right.append(starsEl, prog, money, mapBox, districtTag);
  const top = document.createElement('div'); top.className = 'gh-top';
  const missionBox = document.createElement('div'); missionBox.className = 'gh-box gh-mission';
  const missionMain = document.createElement('div');
  const missionSub = document.createElement('small');
  missionBox.append(missionMain, missionSub);
  top.appendChild(missionBox);
  const banner = document.createElement('div'); banner.className = 'gh-banner';
  const hint = document.createElement('div'); hint.className = 'gh-hint';
  const alertEl = document.createElement('div'); alertEl.className = 'gh-alert';
  const alertMain = document.createElement('b'), alertSub = document.createElement('small');
  alertEl.append(alertMain, alertSub);
  root.append(right, top, banner, hint, alertEl);
  document.body.appendChild(root);

  const g = map.getContext('2d')!;
  let lastMapDraw = 0;
  let lastMoney = -1;
  let lastDistrict = '';
  let bannerT = 0;
  let visible = true;
  let lastStars = -1;
  let copsSeen: number | undefined;
  let alertT = 0;
  let alertText = '';
  const setHint = (t: string) => {
    if (hint.textContent === t) return;
    hint.textContent = t;
    hint.style.display = t && visible ? 'block' : 'none';
  };
  // Une seule zone d'aide : on recopie le texte du <div id="hud"> (écrit par main.ts) et on masque l'original.
  const oldHud = $('hud');
  if (oldHud) {
    oldHud.style.display = 'none';
    new MutationObserver(() => setHint(oldHud.textContent ?? '')).observe(oldHud, { childList: true, characterData: true, subtree: true });
  }

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
    const stars = Math.max(0, Math.min(5, Math.round(me.stars)));
    if (stars !== lastStars) {
      lastStars = stars;
    }
    const seen = copsSeen === undefined ? stars > 0 : copsSeen > 0;
    starNodes.forEach((s, i) => {
      s.classList.toggle('on', i < stars);
      s.classList.toggle('cop', seen && i < stars); // crans allumés alternés rouge/bleu tant qu'un flic voit le joueur
      s.classList.toggle('blink', !seen && stars > 0 && i === stars - 1); // flics hors de vue : dernier cran qui clignote (recherche)
    });
    progFill.style.width = `${Math.max(0, Math.min(1, me.starProgress)) * 100}%`;
    prog.style.display = stars > 0 || me.starProgress > 0.02 ? '' : 'none';
    const d = DISTRICTS[me.district];
    if (d && me.district !== lastDistrict) {
      districtTag.textContent = d.name;
      districtTag.style.background = hex(d.color);
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
    }
    const ms = me.mission, ac = me.activity;
    if (ms) {
      missionBox.style.display = 'block';
      missionMain.textContent = ms.text;
      missionSub.textContent = `Étape ${ms.step}/${ms.steps} · ` + (ms.timeLimitMs ? `reste ${fmtMs(ms.timeLimitMs - ms.ms)}` : fmtMs(ms.ms));
    } else if (ac) {
      missionBox.style.display = 'block';
      missionMain.textContent = ac.text;
      missionSub.textContent = `${ac.kind} · score ${ac.score}`;
    } else missionBox.style.display = 'none';
  }

  return {
    setVisible(v: boolean) {
      visible = v;
      for (const e of [crosshair, vitals]) if (e) e.style.display = v ? '' : 'none';
      root.style.display = v ? '' : 'none';
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
      if (me) applyMe(me);
      const hasPos = Number.isFinite(s.x) && Number.isFinite(s.z);
      mapBox.style.display = hasPos ? '' : 'none';
      if (hasPos) drawMap(s, me ?? null);
    },
    /** Bandeau temporaire en haut de l'écran (texte brut). */
    toast(text: string, ms = 3500) {
      const txt = String(text).slice(0, 160);
      if (alertT > 0 && alertText && txt.toLowerCase().replace(/[ !.]/g, '').includes(alertText)) return; // déjà dit par la vignette d'alerte
      for (const c of Array.from(top.children) as HTMLElement[]) {
        if (c !== missionBox && c.textContent === txt) { // même toast : on prolonge au lieu de dupliquer
          clearTimeout(Number(c.dataset.t));
          c.dataset.t = String(setTimeout(() => c.remove(), ms));
          return;
        }
      }
      const t = document.createElement('div');
      t.className = 'gh-box gh-toast';
      t.textContent = txt;
      top.appendChild(t);
      while (top.children.length > 4) top.children[1]?.remove();
      t.dataset.t = String(setTimeout(() => t.remove(), ms));
    },
    setHint,
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
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
