// Vignettes BD (PROPRIÉTAIRE : art-toon) : planches fixes dessinées en canvas (encre épaisse, aplats, trame de points) avec bulles de dialogue
// et texte qui s'écrit. Aucune cinématique, aucun fichier image. Tout texte passe par le canvas ou `textContent`.
//
// API :
//   registerVignettes('intro', [{ img: 'ville_aube', text: '...', who: 'Léa' }, ...])   // scripts (missions : un id par planche, vague 4)
//   showVignettes('intro').then(...)                                                      // événement serveur { k: 'vignettes', id } ; id inconnu : résolu aussitôt
//   playComic(panels)                                                                     // lecture directe
//   Clic / Espace / Entrée : suite (d'abord termine le texte) · Échap ou « Passer » : fin.
//   showMissionResult({ title, medal, stats, reward, par? }).then(...)                    // écran de fin de mission (médaille animée, temps, dégâts, précision, gain)
// Images génériques disponibles (`COMIC_IMAGES`) : ville_aube, rue_nuit, voiture, poursuite, ruelle, amphi, liasses, explosion,
//   ambiances de quartier : campus, saint_leu, cathedrale, amiens_nord, citadelle ; scènes : amphi_nuit, dealer, flic, medaille, argent.
// `quartierImage(districtId)` donne l'ambiance d'un quartier ; `Panel.img` inconnu : fond neutre à trame (jamais d'erreur).

