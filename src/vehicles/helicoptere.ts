import * as THREE from 'three';
import { box, outlined, toon } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

// Hélicoptère : a = [puissance, tangage visé, roulis visé, accroché, charge x, y, z]
function build(): VehicleView {
  const group = new THREE.Group();
  const YEL = 0xffc61a, RED = 0xe63232, BLACK = 0x15151c;
  const mesh = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ol = 0.05) => {
    const m = outlined(new THREE.Mesh(geo, toon(color)), ol);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  mesh(new THREE.SphereGeometry(1, 16, 12).scale(1.2, 1.0, 2.0), YEL, 0, 0.1, -1.0); // cabine
  mesh(new THREE.SphereGeometry(1, 14, 10).scale(1.0, 0.7, 1.0), BLACK, 0, 0.35, -2.2, 0.03); // vitres
  box(group, 0.5, 0.5, 4.2, YEL, 0, 0.55, 2.4); // poutre de queue
  box(group, 0.2, 1.4, 0.9, RED, 0, 1.2, 4.3).rotation.x = -0.3; // dérive
  box(group, 2.2, 0.1, 0.5, YEL, 0, 0.7, 4.1);
  box(group, 0.9, 0.3, 0.9, RED, 0, 0.1, 0.1); // capot moteur
  box(group, 0.6, 0.5, 0.6, 0x555a66, 0, 1.1, -0.2); // mât
  // patins
  for (const sx of [-1.2, 1.2]) {
    box(group, 0.14, 0.12, 3.6, RED, sx, -1.15, -0.8);
    box(group, 0.1, 0.9, 0.1, 0x555a66, sx, -0.75, -1.8);
    box(group, 0.1, 0.9, 0.1, 0x555a66, sx, -0.75, 0.2);
  }
  // rotor principal (4 pales) et rotor de queue
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.45, -0.2);
  for (let i = 0; i < 4; i++) {
    const blade = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 3.6), toon(i % 2 ? 0x2b2b35 : 0x3a3a46)), 0.03);
    blade.position.z = -1.9;
    const arm = new THREE.Group();
    arm.rotation.y = (i * Math.PI) / 2;
    arm.add(blade);
    rotor.add(arm);
  }
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 8), toon(0xdddddd)));
  group.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(0.3, 1.3, 4.3);
  for (let i = 0; i < 2; i++) {
    const b = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.22), toon(0x2b2b35)), 0.02);
    b.rotation.x = i * Math.PI / 2;
    tail.add(b);
  }
  group.add(tail);
  // treuil : câble + crochet
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const hook = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), toon(0xd0d0d8)), 0.03);
  rope.visible = hook.visible = false;
  group.add(rope, hook);
  let ang = 0;
  const up = new THREE.Vector3(0, 1, 0);
  return {
    group,
    update(s, dt) {
      const [power = 0, , , hooked = 0, cx = 0, cy = -6, cz = 0] = s.a;
      ang += power * 38 * dt;
      rotor.rotation.y = ang;
      tail.rotation.x = ang * 1.6;
      if (hooked > 0.5) {
        const a = new THREE.Vector3(0, -1.3, 0), b = new THREE.Vector3(cx, cy + 0.9, cz);
        const d = b.clone().sub(a), len = Math.max(0.1, d.length());
        rope.visible = hook.visible = true;
        rope.scale.set(1, len, 1);
        rope.position.copy(a).addScaledVector(d, 0.5);
        rope.quaternion.setFromUnitVectors(up, d.normalize());
        hook.position.copy(b);
      } else rope.visible = hook.visible = false;
    },
  };
}

export const view: VehicleViewDef = {
  name: "l'hélicoptère",
  enterRadius: 7,
  build,
  cam: { height: 2.5, distance: 17, pitch: -0.28 },
  hud: (s, L) => `Hélicoptère · altitude ${Math.round(s.p[1])} m${(s.a[3] ?? 0) > 0.5 ? ' · charge accrochée' : ''}\nMaj/Ctrl : monter/descendre · ${L('forward')}/${L('back')} : avancer · ${L('left')}/${L('right')} : pencher · lacet : Z/C · Clic G : treuil · Clic D : larguer · ${L('interact')} : descendre`,
  engine: { base: 11, speedK: 0.9, osc1: 'square', osc2: 'square', ratio: 2, cutoff: 300, cutoffK: 12, level: 0.3 },
};
