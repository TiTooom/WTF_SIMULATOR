// Rendu de la ville (PROPRIÉTAIRE : art-toon). Données : shared/city/layout.ts (identiques serveur/client).
//  - Sol, trottoirs, rues, marquages, arbres, lampadaires, quai et eau : maillages fusionnés GLOBAUX (peu de sommets, ~12 appels de dessin).
//  - Bâtiments et toits : 25 chunks (CITY.CHUNK = 128 m) construits UNE fois, en `InstancedMesh` (+ coque de contour instanciée),
//    seuls les 3×3 chunks autour du point suivi sont visibles (≈ 36 appels de dessin).
//  - Couleurs de quartier : toits (couleur du quartier), sols et palette des façades. Fenêtres : motif calculé dans le shader (aucune texture).
import * as THREE from 'three';
import { seeded } from '../../shared/constants';
import { CHUNKS_PER_SIDE, CITY, getCity } from '../../shared/city/layout';
import { DISTRICTS } from '../../shared/city/districts';
import { DISTRICT_IDS } from '../../shared/ids';
import { PartBuilder, boxGeo, boxHullMat, canvasTexture, hullGeometry, outlineMat, punch, toon, toonRaw, toonVC } from '../gfx';

const { CELL, ROAD, SIDEWALK, LOT, BORDER } = CITY;
export const FOG_COLOR = 0x9fd3ff;
export const FOG_NEAR = 45;
export const FOG_FAR = 150;

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
  return m;
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

  constructor(private scene: THREE.Scene) {
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.buildGround();
    this.buildScenery();
    this.buildChunks();
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
    if (typeof xOrFocus === 'number') { x = xOrFocus; zz = z ?? 0; } else { x = xOrFocus[0]; zz = xOrFocus[2]; }
    if (!Number.isFinite(x) || !Number.isFinite(zz)) return;
    this.manual = true;
    this.setFocus(x, zz);
  }

  private autoFollow(cam: THREE.Camera) {
    this.scrollWater();
    if (this.manual) return;
    cam.getWorldPosition(this.tmpPos);
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

  // ---------- Chunks : bâtiments + toits ----------
  private buildChunks() {
    const city = getCity();
    const per: typeof city.buildings[] = Array.from({ length: CHUNKS_PER_SIDE * CHUNKS_PER_SIDE }, () => []);
    for (const b of city.buildings) per[city.chunkOf(b.x, b.z).id].push(b);
    const wallMat = this.own(buildingMaterial());
    const roofMat = this.own(toonRaw({}));
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
