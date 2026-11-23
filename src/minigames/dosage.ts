// PROPRIÉTAIRE : game-minigames
// Dosage : 3 bouteilles. Maintenir le clic gauche pour remplir la bouteille courante, relâcher pile sur la ligne rouge ; trop haut = débordement.
// Données envoyées : [niveau des 3 bouteilles (0..1)]. Règle : shared/minigames/rules.ts (dosageSpec, DOSAGE_FILL_RATE).
import { DOSAGE_BOTTLES, DOSAGE_CLIENT_RATE, dosageSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, googly, sweat, type MgFactory } from './kit';

const BW = 90;
const BH = 230;
const BY = 310; // bas des bouteilles
const XS = [W * 0.2, W * 0.5, W * 0.8];

export const createDosage: MgFactory = (env) => {
  const spec = dosageSpec(env.start.seed, env.start.difficulty);
  const levels: number[] = [];
  let level = 0;
  let filling = false;
  let fillAt = 0;
  const levelNow = () => (filling ? Math.min(1.05, ((env.now() - fillAt) / 1000) * DOSAGE_CLIENT_RATE) : level);
  let done = false;
  let bad = -1;
  let badAt = 0;
  let tick = 0;
  let flash = 0;

  const fail = (t: number) => {
    done = true;
    bad = levels.length;
    badAt = t;
    env.sfx('mg_splash');
    env.finish(false);
  };

  return {
    probe: () => ({ level: levelNow(), filling: filling ? 1 : 0, bottle: levels.length }),
    onDown(btn) {
      if (btn !== 0 || done || levels.length >= DOSAGE_BOTTLES) return;
      filling = true;
      fillAt = env.now();
      level = 0;
      tick = 0;
      env.sfx('mg_push');
    },
    onUp(btn) {
      if (btn !== 0 || done || !filling) return;
      level = Math.min(1, levelNow()); // niveau exact à l'instant du relâchement, quelle que soit la cadence d'affichage
      filling = false;
      const i = levels.length;
      if (level < 0.03 || Math.abs(level - spec.targets[i]) > spec.tol) { fail(env.now()); return; }
      levels.push(Math.round(level * 10000) / 10000);
      flash = 0.3;
      env.sfx('mg_ding');
      level = 0;
      if (levels.length === DOSAGE_BOTTLES) { done = true; env.finish(true, levels.slice()); }
    },
    update(dt) {
      flash = Math.max(0, flash - dt);
      if (done || !filling) return;
      level = levelNow();
      const k = Math.floor(level * 10);
      if (k > tick) { tick = k; env.sfx('mg_glug', k); }
      if (level > 1) { level = 1; filling = false; fail(env.now()); }
    },
    draw(g, t) {
      box(g, 30, 40, W - 60, H - 70, PAL.paper, 22);
      for (let i = 0; i < DOSAGE_BOTTLES; i++) {
        const x = XS[i] - BW / 2;
        const lv = i < levels.length ? levels[i] : i === levels.length ? level : 0;
        const isBad = bad === i;
        const sh = isBad && t - badAt < 400 ? (Math.random() - 0.5) * 10 : 0;
        // liquide
        g.fillStyle = isBad ? PAL.red : i < levels.length ? PAL.green : PAL.orange;
        g.fillRect(x + 4 + sh, BY - lv * BH, BW - 8, lv * BH);
        // verre
        box(g, x + sh, BY - BH, BW, BH, 'rgba(255,255,255,0.25)', 14, 6);
        // ligne rouge de la cible + zone de tolérance
        const ty = BY - spec.targets[i] * BH;
        g.fillStyle = 'rgba(238,64,53,0.25)';
        g.fillRect(x - 6, ty - spec.tol * BH, BW + 12, spec.tol * 2 * BH);
        g.fillStyle = PAL.red;
        g.fillRect(x - 12, ty - 3, BW + 24, 6);
        // goulot/bouchon
        box(g, XS[i] - 22, BY - BH - 22, 44, 24, PAL.metal, 6, 4);
      }
      // frimousses : les yeux suivent le curseur, se plissent quand c'est juste, s'exorbitent quand ça monte trop, suent près du bord
      for (let i = 0; i < DOSAGE_BOTTLES; i++) {
        const lv = i < levels.length ? levels[i] : i === levels.length ? level : 0;
        const ex = XS[i];
        const ey = BY - BH * 0.42;
        const near = Math.abs(lv - spec.targets[i]) <= spec.tol && lv > 0;
        const over = lv > spec.targets[i] + spec.tol;
        if (i < levels.length || near) {
          g.lineWidth = 5;
          g.strokeStyle = INK;
          g.lineCap = 'round';
          g.beginPath();
          g.arc(ex - 16, ey, 9, Math.PI * 1.1, Math.PI * 1.9);
          g.stroke();
          g.beginPath();
          g.arc(ex + 16, ey, 9, Math.PI * 1.1, Math.PI * 1.9);
          g.stroke();
        } else {
          googly(g, ex - 16, ey, 11, env.cursor.x, env.cursor.y, over);
          googly(g, ex + 16, ey, 11, env.cursor.x, env.cursor.y, over);
        }
        g.beginPath();
        g.arc(ex, ey + 30, over ? 10 : 7, over ? Math.PI : 0, over ? Math.PI * 2 : Math.PI);
        g.lineWidth = 4;
        g.strokeStyle = INK;
        g.stroke();
        if (over && !done) sweat(g, ex + 36, ey - 14);
      }
      // pistolet de pompe au-dessus de la bouteille courante
      const ci = Math.min(levels.length, DOSAGE_BOTTLES - 1);
      const px = XS[ci];
      const wob = filling ? Math.sin(env.now() / 30) * 2 : 0;
      box(g, px - 20 + wob, 54, 40, 44, PAL.dark, 8, 5);
      box(g, px - 6 + wob, 96, 12, 40, PAL.metal, 4, 4);
      if (filling) {
        g.fillStyle = PAL.orange;
        g.fillRect(px - 4, 136, 8, BY - BH - 130 + (level * BH > 0 ? 0 : 0));
      }
      if (flash > 0) burst(g, XS[Math.max(0, levels.length - 1)], BY - BH / 2, 50 + (0.3 - flash) * 160, PAL.yellow, 8, t / 300);
      if (bad >= 0 && t - badAt < 500) burst(g, XS[Math.min(bad, 2)], BY - BH / 2, 40 + (t - badAt) / 5, PAL.red, 10, t / 150);
      g.strokeStyle = INK;
    },
  };
};
