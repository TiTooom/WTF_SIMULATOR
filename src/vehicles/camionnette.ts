import { makeCarView } from './kit';

/** La camionnette : cabine courte devant, grande caisse à l'arrière. */
export const view = makeCarView({
  type: 'camionnette', name: 'la camionnette', label: 'Camionnette',
  l: 5.0, w: 2.1,
  cab: { w: 1.84, h: 0.55, l: 1.3, z: -1.0 },
  palette: [0xf2f2ea, 0x4a7fd0, 0xd8402f, 0x6f8f3a, 0xf0b429, 0x8e8e9a],
  wheel: { r: 0.42, x: 1.08, front: -1.6, rear: 1.5 },
  detail: (b, s) => {
    b.box(s.w - 0.1, 1.35, 2.7, 0xffffff, 0, 0.33 + 0.675, 1.1, true); // caisse
    b.box(0.04, 1.0, 0.9, 0x23232e, s.w / 2 - 0.03, 0.9, 1.0); // porte coulissante
    b.box(0.04, 1.0, 0.9, 0x23232e, -(s.w / 2 - 0.03), 0.9, 1.0);
    b.box(s.w - 0.3, 0.12, 0.06, 0xf0b429, 0, 0.3, s.l / 2 + 0.02); // bande arrière
    b.box(0.5, 0.06, 2.7, 0x23232e, 0, 0.33 + 1.38, 1.1); // galerie
  },
  cam: { height: 2.1, distance: 10.5, pitch: -0.24 },
  engine: { base: 26, speedK: 3.2, level: 0.2, cutoff: 320 },
  enterRadius: 5.5,
});
