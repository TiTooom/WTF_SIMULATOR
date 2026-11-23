// PROPRIÉTAIRE : art-toon
// À IMPLÉMENTER : rendu de la ville par chunks (25 chunks construits une fois, 3×3 visibles), InstancedMesh + coques de contour, ≤ ~150 appels de dessin, brouillard ~150 m. Remplace addBasicCity (src/scene.ts).
import type * as THREE from 'three';
import type { Vec3 } from '../../shared/protocol';

export class CityView {
  constructor(_scene: THREE.Scene) {}
  /** Appelé à chaque image avec la position suivie par la caméra. */
  update(_focus: Vec3): void {}
  dispose(): void {}
}