export const COMIC_IMAGES = [
  'ville_aube', 'rue_nuit', 'voiture', 'poursuite', 'ruelle', 'amphi', 'liasses', 'explosion',
  'campus', 'saint_leu', 'cathedrale', 'amiens_nord', 'citadelle', 'amphi_nuit', 'dealer', 'flic', 'medaille', 'argent',
] as const;
export type ComicImage = (typeof COMIC_IMAGES)[number];
/** Image d'ambiance d'un quartier (id de `DISTRICT_IDS`) ; inconnu : 'ville_aube'. */
export const quartierImage = (district: string): ComicImage => (['campus', 'saint_leu', 'cathedrale', 'amiens_nord', 'citadelle'].includes(district) ? (district as ComicImage) : 'ville_aube');
/** Une case : image (un des `COMIC_IMAGES`), texte, qui parle (bulle) ; sans `who` : récitatif jaune. */
export interface Panel {
  img: ComicImage | string; text: string; who?: string;
  /** Position de la bulle : 'haut' ou 'bas'. Absent : en bas pour un personnage qui parle (en haut pour les images dont l'action est en bas), récitatif en haut. */
  pos?: 'haut' | 'bas';
}
/** Images dont l'action se passe dans le tiers inférieur : leur bulle de dialogue passe en haut pour ne rien cacher. */
const BUBBLE_TOP = new Set(['campus', 'saint_leu', 'cathedrale', 'amiens_nord', 'citadelle', 'dealer']);

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
const IMAGES: Record<string, (g: G, t: number) => void> = {
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

// ---------- Décors réutilisables ----------
const bands = (g: G, colors: string[], y0 = 0, y1 = H) => { const h = (y1 - y0) / colors.length; colors.forEach((c, i) => rect(g, 0, y0 + i * h, W, h + 1, c, 0)); };
const cloud = (g: G, x: number, y: number, s: number, c = '#fff') => {
  g.save(); g.translate(x, y); g.scale(s, s);
  for (const [cx, cy, r] of [[0, 0, 30], [34, -10, 36], [72, 0, 28], [36, 12, 30]]) circle(g, cx, cy, r, c, 4 / s);
  g.beginPath(); g.arc(36, 6, 26, 0, 7); g.fillStyle = c; g.fill();
  g.restore();
};
const tree = (g: G, x: number, y: number, s: number, leaf = '#4cbd4c') => {
  g.save(); g.translate(x, y); g.scale(s, s);
  rect(g, -9, -50, 18, 54, '#8a5a2b', 5 / s); circle(g, 0, -86, 42, leaf, 6 / s); circle(g, -26, -62, 28, leaf, 6 / s); circle(g, 28, -66, 30, leaf, 6 / s);
  dots(g, -50, -100, 100, 50, 'rgba(20,20,31,.18)', 10);
  g.restore();
};
function text(g: G, str: string, x: number, y: number, size: number, fill: string, lw = 10, rot = 0, font = 'Impact,sans-serif') {
  g.save(); g.translate(x, y); g.rotate(rot); g.font = `900 ${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  ink(g, lw); g.strokeText(str, 0, 0); g.fillStyle = fill; g.fillText(str, 0, 0); g.restore();
}
function house(g: G, x: number, y: number, w: number, h: number, wall: string, roof: string, seed: number) {
  rect(g, x, y - h, w, h, wall); dots(g, x, y - h, w, h, 'rgba(20,20,31,.2)', 10);
  poly(g, [[x - 10, y - h], [x + w / 2, y - h - 62], [x + w + 10, y - h]], roof);
  g.beginPath(); g.moveTo(x, y - h * 0.5); g.lineTo(x + w, y - h * 0.5); ink(g, 5); g.strokeStyle = '#5a3a22'; g.stroke();
  for (let i = 0; i < 2; i++) rect(g, x + 10 + i * (w / 2), y - h + 14, w / 2 - 22, 26, (seed + i) % 3 ? '#ffe27a' : '#6ec6ff', 4);
  rect(g, x + w / 2 - 12, y - 34, 24, 34, '#6b3f1f', 4);
}
function skyscraper(g: G, x: number, y: number, w: number, h: number, c: string, seed: number) {
  rect(g, x, y, w, h, c); dots(g, x, y, w, h, 'rgba(20,20,31,.22)', 10);
  for (let yy = y + 10; yy < y + h - 14; yy += 22) for (let xx = x + 8; xx < x + w - 14; xx += 18) rect(g, xx, yy, 10, 13, ((xx * 3 + yy + seed) % 7) < 3 ? '#fff0a0' : 'rgba(180,200,255,.55)', 2);
  rect(g, x + w / 2 - 3, y - 24, 6, 24, '#14141f', 0);
}
const hood = (g: G, x: number, y: number, s: number, coat: string, eyes: string) => {
  g.save(); g.translate(x, y); g.scale(s, s);
  poly(g, [[-70, 0], [-82, -170], [-40, -250], [40, -250], [82, -170], [70, 0]], coat, 7 / s);
  poly(g, [[-42, -250], [-58, -330], [0, -362], [58, -330], [42, -250], [0, -270]], coat, 7 / s);
  poly(g, [[-30, -270], [-30, -312], [0, -326], [30, -312], [30, -270], [0, -246]], '#0c0c14', 5 / s);
  for (const ex of [-14, 14]) { g.beginPath(); g.ellipse(ex, -292, 8, 4.5, 0, 0, 7); g.fillStyle = eyes; g.fill(); }
  dots(g, -80, -250, 160, 250, 'rgba(255,255,255,.07)', 10);
  g.restore();
};
function coin(g: G, x: number, y: number, r: number) {
  circle(g, x, y, r, '#ffd23f', 5); g.beginPath(); g.arc(x, y, r * 0.62, 0, 7); ink(g, 3); g.stroke();
  text(g, '€', x, y + r * 0.34, r * 0.95, '#ffb000', 4, 0, 'sans-serif');
}

// ---------- Ambiances de quartier et scènes (10 images de plus) ----------
Object.assign(IMAGES, {
  campus(g: G, t: number) {
    bands(g, ['#7cc8ff', '#98d4ff', '#b4e0ff', '#d0ecff']); burst(g, 130, 100, 50, 84, 12, '#fff3b0', t * 0.1, 5); circle(g, 130, 100, 44, '#fffbe0');
    cloud(g, 520 + ((t * 8) % 40), 70, 1.1); cloud(g, 780, 130, 0.8);
    rect(g, 230, 190, 500, 240, '#eef7d0'); dots(g, 230, 190, 500, 240, 'rgba(20,20,31,.16)', 10);
    poly(g, [[205, 190], [480, 92], [755, 190]], '#a5d6a7');
    circle(g, 480, 150, 20, '#fffbe8', 5);
    for (let i = 0; i < 6; i++) rect(g, 252 + i * 78, 208, 30, 222, '#fffbe8', 5);
    rect(g, 436, 340, 88, 90, '#388e3c'); circle(g, 480, 340, 44, '#388e3c');
    rect(g, 290, 232, 380, 36, '#ffd23f'); text(g, 'RENTRÉE !', 480, 262, 34, '#e63946', 7);
    rect(g, 0, 420, W, 120, '#6fcf5a'); dots(g, 0, 420, W, 120, 'rgba(20,20,31,.2)', 12);
    poly(g, [[420, 430], [540, 430], [640, 540], [320, 540]], '#e9d8a6');
    tree(g, 90, 440, 1.5); tree(g, 880, 440, 1.4, '#6fdc5a');
    figure(g, 250, 520, 0.8, '#e8590c'); figure(g, 700, 525, 0.85, '#7048e8'); figure(g, 560, 515, 0.7, '#c2255c', true);
  },
  saint_leu(g: G, t: number) {
    bands(g, ['#ff9a4d', '#ffb36b', '#ffcf8a', '#ffe3a8'], 0, 330);
    burst(g, 760, 250, 40, 70, 12, '#fff3b0', t * 0.1, 0); circle(g, 760, 260, 52, '#fff0b0');
    rect(g, 0, 320, W, 220, '#2a8fe0');
    for (let i = 0; i < 14; i++) { g.beginPath(); const x = (i * 83 + t * 18) % W, y = 350 + (i % 5) * 36; g.moveTo(x, y); g.quadraticCurveTo(x + 16, y - 9, x + 32, y); ink(g, 4); g.strokeStyle = '#8fd0ff'; g.stroke(); }
    ([['#e63946', 150], ['#ffd23f', 200], ['#2ec4b6', 130], ['#ff9ec4', 180], ['#74d3ff', 150], ['#ff7a1a', 210], ['#b8e07a', 140]] as const).forEach(([c, h], i) => house(g, 55 + i * 126, 380, 96, h, c, '#7a3b2e', i));
    rect(g, 0, 380, W, 34, '#b9b4a6'); dots(g, 0, 380, W, 34, 'rgba(20,20,31,.2)', 10);
    for (let i = 0; i < 3; i++) { const x = 200 + i * 150 + Math.sin(t * 2 + i) * 14, y = 90 + i * 24; g.beginPath(); g.moveTo(x - 22, y); g.quadraticCurveTo(x - 8, y - 16, x, y); g.quadraticCurveTo(x + 8, y - 16, x + 22, y); ink(g, 5); g.strokeStyle = '#fff'; g.stroke(); }
    poly(g, [[20, 480], [340, 480], [300, 524], [60, 524]], '#14141f', 6); rect(g, 100, 440, 140, 40, '#f4f4f8'); rect(g, 130, 410, 40, 30, '#f4f4f8');
  },
  cathedrale(g: G, t: number) {
    bands(g, ['#ffe27a', '#ffeb99', '#fff3b8', '#fff8d0'], 0, 400);
    cloud(g, 90 + ((t * 6) % 30), 80, 1.0, '#fffdf0'); cloud(g, 830, 60, 0.7, '#fffdf0');
    // maisons basses sur les côtés : la cathédrale domine la planche
    house(g, 10, 400, 130, 110, '#f6e08a', '#e67e22', 0); house(g, 165, 400, 130, 130, '#fff0b0', '#c0392b', 1);
    house(g, 690, 400, 120, 125, '#f0d070', '#8e44ad', 2); house(g, 835, 400, 120, 100, '#fff0b0', '#e67e22', 3);
    // deux tours inégales, flèches, façade à rosace et portail
    rect(g, 330, 150, 100, 250, '#d8b86a'); rect(g, 530, 190, 100, 210, '#d8b86a');
    poly(g, [[320, 152], [380, 44], [440, 152]], '#8d8a9a'); poly(g, [[520, 192], [580, 104], [640, 192]], '#8d8a9a');
    rect(g, 430, 230, 100, 170, '#e6cc85'); poly(g, [[418, 232], [480, 150], [542, 232]], '#e6cc85');
    circle(g, 480, 262, 34, '#6ec6ff'); for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(480, 262); g.lineTo(480 + Math.cos(i * 0.785) * 34, 262 + Math.sin(i * 0.785) * 34); ink(g, 3); g.stroke(); }
    for (const [x, y] of [[345, 185], [395, 185], [345, 265], [395, 265], [545, 220], [595, 220], [545, 300], [595, 300]]) rect(g, x, y, 20, 52, '#5a3a22', 4);
    rect(g, 452, 345, 56, 55, '#6b3f1f'); circle(g, 480, 345, 28, '#6b3f1f');
    rect(g, 0, 400, W, 140, '#9a8f7a');
    for (let y = 404; y < 540; y += 26) for (let x = (y / 26) % 2 ? 0 : -30; x < W; x += 60) rect(g, x, y, 60, 26, '#b0a48c', 3);
    rect(g, 145, 322, 170, 40, '#ff9ec4'); text(g, 'MACARONS', 230, 352, 26, '#6b1f3a', 5);
    g.save(); g.translate(600, 470); g.beginPath(); g.ellipse(0, 0, 120, 44, 0, 0, 7); fillStroke(g, '#f4f4f8', 7); g.restore();
    for (const [x, y] of [[-62, -4], [-16, 14], [30, -10], [68, 10], [-22, -18]]) { rect(g, 600 + x - 20, 470 + y - 12, 40, 24, '#d99a3a', 4); rect(g, 600 + x - 18, 470 + y - 3, 36, 6, '#8a4b00', 0); }
  },
  amiens_nord(g: G, t: number) {
    bands(g, ['#f7a35c', '#f9b56e', '#fbc784', '#fdd99a']);
    for (let i = 0; i < 5; i++) { const k = (t * 0.4 + i * 0.2) % 1; circle(g, 190 + k * 80 + i * 8, 130 - k * 110, 22 + k * 40, `rgba(90,86,100,${0.85 - k * 0.7})`, 0); }
    for (const [x, h] of [[150, 110], [270, 150]]) { rect(g, x, h + 40, 46, 330 - h, '#e8e8ee'); for (let k = 0; k < 4; k++) rect(g, x, h + 40 + k * 70, 46, 30, '#e63946', 0); rect(g, x, h + 40, 46, 330 - h, 'rgba(0,0,0,0)', 7); }
    poly(g, [[330, 400], [330, 300], [420, 240], [420, 300], [510, 240], [510, 300], [600, 240], [600, 300], [690, 240], [690, 400]], '#9aa3b5'); dots(g, 330, 240, 360, 160, 'rgba(20,20,31,.22)', 10);
    for (let i = 0; i < 4; i++) rect(g, 360 + i * 80, 330, 40, 30, '#ffe27a', 4);
    rect(g, 690, 280, 40, 120, '#6b7280'); rect(g, 700, 220, 20, 70, '#4b5563'); rect(g, 700, 200, 120, 18, '#4b5563'); rect(g, 780, 218, 14, 50, '#4b5563');
    rect(g, 0, 400, W, 140, '#4a3a30'); dots(g, 0, 400, W, 140, 'rgba(255,255,255,.1)', 12); rect(g, 0, 400, W, 14, '#ffd23f', 0);
    for (let x = 0; x < W; x += 60) poly(g, [[x, 400], [x + 30, 400], [x + 14, 414], [x - 16, 414]], '#14141f', 0);
    g.save(); g.translate(200, 480); g.rotate(t * 0.5); burst(g, 0, 0, 40, 56, 9, '#c9ced8', 0, 6); circle(g, 0, 0, 16, '#4a3a30', 5); g.restore();
    rect(g, 600, 450, 220, 40, '#ff7a1a'); rect(g, 620, 420, 80, 30, '#ff7a1a'); circle(g, 640, 495, 18, '#2a2a35'); circle(g, 780, 495, 18, '#2a2a35');
  },
  citadelle(g: G, t: number) {
    bands(g, ['#2a145a', '#3d1f78', '#552f99', '#7a45c2', '#a46fe0'], 0, 400);
    for (let i = 0; i < 24; i++) circle(g, (i * 137) % W, (i * 71) % 220, 2.4 + (i % 3), '#fff', 0);
    circle(g, 770, 100, 44, '#fff6c8'); circle(g, 756, 90, 8, '#e9e0a8', 3);
    const tw: [number, number, number, number, string][] = [[40, 180, 90, 260, '#6a5acd'], [150, 100, 100, 340, '#7b6bdc'], [270, 200, 80, 240, '#5a4ab8'], [370, 60, 110, 380, '#8a7be8'], [500, 160, 90, 280, '#6a5acd'], [610, 120, 100, 320, '#7b6bdc'], [730, 210, 90, 230, '#5a4ab8']];
    tw.forEach(([x, y, w, h, c], i) => skyscraper(g, x, y, w, h, c, i));
    g.beginPath(); g.moveTo(-20, 540); g.quadraticCurveTo(300, 330, 620, 400); g.quadraticCurveTo(820, 440, 980, 380); g.lineTo(980, 540); g.closePath(); fillStroke(g, '#5fd069', 7);
    dots(g, 0, 380, W, 160, 'rgba(20,20,31,.2)', 12);
    poly(g, [[560, 540], [600, 400], [980, 360], [980, 540]], '#b5533c');
    for (let y = 420; y < 540; y += 24) { g.beginPath(); g.moveTo(600 - (y - 400) * 0.3, y); g.lineTo(W, y - 14); ink(g, 3); g.stroke(); }
    for (let x = 620; x < 940; x += 60) rect(g, x, 376 - (x - 620) * 0.1, 30, 28, '#b5533c', 4);
    rect(g, 818, 250, 8, 120, '#fff', 4); poly(g, [[826, 250], [890, 270], [826, 292]], '#e63946', 5);
  },
  amphi_nuit(g: G) {
    rect(g, 0, 0, W, H, '#10122e', 0); dots(g, 0, 0, W, 200, 'rgba(255,255,255,.08)', 14, 2);
    poly(g, [[350, 28], [610, 28], [900, 540], [60, 540]], 'rgba(255,240,170,.14)', 0);
    rect(g, 330, 50, 300, 130, '#e8eefc'); text(g, 'ANNALES 2019', 480, 92, 32, '#3a3f8f', 6);
    rect(g, 0, 190, W, 20, '#1b1e46', 0);
    for (let r = 0; r < 5; r++) {
      const y = 260 + r * 56;
      rect(g, 30, y, W - 60, 40, ['#2a2d63', '#262a5a', '#222652', '#1e224a', '#1a1e42'][r]);
      for (let x = 90 + (r % 2) * 50; x < W - 90; x += 120) { circle(g, x, y - 12, 15, '#0b0c20', 4); rect(g, x - 17, y, 34, 26, '#0b0c20', 4); }
    }
    for (let i = 0; i < 6; i++) circle(g, 132 + i * 140, 298 + (i % 3) * 56, 6, '#7fd3ff', 2);
    rect(g, 440, 200, 80, 18, '#6b3f1f'); rect(g, 468, 218, 24, 40, '#4a2a12');
    figure(g, 480, 236, 0.6, '#0b0c20'); rect(g, 516, 204, 20, 16, '#fff', 4);
  },
  dealer(g: G, t: number) {
    rect(g, 0, 0, W, H, '#2b2438', 0);
    for (let y = 0; y < 400; y += 36) for (let x = (y / 36) % 2 ? -40 : 0; x < W; x += 80) rect(g, x, y, 80, 36, '#3b3048', 3);
    dots(g, 0, 0, W, 400, 'rgba(0,0,0,.25)', 11);
    rect(g, 140, 60, 12, 340, '#14141f', 0); rect(g, 140, 56, 90, 12, '#14141f', 0);
    poly(g, [[200, 88], [250, 88], [380, 540], [20, 540]], `rgba(255,230,140,${0.2 + Math.sin(t * 5) * 0.02})`, 0);
    rect(g, 200, 66, 40, 22, '#fff3a0', 5);
    rect(g, 0, 400, W, 140, '#1d1a28'); dots(g, 0, 400, W, 140, 'rgba(255,255,255,.07)', 12);
    hood(g, 560, 545, 0.95, '#4a3a6a', '#ffe14d');
    rect(g, 360, 440, 150, 80, '#c58a4a'); rect(g, 360, 440, 150, 22, '#a96f35'); text(g, 'CAFÉ', 435, 504, 30, '#fff', 5);
    rect(g, 800, 430, 100, 80, '#e9e0c8'); rect(g, 800, 430, 100, 18, '#d6cba8'); text(g, '€', 850, 496, 40, '#3a8a4a', 5);
    text(g, '€ €', 790, 280, 56, '#8ed081', 8, -0.1);
  },
  flic(g: G, t: number) {
    const a = Math.floor(t * 4) % 2;
    rect(g, 0, 0, W, H, a ? '#c0392b' : '#2f4fbf', 0); burst(g, 480, 270, 260, 760, 24, a ? '#e74c3c' : '#3b6bff', t * 0.05, 0); dots(g, 0, 0, W, H, 'rgba(20,20,31,.16)', 14);
    poly(g, [[130, 540], [180, 400], [320, 350], [640, 350], [780, 400], [830, 540]], '#2a4a9a');
    poly(g, [[420, 350], [540, 350], [480, 470]], '#fff', 5); rect(g, 520, 420, 26, 56, '#ffd23f', 4);
    circle(g, 480, 270, 118, '#f1c27d');
    poly(g, [[372, 200], [388, 100], [572, 100], [588, 200], [540, 176], [420, 176]], '#1a2a66');
    rect(g, 350, 186, 260, 26, '#14234f'); burst(g, 480, 138, 22, 32, 5, '#ffd23f', -Math.PI / 2, 5);
    rect(g, 394, 240, 172, 50, '#14141f', 6); rect(g, 430, 250, 38, 14, 'rgba(255,255,255,.35)', 0); rect(g, 496, 250, 38, 14, 'rgba(255,255,255,.35)', 0);
    poly(g, [[410, 326], [450, 310], [480, 322], [510, 310], [550, 326], [510, 340], [450, 340]], '#4a2f1a', 5);
    g.beginPath(); g.moveTo(450, 364); g.lineTo(510, 364); ink(g, 5); g.stroke();
    text(g, 'STOP !', 800, 120, 70, '#fff', 12, 0.18);
  },
  medaille(g: G, t: number) {
    rect(g, 0, 0, W, H, '#ffe27a', 0); burst(g, 480, 270, 240, 760, 26, '#ffb830', t * 0.08, 0); dots(g, 0, 0, W, H, 'rgba(20,20,31,.1)', 14);
    poly(g, [[380, 0], [440, 0], [500, 260], [440, 280]], '#e63946', 6); poly(g, [[580, 0], [520, 0], [460, 260], [520, 280]], '#2f80ed', 6);
    const s = 1 + Math.sin(t * 3) * 0.02;
    g.save(); g.translate(480, 330); g.scale(s, s); circle(g, 0, 0, 150, '#ffb000', 9); circle(g, 0, 0, 120, '#ffd23f', 6); burst(g, 0, 0, 44, 96, 5, '#fff3b0', -Math.PI / 2, 7);
    g.beginPath(); g.arc(0, 0, 134, 3.6, 4.6); ink(g, 8); g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke(); g.restore();
    text(g, 'MISSION RÉUSSIE', 480, 508, 48, '#fff', 11);
  },
  argent(g: G, t: number) {
    rect(g, 0, 0, W, H, '#1f6f4a', 0); burst(g, 480, 270, 220, 760, 24, '#27895a', t * 0.05, 0); dots(g, 0, 0, W, H, 'rgba(20,20,31,.14)', 14);
    for (let i = 0; i < 7; i++) { const x = 80 + i * 130, y = ((t * 60 + i * 97) % 600) - 40; g.save(); g.translate(x, y); g.rotate(Math.sin(t + i) * 0.5); rect(g, -34, -18, 68, 36, '#b6e8a8', 4); circle(g, 0, 0, 9, '#8ed081', 3); g.restore(); }
    g.beginPath(); g.moveTo(380, 300); g.quadraticCurveTo(300, 380, 330, 480); g.quadraticCurveTo(480, 540, 630, 480); g.quadraticCurveTo(660, 380, 580, 300); g.closePath(); fillStroke(g, '#c9a56a', 8);
    dots(g, 320, 300, 340, 240, 'rgba(20,20,31,.2)', 10);
    poly(g, [[390, 304], [570, 304], [550, 270], [410, 270]], '#a9864d', 7); rect(g, 410, 296, 140, 14, '#e63946', 5);
    text(g, '€', 480, 440, 120, '#ffd23f', 12);
    coin(g, 250, 500, 34); coin(g, 700, 500, 40); coin(g, 790, 440, 28); coin(g, 190, 420, 26); coin(g, 740, 330, 30);
  },
});

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
  const atTop = panel.pos ? panel.pos === 'haut' : !panel.who || BUBBLE_TOP.has(panel.img);
  const bx = panel.who ? 110 : 50, by = atTop ? (panel.who ? 62 : 28) : H - bh - 40;
  g.save();
  if (panel.who) {
    const bubble = () => { g.beginPath(); g.roundRect(bx, by, bw, bh, 28); g.moveTo(bx + 70, by + bh - 2); g.lineTo(bx + 40, by + bh + 36); g.lineTo(bx + 120, by + bh - 2); };
    g.save(); g.translate(7, 7); bubble(); g.fillStyle = 'rgba(20,20,31,.55)'; g.fill(); g.restore(); // ombre portée BD : la bulle se détache de toute image
    bubble();
    g.fillStyle = '#fff'; g.fill(); ink(g, 5); g.stroke();
    g.beginPath(); g.roundRect(bx + 4, by + 4, bw - 8, bh - 8, 24); g.fillStyle = '#fff'; g.fill();
    g.font = '900 22px "Segoe UI",sans-serif';
    const tag = panel.who.toUpperCase().slice(0, 28);
    const tw = g.measureText(tag).width + 28;
    g.beginPath(); g.rect(bx + 20, by - 30, tw, 34); g.fillStyle = '#ffd23f'; g.fill(); ink(g, 4); g.stroke();
    g.fillStyle = INK; g.fillText(tag, bx + 34, by - 25);
  } else {
    g.fillStyle = 'rgba(20,20,31,.55)'; g.fillRect(bx + 7, by + 7, bw, bh);
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

// ---------- Écran de fin de mission ----------
export interface MissionResult {
  title: string;
  /** Médaille obtenue ; absente / null : mission simplement terminée. */
  medal?: 'bronze' | 'argent' | 'or' | null;
  /** ms : temps total ; damage : dégâts subis (points de vie perdus, ≥ 0) ; accuracy : précision 0..1. Un champ absent n'est pas affiché. */
  stats?: { ms?: number; damage?: number; accuracy?: number };
  /** Gain en euros. */
  reward?: number;
  /** Objectifs de la médaille visée (facultatif) : coche verte si atteint. */
  par?: { ms?: number; maxDamage?: number; minAccuracy?: number };
}
const MEDAL_STYLE = {
  bronze: { rim: '#8a4b1f', face: '#cd7f32', shine: '#f0b27a', name: 'BRONZE' },
  argent: { rim: '#6b7280', face: '#c9ced8', shine: '#ffffff', name: 'ARGENT' },
  or: { rim: '#b07a00', face: '#ffd23f', shine: '#fff3b0', name: 'OR' },
} as const;
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function drawMedal(g: G, tier: keyof typeof MEDAL_STYLE | null, t: number) {
  g.clearRect(0, 0, 260, 300);
  const st = tier ? MEDAL_STYLE[tier] : null;
  const pop = Math.min(1, t / 0.45);
  const sc = Math.max(0.01, pop < 1 ? pop * (1 + Math.sin(pop * Math.PI) * 0.35) : 1 + Math.sin(t * 3) * 0.015);
  g.save(); g.translate(130, 160); g.scale(sc, sc);
  poly(g, [[-46, -150], [-6, -150], [34, -30], [-6, -10]], '#e63946', 6); poly(g, [[46, -150], [6, -150], [-34, -30], [6, -10]], '#2f80ed', 6);
  circle(g, 0, 20, 88, st ? st.rim : '#6b7280', 8); circle(g, 0, 20, 70, st ? st.face : '#9aa3b5', 6);
  if (st) {
    burst(g, 0, 20, 26, 56, 5, st.shine, -Math.PI / 2, 5);
    // éclat qui balaye la médaille
    g.save(); g.beginPath(); g.arc(0, 20, 68, 0, 7); g.clip(); g.rotate(0.6); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(((t * 140) % 320) - 160, -80, 22, 200); g.restore();
  } else text(g, '✓', 0, 52, 90, '#fff', 8, 0, 'sans-serif');
  g.restore();
}

let resultOpen = false;
/** Écran de fin de mission : médaille animée, statistiques qui s'affichent une à une, gain qui monte. Clic / Espace / Entrée / Échap : fermer. */
export function showMissionResult(r: MissionResult): Promise<void> {
  if (resultOpen) return Promise.resolve();
  resultOpen = true; // réservé tout de suite : un 2e appel pendant l'attente des planches est ignoré
  return chain.then(() => buildResult(r)); // les planches BD de fin de mission passent d'abord, puis l'écran de résultat (jamais empilés)
}

function buildResult(r: MissionResult): Promise<void> {
  return new Promise((resolve) => {
    const tier = r.medal && r.medal in MEDAL_STYLE ? r.medal : null;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:960;background:rgba(10,10,22,.8);display:flex;align-items:center;justify-content:center;font-family:"Segoe UI",sans-serif;cursor:pointer';
    const card = document.createElement('div');
    card.style.cssText = 'width:min(560px,92vw);padding:18px 26px 16px;border:6px solid #000;border-radius:14px;background:#fff6dc;box-shadow:10px 10px 0 #000;text-align:center;color:#14141f';
    const head = document.createElement('div');
    head.textContent = tier ? 'MISSION RÉUSSIE' : 'MISSION TERMINÉE';
    head.style.cssText = 'font:900 34px Impact,sans-serif;letter-spacing:.04em;color:#e63946;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:3px 3px 0 #000';
    const title = document.createElement('div');
    title.textContent = String(r.title ?? '').slice(0, 60);
    title.style.cssText = 'font-weight:800;font-size:17px;margin:2px 0 4px';
    const cv = document.createElement('canvas');
    cv.width = 260; cv.height = 300;
    cv.style.cssText = 'width:200px;height:231px';
    const medalName = document.createElement('div');
    medalName.textContent = tier ? `Médaille ${MEDAL_STYLE[tier].name}` : 'Pas de médaille cette fois';
    medalName.style.cssText = 'font-weight:900;font-size:20px;margin-bottom:8px';
    const rows = document.createElement('div');
    rows.style.cssText = 'display:flex;flex-direction:column;gap:6px;text-align:left';
    const line = (label: string, value: string, ok: boolean | null, par: string) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:5px 12px;border:3px solid #000;border-radius:8px;background:#fff;font-weight:800;font-size:16px;opacity:0;transform:translateX(-30px);transition:opacity .3s,transform .3s';
      const l = document.createElement('span'); l.textContent = label; l.style.flex = '1';
      const v = document.createElement('span'); v.textContent = value; v.style.cssText = 'font-weight:900;font-size:18px';
      row.append(l, v);
      if (par) { const p = document.createElement('small'); p.textContent = par; p.style.cssText = 'color:#6a6d88;font-weight:700'; row.append(p); }
      if (ok !== null) { const c = document.createElement('span'); c.textContent = ok ? '✓' : '✗'; c.style.cssText = `font-weight:900;color:${ok ? '#2e9e44' : '#d33'}`; row.append(c); }
      rows.appendChild(row);
      return row;
    };
    const s = r.stats ?? {}, par = r.par ?? {};
    const entries: HTMLElement[] = [];
    if (Number.isFinite(s.ms)) entries.push(line('Temps', mmss(s.ms!), par.ms !== undefined ? s.ms! <= par.ms : null, par.ms !== undefined ? `objectif ${mmss(par.ms)}` : ''));
    if (Number.isFinite(s.damage)) entries.push(line('Dégâts subis', String(Math.max(0, Math.round(s.damage!))), par.maxDamage !== undefined ? s.damage! <= par.maxDamage : null, par.maxDamage !== undefined ? `max ${Math.round(par.maxDamage)}` : ''));
    if (Number.isFinite(s.accuracy)) entries.push(line('Précision', `${Math.round(Math.max(0, Math.min(1, s.accuracy!)) * 100)} %`, par.minAccuracy !== undefined ? s.accuracy! >= par.minAccuracy : null, par.minAccuracy !== undefined ? `min ${Math.round(par.minAccuracy * 100)} %` : ''));
    const reward = document.createElement('div');
    const gain = Math.max(0, Math.round(Number(r.reward) || 0));
    reward.style.cssText = 'margin-top:10px;font:900 34px "Segoe UI",sans-serif;color:#ffd23f;-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .3s';
    reward.textContent = '+0 €';
    const hint = document.createElement('div');
    hint.textContent = 'Clic ou Espace : continuer';
    hint.style.cssText = 'margin-top:6px;font-size:12px;font-weight:700;color:#6a6d88';
    card.append(head, title, cv, medalName, rows);
    if (gain) card.appendChild(reward);
    card.appendChild(hint);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const g = cv.getContext('2d')!;
    const t0 = performance.now();
    let raf = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true; resultOpen = false;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') { e.stopImmediatePropagation(); e.preventDefault(); finish(); }
    }
    addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', finish);
    let shown = 0;
    const frame = (now: number) => {
      if (done) return;
      const t = (now - t0) / 1000;
      drawMedal(g, tier, t);
      while (shown < entries.length && t > 0.7 + shown * 0.45) { const e = entries[shown++]; e.style.opacity = '1'; e.style.transform = 'none'; }
      const tr = 0.7 + entries.length * 0.45;
      if (gain && t > tr) { reward.style.opacity = '1'; reward.textContent = `+${Math.round(gain * Math.min(1, (t - tr) / 0.9)).toLocaleString('fr-FR')} €`; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
