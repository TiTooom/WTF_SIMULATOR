// Décor du monde partagé serveur/client : lieux, bâtiments, rampes, panneaux, pistes…
// - STATICS : formes fixes décrites par des DONNÉES. Le serveur en fait des colliders fixes, le client les dessine (src/scene.ts, instancié).
// - LABELS : textes (panneaux, numéros de piste…) dessinés par le client.
// - DECOR_PROPS : props physiques de décor (immeubles en blocs, château de caisses, easter eggs…) créés par buildWorld / spawnDecor.
// - PADS, RINGS, HILL, ZONES : données utilisées par server/extras.ts (trampolines, cerceaux de cascade, colline, arbres à dégager).
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ROAD_X, seeded, treeLayout, type TreeDef } from './constants';

export type StaticShape = 'box' | 'cylinder' | 'wedge' | 'sphere';
export interface StaticDef {
  shape: StaticShape;
  pos: [number, number, number]; // centre
  size: [number, number, number]; // box/wedge : largeur, hauteur, profondeur · cylinder : [diamètre, hauteur, _] · sphere : [diamètre, _, _]
  rotY?: number; // radians
  color: number;
  collide?: boolean; // défaut true ; false = purement visuel (marquages au sol…)
  glow?: boolean;
  outline?: boolean; // contour noir (défaut : oui pour les formes solides non lumineuses)
}

export interface LabelDef {
  text: string; // « \n » = saut de ligne
  pos: [number, number, number];
  w: number;
  h: number;
  rotY?: number;
  flat?: boolean; // posé à plat au sol (le haut du texte pointe vers −z avant rotY)
  color?: number; // couleur du texte
}

export const STATICS: StaticDef[] = [];
export const LABELS: LabelDef[] = [];
export interface DecorProp { kind: string; pos: [number, number, number]; rotY?: number }
export const DECOR_PROPS: DecorProp[] = [];
/** Trampolines fixes : un véhicule ou un joueur qui y passe est propulsé (server/extras.ts). */
export const PADS: Array<{ x: number; z: number; r: number; power: number }> = [];
/** Cerceaux de cascade (plan vertical de normale (nx, nz)) : les traverser en véhicule fait gagner un point. */
export const RINGS: Array<{ x: number; y: number; z: number; r: number; nx: number; nz: number }> = [];
/** Zones rectangulaires occupées par un lieu : les arbres qui y sont sont retirés (visuel + collider). */
export const ZONES: Array<{ x: number; z: number; hx: number; hz: number }> = [];
/** Colline du mode « roi de la colline » (centre de l'arène de démolition). */
export const HILL = { x: -60, z: -140, r: 9 };
export const PLACES = {
  piste: { x: 80, z: -150, name: 'la piste d\'atterrissage' },
  heliport: { x: 110, z: -40, name: 'l\'héliport' },
  cascade: { x: 85, z: 85, name: 'la piste de cascade' },
  parcours: { x: -62, z: -62, name: 'le parcours d\'obstacles' },
  ville: { x: -85, z: 70, name: 'la ville miniature' },
  arene: { x: HILL.x, z: HILL.z, name: 'l\'arène de démolition' },
  parking: { x: 20, z: -95, name: 'le parking du supermarché' },
  chateau: { x: -115, z: -5, name: 'le château de caisses' },
  pont: { x: 130, z: 30, name: 'le pont' },
};

// ---------- Outils de construction ----------
type O = Partial<StaticDef>;
const add = (shape: StaticShape, pos: [number, number, number], size: [number, number, number], color: number, o: O = {}) => {
  STATICS.push({ shape, pos, size, color, ...o });
};
const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, o: O = {}) => add('box', [x, y, z], [w, h, d], color, o);
const cyl = (x: number, y: number, z: number, dia: number, h: number, color: number, o: O = {}) => add('cylinder', [x, y, z], [dia, h, dia], color, o);
const ball = (x: number, y: number, z: number, dia: number, color: number, o: O = {}) => add('sphere', [x, y, z], [dia, dia, dia], color, o);
const ramp = (x: number, z: number, w: number, h: number, l: number, rise: number, color: number, y0 = 0) =>
  add('wedge', [x, y0 + h / 2, z], [w, h, l], color, { rotY: rise });
const RISE_PX = -Math.PI / 2, RISE_NX = Math.PI / 2, RISE_NZ = 0, RISE_PZ = Math.PI; // direction vers laquelle monte la rampe
// Décalques au sol (non solides) : layer 0 = bitume, 1 = lignes, 2+ = marquages
const FL = 0.03;
const flat = (x: number, z: number, w: number, d: number, color: number, layer = 0, rotY = 0) =>
  box(x, FL / 2 + layer * FL, z, w, FL, d, color, { collide: false, rotY });
