// PROPRIÉTAIRE : game-minigames
// Fouille : 5 tas de détritus. Balayer le tas qui brille (va-et-vient horizontal du curseur, sans cliquer) pour le dégager, puis cliquer
// l'objet. Les autres tas se balaient aussi (ils sont vides : poussière et canette). Données envoyées : [tas, nombre de balayages].
// Règle : shared/minigames/rules.ts (fouilleSpec).
import { FOUILLE_SLOTS, fouilleSpec, rng } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, disc, type MgFactory } from './kit';

const PW = 100;
const PY = 190;
const PH = 130;
const GAPX = (W - FOUILLE_SLOTS * PW) / (FOUILLE_SLOTS + 1);
const px = (i: number) => GAPX + i * (PW + GAPX);
const SWIPE_PX = 45;

export const createFouille: MgFactory = (env) => {
  const spec = fouilleSpec(env.start.seed);
  const r = rng(env.start.seed ^ 0x77);
  const junk = Array.from({ length: FOUILLE_SLOTS }, () => Array.from({ length: 7 }, () => ({ x: r(), y: r(), s: 10 + r() * 14, c: r() })));
  const swipes = new Array<number>(FOUILLE_SLOTS).fill(0);
  const acc = new Array<number>(FOUILLE_SLOTS).fill(0);
  const lastDir = new Array<number>(FOUILLE_SLOTS).fill(0);
  let lastX = env.cursor.x;
  let done = false;
  let grabAt = -1;
  const dust: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  const colors = ['#8d6e63', '#78909c', '#a1887f', '#607d8b', '#bcaaa4'];

  const cleared = (i: number) => (i === spec.slot ? swipes[i] >= spec.swipes : swipes[i] >= 2);

  return {
    onDown(btn) {
      if (btn !== 0 || done) return;
      const i = spec.slot;
      const cx = px(i) + PW / 2;
      if (swipes[i] >= spec.swipes && Math.hypot(env.cursor.x - cx, env.cursor.y - (PY + PH * 0.55)) < 60) {
        done = true;
        grabAt = env.now();
        env.sfx('mg_lock');
        env.finish(true, [i, swipes[i]]);
      } else env.sfx('mg_tick', 0);
    },
    update(dt) {
      for (const d of dust) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 500 * dt; d.life -= dt; }
      while (dust.length && dust[0].life <= 0) dust.shift();
      const cx = env.cursor.x;
      const dx = cx - lastX;
      lastX = cx;
      if (done) return;
      for (let i = 0; i < FOUILLE_SLOTS; i++) {
        const inside = cx > px(i) - 10 && cx < px(i) + PW + 10 && env.cursor.y > PY - 40 && env.cursor.y < PY + PH + 10;
        if (!inside || cleared(i) && i !== spec.slot) { acc[i] = 0; continue; }
        if (i === spec.slot && swipes[i] >= spec.swipes) continue;
        const sg = Math.sign(dx);
        if (sg === 0) continue;
        acc[i] = Math.sign(acc[i]) === sg ? acc[i] + dx : dx;
        if (Math.abs(acc[i]) >= SWIPE_PX && sg !== lastDir[i]) {
          swipes[i]++;
          lastDir[i] = sg;
          acc[i] = 0;
          env.sfx('mg_tick', swipes[i] * 2);
          for (let k = 0; k < 6; k++) dust.push({ x: cx, y: PY + PH * 0.5, vx: sg * (80 + Math.random() * 160), vy: -Math.random() * 200, life: 0.4 });
        }
      }
    },
    draw(g, t) {
      box(g, 20, 60, W - 40, H - 100, '#6d4c41', 20);
      g.fillStyle = '#5d4037';
      g.fillRect(34, PY + PH + 6, W - 68, 30);
      for (let i = 0; i < FOUILLE_SLOTS; i++) {
        const x = px(i);
        const k = Math.min(1, swipes[i] / (i === spec.slot ? spec.swipes : 2));
        // objet caché : brille doucement sous le bon tas
        if (i === spec.slot) {
          const bx = x + PW / 2;
          const by = PY + PH * 0.55;
          disc(g, bx, by, 24, PAL.yellow, 5);
          g.fillStyle = '#fff';
          g.fillRect(bx - 4, by - 14, 8, 8);
          if (k < 1) burst(g, bx, by - 30 - k * 10, 14 + Math.sin(t / 120) * 4, '#fff', 4, t / 300);
          else burst(g, bx, by, 44 + Math.sin(t / 90) * 6, PAL.yellow, 8, t / 400);
        }
        // tas de détritus : s'affaisse à mesure qu'on balaie
        const hh = PH * (1 - k);
        if (hh > 4) {
          g.save();
          g.beginPath();
          g.rect(x - 12, PY + PH - hh, PW + 24, hh + 30);
          g.clip();
          for (const j of junk[i]) {
            const jx = x + j.x * (PW - 10);
            const jy = PY + PH - j.y * hh * 0.9 - 8 + k * 20;
            g.fillStyle = colors[Math.floor(j.c * colors.length)];
            g.strokeStyle = INK;
            g.lineWidth = 4;
            g.beginPath();
            g.roundRect(jx, jy, j.s + 8, j.s, 5);
            g.fill();
            g.stroke();
          }
          g.restore();
        }
      }
      g.fillStyle = '#d7ccc8';
      for (const d of dust) g.fillRect(d.x, d.y, 8, 8);
      if (grabAt >= 0) burst(g, px(spec.slot) + PW / 2, PY + PH * 0.55, 50 + (env.now() - grabAt) / 3, PAL.green, 10, t / 200);
      // balai (suit le curseur)
      if (!done) {
        g.save();
        g.translate(env.cursor.x, env.cursor.y + 24);
        g.rotate(Math.sin(env.cursor.x / 30) * 0.25 + 0.35);
        g.strokeStyle = INK;
        g.lineWidth = 12;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(26, -80);
        g.stroke();
        g.strokeStyle = '#c28e0e';
        g.lineWidth = 6;
        g.stroke();
        box(g, -26, -6, 52, 28, PAL.yellow, 5, 4);
        g.restore();
      }
      void clamp;
      void H;
    },
  };
};
