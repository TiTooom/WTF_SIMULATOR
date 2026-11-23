// PROPRIÉTAIRE : game-minigames
// Brise-glace : marteler la vitre (clic gauche ou Espace) ; chaque coup agrandit la fissure, le dernier la fait voler en éclats.
// Données envoyées : [nombre de coups]. Règle : shared/minigames/rules.ts (briseGlaceSpec).
import { briseGlaceSpec, rng } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, line, type MgFactory } from './kit';

const CX = W / 2;
const CY = H / 2 + 6;

export const createBriseGlace: MgFactory = (env) => {
  const spec = briseGlaceSpec(env.start.seed, env.start.difficulty);
  const r = rng(env.start.seed ^ 0xabcdef);
  // branches de fissure précalculées : chaque coup en révèle une
  const cracks: [number, number][][] = Array.from({ length: spec.hits }, (_, i) => {
    const a0 = (i / spec.hits) * Math.PI * 2 + r() * 0.8;
    const pts: [number, number][] = [[CX, CY]];
    let a = a0;
    let rad = 0;
    for (let k = 0; k < 4; k++) {
      rad += 35 + r() * 30;
      a += (r() - 0.5) * 0.7;
      pts.push([CX + Math.cos(a) * rad, CY + Math.sin(a) * rad * 0.8]);
    }
    return pts;
  });
  let hits = 0;
  let last = -1e9;
  let swing = 0;
  let shake = 0;
  let done = false;
  const shards: { x: number; y: number; vx: number; vy: number; rot: number }[] = [];

  const hit = () => {
    if (done) return;
    const t = env.now();
    if (t - last < 62) return; // reste sous la cadence maximale du serveur
    last = t;
    hits++;
    swing = 1;
    shake = 0.12;
    if (hits >= spec.hits) {
      done = true;
      env.sfx('mg_crack');
      for (let i = 0; i < 26; i++) shards.push({ x: CX, y: CY, vx: (r() - 0.5) * 900, vy: (r() - 0.7) * 700, rot: r() * 6 });
      env.finish(true, [hits]);
    } else env.sfx('mg_hit');
  };

  return {
    onDown(btn) { if (btn === 0) hit(); },
    onKey(code) { if (code === 'Space') hit(); },
    update(dt) {
      swing = Math.max(0, swing - dt * 7);
      shake = Math.max(0, shake - dt);
      for (const s of shards) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 1400 * dt; s.rot += dt * 8; }
    },
    draw(g) {
      const sx = shake > 0 ? (Math.random() - 0.5) * 12 : 0;
      const sy = shake > 0 ? (Math.random() - 0.5) * 12 : 0;
      g.save();
      g.translate(sx, sy);
      if (!done) {
        // vitre
        box(g, CX - 200, CY - 150, 400, 300, 'rgba(160,220,255,0.75)', 18, 8);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.beginPath();
        g.moveTo(CX - 170, CY - 120);
        g.lineTo(CX - 90, CY - 120);
        g.lineTo(CX - 170, CY - 40);
        g.fill();
        for (let i = 0; i < hits; i++) line(g, cracks[i], '#fff', 4);
        burst(g, CX, CY, 20 + hits * 5, PAL.yellow, 7, hits);
      }
      for (const s of shards) {
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.rot);
        g.fillStyle = 'rgba(160,220,255,0.9)';
        g.strokeStyle = INK;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-14, 10);
        g.lineTo(0, -16);
        g.lineTo(16, 12);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
      g.restore();
      // marteau qui s'abat
      const a = -0.9 + swing * 1.1;
      g.save();
      g.translate(CX + 150, CY + 150);
      g.rotate(a);
      line(g, [[0, 0], [-120, -10]], '#8d5a2b', 14);
      box(g, -170, -50, 60, 80, PAL.metal, 8, 5);
      g.restore();
      // compteur de coups (pastilles)
      for (let i = 0; i < spec.hits; i++) {
        g.beginPath();
        g.arc(CX - ((spec.hits - 1) * 18) + i * 36, H - 30, 9, 0, Math.PI * 2);
        g.fillStyle = i < hits ? PAL.red : '#fff4d6';
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = INK;
        g.stroke();
      }
      void clamp;
    },
  };
};