const disc = (x: number, z: number, dia: number, color: number, layer = 0) => cyl(x, FL / 2 + layer * FL, z, dia, FL, color, { collide: false });
const label = (text: string, x: number, y: number, z: number, w: number, h: number, o: Partial<LabelDef> = {}) => LABELS.push({ text, pos: [x, y, z], w, h, ...o });
const zone = (x: number, z: number, hx: number, hz: number) => ZONES.push({ x, z, hx, hz });
const prop = (kind: string, x: number, y: number, z: number, rotY = 0) => DECOR_PROPS.push({ kind, pos: [x, y, z], rotY });
const towardOrigin = (x: number, z: number) => Math.atan2(-x, -z);

/** Panneau sur deux poteaux, lisible des deux côtés. rotY : direction de face (sin, cos). */
function sign(x: number, z: number, rotY: number, text: string, w = 6, h = 1.8, y = 3.2, bg = 0xfff1c1, fg = 0x2b2b3a) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (const k of [-1, 1]) box(x + c * k * (w / 2 - 0.35), y / 2, z - s * k * (w / 2 - 0.35), 0.25, y, 0.25, 0x6b4f2a, { rotY });
  box(x, y, z, w, h, 0.15, bg, { rotY });
  for (const k of [1, -1]) label(text, x + s * 0.1 * k, y, z + c * 0.1 * k, w - 0.4, h - 0.3, { rotY: rotY + (k < 0 ? Math.PI : 0), color: fg });
}

/** Cercle de billes lumineuses (un cerceau de cascade). */
function ring(x: number, y: number, z: number, r: number, nx: number, nz: number, color: number) {
  RINGS.push({ x, y, z, r, nx, nz });
  const tx = -nz, tz = nx;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ball(x + tx * Math.cos(a) * r, y + Math.sin(a) * r, z + tz * Math.cos(a) * r, i % 2 ? 0.9 : 1.2, i % 2 ? 0xffffff : color, { collide: false, glow: true });
  }
}

function pad(x: number, z: number, r: number, power = 14) {
  PADS.push({ x, z, r, power });
  disc(x, z, r * 2, 0xff3d9a, 1);
  disc(x, z, r * 1.5, 0xffe14d, 2);
  disc(x, z, r * 0.8, 0xff3d9a, 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ball(x + Math.cos(a) * (r + 0.4), 0.25, z + Math.sin(a) * (r + 0.4), 0.5, 0xffffff, { collide: false, glow: true });
  }
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
/** Flèche vue d'un spectateur qui regarde vers −z (droite = +x, haut = −z). */
const arrowFor = (dx: number, dz: number) => ARROWS[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];

// =====================================================================================================================
// 1. Piste d'atterrissage (x=80, z −20 → −280, 24 m de large), héliport, tour, hangar
// =====================================================================================================================
(function airport() {
  const cx = 80, cz = -150, len = 260;
  zone(cx, cz, 18, len / 2 + 6);
  flat(cx, cz, 26.4, len + 2.4, 0x7d838c, 0);
  flat(cx, cz, 24, len, 0x3b3f47, 1);
  for (let z = -34; z > -272; z -= 14) flat(cx, z, 0.6, 7, 0xffffff, 2);
  for (const k of [-1, 1]) flat(cx + k * 11.5, cz, 0.4, len - 2, 0xffffff, 2);
  for (const zz of [-27, -273]) for (let i = 0; i < 8; i++) flat(cx - 9.6 + i * 2.74, zz, 0.9, 6, 0xffffff, 2);
  // zones de toucher des roues
  for (const zz of [-70, -230]) for (const k of [-1, 1]) flat(cx + k * 4, zz, 1.2, 8, 0xffffff, 2);
  label('09', cx, 0.12, -48, 8, 9, { flat: true, color: 0xffffff });
  label('27', cx, 0.12, -252, 8, 9, { flat: true, color: 0xffffff, rotY: Math.PI });
  label('AÉROPORT WTF', cx, 0.12, -150, 14, 3, { flat: true, color: 0xffd60a, rotY: Math.PI / 2 });
  // feux de bord de piste, seuils vert (arrivée) et rouge (fin)
  for (let z = -22; z >= -278; z -= 16) for (const k of [-1, 1]) box(cx + k * 12.6, 0.18, z, 0.5, 0.36, 0.5, 0xfff7c2, { collide: false, glow: true });
  for (let i = 0; i < 9; i++) {
    box(cx - 12 + i * 3, 0.18, -20.5, 0.5, 0.36, 0.5, 0x2dff7a, { collide: false, glow: true });
    box(cx - 12 + i * 3, 0.18, -279.5, 0.5, 0.36, 0.5, 0xff3030, { collide: false, glow: true });
  }
  // manche à air
  cyl(66, 3, -40, 0.25, 6, 0xdddddd);
  [0xff7b00, 0xffffff, 0xff7b00].forEach((c, i) => box(66.9 + i * 0.9, 5.7 - i * 0.1, -40, 0.9, 0.7 - i * 0.12, 0.7 - i * 0.12, c, { collide: false }));

  // tour de contrôle
  const tx = 56, tz = -50;
  box(tx, 5, tz, 5, 10, 5, 0xe3e6ea);
  for (const y of [3, 7]) box(tx, y, tz, 5.2, 0.5, 5.2, 0xe63946, { collide: false });
  box(tx, 11.2, tz, 8.5, 2.4, 8.5, 0x4cc9f0, { collide: false });
  box(tx, 11.2, tz, 8, 2.6, 8, 0x4cc9f0);
  box(tx, 12.9, tz, 9.6, 0.7, 9.6, 0xe63946);
  cyl(tx, 15.5, tz, 0.3, 5, 0x888888);
  ball(tx, 18.2, tz, 0.9, 0xff3030, { glow: true, collide: false });
  label('TOUR DE CONTRÔLE', tx + 2.6, 8.6, tz, 4.6, 0.9, { rotY: Math.PI / 2, color: 0x222233 });
  label('Ici Radio WTF : tout va bien', tx + 4.3, 11.2, tz, 7, 1, { rotY: Math.PI / 2, color: 0xffffff });

  // hangar ouvert côté piste (ouvert sur −x)
  const hx = 108, hz = -110;
  box(hx + 9, 4, hz, 0.6, 8, 14, 0xcfd8dc);
  box(hx, 4, hz - 7, 18, 8, 0.6, 0xcfd8dc);
  box(hx, 4, hz + 7, 18, 8, 0.6, 0xcfd8dc);
  box(hx, 8.2, hz, 19, 0.5, 15, 0xe63946);
  box(hx - 9.3, 7.3, hz, 0.6, 1.4, 15, 0xffd60a, { collide: false });
  label('HANGAR N°1', hx - 9.7, 7.3, hz, 11, 1.2, { rotY: -Math.PI / 2, color: 0x222233 });
  zone(hx, hz, 12, 10);

  // héliport
  const px = 110, pz = -40;
  zone(px, pz, 12, 12);
  disc(px, pz, 20, 0x5a606a, 0);
  disc(px, pz, 18.4, 0xffffff, 1);
  disc(px, pz, 17, 0x353a43, 2);
  for (const k of [-1, 1]) flat(px + k * 2.4, pz, 1.4, 8, 0xffffff, 3);
  flat(px, pz, 5, 1.4, 0xffffff, 3);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ball(px + Math.cos(a) * 9.6, 0.2, pz + Math.sin(a) * 9.6, 0.5, i % 2 ? 0xffa200 : 0xffffff, { collide: false, glow: true });
  }
  label('HÉLIPORT', px, 0.2, pz + 12.5, 9, 1.8, { flat: true, color: 0xffffff, rotY: Math.PI });
  sign(px - 12, pz + 4, -Math.PI / 2, 'HÉLIPORT\nAtterrissage doux exigé', 6, 2, 3.2, 0xffd60a);
})();

