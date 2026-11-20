import * as THREE from 'three';
import { box, canvasTexture, outlined, toon, toonRaw } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

function build(): VehicleView {
  const group = new THREE.Group();
  const RED = 0xd8353a, CREAM = 0xf6e7c1, WOOD = 0x8a5a2f;

  // ballon rayé (méridiens rouge / crème), long axe = z
  const balloon = new THREE.Group();
  balloon.position.y = 1.6;
  group.add(balloon);
  const tex = canvasTexture([256, 8], (g) => {
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#f6e7c1' : '#d8353a'; g.fillRect((i * 256) / 12, 0, 256 / 12 + 1, 8); }
  }, [1, 1]);
  const geo = new THREE.SphereGeometry(1, 36, 20).rotateX(Math.PI / 2);
  const env = new THREE.Mesh(geo, toonRaw({ map: tex }));
  env.scale.set(1.75, 1.75, 4.5);
  outlined(env, 0.05);
  balloon.add(env);
  // ailerons de queue
  const finH = box(balloon, 3.4, 0.14, 1.5, RED, 0, 0, 4.0);
  const finV = box(balloon, 0.14, 3.4, 1.5, RED, 0, 0, 4.0);
  void finH; void finV;
  // hélice arrière entraînée par les pédales
  const prop = new THREE.Group();
  prop.position.set(0, 0, 4.75);
  prop.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), toon(0x333333)));
  for (let i = 0; i < 2; i++) {
    const bl = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.06), toon(0xf2b84b)), 0.03);
    bl.rotation.z = i * Math.PI / 2;
    prop.add(bl);
  }
  balloon.add(prop);
  // gouvernail-moustache : petit drapeau sur le nez
  const flag = box(balloon, 0.04, 0.5, 0.8, 0xffe066, 0, 1.95, -3.7);
  void flag;

  // nacelle en bois
  const gon = new THREE.Group();
  gon.position.y = -0.6;
  group.add(gon);
  box(gon, 2.0, 0.12, 2.6, WOOD, 0, -0.45, 0);
  box(gon, 2.0, 0.55, 0.12, WOOD, 0, -0.15, -1.25);
  box(gon, 2.0, 0.55, 0.12, WOOD, 0, -0.15, 1.25);
  box(gon, 0.12, 0.55, 2.6, WOOD, -0.94, -0.15, 0);
  box(gon, 0.12, 0.55, 2.6, WOOD, 0.94, -0.15, 0);
  box(gon, 2.12, 0.1, 0.2, 0xb27a43, 0, 0.14, -1.25);
  box(gon, 2.12, 0.1, 0.2, 0xb27a43, 0, 0.14, 1.25);
  // cordages
  for (const sx of [-0.9, 0.9]) for (const sz of [-1.2, 1.2]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 5), toon(0x2b2b35));
    r.position.set(sx * 0.95, 0.5, sz * 0.95);
    gon.add(r);
  }
  // vélo : roues, cadre, pédalier animé
  const wheelGeo = new THREE.TorusGeometry(0.38, 0.05, 8, 20).rotateY(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  for (const z of [-0.75, 0.6]) {
    const w = outlined(new THREE.Mesh(wheelGeo, toon(0x25252d)), 0.02);
    w.position.set(0, -0.0, z);
    gon.add(w);
    wheels.push(w);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.72, 0.03), toon(0xcccccc));
    w.add(spoke);
    const spoke2 = spoke.clone();
    spoke2.rotation.x = Math.PI / 2;
    w.add(spoke2);
  }
  const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, r = 0.04) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), toon(col));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    gon.add(m);
  };
  bar(0, 0, -0.75, 0, 0.3, -0.5, 0xe74c3c); // fourche
  bar(0, 0.3, -0.5, 0, 0.3, 0.3, 0xe74c3c); // tube supérieur
  bar(0, 0.3, 0.3, 0, 0, 0.6, 0xe74c3c);
  bar(0, 0.3, -0.5, 0, -0.05, 0, 0xe74c3c);
  bar(0, -0.05, 0, 0, 0.3, 0.3, 0xe74c3c);
  bar(0, 0.3, -0.5, 0, 0.5, -0.55, 0x333333);
  box(gon, 0.5, 0.06, 0.2, 0x333333, 0, 0.52, -0.58, false); // guidon
  box(gon, 0.15, 0.06, 0.4, 0x222222, 0, 0.36, 0.35); // selle
  const crank = new THREE.Group();
  crank.position.set(0, -0.05, 0);
  const arm = box(crank, 0.06, 0.5, 0.06, 0xbbbbbb, 0, 0, 0, false);
  void arm;
  const pedA = box(crank, 0.28, 0.05, 0.14, 0x222222, 0.14, 0.25, 0);
  const pedB = box(crank, 0.28, 0.05, 0.14, 0x222222, -0.14, -0.25, 0);
  gon.add(crank);
  // trompette en laiton sur le côté
  const horn = new THREE.Group();
  horn.position.set(1.05, 0.0, -0.9);
  const hornBell = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 12).rotateX(-Math.PI / 2), toon(0xf2b84b)), 0.03);
  hornBell.position.z = -0.4;
  const hornTube = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), toon(0xd99a2b));
  hornTube.position.z = 0.25;
  horn.add(hornBell, hornTube);
  gon.add(horn);
  // sacs de lest (visibles quand le lest est prêt)
  const sacks = new THREE.Group();
  for (const sx of [-1.25, 1.25]) {
    const sk = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), toon(0xc9a26b)), 0.03);
    sk.scale.y = 1.2;
    sk.position.set(sx, -0.45, 0.5);
    sacks.add(sk);
  }
  gon.add(sacks);

  let phase = 0;
  let spin = 0;
  let tt = 0;
  return {
    group,
    update(s, dt) {
      tt += dt;
      const cad = s.a[0] ?? 0;
      const leak = s.a[1] ?? 0;
      phase += dt * (cad * Math.PI + 0.6);
      crank.rotation.x = phase;
      pedA.rotation.x = pedB.rotation.x = -phase;
      for (const w of wheels) w.rotation.x = phase * 2;
      spin += dt * (3 + Math.abs(s.sp) * 3 + cad * 4);
      prop.rotation.z = spin;
      sacks.visible = (s.a[2] ?? 0) >= 1;
      const toot = (s.a[3] ?? 0) > 0.5;
      horn.scale.setScalar(toot ? 1.2 + Math.sin(tt * 60) * 0.1 : 1);
      // ballon qui se dégonfle : s'aplatit et ballotte
      const sag = leak * 0.28;
      env.scale.set(1.75 * (1 + sag * 0.2), 1.75 * (1 - sag), 4.5 * (1 - sag * 0.15));
      balloon.position.y = 1.6 - sag * 1.75;
      balloon.rotation.z = (s.a[4] ?? 0) * 0.6 + (leak ? Math.sin(tt * 5) * 0.05 * leak : 0);
      gon.rotation.z = Math.sin(tt * 1.2) * 0.03;
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le dirigeable à pédales',
  enterRadius: 6,
  build,
  cam: { height: 2.5, distance: 16, pitch: -0.2 },
  hud: (s, L) =>
    `Dirigeable à pédales · ${Math.round(Math.abs(s.sp) * 3.6)} km/h · altitude ${Math.round(s.p[1])} m${(s.a[1] ?? 0) > 0 ? ' · FUITE ! pfffff' : ''}\n`
    + `Martèle ${L('forward')} pour pédaler (plus vite = plus rapide) · ${L('left')}/${L('right')} : virer · ${L('throttleUp')}/${L('throttleDown')} : monter/descendre\n`
    + `Clic gauche : lâcher du lest${(s.a[2] ?? 1) < 1 ? ' (recharge…)' : ''} · Clic droit : trompette · ${L('interact')} : descendre`,
  engine: { base: 40, speedK: 1, silent: true, level: 0.05 },
};
