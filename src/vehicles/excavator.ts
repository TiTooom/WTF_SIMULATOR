import * as THREE from 'three';
import { EXC } from '../../shared/constants';
import { box, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

function build(): VehicleView {
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
      turret.rotation.y = s.a[0] ?? 0;
      boomPivot.rotation.x = s.a[1] ?? 0;
      stickPivot.rotation.x = s.a[2] ?? 0;
      bucketPivot.rotation.x = s.a[3] ?? 0;
      for (const g of sprockets) g.rotation.x -= (s.sp * dt) / 0.45;
    },
  };
}

export const view: VehicleViewDef = {
  name: 'la pelleteuse',
  enterRadius: 7,
  build,
  cam: { height: 3.5, distance: 17, pitch: -0.3 },
  hud: (_s, L) =>
    `Pelleteuse · ${L('forward')}/${L('back')} : avancer · ${L('left')}/${L('right')} : tourner · Molette : zoom · ${L('interact')} : descendre\n`
    + `${L('swingLeft')}/${L('swingRight')} : cabine · ${L('boomUp')}/${L('boomDown')} : flèche · `
    + `${L('stickOut')}/${L('stickIn')} : bras · ${L('bucketCurl')}/${L('bucketDump')} : godet`,
  engine: { base: 28, speedK: 6, osc2: 'sawtooth', level: 0.22, hydro: true },
};
