import * as THREE from 'three';
import { VEHICLE_SPECS, crateLayout } from '../shared/constants';
import type { Input } from '../shared/protocol';
import { buildAvatar, buildCar, buildCrate, buildExcavator, type VehicleView } from './models';
import { Net } from './net';
import { buildEnvironment } from './scene';

// ---------- Rendu ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
buildEnvironment(scene);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const crateMeshes = crateLayout().map((c) => {
  const m = buildCrate(c);
  scene.add(m);
  return m;
});
const vehicleViews: VehicleView[] = [];
const avatars = new Map<string, THREE.Group>();

// ---------- Entrées ----------
const keys = new Set<string>();
// event.code = position physique : en AZERTY, Z/Q/S/D = KeyW/KeyA/KeyS/KeyD.
const axis = (pos: string, neg: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
let yaw = 0;
let pitch = 0;
let lastMouseMove = 0;

// Zoom caméra des véhicules, au choix du joueur (molette), mémorisé entre les parties
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5;
let zoom = 1;
try {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(localStorage.getItem('zoom')) || 1));
} catch { /* stockage indisponible : zoom par défaut */ }

addEventListener('wheel', (e) => {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(e.deltaY * 0.001)));
  try { localStorage.setItem('zoom', String(zoom)); } catch { /* ignoré */ }
}, { passive: true });

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  lastMouseMove = performance.now();
  yaw -= e.movementX * 0.002;
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.002));
});
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) net.send({ type: 'interact' });
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const readInput = (): Input => ({
  f: axis('KeyW', 'KeyS'), s: axis('KeyD', 'KeyA'),
  sw: axis('ArrowLeft', 'ArrowRight'), bm: axis('ArrowUp', 'ArrowDown'),
  st: axis('KeyR', 'KeyF'), bk: axis('KeyT', 'KeyG'),
  jump: keys.has('Space') ? 1 : 0, yaw,
});

// ---------- Réseau + menu ----------
const net = new Net();
const $ = (id: string) => document.getElementById(id)!;
const hud = $('hud');
const playersEl = $('players');
const menu = $('menu');
const nameInput = $('name') as HTMLInputElement;
const status = $('status');
try { nameInput.value = localStorage.getItem('name') ?? ''; } catch { /* ignoré */ }

// Écran de pause : visible dès que la souris n'est plus capturée (Échap)
const pauseEl = $('pause');
const pauseInfo = $('pauseInfo');
let playing = false;
const updatePause = () => {
  pauseEl.style.display = playing && document.pointerLockElement !== renderer.domElement ? 'flex' : 'none';
};
document.addEventListener('pointerlockchange', updatePause);
pauseEl.addEventListener('click', () => renderer.domElement.requestPointerLock());
$('back').addEventListener('click', (e) => {
  e.stopPropagation();
  const l = (window as unknown as { launcher?: { backToMenu?: () => void } }).launcher;
  if (l?.backToMenu) l.backToMenu();
  else location.reload(); // navigateur : retour à l'écran du pseudo
});

/** Copie dans le presse-papiers (l'API moderne exige une page sécurisée ; repli pour http://192.168…). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

let joined = false;
function join() {
  if (joined) return;
  joined = true;
  try { localStorage.setItem('name', nameInput.value); } catch { /* ignoré */ }
  status.textContent = 'Connexion…';
  net.onWelcome = () => {
    menu.style.display = 'none';
    playing = true;
    renderer.domElement.requestPointerLock()?.catch?.(() => {});
    updatePause();
    fetch('/info').then((r) => r.json()).then((i: { mode: string; urls: string[] }) => {
      pauseInfo.textContent = '';
      if (i.mode !== 'multi' || !i.urls.length) return;
      const intro = document.createElement('div');
      intro.textContent = "Tes amis (même Wi-Fi) te trouvent automatiquement dans l'application, ou avec cette adresse (navigateur) :";
      pauseInfo.appendChild(intro);
      for (const url of i.urls) {
        const row = document.createElement('div');
        row.className = 'addr';
        const label = document.createElement('code');
        label.textContent = url;
        const btn = document.createElement('button');
        btn.textContent = "Copier l'adresse";
        btn.addEventListener('click', async (e) => {
          e.stopPropagation(); // ne pas relancer le jeu
          btn.textContent = (await copyText(url)) ? 'Copié ✓' : 'Copie impossible';
          setTimeout(() => (btn.textContent = "Copier l'adresse"), 2000);
        });
        row.append(label, btn);
        pauseInfo.appendChild(row);
      }
    }).catch(() => {});
    setInterval(() => net.send({ type: 'input', i: readInput() }), 33);
  };
  const fail = (message: string) => {
    playing = false;
    updatePause();
    const l = (window as unknown as { launcher?: { backToMenu?: (error?: string) => void } }).launcher;
    if (l?.backToMenu) return l.backToMenu(message); // application : retour au menu avec le message
    menu.style.display = 'flex';
    status.textContent = message + ' Recharge la page pour réessayer.';
  };
  net.onError = fail;
  net.onClose = fail;
  net.connect(nameInput.value);
}
$('play').addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
// Raccourci : http://hote:3000/?name=Pseudo rejoint directement la partie.
const quickName = new URLSearchParams(location.search).get('name');
if (quickName) {
  nameInput.value = quickName;
  join();
}

