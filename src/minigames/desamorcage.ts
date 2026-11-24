// PROPRIÉTAIRE : game-minigames
// Désamorçage : un des 4 fils flashe (~1,5 s, sans pression), puis les fils se croisent et se mélangent. Cliquer le fil de la même
// couleur pour le couper. Mauvais fil = boum (BD, sans gravité) puis le flash revient ; Espace = revoir le flash à volonté. Données envoyées : [couleur coupée, 0..3].
// Règle : shared/minigames/rules.ts (desamorcageSpec). Détail drôle : le minuteur a des yeux qui suivent le curseur et suent quand on hésite.
import { WIRE_COLORS, desamorcageSpec, rng } from '../../shared/minigames/rules';
import { HINTS } from './help';
import { H, INK, PAL, W, box, burst, clamp, disc, googly, sweat, type MgFactory } from './kit';

const COLORS = [PAL.red, PAL.blue, PAL.green, PAL.yellow];
const X0 = 120;
const X1 = W - 120;
const Y0 = 120;
const GAP = 56;
const SHUFFLE_MS = 380; // durée du glissement des fils
const PAUSE_MS = 350; // pause entre la fin du flash et le mélange

export const createDesamorcage: MgFactory = (env) => {
  const spec = desamorcageSpec(env.start.seed, env.start.difficulty);
  const r = rng(env.start.seed ^ 0x99);
  const flashMs = Math.round(1600 - 500 * env.start.difficulty); // le client montre le fil plus longtemps que le minimum serveur (spec.flashMs)
  const shuffleAt = flashMs + PAUSE_MS;
  let base = 0; // début de la tentative en cours (horloge du jeu)
  let retryAt = 0;
  let progressed = false;
  const T = () => env.now() - base;
  // ordre d'affichage après mélange (permutation dérivée de la graine, peu importe : seule la couleur compte pour le serveur)
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (order.every((c, i) => c === i)) order.reverse();
  let cutColor = -1;
  let cutAt = 0;
  let done = false;
  let boom = false;
  let lastBeat = -1;
  let ticks = 0;

  /** Avancement du mélange (0 = ordre d'origine, 1 = ordre final) selon l'horloge du jeu. */
  const prog = () => clamp((T() - shuffleAt) / SHUFFLE_MS, 0, 1);
  /** Nouvelle tentative : le fil clignote de nouveau, les fils reprennent leur place. */
  const restart = () => { base = env.now(); cutColor = -1; boom = false; done = false; retryAt = 0; progressed = false; env.progress(); env.sfx('mg_push'); };
  const ease = (k: number) => k * k * (3 - 2 * k);
  /** Position (fractionnaire) du fil de couleur c : glisse de son rang d'origine à son rang final. */
  const slotOf = (c: number) => c + (order.indexOf(c) - c) * ease(prog());
  const yOf = (c: number) => Y0 + 20 + slotOf(c) * GAP;

  return {
    onKey(code) { if (code === 'Space' && !done && prog() >= 1) restart(); },
    hint: () => ({ x: W / 2, y: Y0 + 20 + 1.5 * GAP, r: 150, text: HINTS.desa }),
    onDown(btn) {
      if (btn !== 0 || done) return;
      const t = T();
      if (prog() < 1) { env.sfx('mg_buzz'); env.say('Attends la fin du mélange !'); return; }
      for (let c = 0; c < WIRE_COLORS; c++) {
        if (env.cursor.x > X0 - 20 && env.cursor.x < X1 + 20 && Math.abs(env.cursor.y - yOf(c)) < 24) {
          done = true;
          cutColor = c;
          cutAt = t;
          env.sfx('mg_snip');
          if (c === spec.wire) { env.sfx('mg_spark'); env.finish(true, [c]); } else { boom = true; retryAt = env.now() + 1300; env.sfx('mg_boom'); env.say('Mauvais fil !'); }
          return;
        }
      }
    },
    probe: () => ({ y: yOf(spec.wire), shuffled: prog() >= 1 ? 1 : 0 }),
    update(_dt, t) {
      if (!progressed && prog() >= 1) { progressed = true; env.progress(); }
      if (retryAt && env.now() >= retryAt) restart();
      // tic-tac de bombe, calé sur les voyants du minuteur (un battement tous les 250 ms)
      const beat = Math.floor(t / 250);
      if (!done && beat !== lastBeat) { lastBeat = beat; env.sfx('mg_bomb', (ticks++ % 3) * 2); }
    },
    draw(g, t) {
      box(g, 40, 40, W - 80, H - 80, PAL.dark, 22);
      // minuteur de bombe, avec ses yeux
      box(g, W / 2 - 80, 56, 160, 40, '#111', 8, 4);
      for (let i = 0; i < 3; i++) disc(g, W / 2 - 40 + i * 40, 76, 12, Math.floor(t / 250) % 3 === i ? PAL.red : '#700', 4);
      const T0 = T();
      const scared = boom || (T0 > shuffleAt + SHUFFLE_MS + 1100 && !done);
      googly(g, W / 2 - 118, 76, 14, env.cursor.x, env.cursor.y, scared);
      googly(g, W / 2 + 118, 76, 14, env.cursor.x, env.cursor.y, scared);
      if (scared) sweat(g, W / 2 + 142, 56, 0.9);
      const flashing = T0 < flashMs;
      for (let c = 0; c < WIRE_COLORS; c++) {
        // glissement pendant le mélange : les fils se croisent
        const y = yOf(c);
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
      if (cutColor >= 0 && T0 - cutAt < 600) {
        burst(g, W / 2, yOf(cutColor), 40 + (T0 - cutAt) / 4, boom ? PAL.red : PAL.green, 10, t / 120);
      }
    },
  };
};
