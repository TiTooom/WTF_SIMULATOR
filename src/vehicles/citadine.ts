import { makeCarView } from './kit';

/** La citadine : petite, haute, colorée. */
export const view = makeCarView({
  type: 'citadine', name: 'la citadine', label: 'Citadine',
  l: 3.8, w: 1.8,
  cab: { w: 1.56, h: 0.62, l: 1.9, z: 0.25 },
  palette: [0xe74c3c, 0xf1c40f, 0x1abc9c, 0xff7f2a, 0xff6fa8, 0x8bd13f, 0x4c8dff, 0xffffff],
  wheel: { r: 0.36, x: 0.92, front: -1.2, rear: 1.2 },
  detail: (b, s) => {
    b.box(0.3, 0.02, s.l * 0.85, 0xffffff, 0, 0.345, 0); // bande de capot
  },
  cam: { height: 1.6, distance: 8.5, pitch: -0.22 },
  engine: { base: 38, speedK: 4.4, level: 0.16 },
});
