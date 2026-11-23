import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../shared/constants';
import { CITY, getCity } from '../shared/city/layout';
import { canvasTexture, outlined, punch, toon, toonRaw } from './gfx';

/**
 * Décor statique : ciel, lumière, sol, nuages. La ville est dessinée ici de façon MINIMALE (rues + bâtiments en boîtes toon à contour,
 * 3 draw calls) en attendant `src/city/cityView.ts` (art-toon : chunks, instanciation, détails).
 */
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
  }, [CITY.BORDER / 4, CITY.BORDER / 4]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY.BORDER * 2, CITY.BORDER * 2), toon(0xffffff, grass));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

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

  addBasicCity(scene);
}

/** Rues (bandes sombres) et bâtiments (mêmes boîtes que les colliders du serveur), fusionnés en deux maillages. */
function addBasicCity(scene: THREE.Scene) {
  const city = getCity();
  const roads: THREE.BufferGeometry[] = [];
  const len = CITY.HALF * 2 + CITY.ROAD;
  for (let k = 0; k <= CITY.N; k++) {
    const c = -CITY.HALF + CITY.CELL * k;
    roads.push(new THREE.BoxGeometry(len, 0.06, CITY.ROAD).translate(0, 0.03, c));
    roads.push(new THREE.BoxGeometry(CITY.ROAD, 0.06, len).translate(c, 0.03, 0));
  }
  const roadMesh = new THREE.Mesh(mergeGeometries(roads)!, toon(0x4a4a58));
  scene.add(roadMesh);

  const geos: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();
  for (const b of city.buildings) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d).translate(b.x, b.h / 2, b.z);
    col.setHex(punch(b.color));
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  }
  if (geos.length) scene.add(outlined(new THREE.Mesh(mergeGeometries(geos)!, toonRaw({ vertexColors: true })), 0.12));
}
