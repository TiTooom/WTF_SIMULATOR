import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

const PORCELAIN = 0xf7f9fb;
const BLUE = 0x3b8de0;

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

  // piédestal + cuvette (avant = −z) + réservoir (arrière)
  box(body, 0.9, 0.5, 1.2, PORCELAIN, 0, -0.38, -0.05);
  mesh(body, new THREE.CylinderGeometry(0.52, 0.4, 0.5, 20), PORCELAIN, 0, 0.1, -0.3);
  const seat = mesh(body, new THREE.TorusGeometry(0.42, 0.09, 8, 24).rotateX(Math.PI / 2), 0x9fc8f5, 0, 0.38, -0.3);
  seat.scale.set(1, 1, 1.15);
  mesh(body, new THREE.CylinderGeometry(0.34, 0.34, 0.03, 18), 0x6ec6ff, 0, 0.28, -0.3, false); // eau
  box(body, 1.0, 0.9, 0.36, PORCELAIN, 0, 0.45, 0.55); // réservoir
  box(body, 1.06, 0.1, 0.42, 0xdfe6ee, 0, 0.95, 0.55);
  // bouton de chasse
  box(body, 0.14, 0.14, 0.1, 0xc9d1da, 0.25, 1.05, 0.55);
  // chasse d'eau cassée : petit tuyau qui goutte
  box(body, 0.1, 0.5, 0.1, 0xb0b8c4, -0.38, 0.2, 0.74);

  // couvercle bleu articulé derrière la cuvette
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.46, 0.18);
  const lid = mesh(lidPivot, new THREE.CylinderGeometry(0.46, 0.46, 0.07, 20), BLUE, 0, 0, -0.48);
  lid.scale.set(1, 1, 1.1);
  box(lidPivot, 0.3, 0.1, 0.12, 0x2569b0, 0, 0.0, -0.05);
  body.add(lidPivot);

  // ventouse à l'avant : manche + cuvette rouge, s'allonge quand elle aspire
  const plunger = new THREE.Group();
  plunger.position.set(0, 0.25, -0.85);
  const stick = mesh(plunger, new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8).rotateX(Math.PI / 2), 0xb98a54, 0, 0, -0.4);
  const cup = mesh(plunger, new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), 0xe53935, 0, 0, -0.82);
  body.add(plunger);

  // rouleau de papier toilette sur le réservoir (qui se déroule avec la vitesse)
  mesh(body, new THREE.CylinderGeometry(0.15, 0.15, 0.2, 12).rotateZ(Math.PI / 2), 0xffffff, -0.25, 1.08, 0.55);
  const paper = box(body, 0.2, 0.01, 0.6, 0xffffff, -0.25, 0.9, 0.9, false);

  // roulettes
  const tireGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12).rotateZ(Math.PI / 2);
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z, front] of [[-0.4, -0.5, true], [0.4, -0.5, true], [-0.4, 0.55, false], [0.4, 0.55, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.45, z);
    const spin = new THREE.Group();
    spin.add(outlined(new THREE.Mesh(tireGeo, toon(0x2b2b33)), 0.03));
    spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.26), toon(0xd8d8e0)));
    pivot.add(spin);
    box(pivot, 0.05, 0.14, 0.05, 0x8a8f99, 0, 0.12, 0, false);
    body.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  let t = 0;
  return {
    group,
    update(s, dt) {
      t += dt;
      for (const w of wheels) {
        w.spin.rotation.x -= (s.sp * dt) / 0.2;
        if (w.front) w.pivot.rotation.y = s.st * 0.5 + Math.sin(t * 6) * 0.05 * Math.min(1, Math.abs(s.sp));
      }
      const open = s.a[0] ?? 0;
      lidPivot.rotation.x = -open * 1.9 + Math.sin(t * 25) * 0.04 * (1 - open) * Math.min(1, Math.abs(s.sp) / 6); // claque en roulant
      const flush = (s.a[1] ?? 0) > 0.5;
      const suck = (s.a[3] ?? 0) > 0.5;
      body.rotation.x = flush ? 0.12 : 0;
      body.position.y = flush ? Math.sin(t * 50) * 0.02 : 0;
      plunger.position.z = -0.85 - (suck ? 0.35 + Math.sin(t * 12) * 0.1 : 0);
      stick.scale.z = suck ? 1.4 : 1;
      cup.scale.setScalar(suck ? 1.2 : 1);
      paper.scale.z = 1 + Math.abs(s.sp) * 0.15;
      paper.position.z = 0.6 + (paper.scale.z * 0.6) / 2;
    },
  };
}

export const view: VehicleViewDef = {
  name: 'les toilettes à roulettes',
  enterRadius: 4,
  build,
  cam: { height: 1.5, distance: 6.2, pitch: -0.25 },
  hud: (s, L) => `Toilettes à roulettes · ${Math.round(Math.abs(s.sp) * 3.6)} km/h${(s.a[1] ?? 0) > 0.5 ? ' · CHASSE D\'EAU !' : (s.a[3] ?? 0) > 0.5 ? ' · ventouse accrochée' : (s.a[2] ?? 0) > 0 ? ' · chasse en recharge' : ''}\n${L('forward')}/${L('back')} : rouler (lentement) · ${L('left')}/${L('right')} : tourner · Clic gauche maintenu : ventouse · Clic droit : chasse d'eau · ${L('interact')} : descendre`,
  engine: { base: 32, speedK: 4, osc1: 'sine', osc2: 'triangle', cutoff: 300, level: 0.12 },
};
