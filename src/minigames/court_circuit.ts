// PROPRIÉTAIRE : game-minigames
// Court-circuit sous le volant : glisser les deux bouts de câble dénudés dans la zone cuivrée et les maintenir en contact 1 s.
// Données envoyées : [ms de contact cumulés]. Règle : shared/minigames/rules.ts (courtCircuitSpec, HOTWIRE_HOLD_MS).
import { HOTWIRE_HOLD_MS, courtCircuitSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, disc, line, type MgFactory } from './kit';

const GRAB = 42; // rayon de saisie d'un bout de câble
const CONTACT = 26; // distance de contact entre les deux bouts
const ZONE_R = 95;

export const createCourtCircuit: MgFactory = (env) => {
  const spec = courtCircuitSpec(env.start.seed);
  const zone = { x: spec.meetX * W, y: ((spec.ay + spec.by) / 2) * H };
  const ends = [
    { x: 70, y: spec.ay * H, home: [70, spec.ay * H] },
    { x: W - 70, y: spec.by * H, home: [W - 70, spec.by * H] },
  ];
  let held = -1;
  let hold = 0;
  let wasTouching = false;
  let flash = 0;
  let done = false;

  const inZone = (e: { x: number; y: number }) => Math.hypot(e.x - zone.x, e.y - zone.y) < ZONE_R;

  return {
    onDown(btn) {
      if (btn !== 0 || done) return;
      let best = -1;
      let bd = GRAB;
      ends.forEach((e, i) => { const d = Math.hypot(e.x - env.cursor.x, e.y - env.cursor.y); if (d < bd) { bd = d; best = i; } });
      held = best;
      if (best >= 0) env.sfx('mg_push');
    },
    onUp() { held = -1; },
    update(dt) {
      if (done) return;
      if (held >= 0 && env.down) {
        ends[held].x = clamp(env.cursor.x, 30, W - 30);
        ends[held].y = clamp(env.cursor.y, 30, H - 30);
      } else held = -1;
      const touching = Math.hypot(ends[0].x - ends[1].x, ends[0].y - ends[1].y) < CONTACT && inZone(ends[0]) && inZone(ends[1]);
      if (touching) {
        if (!wasTouching) env.sfx('mg_spark');
        hold += dt * 1000;
        flash = (flash + dt * 30) % 2;
        if (Math.floor(hold / 120) !== Math.floor((hold - dt * 1000) / 120)) env.sfx('mg_tick', Math.floor(hold / 120));
      } else {
        hold = Math.max(0, hold - dt * 1500); // le contact se perd : la jauge retombe vite
      }
      wasTouching = touching;
      if (hold >= HOTWIRE_HOLD_MS) {
        done = true;
        env.finish(true, [Math.round(hold)]);
      }
    },
    draw(g) {
      // boîtier ouvert sous le volant
      box(g, 20, 20, W - 40, H - 40, PAL.dark, 20);
      // zone dénudée (cuivre)
      disc(g, zone.x, zone.y, ZONE_R, '#c97b3a', 5);
      g.setLineDash([10, 10]);
      g.lineWidth = 4;
      g.strokeStyle = PAL.yellow;
      g.beginPath();
      g.arc(zone.x, zone.y, ZONE_R - 12, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // câbles : de la bordure vers le bout (courbes simples en 3 segments)
      const cols = [PAL.red, PAL.blue];
      ends.forEach((e, i) => {
        const x0 = i ? W - 30 : 30;
        const y0 = e.home[1];
        const mx = (x0 + e.x) / 2;
        line(g, [[x0, y0], [mx, y0], [mx, e.y], [e.x, e.y]], cols[i], 12);
        disc(g, e.x, e.y, 13, '#e8c9a0', 4); // bout dénudé
        if (held === i) disc(g, e.x, e.y, 19, 'rgba(255,255,255,0.25)', 3);
      });
      // jauge + étincelles
      const p = clamp(hold / HOTWIRE_HOLD_MS, 0, 1);
      box(g, 120, H - 62, W - 240, 26, '#fff', 13);
      if (p > 0) box(g, 124, H - 58, Math.max(18, (W - 248) * p), 18, p > 0.99 ? PAL.green : PAL.orange, 9, 0.01);
      if (wasTouching) {
        const mx = (ends[0].x + ends[1].x) / 2;
        const my = (ends[0].y + ends[1].y) / 2;
        burst(g, mx, my, 34 + Math.sin(flash * 9) * 9, PAL.yellow, 8, flash * 3);
        burst(g, mx, my, 18, '#fff', 6, -flash * 4);
      }
      g.lineWidth = 1;
      g.strokeStyle = INK;
    },
  };
};
