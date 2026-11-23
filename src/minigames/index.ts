// PROPRIÉTAIRE : game-minigames
// Client des mini-jeux : une superposition (canvas, aucun texte) par session annoncée par le serveur (`mg_start`). Le client anime ; le serveur
// valide le résultat (shared/minigames/rules.ts). Entrées : souris (curseur virtuel via movementX/Y, la souris est capturée par pointer lock)
// et clavier. Échap (ou perte du pointer lock) annule. Durée < 4,5 s, retour visuel et sonore immédiats.
import type { GameAudio } from '../audio';
import type { MinigameKind } from '../../shared/ids';
import { RULES } from '../../shared/minigames/rules';
import type { MinigameResult, MinigameStart } from '../../shared/protocol';
import { createBriseGlace } from './brise_glace';
import { createCourtCircuit } from './court_circuit';
import { createDesamorcage } from './desamorcage';
import { createDigicode } from './digicode';
import { createDosage } from './dosage';
import { createFouille } from './fouille';
import { H, INK, PAL, W, burst, clamp, drawCursor, type MgEnv, type MgFactory, type MgGame } from './kit';
import { createLiasses } from './liasses';
import { sfx } from './sounds';
import { createTournevis } from './tournevis';

export interface Minigames {
  /** Démarre la session annoncée par le serveur (événement `mg_start`). Une session déjà ouverte est annulée. */
  start(s: MinigameStart): void;
  /** Le serveur a clos la session (`mg_end`) ou le joueur est loin : ferme l'interface sans renvoyer de résultat. */
  end(sid: number): void;
  /** Annulation par le joueur (Échap) : envoie un échec au serveur et ferme. */
  cancel(): void;
  /** Vrai tant que la superposition est ouverte (le jeu doit alors ignorer les entrées de déplacement et de tir). */
  active(): boolean;
}

export interface MinigamesOpts {
  send: (r: MinigameResult) => void;
  /** Sortie sonore ; par défaut `window.__wtf.audio`. */
  audio?: GameAudio;
}

export const GAMES: Record<MinigameKind, MgFactory> = {
  tournevis: createTournevis,
  court_circuit: createCourtCircuit,
  digicode: createDigicode,
  dosage: createDosage,
  fouille: createFouille,
  brise_glace: createBriseGlace,
  desamorcage: createDesamorcage,
  liasses: createLiasses,
};

const OUTRO_MS = 550;
const ENTER_GRACE_MS = 60; // délai ajouté à minMs avant d'envoyer une réussite trop rapide

interface Session {
  start: MinigameStart;
  game: MgGame;
  env: MgEnv;
  t0: number;
  sent: boolean;
  pending: { ok: boolean; data?: number[]; at: number } | null;
  outroAt: number;
  outroOk: boolean;
}

