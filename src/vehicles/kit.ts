// Kit commun des voitures de la ville (PROPRIÉTAIRE : art-toon) : un véhicule = 1 maillage de carrosserie (couleurs de sommets) + 1 coque de contour
// + 4 roues + éventuels gyrophares (≈ 6 à 8 appels de dessin). Géométries et coques partagées entre tous les véhicules d'un même type ;
// seule la couleur de sommets (peinture) est propre à chaque véhicule. Origine = centre du châssis, le sol est à y = -0.45, l'avant est -z.
import * as THREE from 'three';
import type { VehicleSnap } from '../../shared/protocol';
import type { ActionId } from '../../shared/settings';
import { PartBuilder, hullGeometry, outlineMat, repaint, toonVC } from '../gfx';
import type { EngineParams, VehicleView, VehicleViewDef } from './types';

export const GROUND = -0.45;

export interface CarSpec {
  type: string;
  name: string; // « la citadine »
  label: string; // « Citadine »
  l: number; // longueur du châssis
  w: number; // largeur
  cab: { w: number; h: number; l: number; z: number }; // cabine (z > 0 : vers l'arrière)
  palette: number[]; // peintures possibles (livrée = index)
  wheel: { r: number; x: number; front: number; rear: number }; // rayon, demi-voie, z avant (négatif), z arrière
  /** Pièces spécifiques (le châssis, la cabine, les feux et les pare-chocs sont déjà posés). `paint` pour les pièces repeignables. */
  detail?: (b: PartBuilder, spec: CarSpec) => void;
  beacons?: boolean; // gyrophares (police)
  cam: { height: number; distance: number; pitch: number };
  engine: EngineParams;
  enterRadius?: number;
}

const wheelGeo = (() => {
  const b = new PartBuilder();
  b.add(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14).rotateZ(Math.PI / 2), 0x25252d);
  b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8).rotateZ(Math.PI / 2), 0xe4e4ea);
  b.box(0.36, 0.08, 0.5, 0x9a9aa8, 0, 0, 0);
  b.box(0.36, 0.5, 0.08, 0x9a9aa8, 0, 0, 0);
  return b.build();
})();

