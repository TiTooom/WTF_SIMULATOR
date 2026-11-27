// Repères en monde (PROPRIÉTAIRE : art-toon), à partir de `PrivateState.marks` (≤ 16) :
//  - anneau pulsant au sol + colonne de lumière + losange qui flotte (couleur selon le type) ;
//  - flèche au bord de l'écran (DOM, textContent) pour les repères importants hors champ : mission, cp, cible, activite, danger, flic.
//
// API pour main.ts :
//   const markers = new MarkersView(scene, camera);          // une fois
//   markers.update(me.marks, dt, playerPos);                  // à chaque image ; playerPos = [x, y, z] du joueur ou du véhicule (distance affichée)
//   markers.setVisible(false) pendant la pause ; markers.dispose() au départ.
// Lisibilité : taille liée à la distance à la CAMÉRA (CameraRig de src/camera.ts), icône basse (elle ne sort plus du cadre avant son anneau), faisceau court ;
// repère hors cadre (icône ou glyphe) : flèche de bord + distance, esquivant mini-carte et panneau de mission ; à l'écran : distance au-dessus du glyphe (mission, cp, cible, activité, danger, flic).
// Glyphes : € dealer, P planque, ★ flic, ! contact/mission, ✕ cible, ▶ cp, $ activité.
// Flics : `k: 'danger'` + `label: 'flic'` (convention du système police) ou `k: 'flic'` : le repère alterne rouge/bleu (4 Hz) et sa flèche de bord aussi.
// Types acceptés : ceux de `Mark['k']` + 'cp' (point de passage), 'flic', 'activite' (si le serveur les ajoute).
import * as THREE from 'three';
import type { Mark } from '../shared/protocol';
import { boxHullMat, hullGeometry, makeOccludable, outlineMat, toon, toonRaw } from './gfx';

export type MarkKind = Mark['k'] | 'cp' | 'flic' | 'activite';
export const MARK_COLORS: Record<MarkKind, number> = {
  mission: 0xffd23f, cp: 0x3ddc84, cible: 0xff3b30, danger: 0xff3b30, dealer: 0xb15cff, planque: 0x2ec4b6,
  camera: 0xff8fc8, donneur: 0xff9f1c, hopital: 0xffffff, commissariat: 0x2f80ed, flic: 0x2f80ed, activite: 0x00d0ff, autre: 0xc8c8d8,
};
const ARROW_KINDS = new Set<string>(['mission', 'cp', 'cible', 'activite', 'danger', 'flic']);
/** Repères secondaires : flèche de bord seulement s'ils sont proches (m). */
const ARROW_NEAR: Partial<Record<string, number>> = { dealer: 90, planque: 90 };
const GLYPHS: Partial<Record<string, string>> = { dealer: '€', planque: 'P', flic: '★', donneur: '!', mission: '!', cible: '✕', danger: '!', cp: '▶', activite: '$', camera: 'C', hopital: '+', commissariat: '★' };
const COP_RED = 0xff2a2a, COP_BLUE = 0x2a6bff;
const glyphTex = new Map<string, THREE.CanvasTexture>();
function glyphTexture(ch: string, color: number): THREE.CanvasTexture {
  const key = ch + color;
  let t = glyphTex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fill();
  g.lineWidth = 10; g.strokeStyle = '#14141f'; g.stroke();
  g.font = '900 78px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = '#14141f'; g.strokeText(ch, 64, 70);
  g.fillStyle = '#fff'; g.fillText(ch, 64, 70);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glyphTex.set(key, t);
  return t;
}
const MAX_MARKS = 16;
const SHOW_DIST = 240;

interface Slot { glyph: THREE.Sprite; group: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh; icon: THREE.Mesh; arrow: HTMLDivElement; tri: HTMLDivElement; txt: HTMLDivElement; kind: string }

const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0); // hauteur = échelle y
const iconGeo = new THREE.OctahedronGeometry(0.9, 0).scale(1, 1.5, 1);

export class MarkersView {
  private slots: Slot[] = [];
  private overlay: HTMLDivElement;
  private t = 0;
  private v = new THREE.Vector3();
  private mats = new Map<number, { ring: THREE.MeshBasicMaterial; beam: THREE.MeshBasicMaterial }>();
  private visible = true;

