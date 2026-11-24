// Rendu de la ville (PROPRIÉTAIRE : art-toon). Données : shared/city/layout.ts (identiques serveur/client).
//  - Sol, trottoirs, rues, marquages, arbres, lampadaires, quai et eau : maillages fusionnés GLOBAUX (peu de sommets, ~12 appels de dessin).
//  - Bâtiments et toits : 25 chunks (CITY.CHUNK = 128 m) construits UNE fois, en `InstancedMesh` (+ coque de contour instanciée),
//    seuls les 3×3 chunks autour du point suivi sont visibles (≈ 36 appels de dessin).
//  - Détails (buildDetails) : enseignes de toit par quartier (1 maillage global + atlas canvas), bouches d'incendie et panneaux de rue fusionnés par chunk.
//  - Couleurs de quartier : toits (couleur du quartier), sols et palette des façades. Fenêtres : motif calculé dans le shader (aucune texture).
import * as THREE from 'three';
import { seeded } from '../../shared/constants';
import { CHUNKS_PER_SIDE, CITY, getCity } from '../../shared/city/layout';
import { DISTRICTS } from '../../shared/city/districts';
import { DISTRICT_IDS } from '../../shared/ids';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OCC, PartBuilder, boxGeo, boxHullMat, canvasTexture, hullGeometry, makeOccludable, outlineMat, punch, toon, toonRaw, toonVC } from '../gfx';

const { CELL, ROAD, SIDEWALK, LOT, BORDER } = CITY;
export const FOG_COLOR = 0x9fd3ff;
export const FOG_NEAR = 45;
export const FOG_FAR = 150;

/** Enseignes de toit : 3 par quartier, dans l'ordre de DISTRICT_IDS (campus, docks, vieux_bourg, zone_indus, les_hauts). Textes inventés, aucun commerce réel. */
const SIGNS: { text: string; bg: string; fg: string }[] = [
  { text: 'CAFÉ MACHINE', bg: '#3a8f43', fg: '#fff3a0' }, { text: 'ANNALES', bg: '#d6f0a8', fg: '#1f6f2a' }, { text: 'BIBLIO 24H', bg: '#1f6f2a', fg: '#ffffff' },
  { text: 'POISSONS', bg: '#2f80ed', fg: '#ffffff' }, { text: 'BAR DU PORT', bg: '#0e3c8c', fg: '#ffd23f' }, { text: 'ANCRE HÔTEL', bg: '#bfe0ff', fg: '#0e3c8c' },
  { text: 'FROMAGE', bg: '#ffd23f', fg: '#7a3b00' }, { text: 'BOULANGER', bg: '#e8a23a', fg: '#ffffff' }, { text: 'AUBERGE', bg: '#8a2b16', fg: '#ffe9a0' },
  { text: 'GARAGE', bg: '#f2994a', fg: '#14141f' }, { text: 'FERRAILLE', bg: '#4b4f5c', fg: '#ffb347' }, { text: 'PIÈCES AUTO', bg: '#14141f', fg: '#ff7a1a' },
  { text: 'GOLF CLUB', bg: '#9b51e0', fg: '#ffffff' }, { text: 'CHAMPAGNE', bg: '#2a145a', fg: '#ffd23f' }, { text: 'SPA & CO', bg: '#e9d4ff', fg: '#5a1fa0' },
];

const mix = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// ---------- Textures canvas (une seule fois) ----------
const ASPHALT = '#3f4150';
function roadStripTexture() {
  return canvasTexture([256, 256], (g) => {
    g.fillStyle = ASPHALT;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#4a4c5c';
    for (let i = 0; i < 90; i++) g.fillRect(((i * 97) % 256), ((i * 61) % 256), 3, 2);
    g.fillStyle = '#ececec'; // lignes de rive
    g.fillRect(0, 12, 256, 6);
    g.fillRect(0, 238, 256, 6);
    g.fillStyle = '#ffe14d'; // axe : tirets (4 m / 4 m)
    g.fillRect(0, 124, 128, 8);
  }, [1, 1]);
}
function intersectionTexture() {
  return canvasTexture([256, 256], (g) => {
    g.fillStyle = ASPHALT;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#4a4c5c';
    for (let i = 0; i < 40; i++) g.fillRect(((i * 53) % 256), ((i * 89) % 256), 3, 2);
    g.fillStyle = '#ececec'; // passages piétons sur les 4 côtés
    for (let k = 56; k <= 200; k += 32) {
      g.fillRect(k, 6, 16, 34); g.fillRect(k, 216, 16, 34);
      g.fillRect(6, k, 34, 16); g.fillRect(216, k, 34, 16);
    }
  }, [1, 1]);
}
function waterTexture() {
  const t = canvasTexture([256, 256], (g) => {
    g.fillStyle = '#2a8fe0';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#7cc4ff';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = (i * 71) % 256, y = (i * 43) % 256;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 8, x + 28, y); g.stroke();
    }
  }, [60, 60]);
  return t;
}

