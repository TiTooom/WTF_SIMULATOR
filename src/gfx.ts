import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Rendu cel-shading BD : matériaux toon à 3 bandes (gradientMap partagé), contours noirs par coque inversée, sans ombres.
// Bandes : ombre franche / ton moyen / lumière pleine (valeurs du gradientMap, lues en "Nearest" donc sans dégradé).
export const TOON_BANDS = [95, 170, 255];
const gradient = new THREE.DataTexture(new Uint8Array(TOON_BANDS), TOON_BANDS.length, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.generateMipmaps = false;
gradient.needsUpdate = true;

/** Palette « BD » : saturation poussée (x1.15), valeurs légèrement contrastées. */
const hsl = { h: 0, s: 0, l: 0 };
const punchColor = new THREE.Color();
export function punch(color: number): number {
  punchColor.setHex(color).getHSL(hsl);
  if (hsl.s < 0.08) return color; // blancs, gris, noirs : inchangés
  return punchColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.min(0.9, Math.max(0.1, (hsl.l - 0.5) * 1.08 + 0.5))).getHex();
}

// Fabrique commune : un matériau partagé par couleur (ne jamais le modifier ; utiliser toonRaw pour un matériau à soi).
const toonCache = new Map<number, THREE.MeshToonMaterial>();
export const toon = (color: number, map?: THREE.Texture): THREE.MeshToonMaterial => {
  if (map) return new THREE.MeshToonMaterial({ color, gradientMap: gradient, map });
  let m = toonCache.get(color);
  if (!m) toonCache.set(color, (m = new THREE.MeshToonMaterial({ color: punch(color), gradientMap: gradient })));
  return m;
};
export const toonRaw = (params: THREE.MeshToonMaterialParameters) =>
  new THREE.MeshToonMaterial({ gradientMap: gradient, ...params });

// ---------- Contours : coque inversée ----------
export const OUTLINE_COLOR = 0x14141f;
/** Épaisseur du contour : constante (en mètres) jusqu'à OUTLINE_NEAR de la caméra, puis proportionnelle à la distance (écran constant), plafonnée. */
export const OUTLINE_NEAR = 16;
export const OUTLINE_MAX_GROWTH = 3.2;

/** Matériau unique partagé : extrude chaque sommet le long de sa normale (longueur de la normale = épaisseur en m). */
export const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
outlineMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace(
    '#include <begin_vertex>',
    `vec3 transformed = vec3(position);
    #ifdef USE_INSTANCING
      vec4 oMv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 oMv = modelViewMatrix * vec4(position, 1.0);
    #endif
    transformed += normal * clamp(-oMv.z / ${OUTLINE_NEAR.toFixed(1)}, 1.0, ${OUTLINE_MAX_GROWTH.toFixed(1)});`,
  );
};
outlineMat.customProgramCacheKey = () => 'outline-hull';

const hullCache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();
/** Géométrie de coque : mêmes positions/index, normales LISSÉES (sommets confondus fusionnés, sinon les coins des cubes s'ouvrent) et mises à la longueur t. */
export function hullGeometry(geo: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  let per = hullCache.get(geo);
  if (!per) hullCache.set(geo, (per = new Map()));
  const key = Math.round(t * 1000);
  let h = per.get(key);
  if (h) return h;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  const acc = new Map<string, [number, number, number]>();
  const k = (i: number) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(k(i)) ?? acc.set(k(i), [0, 0, 0]).get(k(i))!;
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(k(i))!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = (a[0] / l) * t; out[i * 3 + 1] = (a[1] / l) * t; out[i * 3 + 2] = (a[2] / l) * t;
  }
  h = new THREE.BufferGeometry();
  h.setAttribute('position', pos);
  h.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  if (geo.index) h.setIndex(geo.index);
  per.set(key, h);
  return h;
}

/** Ajoute un contour noir (coque inversée) à un mesh. `t` = épaisseur de base en mètres (monde, avant le facteur de distance). */
export function outlined<T extends THREE.Mesh>(mesh: T, t = 0.05): T {
  const o = new THREE.Mesh(hullGeometry(mesh.geometry, t), outlineMat);
  o.matrixAutoUpdate = false; // coque fixe par rapport au mesh
  o.updateMatrix();
  mesh.add(o);
  return mesh;
}

