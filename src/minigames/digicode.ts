// PROPRIÉTAIRE : game-minigames
// Digicode : 3 colonnes défilent ; un clic (ou Espace) stoppe la colonne suivante, qui doit être dans la zone verte. Un raté = buzzer, c'est perdu.
// Données envoyées : [instant d'arrêt de chaque colonne en ms]. Le serveur recalcule les positions à partir de la graine
// (shared/minigames/rules.ts : digicodeSpec, digicodePos).
import { DIGI_COLS, digicodePos, digicodeSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, disc, type MgFactory } from './kit';

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
  let lastClick = -1e9;
  let done = false;

  const press = () => {
    if (done) return;
    const t = env.now();
    if (t - lastClick < 60) return; // anti-rebond
    lastClick = t;
    const i = stops.length;
    const col = spec.cols[i];
    const pos = digicodePos(col, t);
    stops.push(t);
    if (Math.abs(pos - col.center) <= col.half) {
      env.sfx('mg_lock');
      if (stops.length === DIGI_COLS) {
        done = true;
        env.finish(true, stops.map((s) => Math.round(s)));
      }
    } else {
      done = true;
      failedCol = i;
      failAt = t;
      env.sfx('mg_buzz');
      env.finish(false);
    }
  };

  return {
    onDown(btn) { if (btn === 0) press(); },
    onKey(code) { if (code === 'Space' || code === 'Enter') press(); },
    update() {},
    draw(g, t) {
      box(g, 40, 24, W - 80, H - 48, PAL.dark, 20);
      // voyants du haut : un par colonne verrouillée
      for (let i = 0; i < DIGI_COLS; i++) {
        const x = X0 + i * (COL_W + GAP);
        const locked = i < stops.length && i !== failedCol;
        const bad = i === failedCol;
        box(g, x, TOP, COL_W, TRACK_H, '#fff4d6', 12);
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
        box(g, x - 6, y - 9, COL_W + 12, 18, bad ? PAL.red : locked ? PAL.blue : PAL.yellow, 6, 4);
        disc(g, x + COL_W / 2, TOP - 26, 14, locked ? PAL.green : bad ? PAL.red : '#555', 4);
        if (bad && t - failAt < 500) burst(g, x + COL_W / 2, y, 44 + (t - failAt) / 14, PAL.red, 9, t / 200);
      }
    },
  };
};
