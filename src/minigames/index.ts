// PROPRIÉTAIRE : game-minigames
// Client des mini-jeux : une superposition (canvas) par session annoncée par le serveur (`mg_start`). Trois temps : CONSIGNE (panneau + démonstration
// animée, le jeu ne démarre qu'au clic / à une touche), PARTIE (temps illimité, ligne d'aide permanente en bas, indice si le joueur bloque), SORTIE.
// Le client anime ; le serveur valide le résultat (shared/minigames/rules.ts). Entrées : souris (curseur virtuel via movementX/Y, la souris est capturée
// par pointer lock) et clavier. Abandon à tout moment : bouton « Abandonner (Échap) » ou Échap (ou perte du pointer lock) -> ok:false + ABANDON_MARK,
// sans punition. Aucune limite de durée ; `ms` est mesuré depuis le début de la partie (après la consigne) et plafonné à MS_CAP (protocole).
import type { GameAudio } from '../audio';
import type { MinigameKind } from '../../shared/ids';
import { ABANDON_MARK, MS_CAP, RULES } from '../../shared/minigames/rules';
import type { MinigameResult, MinigameStart } from '../../shared/protocol';
import { createBriseGlace } from './brise_glace';
import { createCourtCircuit } from './court_circuit';
import { createDesamorcage } from './desamorcage';
import { createDigicode } from './digicode';
import { createDosage } from './dosage';
import { createFouille } from './fouille';
import { dejaVu, drawDemo, helpFor, marquerVu, type HelpText } from './help';
import { H, INK, PAL, W, box, burst, clamp, drawCursor, type MgEnv, type MgFactory, type MgGame } from './kit';
import { createLiasses } from './liasses';
import { sfx } from './sounds';
import { createTournevis } from './tournevis';

