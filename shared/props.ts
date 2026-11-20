// Props : tous les objets physiques du monde qui ne sont ni des joueurs ni des véhicules
// (caisses, objets construits, barriques, ballons, projectiles posés…). Décrits par des DONNÉES :
// le serveur en fait un corps Rapier, le client dessine la forme avec les mêmes dimensions.

export type PropShape = 'box' | 'sphere' | 'cylinder' | 'wedge';

export interface PropKind {
  id: string; // snake_case ASCII, unique dans tout le jeu
  name: string; // nom français affiché
  shape: PropShape;
  /** box : largeur, hauteur, profondeur · sphere : [diamètre] · cylinder : [diamètre, hauteur] · wedge (rampe) : largeur, hauteur, longueur */
  size: [number, number?, number?];
  color: number; // 0xRRGGBB
  mass: number; // kg
  friction?: number; // défaut 0.8
  bounce?: number; // restitution 0..1 (trampoline : 1.2)
  gravityScale?: number; // 1 par défaut ; ballon : -0.25 (flotte)
  hp?: number; // points de vie ; absent = indestructible
  explosive?: { radius: number; power: number; damage: number }; // explose quand détruit
  life?: number; // secondes avant disparition automatique
  glow?: boolean; // aspect lumineux (non ombré)
}

/** Sommets d'une rampe (prisme triangulaire) : bord haut du côté −z, bord bas du côté +z. Partagé serveur/client. */
export function wedgeVertices(w: number, h: number, l: number): number[] {
  const x = w / 2, y = h / 2, z = l / 2;
  return [-x, -y, z, x, -y, z, -x, -y, -z, x, -y, -z, -x, y, -z, x, y, -z];
}

/** Caisses du monde de départ. */
export const BASE_PROPS: PropKind[] = [
  { id: 'crate_s', name: 'Petite caisse', shape: 'box', size: [1, 1, 1], color: 0xffb347, mass: 1, hp: 60 },
  { id: 'crate_m', name: 'Caisse', shape: 'box', size: [1.2, 1.2, 1.2], color: 0xf4a261, mass: 2, hp: 90 },
  { id: 'crate_l', name: 'Grosse caisse', shape: 'box', size: [1.2, 1.2, 1.2], color: 0xe9c46a, mass: 2, hp: 90 },
  { id: 'debris', name: 'Débris', shape: 'box', size: [0.5, 0.3, 0.5], color: 0x3a3a42, mass: 0.6, life: 20 },
];
