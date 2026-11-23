// Vignettes BD (PROPRIÉTAIRE : art-toon) : planches fixes dessinées en canvas (encre épaisse, aplats, trame de points) avec bulles de dialogue
// et texte qui s'écrit. Aucune cinématique, aucun fichier image. Tout texte passe par le canvas ou `textContent`.
//
// API :
//   registerVignettes('intro', [{ img: 'ville_aube', text: '...', who: 'Léa' }, ...])   // scripts (missions : un id par planche, vague 4)
//   showVignettes('intro').then(...)                                                      // événement serveur { k: 'vignettes', id } ; id inconnu : résolu aussitôt
//   playComic(panels)                                                                     // lecture directe
//   Clic / Espace / Entrée : suite (d'abord termine le texte) · Échap ou « Passer » : fin.
// Images génériques disponibles (`COMIC_IMAGES`) : ville_aube, rue_nuit, voiture, poursuite, ruelle, amphi, liasses, explosion.

export const COMIC_IMAGES = ['ville_aube', 'rue_nuit', 'voiture', 'poursuite', 'ruelle', 'amphi', 'liasses', 'explosion'] as const;
export type ComicImage = (typeof COMIC_IMAGES)[number];
/** Une case : image (un des `COMIC_IMAGES`), texte, qui parle (bulle) ; sans `who` : récitatif jaune. */
export interface Panel { img: ComicImage | string; text: string; who?: string }

const W = 960, H = 540;
const INK = '#14141f';
const registry = new Map<string, Panel[]>();
/** Enregistre un script de vignettes sous un identifiant. */
export function registerVignettes(id: string, panels: Panel[]): void { registry.set(id, panels); }

registerVignettes('intro', [
  { img: 'ville_aube', text: "Une nouvelle journée se lève sur la ville. Cinq quartiers, cinq bandes, et une rentrée qui s'annonce mouvementée." },
  { img: 'ruelle', who: 'Le contact', text: "Psst. T'as l'air d'avoir besoin de sous. J'ai des caisses de café de la machine à écouler." },
  { img: 'voiture', who: 'Toi', text: "Café de la machine ? C'est légal, ça ?" },
  { img: 'poursuite', who: 'Le contact', text: "Légal, non. Mais personne n'a jamais osé le goûter pour vérifier." },
]);

// ---------- Outils de dessin ----------
type G = CanvasRenderingContext2D;
const ink = (g: G, w = 6) => { g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; };
const fillStroke = (g: G, color: string, w = 6) => { g.fillStyle = color; g.fill(); ink(g, w); g.stroke(); };
const rect = (g: G, x: number, y: number, w: number, h: number, color: string, lw = 6) => { g.beginPath(); g.rect(x, y, w, h); fillStroke(g, color, lw); };
const poly = (g: G, pts: number[][], color: string, lw = 6) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); fillStroke(g, color, lw); };
const circle = (g: G, x: number, y: number, r: number, color: string, lw = 6) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fillStroke(g, color, lw); };
function dots(g: G, x: number, y: number, w: number, h: number, color = 'rgba(20,20,31,.28)', step = 12, r = 2.6) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = color;
  for (let j = 0, yy = y; yy < y + h; yy += step, j++) for (let xx = x + (j % 2) * (step / 2); xx < x + w; xx += step) { g.beginPath(); g.arc(xx, yy, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
}
function burst(g: G, cx: number, cy: number, r1: number, r2: number, n: number, color: string, rot = 0, lw = 6) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot + (i / (n * 2)) * Math.PI * 2, r = i % 2 ? r1 : r2; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath(); fillStroke(g, color, lw);
}
function windows(g: G, x: number, y: number, w: number, h: number, on: string, off: string, seed: number) {
  for (let yy = y + 14; yy < y + h - 18; yy += 26) for (let xx = x + 12; xx < x + w - 18; xx += 24) {
    const lit = ((Math.floor(xx * 7 + yy * 13) + seed) % 5) < 2;
    rect(g, xx, yy, 13, 15, lit ? on : off, 3);
  }
}
function carSide(g: G, x: number, y: number, s: number, body: string, flip = false) {
  g.save(); g.translate(x, y); g.scale(flip ? -s : s, s);
  poly(g, [[-120, 0], [-120, -32], [-90, -38], [-60, -72], [30, -72], [70, -40], [118, -32], [124, 0]], body, 6 / s);
  poly(g, [[-50, -64], [-18, -64], [-18, -40], [-72, -40]], '#bfe9ff', 5 / s);
  poly(g, [[-8, -64], [28, -64], [56, -40], [-8, -40]], '#bfe9ff', 5 / s);
  circle(g, -72, 2, 22, '#2a2a35', 6 / s); circle(g, -72, 2, 9, '#d9d9e2', 4 / s);
  circle(g, 76, 2, 22, '#2a2a35', 6 / s); circle(g, 76, 2, 9, '#d9d9e2', 4 / s);
  rect(g, 108, -30, 14, 10, '#fff3a0', 3 / s);
  g.restore();
}
const figure = (g: G, x: number, y: number, s: number, coat: string, hood = false) => {
  g.save(); g.translate(x, y); g.scale(s, s);
  poly(g, [[-26, 0], [-34, -90], [-18, -118], [18, -118], [34, -90], [26, 0]], coat, 6 / s);
  circle(g, 0, -140, 22, '#f1c27d', 6 / s);
  if (hood) poly(g, [[-26, -140], [-20, -166], [20, -166], [26, -140], [14, -150], [-14, -150]], coat, 6 / s);
  g.restore();
};

