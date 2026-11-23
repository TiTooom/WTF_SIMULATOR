import { makeCarView } from './kit';

/** La voiture de police : noire et blanche, gyrophares rouge/bleu qui clignotent (éteints si `a[0] === 0`). */
export const view = makeCarView({
  type: 'police', name: 'la voiture de police', label: 'Police',
  l: 4.6, w: 1.95,
  cab: { w: 1.7, h: 0.55, l: 2.0, z: 0.2 },
  palette: [0xf4f4f8],
  wheel: { r: 0.37, x: 1.0, front: -1.5, rear: 1.5 },
  beacons: true,
  detail: (b, s) => {
    for (const sx of [-1, 1]) {
      b.box(0.05, 0.3, s.l * 0.62, 0x1b1b2b, sx * (s.w / 2 + 0.01), -0.02, 0.1); // bas de caisse noir
      b.box(0.05, 0.22, 0.5, 0xf2c94c, sx * (s.w / 2 + 0.02), 0.2, -0.3); // écusson
    }
    b.box(0.7, 0.1, 1.0, 0x1b1b2b, 0, 0.33, -1.1); // capot noir
    b.box(1.2, 0.1, 0.45, 0x1b1b2b, 0, 0.33 + 0.55 + 0.15, 0.2); // base du gyrophare
    // Barre lumineuse toujours visible (même gyrophares éteints) : rouge / blanc / bleu
    b.box(0.34, 0.14, 0.4, 0xc02020, -0.42, 0.33 + 0.55 + 0.27, 0.2).box(0.3, 0.14, 0.4, 0xffffff, 0, 0.33 + 0.55 + 0.27, 0.2).box(0.34, 0.14, 0.4, 0x2040c0, 0.42, 0.33 + 0.55 + 0.27, 0.2);
    // Lettrage blanc « POLICE » (blocs) sur les portières noires, et bandeau bleu sur le capot
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) b.box(0.03, 0.1, i % 2 ? 0.16 : 0.1, 0xffffff, sx * (s.w / 2 + 0.05), -0.02, 0.62 + i * 0.24 - 0.35);
    b.box(0.5, 0.02, 0.9, 0x2f80ed, 0, 0.385, -1.1);
  },
  cam: { height: 1.7, distance: 9.5, pitch: -0.22 },
  engine: { base: 34, speedK: 4.0, level: 0.18, osc2: 'sawtooth' },
});