const beaconMat = {
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  blue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
};
const beaconGeo = new THREE.BoxGeometry(0.5, 0.2, 0.34);
// Halo additif des gyrophares (sirène visible de loin) : texture et matériaux partagés par toutes les voitures de police
let haloTex: THREE.CanvasTexture | null = null;
const haloMats: Record<'red' | 'blue', THREE.SpriteMaterial | null> = { red: null, blue: null };
function haloMat(k: 'red' | 'blue'): THREE.SpriteMaterial {
  if (!haloTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  return (haloMats[k] ??= new THREE.SpriteMaterial({ map: haloTex, color: k === 'red' ? 0xff2a2a : 0x2a6bff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
}

interface Shared { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry }
const sharedCache = new Map<string, Shared>();

function sharedFor(spec: CarSpec): Shared {
  let s = sharedCache.get(spec.type);
  if (s) return s;
  const { l, w, cab } = spec;
  const b = new PartBuilder();
  const DARK = 0x23232e;
  b.box(w, 0.62, l, 0xffffff, 0, 0.02, 0, true); // châssis
  b.box(w - 0.12, 0.2, l - 0.4, DARK, 0, -0.27, 0); // dessous
  b.box(cab.w, cab.h, cab.l, 0x6ec6ff, 0, 0.33 + cab.h / 2 - 0.02, cab.z); // vitres
  b.box(cab.w + 0.1, 0.1, cab.l + 0.16, 0xffffff, 0, 0.33 + cab.h + 0.03, cab.z, true); // toit
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, cab.h, 0.1, 0xffffff, sx * (cab.w / 2), 0.33 + cab.h / 2 - 0.02, cab.z + sz * (cab.l / 2), true); // montants
  b.box(w + 0.1, 0.18, 0.2, DARK, 0, -0.12, -l / 2).box(w + 0.1, 0.18, 0.2, DARK, 0, -0.12, l / 2); // pare-chocs
  b.box(w * 0.5, 0.16, 0.06, DARK, 0, 0.06, -l / 2 - 0.02); // calandre
  for (const sx of [-1, 1]) {
    b.box(0.42, 0.2, 0.08, 0xfff3a0, sx * w * 0.34, 0.1, -l / 2 - 0.03);
    b.box(0.36, 0.18, 0.08, 0xff3030, sx * w * 0.34, 0.1, l / 2 + 0.03);
    b.box(0.14, 0.14, 0.3, DARK, sx * (w / 2 + 0.08), 0.42, cab.z - cab.l / 2 - 0.1); // rétroviseurs
  }
  spec.detail?.(b, spec);
  const geo = b.build();
  s = { geo, hull: hullGeometry(geo, 0.05) };
  sharedCache.set(spec.type, s);
  return s;
}

let seedCounter = 0;
const mixHex = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

/**
 * Fabrique la vue d'un type de voiture. `build(seed)` : `seed` (index de l'emplacement dans la liste des véhicules) varie la couleur ;
 * sans argument, un compteur local (couleurs alors propres à chaque client).
 */
export function makeCarView(spec: CarSpec): VehicleViewDef {
  const hudName = spec.label;
  return {
    name: spec.name,
    enterRadius: spec.enterRadius ?? 5,
    build(seed: number = seedCounter++): VehicleView {
      const sh = sharedFor(spec);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', sh.geo.getAttribute('position'));
      geo.setAttribute('normal', sh.geo.getAttribute('normal'));
      geo.setAttribute('paint', sh.geo.getAttribute('paint'));
      geo.setAttribute('color', (sh.geo.getAttribute('color') as THREE.BufferAttribute).clone());
      const group = new THREE.Group();
      const body = new THREE.Mesh(geo, toonVC);
      const hull = new THREE.Mesh(sh.hull, outlineMat);
      hull.matrixAutoUpdate = false;
      body.add(hull);
      group.add(body);

      const wheels: { pivot: THREE.Group; spin: THREE.Mesh; front: boolean }[] = [];
      const ws = spec.wheel.r / 0.38;
      for (const [x, z, front] of [[-1, spec.wheel.front, true], [1, spec.wheel.front, true], [-1, spec.wheel.rear, false], [1, spec.wheel.rear, false]] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(x * spec.wheel.x, GROUND + spec.wheel.r, z);
        const spin = new THREE.Mesh(wheelGeo, toonVC);
        spin.scale.setScalar(ws);
        pivot.add(spin);
        group.add(pivot);
        wheels.push({ pivot, spin, front });
      }

      let beaconR: THREE.Mesh | null = null, beaconB: THREE.Mesh | null = null;
      if (spec.beacons) {
        beaconR = new THREE.Mesh(beaconGeo, beaconMat.red);
        beaconB = new THREE.Mesh(beaconGeo, beaconMat.blue);
        const y = 0.33 + spec.cab.h + 0.2;
        beaconR.position.set(-0.3, y, spec.cab.z);
        beaconB.position.set(0.3, y, spec.cab.z);
        group.add(beaconR, beaconB);
        for (const [b, k] of [[beaconR, 'red'], [beaconB, 'blue']] as const) {
          const halo = new THREE.Sprite(haloMat(k));
          halo.scale.setScalar(3.4);
          halo.position.y = 0.35;
          b.add(halo);
        }
      }

      // Peinture : id (seed) + livrée (lv) ; assombrie progressivement sous 30 % de vie
      let paintKey = -1;
      const applyPaint = (lv: number, hp: number) => {
        const pal = spec.palette;
        const idx = (((seed + lv) % pal.length) + pal.length) % pal.length;
        const dmg = hp < 0.3 ? Math.round((1 - hp / 0.3) * 4) : 0; // 0..4
        const key = idx * 8 + dmg;
        if (key === paintKey) return;
        paintKey = key;
        repaint(geo, dmg ? mixHex(pal[idx], 0x2a2a2a, dmg * 0.17) : pal[idx]);
      };
      applyPaint(0, 1);

      return {
        group,
        update(s: VehicleSnap, dt: number) {
          if (s.dead) { group.visible = false; return; }
          group.visible = true;
          applyPaint(s.lv ?? 0, s.hp);
          for (const w of wheels) {
            w.spin.rotation.x -= (s.sp * dt) / spec.wheel.r;
            if (w.front) w.pivot.rotation.y = s.st * 0.45;
          }
          if (beaconR && beaconB) {
            // a[0] === 0 : gyrophares éteints (le serveur peut les couper) ; sinon ils clignotent (alternance rouge/bleu, 6 Hz)
            const on = s.a[0] !== 0;
            const ph = Math.floor(performance.now() / 160) & 1;
            beaconR.visible = on && ph === 0;
            beaconB.visible = on && ph === 1;
          }
        },
      };
    },
    cam: spec.cam,
    hud: (s: VehicleSnap, L: (a: ActionId) => string) =>
      `${hudName} · ${Math.round(Math.abs(s.sp) * 3.6)} km/h\n${L('forward')}/${L('back')} : accélérer · ${L('left')}/${L('right')} : tourner · ${L('jump')} : frein à main · ${L('horn')} : klaxon · Molette : zoom · ${L('interact')} : descendre`,
    engine: spec.engine,
  };
}