// =====================================================================================================================
// 2. Piste de cascade (le long de x, z=85)
// =====================================================================================================================
(function stunt() {
  const z = 85;
  zone(85, 92, 56, 24);
  flat(86, z, 112, 10, 0x3b3f47, 0);
  for (const k of [-1, 1]) flat(86, z + k * 4.6, 112, 0.3, 0xffd60a, 1);
  for (let x = 36; x < 140; x += 8) flat(x, z, 3, 0.3, 0xffffff, 1);
  sign(36, 76, towardOrigin(36, 76), 'PISTE DE CASCADE\nSaute, tourne, rate', 7.5, 2.2, 3.4, 0xff9ecf);
  ramp(48, z, 8, 2.4, 12, RISE_PX, 0xff8a00);
  ring(60, 6.4, z, 4, 1, 0, 0xff8a00);
  ramp(72, z, 8, 2.4, 12, RISE_NX, 0xffb703);
  pad(84, z, 3.4, 15);
  ring(93, 9.2, z, 4.4, 1, 0, 0xff3d9a);
  ramp(101, z, 8, 4, 16, RISE_PX, 0x6a4c93);
  ring(118, 9, z, 4.4, 1, 0, 0x2dff7a);
  ramp(130, z, 8, 4, 16, RISE_NX, 0x8ac926);
  // plateforme surélevée + podium
  box(96, 0.75, 104, 10, 1.5, 10, 0x1982c4);
  ramp(96, 95.5, 6, 1.5, 8, RISE_PZ, 0xffca3a);
  cyl(112, 0.5, 102, 7, 1, 0xffd700);
  cyl(112, 1.5, 102, 4.5, 2, 0xc0c0c0);
  cyl(112, 2.5, 102, 2.2, 3, 0xcd7f32);
  label('1', 112 - 0, 3.2, 102 + 1.15, 1.5, 1.5, { color: 0xffffff });
  sign(124, 96, towardOrigin(124, 96), 'RECORD À BATTRE : 0\n(personne n\'a essayé)', 7, 2, 3, 0xffffff);
})();

