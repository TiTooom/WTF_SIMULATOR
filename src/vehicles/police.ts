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
  },
  cam: { height: 1.7, distance: 9.5, pitch: -0.22 },
  engine: { base: 34, speedK: 4.0, level: 0.18, osc2: 'sawtooth' },
});
