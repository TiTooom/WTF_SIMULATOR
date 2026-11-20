import * as THREE from 'three';
import { GROUND, ROAD_X, seeded, treeLayout } from '../shared/constants';
import { canvasTexture, toon, toonRaw } from './gfx';

/** Décor statique : ciel, lumière, sol herbeux, route, arbres, nuages. (Les collisions des arbres sont côté serveur.) */
export function buildEnvironment(scene: THREE.Scene) {
  const rand = seeded(1337);
  scene.background = new THREE.Color(0x9fd3ff);
  scene.fog = new THREE.Fog(0x9fd3ff, 80, 300);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  // Sol
  const grass = canvasTexture([256, 256], (g) => {
    g.fillStyle = '#7ec850';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = rand() < 0.5 ? '#6fb842' : '#91dc63';
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 5, 2 + rand() * 5);
    }
    g.strokeStyle = '#4f9c2e';
    g.lineWidth = 2;
    for (let i = 0; i < 45; i++) {
      const x = 8 + rand() * 240, y = 12 + rand() * 236;
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x - 4, y - 9);
      g.moveTo(x, y); g.lineTo(x + 4, y - 9);
      g.moveTo(x, y); g.lineTo(x, y - 11);
      g.stroke();
    }
    const flowers = ['#ffffff', '#ffe066', '#ff8fab'];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = flowers[i % 3];
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, [GROUND / 4, GROUND / 4]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND * 2, GROUND * 2), toon(0xffffff, grass));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Route le long de l'axe Z
  const roadTex = canvasTexture([64, 128], (g) => {
    g.fillStyle = '#4a4e57';
    g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = rand() < 0.5 ? '#40444c' : '#575b65';
      g.fillRect(rand() * 64, rand() * 128, 2, 2);
    }
    g.fillStyle = '#f5f5f5';
    g.fillRect(29, 12, 6, 50);
    g.fillStyle = '#e9d44a';
    g.fillRect(2, 0, 2, 128);
    g.fillRect(60, 0, 2, 128);
  }, [1, GROUND / 4]);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(10, GROUND * 2),
    toonRaw({ map: roadTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(ROAD_X, 0.02, 0);
  scene.add(road);

  // Arbres instanciés
  const trees = treeLayout();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), toon(0x8b5a2b), trees.length);
  const leavesLow = new THREE.InstancedMesh(new THREE.ConeGeometry(2.0, 3.0, 7), toon(0x2fa84f), trees.length);
  const leavesTop = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 2.4, 7), toon(0x3cc261), trees.length);
  const m4 = new THREE.Matrix4();
  trees.forEach((t, i) => {
    const place = (mesh: THREE.InstancedMesh, y: number) => mesh.setMatrixAt(i, m4.makeScale(t.s, t.s, t.s).setPosition(t.x, y * t.s, t.z));
    place(trunks, 1.2);
    place(leavesLow, 3.4);
    place(leavesTop, 5.1);
  });
  scene.add(trunks, leavesLow, leavesTop);

  // Nuages
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 5, 8, 6), cloudMat);
      puff.position.set(j * 8 - 12, rand() * 3, rand() * 5);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    cloud.position.set((rand() - 0.5) * 500, 70 + rand() * 30, (rand() - 0.5) * 500);
    scene.add(cloud);
  }
}
