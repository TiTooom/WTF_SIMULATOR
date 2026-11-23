// PROPRIÉTAIRE : game-minigames
// Contrat commun des mini-jeux client + petits outils de dessin « BD » (aplats, gros contours noirs). Aucun texte à l'écran.
import type { MinigameStart } from '../../shared/protocol';

export const W = 640;
export const H = 400;

export interface MgEnv {
  start: MinigameStart;
  /** Curseur virtuel (coordonnées canvas 0..W, 0..H), déplacé par movementX/Y. */
  cursor: { x: number; y: number };
  /** Bouton gauche enfoncé. */
  down: boolean;
  /** Millisecondes depuis le début du jeu. */
  now(): number;
  /** Son de mini-jeu (voir sounds.ts). */
  sfx(name: string, size?: number): void;
  /** Termine le jeu ; `data` est envoyé au serveur (voir shared/minigames/rules.ts pour le format par jeu). */
  finish(ok: boolean, data?: number[]): void;
}

export interface MgGame {
  update(dt: number, t: number): void;
  draw(g: CanvasRenderingContext2D, t: number): void;
  onDown?(btn: number): void;
  onUp?(btn: number): void;
  onKey?(code: string): void;
}

export type MgFactory = (env: MgEnv) => MgGame;

export const INK = '#111';
export const PAL = { yellow: '#ffd23f', red: '#ee4035', blue: '#3a86ff', green: '#2ecc71', paper: '#fff4d6', metal: '#9aa5b1', dark: '#2b2d42', orange: '#ff8c42' };

/** Rectangle arrondi avec aplat + contour noir épais. */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r = 10, lw = 5) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
}

export function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, lw = 5) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
}

/** Étoile d'impact de BD (« BAM »). */
export function burst(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, spikes = 9, rot = 0) {
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = rot + (i * Math.PI) / spikes;
    const rr = i % 2 ? r * 0.55 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
}

export function line(g: CanvasRenderingContext2D, pts: [number, number][], color: string, lw: number) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineWidth = lw + 6;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = lw;
  g.strokeStyle = color;
  g.stroke();
}

/** Main-curseur virtuelle : pointeur BD blanc cerné de noir (plein si `down`). */
export function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, down: boolean) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 22);
  g.lineTo(6, 17);
  g.lineTo(11, 28);
  g.lineTo(16, 26);
  g.lineTo(11, 15);
  g.lineTo(19, 15);
  g.closePath();
  g.fillStyle = down ? PAL.yellow : '#fff';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