// ---------- Boucle de rendu ----------
const CAMS = {
  car: { height: 1.6, distance: 8.5, pitch: -0.22 },
  excavator: { height: 3.5, distance: 17, pitch: -0.3 },
};
const EYE = 0.7;
let prevVeh = -1;
let lastVehYaw = 0;
let last = performance.now();
const camTarget = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const s = net.sample(now);
  if (!s) {
    renderer.render(scene, camera);
    return;
  }

  // Caisses
  for (let i = 0; i < crateMeshes.length; i++) {
    const o = i * 7;
    if (o + 6 >= s.crates.length) break;
    crateMeshes[i].position.set(s.crates[o], s.crates[o + 1], s.crates[o + 2]);
    crateMeshes[i].quaternion.set(s.crates[o + 3], s.crates[o + 4], s.crates[o + 5], s.crates[o + 6]);
  }

  // Véhicules
  s.vehicles.forEach((v, i) => {
    let view = vehicleViews[i];
    if (!view) {
      view = vehicleViews[i] = v.type === 'car' ? buildCar() : buildExcavator();
      scene.add(view.group);
    }
    view.group.position.set(...v.p);
    view.group.quaternion.set(...v.q);
    view.update(v, dt);
  });

  // Joueurs (les autres ; invisibles quand ils sont dans un véhicule)
  const seen = new Set<string>();
  let me = s.players.find((p) => p.id === net.id);
  for (const p of s.players) {
    if (p.id === net.id) continue;
    seen.add(p.id);
    let av = avatars.get(p.id);
    if (!av) {
      av = buildAvatar(p.name);
      avatars.set(p.id, av);
      scene.add(av);
    }
    av.visible = p.veh < 0;
    av.position.set(...p.p);
    av.rotation.y = p.yaw;
  }
  for (const [id, av] of avatars) if (!seen.has(id)) { scene.remove(av); avatars.delete(id); }

  if (!me) me = { id: net.id, name: '', p: [0, 2, 5], yaw: 0, veh: -1 };
  const veh = me.veh >= 0 ? s.vehicles[me.veh] : undefined;

  // Transitions monter / descendre
  if (veh && prevVeh < 0) {
    yaw = 0;
    pitch = CAMS[veh.type].pitch;
  } else if (!veh && prevVeh >= 0) {
    yaw += lastVehYaw;
    pitch = 0;
  }
  prevVeh = veh ? me.veh : -1;

  if (veh) {
    // Caméra de poursuite : derrière et au-dessus, orbite à la souris, recentrage après 1,5 s, zoom à la molette
    const cam = CAMS[veh.type];
    if (now - lastMouseMove > 1500) {
      const k = Math.min(1, 3 * dt);
      yaw -= yaw * k;
      pitch += (cam.pitch - pitch) * k;
    }
    pitch = Math.max(-1.2, Math.min(0.2, pitch));
    tmpQ.set(...veh.q);
    lastVehYaw = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ').y;
    const eul = new THREE.Euler(pitch, lastVehYaw + yaw, 0, 'YXZ');
    camTarget.set(...veh.p).add(new THREE.Vector3(0, cam.height, 0));
    camera.position.copy(new THREE.Vector3(0, 0, cam.distance * zoom).applyEuler(eul).add(camTarget));
    camera.position.y = Math.max(camera.position.y, 0.5);
    camera.rotation.copy(eul);
    const kmh = Math.round(Math.abs(veh.sp) * 3.6);
    hud.textContent = veh.type === 'car'
      ? `Voiture · ${kmh} km/h\nZ/S : accélérer · Q/D : tourner · Molette : zoom · E : descendre`
      : 'Pelleteuse · Z/S : avancer · Q/D : tourner · Molette : zoom\n←/→ : pivoter la cabine · ↑/↓ : flèche · R/F : bras · T/G : godet · E : descendre';
  } else {
    camera.position.set(me.p[0], me.p[1] + EYE, me.p[2]);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    let hint = '';
    for (const v of s.vehicles) {
      const spec = VEHICLE_SPECS[v.type];
      if (!v.drv && Math.hypot(me.p[0] - v.p[0], me.p[2] - v.p[2]) < spec.enterRadius) hint = `\nE : monter dans ${spec.name}`;
    }
    hud.textContent = 'ZQSD : marcher · Espace : sauter' + hint;
  }

  playersEl.textContent = s.players.map((p) => (p.id === net.id ? `${p.name} (toi)` : p.name)).join('\n');
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
