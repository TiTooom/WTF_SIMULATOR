import * as THREE from 'three';
import { PartBuilder, outlined, outlineMat, toonRaw, toonVC } from './gfx';

// Modèles communs. Les véhicules sont dans src/vehicles/, les props dans src/props.ts, les piétons dans src/peds.ts.

// ---------- Personnage joueur ----------
/**
 * États d'animation (PlayerSnap.an). 0 = au repos / marche / course (déduit de la vitesse réelle du modèle), 1 = arrêté (mains en l'air),
 * 2 = roulade (le jeu fait tourner le groupe en x ; le modèle se met en boule), 3 = K.O. (allongé sur le dos),
 * 5 = caché dans une cachette (haie, benne, abri) : le personnage rapetisse et devient semi-transparent. Toute autre valeur = 0.
 */
export const AN = { NORMAL: 0, BUSTED: 1, ROLL: 2, KO: 3, HIDDEN: 5 } as const;

/** Matériau « caché » PARTAGÉ (copie transparente de toonVC) : les avatars y basculent sans jamais modifier toonVC, puis reviennent à toonVC. */
export const ghostVC = toonRaw({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });

const PLAYER_COLORS = [0xe63946, 0x1d8cf8, 0xffd23f, 0x2ec4b6, 0xff7a1a, 0xb15cff, 0xff5fa2, 0x7bd62b, 0x00c2e0, 0xf2f2f2, 0xff9f1c, 0x3a86ff];
const PANTS_COLORS = [0x2b3a67, 0x3d3d4d, 0x5c3d2e, 0x1f4d3a, 0x4a3a6a, 0x6b5a3a];
const SKINS = [0xf1c27d, 0xe0a370, 0xc68642, 0x8d5524, 0xffdbac];
// Cheveux : jamais trop sombres (la bande d'ombre du toon et le contour les rendraient noirs d'un bloc)
const HAIRS = [0x5a3a22, 0x9a5a28, 0xe8c15a, 0x6a6a96, 0xd2501a, 0xd9d9e3];

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** Couleur d'équipement d'un joueur (déterministe : même pseudo, même couleur chez tous les clients). Utilisable pour la mini-carte. */
export function playerColor(name: string): number {
  return PLAYER_COLORS[hashName(name) % PLAYER_COLORS.length];
}

interface Rig {
  body: THREE.Group; // pivote pour le K.O.
  torso: THREE.Mesh;
  head: THREE.Mesh;
  armL: THREE.Group; armR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  sprite: THREE.Sprite;
  lastX: number; lastZ: number; lastT: number;
  speed: number; phase: number; ko: number; busted: number; roll: number;
  an: number;
  hide: number; // 0..1 : fondu vers l'état caché
  hidden: boolean; // matériaux fantômes appliqués
  parts: THREE.Mesh[]; // maillages colorés (hors contours)
}

const FEET = -0.85; // les pieds sont à 0,85 m sous le centre du corps physique (capsule de 1,7 m)

const hull = (m: THREE.Mesh, t: number) => outlined(m, t);

function limb(name: 'arm' | 'leg', main: number, end: number): THREE.Group {
  // origine = articulation (haut du membre), le membre pend vers −y
  const b = new PartBuilder();
  if (name === 'leg') {
    b.box(0.2, 0.62, 0.22, main, 0, -0.31, 0);
    b.box(0.22, 0.14, 0.32, end, 0, -0.68, -0.05); // chaussure, pointe vers l'avant (−z)
  } else {
    b.box(0.15, 0.4, 0.16, main, 0, -0.2, 0);
    b.box(0.14, 0.14, 0.14, end, 0, -0.46, 0); // main
  }
  const g = new THREE.Group();
  g.add(hull(new THREE.Mesh(b.build(), toonVC), 0.03));
  return g;
}

