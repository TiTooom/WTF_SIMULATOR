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
import { hullGeometry, outlineMat, toon } from './gfx';

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
          // Évite aussi le panneau de mission (haut centre)
          if (py < 140 && Math.abs(px - W / 2) < 280) { px = W / 2 + (px < W / 2 ? -280 : 280); py += 36 * pushed++; } // décalées de côté, empilées si plusieurs
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
