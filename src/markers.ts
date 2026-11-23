// PROPRIÉTAIRE : art-toon
// À IMPLÉMENTER : repères en monde (flèches, anneaux de mission, gyrophares) à partir de PrivateState.marks.
import type * as THREE from 'three';
import type { Mark } from '../shared/protocol';

export class MarkersView {
  constructor(_scene: THREE.Scene) {}
  update(_marks: readonly Mark[], _dt: number): void {}
}
