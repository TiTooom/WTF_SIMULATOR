// Registre client des véhicules : un `VehicleViewDef` par type (voir shared/vehicles pour le côté serveur).
// Un type sans vue (null) ou inconnu est dessiné par un modèle de secours : le jeu ne casse jamais.
import * as THREE from 'three';
import type { ActionId } from '../../shared/settings';
import { box } from '../gfx';
import type { VehicleViewDef } from './types';
import { view as car } from './car';
import { view as excavator } from './excavator';
import { view as tank } from './tank';
import { view as camion_articule } from './camion_articule';
import { view as caddie_turbo } from './caddie_turbo';
import { view as camion_glaces } from './camion_glaces';
import { view as toilettes_roulettes } from './toilettes_roulettes';
import { view as avion_chasse } from './avion_chasse';
import { view as helicoptere } from './helicoptere';
import { view as ovni } from './ovni';
import { view as canape_fusee } from './canape_fusee';
import { view as dirigeable_pedales } from './dirigeable_pedales';

// Même liste/ordre que VEHICLE_TYPES (shared/vehicles) ; recopiée pour ne pas embarquer le code serveur dans le client.
export const VIEW_TYPES = [
  'car', 'excavator', 'tank', 'camion_articule', 'caddie_turbo', 'camion_glaces', 'toilettes_roulettes',
  'avion_chasse', 'helicoptere', 'ovni', 'canape_fusee', 'dirigeable_pedales',
] as const;

const ALL: Record<string, VehicleViewDef | null> = {
  car, excavator, tank, camion_articule, caddie_turbo, camion_glaces, toilettes_roulettes,
  avion_chasse, helicoptere, ovni, canape_fusee, dirigeable_pedales,
};
/** Vues disponibles (les types encore sans vue n'y figurent pas). */
export const VIEWS: Record<string, VehicleViewDef> = {};
for (const [k, v] of Object.entries(ALL)) if (v) VIEWS[k] = v;

const FALLBACK_NAMES: Record<string, string> = {
  tank: 'le tank', camion_articule: 'le camion articulé', caddie_turbo: 'le caddie turbo', camion_glaces: 'le camion de glaces',
  toilettes_roulettes: 'les toilettes à roulettes', avion_chasse: "l'avion de chasse", helicoptere: "l'hélicoptère", ovni: "l'OVNI",
  canape_fusee: 'le canapé-fusée', dirigeable_pedales: 'le dirigeable à pédales',
};

function hashColor(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.55).getHex();
}

/** Modèle de secours : boîte colorée portant le nom du type. */
function buildFallback(type: string): VehicleViewDef {
  const name = FALLBACK_NAMES[type] ?? `le véhicule « ${type} »`;
  return {
    name,
    build() {
      const group = new THREE.Group();
      box(group, 2, 1, 4, hashColor(type), 0, 0.2, 0);
      box(group, 0.4, 0.3, 0.2, 0xffffff, 0, 0.55, -2, false); // pointe : l'avant est -z
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const g = c.getContext('2d')!;
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 6;
      g.strokeStyle = '#1b1b2b';
      g.strokeText(type, 128, 42);
      g.fillStyle = '#fff';
      g.fillText(type, 128, 42);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
      sprite.scale.set(3.2, 0.8, 1);
      sprite.position.y = 1.8;
      group.add(sprite);
      return { group, update() {} };
    },
    cam: { height: 2.5, distance: 10, pitch: -0.25 },
    hud: (_s, L: (a: ActionId) => string) => `${name} · ${L('forward')}/${L('back')} : avancer · ${L('left')}/${L('right')} : tourner · ${L('interact')} : descendre`,
    engine: { base: 40, speedK: 3, level: 0.14 },
  };
}

const fallbacks = new Map<string, VehicleViewDef>();
/** Vue d'un type : celle du registre, sinon le modèle de secours (jamais null). */
export function viewFor(type: string): VehicleViewDef {
  const v = VIEWS[type];
  if (v) return v;
  let f = fallbacks.get(type);
  if (!f) fallbacks.set(type, (f = buildFallback(type)));
  return f;
}
