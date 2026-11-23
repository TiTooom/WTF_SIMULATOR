import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../shared/constants';
import { CITY } from '../shared/city/layout';
import { CityView, FOG_COLOR } from './city/cityView';
import { canvasTexture, toon } from './gfx';

/**
 * Décor : ciel, lumière, île d'herbe, nuages, puis la ville (CityView : rues, bâtiments en chunks, arbres, quai, eau au-delà de la bordure).
 * Renvoie la vue de la ville : l'appeler avec `city.update(x, z)` à chaque image (sinon elle suit la caméra toute seule).
 */
export function buildEnvironment(scene: THREE.Scene): CityView {
  const rand = seeded(1337);
  scene.background = new THREE.Color(FOG_COLOR);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  // Île d'herbe sous la ville (le quai et l'eau sont dans CityView)
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
  }, [(CITY.BORDER + 3) / 4, (CITY.BORDER + 3) / 4]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((CITY.BORDER + 3) * 2, (CITY.BORDER + 3) * 2), toon(0xffffff, grass));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  scene.add(ground);

  // Nuages : fusionnés en un seul maillage (un appel de dessin)
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const cx = (rand() - 0.5) * 500, cy = 70 + rand() * 30, cz = (rand() - 0.5) * 500;
    for (let j = 0; j < 4; j++) {
      const r = 6 + rand() * 5;
      puffs.push(new THREE.SphereGeometry(r, 8, 6).scale(1, 0.6, 1).translate(cx + j * 8 - 12, cy + rand() * 3, cz + rand() * 5));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(puffs)!, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })));

  return new CityView(scene);
}
