// PROPRIÉTAIRE : game-minigames
// Consignes des 8 mini-jeux (français, courtes, verbes d'action, touches nommées) + petites animations de démonstration dessinées en canvas.
// `steps` = consigne complète (« première fois »), `short` = rappel d'une ligne (affiché aussi en bas pendant la partie, et seul après la première fois).
// « Déjà vu » est mémorisé dans localStorage (try/catch : navigateur privé, quota, stockage bloqué).
import type { MinigameKind } from '../../shared/ids';
import type { MinigameStart } from '../../shared/protocol';
import { briseGlaceSpec, courtCircuitSpec, desamorcageSpec, fouilleSpec, liassesSpec, tournevisSpec } from '../../shared/minigames/rules';
import { INK, PAL, box, burst, clamp, disc, line } from './kit';

export interface HelpText { title: string; steps: string[]; short: string }

const sensTexte = (dir: number) => (dir > 0 ? 'dans le sens des aiguilles d\'une montre' : 'dans le sens inverse des aiguilles d\'une montre');

/** Texte du jeu `kind`, éventuellement adapté à la partie (sens du verrou, nombre de tours, de coups...). */
export function helpFor(st: MinigameStart): HelpText {
  const { seed, difficulty: d } = st;
  switch (st.kind) {
    case 'tournevis': {
      const s = tournevisSpec(seed, d);
      return {
        title: 'FORCER LE CONTACT',
        steps: [
          'Place le tournevis au centre du barillet jaune.',
          'Maintiens le clic gauche pour l\'enfoncer.',
          `Sans lâcher, tourne la souris en cercle autour du barillet, ${sensTexte(s.dir)}.`,
          `Fais ${s.turns} tours : l'anneau vert se remplit, puis le verrou casse.`,
        ],
        short: `Maintiens le clic gauche, puis tourne la souris en cercle ${s.dir > 0 ? 'vers la droite (sens horaire)' : 'vers la gauche (sens inverse)'} : ${s.turns} tours.`,
      };
    }
    case 'court_circuit': {
      void courtCircuitSpec(seed, d);
      return {
        title: 'COURT-CIRCUIT',
        steps: [
          'Clique sur le bout d\'un câble (rouge ou bleu) et garde le clic gauche enfoncé.',
          'Glisse-le jusqu\'au cercle cuivré, puis relâche.',
          'Fais pareil avec l\'autre câble : les deux bouts doivent se toucher dans le cercle.',
          'Reste en contact 1 seconde : la jauge orange se remplit et le moteur démarre.',
        ],
        short: 'Glisse chaque câble (clic gauche maintenu) jusqu\'au cercle cuivré, joins-les et garde le contact 1 seconde.',
      };
    }
    case 'digicode':
      return {
        title: 'DIGICODE',
        steps: [
          'Trois colonnes avec un curseur jaune qui monte et descend.',
          'Clique (ou appuie sur Espace) quand le curseur jaune est dans la zone verte.',
          'Fais-le colonne par colonne, de gauche à droite : la colonne entourée de blanc est la suivante.',
          'Raté ? « Trop haut » ou « Trop bas » : tu recommences cette colonne, sans limite de temps.',
        ],
        short: 'Clic gauche ou Espace quand le curseur jaune est dans le vert, colonne par colonne, de gauche à droite.',
      };
    case 'dosage':
      return {
        title: 'DOSAGE',
        steps: [
          'Maintiens le clic gauche : la bouteille sous la pompe se remplit.',
          'Relâche pile sur la ligne rouge (dans la bande rose).',
          'Fais-le pour les 3 bouteilles, de gauche à droite.',
          'Trop haut ou pas assez ? La bouteille se vide et tu la refais.',
        ],
        short: 'Maintiens le clic gauche pour remplir, relâche pile sur la ligne rouge. 3 bouteilles.',
      };
    case 'fouille': {
      const s = fouilleSpec(seed, d);
      return {
        title: 'FOUILLE',
        steps: [
          'Un seul tas de détritus brille : il cache l\'objet doré.',
          `Passe la souris de gauche à droite puis de droite à gauche sur ce tas, ${s.swipes} allers ou retours (sans cliquer).`,
          'Quand l\'objet doré apparaît, clique dessus avec le clic gauche.',
        ],
        short: `Balaie le tas qui brille en allers-retours avec la souris (${s.swipes} passages), puis clique sur l'objet doré.`,
      };
    }
    case 'brise_glace': {
      const s = briseGlaceSpec(seed, d);
      return {
        title: 'BRISE-GLACE',
        steps: [
          'Frappe la vitre : clic gauche ou touche Espace.',
          `Répète ${s.hits} fois : chaque coup agrandit la fissure, les pastilles en bas comptent tes coups.`,
          'Au dernier coup, la vitre vole en éclats.',
        ],
        short: `Clique (clic gauche) ou appuie sur Espace ${s.hits} fois pour briser la vitre.`,
      };
    }
    case 'desamorcage': {
      void desamorcageSpec(seed, d);
      return {
        title: 'DÉSAMORÇAGE',
        steps: [
          'Regarde bien : un des 4 fils clignote en couleur au début.',
          'Retiens sa couleur : ensuite les fils se croisent et se mélangent.',
          'Clique sur le fil de la même couleur pour le couper.',
          'Besoin de revoir le fil ? Appuie sur Espace. Mauvais fil : tu recommences, sans danger.',
        ],
        short: 'Retiens la couleur du fil qui clignote, puis clique sur ce fil une fois mélangé. Espace = revoir.',
      };
    }
    case 'liasses': {
      const s = liassesSpec(seed, d);
      return {
        title: 'LIASSES',
        steps: [
          'Maintiens le clic gauche sur la pile de billets à gauche.',
          'Glisse-la dans la jauge au centre, puis relâche : une liasse est posée.',
          s.maxOver === 0 ? 'Remplis jusqu\'à la zone verte, ni plus ni moins.' : 'Remplis jusqu\'à la zone verte, sans trop dépasser.',
          'Clique sur le tampon vert (ou appuie sur Entrée) pour valider.',
        ],
        short: 'Glisse les liasses (clic maintenu) dans la jauge jusqu\'à la zone verte, puis clique sur le tampon (ou Entrée).',
      };
    }
  }
}

