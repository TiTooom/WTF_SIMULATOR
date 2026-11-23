// PROPRIÉTAIRE : game-minigames
// Court-circuit sous le volant : glisser les deux bouts de câble dénudés dans la zone cuivrée et les maintenir en contact 1 s.
// Données envoyées : [ms de contact cumulés]. Règle : shared/minigames/rules.ts (courtCircuitSpec, HOTWIRE_HOLD_MS).
import { HOTWIRE_HOLD_MS, courtCircuitSpec } from '../../shared/minigames/rules';
import { H, INK, PAL, W, box, burst, clamp, disc, googly, line, type MgFactory } from './kit';

const GRAB = 46; // rayon de saisie d'un bout de câble

export const createCourtCircuit: MgFactory = (env) => {
  const spec = courtCircuitSpec(env.start.seed, env.start.difficulty);
  const ZONE_R = spec.zoneR; // zone dénudée
  const CONTACT = spec.contact; // distance de contact entre les deux bouts
  let zapAt = 0;
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
    probe: () => ({ zx: zone.x, zy: zone.y, e0x: ends[0].x, e0y: ends[0].y, e1x: ends[1].x, e1y: ends[1].y, hold }),
    // le bout suit la souris à chaque mouvement (pas à chaque image : robuste aux machines lentes)
    onMove(x, y) {
      if (done || held < 0 || !env.down) return;
      ends[held].x = clamp(x, 30, W - 30);
      ends[held].y = clamp(y, 30, H - 30);
    },
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
        if (Math.floor(hold / 90) !== Math.floor((hold - dt * 1000) / 90)) env.sfx('mg_zap', zapAt++);
      } else {
        hold = Math.max(0, hold - dt * spec.decay); // le contact se perd : la jauge retombe vite (plus vite en difficile)
      }
      wasTouching = touching;
      if (hold >= HOTWIRE_HOLD_MS) {
        done = true;
        env.sfx('mg_start_engine');
        env.finish(true, [Math.round(hold)]);
      }
    },
    draw(g, t) {
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
      // désodorisant « sapin » qui se balance sous le rétroviseur : il écarquille les yeux à chaque étincelle
      {
        g.save();
        g.translate(W - 70, 22);
        g.rotate(Math.sin(t / 300) * 0.15 + (wasTouching ? Math.sin(t / 30) * 0.12 : 0));
        g.lineWidth = 3;
        g.strokeStyle = PAL.paper;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, 22);
        g.stroke();
        g.beginPath();
        g.moveTo(0, 22);
        g.lineTo(-24, 74);
        g.lineTo(24, 74);
        g.closePath();
        g.fillStyle = PAL.green;
        g.fill();
        g.lineWidth = 4;
        g.strokeStyle = INK;
        g.stroke();
        googly(g, -8, 50, 6, env.cursor.x - (W - 70), env.cursor.y - 22, wasTouching);
        googly(g, 8, 50, 6, env.cursor.x - (W - 70), env.cursor.y - 22, wasTouching);
        g.restore();
      }
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
