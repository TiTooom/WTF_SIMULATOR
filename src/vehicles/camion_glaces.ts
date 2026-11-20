import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

const PINK = 0xff8fc8;
const WHITE = 0xfaf6f2;
const DISCO = [0xff4fa3, 0x4fd8ff, 0xffe14f, 0x7dff4f, 0xb04fff];

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = true) {
  const m = new THREE.Mesh(geo, toon(color));
  m.position.set(x, y, z);
  if (outline) outlined(m, 0.04);
  parent.add(m);
  return m;
}

function build(): VehicleView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // châssis rose, caisse blanche, cabine
  box(body, 1.9, 0.5, 4.0, PINK, 0, -0.5, 0);
  box(body, 1.9, 1.3, 2.7, WHITE, 0, 0.4, 0.65); // caisse frigorifique
  box(body, 1.85, 0.9, 1.2, WHITE, 0, 0.2, -1.4); // cabine
  box(body, 1.6, 0.5, 0.06, 0x6ec6ff, 0, 0.45, -2.0, false); // pare-brise
  box(body, 0.06, 0.45, 0.8, 0x6ec6ff, -0.93, 0.45, -1.4, false);
  box(body, 0.06, 0.45, 0.8, 0x6ec6ff, 0.93, 0.45, -1.4, false);
  box(body, 1.92, 0.12, 2.75, PINK, 0, 1.08, 0.65); // toit rose
  box(body, 1.92, 0.12, 1.25, PINK, 0, 0.7, -1.4);
  box(body, 2.0, 0.22, 0.18, 0xdddddd, 0, -0.6, -2.08); // pare-chocs
  box(body, 2.0, 0.22, 0.18, 0xdddddd, 0, -0.6, 2.08);
  for (const sx of [-0.7, 0.7]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }));
    l.position.set(sx, -0.2, -2.04);
    body.add(l);
    box(body, 0.3, 0.14, 0.06, 0xff3030, sx, -0.2, 2.05, false);
  }

  // guichet côté droit avec auvent rayé
  box(body, 0.05, 0.6, 1.2, 0x2d2020, 0.97, 0.5, 0.65, false);
  for (let i = 0; i < 6; i++) box(body, 0.6, 0.06, 0.2, i % 2 ? WHITE : PINK, 1.2, 0.95, 0.1 + i * 0.2);
  box(body, 0.5, 0.05, 1.3, 0xdddddd, 1.15, 0.2, 0.65); // comptoir
  // grosses glaces peintes sur le flanc gauche
  mesh(body, new THREE.SphereGeometry(0.28, 12, 8), PINK, -0.97, 0.45, 0.65, false);
  mesh(body, new THREE.ConeGeometry(0.2, 0.5, 10).rotateX(Math.PI), 0xffc94d, -0.97, 0.05, 0.65, false);

  // enceintes de toit + gyrophares disco
  box(body, 0.4, 0.3, 0.4, 0x333340, -0.7, 1.3, 1.5);
  box(body, 0.4, 0.3, 0.4, 0x333340, 0.7, 1.3, 1.5);
  const lights: THREE.MeshBasicMaterial[] = [];
  for (const [x, z] of [[-0.7, -0.2], [0.7, -0.2], [-0.7, 1.9], [0.7, 1.9]] as const) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x555566 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
    m.position.set(x, 1.2, z);
    body.add(m);
    lights.push(mat);
  }

  // cornet géant qui tourne
  const cone = new THREE.Group();
  cone.position.set(0, 1.15, 0.65);
  cone.scale.setScalar(0.9);
  mesh(cone, new THREE.ConeGeometry(0.55, 1.4, 14).rotateX(Math.PI), 0xffc94d, 0, 0.7, 0); // pointe en bas
  for (let i = 0; i < 4; i++) box(cone, 0.9, 0.04, 0.04, 0xd89a2a, 0, 0.45 + i * 0.22, 0.0, false).rotation.y = i * 0.8;
  mesh(cone, new THREE.SphereGeometry(0.62, 16, 12), PINK, 0, 1.55, 0);
  mesh(cone, new THREE.SphereGeometry(0.48, 16, 12), WHITE, 0, 2.15, 0);
  mesh(cone, new THREE.SphereGeometry(0.12, 10, 8), 0xe53935, 0, 2.7, 0);
  // gouttes de crème sur la boule du bas
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    mesh(cone, new THREE.SphereGeometry(0.1, 8, 6), PINK, Math.cos(a) * 0.6, 1.2, Math.sin(a) * 0.6, false);
  }
  body.add(cone);

  // roues
  const tireGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.36, 16).rotateZ(Math.PI / 2);
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z, front] of [[-1.0, -1.35, true], [1.0, -1.35, true], [-1.0, 1.4, false], [1.0, 1.4, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.35, z);
    const spin = new THREE.Group();
    spin.add(outlined(new THREE.Mesh(tireGeo, toon(0x26262e)), 0.04));
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.38, 8).rotateZ(Math.PI / 2), toon(PINK)));
    spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.5), toon(0xffffff)));
    pivot.add(spin);
    body.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  let t = 0;
  return {
    group,
    update(s, dt) {
      t += dt;
      const music = s.a[0] > 0.5, disco = s.a[1] > 0.5;
      for (const w of wheels) {
        w.spin.rotation.x -= (s.sp * dt) / 0.45;
        if (w.front) w.pivot.rotation.y = s.st * 0.4;
      }
      cone.rotation.y += dt * (disco ? 7 : music ? 2.5 : 1.2);
      // le cornet se balance (il est trop grand) ; la caisse danse en mode disco
      cone.rotation.z = Math.sin(t * 2.2) * 0.04 + Math.sin(t * 9) * (disco ? 0.07 : 0);
      body.position.y = disco ? Math.abs(Math.sin(t * Math.PI * 2)) * 0.08 : 0;
      body.scale.y = 1 + (s.a[2] ?? 0) * 0.05 - (disco ? Math.abs(Math.sin(t * Math.PI * 2)) * 0.02 : 0);
      lights.forEach((m, i) => m.color.setHex(disco ? DISCO[(Math.floor(s.a[3] ?? 0) + i) % DISCO.length] : music ? 0xffd966 : 0x555566));
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le camion de glaces',
  enterRadius: 5,
  build,
  cam: { height: 2.4, distance: 10, pitch: -0.22 },
  hud: (s, L) => `Camion de glaces · ${Math.round(Math.abs(s.sp) * 3.6)} km/h${s.a[1] > 0.5 ? ' · MODE DISCO !' : s.a[0] > 0.5 ? ' · ♪' : ''}\n${L('forward')}/${L('back')} : avancer · ${L('left')}/${L('right')} : tourner · ${L('horn')} : musique · Clic gauche : cornet · Clic droit : mode disco · ${L('interact')} : descendre`,
  engine: { base: 44, speedK: 3.8, level: 0.14, cutoff: 360 },
};
