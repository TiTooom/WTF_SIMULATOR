import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

const CHROME = 0xcfd8e3;
const RED = 0xe53935;

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = true) {
  const m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z);
  if (outline) outlined(m, 0.03);
  parent.add(m);
  return m;
}

function build(): VehicleView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // châssis chromé
  box(body, 0.78, 0.07, 1.25, CHROME, 0, -0.12, 0.02);
  box(body, 0.06, 0.06, 1.2, CHROME, -0.34, 0.0, 0.0);
  box(body, 0.06, 0.06, 1.2, CHROME, 0.34, 0.0, 0.0);

  // panier rouge à barreaux (à l'avant, −z)
  const basket = new THREE.Group();
  basket.position.set(0, 0.05, -0.2);
  body.add(basket);
  box(basket, 0.76, 0.05, 0.95, RED, 0, -0.1, 0);
  for (const sx of [-0.37, 0.37]) {
    box(basket, 0.05, 0.5, 0.95, RED, sx, 0.15, 0, true);
    box(basket, 0.05, 0.05, 0.95, CHROME, sx, 0.42, 0);
  }
  box(basket, 0.76, 0.5, 0.05, RED, 0, 0.15, -0.47);
  box(basket, 0.76, 0.05, 0.05, CHROME, 0, 0.42, -0.47);
  for (let i = -2; i <= 2; i++) {
    box(basket, 0.02, 0.45, 0.06, 0xffffff, i * 0.15, 0.15, -0.5, false);
    box(basket, 0.06, 0.45, 0.02, 0xffffff, i === 0 ? 0 : 0.4 * Math.sign(i), 0.15, i * 0.15, false);
  }
  // bande de course
  box(basket, 0.2, 0.01, 0.97, 0xffffff, 0, -0.07, 0, false);

  // poignée (à l'arrière, +z) et spoiler absurde
  box(body, 0.05, 0.5, 0.05, CHROME, -0.34, 0.25, 0.5);
  box(body, 0.05, 0.5, 0.05, CHROME, 0.34, 0.25, 0.5);
  box(body, 0.8, 0.06, 0.07, 0x222222, 0, 0.52, 0.5);
  box(body, 0.78, 0.04, 0.22, 0xffd600, 0, 0.62, 0.62);
  box(body, 0.05, 0.14, 0.05, 0x222222, -0.3, 0.54, 0.62);
  box(body, 0.05, 0.14, 0.05, 0x222222, 0.3, 0.54, 0.62);

  // phares (le caddie voit la nuit)
  for (const sx of [-0.25, 0.25]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff59d }));
    l.position.set(sx, 0.1, -0.7);
    body.add(l);
  }
  // klaxon : petite trompette rouge sur le panier
  const horn = mesh(body, new THREE.ConeGeometry(0.1, 0.22, 10).rotateX(-Math.PI / 2), 0xffd600, 0.0, 0.5, -0.65);

  // tuyaux de turbo + flammes
  const flames: THREE.Mesh[] = [];
  for (const sx of [-0.18, 0.18]) {
    mesh(body, new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10).rotateX(Math.PI / 2), 0x555a66, sx, 0.05, 0.78);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.8, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff9a1a }));
    f.position.set(sx, 0.05, 1.2);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  // roues
  const tireGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12).rotateZ(Math.PI / 2);
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z, front] of [[-0.33, -0.48, true], [0.33, -0.48, true], [-0.33, 0.5, false], [0.33, 0.5, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.24, z);
    const spin = new THREE.Group();
    spin.add(outlined(new THREE.Mesh(tireGeo, toon(0x2b2b33)), 0.03));
    spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.2), toon(0xe0e0e8)));
    pivot.add(spin);
    body.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  let t = 0;
  return {
    group,
    update(s, dt) {
      t += dt;
      const turbo = s.a[0] > 0.5;
      for (const w of wheels) {
        w.spin.rotation.x -= (s.sp * dt) / 0.16;
        // roues folles : les roues avant de caddie ne sont jamais droites
        if (w.front) w.pivot.rotation.y = s.st * 0.5 + Math.sin(t * 9 + w.pivot.position.x * 20) * 0.1 * Math.min(1, Math.abs(s.sp) / 8);
      }
      for (const f of flames) {
        f.visible = turbo;
        if (turbo) f.scale.set(1, 1, 0.7 + Math.random() * 0.8);
      }
      // le caddie vibre quand il va vite, penche en dérapage, la trompette gonfle au klaxon
      const v = Math.min(1, Math.abs(s.sp) / 20);
      body.position.y = Math.sin(t * 40) * 0.012 * v;
      body.rotation.z = -s.st * 0.12 * v - (s.a[1] > 0.5 ? s.st * 0.12 : 0);
      body.rotation.x = turbo ? 0.06 : 0;
      horn.scale.setScalar(1 + (s.a[2] ?? 0) * 0.7);
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le caddie turbo',
  enterRadius: 4,
  build,
  cam: { height: 1.2, distance: 5.2, pitch: -0.25 },
  hud: (s, L) => `Caddie turbo · ${Math.round(Math.abs(s.sp) * 3.6)} km/h${s.a[0] > 0.5 ? ' · TURBO !' : s.a[3] > 0 ? ` · turbo en recharge` : ' · turbo prêt'}\n${L('forward')}/${L('back')} : accélérer · ${L('left')}/${L('right')} : tourner · Espace : dérapage · Clic gauche : bip-bip · Clic droit : turbo · ${L('interact')} : descendre`,
  engine: { base: 70, speedK: 3.2, osc1: 'square', osc2: 'triangle', cutoff: 700, level: 0.11 },
};