// ---------- Fenêtres de façade : motif en monde, calculé par le shader ----------
function buildingMaterial() {
  const m = toonRaw({});
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpi = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wpi = instanceMatrix * wpi;
        #endif
        vWP = (modelMatrix * wpi).xyz;
        vWN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vWN.y) < 0.5) {
          float u = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
          float side = abs(vWN.x) > 0.5 ? sign(vWN.x) * 3.0 + floor(vWP.x * 0.1) : sign(vWN.z) * 5.0 + floor(vWP.z * 0.1);
          vec2 cell = vec2(u / 3.2, vWP.y / 3.4);
          vec2 f = fract(cell);
          if (vWP.y < 0.7) diffuseColor.rgb *= 0.78;
          else if (vWP.y > 2.9 && f.x > 0.2 && f.x < 0.8 && f.y > 0.22 && f.y < 0.76) {
            float h = fract(sin(dot(floor(cell) + vec2(side, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
            diffuseColor.rgb = h > 0.74 ? vec3(1.0, 0.86, 0.42) : mix(vec3(0.16, 0.22, 0.36), vec3(0.34, 0.5, 0.7), h);
          }
        }`);
  };
  m.customProgramCacheKey = () => 'city-windows';
  return makeOccludable(m);
}

interface Chunk { cx: number; cz: number; group: THREE.Group }

export class CityView {
  /** Racine de tout ce que la ville ajoute à la scène. */
  readonly root = new THREE.Group();
  private chunks: Chunk[] = [];
  private water!: THREE.Mesh;
  private waterTex!: THREE.Texture;
  private focusChunk = { cx: -1, cz: -1 };
  private manual = false;
  private owned: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private lastAuto = 0;
  private readonly focus = new THREE.Vector3(0, 0.6, 0);
  /** Rayon (m) du trou estompé dans les bâtiments entre la caméra et le joueur ; 0 = désactivé. Plus grand en véhicule (≈ 6,5). */
  occludeRadius = 5.5;
  /** Le bâtiment qui contient la caméra devient fantôme (désactivable pour les tests). */
  ghostInside = true;

  constructor(private scene: THREE.Scene) {
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.buildGround();
    this.buildScenery();
    this.buildChunks();
    this.buildDetails();
    this.buildShore();
    scene.add(this.root);
    this.update(0, 0);
    this.manual = false; // tant que le jeu n'appelle pas update(), la ville suit la caméra toute seule
    // Sans appel explicite à update(), la ville suit la caméra (point visé au sol) : aucun branchement nécessaire dans main.ts.
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (r, s, cam, ...rest) => {
      prev.call(scene, r, s, cam, ...(rest as [never, never, never]));
      this.autoFollow(cam);
    };
  }

  /**
   * Appelé par le jeu avec la position suivie (joueur ou véhicule). `update(x, z)` ou `update([x, y, z])`.
   * Dès le premier appel explicite, le suivi automatique par la caméra est désactivé.
   */
  update(xOrFocus: number | readonly number[], z?: number): void {
    let x: number, zz: number;
    let y = 0.3;
    if (typeof xOrFocus === 'number') { x = xOrFocus; zz = z ?? 0; } else { x = xOrFocus[0]; zz = xOrFocus[2]; y = xOrFocus[1] ?? 0.3; }
    if (!Number.isFinite(x) || !Number.isFinite(zz)) return;
    this.focus.set(x, (Number.isFinite(y) ? y : 0.3) + 0.6, zz);
    this.manual = true;
    this.setFocus(x, zz);
  }

  /** Bâtiment contenant la caméra (empreinte + marge) → OCC.box ; la caméra de jeu est parfois à l'intérieur d'un immeuble haut. */
  private insideBuilding(p: THREE.Vector3) {
    const b = OCC.box.value;
    b.set(0, 0, -1, -1);
    if (!this.ghostInside) return;
    for (const bd of getCity().buildings) {
      if (p.y < bd.h + 0.6 && Math.abs(p.x - bd.x) < bd.w / 2 + 0.7 && Math.abs(p.z - bd.z) < bd.d / 2 + 0.7) { b.set(bd.x, bd.z, bd.w / 2 + 1, bd.d / 2 + 1); return; }
    }
  }

  private autoFollow(cam: THREE.Camera) {
    this.scrollWater();
    cam.getWorldPosition(this.tmpPos);
    OCC.cam.value.copy(this.tmpPos);
    this.insideBuilding(this.tmpPos);
    if (this.manual) { OCC.foc.value.set(this.focus.x, this.focus.y, this.focus.z, this.occludeRadius); return; }
    OCC.foc.value.set(0, 0, 0, 0); // suivi automatique : pas de joueur connu, aucun estompage
    cam.getWorldDirection(this.tmpDir);
    let t = 0;
    if (this.tmpDir.y < -0.05) t = Math.min(80, this.tmpPos.y / -this.tmpDir.y);
    this.setFocus(this.tmpPos.x + this.tmpDir.x * t, this.tmpPos.z + this.tmpDir.z * t);
  }

  private setFocus(x: number, z: number) {
    const c = getCity().chunkOf(x, z);
    if (c.cx === this.focusChunk.cx && c.cz === this.focusChunk.cz) return;
    this.focusChunk = { cx: c.cx, cz: c.cz };
    for (const ch of this.chunks) ch.group.visible = Math.abs(ch.cx - c.cx) <= 1 && Math.abs(ch.cz - c.cz) <= 1;
  }

  private scrollWater() {
    const t = performance.now() / 1000;
    this.waterTex.offset.set((t * 0.004) % 1, (t * 0.0025) % 1);
  }

  /** Nombre de maillages visibles de la ville (≈ appels de dessin ; borne haute, le frustum en retire). */
  get drawCalls(): number {
    let n = 0;
    this.root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) n++; });
    return n;
  }
  /** Chunks visibles / total, pour les tests. */
  get chunksVisible(): number { return this.chunks.filter((c) => c.group.visible).length; }
  get chunksTotal(): number { return this.chunks.length; }

  private own<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(o: T): T { this.owned.push(o); return o; }

  // ---------- Sol : rues (textures), trottoirs et lots (couleurs de sommets) ----------
  private buildGround() {
    const city = getCity();
    const strip = this.own(roadStripTexture());
    const inter = this.own(intersectionTexture());
    const stripGeos: THREE.BufferGeometry[] = [];
    const interGeos: THREE.BufferGeometry[] = [];
    const len = CELL - ROAD;
    for (const e of city.edges) {
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const g = new THREE.PlaneGeometry(e.horizontal ? len : ROAD, e.horizontal ? ROAD : len).rotateX(-Math.PI / 2);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (e.horizontal) uv.setXY(i, u * (len / ROAD), v); // les tirets suivent l'axe de la rue
        else uv.setXY(i, v * (len / ROAD), u);
      }
      g.translate((a.x + b.x) / 2, 0.01, (a.z + b.z) / 2);
      stripGeos.push(g);
    }
    for (const n of city.nodes) interGeos.push(new THREE.PlaneGeometry(ROAD, ROAD).rotateX(-Math.PI / 2).translate(n.x, 0.012, n.z));
    const roads = new THREE.Mesh(this.own(mergeNonIndexed(stripGeos)), this.own(toon(0xffffff, strip)));
    const inters = new THREE.Mesh(this.own(mergeNonIndexed(interGeos)), this.own(toon(0xffffff, inter)));
    this.root.add(roads, inters);

    // Îlots : liseré noir, trottoir, lot teinté par quartier ; parcs (herbe + allées) et places (dallage + fontaine)
    const pb = new PartBuilder();
    const SW = LOT + 2 * SIDEWALK;
    const slab = (w: number, top: number, color: number, x: number, z: number) => pb.box(w, 0.1, w, color, x, top - 0.05, z);
    for (const b of city.blocks) {
      const d = DISTRICTS[b.district];
      pb.box(SW + 0.7, 0.1, SW + 0.7, 0x14141f, b.x, 0.03 - 0.05, b.z);
      slab(SW, 0.05, 0xd2cdbd, b.x, b.z);
      if (b.kind === 'parc') {
        slab(LOT, 0.07, 0x7ec850, b.x, b.z);
        pb.box(LOT, 0.1, 3, 0xe9d8a6, b.x, 0.085 - 0.05, b.z);
        pb.box(3, 0.1, LOT, 0xe9d8a6, b.x, 0.09 - 0.05, b.z);
      } else if (b.kind === 'place') {
        slab(LOT, 0.07, 0xeadfc4, b.x, b.z);
        pb.add(new THREE.CylinderGeometry(7, 7.4, 0.7, 20), 0xb9b4a6, b.x, 0.35, b.z);
        pb.add(new THREE.CylinderGeometry(6, 6, 0.1, 20), 0x4aa8ff, b.x, 0.62, b.z);
        pb.add(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8), 0xb9b4a6, b.x, 1.5, b.z);
      } else {
        slab(LOT, 0.07, mix(0xbab6a8, d.color, 0.42), b.x, b.z);
      }
    }
    const blocks = new THREE.Mesh(this.own(pb.build()), toonVC);
    this.root.add(blocks);
  }

  // ---------- Arbres (parcs, places) et lampadaires : instanciés, globaux ----------
  private buildScenery() {
    const city = getCity();
    const rand = seeded(777);
    const trees: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const b of city.blocks) {
      if (b.kind === 'batiments') continue;
      const count = b.kind === 'parc' ? 9 : 4;
      for (let k = 0; k < count; k++) {
        let x: number, z: number;
        if (b.kind === 'place') { const a = (k / count) * Math.PI * 2 + 0.6; x = b.x + Math.cos(a) * 17; z = b.z + Math.sin(a) * 17; }
        else { x = b.x + (rand() - 0.5) * (LOT - 8); z = b.z + (rand() - 0.5) * (LOT - 8); if (Math.abs(x - b.x) < 3 || Math.abs(z - b.z) < 3) { x += 5; z += 5; } }
        const sc = 0.85 + rand() * 0.6;
        trees.push(m.clone().compose(p.set(x, 0.07, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6), s.set(sc, sc, sc)));
      }
    }
    const treeGeo = this.own(new PartBuilder()
      .box(0.4, 1.8, 0.4, 0x8a5a2b, 0, 0.9, 0)
      .add(new THREE.IcosahedronGeometry(1.6, 0), 0x4cbd4c, 0, 3.0, 0)
      .add(new THREE.IcosahedronGeometry(1.1, 0), 0x6fdc5a, 0.4, 4.0, 0.2)
      .build());
    this.instanced(treeGeo, trees, (i) => new THREE.Color().setHSL(0.27 + (i % 5) * 0.012, 0.9, 0.9 - (i % 3) * 0.06), true);

    // Lampadaires : deux coins opposés de chaque îlot bâti
    const lamps: THREE.Matrix4[] = [];
    const K = LOT / 2 + SIDEWALK / 2;
    for (const b of city.blocks) {
      for (const [sx, sz] of [[-1, -1], [1, 1]]) lamps.push(m.clone().compose(p.set(b.x + sx * K, 0.05, b.z + sz * K), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sx > 0 ? Math.PI : 0), s.set(1, 1, 1)));
    }
    const lampGeo = this.own(new PartBuilder()
      .box(0.16, 4.4, 0.16, 0x4b4f5c, 0, 2.2, 0)
      .box(1.1, 0.14, 0.14, 0x4b4f5c, 0.45, 4.38, 0)
      .box(0.6, 0.2, 0.36, 0xfff0a0, 0.9, 4.25, 0)
      .build());
    this.instanced(lampGeo, lamps, () => new THREE.Color(0xffffff), true);
  }

  /** InstancedMesh + coque de contour (qui partage la même matrice d'instance). */
  private instanced(geo: THREE.BufferGeometry, mats: THREE.Matrix4[], color: ((i: number) => THREE.Color) | null, hull: boolean, parent: THREE.Object3D = this.root, mat: THREE.Material = toonVC, hullT = 0.07) {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => { mesh.setMatrixAt(i, m); if (color) mesh.setColorAt(i, color(i)); });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    if (hull) {
      const h = new THREE.InstancedMesh(hullGeometry(geo, hullT), outlineMat, mats.length);
      h.instanceMatrix = mesh.instanceMatrix;
      parent.add(h);
    }
    return mesh;
  }


  // ---------- Détails de rue : enseignes de toit par quartier, panneaux de rue, bouches d'incendie (3 à 5 appels de dessin au total) ----------
  private buildDetails() {
    const city = getCity();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

    // Enseignes : planches inclinées au bord sud des toits (vers la caméra), texte toujours lisible de dessus ; un seul maillage global, un seul atlas
    const defs = SIGNS;
    const COLS = 4, ROWS = 4, CW = 256, CH = 128;
    const atlas = this.own(canvasTexture([CW * COLS, CH * ROWS], (g) => {
      g.fillStyle = '#14141f';
      g.fillRect(0, 0, CW * COLS, CH * ROWS);
      defs.forEach((d, i) => {
        const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
        g.fillStyle = d.bg; g.fillRect(x + 6, y + 6, CW - 12, CH - 12);
        g.strokeStyle = '#14141f'; g.lineWidth = 10; g.strokeRect(x + 5, y + 5, CW - 10, CH - 10);
        g.strokeStyle = d.fg; g.lineWidth = 4; g.strokeRect(x + 16, y + 16, CW - 32, CH - 32);
        let size = 62;
        g.font = `900 ${size}px Impact,"Arial Black",sans-serif`;
        const w = g.measureText(d.text).width;
        if (w > CW - 52) { size = Math.floor((size * (CW - 52)) / w); g.font = `900 ${size}px Impact,"Arial Black",sans-serif`; }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = '#14141f';
        g.strokeText(d.text, x + CW / 2, y + CH / 2 + 3);
        g.fillStyle = d.fg; g.fillText(d.text, x + CW / 2, y + CH / 2 + 3);
      });
    }, [1, 1]));
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    atlas.anisotropy = 8;
    const quad = (p0: number[], right: number[], up: number[], n: number[], cell: number, solid: boolean) => {
      const g = new THREE.BufferGeometry();
      const pos = [
        p0[0] - right[0], p0[1] - right[1], p0[2] - right[2],
        p0[0] + right[0], p0[1] + right[1], p0[2] + right[2],
        p0[0] + right[0] + up[0], p0[1] + right[1] + up[1], p0[2] + right[2] + up[2],
        p0[0] - right[0] + up[0], p0[1] - right[1] + up[1], p0[2] - right[2] + up[2],
      ];
      const cx = cell % COLS, cy = Math.floor(cell / COLS);
      const u0 = cx / COLS, u1 = (cx + 1) / COLS, v1 = 1 - cy / ROWS, v0 = 1 - (cy + 1) / ROWS;
      const e = solid ? 0.5 : 0;
      const uv = solid ? [u0 + (u1 - u0) * e, v0 + (v1 - v0) * e, u0 + (u1 - u0) * e, v0 + (v1 - v0) * e, u0 + (u1 - u0) * e, v0 + (v1 - v0) * e, u0 + (u1 - u0) * e, v0 + (v1 - v0) * e] : [u0, v0, u1, v0, u1, v1, u0, v1];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([...n, ...n, ...n, ...n], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    };
    const A = (55 * Math.PI) / 180, sinA = Math.sin(A), cosA = Math.cos(A);
    const signs: THREE.BufferGeometry[] = [];
    for (const b of city.buildings) {
      const blk = city.blocks[b.block];
      if (!blk || b.w < 9 || b.h < 5) continue;
      const h = Math.imul(b.id + 7, 2654435761) >>> 0;
      if ((h & 255) / 255 > 0.6) continue; // ~60 % des bâtiments donnant sur la rue au sud
      if (LOT / 2 - (b.z - blk.z + b.d / 2) > 7) continue; // le bord sud doit être celui de la rue
      const cell = DISTRICT_IDS.indexOf(b.district) * 3 + (h >> 8) % 3;
      const w2 = Math.min(b.w - 2, 7) / 2, hh = w2; // cellule 2:1
      const base = [b.x, b.h + 0.6, b.z + b.d / 2 - 0.3];
      const up = [0, hh * 2 * sinA, -hh * 2 * cosA], n = [0, cosA, sinA];
      this.signPos.push([b.x, b.z + b.d / 2]);
      signs.push(quad(base, [w2, 0, 0], up, n, cell, false));
      // dos noir un peu plus large : filet de contour et épaisseur
      signs.push(quad([base[0], base[1] - 0.14 * sinA - 0.03 * cosA, base[2] + 0.14 * cosA - 0.03 * sinA], [w2 + 0.22, 0, 0], [0, (hh * 2 + 0.28) * sinA, -(hh * 2 + 0.28) * cosA], n, 15, true));
    }
    if (signs.length) {
      const sm = new THREE.Mesh(this.own(mergeGeometries(signs)!), this.own(makeOccludable(new THREE.MeshBasicMaterial({ map: atlas, side: THREE.DoubleSide }))));
      sm.frustumCulled = false;
      this.root.add(sm);
      this.signCount = signs.length / 2;
    }

    // Bouches d'incendie : 1 à 2 par îlot, sur le trottoir (rouge, capuchon jaune)
    const hyd = this.own(new PartBuilder()
      .add(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 6), 0xe63946, 0, 0.3, 0)
      .add(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 6), 0xffd23f, 0, 0.66, 0)
      .box(0.5, 0.14, 0.14, 0xe63946, 0, 0.4, 0)
      .build());
    const hydrants: THREE.Matrix4[] = [];
    for (const b of city.blocks) {
      const r = Math.imul(b.id + 3, 2246822519) >>> 0;
      const sx = r & 1 ? 1 : -1, sz = r & 2 ? 1 : -1;
      hydrants.push(m.clone().compose(p.set(b.x + sx * (LOT / 2 + 1.4), 0.05, b.z + sz * 11), q.identity(), s));
      if (r & 4) hydrants.push(m.clone().compose(p.set(b.x - sz * 12, 0.05, b.z - sx * (LOT / 2 + 1.4)), q.identity(), s));
    }
    this.perChunk(hyd, hydrants);

    // Panneaux de rue : un poteau par carrefour (coin libre nord-est), deux plaques en croix, lisibles de loin
    const post = this.own(new PartBuilder()
      .box(0.1, 2.7, 0.1, 0x4b4f5c, 0, 1.35, 0)
      .box(1.3, 0.34, 0.05, 0x2e9e5b, 0, 2.55, 0)
      .box(1.1, 0.07, 0.06, 0xffffff, 0, 2.55, 0)
      .box(0.05, 0.34, 1.3, 0x2f80ed, 0, 2.15, 0)
      .box(0.06, 0.07, 1.1, 0xffffff, 0, 2.15, 0)
      .build());
    const posts: THREE.Matrix4[] = [];
    for (const n of city.nodes) {
      if (n.i === CITY.N || n.j === 0) continue; // côté ouest/sud de la ville : pas d'îlot de ce côté
      posts.push(m.clone().compose(p.set(n.x + 5.6, 0.05, n.z - 5.6), q.setFromAxisAngle(Y, ((n.i + n.j) % 4) * 0.2), s));
    }
    this.perChunk(post, posts);
  }

  /** Petits objets répétés : fusionnés par chunk (un maillage + sa coque par chunk), visibles seulement avec le chunk. */
  private perChunk(geo: THREE.BufferGeometry, mats: THREE.Matrix4[]) {
    const city = getCity();
    const per = new Map<number, THREE.BufferGeometry[]>();
    const p = new THREE.Vector3();
    for (const m of mats) {
      p.setFromMatrixPosition(m);
      const id = city.chunkOf(p.x, p.z).id;
      (per.get(id) ?? per.set(id, []).get(id)!).push(geo.clone().applyMatrix4(m));
    }
    for (const [id, list] of per) {
      const merged = this.own(mergeGeometries(list)!);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, toonVC);
      const hull = new THREE.Mesh(this.own(hullGeometry(merged, 0.05)), outlineMat);
      this.chunks[id].group.add(mesh, hull);
    }
  }
  /** Nombre d'enseignes posées (pour les tests). */
  signCount = 0;
  /** Positions (x, z du bord sud du toit) des enseignes, pour les tests et les captures. */
  readonly signPos: [number, number][] = [];

  // ---------- Chunks : bâtiments + toits ----------
  private buildChunks() {
    const city = getCity();
    const per: typeof city.buildings[] = Array.from({ length: CHUNKS_PER_SIDE * CHUNKS_PER_SIDE }, () => []);
    for (const b of city.buildings) per[city.chunkOf(b.x, b.z).id].push(b);
    const wallMat = this.own(buildingMaterial());
    const roofMat = this.own(makeOccludable(toonRaw({})));
    const unit = boxGeo(1, 1, 1);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const list = per[cz * CHUNKS_PER_SIDE + cx];
        const group = new THREE.Group();
        group.visible = false;
        if (list.length) {
          const walls = new THREE.InstancedMesh(unit, wallMat, list.length);
          const roofs = new THREE.InstancedMesh(unit, roofMat, list.length);
          list.forEach((b, i) => {
            walls.setMatrixAt(i, m.compose(p.set(b.x, b.h / 2, b.z), q.identity(), s.set(b.w, b.h, b.d)));
            walls.setColorAt(i, new THREE.Color(punch(b.color)));
            roofs.setMatrixAt(i, m.compose(p.set(b.x, b.h + 0.3, b.z), q.identity(), s.set(b.w + 1.2, 0.6, b.d + 1.2)));
            roofs.setColorAt(i, new THREE.Color(mix(DISTRICTS[b.district].color, 0x14141f, 0.15)));
          });
          walls.instanceMatrix.needsUpdate = roofs.instanceMatrix.needsUpdate = true;
          const wh = new THREE.InstancedMesh(unit, boxHullMat, list.length);
          const rh = new THREE.InstancedMesh(unit, boxHullMat, list.length);
          wh.instanceMatrix = walls.instanceMatrix;
          rh.instanceMatrix = roofs.instanceMatrix;
          group.add(walls, wh, roofs, rh);
        }
        this.chunks.push({ cx, cz, group });
        this.root.add(group);
      }
    }
  }

  // ---------- Quai, eau ----------
  private buildShore() {
    const E = BORDER + 3;
    const pb = new PartBuilder();
    const L = 2 * E + 8;
    pb.box(L, 1.2, 3.2, 0xb9b4a6, 0, -0.25, -(E + 1.6)).box(L, 1.2, 3.2, 0xb9b4a6, 0, -0.25, E + 1.6)
      .box(3.2, 1.2, L, 0xb9b4a6, -(E + 1.6), -0.25, 0).box(3.2, 1.2, L, 0xb9b4a6, E + 1.6, -0.25, 0);
    // bornes d'amarrage colorées
    const colors = DISTRICT_IDS.map((d) => DISTRICTS[d].color);
    for (let i = -300; i <= 300; i += 60) {
      const c = colors[Math.abs(i / 60) % colors.length];
      pb.box(0.8, 0.8, 0.8, c, i, 0.7, -(E + 1.6)).box(0.8, 0.8, 0.8, c, i, 0.7, E + 1.6).box(0.8, 0.8, 0.8, c, -(E + 1.6), 0.7, i).box(0.8, 0.8, 0.8, c, E + 1.6, 0.7, i);
    }
    const quay = new THREE.Mesh(this.own(pb.build()), toonVC);
    this.root.add(quay);
    this.waterTex = this.own(waterTexture());
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), this.own(new THREE.MeshBasicMaterial({ map: this.waterTex })));
    this.water.position.y = -0.55;
    this.water.renderOrder = -1;
    this.root.add(this.water);
  }

  dispose(): void {
    this.scene.remove(this.root);
    OCC.foc.value.set(0, 0, 0, 0); OCC.box.value.set(0, 0, -1, -1);
    for (const o of this.owned) o.dispose();
    this.owned = [];
  }
}

/** Fusionne des géométries indexées de mêmes attributs. */
function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.getAttribute('position').count; ni += g.index!.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), t = g.getAttribute('uv'), ix = g.index!;
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (vo + i) * 3);
      nor.set([n.getX(i), n.getY(i), n.getZ(i)], (vo + i) * 3);
      uv.set([t.getX(i), t.getY(i)], (vo + i) * 2);
    }
    for (let i = 0; i < ix.count; i++) idx[io + i] = ix.getX(i) + vo;
    vo += p.count; io += ix.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
