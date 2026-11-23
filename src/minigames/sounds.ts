// PROPRIÉTAIRE : game-minigames
// Sons des mini-jeux : synthèse Web Audio via registerSound (aucun fichier). Joués sans position (interface), donc à plein volume.
// Chaque jeu a sa signature sonore : cliquet + couinement (tournevis), grésillement (court-circuit), bips montants (digicode),
// glouglou + « ding » (dosage), balayage + tintement (fouille), coups sourds + éclat de verre (brise-glace), tic-tac + cisaille (désamorçage),
// froissement + pièce + tampon (liasses). Communs : ouverture, réussite, échec.
import { SOUNDS, registerSound, type GameAudio } from '../audio';

const NOTE = (n: number) => 261.63 * 2 ** (n / 12);

// ----- communs -----
registerSound('mg_open', (a) => { a.tone(300, 600, 0.09, 0.18, 'square'); a.tone(600, 900, 0.1, 0.14, 'square', 0.08); });
registerSound('mg_ok', (a) => { [0, 4, 7, 12].forEach((n, i) => a.tone(NOTE(n), NOTE(n), i === 3 ? 0.3 : 0.1, 0.18, 'square', i * 0.07)); });
registerSound('mg_fail', (a) => { a.tone(300, 80, 0.45, 0.28, 'sawtooth'); a.tone(220, 55, 0.5, 0.2, 'square', 0.12); a.burst(0.2, 0.15, 800); });

// ----- tournevis : poussée métallique, cliquet, couinement de canard, verrou qui cède -----
registerSound('mg_push', (a) => { a.tone(200, 90, 0.09, 0.3, 'triangle'); a.burst(0.05, 0.2, 1500, 'bandpass'); });
registerSound('mg_ratchet', (a, o) => { const k = o.size ?? 0; a.burst(0.03, 0.3, 2600 + k * 160, 'bandpass'); a.tone(320 + k * 35, 230, 0.03, 0.18, 'square'); });
registerSound('mg_squeak', (a) => { a.tone(1500, 2300, 0.07, 0.2, 'sine'); a.tone(2300, 1700, 0.09, 0.16, 'sine', 0.07); });
registerSound('mg_crack', (a) => { a.burst(0.18, 0.4, 3000, 'highpass'); a.tone(180, 60, 0.2, 0.3, 'sawtooth'); });

// ----- court-circuit : contact, grésillement -----
registerSound('mg_spark', (a) => { a.burst(0.12, 0.25, 6000, 'highpass'); a.tone(1800, 600, 0.1, 0.12, 'sawtooth'); });
registerSound('mg_zap', (a, o) => { const k = o.size ?? 0; a.burst(0.07, 0.22, 4500 + (k % 3) * 900, 'highpass'); a.tone(95 + (k % 2) * 22, 80, 0.08, 0.16, 'sawtooth'); });
registerSound('mg_start_engine', (a) => { for (let i = 0; i < 4; i++) a.tone(75 + i * 8, 55 + i * 8, 0.09, 0.3, 'sawtooth', i * 0.08); a.tone(110, 220, 0.3, 0.18, 'sawtooth', 0.34); });

// ----- digicode : bips montants, buzzer -----
registerSound('mg_beep', (a, o) => { const n = [0, 4, 9][Math.min(2, Math.floor(o.size ?? 0))]; a.tone(NOTE(n + 12), NOTE(n + 12), 0.14, 0.2, 'sine'); a.tone(NOTE(n + 24), NOTE(n + 24), 0.1, 0.07, 'sine'); });
registerSound('mg_buzz', (a) => { a.tone(110, 110, 0.18, 0.1, 'sawtooth'); a.tone(104, 104, 0.18, 0.08, 'square'); });

// ----- dosage : glouglou, « ding », éclaboussure -----
registerSound('mg_glug', (a, o) => { const k = o.size ?? 0; a.tone(210 + k * 38, 120 + k * 22, 0.07, 0.22, 'sine'); a.burst(0.04, 0.06, 900, 'bandpass'); });
registerSound('mg_ding', (a) => { a.tone(1568, 1568, 0.22, 0.2, 'triangle'); a.tone(2093, 2093, 0.3, 0.12, 'sine', 0.05); });
registerSound('mg_splash', (a) => { a.burst(0.3, 0.35, 1400, 'lowpass', 300); a.tone(380, 90, 0.25, 0.22, 'sine'); });

