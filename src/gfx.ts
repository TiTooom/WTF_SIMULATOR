import * as THREE from 'three';

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
export const OUTLINE_MAX_GROWTH = 4;

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