  constructor(private scene: THREE.Scene, private camera?: THREE.Camera) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:8;overflow:hidden';
    document.body.appendChild(this.overlay);
  }

  setCamera(c: THREE.Camera) { this.camera = c; }
  setVisible(v: boolean) {
    this.visible = v;
    this.overlay.style.display = v ? '' : 'none';
    for (const s of this.slots) if (!v) { s.group.visible = false; s.arrow.style.display = 'none'; }
  }

  private matsFor(color: number) {
    let m = this.mats.get(color);
    if (!m) {
      m = {
        ring: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, fog: false }),
        beam: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      };
      this.mats.set(color, m);
    }
    return m;
  }

  private makeSlot(): Slot {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, this.matsFor(0xffffff).ring);
    ring.position.y = 0.12;
    ring.renderOrder = 2;
    const beam = new THREE.Mesh(beamGeo, this.matsFor(0xffffff).beam);
    beam.renderOrder = 1;
    const icon = new THREE.Mesh(iconGeo, toon(0xffffff));
    icon.add(new THREE.Mesh(hullGeometry(iconGeo, 0.06), outlineMat));
    const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, fog: false }));
    glyph.renderOrder = 15;
    glyph.visible = false;
    group.add(ring, beam, icon, glyph);
    group.visible = false;
    this.scene.add(group);
    const arrow = document.createElement('div');
    arrow.style.cssText = 'position:absolute;display:none;transform:translate(-50%,-50%);text-align:center;font:800 13px "Segoe UI",sans-serif;color:#fff;white-space:nowrap;text-shadow:0 0 3px #000,0 1px 2px #000,0 0 2px #000';
    const tri = document.createElement('div');
    tri.style.cssText = 'width:0;height:0;margin:0 auto;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:26px solid #fff;filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000)';
    const txt = document.createElement('div');
    arrow.append(tri, txt);
    this.overlay.appendChild(arrow);
    return { glyph, group, ring, beam, icon, arrow, tri, txt, kind: '' };
  }

  update(marks: readonly Mark[], dt: number, focus?: readonly number[]): void {
    this.t += dt;
    const n = this.visible ? Math.min(marks.length, MAX_MARKS) : 0;
    while (this.slots.length < n) this.slots.push(this.makeSlot());
    const cam = this.camera;
    const W = innerWidth, H = innerHeight;
    const cp = cam ? cam.position : null;
    let pushed = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const m = i < n ? marks[i] : null;
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) { s.group.visible = false; s.arrow.style.display = 'none'; continue; }
      let kind = (m.k in MARK_COLORS ? m.k : 'autre') as MarkKind;
      if (kind === 'danger' && m.label === 'flic') kind = 'flic';
      const phase = Math.floor(this.t * 4) & 1;
      const color = kind === 'flic' ? (phase ? COP_RED : COP_BLUE) : MARK_COLORS[kind];
      const key = kind === 'flic' ? 'flic' + phase : kind;
      if (s.kind !== key) {
        s.kind = key;
        const gl = GLYPHS[kind];
        s.glyph.visible = !!gl;
        if (gl) s.glyph.material.map = glyphTexture(gl, color);
        s.glyph.material.needsUpdate = true;
        const mm = this.matsFor(color);
        s.ring.material = mm.ring;
        s.beam.material = mm.beam;
        s.icon.material = toon(color);
        s.tri.style.borderBottomColor = '#' + color.toString(16).padStart(6, '0');
      }
      const dist = focus ? Math.hypot(m.x - focus[0], m.z - focus[2]) : cp ? Math.hypot(m.x - cp.x, m.z - cp.z) : 0;
      const near = !focus && !cam ? true : dist < SHOW_DIST;
      s.group.visible = near;
      s.group.position.set(m.x, 0, m.z);
      // Échelle liée à la distance à la CAMÉRA (et non au joueur) : taille écran à peu près constante, quelle que soit la hauteur de la caméra
      const cd = cp ? Math.hypot(m.x - cp.x, cp.y, m.z - cp.z) : 20;
      const k = Math.max(0.8, Math.min(5, cd / 17));
      const pulse = 1 + 0.12 * Math.sin(this.t * 4 + i);
      const big = (kind === 'mission' || kind === 'cp' || kind === 'cible' ? 3.6 : kind === 'flic' ? 2.6 : kind === 'activite' ? 3.2 : 2.4) * Math.max(1, cd / 60);
      s.ring.scale.set(big * pulse, 1, big * pulse);
      // Faisceau court : il guide l'oeil sans traverser tout l'écran quand la caméra est au-dessus
      s.beam.scale.set(big * 0.3, 4 + 3 * k, big * 0.3);
      const bob = Math.sin(this.t * 2.4 + i) * 0.25 * k;
      const iy = 1.1 + 0.9 * k + bob; // l'icône reste proche du sol : elle ne sort plus du cadre avant son anneau
      s.icon.scale.setScalar(k * 0.6);
      s.icon.position.y = iy;
      s.glyph.position.y = iy + 1.3 * k;
      s.glyph.scale.setScalar(1.35 * k);
      s.icon.rotation.y = this.t * 1.6;

      // Flèche au bord de l'écran (hors champ) ou étiquette de distance (à l'écran) pour les repères importants
      let showArrow = false;
      if (cam && (ARROW_KINDS.has(kind) || dist < (ARROW_NEAR[kind] ?? 0))) {
        this.v.set(m.x, iy + 1.3 * k, m.z).project(cam);
        const behind = this.v.z > 1;
        let dx = this.v.x, dy = this.v.y;
        if (behind) { dx = -dx; dy = -dy; }
        const off = behind || Math.abs(dx) > 0.9 || Math.abs(dy) > 0.84; // l'icône ET son glyphe doivent tenir dans le cadre
        const label = (m.label ? m.label + ' · ' : '') + Math.round(dist) + ' m';
        if (off) {
          const len = Math.max(Math.abs(dx) / 0.9, Math.abs(dy) / 0.82, 1e-4);
          const ex = dx / len, ey = dy / len;
          let px = (0.5 + ex * 0.5) * W, py = (0.5 - ey * 0.5) * H;
          // Évite le bloc mini-carte / étoiles (bas droite) : on décale vers la gauche ou vers le haut, le plus court
          if (px > W - 240 && py > H - 400) { if (px - (W - 245) < py - (H - 405)) px = W - 245; else py = H - 405; }
          // Évite aussi l'objectif (haut gauche) et le panneau de guidage / les bandeaux (haut centre)
          if (py < 130 && px < 370) py = 130 + 36 * pushed++;
          else if (py < 140 && Math.abs(px - W / 2) < 300) { px = W / 2 + (px < W / 2 ? -300 : 300); py += 36 * pushed++; } // décalées de côté, empilées si plusieurs
          s.arrow.style.left = `${px}px`;
          s.arrow.style.top = `${py}px`;
          s.tri.style.display = '';
          s.tri.style.transform = `rotate(${(Math.atan2(ex * W, ey * H) * 180) / Math.PI}deg)`;
          s.txt.textContent = label;
          showArrow = true;
        } else if (dist > 14 && ARROW_KINDS.has(kind)) {
          // à l'écran : seulement la distance, au-dessus du glyphe
          this.v.set(m.x, iy + 2.9 * k, m.z).project(cam);
          s.arrow.style.left = `${(0.5 + this.v.x * 0.5) * W}px`;
          s.arrow.style.top = `${(0.5 - this.v.y * 0.5) * H - 8}px`;
          s.tri.style.display = 'none';
          s.txt.textContent = label;
          showArrow = true;
        }
      }
      s.arrow.style.display = showArrow ? '' : 'none';
    }
  }

  dispose(): void {
    for (const s of this.slots) { this.scene.remove(s.group); s.glyph.material.dispose(); }
    this.slots = [];
    this.overlay.remove();
    for (const m of this.mats.values()) { m.ring.dispose(); m.beam.dispose(); }
    this.mats.clear();
  }
}

