// PROPRIÉTAIRE : game-minigames
// Désamorçage : un des 4 fils flashe 0,5 s, puis les fils se mélangent. Cliquer le fil de la même couleur pour le couper.
// Mauvais fil = boum (BD, sans gravité). Données envoyées : [couleur coupée, 0..3]. Règle : shared/minigames/rules.ts (desamorcageSpec).
import { WIRE_COLORS, desamorcageSpec, rng } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, disc, type MgFactory } from './kit';

const COLORS = [PAL.red, PAL.blue, PAL.green, PAL.yellow];
const X0 = 120;
const X1 = W - 120;
const Y0 = 120;
const GAP = 56;
const SHUFFLE_AT = 900; // ms : le flash dure 500 ms, petite pause puis mélange

export const createDesamorcage: MgFactory = (env) => {
  const spec = desamorcageSpec(env.start.seed);
  const r = rng(env.start.seed ^ 0x99);
  // ordre d'affichage après mélange (permutation dérivée de la graine, peu importe : seule la couleur compte pour le serveur)
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (order.every((c, i) => c === i)) order.reverse();
  let shuffled = false;
  let cutColor = -1;
  let cutAt = 0;
  let done = false;
  let boom = false;

  const slotOf = (color: number) => (shuffled ? order.indexOf(color) : color);

  return {
    onDown(btn) {
      if (btn !== 0 || done) return;
      const t = env.now();
      if (!shuffled) { env.sfx('mg_buzz'); return; }
      for (let c = 0; c < WIRE_COLORS; c++) {
        const y = Y0 + 20 + slotOf(c) * GAP;
        if (env.cursor.x > X0 - 20 && env.cursor.x < X1 + 20 && Math.abs(env.cursor.y - y) < 24) {
          done = true;
          cutColor = c;
          cutAt = t;
          if (c === spec.wire) { env.sfx('mg_spark'); env.finish(true, [c]); } else { boom = true; env.sfx('mg_crack'); env.finish(false, [c]); }
          return;
        }
      }
    },
    update(_dt, t) {
      if (!shuffled && t >= SHUFFLE_AT) { shuffled = true; env.sfx('mg_tick', 4); }
    },
    draw(g, t) {
      box(g, 40, 40, W - 80, H - 80, PAL.dark, 22);
      // minuteur de bombe
      box(g, W / 2 - 80, 56, 160, 40, '#111', 8, 4);
      for (let i = 0; i < 3; i++) disc(g, W / 2 - 40 + i * 40, 76, 12, Math.floor(t / 250) % 3 === i ? PAL.red : '#700', 4);
      const flashing = t < spec.flashMs;
      for (let c = 0; c < WIRE_COLORS; c++) {
        const slot = slotOf(c);
        // glissement pendant le mélange
        const y = Y0 + 20 + slot * GAP;
        const isCut = cutColor === c;
        const hot = flashing && c === spec.wire;
        const dim = flashing && c !== spec.wire;
        const col = dim ? '#777' : COLORS[c];
        g.lineCap = 'round';
        const sag = Math.sin(t / 400 + c) * 4;
        for (const [w, s] of [[16, INK], [10, col]] as const) {
          g.lineWidth = w;
          g.strokeStyle = s;
          g.beginPath();
          if (isCut) {
            g.moveTo(X0, y);
            g.lineTo((X0 + X1) / 2 - 24, y + sag + 18);
            g.moveTo((X0 + X1) / 2 + 24, y + sag - 18);
            g.lineTo(X1, y);
          } else {
            g.moveTo(X0, y);
            g.quadraticCurveTo((X0 + X1) / 2, y + sag * 2, X1, y);
          }
          g.stroke();
        }
        disc(g, X0 - 10, y, 14, PAL.metal, 4);
        disc(g, X1 + 10, y, 14, PAL.metal, 4);
        if (hot) burst(g, W / 2, y, 50 + Math.sin(t / 40) * 8, '#fff', 10, t / 100);
      }
      if (cutColor >= 0 && t - cutAt < 600) {
        burst(g, W / 2, Y0 + 20 + slotOf(cutColor) * GAP, 40 + (t - cutAt) / 4, boom ? PAL.red : PAL.green, 10, t / 120);
      }
      void H;
    },
  };
};