// ----- fouille : balayage, tintement du butin, rat -----
registerSound('mg_swoosh', (a, o) => { a.burst(0.13, 0.3, 700 + (o.size ?? 0) * 120, 'bandpass', 2600); });
registerSound('mg_clink', (a) => { a.tone(2400, 2400, 0.16, 0.2, 'triangle'); a.tone(3600, 3600, 0.2, 0.1, 'sine', 0.04); a.tone(1800, 1800, 0.25, 0.1, 'triangle', 0.1); });

// ----- brise-glace : coups sourds de plus en plus aigus, éclat de verre -----
registerSound('mg_hit', (a, o) => { const k = o.size ?? 0; a.burst(0.07, 0.32, 900 + k * 120, 'bandpass'); a.tone(300 + k * 45, 130, 0.08, 0.22, 'triangle'); });
registerSound('mg_shatter', (a) => { a.burst(0.5, 0.45, 5200, 'highpass'); for (let i = 0; i < 6; i++) a.tone(2400 + i * 520, 1800 + i * 300, 0.12, 0.08, 'triangle', i * 0.035); a.tone(150, 50, 0.25, 0.3, 'sawtooth'); });

// ----- désamorçage : tic-tac de bombe, cisaille, boum -----
registerSound('mg_bomb', (a, o) => { a.tone(1100 + (o.size ?? 0) * 90, 1100 + (o.size ?? 0) * 90, 0.05, 0.16, 'square'); });
registerSound('mg_snip', (a) => { a.burst(0.04, 0.4, 4500, 'highpass'); a.tone(2600, 1300, 0.06, 0.2, 'sawtooth'); a.burst(0.04, 0.3, 4000, 'highpass', undefined, 0.07); });
registerSound('mg_boom', (a) => { a.burst(0.5, 0.5, 900, 'lowpass', 120); a.tone(120, 35, 0.45, 0.45, 'sine'); a.tone(70, 30, 0.4, 0.3, 'triangle', 0.03); });

// ----- liasses : froissement, pièce qui tombe, tampon -----
registerSound('mg_rustle', (a) => { a.burst(0.09, 0.22, 3400, 'highpass'); a.burst(0.07, 0.18, 2600, 'bandpass', undefined, 0.07); });
registerSound('mg_coin', (a, o) => { const f = 1100 + (o.size ?? 0) * 110; a.tone(f, f, 0.06, 0.18, 'square'); a.tone(f * 1.5, f * 1.5, 0.22, 0.16, 'triangle', 0.06); });
registerSound('mg_stamp', (a) => { a.tone(130, 45, 0.18, 0.4, 'sine'); a.burst(0.08, 0.3, 700, 'lowpass'); a.tone(1760, 1760, 0.12, 0.1, 'triangle', 0.1); });
registerSound('mg_flutter', (a) => { for (let i = 0; i < 5; i++) a.burst(0.07, 0.2, 3000 - i * 250, 'highpass', undefined, i * 0.06); });

// ----- génériques conservés (autres systèmes) -----
registerSound('mg_tick', (a, o) => { const f = 700 + (o.size ?? 0) * 60; a.tone(f, f * 0.8, 0.04, 0.16, 'square'); });
registerSound('mg_lock', (a) => { a.tone(880, 880, 0.08, 0.2, 'square'); a.tone(1320, 1320, 0.14, 0.18, 'square', 0.07); });

/** Joue un son de mini-jeu. Silencieux (sans erreur) si l'audio n'est pas prêt. */
export function sfx(audio: GameAudio | undefined, name: string, size = 0): void {
  if (!audio) return;
  audio.played[name] = (audio.played[name] ?? 0) + 1;
  if (!audio.ready) return;
  const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : undefined;
  try { fn?.(audio, { size }); } catch { /* le son ne doit jamais casser le jeu */ }
}
