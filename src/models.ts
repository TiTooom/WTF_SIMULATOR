import * as THREE from 'three';
import { EXC, type CrateDef } from '../shared/constants';
import type { VehicleSnap } from '../shared/protocol';
import { box, outlined, toon } from './gfx';

// Les modèles ne portent aucune logique de jeu : ils affichent l'état reçu du serveur.

export interface VehicleView {
  group: THREE.Group;
  /** Animations dépendant de l'état (roues, bras...). */
  update(s: VehicleSnap, dt: number): void;
}

function lamp(parent: THREE.Object3D, color: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  parent.add(m);
}

export function buildCar(): VehicleView {
  const group = new THREE.Group();
  const RED = 0xe74c3c;
  box(group, 2, 0.6, 4.2, RED, 0, 0.05, 0); // châssis
  box(group, 1.72, 0.5, 2.0, 0x6ec6ff, 0, 0.6, 0.3); // vitres
  box(group, 1.85, 0.12, 2.15, RED, 0, 0.91, 0.3); // toit
  box(group, 0.3, 0.02, 1.7, 0xffffff, 0, 0.36, -1.2, false); // bande capot
  box(group, 2.1, 0.2, 0.15, 0x2b2b35, 0, -0.1, -2.12); // pare-chocs
  box(group, 2.1, 0.2, 0.15, 0x2b2b35, 0, -0.1, 2.12);
  lamp(group, 0xfff3a0, -0.65, 0.2, -2.12);
  lamp(group, 0xfff3a0, 0.65, 0.2, -2.12);
  lamp(group, 0xff3030, -0.65, 0.2, 2.12);
  lamp(group, 0xff3030, 0.65, 0.2, 2.12);

  const tireGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 16).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.36, 0.1, 0.55);
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z, front] of [[-1.05, -1.4, true], [1.05, -1.4, true], [-1.05, 1.4, false], [1.05, 1.4, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.05, z);
    const spin = new THREE.Group();
    spin.add(outlined(new THREE.Mesh(tireGeo, toon(0x25252d)), 0.04), new THREE.Mesh(hubGeo, toon(0xdddddd)), new THREE.Mesh(spokeGeo, toon(0xb0b0b8)));
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  return {
    group,
    update(s, dt) {
      for (const w of wheels) {
        w.spin.rotation.x -= (s.sp * dt) / 0.4;
        if (w.front) w.pivot.rotation.y = s.st * 0.45;
      }
    },
  };
}

export function buildExcavator(): VehicleView {
  const YEL = 0xf1c40f, DARK = 0x33353d, GRAY = 0x8a8f98, STEEL = 0x6b6f78, GLASS = 0x6ec6ff;
  const group = new THREE.Group();

  // Chenilles et châssis
  box(group, 1.0, 1.0, 4.6, DARK, -1.35, 0, 0);
  box(group, 1.0, 1.0, 4.6, DARK, 1.35, 0, 0);
  box(group, 2.0, 0.5, 3.8, GRAY, 0, 0.1, 0);
  const sprocketGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.06, 10).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(1.1, 0.12, 0.7);
  const sprockets: THREE.Group[] = [];
  for (const sx of [-1.35, 1.35]) for (const sz of [-1.9, 1.9]) {
    const g = new THREE.Group();
    g.position.set(sx, 0, sz);
    g.add(new THREE.Mesh(sprocketGeo, toon(0x5a5e68)), new THREE.Mesh(spokeGeo, toon(YEL)));
    group.add(g);
    sprockets.push(g);
  }

  // Cabine
  const turret = new THREE.Group();
  turret.position.y = EXC.turretY;
  group.add(turret);
  box(turret, 3.0, 0.3, 3.4, YEL, 0, 0.15, 0.2);
  box(turret, 1.5, 1.5, 1.7, YEL, -0.7, 1.05, 0.5);
  box(turret, 1.3, 0.7, 0.06, GLASS, -0.7, 1.35, -0.38, false);
  box(turret, 0.06, 0.7, 1.2, GLASS, -1.46, 1.35, 0.5, false);
  box(turret, 1.7, 0.12, 1.9, DARK, -0.7, 1.86, 0.5);
  box(turret, 2.6, 1.1, 0.9, DARK, 0, 0.85, 1.6);
  box(turret, 1.1, 0.9, 1.9, YEL, 0.95, 0.75, 0.8);

  // Bras articulé
  const { L1, L2 } = EXC;
  const boomPivot = new THREE.Group();
  boomPivot.position.set(...EXC.boomPivot);
  turret.add(boomPivot);
  box(boomPivot, 0.5, 0.6, L1, YEL, 0, 0, -L1 / 2);
  const stickPivot = new THREE.Group();
  stickPivot.position.z = -L1;
  boomPivot.add(stickPivot);
  box(stickPivot, 0.38, 0.5, L2, YEL, 0, 0, -L2 / 2);
  const bucketPivot = new THREE.Group();
  bucketPivot.position.z = -L2;
  stickPivot.add(bucketPivot);
  const pin = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10).rotateZ(Math.PI / 2);
  for (const p of [boomPivot, stickPivot, bucketPivot]) p.add(new THREE.Mesh(pin, toon(DARK)));
  // Godet : ouvert vers +y et -z, dents au bout
  box(bucketPivot, 1.4, 0.1, 1.1, STEEL, 0, -0.05, -0.55);
  box(bucketPivot, 1.4, 0.7, 0.1, STEEL, 0, 0.3, -0.05);
  box(bucketPivot, 0.1, 0.7, 1.1, STEEL, -0.7, 0.3, -0.55);
  box(bucketPivot, 0.1, 0.7, 1.1, STEEL, 0.7, 0.3, -0.55);
  for (let i = -2; i <= 2; i++) box(bucketPivot, 0.14, 0.2, 0.22, 0xe6e6ea, i * 0.3, -0.05, -1.2, false);

  return {
    group,
    update(s, dt) {
      turret.rotation.y = s.a[0];
      boomPivot.rotation.x = s.a[1];
      stickPivot.rotation.x = s.a[2];
      bucketPivot.rotation.x = s.a[3];
      for (const g of sprockets) g.rotation.x -= (s.sp * dt) / 0.45;
    },
  };
}

export function buildCrate(c: CrateDef): THREE.Mesh {
  return outlined(new THREE.Mesh(new THREE.BoxGeometry(c.s, c.s, c.s), toon(c.color)), 0.03);
}

// ---------- Joueurs distants ----------
function hashColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55).getHex();
}

export function buildAvatar(name: string): THREE.Group {
  const g = new THREE.Group();
  // Capsule de 1,7 m, centrée sur le corps physique (rayon 0,35 · longueur 1,0)
  g.add(outlined(new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 10), toon(hashColor(name))), 0.04));
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0x1b1b2b }));
    eye.position.set(x, 0.5, -0.33); // l'avant est -z
    g.add(eye);
  }
  // Pastille de nom
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1b1b2b';
  ctx.strokeText(name, 128, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 44);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 1.5;
  g.add(sprite);
  return g;
}
