// Les 5 quartiers de la ville : noms, gangs, couleurs. Données pures (serveur et client). Le découpage spatial est dans layout.ts.
import type { DistrictId, GangId } from '../ids';

export interface DistrictDef {
  id: DistrictId;
  name: string; // nom du quartier affiché
  gang: GangId;
  gangName: string; // nom du gang dominant
  color: number; // couleur de carte et de HUD (0xRRGGBB)
  /** Cellule « graine » du Voronoï (distance de Manhattan) : [i, j] avec i vers l'est, j vers le sud, 0..N-1. */
  seed: [number, number];
  /** Couleurs des bâtiments (aplats BD) et plage de hauteurs (m). */
  palette: number[];
  height: [number, number];
}

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  campus: {
    id: 'campus', name: 'Le Campus', gang: 'agros', gangName: 'Les Agros', color: 0x4caf50, seed: [2, 2],
    palette: [0xc8e6a0, 0xa5d6a7, 0xe8f5c8], height: [8, 16],
  },
  docks: {
    id: 'docks', name: 'Les Docks', gang: 'mouettes', gangName: 'La Bande des Mouettes', color: 0x2f80ed, seed: [8, 2],
    palette: [0x9ec9f0, 0xb8d8f5, 0x7fb2de], height: [6, 12],
  },
  vieux_bourg: {
    id: 'vieux_bourg', name: 'Le Vieux Bourg', gang: 'fromagers', gangName: 'La Confrérie du Fromage', color: 0xf2c94c, seed: [5, 5],
    palette: [0xf6e08a, 0xf0d070, 0xfff0b0], height: [8, 14],
  },
  zone_indus: {
    id: 'zone_indus', name: 'La Zone Indus', gang: 'cles_de_12', gangName: 'Les Clés de 12', color: 0xf2994a, seed: [2, 8],
    palette: [0xf5b27a, 0xe59866, 0xfad7a0], height: [6, 10],
  },
  les_hauts: {
    id: 'les_hauts', name: 'Les Hauts', gang: 'golfeurs', gangName: 'Le Club des Golfeurs', color: 0x9b51e0, seed: [8, 8],
    palette: [0xc9a8f0, 0xb794e6, 0xdcc6f7], height: [12, 30],
  },
};
