import * as THREE from 'three';
import { VEHICLE_SPECS, crateLayout } from '../shared/constants';
import type { Input } from '../shared/protocol';
import { defaultSettings, type ActionId, type Settings } from '../shared/settings';
import { GameAudio } from './audio';
import { createChat } from './chat';
import { buildAvatar, buildCar, buildCrate, buildExcavator, type VehicleView } from './models';
import { Net } from './net';
import { buildEnvironment } from './scene';
import { launcher, loadSettings, saveSettings } from './settings';
import { getLayout, keyLabel, openSettings } from './ui/settingsPanel';

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

// ---------- Réglages, son ----------
let settings: Settings = defaultSettings();
let layout: Awaited<ReturnType<typeof getLayout>> = null;
const audio = new GameAudio();
const applySettings = (s: Settings) => {
  settings = s;
  audio.setVolumes(s.master, s.effects);
};
void Promise.all([loadSettings(), getLayout()]).then(([s, l]) => {
  layout = l;
  applySettings(s);
});
/** Nom de la touche affiché dans l'aide (ex : « Z » en AZERTY). */
const L = (a: ActionId) => keyLabel(settings.keys[a], layout);

// Les navigateurs n'autorisent le son qu'après un geste du joueur
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => audio.resume(), { capture: true });
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest?.('button')) audio.play('click');
});

// ---------- Entrées ----------
const keys = new Set<string>();
/** Les touches sont lues par code physique (event.code) : le même réglage marche en AZERTY et en QWERTY. */
const isDown = (a: ActionId) => !!settings.keys[a] && keys.has(settings.keys[a]);
const axis = (pos: ActionId, neg: ActionId) => (isDown(pos) ? 1 : 0) - (isDown(neg) ? 1 : 0);
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
  if (chat.isOpen() || settingsOpen) return;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(e.deltaY * 0.001)));
  try { localStorage.setItem('zoom', String(zoom)); } catch { /* ignoré */ }
}, { passive: true });

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  lastMouseMove = performance.now();
  yaw -= e.movementX * 0.002 * settings.sensitivity;
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.002 * settings.sensitivity));
});

let settingsOpen = false;
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || settingsOpen || !playing) return;
  keys.add(e.code);
  if (!e.repeat) {
    if (e.code === settings.keys.interact) net.send({ type: 'interact' });
    if (e.code === settings.keys.chat) {
      e.preventDefault();
      chat.open();
    }
    if (e.code === settings.keys.jump) audio.play('jump');
  }
  // Pas de défilement de page ni de focus sur les boutons avec les touches du jeu
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const readInput = (): Input => ({
  f: axis('forward', 'back'), s: axis('right', 'left'),
  sw: axis('swingLeft', 'swingRight'), bm: axis('boomUp', 'boomDown'),
  st: axis('stickOut', 'stickIn'), bk: axis('bucketCurl', 'bucketDump'),
  jump: isDown('jump') ? 1 : 0, yaw,
});

// ---------- Réseau, menu, pause, chat ----------
const net = new Net();
const $ = (id: string) => document.getElementById(id)!;
const hud = $('hud');
const playersEl = $('players');
const menu = $('menu');
const nameInput = $('name') as HTMLInputElement;
const status = $('status');
try { nameInput.value = localStorage.getItem('name') ?? ''; } catch { /* ignoré */ }

const chat = createChat({
  send: (text) => net.send({ type: 'chat', text }),
  onOpen: () => {
    keys.clear();
    document.exitPointerLock();
    updatePause();
  },
  onClose: () => {
    renderer.domElement.requestPointerLock()?.catch?.(() => {});
    updatePause();
  },
});
net.onChat = (m) => {
  chat.add(m);
  if (!m.sys && m.from !== ownName) audio.play('chat');
};
let ownName = '';

