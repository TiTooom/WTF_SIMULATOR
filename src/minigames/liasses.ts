// PROPRIÉTAIRE : game-minigames
// Liasses : glisser des liasses (clic maintenu depuis la pile de gauche, relâcher au-dessus de la jauge) jusqu'à la zone verte, sans dépasser.
// Valider avec le tampon vert (clic) ou Entrée. Une liasse de trop = les billets s'envolent (échec). Données envoyées : [liasses posées].
// Règle : shared/minigames/rules.ts (liassesSpec).
import { liassesSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, type MgFactory } from './kit';

const STACK = { x: 50, y: 230, w: 120, h: 70 };
const GAUGE = { x: 430, y: 70, w: 120, h: 300 };
const MAX_SLOTS = 8;
const STAMP = { x: 245, y: 305, w: 150, h: 60 };

export const createLiasses: MgFactory = (env) => {
  const spec = liassesSpec(env.start.seed);
  let placed = 0;
  let carrying = false;
  let done = false;
  let over = false;
  let at = 0;
  const flying: { x: number; y: number; vx: number; vy: number; rot: number }[] = [];

  const slotH = GAUGE.h / MAX_SLOTS;
  const inGauge = () => env.cursor.x > GAUGE.x - 30 && env.cursor.x < GAUGE.x + GAUGE.w + 30 && env.cursor.y > GAUGE.y - 20 && env.cursor.y < GAUGE.y + GAUGE.h + 20;

  const validate = () => {
    if (done || placed < spec.target) return;
    done = true;
    env.sfx('mg_lock');
    env.finish(true, [placed]);
  };
  const place = () => {
    placed++;
    env.sfx('mg_tick', placed * 2);
    if (placed > spec.target + spec.maxOver) {
      done = true;
      over = true;
      at = env.now();
      for (let i = 0; i < 14; i++) flying.push({ x: GAUGE.x + GAUGE.w / 2, y: GAUGE.y + 40, vx: (Math.random() - 0.5) * 700, vy: -200 - Math.random() * 400, rot: Math.random() * 6 });
      env.sfx('mg_buzz');
      env.finish(false, [placed]);
    }
  };

  return {
    onDown(btn) {
      if (btn !== 0 || done) return;
      const c = env.cursor;
      if (placed >= spec.target && c.x > STAMP.x && c.x < STAMP.x + STAMP.w && c.y > STAMP.y && c.y < STAMP.y + STAMP.h) { validate(); return; }
      if (c.x > STACK.x - 20 && c.x < STACK.x + STACK.w + 20 && c.y > STACK.y - 40 && c.y < STACK.y + STACK.h + 20) { carrying = true; env.sfx('mg_push'); }
    },
    onUp(btn) {
      if (btn !== 0 || done || !carrying) return;
      carrying = false;
      if (inGauge()) place();
    },
    onKey(code) {
      if (code === 'Enter') validate();
    },
    update(dt) {
      for (const f of flying) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1200 * dt; f.rot += dt * 9; }
    },
    draw(g, t) {
      box(g, 20, 50, W - 40, H - 80, PAL.paper, 20);
      // pile de liasses source
      for (let i = 0; i < 3; i++) box(g, STACK.x, STACK.y - i * 14, STACK.w, STACK.h, PAL.green, 6, 5);
      g.fillStyle = INK;
      g.font = 'bold 34px sans-serif';
      g.textAlign = 'center';
      g.fillText('$', STACK.x + STACK.w / 2, STACK.y - 12);
      // jauge
      box(g, GAUGE.x, GAUGE.y, GAUGE.w, GAUGE.h, '#fff', 10, 6);
      // zone verte : de `target` à `target + maxOver` liasses
      const zy1 = GAUGE.y + GAUGE.h - (spec.target + spec.maxOver) * slotH;
      const zy2 = GAUGE.y + GAUGE.h - (spec.target - 1) * slotH;
      g.fillStyle = 'rgba(46,204,113,0.45)';
      g.fillRect(GAUGE.x + 6, zy1, GAUGE.w - 12, zy2 - zy1 - slotH * 0 );
      g.strokeStyle = PAL.green;
      g.lineWidth = 4;
      g.strokeRect(GAUGE.x + 6, zy1, GAUGE.w - 12, zy2 - zy1);
      for (let i = 0; i < Math.min(placed, MAX_SLOTS); i++) {
        const y = GAUGE.y + GAUGE.h - (i + 1) * slotH;
        box(g, GAUGE.x + 12, y + 2, GAUGE.w - 24, slotH - 4, over ? PAL.red : PAL.green, 4, 3);
      }
      // tampon de validation
      const ready = placed >= spec.target && !done;
      if (ready) {
        box(g, STAMP.x, STAMP.y + Math.sin(t / 90) * 3, STAMP.w, STAMP.h, PAL.green, 14, 6);
        g.strokeStyle = INK;
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(STAMP.x + 50, STAMP.y + 32);
        g.lineTo(STAMP.x + 70, STAMP.y + 48);
        g.lineTo(STAMP.x + 105, STAMP.y + 14);
        g.stroke();
      }
      // liasse portée
      if (carrying) {
        box(g, env.cursor.x - 40, env.cursor.y - 22, 80, 44, PAL.green, 6, 5);
        g.fillStyle = INK;
        g.font = 'bold 22px sans-serif';
        g.fillText('$', env.cursor.x, env.cursor.y + 8);
        if (inGauge()) burst(g, GAUGE.x + GAUGE.w / 2, GAUGE.y + GAUGE.h / 2, 30 + Math.sin(t / 80) * 5, PAL.yellow, 6, t / 200);
      }
      for (const f of flying) {
        g.save();
        g.translate(f.x, f.y);
        g.rotate(f.rot);
        box(g, -24, -12, 48, 24, PAL.green, 4, 3);
        g.restore();
      }
      if (over && env.now() - at < 500) burst(g, GAUGE.x + GAUGE.w / 2, GAUGE.y + 40, 40 + (env.now() - at) / 4, PAL.red, 10, t / 150);
      void clamp;
      void H;
      void W;
    },
  };
};
