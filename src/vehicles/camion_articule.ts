// Vue du camion articulé. a = [angle remorque, benne 0..1, attelée, x, y, z de la remorque (repère cabine)]
import * as THREE from 'three';
import { box, canvasTexture, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

const RED = 0xd63a2f, DARK = 0x25252d, GLASS = 0x6ec6ff, WHITE = 0xf2f2f2;

function wheel(parent: THREE.Object3D, x: number, y: number, z: number, r: number, w = 0.45) {
  const spin = new THREE.Group();
  spin.position.set(x, y, z);
  spin.add(outlined(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), toon(0x1f1f26)), 0.04),
    new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.03, 8).rotateZ(Math.PI / 2), toon(0xdddddd)),
    new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.1, r * 1.4), toon(0xaaaab2)));
  parent.add(spin);
  return spin;
}

function potatoLogo() {
  return canvasTexture([256, 128], (g) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#c99a5b'; g.strokeStyle = '#1b1b2b'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(70, 64, 52, 38, -0.3, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1b1b2b';
    g.beginPath(); g.arc(55, 55, 5, 0, 7); g.arc(82, 50, 5, 0, 7); g.fill();
    g.lineWidth = 4; g.beginPath(); g.arc(68, 72, 14, 0.2, Math.PI - 0.2); g.stroke();
    g.font = 'bold 40px sans-serif'; g.fillStyle = '#d63a2f'; g.strokeStyle = '#1b1b2b'; g.lineWidth = 5;
    g.strokeText('PATATES', 135, 58); g.fillText('PATATES', 135, 58);
    g.font = 'bold 26px sans-serif'; g.fillStyle = '#1b1b2b'; g.fillText('Frites Express', 135, 95);
  }, [1, 1]);
}

function build(): VehicleView {
  const group = new THREE.Group();
  const spins: THREE.Group[] = [];
  // Cabine (origine = centre du corps physique, sol à y = -0.75)
  box(group, 2.3, 0.4, 3.6, DARK, 0, -0.3, 0.1);
  box(group, 2.3, 1.0, 1.1, RED, 0, 0.2, -1.1); // capot
  box(group, 1.6, 0.5, 0.06, 0xbfc3c9, 0, 0.2, -1.67, false); // calandre
  box(group, 2.4, 0.25, 0.2, 0xbfc3c9, 0, -0.35, -1.75); // pare-chocs
  box(group, 2.4, 1.9, 1.7, RED, 0, 0.7, 0.55); // cabine
  box(group, 2.0, 0.8, 0.06, GLASS, 0, 1.05, -0.32, false);
  box(group, 0.06, 0.7, 1.1, GLASS, -1.2, 1.05, 0.5, false);
  box(group, 0.06, 0.7, 1.1, GLASS, 1.2, 1.05, 0.5, false);
  box(group, 2.2, 0.5, 1.2, RED, 0, 1.95, 0.6); // déflecteur
  for (const sx of [-0.8, 0.8]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.08), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }));
    l.position.set(sx, 0.1, -1.69);
    group.add(l);
    box(group, 0.15, 1.2, 0.15, 0xbfc3c9, sx * 1.4, 1.0, -0.5, false); // échappements
  }
  for (const sz of [-1.1, 0.9]) for (const sx of [-1.2, 1.2]) spins.push(wheel(group, sx, -0.15, sz, 0.6));
  box(group, 1.6, 0.15, 1.2, 0x555560, 0, -0.1, 1.9); // sellette d'attelage

  // Remorque
  const tr = new THREE.Group();
  group.add(tr);
  box(tr, 2.5, 0.5, 7.8, DARK, 0, -1.15, 0); // jupe / châssis
  const bedG = new THREE.Group(); // benne : pivote autour du bas arrière
  bedG.position.set(0, -0.9, 3.9);
  tr.add(bedG);
  box(bedG, 2.6, 2.2, 7.8, WHITE, 0, 1.1, -3.9);
  const tex = potatoLogo();
  for (const sx of [-1.31, 1.31]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.0), new THREE.MeshBasicMaterial({ map: tex }));
    p.position.set(sx, 1.1, -3.9);
    p.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    bedG.add(p);
  }
  box(bedG, 2.7, 0.15, 7.9, RED, 0, 2.2, -3.9); // toit rouge
  const door = new THREE.Group(); // hayon articulé en haut
  door.position.set(0, 2.15, 0.05);
  bedG.add(door);
  box(door, 2.4, 2.1, 0.12, 0xdfe3e8, 0, -1.05, 0);
  box(door, 1.9, 0.5, 0.05, 0xc99a5b, 0, -0.8, 0.08, false);
  for (const az of [2.6, 3.4]) for (const sx of [-1.2, 1.2]) spins.push(wheel(tr, sx, -0.9, az, 0.5));
  const legs = new THREE.Group(); // béquilles (visibles quand la remorque est larguée)
  legs.position.set(0, -1.1, -3.3);
  for (const sx of [-0.8, 0.8]) box(legs, 0.18, 0.8, 0.18, 0xe6b800, sx, -0.2, 0);
  tr.add(legs);
  const bar = box(tr, 0.3, 0.2, 0.9, 0x555560, 0, -0.65, -4.1, false);

  return {
    group,
    update(s, dt) {
      const a = s.a;
      tr.position.set(a[3] ?? 0, a[4] ?? 0.65, a[5] ?? 5.8);
      tr.rotation.y = a[0] ?? 0;
      const bed = a[1] ?? 0;
      bedG.rotation.x = bed * 0.42;
      door.rotation.x = -bed * 1.25;
      legs.visible = (a[2] ?? 1) < 0.5;
      bar.visible = !legs.visible;
      for (const w of spins) w.rotation.x -= (s.sp * dt) / 0.55;
    },
  };
}

export const view: VehicleViewDef = {
  name: 'le camion articulé',
  enterRadius: 6,
  build,
  cam: { height: 4.2, distance: 21, pitch: -0.28 },
  hud: (s, L) =>
    `Camion · ${Math.round(Math.abs(s.sp) * 3.6)} km/h · ${L('forward')}/${L('back')} : accélérer/freiner (freiner fort = tête-à-queue !) · ${L('left')}/${L('right')} : tourner · ${L('horn')} : klaxon\n`
    + `Clic gauche : larguer / rattacher la remorque · Clic droit : benne (6 caisses) · ${L('interact')} : descendre`,
  engine: { base: 32, speedK: 3.2, osc2: 'sawtooth', level: 0.2 },
};
