import * as THREE from 'three';
import { outlined, toon, toonRaw } from '../gfx';
import type { VehicleView, VehicleViewDef } from './types';

function build(): VehicleView {
  const group = new THREE.Group();
  const tilt = new THREE.Group(); // s'incline dans le sens du déplacement
  group.add(tilt);

  // coque : profil de soucoupe tourné autour de l'axe vertical (centre du châssis = y 0, bas à -0.9)
  const prof = [[0, -0.9], [1.1, -0.9], [2.2, -0.7], [3, -0.3], [3, -0.1], [2.4, 0.05], [1.3, 0.12], [0, 0.12]].map(([r, y]) => new THREE.Vector2(r, y));
  const hull = outlined(new THREE.Mesh(new THREE.LatheGeometry(prof, 32), toon(0xcfd6de)), 0.06);
  tilt.add(hull);
  // bandeau sombre autour de la coque
  const band = new THREE.Mesh(new THREE.CylinderGeometry(3.02, 3.02, 0.16, 32, 1, true), toon(0x5a6573));
  band.position.y = -0.2;
  tilt.add(band);
  // dôme vert fluo
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    toonRaw({ color: 0x39ff14, emissive: 0x1fa80a, transparent: true, opacity: 0.72, depthWrite: false }),
  );
  dome.scale.y = 0.7;
  dome.position.y = 0.1;
  tilt.add(dome);
  // petit alien dans le dôme
  const alien = new THREE.Group();
  alien.position.y = 0.3;
  const head = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), toon(0x7be04a)), 0.03);
  head.scale.set(1, 1.15, 1);
  head.position.y = 0.35;
  alien.add(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0x101018 }));
    eye.scale.set(1, 1.5, 0.5);
    eye.position.set(sx * 0.17, 0.42, -0.36);
    alien.add(eye);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), toon(0x333333));
    ant.position.set(sx * 0.18, 0.95, 0);
    ant.rotation.z = -sx * 0.3;
    alien.add(ant);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b8d }));
    ball.position.set(sx * 0.27, 1.12, 0);
    alien.add(ball);
  }
  tilt.add(alien);

  // couronne de lumières clignotantes (tourne)
  const ring = new THREE.Group();
  ring.position.y = -0.2;
  const lamps: THREE.Mesh[] = [];
  const cols = [0xff3b3b, 0xffe14a, 0x3bd1ff, 0xff7bf0];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
    m.position.set(Math.cos(a) * 3.03, 0, Math.sin(a) * 3.03);
    ring.add(m);
    lamps.push(m);
  }
  tilt.add(ring);

  // émetteur du rayon tracteur sous la coque
  const emit = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.18, 20), toon(0x3a4350));
  emit.position.y = -0.95;
  tilt.add(emit);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb6ff7a }));
  glow.position.y = -1.05;
  tilt.add(glow);
  // trois petits pieds
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), toon(0x777f8a));
    stick.position.y = -0.85;
    const foot = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), toon(0x777f8a)), 0.02);
    foot.position.y = -1.0;
    leg.add(stick, foot);
    leg.position.set(Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8);
    tilt.add(leg);
  }

  // cône du rayon tracteur (additif, visible seulement quand m1 est maintenu)
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xb6ff7a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 15, 24, 1, true), coneMat);
  cone.position.y = -1 - 7.5;
  cone.visible = false;
  group.add(cone);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(2.2, 15, 16, 1, true), coneMat.clone());
  (inner.material as THREE.MeshBasicMaterial).opacity = 0.35;
  inner.position.copy(cone.position);
  inner.visible = false;
  group.add(inner);

  let t = 0;
  return {
    group,
    update(s, dt) {
      t += dt;
      tilt.rotation.x = s.a[0] ?? 0;
      tilt.rotation.z = s.a[1] ?? 0;
      ring.rotation.y += dt * 1.6;
      alien.rotation.y = Math.sin(t * 1.3) * 0.5;
      lamps.forEach((m, i) => {
        const on = ((Math.floor(t * 6) + i) % 3) !== 0;
        (m.material as THREE.MeshBasicMaterial).color.setHex(on ? cols[i % 4] : 0x2a2a35);
      });
      const on = (s.a[2] ?? 0) > 0.5;
      cone.visible = inner.visible = on;
      if (on) {
        const k = 0.75 + Math.sin(t * 18) * 0.12;
        coneMat.opacity = 0.22 * k + 0.1;
        cone.rotation.y += dt * 2;
        inner.rotation.y -= dt * 3;
      }
      glow.scale.setScalar(on ? 1.2 + Math.sin(t * 20) * 0.15 : 1);
      (glow.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffffff : 0x8fd86a);
    },
  };
}

export const view: VehicleViewDef = {
  name: "l'OVNI",
  enterRadius: 6,
  build,
  cam: { height: 1.5, distance: 14, pitch: -0.3 },
  hud: (s, L) =>
    `OVNI · altitude ${Math.round(s.p[1])} m\n${L('forward')}/${L('back')}/${L('left')}/${L('right')} : se déplacer · ${L('throttleUp')}/${L('throttleDown')} : monter/descendre · ${L('yawLeft')}/${L('yawRight')} : pivoter\n`
    + `Clic gauche (maintenu) : rayon tracteur · Clic droit : éjection${(s.a[3] ?? 1) < 1 ? ' (recharge…)' : ''} · ${L('interact')} : descendre`,
  engine: { base: 90, speedK: 3, osc1: 'sine', osc2: 'triangle', ratio: 1.5, cutoff: 900, cutoffK: 20, level: 0.1 },
};