// Écran de pause : visible dès que la souris n'est plus capturée (Échap)
const pauseEl = $('pause');
const pauseInfo = $('pauseInfo');
let playing = false;
const updatePause = () => {
  const lost = document.pointerLockElement !== renderer.domElement;
  pauseEl.style.display = playing && lost && !chat.isOpen() && !settingsOpen ? 'flex' : 'none';
};
document.addEventListener('pointerlockchange', updatePause);
pauseEl.addEventListener('click', () => renderer.domElement.requestPointerLock());
$('back').addEventListener('click', (e) => {
  e.stopPropagation();
  const l = launcher();
  if (l?.backToMenu) void l.backToMenu();
  else location.reload(); // navigateur : retour à l'écran du pseudo
});
$('options').addEventListener('click', (e) => {
  e.stopPropagation();
  settingsOpen = true;
  keys.clear();
  updatePause();
  void openSettings({
    load: async () => settings,
    save: saveSettings,
    onChange: applySettings,
    onClose: () => {
      settingsOpen = false;
      updatePause();
    },
  });
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
  ownName = nameInput.value.trim();
  try { localStorage.setItem('name', nameInput.value); } catch { /* ignoré */ }
  status.textContent = 'Connexion…';
  net.onWelcome = () => {
    menu.style.display = 'none';
    playing = true;
    chat.setEnabled(net.mode === 'multi');
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
    setInterval(() => net.send({ type: 'input', i: chat.isOpen() || settingsOpen ? { ...readInput(), f: 0, s: 0, sw: 0, bm: 0, st: 0, bk: 0, jump: 0 } : readInput() }), 33);
  };
  const fail = (message: string) => {
    playing = false;
    updatePause();
    const l = launcher();
    if (l?.backToMenu) return void l.backToMenu(message); // application : retour au menu avec le message
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

// Accès pour les tests automatisés (CDP) : lecture de l'état du son
Object.assign(window, { __wtf: { audio } });

// ---------- Boucle de rendu ----------
const CAMS = {
  car: { height: 1.6, distance: 8.5, pitch: -0.22 },
  excavator: { height: 3.5, distance: 17, pitch: -0.3 },
};
const EYE = 0.7;
let prevVeh = -1;
let lastVehYaw = 0;
let last = performance.now();
let prevPos: [number, number] | null = null;
let walkSpeed = 0;
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
    audio.play('enter');
  } else if (!veh && prevVeh >= 0) {
    yaw += lastVehYaw;
    pitch = 0;
    audio.play('exit');
  }
  prevVeh = veh ? me.veh : -1;

  const multi = net.mode === 'multi';
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
    const fb = `${L('forward')}/${L('back')}`, lr = `${L('left')}/${L('right')}`;
    hud.textContent = veh.type === 'car'
      ? `Voiture · ${kmh} km/h\n${fb} : accélérer · ${lr} : tourner · Molette : zoom · ${L('interact')} : descendre`
      : `Pelleteuse · ${fb} : avancer · ${lr} : tourner · Molette : zoom · ${L('interact')} : descendre\n`
        + `${L('swingLeft')}/${L('swingRight')} : cabine · ${L('boomUp')}/${L('boomDown')} : flèche · `
        + `${L('stickOut')}/${L('stickIn')} : bras · ${L('bucketCurl')}/${L('bucketDump')} : godet`;
  } else {
    camera.position.set(me.p[0], me.p[1] + EYE, me.p[2]);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    let hint = '';
    for (const v of s.vehicles) {
      const spec = VEHICLE_SPECS[v.type];
      if (!v.drv && Math.hypot(me.p[0] - v.p[0], me.p[2] - v.p[2]) < spec.enterRadius) hint = `\n${L('interact')} : monter dans ${spec.name}`;
    }
    hud.textContent = `${L('forward')}${L('left')}${L('back')}${L('right')} : marcher · ${L('jump')} : sauter`
      + (multi ? ` · ${L('chat')} : chat` : '') + hint;
  }

  // Son : moteurs (selon vitesse et distance), pas à pied, vent
  const dtSafe = Math.max(dt, 0.001);
  if (prevPos && !veh) walkSpeed += (Math.hypot(me.p[0] - prevPos[0], me.p[2] - prevPos[1]) / dtSafe - walkSpeed) * Math.min(1, dt * 10);
  else walkSpeed = 0;
  prevPos = [me.p[0], me.p[2]];
  audio.update(
    dt,
    [camera.position.x, camera.position.y, camera.position.z],
    s.vehicles.map((v, i) => ({ type: v.type, p: v.p, speed: v.sp, driven: !!v.drv, mine: i === me.veh, arm: v.a })),
    !veh && walkSpeed > 1.5,
  );

  playersEl.textContent = s.players.map((p) => (p.id === net.id ? `${p.name} (toi)` : p.name)).join('\n');
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