/** Fond BD : aplat jaune + trame de points, calculé une fois. */
function halftone(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = PAL.yellow;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f2b705';
  for (let y = 0; y < H + 20; y += 20)
    for (let x = ((y / 20) % 2) * 10; x < W + 20; x += 20) {
      g.beginPath();
      g.arc(x, y, 4.5 - (y / H) * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  return c;
}

export function createMinigames(opts: MinigamesOpts): Minigames {
  let cur: Session | null = null;
  let overlay: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let g: CanvasRenderingContext2D | null = null;
  let bg: HTMLCanvasElement | null = null;
  let raf = 0;
  let last = 0;
  let scale = 1;
  let res = 1; // résolution interne du canvas (netteté sur écran dense)

  const audio = () => opts.audio ?? (window as unknown as { __wtf?: { audio?: GameAudio } }).__wtf?.audio;
  const now = () => performance.now();

  const fit = () => {
    if (!canvas) return;
    scale = Math.min((innerWidth * 0.84) / W, (innerHeight * 0.84) / H, 1.7);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    res = clamp(scale * (window.devicePixelRatio || 1), 1, 2.5);
    if (canvas.width !== Math.round(W * res)) { canvas.width = Math.round(W * res); canvas.height = Math.round(H * res); }
  };

  /** Envoie le résultat (une seule fois) et lance la petite animation de sortie. */
  const commit = (s: Session, ok: boolean, data?: number[]) => {
    if (s.sent) return;
    s.sent = true;
    s.pending = null;
    const ms = Math.max(0, Math.round(now() - s.t0));
    const r: MinigameResult = { sid: s.start.sid, ok, ms };
    if (data) r.data = data.slice(0, 16);
    try { opts.send(r); } catch { /* le réseau ne doit pas figer l'interface */ }
    s.outroAt = now() + OUTRO_MS;
    s.outroOk = ok;
    sfx(audio(), ok ? 'mg_ok' : 'mg_fail');
  };

  const close = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('contextmenu', onMenu, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', fit);
    document.removeEventListener('pointerlockchange', onLock);
    overlay?.remove();
    delete (window as unknown as { __mg?: unknown }).__mg;
    overlay = canvas = null;
    g = null;
    cur = null;
  };

  const cancel = () => {
    const s = cur;
    if (!s) return;
    if (!s.sent) commit(s, false);
    close();
  };

  const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };

  function onMove(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    const c = s.env.cursor;
    c.x = clamp(c.x + e.movementX / scale, 0, W);
    c.y = clamp(c.y + e.movementY / scale, 0, H);
    if (!s.sent) s.game.onMove?.(c.x, c.y);
  }
  function onDown(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    if (s.sent) return;
    if (e.button === 0) s.env.down = true;
    s.game.onDown?.(e.button);
  }
  function onUp(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    if (e.button === 0) s.env.down = false;
    if (!s.sent) s.game.onUp?.(e.button);
  }
  function onMenu(e: Event) { swallow(e); }
  function onKey(e: KeyboardEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    if (e.code === 'Escape') { cancel(); return; }
    if (!e.repeat && !s.sent) s.game.onKey?.(e.code);
  }
  function onLock() {
    // Perdre le pointer lock (Échap sous Chromium) = annuler : la pause du jeu prend ensuite le relais.
    if (cur && !document.pointerLockElement) cancel();
  }

  const frame = () => {
    const s = cur;
    if (!s || !g || !canvas) return;
    raf = requestAnimationFrame(frame);
    const tNow = now();
    const dt = clamp((tNow - last) / 1000, 0, 0.25);
    last = tNow;
    const t = tNow - s.t0;

    if (!s.sent) {
      try { s.game.update(dt, t); } catch { cancel(); return; }
      if (s.pending && tNow >= s.pending.at) commit(s, s.pending.ok, s.pending.data);
      else if (!s.pending && t >= s.start.maxMs) commit(s, false);
    } else if (tNow >= s.outroAt) {
      close();
      return;
    }

    // Rendu
    g.save();
    g.setTransform(res, 0, 0, res, 0, 0);
    g.clearRect(0, 0, W, H);
    if (bg) g.drawImage(bg, 0, 0);
    try { s.game.draw(g, t); } catch { /* un dessin raté ne doit pas bloquer */ }
    // Barre de temps (haut) : se vide jusqu'à la durée maximale
    if (!s.sent) {
      const left = clamp(1 - t / s.start.maxMs, 0, 1);
      g.fillStyle = INK;
      g.fillRect(0, 0, W, 14);
      g.fillStyle = left < 0.25 ? PAL.red : PAL.green;
      g.fillRect(3, 3, (W - 6) * left, 8);
    }
    // Bords de case de BD
    g.lineWidth = 10;
    g.strokeStyle = INK;
    g.strokeRect(0, 0, W, H);
    // Sortie : éclat vert ou rouge
    if (s.sent) {
      const k = clamp(1 - (s.outroAt - tNow) / OUTRO_MS, 0, 1);
      g.globalAlpha = 0.55 * (1 - k);
      g.fillStyle = s.outroOk ? PAL.green : PAL.red;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      burst(g, W / 2, H / 2, 40 + k * 190, s.outroOk ? PAL.green : PAL.red, 10, k * 2);
    }
    drawCursor(g, s.env.cursor.x, s.env.cursor.y, s.env.down);
    g.restore();
  };

  return {
    start(st) {
      if (cur) cancel();
      const factory = Object.prototype.hasOwnProperty.call(GAMES, st.kind) ? GAMES[st.kind] : undefined;
      if (!factory || typeof document === 'undefined') {
        opts.send({ sid: st.sid, ok: false, ms: 0 });
        return;
      }
      const rule = RULES[st.kind];
      const t0 = now();
      const env: MgEnv = {
        start: st,
        cursor: { x: W / 2, y: H / 2 },
        down: false,
        now: () => now() - t0,
        sfx: (name, size = 0) => sfx(audio(), name, size),
        finish: (ok, data) => {
          const s = cur;
          if (!s || s.sent || s.pending) return;
          const t = now() - t0;
          // Une réussite plus rapide que la durée minimale plausible serait refusée par le serveur : on laisse la fin de l'animation courir.
          if (ok && t < rule.minMs + ENTER_GRACE_MS) s.pending = { ok, data, at: t0 + rule.minMs + ENTER_GRACE_MS };
          else commit(s, ok, data);
        },
      };
      const game = factory(env);
      cur = { start: st, game, env, t0, sent: false, pending: null, outroAt: 0, outroOk: false };

      overlay = document.createElement('div');
      overlay.id = 'mg-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,10,20,0.55);cursor:none;user-select:none';
      canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      canvas.style.cssText = 'border:6px solid #111;border-radius:6px;box-shadow:10px 10px 0 #111;background:#ffd23f';
      overlay.appendChild(canvas);
      document.body.appendChild(overlay);
      g = canvas.getContext('2d');
      bg = halftone();
      fit();
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('contextmenu', onMenu, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', fit);
      document.addEventListener('pointerlockchange', onLock);
      // Sonde pour les tests de bout en bout (tests/minijeux-reel.ts) : lecture seule
      Object.assign(window, { __mg: { kind: st.kind, sid: st.sid, cursor: env.cursor, scale: () => scale, now: env.now, probe: () => game.probe?.() ?? {}, sent: () => cur?.sent ?? true } });
      sfx(audio(), 'mg_open');
      last = now();
      raf = requestAnimationFrame(frame);
    },
    end(sid) {
      if (cur && cur.start.sid === sid && !cur.sent) close(); // déjà envoyé : l'animation de sortie se ferme seule
    },
    cancel,
    active: () => cur !== null,
  };
}