// Les cubes de véhicules sont très répétés : géométrie partagée par dimensions.
const boxGeoCache = new Map<string, THREE.BoxGeometry>();
export const boxGeo = (w: number, h: number, d: number) => {
  const k = `${w},${h},${d}`;
  let g = boxGeoCache.get(k);
  if (!g) boxGeoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
};

export function box(
  parent: THREE.Object3D, w: number, h: number, d: number, color: number,
  x: number, y: number, z: number, outline = true,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d), toon(color));
  m.position.set(x, y, z);
  if (outline) outlined(m, 0.04);
  parent.add(m);
  return m;
}

export function canvasTexture(size: [number, number], draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]) {
  const c = document.createElement('canvas');
  [c.width, c.height] = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(...repeat);
  return t;
}

// ---------- Visibilité du joueur : estompage des bâtiments (dithering) entre la caméra et le joueur ----------
/**
 * Uniforms partagés par tous les matériaux « occultables » (bâtiments, toits, contours, enseignes). `foc` = (x, y, z, rayon) du joueur suivi,
 * rayon 0 = désactivé. Renseignés par CityView à chaque image. Tout fragment situé dans le cylindre (rayon) entre la caméra et le joueur
 * est tramé (jamais plus de 90 % retiré : le bâtiment reste lisible).
 */
export const OCC = { cam: { value: new THREE.Vector3() }, foc: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** Empreinte (cx, cz, demi-largeur, demi-profondeur) du bâtiment qui contient la caméra (la vue est alors DANS le bâtiment) ; demi-largeur ≤ 0 = aucun. */
  box: { value: new THREE.Vector4(0, 0, -1, -1) } };
export const OCC_MAX_FADE = 0.9;

/** Rend un matériau transparent par trame (discard) autour de l'axe caméra → joueur. `ownVertex` : le matériau écrit lui-même `vOccP` (position monde). */
export function makeOccludable<T extends THREE.Material>(m: T, ownVertex = false): T {
  const prev = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uOccCam = OCC.cam;
    sh.uniforms.uOccFoc = OCC.foc;
    sh.uniforms.uOccBox = OCC.box;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOccP;');
    if (!ownVertex) {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 occW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          occW = instanceMatrix * occW;
        #endif
        vOccP = (modelMatrix * occW).xyz;`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOccP;\nuniform vec3 uOccCam;\nuniform vec4 uOccFoc;\nuniform vec4 uOccBox;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uOccBox.z > 0.0 && abs(vOccP.x - uOccBox.x) < uOccBox.z && abs(vOccP.z - uOccBox.y) < uOccBox.w) {
          // la caméra est dans ce bâtiment : il devient un fantôme (sinon l'écran est rempli par l'intérieur noir)
          if (0.97 > fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
        }
        if (uOccFoc.w > 0.0) {
          vec3 oAx = uOccFoc.xyz - uOccCam;
          float oL = length(oAx);
          vec3 oD = oAx / max(oL, 0.001);
          vec3 oP = vOccP - uOccCam;
          float oS = dot(oP, oD);
          float oR = length(oP - oD * oS);
          float oA = (1.0 - smoothstep(uOccFoc.w * 0.5, uOccFoc.w, oR)) * (1.0 - smoothstep(oL - 1.0, oL + 2.5, oS)) * ${OCC_MAX_FADE.toFixed(2)};
          float oN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (oA > oN) discard;
        }`);
  };
  m.customProgramCacheKey = () => key() + '+occ';
  return m;
}

/**
 * Silhouette « rayons X » : redessine les cibles (joueur local, coéquipiers) en aplat translucide, UNIQUEMENT là où elles sont cachées par le décor
 * (test de profondeur inversé). Usage : `xray.clear(); xray.add(groupe, couleur, opacité)...; renderer.render(scene, camera); xray.render();`.
 * Coût : un second rendu des seuls maillages cibles (contours et sprites exclus), ≈ 10-25 appels de dessin ; aucun asset.
 */
