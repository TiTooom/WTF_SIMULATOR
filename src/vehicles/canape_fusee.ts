import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

function build(): VehicleView {
  const group = new THREE.Group();
  const sofa = new THREE.Group(); // squash & stretch
  group.add(sofa);
  const WINE = 0x7a1530, WINE2 = 0x93203f, YEL = 0xffd23f;
  box(sofa, 2.4, 0.45, 1.1, WINE, 0, -0.3, 0); // assise
  box(sofa, 2.4, 0.75, 0.32, WINE2, 0, 0.12, 0.4); // dossier
  box(sofa, 0.32, 0.62, 1.1, WINE2, -1.04, -0.02, 0); // accoudoirs
  box(sofa, 0.32, 0.62, 1.1, WINE2, 1.04, -0.02, 0);
  for (const sx of [-1, 1]) box(sofa, 0.36, 0.1, 1.14, 0xc9a24a, sx * 1.04, 0.3, 0); // galons dorés
  // coussins jaunes
  box(sofa, 0.95, 0.2, 0.7, YEL, -0.5, -0.0, -0.12);
  box(sofa, 0.95, 0.2, 0.7, YEL, 0.5, -0.0, -0.12);
  const b1 = box(sofa, 0.85, 0.55, 0.2, YEL, -0.5, 0.3, 0.12);
  const b2 = box(sofa, 0.85, 0.55, 0.2, YEL, 0.5, 0.3, 0.12);
  b1.rotation.x = b2.rotation.x = -0.25;
  // boutons capitonnés
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), toon(0x3a0a18));
    m.position.set(-1 + i * 0.4, 0.25, 0.25);
    sofa.add(m);
  }
  // pieds en bois
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sofa, 0.16, 0.16, 0.16, 0x6b4423, sx * 1.0, -0.52, sz * 0.4);

  // boosters gris + flammes animées
  const flames: THREE.Mesh[] = [];
  const flameMats: THREE.MeshBasicMaterial[] = [];
  for (const sx of [-0.7, 0.7]) {
    const tube = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 12).rotateX(Math.PI / 2), toon(0x9aa3ad)), 0.04);
    tube.position.set(sx, -0.1, 0.95);
    sofa.add(tube);
    const nose = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 12).rotateX(-Math.PI / 2), toon(0xe74c3c)), 0.03);
    nose.position.set(sx, -0.1, 0.2);
    sofa.add(nose);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.2, 12).rotateX(Math.PI / 2), toon(0x4a5058));
    nozzle.position.set(sx, -0.1, 1.55);
    sofa.add(nozzle);
    for (const [col, len, w] of [[0xff7a1a, 1, 0.3], [0xffe066, 0.6, 0.18]] as const) {
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 });
      const f = new THREE.Mesh(new THREE.ConeGeometry(w, len, 10).rotateX(Math.PI / 2), m);
      f.userData = { len, sx };
      f.position.set(sx, -0.1, 1.65);
      sofa.add(f);
      flames.push(f);
      flameMats.push(m);
    }
  }
  return {
    group,
    update(s) {
      sofa.rotation.x = s.a[0] ?? 0;
      sofa.rotation.z = s.a[1] ?? 0;
      const coil = s.a[4] ?? 0;
      sofa.scale.set(1 + coil * 0.12, 1 - coil * 0.3, 1 + coil * 0.12);
      sofa.position.y = -coil * 0.12;
      const boost = (s.a[2] ?? 0) > 0.5;
      const thrust = Math.max(s.a[3] ?? 0, 0.12);
      for (const f of flames) {
        const l0 = f.userData.len as number;
        const k = (0.4 + thrust * 1.4 + (boost ? 2.2 : 0)) * (0.85 + Math.random() * 0.3);
        f.scale.set(1, 1, k);
        f.position.z = 1.65 + (l0 * k) / 2;
      }
      flameMats[0].color.setHex(boost ? 0x66ccff : 0xff7a1a);
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le canapé-fusée',
  enterRadius: 5,
  build,
  cam: { height: 1.4, distance: 8, pitch: -0.25 },
  hud: (s, L) =>
    `Canapé-fusée · ${Math.round(Math.abs(s.sp) * 3.6)} km/h · altitude ${Math.round(s.p[1])} m\n${L('forward')} : propulsion · ${L('left')}/${L('right')} : tourner · ${L('jump')} : saut ressort · ${L('throttleUp')}/${L('throttleDown')} : monter/descendre\n`
    + `Clic gauche : lancer un coussin · Clic droit : turbo${(s.a[5] ?? 1) < 1 ? ' (recharge…)' : ''} · ${L('interact')} : descendre`,
  engine: { base: 70, speedK: 2.5, osc1: 'sawtooth', osc2: 'square', cutoff: 700, cutoffK: 30, level: 0.14 },
};