/** Phrases d'indice quand le joueur bloque (utilisées par les jeux). Centralisées ici pour relire tous les textes au même endroit. */
export const HINTS = {
  tournevis_clic: 'Maintiens le clic gauche pour enfoncer le tournevis',
  tournevis_cercle: 'Tourne la souris en cercle autour du barillet',
  court_zone: 'Amène les deux bouts de câble dans le cercle cuivré',
  court_autre: 'Amène l\'autre câble : clique dessus, glisse, relâche',
  court_toucher: 'Rapproche les deux bouts jusqu\'à l\'étincelle',
  digi: 'Clique quand le curseur jaune est dans le vert',
  dosage_clic: 'Maintiens le clic gauche pour remplir',
  dosage_ligne: 'Relâche quand le liquide touche la ligne rouge',
  fouille_balai: 'Balaie ce tas qui brille : va-et-vient avec la souris',
  fouille_objet: 'Clique sur l\'objet doré !',
  glace: 'Clique (ou Espace) pour frapper la vitre',
  desa: 'Clique le fil de la couleur qui a clignoté (Espace = revoir)',
  liasses_prendre: 'Clique sur la pile de billets et garde le clic enfoncé',
  liasses_poser: 'Glisse la liasse dans la jauge, puis relâche',
  liasses_valider: 'Clique sur le tampon vert (ou Entrée)',
} as const;

// ---------- Mémorisation « déjà vu » ----------
const KEY = (k: MinigameKind) => `gta-mg-vu:${k}`;
export function dejaVu(k: MinigameKind): boolean {
  try { return localStorage.getItem(KEY(k)) === '1'; } catch { return false; }
}
export function marquerVu(k: MinigameKind): void {
  try { localStorage.setItem(KEY(k), '1'); } catch { /* stockage indisponible : on réaffichera la consigne longue */ }
}

