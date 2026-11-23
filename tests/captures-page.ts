// Page de test des captures (chargée par tests/captures.html via Vite) : rend une scène selon `?shot=` SANS serveur de jeu.
// Remplit window.__shot = { ready, calls, tris, cityDraw, chunks, ms } pour tests/captures.ts.
import * as THREE from 'three';
import { getCity } from '../shared/city/layout';
import type { Mark, PrivateState, VehicleSnap } from '../shared/protocol';
import { createHud } from '../src/hud';
import { MarkersView } from '../src/markers';
import { PedsView } from '../src/peds';
import { buildEnvironment } from '../src/scene';
import { Pda } from '../src/ui/pda';
import { pushSms } from '../src/ui/pda/sms';
import { playComic } from '../src/ui/comic';
import { viewFor } from '../src/vehicles';
import type { VehicleView } from '../src/vehicles/types';

const q = new URLSearchParams(location.search);
const shot = q.get('shot') ?? 'city';
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const city = buildEnvironment(scene);
const camera = new THREE.PerspectiveCamera(45, W / H, 1, 600);

const ME: PrivateState = {
  money: 12480, bag: {}, bagCap: 30, stars: 3, starProgress: 0.45, district: 'docks', unread: 2,
  mission: { id: 'm1', step: 2, steps: 4, text: 'Livre la caisse de café au Vieux Bourg', ms: 83000, timeLimitMs: 240000 },
  marks: [
    { x: -40, z: -60, k: 'mission', label: 'Livraison' }, { x: 120, z: 90, k: 'dealer', label: 'Dealer' }, { x: -200, z: 140, k: 'planque' },
    { x: 20, z: 220, k: 'camera' }, { x: 260, z: -120, k: 'donneur', label: 'Contact' }, { x: -90, z: -250, k: 'cible', label: 'Cible' },
  ] satisfies Mark[],
  medals: {},
};
const gameCam = (tx: number, tz: number, h = 13.6, back = 8.5, yaw = 0) => {
  camera.position.set(tx + Math.sin(yaw) * back, h, tz + Math.cos(yaw) * back);
  camera.lookAt(tx, 0, tz);
};

// Véhicules et piétons de démonstration autour de (0, 0)
const views: VehicleView[] = [];
const types = ['citadine', 'berline', 'camionnette', 'police'];
function addVehicle(type: string, x: number, z: number, yaw: number, extra: Partial<VehicleSnap> = {}, seed = views.length) {
  const v = viewFor(type).build(seed);
  const snap: VehicleSnap = { type, p: [x, 0.45, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], drv: '', sp: 0, st: 0, a: [], hp: 1, dead: 0, ...extra };
  v.group.position.set(...snap.p);
  v.group.quaternion.set(...snap.q);
  scene.add(v.group);
  v.update(snap, 0.016);
  views.push(v);
}
const peds = new PedsView(scene);
function pedsFrame(n: number, cx: number, cz: number, t: number): Float32Array {
  const a = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2, r = 5 + (i % 4) * 2.2;
    const st = i % 11 === 0 ? 2 : i % 7 === 0 ? 1 : 0;
    a.set([i + 1, i % 5, cx + Math.cos(ang) * r + (st === 2 ? 0 : t * 0.5), cz + Math.sin(ang) * r, ang + Math.PI, st], i * 6);
  }
  return a;
}

const hud = createHud();
const mk = new MarkersView(scene, camera);
let pda: Pda | null = null;
const info = { ready: false, calls: 0, tris: 0, cityDraw: 0, chunks: 0, ms: 0, shot };
(window as unknown as { __shot: typeof info }).__shot = info;

if (shot === 'city_high') {
  camera.position.set(0, 65, 55); camera.lookAt(0, 0, -10);
  for (let i = 0; i < 12; i++) addVehicle(types[i % 4], -20 + (i % 6) * 12, -4 + Math.floor(i / 6) * 4, Math.PI / 2);
} else if (shot === 'vehicles') {
  camera.position.set(0, 6.5, 13); camera.lookAt(0, 0.3, 0);
  types.forEach((t, i) => addVehicle(t, -9 + i * 6, 0, -0.5 + i * 0.1, { sp: 3, st: 0.3 }, i + 1));
  addVehicle('citadine', -9, 7, 0.4, { hp: 0.15 }, 3);
  addVehicle('police', 3, 7, 3, { a: [0] }, 0);
} else if (shot === 'peds') {
  camera.position.set(0, 9, 14); camera.lookAt(0, 0.5, 0);
} else {
  // city / hud / pda_* / comic_*
  gameCam(0, 0);
  types.forEach((t, i) => addVehicle(t, -9 + i * 6, 3.5 + (i % 2) * -1, Math.PI / 2, { sp: 0 }, i + 2));
  addVehicle('police', 12, -2.5, -Math.PI / 2, {}, 0);
}
mk.update(shot === 'hud' ? ME.marks : [], 0.016, [0, 0, 0]);
if (shot.startsWith('pda')) {
  pda = new Pda(document.body, { send: () => {}, now: () => 100000, player: () => ({ x: -30, z: 50, yaw: 0.8 }), mates: () => [{ name: 'Sam', x: 90, z: -40 }] });
  pushSms({ id: 1, from: 'Contact anonyme', text: 'Descente de police aux Docks demain matin. Les sardines vont devenir rares...', at: 40000, tip: { good: 'sardines_de_quai', district: 'docks', mult: 2.8, until: 190000 } });
  pushSms({ id: 2, from: 'Maman', text: "N'oublie pas de manger quelque chose de chaud ce soir !", at: 90000 });
  pda.setState(ME);
  pda.open(shot === 'pda_sms' ? 'sms' : 'carte');
}
if (shot.startsWith('comic_')) {
  const img = shot.slice(6);
  void playComic([{ img, who: img === 'explosion' ? undefined : 'Léa', text: "C'est la dernière fois que je prête ma voiture à quelqu'un du campus, promis !" }]);
}

let frames = 0;
const t0 = performance.now();
function loop() {
  frames++;
  const t = frames / 60;
  if (shot === 'peds') peds.update(pedsFrame(30, 0, 0, t), 1 / 30);
  else if (shot !== 'vehicles' && !shot.startsWith('comic')) peds.update(pedsFrame(40, 0, 0, t), 1 / 30);
  if (shot === 'city_high') city.update(0, 0);
  hud.update({ hp: 80, vehHp: null, vehName: '', inVehicle: false, x: -30 + t, z: 50, yaw: 0.8 }, shot === 'hud' || shot === 'city' ? ME : null);
  hud.setVisible(shot === 'hud');
  renderer.render(scene, camera);
  if (frames === 12) {
    info.calls = renderer.info.render.calls;
    info.tris = renderer.info.render.triangles;
    info.cityDraw = city.drawCalls;
    info.chunks = city.chunksVisible;
    info.ms = (performance.now() - t0) / frames;
    info.ready = true;
  }
  requestAnimationFrame(loop);
}
void getCity();
loop();