// ---------- Cachettes et champs de vision (vague « furtivité ») ----------
/** Une cachette (liste fournie par `shared/hiding.ts`) : centre (x, z), rayon de la zone (m) et type d'abri. */
export interface HidingSpotView { x: number; z: number; r: number; kind: 'haie' | 'buisson' | 'benne' | 'abri' | 'ruelle' | string }
/** Cône de vision d'un flic ou d'une caméra : sommet (x, z), cap (même convention que le yaw des joueurs : avant = (−sin, −cos)), portée (m) et ouverture TOTALE (rad). */
export interface VisionCone { x: number; z: number; yaw: number; range: number; fov: number; kind?: 'cop' | 'camera' | string }

const HIDE_MAX = 100;
const hash2 = (x: number, z: number) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };

/**
 * Cachettes instanciées (≤ 100) : haies/buissons (verts), bennes (bleu), abris (bois + toit), chacune avec un anneau vert clair au sol
 * (zone où l'on est caché, lisible de dessus). 4 appels de dessin au plus (corps, contours des boîtes, buissons, anneaux), aucun asset.
 * `update(spots, focus?)` : peut être appelé chaque image (rien n'est réécrit si la liste est identique) ; `focus` = [x, z] limite
 * l'affichage aux cachettes à moins de 160 m. Les corps s'estompent (dithering) devant le joueur comme les bâtiments.
 */