// ---------- Les 8 images ----------
const IMAGES: Record<ComicImage, (g: G, t: number) => void> = {
  ville_aube(g) {
    for (let i = 0; i < 6; i++) rect(g, 0, i * 60, W, 62, ['#ffdd6e', '#ffc85a', '#ffb347', '#ff9a4d', '#ff8060', '#f0646e'][i], 0);
    burst(g, 700, 190, 90, 150, 14, '#fff3b0', 0.2, 5);
    circle(g, 700, 190, 80, '#fffbe0', 6);
    const bs = [[30, 250, 110, 290], [150, 200, 120, 340], [280, 280, 100, 260], [390, 170, 130, 370], [530, 250, 110, 290], [650, 210, 120, 330], [780, 270, 150, 270]];
    bs.forEach(([x, y, w, h], i) => { rect(g, x, y, w, h, ['#5b5f97', '#4a4e86', '#6b6fa8'][i % 3]); dots(g, x, y, w, h, 'rgba(20,20,31,.25)', 10); windows(g, x, y, w, h, '#ffe27a', '#35385f', i); });
    rect(g, 0, 470, W, 70, '#3a3b4f'); for (let x = 20; x < W; x += 110) rect(g, x, 500, 60, 8, '#f0f0f0', 3);
  },
  rue_nuit(g) {
    rect(g, 0, 0, W, H, '#16183a', 0);
    dots(g, 0, 0, W, 300, 'rgba(255,255,255,.12)', 18, 2);
    circle(g, 150, 100, 54, '#fff6c8'); circle(g, 130, 88, 10, '#e9e0a8', 3);
    [[0, 180, 200, 360], [230, 120, 170, 420], [430, 210, 150, 330], [610, 140, 180, 400], [820, 200, 150, 340]].forEach(([x, y, w, h], i) => { rect(g, x, y, w, h, i % 2 ? '#262a5a' : '#30346a'); windows(g, x, y, w, h, '#ffd966', '#171a3d', i * 3); });
    poly(g, [[560, 150], [440, 470], [700, 470]], 'rgba(255,230,140,.35)', 0);
    rect(g, 555, 140, 10, 340, '#0d0e22', 0); rect(g, 530, 130, 70, 18, '#0d0e22', 0); circle(g, 565, 150, 16, '#fff3a0', 5);
    rect(g, 0, 470, W, 70, '#23253d'); g.beginPath(); g.ellipse(430, 505, 120, 12, 0, 0, Math.PI * 2); fillStroke(g, '#3b4f8e', 4);
  },
  voiture(g, t) {
    rect(g, 0, 0, W, H, '#ffe27a', 0);
    burst(g, 480, 300, 280, 700, 28, '#ffb830', t * 0.05, 0);
    for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(40 + i * 40 + ((t * 600) % 60), 90 + (i % 5) * 90); g.lineTo(240 + i * 40 + ((t * 600) % 60), 90 + (i % 5) * 90); ink(g, 7); g.stroke(); }
    rect(g, 0, 400, W, 140, '#4a4c5e'); dots(g, 0, 400, W, 140, 'rgba(0,0,0,.25)', 12);
    carSide(g, 500, 440, 2.2, '#e74c3c');
  },
  poursuite(g, t) {
    rect(g, 0, 0, W, H, '#232650', 0);
    burst(g, 480, 270, 160, 560, 20, '#2d3170', 0, 0);
    const a = Math.floor(t * 6) % 2;
    circle(g, 200, 250, 150, a ? 'rgba(255,60,60,.4)' : 'rgba(60,110,255,.4)', 0); circle(g, 760, 250, 150, a ? 'rgba(60,110,255,.4)' : 'rgba(255,60,60,.4)', 0);
    rect(g, 0, 400, W, 140, '#3a3c52');
    carSide(g, 270, 430, 1.7, '#f4f4f8', true); carSide(g, 700, 440, 1.9, '#2f80ed');
    rect(g, 220, 346, 40, 12, a ? '#ff3b3b' : '#3b6bff', 4); rect(g, 262, 346, 40, 12, a ? '#3b6bff' : '#ff3b3b', 4);
    for (let i = 0; i < 3; i++) { g.save(); g.translate(430 + i * 60, 90); g.font = '900 54px Impact,sans-serif'; ink(g, 8); g.strokeText('★', 0, 0); g.fillStyle = '#ffd23f'; g.fillText('★', 0, 0); g.restore(); }
  },
  ruelle(g) {
    rect(g, 0, 0, W, H, '#8a4b3d', 0);
    for (let y = 0; y < 400; y += 36) for (let x = (y / 36) % 2 ? -40 : 0; x < W; x += 80) rect(g, x, y, 80, 36, '#a85a47', 3);
    dots(g, 0, 0, W, 400, 'rgba(20,20,31,.2)', 11);
    poly(g, [[470, 0], [270, 540], [680, 540]], 'rgba(255,230,140,.28)', 0);
    rect(g, 0, 400, W, 140, '#38384b');
    rect(g, 700, 330, 150, 100, '#c58a4a'); rect(g, 700, 330, 150, 20, '#a96f35'); rect(g, 790, 280, 100, 70, '#d29a58');
    figure(g, 330, 470, 1.9, '#2a2438', true); figure(g, 590, 470, 1.9, '#5a7bd0');
    rect(g, 458, 285, 24, 16, '#8bd13f', 4);
  },
  amphi(g) {
    rect(g, 0, 0, W, H, '#e9dcc0', 0);
    rect(g, 250, 40, 460, 150, '#2f5f4a'); rect(g, 250, 40, 460, 150, 'rgba(0,0,0,0)', 8);
    g.beginPath(); g.moveTo(290, 100); g.quadraticCurveTo(350, 60, 420, 110); g.quadraticCurveTo(500, 150, 560, 90); ink(g, 5); g.strokeStyle = '#f4f4f4'; g.stroke();
    for (let r = 0; r < 5; r++) {
      const y = 250 + r * 56;
      rect(g, 40, y, W - 80, 36, ['#c9a56a', '#b8955a', '#a9864d', '#9a7842', '#8b6b38'][r]);
      dots(g, 40, y, W - 80, 36, 'rgba(20,20,31,.2)', 9);
      for (let x = 100 + (r % 2) * 40; x < W - 100; x += 110) { circle(g, x, y - 12, 15, ['#f1c27d', '#c68642', '#e0a370', '#8d5524'][(x / 110 + r) % 4 | 0], 4); rect(g, x - 18, y, 36, 26, ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b'][(x / 55 + r) % 4 | 0], 4); }
    }
  },
  liasses(g, t) {
    rect(g, 0, 0, W, H, '#1f6f4a', 0);
    burst(g, 480, 270, 200, 700, 22, '#27895a', t * 0.04, 0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const x = 250 + i * 120 + (j % 2) * 30, y = 360 - j * 70;
      rect(g, x, y, 150, 62, '#8ed081'); rect(g, x + 10, y + 8, 130, 46, '#b6e8a8', 3); circle(g, x + 75, y + 31, 15, '#8ed081', 3);
      g.font = '900 24px sans-serif'; g.fillStyle = INK; g.textAlign = 'center'; g.fillText('€', x + 75, y + 40);
    }
    g.font = '900 120px Impact,sans-serif'; ink(g, 12); g.textAlign = 'center'; g.strokeText('€€€', 480, 170); g.fillStyle = '#ffd23f'; g.fillText('€€€', 480, 170);
  },
  explosion(g, t) {
    rect(g, 0, 0, W, H, '#ffe27a', 0);
    burst(g, 480, 280, 140, 380, 11, '#ff8a2a', t * 0.3, 8);
    burst(g, 480, 280, 90, 250, 9, '#ffd23f', -t * 0.2, 6);
    burst(g, 480, 280, 50, 140, 8, '#fffbe0', t * 0.4, 5);
    g.save(); g.translate(480, 300); g.rotate(-0.1); g.font = '900 130px Impact,sans-serif'; g.textAlign = 'center'; ink(g, 16); g.strokeText('BOUM !', 0, 0); g.fillStyle = '#e63946'; g.fillText('BOUM !', 0, 0); g.restore();
  },
};

/** Dessine une image générique sur `g` (960×540). `t` : temps en secondes (animations légères). Identifiant inconnu : fond neutre. */
export function drawComicImage(g: G, img: string, t = 0): void {
  const fn = (IMAGES as Record<string, (g: G, t: number) => void>)[img];
  g.save();
  if (fn) fn(g, t); else { g.fillStyle = '#d8d3c2'; g.fillRect(0, 0, W, H); dots(g, 0, 0, W, H); }
  g.restore();
}

function wrap(g: G, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? line + ' ' + word : word;
    if (g.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
  }
  if (line) out.push(line);
  return out;
}

/** Dessine la bulle (ou le récitatif) avec les `shown` premiers caractères. */
export function drawBubble(g: G, panel: Panel, shown: number): void {
  const text = panel.text.slice(0, shown);
  g.font = '700 26px "Comic Sans MS","Segoe UI",sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'top';
  const full = wrap(g, panel.text, 700);
  const lines = wrap(g, text, 700);
  const lh = 32, bw = 740, bh = full.length * lh + 30;
  const bx = panel.who ? 110 : 50, by = panel.who ? H - bh - 40 : 28;
  g.save();
  if (panel.who) {
    g.beginPath();
    g.roundRect(bx, by, bw, bh, 28);
    g.moveTo(bx + 70, by + bh - 2); g.lineTo(bx + 40, by + bh + 36); g.lineTo(bx + 120, by + bh - 2);
    g.fillStyle = '#fff'; g.fill(); ink(g, 5); g.stroke();
    g.beginPath(); g.roundRect(bx + 4, by + 4, bw - 8, bh - 8, 24); g.fillStyle = '#fff'; g.fill();
    g.font = '900 22px "Segoe UI",sans-serif';
    const tag = panel.who.toUpperCase().slice(0, 28);
    const tw = g.measureText(tag).width + 28;
    g.beginPath(); g.rect(bx + 20, by - 30, tw, 34); g.fillStyle = '#ffd23f'; g.fill(); ink(g, 4); g.stroke();
    g.fillStyle = INK; g.fillText(tag, bx + 34, by - 25);
  } else {
    g.beginPath(); g.rect(bx, by, bw, bh); g.fillStyle = '#ffe27a'; g.fill(); ink(g, 5); g.stroke();
  }
  g.fillStyle = INK;
  g.font = '700 26px "Comic Sans MS","Segoe UI",sans-serif';
  lines.forEach((l, i) => g.fillText(l, bx + 24, by + 16 + i * lh));
  g.restore();
}

let chain: Promise<void> = Promise.resolve();
/** Joue des vignettes à la suite (les lectures simultanées sont mises en file). */
export function playComic(panels: Panel[]): Promise<void> {
  if (!panels.length) return Promise.resolve();
  chain = chain.then(() => run(panels));
  return chain;
}

/** Affiche la planche `id` (script enregistré par `registerVignettes`). Id inconnu : rien, résolu aussitôt. */
export function showVignettes(id: string): Promise<void> {
  const s = registry.get(String(id));
  return s ? playComic(s) : Promise.resolve();
}

function run(panels: Panel[]): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(10,10,22,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:"Segoe UI",sans-serif;cursor:pointer';
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = 'width:min(96vw,calc(86vh*16/9));height:auto;border:8px solid #000;border-radius:6px;box-shadow:10px 10px 0 #000;background:#fff';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:16px;align-items:center;color:#c9cbe8;font-weight:700;font-size:14px';
    const hint = document.createElement('span');
    hint.textContent = 'Clic ou Espace : suite';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Passer';
    skip.style.cssText = 'padding:5px 14px;border:3px solid #000;border-radius:8px;background:#ffd23f;font-weight:900;cursor:pointer';
    bar.append(hint, skip);
    overlay.append(canvas, bar);
    document.body.appendChild(overlay);
    const g = canvas.getContext('2d')!;
    let i = 0, t0 = performance.now(), raf = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const total = () => panels[i].text.length;
    const shownAt = (now: number) => Math.min(total(), Math.floor(((now - t0) / 1000) * 48));
    const next = () => {
      const now = performance.now();
      if (shownAt(now) < total()) { t0 = now - total() * 30; return; }
      if (++i >= panels.length) return finish();
      t0 = now;
    };
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); finish(); }
      else if (e.code === 'Space' || e.code === 'Enter') { e.stopImmediatePropagation(); e.preventDefault(); next(); }
    }
    addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', next);
    skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
    const frame = (now: number) => {
      if (done) return;
      const p = panels[i];
      const t = (now - t0) / 1000;
      g.save();
      const z = 1 + Math.min(0.05, t * 0.012); // léger travelling avant
      g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
      drawComicImage(g, p.img, t);
      g.restore();
      drawBubble(g, p, shownAt(now));
      hint.textContent = `${i + 1} / ${panels.length} · Clic ou Espace : suite`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