/** Un petit personnage toon, pieds à −0,85 m du centre du groupe, regard vers −z, nom flottant au-dessus. Animé tout seul (voir `setAvatarState`). */
export function buildAvatar(name: string): THREE.Group {
  const h = hashName(name);
  const shirt = PLAYER_COLORS[h % PLAYER_COLORS.length];
  const pants = PANTS_COLORS[(h >> 5) % PANTS_COLORS.length];
  const skin = SKINS[(h >> 9) % SKINS.length];
  const hair = HAIRS[(h >> 13) % HAIRS.length];
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = FEET;
  g.add(body);

  const tb = new PartBuilder();
  tb.box(0.5, 0.56, 0.3, shirt, 0, 1.03, 0);
  tb.box(0.52, 0.1, 0.32, 0x23232e, 0, 0.78, 0); // ceinture
  tb.box(0.2, 0.06, 0.04, 0xffffff, 0, 1.28, -0.16); // col
  const torso = hull(new THREE.Mesh(tb.build(), toonVC), 0.035);
  body.add(torso);

  const hb = new PartBuilder();
  hb.add(new THREE.SphereGeometry(0.25, 12, 9), skin, 0, 1.58, 0);
  // Cheveux : calotte reculée et relevée (le visage reste dégagé, avant elle recouvrait toute la face) + frange sur le front
  hb.add(new THREE.SphereGeometry(0.275, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 1.63, 0.05);
  hb.box(0.34, 0.07, 0.12, hair, 0, 1.755, -0.15);
  for (const x of [-0.09, 0.09]) {
    hb.box(0.09, 0.1, 0.03, 0xffffff, x, 1.6, -0.247); // blanc de l'oeil
    hb.box(0.05, 0.075, 0.03, 0x14141f, x, 1.595, -0.263); // pupille
  }
  hb.box(0.06, 0.06, 0.06, skin, 0, 1.54, -0.26); // nez
  const head = hull(new THREE.Mesh(hb.build(), toonVC), 0.035);
  body.add(head);

  const armL = limb('arm', shirt, skin), armR = limb('arm', shirt, skin);
  armL.position.set(-0.34, 1.26, 0); armR.position.set(0.34, 1.26, 0);
  const legL = limb('leg', pants, 0x2a2a33), legR = limb('leg', pants, 0x2a2a33);
  legL.position.set(-0.12, 0.78, 0); legR.position.set(0.12, 0.78, 0);
  body.add(armL, armR, legL, legR);

  // Nom : taille écran constante (sizeAttenuation désactivé), toujours devant le décor, souligné de la couleur du joueur
  const c = document.createElement('canvas');
  c.width = 320; c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.font = '900 38px "Segoe UI", Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#14141f';
  ctx.strokeText(name, 160, 42, 300);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 160, 42, 300);
  ctx.fillStyle = '#' + shirt.toString(16).padStart(6, '0');
  ctx.strokeStyle = '#14141f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(60, 54, 200, 10, 5);
  ctx.fill();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.2, 0.045, 1);
  sprite.position.y = 1.35;
  sprite.renderOrder = 20;
  g.add(sprite);

  const rig: Rig = {
    body, torso, head, armL, armR, legL, legR, sprite, lastX: NaN, lastZ: NaN, lastT: 0, speed: 0, phase: 0, ko: 0, busted: 0, roll: 0, an: 0, hide: 0, hidden: false, parts: [],
  };
  g.traverse((o) => { if (o instanceof THREE.Mesh && o.material === toonVC) rig.parts.push(o); });
  g.userData.rig = rig;
  // L'animation se joue pendant la mise à jour des matrices (une fois par image, juste avant le rendu) : main.ts n'a rien d'autre à appeler.
  const base = g.updateMatrixWorld.bind(g);
  g.updateMatrixWorld = (force?: boolean) => {
    animate(g, rig);
    base(force);
  };
  return g;
}

/**
 * Optionnel : état d'animation (`PlayerSnap.an`, voir AN) et affichage du nom. Sans appel, le modèle déduit seul la marche/course de sa
 * vitesse et la roulade de `group.rotation.x` (main.ts la fait déjà tourner). Pour le K.O. / l'arrestation, appeler chaque image.
 */
export function setAvatarState(g: THREE.Group, an: number | undefined, showName = true): void {
  const rig = g.userData.rig as Rig | undefined;
  if (!rig) return;
  rig.an = an ?? 0;
  rig.sprite.visible = showName && rig.an !== AN.HIDDEN;
}