// =====================================================================================================================
// 3. Parcours d'obstacles (z=−62, de x=−104 à x=−24)
// =====================================================================================================================
(function course() {
  const z = -62;
  zone(-64, z, 44, 14);
  flat(-64, z, 84, 13, 0xc9b79c, 0);
  // départ
  for (const k of [-1, 1]) cyl(-102, 3, z + k * 7, 0.9, 6, 0xe63946);
  box(-102, 6.3, z, 0.6, 1.5, 15.5, 0xffffff);
  label('DÉPART', -102.4, 6.3, z, 10, 1.3, { rotY: -Math.PI / 2, color: 0x2b2b3a });
  label('DÉPART', -101.6, 6.3, z, 10, 1.3, { rotY: Math.PI / 2, color: 0x2b2b3a });
  // slalom
  for (let i = 0; i < 6; i++) cyl(-95 + i * 5.2, 0.9, z + (i % 2 ? -3 : 3), 1.3, 1.8, i % 2 ? 0xffffff : 0xff7b00);
  // tunnel
  for (const k of [-1, 1]) box(-62, 2, z + k * 3.7, 12, 4, 0.8, 0x9d4edd);
  box(-62, 4.3, z, 12, 0.6, 8.6, 0xffd60a);
  // pendules (boules fixes)
  const bx = -50;
  for (const k of [-1, 1]) cyl(bx, 4.5, z + k * 8.3, 0.7, 9, 0x4361ee);
  box(bx, 9.2, z, 0.7, 0.7, 17.6, 0x4361ee);
  for (const dz of [-4.6, 0, 4.6]) {
    cyl(bx, 6.3, z + dz, 0.12, 6.2, 0x222222, { collide: false });
    ball(bx, 3.0, z + dz, 2.6, 0xff006e);
  }
  // rampe + mur à franchir, bosses, trampoline
  ramp(-42, z, 8, 1.4, 6, RISE_PX, 0x06d6a0);
  box(-37, 0.7, z, 1.2, 1.4, 12, 0xef476f);
  ramp(-31, z, 8, 1.2, 5, RISE_PX, 0xffd166);
  ramp(-26, z, 8, 1.2, 5, RISE_NX, 0xffd166);
  pad(-35, z + 7.3, 2.6, 13);
  label('ARRIVÉE', -22, 6.3, z, 10, 1.3, { rotY: Math.PI / 2, color: 0x2b2b3a });
  for (const k of [-1, 1]) cyl(-22.4, 3, z + k * 7, 0.9, 6, 0x2dff7a);
  box(-22.4, 6.3, z, 0.6, 1.5, 15.5, 0xffffff);
  label('ARRIVÉE', -22.8, 6.3, z, 10, 1.3, { rotY: -Math.PI / 2, color: 0x2b2b3a });
  sign(-110, z + 11, Math.PI / 2, 'PARCOURS DU COMBATTANT\nTunnel, boules, mur, bosses', 7.5, 2.2, 3.2, 0xb8f2e6);
})();

// =====================================================================================================================
// 4. Ville miniature (props destructibles) — rues et mobilier statiques
// =====================================================================================================================
(function city() {
  const cx = -85, cz = 70;
  zone(cx, cz, 34, 30);
  flat(cx, cz, 66, 58, 0x8f98a3, 0);
  flat(cx, cz, 66, 8, 0x3b3f47, 1);
  flat(cx, cz, 8, 58, 0x3b3f47, 1);
  for (let x = cx - 30; x < cx + 32; x += 6) if (Math.abs(x - cx) > 5) flat(x, cz, 3, 0.3, 0xffffff, 2);
  for (let z = cz - 26; z < cz + 28; z += 6) if (Math.abs(z - cz) > 5) flat(cx, z, 0.3, 3, 0xffffff, 2);
  flat(cx, cz, 8, 8, 0x4a4f58, 2);
  for (let i = 0; i < 6; i++) flat(cx - 3 + i * 1.2, cz + 5.5, 0.6, 3, 0xffffff, 2); // passage piéton
  // lampadaires
  for (const [x, z] of [[-93, 62], [-77, 62], [-93, 78], [-77, 78], [-112, 70], [-58, 70]]) {
    cyl(x, 2.4, z, 0.25, 4.8, 0x444444);
    ball(x, 5, z, 0.9, 0xfff1a8, { glow: true, collide: false });
  }
  // fontaine / petit parc
  cyl(cx, 0.3, cz, 5, 0.6, 0x9fb7c9, { collide: false });
  cyl(cx, 0.9, cz, 0.8, 1.8, 0x9fb7c9);
  ball(cx, 2, cz, 1.2, 0x4cc9f0);
  sign(-50, 70, Math.PI / 2, 'VILLE MINIATURE\nPrière de tout démolir', 7.5, 2.2, 3.4, 0xffd6a5);
  // immeubles (props) : [x, z, étages, kind pair, kind impair]
  const B: Array<[number, number, number, string, string]> = [
    [-110, 50, 4, 'd_blk_a', 'd_blk_c'], [-103, 50, 3, 'd_blk_b', 'd_blk_d'], [-96, 51, 5, 'd_blk_c', 'd_blk_a'],
    [-110, 92, 3, 'd_blk_d', 'd_blk_b'], [-102, 90, 5, 'd_blk_a', 'd_blk_b'], [-93, 92, 4, 'd_blk_b', 'd_blk_c'],
    [-76, 50, 4, 'd_blk_d', 'd_blk_a'], [-68, 51, 3, 'd_blk_a', 'd_blk_d'], [-60, 50, 5, 'd_blk_b', 'd_blk_c'],
    [-76, 92, 3, 'd_blk_c', 'd_blk_d'], [-67, 90, 4, 'd_blk_d', 'd_blk_b'],
  ];
  for (const [x, z, fl, ka, kb] of B) for (let k = 0; k < fl; k++) for (const dx of [-1.26, 1.26]) prop(k % 2 ? kb : ka, x + dx, 1.26 + k * 2.52, z);
  // tours cylindriques
  for (const [x, z, fl] of [[-62, 80, 4], [-108, 78, 3], [-78, 62, 4]] as const) for (let k = 0; k < fl; k++) prop('d_cyl', x, 1.26 + k * 2.52, z);
  // la vache sur le toit de l'immeuble n°5 (le plus haut) : voir DECOR_PROPS (easter egg)
  prop('e_cow', -102, 5 * 2.52 + 0.75, 90);
})();

