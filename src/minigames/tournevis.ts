// PROPRIÉTAIRE : game-minigames
// Tournevis dans le contact : maintenir le clic pour enfoncer, puis décrire des cercles rapides autour du barillet jusqu'à briser le verrou.
// Données envoyées : [tours accomplis, ms d'enfoncement]. Règle : shared/minigames/rules.ts (tournevisSpec).
import { tournevisSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, disc, googly, line, type MgFactory } from './kit';

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
  let turnsSq = 0; // tours entiers déjà fêtés par un couinement du canard
  let squeeze = 0; // écrasement du canard porte-clés (0..1)
  const maxR = 190 - 60 * env.start.difficulty; // plus dur : il faut tourner plus près du barillet
  let done = false;
  const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  const goal = spec.turns * TWO_PI;

  let lastT = env.now();
  let holding = false; // état du bouton intégré par advance() (env.down a déjà changé quand onDown/onUp arrivent)
  const angOf = () => Math.atan2(env.cursor.y - CY, env.cursor.x - CX);

  /** Enfoncement en temps réel (indépendant du nombre d'images par seconde). */
  const advance = () => {
    const t = env.now();
    const dt = Math.min(0.25, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    push = clamp(push + (holding ? dt / 0.22 : -dt / 0.12), 0, 1);
    if (holding) pressMs += dt * 1000;
  };

  /** Cumule l'angle parcouru autour du barillet à chaque mouvement de souris (pas par image : robuste aux machines lentes). */
  const track = () => {
    if (done) return;
    advance();
    const a = angOf();
    const dist = Math.hypot(env.cursor.x - CX, env.cursor.y - CY);
    if (push > 0.85 && dist > 20 && dist < maxR) {
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
      env.sfx('mg_ratchet', Math.floor((acc / goal) * 8));
      sparks.push({ x: CX + (Math.random() - 0.5) * 60, y: CY + (Math.random() - 0.5) * 60, vx: (Math.random() - 0.5) * 240, vy: -Math.random() * 200, life: 0.35 });
      shake = 0.12;
    }
    const tn = Math.floor(acc / TWO_PI);
    if (tn > turnsSq && acc < goal) { turnsSq = tn; squeeze = 1; env.sfx('mg_squeak'); } // chaque tour complet : le canard porte-clés couine
    if (acc >= goal) {
      done = true;
      env.sfx('mg_crack');
      env.finish(true, [Math.floor(acc / TWO_PI + 1e-6), Math.round(pressMs)]);
    }
  };

  return {
    probe: () => ({ cx: CX, cy: CY, acc, push }),
    onDown(btn) { if (btn !== 0) return; advance(); holding = true; env.sfx('mg_push'); },
    onUp(btn) { if (btn !== 0) return; advance(); holding = false; },
    onMove: track,
    update(dt) {
      if (done) return;
      track();
      shake = Math.max(0, shake - dt);
      squeeze = Math.max(0, squeeze - dt * 3);
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 600 * dt; s.life -= dt; }
      while (sparks.length && sparks[0].life <= 0) sparks.shift();
    },
    draw(g, t) {
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
      // canard porte-clés : se balance, se fait écraser et écarquille les yeux à chaque tour
      {
        const sw = Math.sin(t / 260) * 0.12 + (shake > 0 ? 0.35 : 0);
        g.save();
        g.translate(CX + 118, CY + 62);
        g.rotate(sw);
        g.lineWidth = 3;
        g.strokeStyle = INK;
        g.beginPath();
        g.moveTo(0, -48);
        g.lineTo(0, -10);
        g.stroke();
        g.scale(1 + 0.3 * squeeze, 1 - 0.25 * squeeze);
        disc(g, 0, 10, 22, PAL.yellow, 5);
        disc(g, 12, -10, 14, PAL.yellow, 5);
        box(g, 19, -9, 18, 9, PAL.orange, 4, 3);
        googly(g, 11, -14, 5, env.cursor.x - (CX + 118), env.cursor.y - (CY + 62), p > 0.5 || squeeze > 0.3);
        g.restore();
      }
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
