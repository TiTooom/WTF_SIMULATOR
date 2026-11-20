// Décor du monde partagé serveur/client : lieux, bâtiments, rampes, panneaux, pistes…
// - STATICS : formes fixes décrites par des DONNÉES. Le serveur en fait des colliders fixes, le client les dessine (src/scene.ts).
// - buildWorld(sim) : appelé une fois par le serveur après la création du monde (props de décor : châteaux de caisses, ville miniature…).
import type RAPIER from '@dimforge/rapier3d-compat';

export type StaticShape = 'box' | 'cylinder' | 'wedge' | 'sphere';
export interface StaticDef {
  shape: StaticShape;
  pos: [number, number, number]; // centre
  size: [number, number, number]; // box/wedge : largeur, hauteur, profondeur · cylinder : [diamètre, hauteur, _] · sphere : [diamètre, _, _]
  rotY?: number; // radians
  color: number;
  collide?: boolean; // défaut true ; false = purement visuel (marquages au sol…)
  glow?: boolean;
}

export const STATICS: StaticDef[] = [];

/** Minimal : ce que buildWorld peut utiliser (implémenté par Sim). */
export interface WorldBuilder {
  readonly world: RAPIER.World;
  spawnProp(kindId: string, pos: { x: number; y: number; z: number }, ...rest: unknown[]): unknown;
}

export function buildWorld(_sim: WorldBuilder): void {
  // rempli par l'équipe décor
}