// =====================================================================================================================
// 5. Arène de démolition (colline au centre)
// =====================================================================================================================
(function arena() {
  const { x: cx, z: cz } = HILL;
  const R = 24;
  zone(cx, cz, 30, 30);
  disc(cx, cz, 2 * R, 0xd9c8a0, 0);
  disc(cx, cz, 2 * HILL.r, 0xe63946, 1);
  disc(cx, cz, 2 * HILL.r * 0.66, 0xffffff, 2);
  disc(cx, cz, 2 * HILL.r * 0.33, 0xe63946, 3);
  for (let i = 0; i < 24; i++) {
    if (i === 0 || i === 12) continue; // deux entrées
    const a = (i / 24) * Math.PI * 2;
    box(cx + Math.cos(a) * R, 1.6, cz + Math.sin(a) * R, 6.8, 3.2, 1.6, i % 2 ? 0xffffff : 0xe63946, { rotY: -a - Math.PI / 2 });
  }
  // phare de la colline
  cyl(cx, 20, cz, 0.7, 40, 0xffd60a);
  ball(cx, 41.5, cz, 4, 0xfff35c, { glow: true, collide: false });
  // rampes tournées vers le centre + tonneaux
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    add('wedge', [cx + Math.cos(a) * 16.5, 0.8, cz + Math.sin(a) * 16.5], [6, 1.6, 7], i % 2 ? 0x4cc9f0 : 0xffb703, { rotY: Math.PI / 2 - a });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    prop('d_barrel', cx + Math.cos(a) * 12.5, 0.56, cz + Math.sin(a) * 12.5);
  }
  sign(cx + 30, cz + 6, Math.PI / 2, 'ARÈNE DE DÉMOLITION\nRoi de la colline · Derby', 7.5, 2.2, 3.4, 0xffadad);
})();

// =====================================================================================================================
// 6. Parking de supermarché
// =====================================================================================================================
(function parking() {
  const cx = 20, cz = -95;
  zone(cx, cz, 26, 25);
  flat(cx, cz, 46, 32, 0x3b3f47, 0);
  for (let x = cx - 17; x <= cx + 17; x += 3.4) for (const z of [-99, -86]) flat(x, z, 0.14, 5.6, 0xffffff, 1);
  flat(cx, -92.5, 40, 0.3, 0xffd60a, 1);
  // magasin
  box(cx, 4, -113, 38, 8, 12, 0xcaf0f8);
  box(cx, 8.4, -113, 38.6, 0.9, 12.6, 0xe63946);
  box(cx, 1.9, -106.95, 11, 3.8, 0.2, 0x8ecae6, { collide: false });
  box(cx, 9.6, -107.4, 22, 2.6, 0.5, 0xe63946);
  label('SUPER WTF-MARCHÉ', cx, 9.6, -107.1, 20.5, 2.1, { color: 0xffffff });
  label('Tout à -100 % (sauf le prix)', cx, 5.8, -106.95, 18, 1.2, { color: 0x2b2b3a });
  // grand toit sur pilotis
  for (const x of [cx - 13, cx + 13]) for (const z of [-102, -97]) cyl(x, 2.3, z, 0.6, 4.6, 0x6c757d);
  box(cx, 4.9, -99.5, 30, 0.5, 10, 0xffa200);
  // lampadaires
  for (const [x, z] of [[cx - 22, -108], [cx + 22, -108], [cx - 22, -82], [cx + 22, -82]]) {
    cyl(x, 3, z, 0.3, 6, 0x444444);
    box(x, 6.2, z, 1.4, 0.3, 0.7, 0xfff1a8, { glow: true, collide: false });
  }
  // enclos à caddies décoratifs
  for (const x of [cx - 14, cx + 14]) {
    for (const k of [-1, 1]) box(x + k * 0.55, 0.55, -90.5, 0.08, 1.1, 5.4, 0x6c757d);
    box(x, 0.55, -87.9, 1.2, 1.1, 0.08, 0x6c757d);
    for (let i = 0; i < 4; i++) prop('d_cart', x, 0.46, -93 + i * 1.2);
  }
  sign(cx + 25, -88, Math.PI / 2, 'CADDIES : 0 €\n(volés d\'avance)', 6.5, 2, 3, 0xffe8a1);
})();

