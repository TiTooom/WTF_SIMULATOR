import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

function lamp(parent: THREE.Object3D, color: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.08), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  parent.add(m);
}

function build(): VehicleView {
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

export const view: VehicleViewDef = {
  name: 'la citadine',
  enterRadius: 5,
  build,
  cam: { height: 1.6, distance: 8.5, pitch: -0.22 },
  hud: (s, L) => `Citadine · ${Math.round(Math.abs(s.sp) * 3.6)} km/h\n${L('forward')}/${L('back')} : accélérer · ${L('left')}/${L('right')} : tourner · ${L('horn')} : klaxon · Molette : zoom · ${L('interact')} : descendre`,
  engine: { base: 38, speedK: 4.4, level: 0.16 },
};