export class HidingView {
  readonly group = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly hulls: THREE.InstancedMesh;
  private readonly balls: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private sig = '';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Nombre de cachettes affichées. */
  count = 0;

  constructor(scene: THREE.Scene) {
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), makeOccludable(toonRaw({})), HIDE_MAX * 2);
    this.hulls = new THREE.InstancedMesh(this.boxes.geometry, boxHullMat, HIDE_MAX * 2);
    this.hulls.instanceMatrix = this.boxes.instanceMatrix;
    this.balls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), makeOccludable(toonRaw({})), HIDE_MAX);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xb6f36a, transparent: true, opacity: 0.6, depthWrite: false, fog: false }), HIDE_MAX);
    for (const o of [this.boxes, this.hulls, this.balls, this.rings]) { o.count = 0; o.frustumCulled = false; this.group.add(o); }
    this.rings.renderOrder = 2;
    scene.add(this.group);
  }

  update(spots: readonly HidingSpotView[], focus?: readonly [number, number], radius = 160): void {
    const list: HidingSpotView[] = [];
    for (const s of spots) {
      if (list.length >= HIDE_MAX) break;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !(s.r > 0)) continue;
      if (focus && Math.hypot(s.x - focus[0], s.z - focus[1]) > radius) continue;
      list.push(s);
    }
    const sig = list.map((s) => `${s.x | 0},${s.z | 0},${s.r.toFixed(1)},${s.kind}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.count = list.length;
    let nb = 0, nl = 0, nr = 0;
    const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, color?: number) => {
      this.p.set(x, y, z); this.q.setFromEuler(this.e.set(0, ry, 0)); this.s.set(sx, sy, sz);
      mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      if (color !== undefined) mesh.setColorAt(i, this.c.setHex(color));
    };
    for (const s of list) {
      const j = hash2(s.x, s.z);
      const ry = Math.floor(j * 4) * (Math.PI / 2) + (s.kind === 'haie' ? 0 : (j - 0.5) * 0.4);
      const green = [0x3fae49, 0x2f9e44, 0x56c25a, 0x37a05c][Math.floor(j * 4) % 4];
      put(this.rings, nr++, s.x, 0.05, s.z, 0, s.r, 1, s.r, 0xffffff);
      if (s.kind === 'benne') {
        put(this.boxes, nb++, s.x, 0.8, s.z, ry, s.r * 1.5, 1.6, s.r * 0.85, 0x2f80ed);
        put(this.boxes, nb++, s.x, 1.65, s.z, ry, s.r * 1.6, 0.14, s.r * 0.95, 0x1f4f99);
      } else if (s.kind === 'abri') {
        put(this.boxes, nb++, s.x, 1.1, s.z, ry, s.r * 1.4, 2.2, s.r * 1.2, 0xd9a85b);
        put(this.boxes, nb++, s.x, 2.35, s.z, ry, s.r * 1.8, 0.3, s.r * 1.6, 0xb5433a);
      } else if (s.kind === 'haie') {
        put(this.boxes, nb++, s.x, 0.6, s.z, ry, s.r * 1.9, 1.2, Math.max(0.8, s.r * 0.6), green);
      } else if (s.kind !== 'ruelle') { // ruelle : le passage entre les murs suffit, seul l'anneau la signale
        put(this.balls, nl++, s.x, s.r * 0.35, s.z, ry, s.r * 0.85, s.r * 0.6 + 0.3, s.r * 0.85, green);
      }
    }
    this.boxes.count = this.hulls.count = nb; this.balls.count = nl; this.rings.count = nr;
    for (const o of [this.boxes, this.balls, this.rings]) {
      o.instanceMatrix.needsUpdate = true;
      if (o.instanceColor) o.instanceColor.needsUpdate = true;
    }
  }

  setVisible(v: boolean): void { this.group.visible = v; }
  /** Anneaux au sol (zone où l'on peut se cacher) : utiles seulement quand on est recherché. */
  setRings(v: boolean): void { this.rings.visible = v; }
  dispose(): void {
    this.group.removeFromParent();
    for (const o of [this.boxes, this.balls, this.rings]) { o.dispose(); (o.material as THREE.Material).dispose(); }
    this.balls.geometry.dispose(); this.boxes.geometry.dispose(); this.rings.geometry.dispose();
  }
}

const CONE_MAX = 24;
const CONE_HALF = 0.9; // demi-angle (rad) du maillage unitaire
/**
 * Champs de vision des flics et des caméras : UN InstancedMesh de secteurs plats translucides posés au sol (rouge : flic, orange : caméra),
 * uniquement ceux à moins de 60 m du joueur (`focus`). À alimenter chaque image avec les cônes calculés par `shared/hiding.ts` (`copCameraCones`).
 * `setVisible(false)` les masque (option « afficher les champs de vision »). Un seul appel de dessin, aucun asset.
 */
export class VisionConesView {
  readonly mesh: THREE.InstancedMesh;
  private on = true;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  /** Nombre de cônes dessinés à la dernière mise à jour. */
  count = 0;

  constructor(scene: THREE.Scene) {
    const N = 10, pos: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = -CONE_HALF + (2 * CONE_HALF * i) / N, b = -CONE_HALF + (2 * CONE_HALF * (i + 1)) / N;
      pos.push(0, 0, 0, Math.sin(a), 0, -Math.cos(a), Math.sin(b), 0, -Math.cos(b));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, CONE_MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  /** `cones` : tous les cônes connus ; `focus` : [x, z] du joueur ; seuls ceux dont le sommet est à moins de `radius` m (plus la moitié de leur portée) sont dessinés. */
  update(cones: readonly VisionCone[], focus: readonly [number, number], radius = 60): void {
    let n = 0;
    if (this.on) {
      for (const k of cones) {
        if (n >= CONE_MAX) break;
        if (!Number.isFinite(k.x + k.z + k.yaw + k.range + k.fov) || k.range <= 0) continue;
        if (Math.hypot(k.x - focus[0], k.z - focus[1]) > radius + k.range * 0.5) continue;
        const sx = Math.sin(Math.min(Math.PI * 0.95, Math.max(0.1, k.fov)) / 2) / Math.sin(CONE_HALF);
        this.p.set(k.x, 0.07, k.z); this.q.setFromEuler(this.e.set(0, k.yaw, 0)); this.s.set(k.range * sx, 1, k.range);
        this.mesh.setMatrixAt(n, this.m.compose(this.p, this.q, this.s));
        this.mesh.setColorAt(n, this.c.setHex(k.kind === 'camera' ? 0xff8c1a : 0xff2a2a));
        n++;
      }
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Afficher / cacher les champs de vision (option du joueur). */
  setVisible(v: boolean): void { this.on = v; if (!v) { this.mesh.count = 0; this.count = 0; } }
  get visible(): boolean { return this.on; }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
