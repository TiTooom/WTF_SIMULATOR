// PROPRIÉTAIRE : game-minigames
// Sons des mini-jeux : synthèse Web Audio via registerSound (aucun fichier). Joués sans position (interface), donc à plein volume.
import { SOUNDS, registerSound, type GameAudio } from '../audio';

const NOTE = (n: number) => 261.63 * 2 ** (n / 12);

registerSound('mg_open', (a) => { a.tone(300, 600, 0.09, 0.18, 'square'); a.tone(600, 900, 0.1, 0.14, 'square', 0.08); });
registerSound('mg_push', (a) => { a.tone(200, 90, 0.09, 0.3, 'triangle'); a.burst(0.05, 0.2, 1500, 'bandpass'); });
registerSound('mg_tick', (a, o) => { const f = 700 + (o.size ?? 0) * 60; a.tone(f, f * 0.8, 0.04, 0.16, 'square'); });
registerSound('mg_crack', (a) => { a.burst(0.18, 0.4, 3000, 'highpass'); a.tone(180, 60, 0.2, 0.3, 'sawtooth'); });
registerSound('mg_spark', (a) => { a.burst(0.12, 0.25, 6000, 'highpass'); a.tone(1800, 600, 0.1, 0.12, 'sawtooth'); });
registerSound('mg_buzz', (a) => { a.tone(110, 110, 0.18, 0.1, 'sawtooth'); });
registerSound('mg_lock', (a) => { a.tone(880, 880, 0.08, 0.2, 'square'); a.tone(1320, 1320, 0.14, 0.18, 'square', 0.07); });
registerSound('mg_hit', (a) => { a.burst(0.07, 0.3, 900, 'bandpass'); a.tone(420, 180, 0.07, 0.2, 'triangle'); });
registerSound('mg_ok', (a) => { [0, 4, 7, 12].forEach((n, i) => a.tone(NOTE(n), NOTE(n), i === 3 ? 0.3 : 0.1, 0.18, 'square', i * 0.07)); });
registerSound('mg_fail', (a) => { a.tone(300, 80, 0.45, 0.28, 'sawtooth'); a.tone(220, 55, 0.5, 0.2, 'square', 0.12); a.burst(0.2, 0.15, 800); });

/** Joue un son de mini-jeu. Silencieux (sans erreur) si l'audio n'est pas prêt. */
export function sfx(audio: GameAudio | undefined, name: string, size = 0): void {
  if (!audio) return;
  audio.played[name] = (audio.played[name] ?? 0) + 1;
  if (!audio.ready) return;
  const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : undefined;
  try { fn?.(audio, { size }); } catch { /* le son ne doit jamais casser le jeu */ }
}
