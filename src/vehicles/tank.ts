// Vue du tank. anim().a = [lacet tourelle, élévation canon, recul, chenille gauche (m), chenille droite (m)]
import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

const GREEN = 0x4f6b32, DGREEN = 0x3c5226, DARK = 0x26282e, YEL = 0xf1c40f, BLACK = 0x1c1c22;

function build(): VehicleView {
  const group = new THREE.Group();
  // Châssis
  box(group, 1.9, 0.55, 3.9, GREEN, 0, 0.15, 0);
  box(group, 1.9, 0.35, 0.9, DGREEN, 0, 0.0, -2.0); // glacis avant
  box(group, 1.6, 0.18, 1.0, DGREEN, 0, 0.45, 1.5); // moteur
  for (let i = 0; i < 6; i++) for (const sx of [-0.95, 0.95]) box(group, 0.1, 0.1, 0.1, YEL, sx, 0.3, -1.6 + i * 0.64, false); // rivets
  // Chenilles
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.72, 12).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.BoxGeometry(0.76, 0.1, 0.5);
  const wheels: THREE.Group[][] = [[], []];
  const ribs: THREE.Mesh[][] = [[], []];
  const N = 10;
  [-1.3, 1.3].forEach((sx, side) => {
    box(group, 0.72, 0.9, 4.1, DARK, sx, -0.05, 0);
    for (let k = 0; k < 5; k++) {
      const g = new THREE.Group();
      g.position.set(sx, -0.12, -1.6 + k * 0.8);
      g.add(outlined(new THREE.Mesh(wheelGeo, toon(0x5a5e68)), 0.03), new THREE.Mesh(hubGeo, toon(YEL)));
      group.add(g);
      wheels[side].push(g);
    }
    for (let i = 0; i < N; i++) { // dents de chenille qui défilent (haut et bas)
      ribs[side].push(box(group, 0.78, 0.12, 0.22, 0x15161a, sx, 0.42, 0, false));
      ribs[side].push(box(group, 0.78, 0.12, 0.22, 0x15161a, sx, -0.5, 0, false));
    }
  });
  // Tourelle
  const turret = new THREE.Group();
  turret.position.y = 0.95;
  group.add(turret);
  box(turret, 1.7, 0.5, 2.1, GREEN, 0, -0.1, 0.1);
  box(turret, 1.3, 0.3, 1.0, DGREEN, 0, 0.3, 0.5);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 12), toon(DGREEN));
  hatch.position.set(0.35, 0.5, 0.5);
  turret.add(outlined(hatch, 0.03));
  box(turret, 0.06, 0.7, 0.06, BLACK, -0.5, 0.65, 0.9, false); // antenne
  box(turret, 0.2, 0.15, 0.2, 0xe74c3c, -0.5, 1.02, 0.9, false);
  for (const sx of [-0.86, 0.86]) for (let i = 0; i < 3; i++) box(turret, 0.08, 0.08, 0.08, YEL, sx, 0.0, -0.5 + i * 0.5, false);
  // Canon (élévation autour de l'axe x)
  const gun = new THREE.Group();
  turret.add(gun);
  box(gun, 0.7, 0.55, 0.5, DGREEN, 0, 0, -0.95); // mantelet
  const barrel = new THREE.Group();
  gun.add(barrel);
  const tube = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.9, 12).rotateX(Math.PI / 2), toon(BLACK)), 0.03);
  tube.position.z = -1.55;
  barrel.add(tube);
  const foil = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12).rotateX(Math.PI / 2), toon(0xf4d03f)), 0.03); // bouchon de champagne
  foil.position.z = -2.5;
  barrel.add(foil);
  const cork = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 10).rotateX(Math.PI / 2), toon(0xc8a46a)), 0.02);
  cork.position.z = -2.68;
  barrel.add(cork);
  const mg = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8).rotateX(Math.PI / 2), toon(0x3a3a42)), 0.02);
  mg.position.set(0.3, -0.05, -1.5);
  gun.add(mg);

  return {
    group,
    update(s) {
      turret.rotation.y = s.a[0] ?? 0;
      gun.rotation.x = s.a[1] ?? 0;
      barrel.position.z = (s.a[2] ?? 0) * 0.5;
      for (let side = 0; side < 2; side++) {
        const ph = s.a[3 + side] ?? 0;
        for (const w of wheels[side]) w.rotation.x = -ph / 0.36;
        const span = 4.0;
        ribs[side].forEach((m, i) => {
          const top = i % 2 === 0;
          const idx = Math.floor(i / 2);
          m.position.z = ((((idx * (span / N)) + (top ? -ph : ph)) % span) + span) % span - span / 2;
        });
      }
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le tank',
  enterRadius: 6,
  build,
  cam: { height: 3.2, distance: 13, pitch: -0.3 },
  hud: (_s, L) =>
    `Tank · ${L('forward')}/${L('back')} : avancer · ${L('left')}/${L('right')} : pivoter · la tourelle suit la caméra · ${L('horn')} : klaxon · ${L('interact')} : descendre\n`
    + 'Clic gauche : obus (pschitt !) · Clic droit maintenu : mitrailleuse',
  engine: { base: 30, speedK: 4, osc2: 'sawtooth', level: 0.22 },
};
