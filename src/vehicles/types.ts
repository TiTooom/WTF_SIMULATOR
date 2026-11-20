// Contrat client d'un véhicule : un fichier src/vehicles/<type>.ts exporte `view: VehicleViewDef`.
import type * as THREE from 'three';
import type { VehicleSnap } from '../../shared/protocol';
import type { ActionId } from '../../shared/settings';

export interface VehicleView {
  group: THREE.Group;
  /** Animations dépendant de l'état (roues, hélices, bras...). Le groupe est déjà placé/orienté par le jeu. */
  update(s: VehicleSnap, dt: number): void;
}

/** Paramètres du son moteur (synthèse : deux oscillateurs + filtre passe-bas). */
export interface EngineParams {
  base: number; // fréquence à l'arrêt (Hz)
  speedK: number; // Hz ajoutés par m/s
  osc1?: OscillatorType; // défaut 'sawtooth'
  osc2?: OscillatorType; // défaut 'square'
  ratio?: number; // rapport de fréquence osc2/osc1 (défaut 2.01)
  cutoff?: number; // filtre à l'arrêt, Hz (défaut 380)
  cutoffK?: number; // filtre ajouté par m/s (défaut 45)
  level: number; // volume (0.1 à 0.3)
  hydro?: boolean; // bruit de vérins quand `a` change
  silent?: boolean; // pas de moteur (dirigeable...)
}

export interface VehicleViewDef {
  name?: string; // « le tank » (avec article)
  enterRadius?: number; // rayon de l'aide « E : monter dans… » (défaut 6)
  build(): VehicleView;
  cam: { height: number; distance: number; pitch: number };
  /** Texte d'aide à l'écran pendant la conduite ; L('forward') = nom de la touche. */
  hud(snap: VehicleSnap, L: (a: ActionId) => string): string;
  engine?: EngineParams;
}
