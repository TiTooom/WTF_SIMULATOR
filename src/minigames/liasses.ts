// PROPRIÉTAIRE : game-minigames
// Liasses : glisser des liasses (clic maintenu sur la pile de gauche, relâcher au-dessus de la jauge) jusqu'à la zone verte, sans dépasser.
// Valider avec le tampon vert (clic) ou Entrée. Une liasse de trop (au-delà de la tolérance) = les billets s'envolent (échec).
// Données envoyées : [liasses posées]. Règle : shared/minigames/rules.ts (liassesSpec : cible 3..5, tolérance 1 ou 0 selon la difficulté).
// Détail drôle : le contact à lunettes noires fait office de jauge de satisfaction (grimace, sourire, rage).
import { liassesSpec } from '../../shared/minigames/rules';
import { INK, PAL, box, burst, disc, sweat, type MgFactory } from './kit';

const STACK = { x: 55, y: 240, w: 120, h: 70 };
const GAUGE = { x: 270, y: 70, w: 110, h: 290 };
const MAX_SLOTS = 8;
const STAMP = { x: 440, y: 305, w: 150, h: 56 };
const FACE = { x: 515, y: 185, r: 62 };

export const createLiasses: MgFactory = (env) => {
  const spec = liassesSpec(env.start.seed, env.start.difficulty);
  let placed = 0;
  let carrying = false;
  let done = false;
  let over = false;
  let at = 0;
  let nod = 0; // hochement de tête du contact quand une liasse tombe
  const flying: { x: number; y: number; vx: number; vy: number; rot: number }[] = [];

  const slotH = GAUGE.h / MAX_SLOTS;
  const inGauge = () => env.cursor.x > GAUGE.x - 70 && env.cursor.x < GAUGE.x + GAUGE.w + 70 && env.cursor.y > GAUGE.y - 30 && env.cursor.y < GAUGE.y + GAUGE.h + 30;

  const validate = () => {
    if (done || placed < spec.target) return;
    done = true;
    env.sfx('mg_stamp');
    env.finish(true, [placed]);
  };
  const place = () => {
    placed++;
    nod = 1;
    env.sfx('mg_coin', placed);
    if (placed > spec.target + spec.maxOver) {
      done = true;
      over = true;
      at = env.now();
      for (let i = 0; i < 14; i++) flying.push({ x: GAUGE.x + GAUGE.w / 2, y: GAUGE.y + 40, vx: (Math.random() - 0.5) * 700, vy: -200 - Math.random() * 400, rot: Math.random() * 6 });
      env.sfx('mg_flutter');
      env.finish(false, [placed]);
    }
  };

  return {
    probe: () => ({ sx: STACK.x + STACK.w / 2, sy: STACK.y + STACK.h / 2, gx: GAUGE.x + GAUGE.w / 2, gy: GAUGE.y + GAUGE.h / 2, tx: STAMP.x + STAMP.w / 2, ty: STAMP.y + STAMP.h / 2, placed, target: spec.target }),
    onDown(btn) {
      if (btn !== 0 || done) return;
      const c = env.cursor;
      if (placed >= spec.target && c.x > STAMP.x - 10 && c.x < STAMP.x + STAMP.w + 10 && c.y > STAMP.y - 10 && c.y < STAMP.y + STAMP.h + 10) { validate(); return; }
      if (c.x > STACK.x - 30 && c.x < STACK.x + STACK.w + 30 && c.y > STACK.y - 50 && c.y < STACK.y + STACK.h + 30) { carrying = true; env.sfx('mg_rustle'); }
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
      nod = Math.max(0, nod - dt * 5);
      for (const f of flying) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 1200 * dt; f.rot += dt * 9; }
    },
    draw(g, t) {
      box(g, 20, 50, 600, 320, PAL.paper, 20);
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
      g.fillRect(GAUGE.x + 6, zy1, GAUGE.w - 12, zy2 - zy1);
      g.strokeStyle = PAL.green;
      g.lineWidth = 4;
      g.strokeRect(GAUGE.x + 6, zy1, GAUGE.w - 12, zy2 - zy1);
      for (let i = 0; i < Math.min(placed, MAX_SLOTS); i++) {
        const y = GAUGE.y + GAUGE.h - (i + 1) * slotH;
        box(g, GAUGE.x + 12, y + 2, GAUGE.w - 24, slotH - 4, over ? PAL.red : PAL.green, 4, 3);
      }
      // contact à lunettes noires : sa mine suit le nombre de liasses
      {
        const mood = over ? 2 : placed >= spec.target ? 1 : 0; // 0 = impatient, 1 = content, 2 = furieux
        const bob = Math.sin(t / (mood === 0 ? 140 : 300)) * (mood === 0 ? 2.5 : 1.5) - nod * 8;
        const fx = FACE.x;
        const fy = FACE.y + bob;
        disc(g, fx, fy, FACE.r, mood === 2 ? PAL.red : '#f1c27d', 6);
        // lunettes noires
        g.fillStyle = INK;
        g.fillRect(fx - 50, fy - 22, 100, 7);
        for (const sx of [-26, 26]) {
          g.beginPath();
          g.roundRect(fx + sx - 20, fy - 22, 40, 28, 8);
          g.fill();
          g.fillStyle = '#fff';
          g.fillRect(fx + sx - 13, fy - 17, 8, 5);
          g.fillStyle = INK;
        }
        // bouche
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.strokeStyle = INK;
        g.beginPath();
        if (mood === 1) g.arc(fx, fy + 18, 22, 0.15 * Math.PI, 0.85 * Math.PI);
        else if (mood === 2) g.arc(fx, fy + 46, 20, 1.15 * Math.PI, 1.85 * Math.PI);
        else { g.moveTo(fx - 18, fy + 34); g.lineTo(fx + 18, fy + 34 + Math.sin(t / 140) * 3); }
        g.stroke();
        if (mood === 0) sweat(g, fx + 56, fy - 38 + ((t / 8) % 14), 0.8);
        if (mood === 2) burst(g, fx - 66, fy - 56, 16 + Math.sin(t / 60) * 3, '#fff', 6, t / 90);
      }
      // tampon de validation
      const ready = placed >= spec.target && !done;
      if (ready) {
        box(g, STAMP.x, STAMP.y + Math.sin(t / 90) * 3, STAMP.w, STAMP.h, PAL.green, 14, 6);
        g.strokeStyle = INK;
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(STAMP.x + 45, STAMP.y + 30);
        g.lineTo(STAMP.x + 65, STAMP.y + 44);
        g.lineTo(STAMP.x + 105, STAMP.y + 12);
        g.stroke();
      }
      // liasse portée
      if (carrying) {
        box(g, env.cursor.x - 40, env.cursor.y - 22, 80, 44, PAL.green, 6, 5);
        g.fillStyle = INK;
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
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
    },
  };
};
