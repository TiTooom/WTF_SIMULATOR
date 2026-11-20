import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

// Avion de chasse : a = [train 0..1, gaz 0..1, roulis, tangage, lacet, missile prêt, au sol]
function build(): VehicleView {
  const group = new THREE.Group();
  const STEEL = 0x8a94a6, RED = 0xe74c3c, DARK = 0x3a3f4b;
  const mesh = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, ol = 0.05) => {
    const m = outlined(new THREE.Mesh(geo, toon(color)), ol);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // fuselage + nez + verrière
  mesh(new THREE.CylinderGeometry(0.65, 0.55, 6.6, 14).rotateX(Math.PI / 2), STEEL, 0, 0, 0.3);
  mesh(new THREE.ConeGeometry(0.65, 2.2, 14).rotateX(-Math.PI / 2), STEEL, 0, 0, -4.0);
  mesh(new THREE.SphereGeometry(0.5, 12, 10).scale(0.9, 0.8, 2.0), 0x4fb3ff, 0, 0.55, -1.2);
  mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.7, 14).rotateX(Math.PI / 2), RED, 0, 0, 1.2); // bande rouge
  mesh(new THREE.CylinderGeometry(0.58, 0.45, 0.8, 12).rotateX(Math.PI / 2), DARK, 0, 0, 3.9); // tuyère
  // entrées d'air
  box(group, 0.4, 0.5, 1.4, DARK, -0.8, -0.1, -1.2);
  box(group, 0.4, 0.5, 1.4, DARK, 0.8, -0.1, -1.2);
  // ailes en flèche + bouts rouges + aérofreins/ailerons
  const ailerons: THREE.Mesh[] = [];
  for (const sd of [-1, 1]) {
    const wing = box(group, 3.8, 0.14, 2.6, STEEL, sd * 2.4, -0.15, 1.1);
    wing.rotation.y = sd * 0.5;
    wing.position.set(sd * 2.1, -0.15, 0.9);
    const tip = box(group, 0.3, 0.16, 1.8, RED, sd * 3.95, -0.15, 1.7);
    tip.rotation.y = 0;
    const ail = box(group, 1.6, 0.08, 0.5, RED, sd * 3.1, -0.15, 2.2);
    ailerons.push(ail);
    box(group, 1.1, 0.1, 0.9, STEEL, sd * 1.1, 0.1, 3.8).rotation.y = sd * 0.3; // stabilisateur
    // missile sous l'aile
    const ms = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8).rotateX(Math.PI / 2), 0xe8e8ee, sd * 2.1, -0.4, 0.2, 0.03);
    ms.userData.missile = true;
  }
  const fin = box(group, 0.14, 1.5, 1.4, STEEL, 0, 1.2, 3.4);
  fin.rotation.x = -0.25;
  box(group, 0.16, 0.7, 0.7, RED, 0, 1.55, 3.55).rotation.x = -0.25;
  const rudder = box(group, 0.1, 1.1, 0.4, RED, 0, 1.2, 4.2);

  // flamme de postcombustion
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 10).rotateX(Math.PI / 2).translate(0, 0, 1.2), new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 8).rotateX(Math.PI / 2).translate(0, 0, 0.8), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
  flame.add(outer, inner);
  flame.position.set(0, 0, 4.3);
  group.add(flame);

  // train d'atterrissage : un pivot par jambe, rangé = replié dans le fuselage
  const gears: THREE.Group[] = [];
  for (const [gx, gz] of [[0, -2.6], [-1.3, 0.9], [1.3, 0.9]]) {
    const g = new THREE.Group();
    g.position.set(gx, -0.3, gz);
    const strut = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), toon(0xc8ccd6)), 0.03);
    strut.position.y = -0.2;
    const wheel = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12).rotateZ(Math.PI / 2), toon(0x25252d)), 0.04);
    wheel.position.y = -0.45;
    g.add(strut, wheel);
    group.add(g);
    gears.push(g);
  }
  return {
    group,
    update(s) {
      const [gear = 1, thr = 0, roll = 0, pitch = 0, yaw = 0, ready = 1] = s.a;
      for (const g of gears) {
        g.scale.setScalar(Math.max(0.001, gear));
        g.position.y = -0.3 + (1 - gear) * 0.3;
        g.visible = gear > 0.05;
      }
      ailerons[0].rotation.x = roll * 0.5;
      ailerons[1].rotation.x = -roll * 0.5;
      rudder.rotation.y = -yaw * 0.4 + pitch * 0;
      const f = 0.25 + thr * 1.2 + (Math.random() - 0.5) * 0.15 * thr;
      flame.scale.set(0.6 + thr * 0.5, 0.6 + thr * 0.5, f);
      flame.visible = thr > 0.03;
      outer.material.color.setHex(thr > 0.8 ? 0xff5a1f : 0xff8a1f);
      group.traverse((o) => { if (o.userData.missile) o.visible = ready > 0.99; });
    },
  };
}

export const view: VehicleViewDef = {
  name: "l'avion de chasse",
  enterRadius: 7,
  build,
  cam: { height: 3.2, distance: 20, pitch: -0.14 },
  hud: (s, L) => `Avion de chasse · ${Math.round(Math.abs(s.sp) * 3.6)} km/h · gaz ${Math.round((s.a[1] ?? 0) * 100)} % · train ${(s.a[0] ?? 1) > 0.5 ? 'sorti' : 'rentré'}\n${L('forward')}/${L('back')} : piquer/cabrer · ${L('left')}/${L('right')} : roulis · Maj/Ctrl : gaz · ${L('horn')} : train · Clic G : mitrailleuse · Clic D : missile${(s.a[5] ?? 1) < 1 ? ' (recharge)' : ''} · ${L('interact')} : descendre`,
  engine: { base: 52, speedK: 2.0, level: 0.22, cutoff: 900, cutoffK: 14 },
};
