// PROPRIÉTAIRE : art-toon
// À IMPLÉMENTER : dessin des piétons (instanciés, toon + contour, animation selon l'état `st`) à partir de Sampled.peds (PED_STRIDE : id, kind, x, z, yaw, st).
import type * as THREE from 'three';

export class PedsView {
  constructor(_scene: THREE.Scene) {}
  update(_peds: Float32Array, _dt: number): void {}
  get count(): number { return 0; }
}