// =====================================================================================================================
// 7. Château de caisses avec donjon-coffre
// =====================================================================================================================
(function castle() {
  const cx = -115, cz = -5;
  zone(cx, cz, 14, 14);
  disc(cx, cz, 26, 0x8d7b68, 0);
  const n = 6, s = 2.2;
  const edge = (n * s) / 2;
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i === 0 || j === 0 || i === n - 1 || j === n - 1) cells.push([i, j]);
  for (const [i, j] of cells) {
    const x = cx - edge + s / 2 + i * s, z = cz - edge + s / 2 + j * s;
    if (i === n - 1 && (j === 2 || j === 3)) continue; // la porte, côté +x
    prop('d_crate', x, 1.11, z);
    prop('d_crate', x, 3.33, z);
    if ((i + j) % 2 === 0) prop('d_crate_s', x, 4.45 + 0.56, z);
  }
  prop('d_gold', cx, 1.52, cz);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = cx + dx * (edge + 1.4), z = cz + dz * (edge + 1.4);
    cyl(x, 5, z, 0.3, 10, 0xdddddd);
    box(x + 0.9, 9, z, 1.8, 1.1, 0.1, 0xe63946, { collide: false });
  }
  sign(cx + 20, cz + 2, Math.PI / 2, 'CHÂTEAU DE CAISSES\nLe trésor est dans le donjon', 7.5, 2.2, 3.4, 0xffe8a1);
})();

// =====================================================================================================================
// 8. Pont à franchir
// =====================================================================================================================
(function bridge() {
  const cx = 130, cz = 30;
  zone(cx, cz, 32, 34);
  flat(cx, cz, 20, 66, 0x2a9df4, 0);
  for (let i = 0; i < 8; i++) flat(cx + (i % 2 ? 4 : -4), cz - 28 + i * 8, 5, 0.4, 0xbde0fe, 1);
  for (const k of [-1, 1]) box(cx + k * 11, 0.8, cz, 2, 1.6, 66, 0x8d99ae);
  ramp(112, cz, 8, 2.4, 12, RISE_PX, 0xb5835a);
  ramp(148, cz, 8, 2.4, 12, RISE_NX, 0xb5835a);
  box(cx, 2.2, cz, 24, 0.4, 8, 0xb5835a);
  for (let x = cx - 11; x <= cx + 11; x += 2) box(x, 2.41, cz, 0.3, 0.02, 8, 0x8a5a37, { collide: false });
  for (const k of [-1, 1]) {
    box(cx, 2.9, cz + k * 3.8, 24, 0.9, 0.3, 0xffd166);
    for (const x of [cx - 11.8, cx, cx + 11.8]) cyl(x, 2.9, cz + k * 3.8, 0.5, 1.2, 0xe63946);
  }
  sign(100, 22, towardOrigin(100, 22), 'PONT DE LA HONTE\nTraversée à vos risques', 7, 2.2, 3.2, 0xffffff);
  // arbre à trois troncs (easter egg) sur l'autre rive
})();

