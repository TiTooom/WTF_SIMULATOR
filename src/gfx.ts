import * as THREE from 'three';

// Rendu cartoon léger : matériaux toon à 3 tons + contours noirs, sans ombres.
const gradient = new THREE.DataTexture(new Uint8Array([110, 180, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

export const toon = (color: number, map?: THREE.Texture) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...(map ? { map } : {}) });
export const toonRaw = (params: THREE.MeshToonMaterialParameters) =>
  new THREE.MeshToonMaterial({ gradientMap: gradient, ...params });

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b1b2b, side: THREE.BackSide });
export function outlined<T extends THREE.Mesh>(mesh: T, t = 0.05): T {
  mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.set(1 + (2 * t) / Math.max(s.x, 0.1), 1 + (2 * t) / Math.max(s.y, 0.1), 1 + (2 * t) / Math.max(s.z, 0.1));
  mesh.add(o);
  return mesh;
}

export function box(
  parent: THREE.Object3D, w: number, h: number, d: number, color: number,
  x: number, y: number, z: number, outline = true,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
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
