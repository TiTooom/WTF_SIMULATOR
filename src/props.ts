// Dessin des props (PropKind du registre) : un mesh par id, créé/supprimé selon le snapshot.
import * as THREE from 'three';
import { PROP_STRIDE } from '../shared/protocol';
import { wedgeVertices, type PropKind } from '../shared/props';
import { PROP_KINDS } from '../shared/registry';
import { outlined, toon, toonRaw } from './gfx';

function wedgeGeometry(w: number, h: number, l: number): THREE.BufferGeometry {
  const v = wedgeVertices(w, h, l);
  const P = (i: number) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  // triangles orientés vers l'extérieur : dessous, fond, pente, flancs
  const tris = [[0, 2, 1], [1, 2, 3], [2, 4, 3], [3, 4, 5], [0, 1, 5], [0, 5, 4], [0, 4, 2], [1, 3, 5]];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...P(i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function geometryFor(k: PropKind): THREE.BufferGeometry {
  const [a, b, c] = k.size;
  switch (k.shape) {
    case 'sphere': return new THREE.SphereGeometry((a || 1) / 2, 16, 12);
    case 'cylinder': return new THREE.CylinderGeometry((a || 1) / 2, (a || 1) / 2, b ?? a ?? 1, 14);
    case 'wedge': return wedgeGeometry(a || 1, b ?? 1, c ?? 1);
    default: return new THREE.BoxGeometry(a || 1, b ?? a ?? 1, c ?? a ?? 1);
  }
}

interface KindGfx {
  geo: THREE.BufferGeometry;
  mats: THREE.Material[]; // 0 normal, 1 gelé, 2 tenu
}

const FROZEN_TINT = new THREE.Color(0x8fd0ff);

function makeMats(k: PropKind): THREE.Material[] {
  const base = new THREE.Color(k.color);
  const frozen = base.clone().lerp(FROZEN_TINT, 0.45);
  const held = base.clone().lerp(new THREE.Color(0xffffff), 0.25);
  if (k.glow) {
    return [new THREE.MeshBasicMaterial({ color: base }), new THREE.MeshBasicMaterial({ color: frozen }), new THREE.MeshBasicMaterial({ color: held })];
  }
  const heldMat = toonRaw({ color: held.getHex(), emissive: 0xffe27a, emissiveIntensity: 0.45 });
  return [toon(k.color), toon(frozen.getHex()), heldMat];
}

export class PropsView {
  private gfx = new Map<number, KindGfx>(); // par index de kind
  private meshes = new Map<number, { mesh: THREE.Mesh; kind: number; flags: number }>();
  /** Nombre de props dessinés (tests). */
  count = 0;
  private fallback: KindGfx | null = null;

  constructor(private scene: THREE.Scene) {}

  private gfxFor(kind: number): KindGfx {
    let g = this.gfx.get(kind);
    if (g) return g;
    const k: PropKind | undefined = PROP_KINDS[kind];
    if (!k) {
      // kind inconnu (contenu pas encore chargé) : petit cube gris
      return (this.fallback ??= { geo: new THREE.BoxGeometry(0.6, 0.6, 0.6), mats: makeMats({ id: '?', name: '?', shape: 'box', size: [0.6], color: 0xaaaaaa, mass: 1 }) });
    }
    g = { geo: geometryFor(k), mats: makeMats(k) };
    this.gfx.set(kind, g);
    return g;
  }

  /** `data` : props interpolés (PROP_STRIDE nombres chacun). */
  update(data: Float32Array) {
    const n = Math.floor(data.length / PROP_STRIDE);
    const seen = new Set<number>();
    for (let c = 0; c < n; c++) {
      const o = c * PROP_STRIDE;
      const id = data[o], kind = data[o + 1], flags = data[o + 9] | 0;
      seen.add(id);
      let e = this.meshes.get(id);
      if (!e || e.kind !== kind) {
        if (e) this.scene.remove(e.mesh);
        const g = this.gfxFor(kind);
        const mesh = outlined(new THREE.Mesh(g.geo, g.mats[0]), 0.03);
        e = { mesh, kind, flags: 0 };
        this.meshes.set(id, e);
        this.scene.add(mesh);
      }
      if (e.flags !== flags) {
        e.flags = flags;
        e.mesh.material = this.gfxFor(kind).mats[flags & 2 ? 2 : flags & 1 ? 1 : 0];
      }
      e.mesh.position.set(data[o + 2], data[o + 3], data[o + 4]);
      e.mesh.quaternion.set(data[o + 5], data[o + 6], data[o + 7], data[o + 8]);
    }
    for (const [id, e] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(e.mesh);
        this.meshes.delete(id);
      }
    }
    this.count = this.meshes.size;
  }
}
