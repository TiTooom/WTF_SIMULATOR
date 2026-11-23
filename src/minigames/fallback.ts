// PROPRIÉTAIRE : game-minigames
// Repli minimal des mini-jeux pas encore écrits (TODO vague 4) : un anneau se remplit pendant la durée minimale plausible, puis un clic
// valide. Cliquer trop tôt secoue l'anneau (buzzer). Les données envoyées sont celles attendues par shared/minigames/rules.ts.
import { RULES } from '../../shared/minigames/rules';
import type { MinigameKind } from '../../shared/ids';
import { H, INK, PAL, W, box, burst, clamp, disc, type MgFactory } from './kit';

export function fallbackGame(kind: MinigameKind, color: string, data: (seed: number, difficulty: number) => number[]): MgFactory {
  return (env) => {
    const wait = RULES[kind].minMs + 150;
    let shake = 0;
    let ready = false;
    let done = false;
    return {
      onDown(btn) {
        if (btn !== 0 || done) return;
        if (!ready) { shake = 0.25; env.sfx('mg_buzz'); return; }
        done = true;
        env.sfx('mg_lock');
        env.finish(true, data(env.start.seed, env.start.difficulty));
      },
      update(dt, t) {
        shake = Math.max(0, shake - dt);
        if (!ready && t >= wait) { ready = true; env.sfx('mg_tick', 6); }
      },
      draw(g, t) {
        const p = clamp(t / wait, 0, 1);
        const sx = shake > 0 ? (Math.random() - 0.5) * 14 : 0;
        box(g, 120 + sx, 60, W - 240, H - 120, PAL.paper, 24);
        disc(g, W / 2 + sx, H / 2, 90, color, 6);
        g.lineWidth = 16;
        g.strokeStyle = INK;
        g.beginPath();
        g.arc(W / 2 + sx, H / 2, 120, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 10;
        g.strokeStyle = ready ? PAL.green : PAL.orange;
        g.beginPath();
        g.arc(W / 2 + sx, H / 2, 120, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        g.stroke();
        if (ready) burst(g, W / 2, H / 2, 60 + Math.sin(t / 90) * 8, PAL.yellow, 8, t / 400);
      },
    };
  };
}