// =====================================================================================================================
// 9. Easter eggs et curiosités
// =====================================================================================================================
(function eggs() {
  // Cercle de pierres + pierre centrale (e_circle)
  const sx = 30, sz = -55;
  zone(sx, sz, 12, 12);
  disc(sx, sz, 20, 0x4f7942, 0);
  disc(sx, sz, 14, 0x3f6b36, 1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ball(sx + Math.cos(a) * 8, 0.8, sz + Math.sin(a) * 8, 2.4 + (i % 3) * 0.3, 0x9aa0a6);
  }
  prop('e_stone', sx, 0.72, sz);
  // Bouton rouge « NE PAS APPUYER »
  const bx = 45, bz = 45;
  zone(bx, bz, 5, 5);
  cyl(bx, 0.25, bz, 2.6, 0.5, 0xffd60a);
  cyl(bx, 0.52, bz, 2.1, 0.05, 0x222222, { collide: false });
  prop('e_button', bx, 0.83, bz);
  sign(bx, bz + 4.5, towardOrigin(bx, bz), 'NE PAS APPUYER', 5.5, 1.5, 2.6, 0xff4d4d, 0xffffff);
  // Piano-caisse
  const px = -60, pz = 20;
  prop('e_piano', px, 0.66, pz);
  box(px, 1.33, pz + 0.2, 2.8, 0.05, 0.7, 0xffffff, { collide: false });
  box(px - 2, 0.35, pz - 1.6, 0.9, 0.7, 0.9, 0x6d597a);
  sign(px, pz + 4, towardOrigin(px, pz), 'PIANO-CAISSE\nFrappe doucement', 5.5, 1.8, 2.8, 0xfff1c1);
  // Canard géant
  prop('e_duck', 165, 2, 115);
  cyl(165, 0.2, 115, 5, 0.4, 0xffffff, { collide: false });
  box(163.2, 3.1, 113.2, 0.6, 0.25, 1.2, 0xff8c00, { collide: false, rotY: 0.8 });
  ball(163.5, 3.2, 113.5, 0.5, 0x111111, { collide: false });
  zone(165, 115, 4, 4);
  sign(158, 106, towardOrigin(158, 106), 'ATTENTION\nCanard en liberté', 5, 1.8, 2.6, 0xffe14d);
  // Caisse qui chante
  prop('e_sing', 60, 0.76, 12);
  // Panneau « ICI RIEN » à la lisière du monde (+ paillasson)
  const rx = -455, rz = 430;
  const rot = towardOrigin(rx, rz);
  sign(rx, rz, rot, 'ICI RIEN', 10, 3.2, 4.4, 0xffffff, 0xd00000);
  prop('e_nothing', rx + Math.sin(rot) * 4, 0.12, rz + Math.cos(rot) * 4, rot);
  // Pilier-sommet (300 m) + cube doré
  const lx = -190, lz = -140;
  zone(lx, lz, 5, 5);
  cyl(lx, 150, lz, 5, 300, 0xf1f3f5);
  for (let y = 15; y < 300; y += 30) cyl(lx, y, lz, 5.7, 3, y % 60 === 15 ? 0xe63946 : 0x4361ee, { collide: false });
  prop('e_summit', lx, 301.6, lz);
  sign(lx + 9, lz + 4, towardOrigin(lx, lz), 'PILIER DU CIEL\n300 m · Bonne chance', 6.5, 2, 3, 0xcaf0f8);
  // Arbre à trois troncs (+ caisses dorées cachées derrière)
  const tx = 160, tz = -150;
  zone(tx, tz, 7, 7);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = tx + Math.cos(a) * 1.1, z = tz + Math.sin(a) * 1.1;
    cyl(x, 3.2, z, 0.9, 6.4, 0x7a4b24);
    ball(x + Math.cos(a) * 1.2, 7.8 + i * 0.5, z + Math.sin(a) * 1.2, 4.6, 0x39ff14, { collide: false });
  }
  prop('d_gold_s', tx - 3.4, 0.5, tz - 3.2);
  prop('d_gold_s', tx - 3.9, 0.5, tz - 2.1);
  // Panneau-accueil monumental près du départ
  const wx = -2, wz = -34;
  for (const k of [-1, 1]) box(wx + k * 7, 4, wz, 0.5, 8, 0.5, 0x6b4f2a);
  box(wx, 8, wz, 16, 4.6, 0.4, 0x3a0ca3);
  box(wx, 8, wz - 0.01, 16.8, 5.2, 0.3, 0xffd60a, { collide: false });
  for (const k of [1, -1]) label('WTF SIMULATOR\nBienvenue, bon courage', wx + k * 0.25, 8, wz, 15, 4, { rotY: k < 0 ? Math.PI : 0, color: 0xfff35c });
  zone(wx, wz, 9, 2);
  // Poteau de directions près du départ
  const dx = 5, dz = -13;
  cyl(dx, 5, dz, 0.4, 10, 0x6b4f2a);
  const targets: Array<[string, { x: number; z: number }, number]> = [
    ['AÉROPORT', PLACES.piste, 0x4cc9f0], ['CASCADES', PLACES.cascade, 0xff9ecf], ['VILLE', PLACES.ville, 0xffd6a5],
    ['ARÈNE', PLACES.arene, 0xffadad], ['PARKING', PLACES.parking, 0xffe8a1], ['PONT', PLACES.pont, 0xb8f2e6], ['COURSE', PLACES.parcours, 0xcaffbf],
  ];
  targets.forEach(([name, t, col], i) => {
    const y = 9.4 - i * 1.15;
    box(dx, y, dz, 5.6, 0.95, 0.2, col);
    for (const k of [1, -1]) label(`${arrowFor(t.x - dx, t.z - dz)}  ${name}`, dx, y, dz + 0.12 * k, 5.2, 0.8, { rotY: k < 0 ? Math.PI : 0, color: 0x1b1b2b });
  });
})();

