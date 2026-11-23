import { makeCarView } from './kit';

/** La berline : longue et basse, teintes sobres. */
export const view = makeCarView({
  type: 'berline', name: 'la berline', label: 'Berline',
  l: 4.7, w: 1.95,
  cab: { w: 1.7, h: 0.52, l: 2.0, z: 0.3 },
  palette: [0x2f4f9e, 0x9e2b45, 0xb9c3cf, 0x3a3a48, 0x2f8a63, 0xd8c9a5, 0x6a3f9e],
  wheel: { r: 0.37, x: 1.0, front: -1.5, rear: 1.5 },
  detail: (b, s) => {
    for (const sx of [-1, 1]) b.box(0.03, 0.05, s.l * 0.7, 0xe8e8f0, sx * (s.w / 2 + 0.01), 0.1, 0); // jonc chromé
    b.box(1.2, 0.03, 0.5, 0x23232e, 0, 0.345, 1.9); // coffre
  },
  cam: { height: 1.7, distance: 9.5, pitch: -0.22 },
  engine: { base: 32, speedK: 3.8, level: 0.17, osc2: 'sawtooth' },
});