export interface Minigames {
  /** Démarre la session annoncée par le serveur (événement `mg_start`). Une session déjà ouverte est annulée. */
  start(s: MinigameStart): void;
  /** Le serveur a clos la session (`mg_end`) ou le joueur est loin : ferme l'interface sans renvoyer de résultat. */
  end(sid: number): void;
  /** Abandon par le joueur (Échap ou bouton) : envoie ok:false + ABANDON_MARK au serveur (aucune punition) et ferme. */
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
const STRIP = 52; // bandeau du bas : ligne d'aide + bouton d'abandon (hors de la zone de jeu W x H)
const CH = H + STRIP;
const INTRO_LOCK_MS = 450; // un clic / une touche encore en cours à l'ouverture ne démarre pas la partie par erreur
const HINT_MS = 7000; // sans progrès pendant ce délai : l'indice s'affiche
const ABANDON = { x: W - 188, y: H + 9, w: 176, h: 34 };
const BANNER_MS = 1300;
const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

interface Session {
  start: MinigameStart;
  game: MgGame | null;
  env: MgEnv;
  phase: 'intro' | 'play';
  openAt: number;
  playT0: number;
  lastProgress: number;
  help: HelpText;
  first: boolean; // première fois : consigne complète
  sent: boolean;
  pending: { ok: boolean; data?: number[]; at: number } | null;
  outroAt: number;
  outroOk: boolean;
  banner: { text: string; good: boolean; until: number } | null;
  hintShown: boolean;
  wrapCache: Map<string, string[]>;
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

/** Retour à la ligne selon la largeur mesurée ; le résultat est mis en cache par police + largeur. */
function wrap(s: Session, g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const key = `${g.font}|${maxW}|${text}`;
  const hit = s.wrapCache.get(key);
  if (hit) return hit;
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  s.wrapCache.set(key, out);
  return out;
}

/** Texte cerné de noir (lisible sur tous les fonds). */
function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill = '#fff', lw = 6) {
  g.lineJoin = 'round';
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function pastille(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.stroke();
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
  let synth = false; // Échap synthétique en cours d'envoi (voir abandon)
  let factoryOf: MgFactory | null = null;

  const audio = () => opts.audio ?? (window as unknown as { __wtf?: { audio?: GameAudio } }).__wtf?.audio;
  const now = () => performance.now();
  const hintMs = () => { const v = (window as unknown as { __mgHintMs?: number }).__mgHintMs; return typeof v === 'number' ? v : HINT_MS; };

  const fit = () => {
    if (!canvas) return;
    scale = Math.min((innerWidth * 0.84) / W, (innerHeight * 0.88) / CH, 1.7);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${CH * scale}px`;
    res = clamp(scale * (window.devicePixelRatio || 1), 1, 2.5);
    if (canvas.width !== Math.round(W * res)) { canvas.width = Math.round(W * res); canvas.height = Math.round(CH * res); }
  };

  const playMs = (s: Session) => Math.min(MS_CAP, Math.max(0, Math.round(now() - s.playT0)));

  /** Envoie le résultat d'une partie jouée (une seule fois) et lance la petite animation de sortie. */
  const commit = (s: Session, ok: boolean, data?: number[]) => {
    if (s.sent) return;
    s.sent = true;
    s.pending = null;
    const r: MinigameResult = { sid: s.start.sid, ok, ms: playMs(s) };
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

  /** Abandon volontaire : le serveur le reconnaît (data = [ABANDON_MARK]) et ne punit pas. Le joueur reprend la main immédiatement. */
  const abandon = (fromLock = false) => {
    const s = cur;
    if (!s) return;
    if (!s.sent) {
      s.sent = true;
      try { opts.send({ sid: s.start.sid, ok: false, ms: s.phase === 'play' ? playMs(s) : 0, data: [ABANDON_MARK] }); } catch { /* ignoré */ }
    }
    if (fromLock) {
      // Sous Chromium, Échap sort du pointer lock SANS livrer de keydown : on en simule un pour que main.ts n'ouvre pas la pause (quietUntil).
      synth = true;
      try { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })); } catch { /* ignoré */ }
      synth = false;
    }
    close();
  };

  const swallow = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };

  const inAbandon = (s: Session) => s.env.cursor.x >= ABANDON.x && s.env.cursor.x <= ABANDON.x + ABANDON.w && s.env.cursor.y >= ABANDON.y && s.env.cursor.y <= ABANDON.y + ABANDON.h;

  /** Fin de la consigne : la partie démarre (horloge du jeu à zéro). */
  const begin = (s: Session, factory: MgFactory) => {
    if (s.phase !== 'intro') return;
    s.phase = 'play';
    s.playT0 = now();
    s.lastProgress = s.playT0;
    marquerVu(s.start.kind);
    s.game = factory(s.env);
    sfx(audio(), 'mg_push');
  };

  function onMove(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    const c = s.env.cursor;
    c.x = clamp(c.x + e.movementX / scale, 0, W);
    c.y = clamp(c.y + e.movementY / scale, 0, CH);
    if (s.phase === 'play' && !s.sent) s.game?.onMove?.(c.x, c.y);
  }
  function onDown(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    if (e.button === 0 && inAbandon(s)) { abandon(); return; }
    if (s.phase === 'intro') { if (e.button === 0 && now() - s.openAt > INTRO_LOCK_MS && factoryOf) begin(s, factoryOf); return; }
    if (s.sent) return;
    if (e.button === 0) s.env.down = true;
    s.game?.onDown?.(e.button);
  }
  function onUp(e: MouseEvent) {
    const s = cur;
    if (!s) return;
    swallow(e);
    if (e.button === 0) s.env.down = false;
    if (s.phase === 'play' && !s.sent) s.game?.onUp?.(e.button);
  }
  function onMenu(e: Event) { swallow(e); }
  function onKey(e: KeyboardEvent) {
    if (synth) return;
    const s = cur;
    if (!s) return;
    swallow(e);
    if (e.code === 'Escape') { abandon(); return; }
    if (s.phase === 'intro') {
      if (!e.repeat && now() - s.openAt > INTRO_LOCK_MS && factoryOf && !/^(Shift|Control|Alt|Meta)/.test(e.code)) begin(s, factoryOf);
      return;
    }
    if (!e.repeat && !s.sent) s.game?.onKey?.(e.code);
  }
  function onLock() {
    // Perdre le pointer lock (Échap sous Chromium) = abandon : sans punition, et sans ouvrir la pause du jeu.
    if (cur && !document.pointerLockElement) abandon(true);
  }

  // ---------- rendu ----------
  const drawIntro = (s: Session, g2: CanvasRenderingContext2D, t: number) => {
    const first = s.first;
    box(g2, 20, 14, 600, 54, PAL.dark, 12);
    g2.textAlign = 'left';
    g2.textBaseline = 'alphabetic';
    g2.font = `bold 30px ${FONT}`;
    outlined(g2, s.help.title, 40, 52, PAL.yellow, 5);
    g2.font = `bold 14px ${FONT}`;
    g2.textAlign = 'right';
    g2.fillStyle = '#fff';
    g2.fillText(first ? 'CONSIGNE' : 'RAPPEL', 600, 46);
    g2.textAlign = 'left';
    // panneau de texte
    box(g2, 20, 80, 376, 244, PAL.paper, 14);
    if (first) {
      let y = 106;
      s.help.steps.forEach((step, i) => {
        g2.font = `bold 16px ${FONT}`;
        const lines = wrap(s, g2, step, 318);
        pastille(g2, 48, y - 5, 13, PAL.red);
        g2.fillStyle = '#fff';
        g2.font = `bold 15px ${FONT}`;
        g2.textAlign = 'center';
        g2.fillText(String(i + 1), 48, y);
        g2.textAlign = 'left';
        g2.font = `bold 16px ${FONT}`;
        g2.fillStyle = INK;
        lines.forEach((l, k) => g2.fillText(l, 72, y + k * 20));
        y += lines.length * 20 + 12;
      });
    } else {
      g2.font = `bold 22px ${FONT}`;
      g2.fillStyle = INK;
      const lines = wrap(s, g2, s.help.short, 340);
      lines.forEach((l, k) => g2.fillText(l, 38, 120 + k * 29));
      g2.font = `bold 14px ${FONT}`;
      g2.fillStyle = '#6b5a2a';
      g2.fillText('Tu as déjà vu cette consigne.', 38, 304);
    }
    drawDemo(g2, s.start.kind, t, 410, 80, 210, 244);
    // bouton de départ
    const k = 1 + Math.sin(t / 220) * 0.025;
    g2.save();
    g2.translate(W / 2, 362);
    g2.scale(k, k);
    box(g2, -170, -25, 340, 50, PAL.green, 16, 6);
    g2.font = `bold 25px ${FONT}`;
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    outlined(g2, "Compris, c'est parti !", 0, 1, '#fff', 6);
    g2.restore();
    g2.textBaseline = 'alphabetic';
    g2.textAlign = 'left';
  };

  const drawBanner = (s: Session, g2: CanvasRenderingContext2D, tNow: number) => {
    const b = s.banner;
    if (!b || tNow > b.until) { s.banner = null; return; }
    const k = clamp(1 - (b.until - tNow) / BANNER_MS, 0, 1);
    const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.3 : 1;
    g2.save();
    g2.font = `bold 30px ${FONT}`;
    const w = Math.min(W - 40, g2.measureText(b.text).width + 60);
    g2.translate(W / 2, 62);
    g2.scale(pop, pop);
    g2.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
    box(g2, -w / 2, -30, w, 60, b.good ? PAL.green : PAL.red, 14, 6);
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    outlined(g2, b.text, 0, 2, '#fff', 6);
    g2.restore();
  };

  const drawHint = (s: Session, g2: CanvasRenderingContext2D, t: number) => {
    if (!s.game?.hint || s.banner) { s.hintShown = false; return; }
    if (now() - s.lastProgress < hintMs()) { s.hintShown = false; return; }
    const h = s.game.hint();
    s.hintShown = !!h;
    if (!h) return;
    // anneau pulsant autour de la zone à utiliser
    g2.save();
    g2.setLineDash([12, 9]);
    g2.lineDashOffset = -t / 40;
    g2.lineWidth = 7;
    g2.strokeStyle = INK;
    const rr = h.r + Math.sin(t / 160) * 5;
    g2.beginPath();
    g2.arc(h.x, h.y, rr, 0, Math.PI * 2);
    g2.stroke();
    g2.lineWidth = 3.5;
    g2.strokeStyle = '#fff';
    g2.stroke();
    g2.setLineDash([]);
    g2.restore();
    g2.font = `bold 19px ${FONT}`;
    const lines = wrap(s, g2, h.text, W - 90);
    const bh = 14 + lines.length * 24;
    box(g2, 30, 14, W - 60, bh, PAL.paper, 12, 5);
    g2.fillStyle = INK;
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    lines.forEach((l, k) => g2.fillText(l, W / 2, 14 + 7 + 12 + k * 24));
    g2.textAlign = 'left';
    g2.textBaseline = 'alphabetic';
  };

  const drawStrip = (s: Session, g2: CanvasRenderingContext2D) => {
    g2.fillStyle = PAL.dark;
    g2.fillRect(0, H, W, STRIP);
    g2.fillStyle = INK;
    g2.fillRect(0, H, W, 4);
    const txt = s.phase === 'intro' ? 'Lis la consigne, puis clique ou appuie sur une touche pour commencer.' : s.help.short;
    let size = 15;
    let lines: string[] = [];
    for (; size >= 12; size--) {
      g2.font = `bold ${size}px ${FONT}`;
      lines = wrap(s, g2, txt, ABANDON.x - 28);
      if (lines.length <= 2) break;
    }
    g2.fillStyle = '#fff';
    g2.textAlign = 'left';
    g2.textBaseline = 'middle';
    const lh = size + 3;
    const n = Math.min(lines.length, 2);
    lines.slice(0, 2).forEach((l, k) => g2.fillText(l, 14, H + 4 + (STRIP - 4) / 2 + (k - (n - 1) / 2) * lh));
    // bouton d'abandon
    const hot = inAbandon(s);
    box(g2, ABANDON.x, ABANDON.y, ABANDON.w, ABANDON.h, hot ? PAL.red : '#6b2530', 10, 4);
    g2.font = `bold 16px ${FONT}`;
    g2.textAlign = 'center';
    g2.fillStyle = '#fff';
    g2.fillText('Abandonner (Échap)', ABANDON.x + ABANDON.w / 2, ABANDON.y + ABANDON.h / 2 + 1);
    g2.textAlign = 'left';
    g2.textBaseline = 'alphabetic';
  };

  const frame = () => {
    const s = cur;
    if (!s || !g || !canvas) return;
    raf = requestAnimationFrame(frame);
    const tNow = now();
    const dt = clamp((tNow - last) / 1000, 0, 0.25);
    last = tNow;
    const t = s.phase === 'play' ? tNow - s.playT0 : tNow - s.openAt;

    if (s.phase === 'play' && !s.sent) {
      try { s.game?.update(dt, t); } catch { abandon(); return; }
      if (s.pending && tNow >= s.pending.at) commit(s, s.pending.ok, s.pending.data);
    } else if (s.sent && tNow >= s.outroAt) {
      close();
      return;
    }

    g.save();
    g.setTransform(res, 0, 0, res, 0, 0);
    g.clearRect(0, 0, W, CH);
    if (bg) g.drawImage(bg, 0, 0);
    if (s.phase === 'intro') drawIntro(s, g, t);
    else {
      try { s.game?.draw(g, t); } catch { /* un dessin raté ne doit pas bloquer */ }
      if (!s.sent) { drawHint(s, g, tNow); drawBanner(s, g, tNow); }
    }
    // Bords de case de BD
    g.lineWidth = 10;
    g.strokeStyle = INK;
    g.strokeRect(0, 0, W, H);
    if (s.sent) {
      const k = clamp(1 - (s.outroAt - tNow) / OUTRO_MS, 0, 1);
      g.globalAlpha = 0.55 * (1 - k);
      g.fillStyle = s.outroOk ? PAL.green : PAL.red;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      burst(g, W / 2, H / 2, 40 + k * 190, s.outroOk ? PAL.green : PAL.red, 10, k * 2);
    }
    drawStrip(s, g);
    drawCursor(g, s.env.cursor.x, s.env.cursor.y, s.env.down);
    g.restore();
  };

  return {
    start(st) {
      if (cur) abandon();
      const factory = Object.prototype.hasOwnProperty.call(GAMES, st.kind) ? GAMES[st.kind] : undefined;
      if (!factory || typeof document === 'undefined') {
        opts.send({ sid: st.sid, ok: false, ms: 0, data: [ABANDON_MARK] });
        return;
      }
      const rule = RULES[st.kind];
      const first = !dejaVu(st.kind);
      const env: MgEnv = {
        start: st,
        cursor: { x: W / 2 + 90, y: 372 }, // départ sur le bouton « Compris » : le curseur ne masque pas la consigne
        down: false,
        now: () => (cur && cur.phase === 'play' ? now() - cur.playT0 : 0),
        sfx: (name, size = 0) => sfx(audio(), name, size),
        say: (text, good = false) => { if (cur) cur.banner = { text, good, until: now() + BANNER_MS }; },
        progress: () => { if (cur) cur.lastProgress = now(); },
        finish: (ok, data) => {
          const s = cur;
          if (!s || s.sent || s.pending || s.phase !== 'play') return;
          const t = now() - s.playT0;
          // Une réussite plus rapide que la durée minimale plausible serait refusée par le serveur : on laisse la fin de l'animation courir.
          if (ok && t < rule.minMs + ENTER_GRACE_MS) s.pending = { ok, data, at: s.playT0 + rule.minMs + ENTER_GRACE_MS };
          else commit(s, ok, data);
        },
      };
      factoryOf = factory;
      const t0 = now();
      const sess: Session = {
        start: st, game: null, env, phase: 'intro', openAt: t0, playT0: t0, lastProgress: t0, help: helpFor(st), first,
        sent: false, pending: null, outroAt: 0, outroOk: false, banner: null, hintShown: false, wrapCache: new Map(),
      };
      cur = sess;

      overlay = document.createElement('div');
      overlay.id = 'mg-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,10,20,0.55);cursor:none;user-select:none';
      canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = CH;
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
      Object.assign(window, {
        __mg: {
          kind: st.kind, sid: st.sid, cursor: env.cursor, scale: () => scale, now: env.now,
          phase: () => cur?.phase ?? 'fin', first: () => cur?.first ?? false, help: () => ({ title: sess.help.title, steps: sess.help.steps, short: sess.help.short }),
          hintShown: () => cur?.hintShown ?? false,
          probe: () => cur?.game?.probe?.() ?? {}, sent: () => cur?.sent ?? true,
        },
      });
      sfx(audio(), 'mg_open');
      last = now();
      raf = requestAnimationFrame(frame);
    },
    end(sid) {
      if (cur && cur.start.sid === sid && !cur.sent) close(); // déjà envoyé : l'animation de sortie se ferme seule
    },
    cancel: () => abandon(),
    active: () => cur !== null,
  };
}