/** Bascule les matériaux d'un avatar (normal <-> fantôme) ; les contours se masquent quand il est caché. Toujours revenir à toonVC. */
function applyHidden(r: Rig, hidden: boolean) {
  if (r.hidden === hidden) return;
  r.hidden = hidden;
  for (const m of r.parts) {
    m.material = hidden ? ghostVC : toonVC;
    for (const c of m.children) if ((c as THREE.Mesh).material === outlineMat) c.visible = !hidden;
  }
}

const lerpTo = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);

function animate(g: THREE.Group, r: Rig) {
  const now = performance.now();
  const dt = Math.min(0.1, (now - r.lastT) / 1000);
  if (r.lastT && dt < 0.004) return; // plusieurs mises à jour dans la même image : une seule animation
  const x = g.position.x, z = g.position.z;
  if (Number.isFinite(r.lastX) && r.lastT) {
    const d = Math.hypot(x - r.lastX, z - r.lastZ);
    const v = d > 6 ? 0 : d / dt; // téléportation : pas de course folle
    r.speed = lerpTo(r.speed, v, dt * 12);
  }
  r.lastX = x; r.lastZ = z; r.lastT = now;

  const rolling = r.an === AN.ROLL || Math.abs(g.rotation.x) > 0.05;
  const k = dt * 10;
  r.ko = lerpTo(r.ko, r.an === AN.KO ? 1 : 0, k);
  r.busted = lerpTo(r.busted, r.an === AN.BUSTED ? 1 : 0, k);
  r.roll = lerpTo(r.roll, rolling ? 1 : 0, k * 1.5);
  r.hide = lerpTo(r.hide, r.an === AN.HIDDEN ? 1 : 0, k * 0.8);
  applyHidden(r, r.hide > 0.05);
  const hs = 1 - 0.3 * r.hide; // rapetisse dans la cachette
  r.body.scale.setScalar(hs);
  const moving = Math.min(1, r.speed / 1.5);
  const run = Math.min(1, Math.max(0, (r.speed - 4) / 2));
  r.phase += dt * (6 + r.speed * 1.5);
  const sw = Math.sin(r.phase) * (0.55 + 0.45 * run) * moving * (1 - r.roll);
  const idle = Math.sin(now / 480) * 0.03;

  r.legL.rotation.x = sw * 1.1 + r.roll * 1.5 + r.ko * 0.2;
  r.legR.rotation.x = -sw * 1.1 + r.roll * 1.5 - r.ko * 0.1;
  // bras : balancement inverse ; course : coudes pliés (avant-bras vers l'avant) ; arrêté : bras en l'air
  const armBase = -0.35 * run * moving;
  r.armL.rotation.x = lerpTo(-sw * 0.9 + armBase + idle, Math.PI * 0.93, r.busted) - r.roll * 1.6 + r.ko * 0.4;
  r.armR.rotation.x = lerpTo(sw * 0.9 + armBase - idle, Math.PI * 0.93, r.busted) - r.roll * 1.6 - r.ko * 0.4;
  r.armL.rotation.z = r.busted * 0.25 + r.ko * 0.5;
  r.armR.rotation.z = -r.busted * 0.25 - r.ko * 0.5;
  // buste : penché en avant à la course, rebond de foulée ; K.O. : à plat sur le dos
  const lean = (0.1 + 0.25 * run) * moving * (1 - r.roll);
  r.body.rotation.x = lean + r.ko * (Math.PI / 2 - lean);
  r.body.position.y = FEET + Math.abs(Math.cos(r.phase)) * 0.05 * moving * (1 - r.ko) + r.ko * 0.17;
  r.head.rotation.x = Math.sin(r.phase * 2) * 0.03 * moving + r.busted * -0.15;
}

/** Libère les ressources propres d'un avatar (géométries construites pour lui, texture du nom). */
export function disposeAvatar(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    } else if (o instanceof THREE.Mesh && (o.material === toonVC || o.material === ghostVC || o.material === outlineMat)) {
      o.geometry.dispose();
    }
  });
}
