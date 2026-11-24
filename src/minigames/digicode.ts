// PROPRIÉTAIRE : game-minigames
// Digicode : 3 colonnes défilent ; un clic (ou Espace) stoppe la colonne suivante, qui doit être dans la zone verte. Un raté = buzzer + « Trop haut / Trop bas »,
// on recommence CETTE colonne (temps illimité, pas d'échec définitif).
// Données envoyées : [instant d'arrêt de chaque colonne en ms]. Le serveur recalcule les positions à partir de la graine
// (shared/minigames/rules.ts : digicodeSpec, digicodePos).
import { DIGI_COLS, digicodePos, digicodeSpec } from '../../shared/minigames/rules';
import { HINTS } from './help';
import { H, INK, PAL, W, box, burst, disc, googly, sweat, type MgFactory } from './kit';

const COL_W = 120;
const GAP = 34;
const TOP = 70;
const TRACK_H = H - 150;
const X0 = (W - (COL_W * DIGI_COLS + GAP * (DIGI_COLS - 1))) / 2;

export const createDigicode: MgFactory = (env) => {
  const spec = digicodeSpec(env.start.seed, env.start.difficulty);
  const stops: number[] = [];
  let failedCol = -1;
  let failAt = 0;
  let lockUntil = 0; // verrou court après un raté (le temps de lire le message)
  let lastClick = -1e9;
  let done = false;

  const press = () => {
    if (done) return;
    const t = env.now();
    if (t < lockUntil || t - lastClick < 60) return; // anti-rebond
    lastClick = t;
    const i = stops.length;
    const col = spec.cols[i];
    const pos = digicodePos(col, t);
    if (Math.abs(pos - col.center) <= col.half) {
      if (i > 0 && t - stops[i - 1] < spec.minGapMs + 10) return; // deux clics trop rapprochés : le serveur les refuserait
      stops.push(t);
      env.progress();
      env.sfx('mg_beep', i);
      if (stops.length === DIGI_COLS) {
        done = true;
        env.finish(true, stops.map((s) => Math.round(s)));
      }
    } else {
      failedCol = i;
      failAt = t;
      lockUntil = t + 700;
      env.sfx('mg_buzz');
      env.say(pos > col.center ? 'Trop haut !' : 'Trop bas !');
    }
  };

  return {
    onDown(btn) { if (btn === 0) press(); },
    onKey(code) { if (code === 'Space' || code === 'Enter') press(); },
    hint() {
      const i = Math.min(stops.length, DIGI_COLS - 1);
      return { x: X0 + i * (COL_W + GAP) + COL_W / 2, y: TOP + (1 - spec.cols[i].center) * TRACK_H, r: 70, text: HINTS.digi };
    },
    update() { if (failedCol >= 0 && env.now() > lockUntil) failedCol = -1; },
    draw(g, t) {
      box(g, 40, 24, W - 80, H - 48, PAL.dark, 20);
      // caméra de surveillance : suit la colonne en cours, se laisse berner à la fin (regarde ailleurs en sifflotant) ou s'affole si on rate
      {
        const win = done;
        const cx = W - 104;
        const cy = 50;
        const cam = Math.min(stops.length, DIGI_COLS - 1);
        const ly = win ? cy - 80 : TOP + (1 - digicodePos(spec.cols[cam], t)) * TRACK_H;
        const lx = win ? cx + 60 : X0 + cam * (COL_W + GAP) + COL_W / 2;
        box(g, cx - 4, cy - 22, 50, 30, failedCol >= 0 && Math.floor(t / 90) % 2 ? PAL.red : PAL.metal, 6, 4);
        g.fillStyle = INK;
        g.fillRect(cx + 40, cy - 6, 14, 6);
        googly(g, cx + 14, cy - 8, 12, lx, ly, failedCol >= 0);
        if (failedCol >= 0) sweat(g, cx + 40, cy + 18, 0.8);
      }
      // voyants du haut : un par colonne verrouillée
      for (let i = 0; i < DIGI_COLS; i++) {
        const x = X0 + i * (COL_W + GAP);
        const locked = i < stops.length;
        const bad = i === failedCol;
        box(g, x, TOP, COL_W, TRACK_H, '#fff4d6', 12);
        if (!done && i === stops.length) { // colonne à stopper : cadre blanc pointillé
          g.save();
          g.setLineDash([10, 8]);
          g.lineDashOffset = -t / 30;
          g.lineWidth = 6;
          g.strokeStyle = '#fff';
          g.strokeRect(x - 10, TOP - 10, COL_W + 20, TRACK_H + 20);
          g.setLineDash([]);
          g.lineWidth = 2;
          g.strokeStyle = INK;
          g.strokeRect(x - 13, TOP - 13, COL_W + 26, TRACK_H + 26);
          g.restore();
        }
        // zone verte
        const col = spec.cols[i];
        const zy = TOP + (1 - (col.center + col.half)) * TRACK_H;
        const zh = col.half * 2 * TRACK_H;
        g.fillStyle = PAL.green;
        g.fillRect(x + 6, zy, COL_W - 12, zh);
        g.lineWidth = 4;
        g.strokeStyle = INK;
        g.strokeRect(x + 6, zy, COL_W - 12, zh);
        // curseur de la colonne
        const when = i < stops.length ? stops[i] : t;
        const y = TOP + (1 - digicodePos(col, when)) * TRACK_H;
        box(g, x - 6, y - 9, COL_W + 12, 18, bad && Math.floor(t / 80) % 2 ? PAL.red : locked ? PAL.blue : PAL.yellow, 6, 4);
        disc(g, x + COL_W / 2, TOP - 26, 14, locked ? PAL.green : bad ? PAL.red : '#555', 4);
        if (bad && t - failAt < 500) burst(g, x + COL_W / 2, y, 44 + (t - failAt) / 14, PAL.red, 9, t / 200);
      }
    },
  };
};