// ---------- Démonstrations animées (zone x,y,w,h ; boucle de ~3 s) ----------
function mouseIcon(g: CanvasRenderingContext2D, x: number, y: number, pressed: boolean, s = 1) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  box(g, -15, -22, 30, 44, '#fff', 14, 4);
  g.fillStyle = pressed ? PAL.red : '#ddd';
  g.beginPath();
  g.roundRect(-13, -20, 13, 19, [12, 0, 0, 0]);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.beginPath();
  g.moveTo(-15, -2);
  g.lineTo(15, -2);
  g.moveTo(0, -22);
  g.lineTo(0, -2);
  g.stroke();
  g.restore();
}
const loop = (t: number, period: number) => (t % period) / period;
const ease = (k: number) => k * k * (3 - 2 * k);

export function drawDemo(g: CanvasRenderingContext2D, kind: MinigameKind, t: number, x: number, y: number, w: number, h: number) {
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 12);
  g.clip();
  g.fillStyle = PAL.paper;
  g.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (kind) {
    case 'tournevis': {
      const p = loop(t, 3200);
      const pressed = p > 0.12;
      const a = p > 0.25 ? ((p - 0.25) / 0.75) * Math.PI * 4 : 0;
      mouseIcon(g, x + 34, y + 38, pressed, 0.9);
      g.save();
      g.translate(cx + 12, cy + 18);
      g.rotate(a);
      disc(g, 0, 0, 52, PAL.yellow, 5);
      box(g, -9, -30, 18, 60, PAL.dark, 6, 3);
      g.restore();
      const tx = cx + 12 + Math.cos(a - 1.2) * 58;
      const ty = cy + 18 + Math.sin(a - 1.2) * 58;
      line(g, [[tx, ty], [tx + 12, ty - 36]], PAL.red, 9);
      g.lineWidth = 4;
      g.strokeStyle = PAL.green;
      g.beginPath();
      g.arc(cx + 12, cy + 18, 70, a - 1.2 - 0.9, a - 1.2 - 0.1);
      g.stroke();
      break;
    }
    case 'court_circuit': {
      const p = ease(clamp(loop(t, 3200) * 1.8, 0, 1));
      disc(g, cx, cy + 6, 46, '#c97b3a', 5);
      const ay = cy - 40 + p * 44;
      const by = cy + 52 - p * 44;
      const ax = x + 24 + p * (w / 2 - 36);
      const bx = x + w - 24 - p * (w / 2 - 36);
      line(g, [[x + 6, cy - 40], [ax, ay]], PAL.red, 9);
      line(g, [[x + w - 6, cy + 52], [bx, by]], PAL.blue, 9);
      disc(g, ax, ay, 8, '#e8c9a0', 3);
      disc(g, bx, by, 8, '#e8c9a0', 3);
      mouseIcon(g, x + 30, y + h - 34, p > 0 && p < 1, 0.8);
      if (p >= 1) burst(g, cx, cy + 6, 22 + Math.sin(t / 60) * 6, PAL.yellow, 8, t / 100);
      break;
    }
    case 'digicode': {
      const p = loop(t, 3000);
      for (let i = 0; i < 3; i++) {
        const bx = x + 18 + i * 62;
        box(g, bx, y + 20, 46, h - 70, '#fff', 8, 3);
        g.fillStyle = PAL.green;
        g.fillRect(bx + 4, y + 70 + i * 14, 38, 36);
        const stopped = p > 0.3 + i * 0.22;
        const pos = stopped ? 0.5 : 0.5 + 0.5 * Math.sin(t / (260 + i * 60) + i);
        const cyy = stopped ? y + 88 + i * 14 : y + 30 + pos * (h - 90);
        box(g, bx - 3, cyy - 6, 52, 12, stopped ? PAL.blue : PAL.yellow, 4, 3);
      }
      const click = [0.3, 0.52, 0.74].some((s) => p > s && p < s + 0.06);
      mouseIcon(g, cx, y + h - 26, click, 0.7);
      break;
    }
    case 'dosage': {
      const p = loop(t, 3000);
      const lv = p < 0.7 ? p / 0.7 * 0.62 : 0.62;
      box(g, cx - 30, y + 24, 60, h - 78, 'rgba(255,255,255,0.4)', 10, 4);
      g.fillStyle = PAL.orange;
      g.fillRect(cx - 26, y + h - 54 - lv * (h - 86), 52, lv * (h - 86));
      g.fillStyle = PAL.red;
      g.fillRect(cx - 40, y + h - 54 - 0.62 * (h - 86) - 2, 80, 5);
      mouseIcon(g, cx, y + h - 26, p < 0.7, 0.7);
      break;
    }
    case 'fouille': {
      const p = loop(t, 3400);
      const k = clamp(p / 0.7, 0, 1);
      for (let i = 0; i < 3; i++) {
        const bx = x + 14 + i * 58;
        g.fillStyle = '#8d6e63';
        g.strokeStyle = INK;
        g.lineWidth = 3;
        const hh = i === 1 ? 70 * (1 - k) : 60;
        if (hh > 3) { g.beginPath(); g.roundRect(bx, y + 130 - hh, 50, hh, 8); g.fill(); g.stroke(); }
        if (i === 1) { disc(g, bx + 25, y + 116, 14, PAL.yellow, 3); if (k < 1) burst(g, bx + 25, y + 70, 8 + Math.sin(t / 100) * 3, '#fff', 4, t / 300); }
      }
      const sx = x + 38 + 40 + Math.sin(k * Math.PI * 6) * 24;
      if (p < 0.7) { box(g, sx - 22, y + 96, 44, 22, PAL.yellow, 4, 3); }
      else { mouseIcon(g, x + 14 + 58 + 25, y + 150, p > 0.8 && p < 0.88, 0.7); }
      break;
    }
    case 'brise_glace': {
      const p = loop(t, 3000);
      const hits = Math.min(5, Math.floor(p / 0.16));
      box(g, x + 22, y + 20, w - 44, h - 90, 'rgba(160,220,255,0.8)', 10, 5);
      g.lineWidth = 3;
      g.strokeStyle = '#fff';
      g.beginPath();
      for (let i = 0; i < hits; i++) {
        g.moveTo(cx, y + 20 + (h - 90) / 2);
        g.lineTo(cx + Math.cos(i * 1.3) * 60, y + 20 + (h - 90) / 2 + Math.sin(i * 1.3) * 50);
      }
      g.stroke();
      const click = p % 0.16 < 0.05 && hits < 5;
      mouseIcon(g, cx, y + h - 30, click, 0.8);
      if (click) burst(g, cx, y + 20 + (h - 90) / 2, 22, PAL.yellow, 7, hits);
      break;
    }
    case 'desamorcage': {
      const p = loop(t, 3600);
      const cols = [PAL.red, PAL.blue, PAL.green, PAL.yellow];
      const flash = p < 0.25;
      const shuf = ease(clamp((p - 0.35) / 0.2, 0, 1));
      for (let i = 0; i < 4; i++) {
        const to = [2, 0, 3, 1][i];
        const yy = y + 30 + (i + (to - i) * shuf) * 36;
        const c = flash && i !== 1 ? '#888' : cols[i];
        line(g, [[x + 16, yy], [x + w - 16, yy]], c, 9);
        if (flash && i === 1) burst(g, cx, yy, 24 + Math.sin(t / 50) * 4, '#fff', 8, t / 100);
      }
      if (p > 0.75) {
        const yy = y + 30 + 0 * 36;
        burst(g, cx, yy, 20 + (p - 0.75) * 60, PAL.green, 8, t / 100);
        mouseIcon(g, cx + 50, y + h - 30, p < 0.82, 0.8);
      }
      break;
    }
    case 'liasses': {
      const p = loop(t, 3000);
      for (let i = 0; i < 2; i++) box(g, x + 12, y + 130 - i * 10, 50, 28, PAL.green, 4, 3);
      box(g, x + w - 70, y + 24, 56, h - 80, '#fff', 6, 4);
      const n = Math.floor(p * 3);
      for (let i = 0; i < n; i++) box(g, x + w - 66, y + h - 62 - i * 22, 48, 18, PAL.green, 3, 2);
      const q = (p * 3) % 1;
      const bx = x + 38 + (w - 108) * ease(clamp(q * 1.3, 0, 1));
      const by = y + 130 - 40 * ease(clamp(q * 1.3, 0, 1));
      box(g, bx - 22, by - 12, 44, 24, PAL.green, 4, 3);
      mouseIcon(g, cx, y + h - 26, q < 0.77, 0.7);
      break;
    }
  }
  g.restore();
  g.lineWidth = 5;
  g.strokeStyle = INK;
  g.beginPath();
  g.roundRect(x, y, w, h, 12);
  g.stroke();
}
