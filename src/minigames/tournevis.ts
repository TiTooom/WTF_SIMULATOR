// PROPRIÉTAIRE : game-minigames
// Tournevis dans le contact : maintenir le clic pour enfoncer, puis décrire des cercles rapides autour du barillet jusqu'à briser le verrou.
// Données envoyées : [tours accomplis, ms d'enfoncement]. Règle : shared/minigames/rules.ts (tournevisSpec).
import { tournevisSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, disc, line, type MgFactory } from './kit';

const CX = W / 2;
const CY = H / 2 + 10;
const TWO_PI = Math.PI * 2;

export const createTournevis: MgFactory = (env) => {
  const spec = tournevisSpec(env.start.seed, env.start.difficulty);
  let push = 0; // 0..1 enfoncement
  let pressMs = 0;
  let acc = 0; // angle cumulé dans le bon sens (rad)
  let lastAng: number | null = null;
  let tickAt = 0;
  let shake = 0;
  let done = false;
  const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  const goal = spec.turns * TWO_PI;

  const angOf = () => Math.atan2(env.cursor.y - CY, env.cursor.x - CX);

  return {
    onDown() { env.sfx('mg_push'); },
    update(dt) {
      if (done) return;
      push = clamp(push + (env.down ? dt / 0.22 : -dt / 0.12), 0, 1);
      if (env.down) pressMs += dt * 1000;
      const a = angOf();
      const dist = Math.hypot(env.cursor.x - CX, env.cursor.y - CY);
      if (push > 0.85 && dist > 20 && dist < 190) {
        if (lastAng !== null) {
          let d = a - lastAng;
          if (d > Math.PI) d -= TWO_PI;
          if (d < -Math.PI) d += TWO_PI;
          d *= spec.dir;
          if (d > 0) acc += d;
          else acc = Math.max(0, acc + d * 0.5); // tourner à l'envers défait un peu
        }
        lastAng = a;
      } else lastAng = null;
      const step = Math.floor(acc / (Math.PI / 6)); // un cran tous les 30°
      if (step > tickAt) {
        tickAt = step;
        env.sfx('mg_tick', Math.floor((acc / goal) * 8));
        sparks.push({ x: CX + (Math.random() - 0.5) * 60, y: CY + (Math.random() - 0.5) * 60, vx: (Math.random() - 0.5) * 240, vy: -Math.random() * 200, life: 0.35 });
        shake = 0.12;
      }
      shake = Math.max(0, shake - dt);
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 600 * dt; s.life -= dt; }
      while (sparks.length && sparks[0].life <= 0) sparks.shift();
      if (acc >= goal) {
        done = true;
        env.sfx('mg_crack');
        env.finish(true, [Math.floor(acc / TWO_PI + 1e-6), Math.round(pressMs)]);
      }
    },
    draw(g) {
      const p = clamp(acc / goal, 0, 1);
      const sx = shake > 0 ? (Math.random() - 0.5) * 8 : 0;
      g.save();
      g.translate(sx, 0);
      // plaque + barillet qui tourne
      box(g, CX - 150, CY - 130, 300, 260, PAL.metal, 18);
      for (const [x, y] of [[-125, -105], [125, -105], [-125, 105], [125, 105]]) disc(g, CX + x, CY + y, 9, '#cfd6dd', 4);
      g.save();
      g.translate(CX, CY);
      g.rotate(acc * spec.dir);
      disc(g, 0, 0, 78, PAL.yellow, 6);
      for (let i = 0; i < 8; i++) {
        g.rotate(Math.PI / 4);
        g.fillStyle = INK;
        g.fillRect(-3, -76, 6, 14);
      }
      box(g, -13, -44, 26, 88, PAL.dark, 8, 4); // fente de la clé
      // fissures : plus nombreuses à mesure qu'on avance
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.beginPath();
      for (let i = 0; i < Math.floor(p * 6); i++) {
        const a = i * 1.7;
        g.moveTo(Math.cos(a) * 20, Math.sin(a) * 20);
        g.lineTo(Math.cos(a + 0.2) * 55, Math.sin(a + 0.2) * 55);
        g.lineTo(Math.cos(a - 0.1) * 76, Math.sin(a - 0.1) * 76);
      }
      g.stroke();
      g.restore();
      // tournevis (suit le curseur ; s'enfonce quand on maintient)
      const tx = env.cursor.x;
      const ty = env.cursor.y;
      const sc = 1 - push * 0.25;
      g.save();
      g.translate(tx, ty);
      g.rotate(-0.5);
      g.scale(sc, sc);
      line(g, [[0, 0], [0, -70]], '#cfd6dd', 8);
      box(g, -13, -125, 26, 58, PAL.red, 9, 4);
      g.restore();
      g.restore();
      // jauge de progression (anneau)
      g.lineWidth = 12;
      g.strokeStyle = INK;
      g.beginPath();
      g.arc(CX, CY, 150, -Math.PI / 2, -Math.PI / 2 + TWO_PI);
      g.stroke();
      g.lineWidth = 7;
      g.strokeStyle = PAL.green;
      g.beginPath();
      g.arc(CX, CY, 150, -Math.PI / 2, -Math.PI / 2 + TWO_PI * p);
      g.stroke();
      for (const s of sparks) burst(g, s.x, s.y, 8 + s.life * 20, PAL.yellow, 5, s.life * 6);
    },
  };
};