export class XRay {
  static readonly MAX = 6;
  private items: { g: THREE.Object3D; color: number; alpha: number }[] = [];
  private tagged: { o: THREE.Object3D; layer: number }[] = [];
  private readonly mat = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  clear(): void {
    for (const t of this.tagged) t.o.layers.disable(t.layer);
    this.tagged.length = 0;
    this.items.length = 0;
  }
  add(g: THREE.Object3D, color: number, alpha = 0.55): void {
    if (this.items.length >= XRay.MAX || !g.visible) return;
    const layer = 1 + this.items.length;
    this.items.push({ g, color, alpha });
    g.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh || (o as THREE.Mesh).material === outlineMat || !o.visible) return;
      o.layers.enable(layer);
      this.tagged.push({ o, layer });
    });
  }
  render(): void {
    if (!this.items.length) return;
    const r = this.renderer, s = this.scene, cam = this.camera;
    const bg = s.background, fog = s.fog, ac = r.autoClear, ar = r.info.autoReset, mask = cam.layers.mask;
    s.background = null; s.fog = null; r.autoClear = false; r.info.autoReset = false; s.overrideMaterial = this.mat;
    this.items.forEach((it, i) => {
      this.mat.color.setHex(it.color);
      this.mat.opacity = it.alpha;
      cam.layers.set(1 + i);
      r.render(s, cam);
    });
    s.overrideMaterial = null; s.background = bg; s.fog = fog; r.autoClear = ac; r.info.autoReset = ar; cam.layers.mask = mask;
  }
  dispose(): void { this.clear(); this.mat.dispose(); }
}

// ---------- Vague 2 : matériaux à couleurs de sommets, contours de boîtes instanciées, assemblage de pièces ----------

/** Matériau toon partagé pour les géométries à couleurs de sommets (et/ou `instanceColor`). Ne jamais le modifier. */
export const toonVC = toonRaw({ vertexColors: true });

/**
 * Contour des boîtes UNITAIRES instanciées (bâtiments, toits, trottoirs) : chaque sommet est d'abord placé par la matrice d'instance
 * (échelle comprise), PUIS repoussé de `±t` sur chaque axe (signe de la position locale) : épaisseur uniforme quelle que soit la taille de la boîte.
 * Modulée par la distance comme `outlineMat`. À utiliser avec `new InstancedMesh(boxGeo(1,1,1), boxHullMat, n)` partageant `instanceMatrix`.
 */
export const BOX_HULL_BASE = 0.14;
export const boxHullMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
boxHullMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace(
    '#include <project_vertex>',
    `vec4 bp = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      bp = instanceMatrix * bp;
    #endif
    float bz = -(modelViewMatrix * bp).z;
    bp.xyz += sign(position) * (${BOX_HULL_BASE.toFixed(3)} * clamp(bz / ${OUTLINE_NEAR.toFixed(1)}, 1.0, ${OUTLINE_MAX_GROWTH.toFixed(1)}));
    vec4 mvPosition = modelViewMatrix * bp;
    vOccP = (modelMatrix * bp).xyz;
    gl_Position = projectionMatrix * mvPosition;`,
  );
};
boxHullMat.customProgramCacheKey = () => 'box-hull';
makeOccludable(boxHullMat, true);

/** Assemble des boîtes colorées en UNE géométrie (couleurs de sommets) : un seul appel de dessin au lieu d'un par pièce. `paint` marque les sommets repeignables. */
export class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private col = new THREE.Color();
  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, paint = false, rotY = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    this.col.setHex(punch(color));
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3), p = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = this.col.r; c[i * 3 + 1] = this.col.g; c[i * 3 + 2] = this.col.b; p[i] = paint ? 1 : 0; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('paint', new THREE.BufferAttribute(p, 1));
    this.parts.push(g);
    return this;
  }
  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, paint = false): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, paint);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return g;
  }
}

/** Réécrit la couleur des sommets repeignables (attribut `paint` = 1) d'une géométrie construite par PartBuilder. */
export function repaint(geo: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color().setHex(punch(color));
  const col = geo.getAttribute('color') as THREE.BufferAttribute, paint = geo.getAttribute('paint');
  for (let i = 0; i < col.count; i++) if (paint.getX(i) > 0.5) col.setXYZ(i, c.r, c.g, c.b);
  col.needsUpdate = true;
}