// =====================================================================================================================
// 10. Couleur partout : arc-en-ciel, ballons, fleurs, champignons, rochers, meules, collines lointaines
// =====================================================================================================================
(function scenery() {
  // Arc-en-ciel de billes
  const rb = [0xff3b30, 0xff9500, 0xffe14d, 0x34c759, 0x32ade6, 0x5856d6, 0xaf52de];
  rb.forEach((c, i) => {
    const R = 28 - i * 1.3;
    for (let k = 0; k <= 22; k++) {
      const a = (k / 22) * Math.PI;
      ball(20 + Math.cos(a) * R, Math.sin(a) * R * 0.85 + 0.8, -32, 1.4, c, { collide: false, glow: true });
    }
  });
  zone(20, -32, 30, 1);

  const rand = seeded(777);
  const spawns: Array<[number, number]> = [
    [0, 5], [-6, -4], [-3, -6], [16, 12], [-25, 18], [-40, -25], [-4, 14], [0, 14], [12, -20], [6, 20], [-14, 24], [28, -10], [40, 25],
  ];
  const free = (x: number, z: number, m: number) =>
    Math.hypot(x, z) > 24 && Math.abs(x - ROAD_X) > 8 + m &&
    !ZONES.some((q) => Math.abs(x - q.x) < q.hx + m + 4 && Math.abs(z - q.z) < q.hz + m + 4) &&
    !spawns.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 10 + m) &&
    !(Math.abs(x - 12) < 8 && z > -8 && z < 12);
  const spot = (lim: number, m: number): [number, number] => {
    for (let t = 0; t < 40; t++) {
      const x = (rand() * 2 - 1) * lim, z = (rand() * 2 - 1) * lim;
      if (free(x, z, m)) return [x, z];
    }
    return [9999, 9999];
  };
  const fl = [0xff5d8f, 0xffd60a, 0xffffff, 0xb388eb, 0xff9e00];
  for (let i = 0; i < 130; i++) {
    const [x, z] = spot(230, 1);
    if (x > 9000) continue;
    cyl(x, 0.2, z, 0.1, 0.4, 0x2d9d3a, { collide: false, outline: false });
    ball(x, 0.5, z, 0.6, fl[i % fl.length], { collide: false, outline: false });
  }
  for (let i = 0; i < 28; i++) {
    const [x, z] = spot(230, 2);
    if (x > 9000) continue;
    const big = 1 + rand() * 1.4;
    cyl(x, 0.5 * big, z, 0.5 * big, big, 0xf5f0e1, { collide: false });
    ball(x, big + 0.1, z, 1.7 * big, rand() < 0.5 ? 0xe63946 : 0xff9e00, { collide: false });
  }
  for (let i = 0; i < 36; i++) {
    const [x, z] = spot(230, 3);
    if (x > 9000) continue;
    const d = 1.2 + rand() * 2.4;
    ball(x, d * 0.3, z, d, rand() < 0.5 ? 0x8d99ae : 0x6c757d);
  }
  for (let i = 0; i < 14; i++) {
    const [x, z] = spot(230, 4);
    if (x > 9000) continue;
    cyl(x, 1.2, z, 3, 2.4, 0xe9c46a);
    cyl(x, 2.5, z, 2.2, 0.5, 0xf4d58d, { collide: false });
  }
  // ballons dans le ciel (lumineux)
  const bc = [0xff3b6b, 0xffd60a, 0x4cc9f0, 0x2dff7a, 0xb388eb];
  for (let i = 0; i < 18; i++) {
    const [x, z] = spot(260, 2);
    if (x > 9000) continue;
    const y = 14 + rand() * 16;
    ball(x, y, z, 3.2, bc[i % bc.length], { collide: false, glow: true, outline: false });
    cyl(x, y / 2 - 1, z, 0.06, y - 2.6, 0xeeeeee, { collide: false, outline: false });
  }
  // collines lointaines
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, r = 255 + rand() * 100, d = 50 + rand() * 50;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (ZONES.some((q) => Math.abs(x - q.x) < q.hx + d / 2 + 10 && Math.abs(z - q.z) < q.hz + d / 2 + 10)) continue;
    ball(x, d * 0.12, z, d, [0x5aa469, 0x4f9d5e, 0x6bb36f][i % 3]);
    if (d > 70) ball(x, d * 0.42, z, d * 0.34, 0xffffff, { collide: false });
  }
})();

// =====================================================================================================================
// API publique
// =====================================================================================================================
/** Un arbre (voir treeLayout) gêne-t-il un lieu ? Si oui il n'est ni dessiné (src/scene.ts) ni solide (buildWorld). */
export function treeBlocked(t: TreeDef): boolean {
  return ZONES.some((q) => Math.abs(t.x - q.x) < q.hx + 3 && Math.abs(t.z - q.z) < q.hz + 3);
}

/** Minimal : ce que buildWorld peut utiliser (implémenté par Sim). */
export interface WorldBuilder {
  readonly world: RAPIER.World;
  spawnProp(kindId: string, pos: THREE.Vector3, rot?: THREE.Quaternion): unknown;
}

/** Crée tous les props de décor (marqués « base » : jamais évincés par la limite de props). Retourne le nombre créé. */
export function spawnDecor(sim: WorldBuilder): number {
  let n = 0;
  for (const d of DECOR_PROPS) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rotY ?? 0);
    const p = sim.spawnProp(d.kind, new THREE.Vector3(...d.pos), q) as { base?: boolean } | null;
    if (p) { p.base = true; n++; }
  }
  return n;
}

/** Retire les colliders des arbres qui gênent un lieu (les arbres du serveur sont créés par le cœur). */
function clearTrees(world: RAPIER.World) {
  const bad = treeLayout().filter(treeBlocked);
  if (!bad.length) return;
  const doomed: RAPIER.Collider[] = [];
  world.forEachCollider((c) => {
    if (c.parent()) return;
    const t = c.translation();
    if (bad.some((b) => Math.abs(t.x - b.x) < 1e-3 && Math.abs(t.z - b.z) < 1e-3 && Math.abs(t.y - 1.5 * b.s) < 1e-3)) doomed.push(c);
  });
  for (const c of doomed) world.removeCollider(c, true);
}

export function buildWorld(sim: WorldBuilder): void {
  clearTrees(sim.world);
  spawnDecor(sim);
}
