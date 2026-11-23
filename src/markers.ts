// Repères en monde (PROPRIÉTAIRE : art-toon), à partir de `PrivateState.marks` (≤ 16) :
//  - anneau pulsant au sol + colonne de lumière + losange qui flotte (couleur selon le type) ;
//  - flèche au bord de l'écran (DOM, textContent) pour les repères importants hors champ : mission, cp, cible, activite, danger, flic.
//
// API pour main.ts :
//   const markers = new MarkersView(scene, camera);          // une fois
//   markers.update(me.marks, dt, playerPos);                  // à chaque image ; playerPos = [x, y, z] du joueur ou du véhicule (distance affichée)
//   markers.setVisible(false) pendant la pause ; markers.dispose() au départ.
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
const MAX_MARKS = 16;
const SHOW_DIST = 240;

interface Slot { group: THREE.Group; ring: THREE.Mesh; beam: THREE.Mesh; icon: THREE.Mesh; arrow: HTMLDivElement; tri: HTMLDivElement; txt: HTMLDivElement; kind: string }

const ringGeo = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(1, 1, 36, 14, 1, true).translate(0, 18, 0);
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
        ring: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
        beam: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
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
    group.add(ring, beam, icon);
    group.visible = false;
    this.scene.add(group);
    const arrow = document.createElement('div');
    arrow.style.cssText = 'position:absolute;display:none;transform:translate(-50%,-50%);text-align:center;font:800 12px "Segoe UI",sans-serif;color:#fff;text-shadow:0 0 3px #000,0 1px 2px #000';
    const tri = document.createElement('div');
    tri.style.cssText = 'width:0;height:0;margin:0 auto;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:26px solid #fff;filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000)';
    const txt = document.createElement('div');
    arrow.append(tri, txt);
    this.overlay.appendChild(arrow);
    return { group, ring, beam, icon, arrow, tri, txt, kind: '' };
  }

  update(marks: readonly Mark[], dt: number, focus?: readonly number[]): void {
    this.t += dt;
    const n = this.visible ? Math.min(marks.length, MAX_MARKS) : 0;
    while (this.slots.length < n) this.slots.push(this.makeSlot());
    const cam = this.camera;
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const m = i < n ? marks[i] : null;
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) { s.group.visible = false; s.arrow.style.display = 'none'; continue; }
      const kind = (m.k in MARK_COLORS ? m.k : 'autre') as MarkKind;
      const color = MARK_COLORS[kind];
      if (s.kind !== kind) {
        s.kind = kind;
        const mm = this.matsFor(color);
        s.ring.material = mm.ring;
        s.beam.material = mm.beam;
        s.icon.material = toon(color);
        s.tri.style.borderBottomColor = '#' + color.toString(16).padStart(6, '0');
      }
      const dist = focus ? Math.hypot(m.x - focus[0], m.z - focus[2]) : cam ? Math.hypot(m.x - cam.position.x, m.z - cam.position.z) : 0;
      const near = !focus && !cam ? true : dist < SHOW_DIST;
      s.group.visible = near;
      s.group.position.set(m.x, 0, m.z);
      const pulse = 1 + 0.12 * Math.sin(this.t * 4 + i);
      const big = kind === 'mission' || kind === 'cp' || kind === 'cible' ? 3.6 : 2.4;
      s.ring.scale.set(big * pulse, 1, big * pulse);
      s.beam.scale.set(big * 0.55, 1, big * 0.55);
      s.icon.position.y = 4.2 + Math.sin(this.t * 2.4 + i) * 0.35;
      s.icon.rotation.y = this.t * 1.6;

      // Flèche au bord de l'écran (repères importants hors champ)
      let showArrow = false;
      if (cam && ARROW_KINDS.has(kind)) {
        this.v.set(m.x, 1.5, m.z).project(cam);
        const behind = this.v.z > 1;
        let dx = this.v.x, dy = this.v.y;
        if (behind) { dx = -dx; dy = -dy; }
        const off = behind || Math.abs(dx) > 0.94 || Math.abs(dy) > 0.9;
        if (off) {
          const len = Math.max(Math.abs(dx) / 0.9, Math.abs(dy) / 0.82, 1e-4);
          const ex = dx / len, ey = dy / len;
          s.arrow.style.left = `${(0.5 + ex * 0.5) * W}px`;
          s.arrow.style.top = `${(0.5 - ey * 0.5) * H}px`;
          s.tri.style.transform = `rotate(${(Math.atan2(ex * W, ey * H) * 180) / Math.PI}deg)`;
          s.txt.textContent = (m.label ? m.label + ' · ' : '') + Math.round(dist) + ' m';
          showArrow = true;
        }
      }
      s.arrow.style.display = showArrow ? '' : 'none';
    }
  }

  dispose(): void {
    for (const s of this.slots) this.scene.remove(s.group);
    this.slots = [];
    this.overlay.remove();
    for (const m of this.mats.values()) { m.ring.dispose(); m.beam.dispose(); }
    this.mats.clear();
  }
}
