import * as THREE from 'three';
import type { Input, PlayerSnap } from '../shared/protocol';
import { DEFAULT_HOTBAR, ITEMS, ITEM_BY_ID, PROP_KINDS } from '../shared/registry';
import { defaultSettings, type ActionId, type Settings } from '../shared/settings';
import { GameAudio } from './audio';
import { createChat } from './chat';
import { Fx } from './fx';
import { createHud } from './hud';
import { createInventory } from './inventory';
import { buildAvatar, disposeAvatar } from './models';
import { Net } from './net';
import { ProjectilesView } from './projectiles';
import { PropsView } from './props';
import { buildEnvironment } from './scene';
import { launcher, loadSettings, saveSettings } from './settings';
import { getLayout, keyLabel, openSettings } from './ui/settingsPanel';
import { createTouch, goImmersive, isTouchDevice } from './touch';
import { viewFor } from './vehicles';
import type { VehicleView } from './vehicles/types';

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

const vehicleViews: Array<{ type: string; view: VehicleView } | undefined> = [];
const avatars = new Map<string, THREE.Group>();

// ---------- Réglages, son ----------
let settings: Settings = defaultSettings();
let layout: Awaited<ReturnType<typeof getLayout>> = null;
const audio = new GameAudio();
const fx = new Fx(scene, audio);
const propsView = new PropsView(scene);
const projView = new ProjectilesView(scene, fx);
const hud = createHud();
hud.setVisible(false);
const applySettings = (s: Settings) => {
  settings = s;
  audio.setVolumes(s.master, s.effects);
  inventory?.refresh();
};
void Promise.all([loadSettings(), getLayout()]).then(([s, l]) => {
  layout = l;
  applySettings(s);
});
/** Nom de la touche affiché dans l'aide (ex : « Z » en AZERTY). */
const L = (a: ActionId) => keyLabel(settings.keys[a], layout);

/** Barre d'objets effective : celle des réglages, ou celle par défaut du jeu. */
const URLP = new URLSearchParams(location.search);
const forcedItem = URLP.get('item') ?? ''; // ?item=<id> : objet forcé dans l'emplacement actif (tests)
const hotbar = (): string[] => {
  const h = settings.hotbar.length === 9 ? settings.hotbar : DEFAULT_HOTBAR;
  if (!forcedItem) return h;
  const c = [...h];
  c[selected] = forcedItem;
  return c;
};
let selected = 0;
const selectedItem = () => hotbar()[selected] ?? '';
const slotLabels = () => Array.from({ length: 9 }, (_, i) => {
  const code = settings.keys[`slot${i + 1}` as ActionId];
  return code?.startsWith('Digit') ? code.slice(5) : L(`slot${i + 1}` as ActionId); // chiffres : « 1 » même en AZERTY
});

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
{
  // ?aim=<yawDeg>,<pitchDeg> : regard initial (tests)
  const a = (URLP.get('aim') ?? '').split(',').map(Number);
  if (a.length === 2 && a.every(Number.isFinite)) { yaw = (a[0] * Math.PI) / 180; pitch = (a[1] * Math.PI) / 180; }
}
let lastMouseMove = 0;
let m1 = 0, m2 = 0;
let inVehicle = false;
let aimO: [number, number, number] = [0, 0, 0];
let aimD: [number, number, number] = [0, 0, -1];

// Zoom caméra des véhicules, au choix du joueur (molette), mémorisé entre les parties
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5;
let zoom = 1;
try {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(localStorage.getItem('zoom')) || 1));
} catch { /* stockage indisponible : zoom par défaut */ }
const touchMode = isTouchDevice();
let touchPaused = false;
/** Souris capturée (PC) ou, au toucher, partie en cours et non en pause. */
const locked = () => (touchMode ? playing && !touchPaused : document.pointerLockElement === renderer.domElement);
/** Reprend la main sur le jeu : capture de la souris (PC) ; rien à faire au toucher. */
const grab = () => {
  if (touchMode) return;
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
};
addEventListener('wheel', (e) => {
  if (!playing || chat.isOpen() || settingsOpen || inventory.isOpen()) return;
  if (inVehicle) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(e.deltaY * 0.001)));
    try { localStorage.setItem('zoom', String(zoom)); } catch { /* ignoré */ }
  } else if (selectedItem() === 'physgun' && m1) {
    net.addWheel(e.deltaY < 0 ? 1 : -1); // distance du pistolet à gravité
  } else if (e.deltaY !== 0) {
    selected = (selected + (e.deltaY > 0 ? 1 : 8)) % 9; // change l'emplacement actif de la barre
  }
}, { passive: true });

renderer.domElement.addEventListener('click', () => { if (!touchMode) renderer.domElement.requestPointerLock(); });
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  lastMouseMove = performance.now();
  yaw -= e.movementX * 0.002 * settings.sensitivity;
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.002 * settings.sensitivity));
});
// Boutons de la souris : seulement quand elle est capturée (le premier clic sert à la reprendre)
addEventListener('mousedown', (e) => {
  if (!locked()) return;
  if (e.button === 0) m1 = 1;
  if (e.button === 2) m2 = 1;
  e.preventDefault();
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) m1 = 0;
  if (e.button === 2) m2 = 0;
});
addEventListener('contextmenu', (e) => { if (playing) e.preventDefault(); });
document.addEventListener('pointerlockchange', () => { if (!locked()) m1 = m2 = 0; });

let settingsOpen = false;
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || settingsOpen || !playing) return;
  if (!e.repeat && e.code === settings.keys.inventory && !chat.isOpen()) {
    e.preventDefault();
    inventory.toggle();
    return;
  }
  if (inventory.isOpen()) {
    if (e.code === 'Escape') inventory.close();
    return;
  }
  keys.add(e.code);
  if (!e.repeat) {
    if (e.code === settings.keys.interact) net.send({ type: 'interact' });
    if (e.code === settings.keys.chat) {
      e.preventDefault();
      chat.open();
    }
    if (e.code === settings.keys.jump) audio.play('jump');
    for (let i = 1; i <= 9; i++) if (e.code === settings.keys[`slot${i}` as ActionId]) selected = i - 1;
  }
  // Pas de défilement de page ni de focus sur les boutons avec les touches du jeu
  if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); m1 = m2 = 0; });

const readInput = (): Omit<Input, 'wheel'> => {
  const blocked = chat.isOpen() || settingsOpen || inventory.isOpen();
  return {
    f: blocked ? 0 : axis('forward', 'back'), s: blocked ? 0 : axis('right', 'left'),
    sw: blocked ? 0 : axis('swingLeft', 'swingRight'), bm: blocked ? 0 : axis('boomUp', 'boomDown'),
    st: blocked ? 0 : axis('stickOut', 'stickIn'), bk: blocked ? 0 : axis('bucketCurl', 'bucketDump'),
    jump: !blocked && isDown('jump') ? 1 : 0, yaw,
    yw: blocked ? 0 : axis('yawRight', 'yawLeft'), th: blocked ? 0 : axis('throttleUp', 'throttleDown'),
    hn: !blocked && isDown('horn') ? 1 : 0,
    m1: blocked ? 0 : m1, m2: blocked ? 0 : m2,
    ao: aimO, ad: aimD, item: selectedItem(),
  };
};

// ---------- Réseau, menu, pause, chat ----------
const net = new Net();
const $ = (id: string) => document.getElementById(id)!;
const hudText = $('hud');
const playersEl = $('players');
const menu = $('menu');
const nameInput = $('name') as HTMLInputElement;
const status = $('status');
try { nameInput.value = localStorage.getItem('name') ?? ''; } catch { /* ignoré */ }

const chat = createChat({
  send: (text) => net.send({ type: 'chat', text }),
  onOpen: () => {
    keys.clear();
    m1 = m2 = 0;
    document.exitPointerLock();
    touch?.releaseAll();
    updatePause();
  },
  onClose: () => {
    grab();
    updatePause();
  },
});
const inventory = createInventory({
  getHotbar: hotbar,
  setHotbar: (h) => {
    settings = { ...settings, hotbar: h };
    void saveSettings(settings);
  },
  getSelected: () => selected,
  setSelected: (i) => { selected = i; },
  keyLabels: slotLabels,
  onOpen: () => {
    keys.clear();
    m1 = m2 = 0;
    document.exitPointerLock();
    touch?.releaseAll();
    updatePause();
  },
  onClose: () => {
    grab();
    updatePause();
  },
});
net.onChat = (m) => {
  chat.add(m);
  if (!m.sys && m.from !== ownName) audio.play('chat');
};
let ownName = '';

// ---------- Commandes tactiles ----------
const touch = touchMode ? createTouch({
  press: (a, down) => {
    const code = settings.keys[a];
    if (!code) return;
    if (down) { keys.add(code); if (a === 'jump') audio.play('jump'); } else keys.delete(code);
  },
  look: (dx, dy) => {
    lastMouseMove = performance.now();
    yaw -= dx * 0.002 * settings.sensitivity;
    pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * 0.002 * settings.sensitivity));
  },
  fire: (b, down) => { if (b === 1) m1 = down ? 1 : 0; else m2 = down ? 1 : 0; },
  interact: () => net.send({ type: 'interact' }),
  chat: () => chat.open(),
  inventory: () => inventory.toggle(),
  pause: () => { touch?.releaseAll(); keys.clear(); touchPaused = true; updatePause(); },
  selectSlot: (i) => { selected = i; },
  wheel: (n) => net.addWheel(n),
}) : null;

// Écran de pause : visible dès que la souris n'est plus capturée (Échap)
const pauseEl = $('pause');
const pauseInfo = $('pauseInfo');
let playing = false;
const updatePause = () => {
  // ?nopause : cache l'écran de pause (captures et tests automatisés en navigateur sans capture de souris)
  const noPause = new URLSearchParams(location.search).has('nopause');
  pauseEl.style.display = !noPause && playing && !locked() && !chat.isOpen() && !settingsOpen && !inventory.isOpen() ? 'flex' : 'none';
};
document.addEventListener('pointerlockchange', updatePause);
pauseEl.addEventListener('click', () => {
  if (touchMode) { touchPaused = false; updatePause(); } else renderer.domElement.requestPointerLock();
});
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

let pendingCmd = '';
let cmdSentAt = 0;
let cmdState = 0; // 0 : à envoyer, 1 : envoyée, 2 : renvoyée si besoin
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
    hud.setVisible(true);
    chat.setEnabled(net.mode === 'multi');
    if (touchMode) goImmersive();
    grab();
    updatePause();
    // ?cmd=/drive%20tank : commande de chat envoyée après la connexion (tests automatisés)
    // (envoyée dans la boucle de rendu dès que le premier snapshot contenant le joueur est reçu)
    pendingCmd = new URLSearchParams(location.search).get('cmd') ?? '';
    // ?fire=<délai s>[,<durée s>] : appui simulé sur le bouton principal (tests)
    const fire = (URLP.get('fire') ?? '').split(',').map(Number);
    if (fire.length && Number.isFinite(fire[0]) && URLP.get('fire')) {
      setTimeout(() => { m1 = 1; setTimeout(() => { m1 = 0; }, (Number.isFinite(fire[1]) ? fire[1] : 0.3) * 1000); }, fire[0] * 1000);
    }
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
    setInterval(() => net.sendInput(readInput()), 33); // Input v2 à 30 Hz
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

// Accès pour les tests automatisés (CDP) : état du son, des réglages, de la barre, du rendu
const stats = {
  audio, net, fx, hud, renderer, inventory, registry: { ITEMS, ITEM_BY_ID, PROP_KINDS },
  get settings() { return settings; },
  get selected() { return selected; },
  get selectedItem() { return selectedItem(); },
  get hotbar() { return hotbar(); },
  get props() { return propsView.count; },
  get projectiles() { return projView.count; },
  get fxActive() { return fx.active; },
  get fxHandled() { return fx.handled; },
  get vehicles() { return vehicleViews.filter(Boolean).length; },
  get inVehicle() { return inVehicle; },
  get input() { return readInput(); },
};
Object.assign(window, { __wtf: stats });

// ---------- Boucle de rendu ----------
const EYE = 0.7;
let prevVeh = -1;
let lastVehYaw = 0;
let last = performance.now();
let prevPos: [number, number] | null = null;
let walkSpeed = 0;
let prevHp = 100;
const camTarget = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const smokeT: number[] = [];
const prevDead: boolean[] = [];
const FALLBACK_ME: PlayerSnap = { id: '', name: '', p: [0, 2, 5], yaw: 0, veh: -1, seat: 0, hp: 100, item: '', sc: 1 };

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const s = net.sample(now);
  if (!s) {
    renderer.render(scene, camera);
    return;
  }

  // Événements visuels et sonores (chacun une seule fois), props et projectiles
  for (const ev of net.drainFx()) fx.handle(ev);
  propsView.update(s.props);
  projView.update(s.proj, dt);

  // Véhicules (vue du registre ; modèle de secours si le type n'a pas de vue)
  s.vehicles.forEach((v, i) => {
    let e = vehicleViews[i];
    if (!e || e.type !== v.type) {
      if (e) scene.remove(e.view.group);
      e = vehicleViews[i] = { type: v.type, view: viewFor(v.type).build() };
      scene.add(e.view.group);
    }
    const g = e.view.group;
    g.visible = !v.dead;
    if (v.dead) {
      if (!prevDead[i]) for (let k = 0; k < 10; k++) fx.puff([v.p[0] + (Math.random() - 0.5) * 3, v.p[1] + 0.5, v.p[2] + (Math.random() - 0.5) * 3], 1.4, true);
      prevDead[i] = true;
      return;
    }
    prevDead[i] = false;
    g.position.set(...v.p);
    g.quaternion.set(...v.q);
    e.view.update(v, dt);
    // Fumée sous 30 % de vie, flammes sous 15 %
    if (v.hp < 0.3) {
      smokeT[i] = (smokeT[i] ?? 0) - dt;
      if (smokeT[i] <= 0) {
        smokeT[i] = 0.06 + v.hp * 0.3;
        fx.puff([v.p[0] + (Math.random() - 0.5), v.p[1] + 1.1, v.p[2] + (Math.random() - 0.5)], 0.9, true);
        if (v.hp < 0.15) fx.spawn([v.p[0], v.p[1] + 1, v.p[2]], [(Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5], 0.5, 0.35, 0.05, 0xffe27a, 0xff5a1a);
      }
    }
  });
  while (vehicleViews.length > s.vehicles.length) {
    const e = vehicleViews.pop();
    if (e) scene.remove(e.view.group);
  }

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
    av.visible = p.veh < 0 && p.hp > 0;
    av.position.set(...p.p);
    av.rotation.y = p.yaw;
    av.scale.setScalar(p.sc > 0 ? p.sc : 1);
  }
  for (const [id, av] of avatars) if (!seen.has(id)) { scene.remove(av); disposeAvatar(av); avatars.delete(id); }

  // ?cmd= : envoyée une fois le joueur présent dans un snapshot ; renvoyée une fois s'il est resté à pied (/drive)
  if (me && pendingCmd && cmdState === 0) {
    net.send({ type: 'chat', text: pendingCmd });
    cmdSentAt = now;
    cmdState = 1;
  } else if (me && pendingCmd && cmdState === 1 && now - cmdSentAt > 1000) {
    cmdState = 2;
    if (me.veh < 0 && pendingCmd.startsWith('/drive')) net.send({ type: 'chat', text: pendingCmd });
  }
  if (!me) me = { ...FALLBACK_ME, id: net.id };
  const veh = me.veh >= 0 ? s.vehicles[me.veh] : undefined;
  const vdef = veh ? viewFor(veh.type) : null;
  inVehicle = !!veh;

  // Dégâts : flash rouge (plus fort à la mort)
  if (me.hp < prevHp - 0.5) hud.flash(me.hp <= 0 ? 1 : 0.4);
  prevHp = me.hp;
  hud.tick(dt);

  // Transitions monter / descendre
  if (veh && vdef && prevVeh < 0) {
    yaw = 0;
    pitch = vdef.cam.pitch;
    audio.play('enter');
  } else if (!veh && prevVeh >= 0) {
    yaw += lastVehYaw;
    pitch = 0;
    audio.play('exit');
  }
  prevVeh = veh ? me.veh : -1;

  const multi = net.mode === 'multi';
  if (veh && vdef) {
    // Caméra de poursuite : derrière et au-dessus, orbite à la souris, recentrage après 1,5 s, zoom à la molette
    const cam = vdef.cam;
    if (now - lastMouseMove > 1500) {
      const k = Math.min(1, 3 * dt);
      yaw -= yaw * k;
      pitch += (cam.pitch - pitch) * k;
    }
    pitch = Math.max(-1.2, Math.min(0.2, pitch));
    tmpQ.set(...veh.q);
    lastVehYaw = new THREE.Euler().setFromQuaternion(tmpQ, 'YXZ').y;
    const eul = new THREE.Euler(pitch, lastVehYaw + yaw, 0, 'YXZ');
    camTarget.set(...veh.p).add(tmpV.set(0, cam.height, 0));
    camera.position.copy(tmpV.set(0, 0, cam.distance * zoom).applyEuler(eul).add(camTarget));
    camera.position.y = Math.max(camera.position.y, 0.5);
    camera.rotation.copy(eul);
    hudText.textContent = touchMode ? '' : vdef.hud(veh, L); // au toucher, l'aide clavier est inutile
  } else {
    camera.position.set(me.p[0], me.p[1] + EYE, me.p[2]);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    let hint = '';
    s.vehicles.forEach((v) => {
      if (v.dead || v.drv) return;
      const d = viewFor(v.type);
      if (Math.hypot(me!.p[0] - v.p[0], me!.p[2] - v.p[2]) < (d.enterRadius ?? 6)) hint = `\n${L('interact')} : monter dans ${d.name ?? v.type}`;
    });
    hudText.textContent = touchMode ? hint.trim() : `${L('forward')}${L('left')}${L('back')}${L('right')} : marcher · ${L('jump')} : sauter · ${L('inventory')} : inventaire`
      + (multi ? ` · ${L('chat')} : chat` : '') + hint;
  }

  // Visée envoyée au serveur : position et direction réelles de la caméra
  camera.updateMatrixWorld();
  camera.getWorldDirection(tmpV);
  aimO = [camera.position.x, camera.position.y, camera.position.z];
  aimD = [tmpV.x, tmpV.y, tmpV.z];

  // Son : moteurs (selon vitesse et distance), pas à pied, vent
  const dtSafe = Math.max(dt, 0.001);
  if (prevPos && !veh) walkSpeed += (Math.hypot(me.p[0] - prevPos[0], me.p[2] - prevPos[1]) / dtSafe - walkSpeed) * Math.min(1, dt * 10);
  else walkSpeed = 0;
  prevPos = [me.p[0], me.p[2]];
  const mine = me.veh;
  audio.update(
    dt,
    aimO,
    s.vehicles.map((v, i) => ({ type: v.type, engine: viewFor(v.type).engine, p: v.p, speed: v.sp, driven: !!v.drv && !v.dead, mine: i === mine, arm: v.a })),
    !veh && walkSpeed > 1.5,
  );

  // Effets (particules, ondes…) puis secousse de caméra
  fx.update(dt, camera);
  if (fx.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * fx.shake;
    camera.position.y += (Math.random() - 0.5) * fx.shake;
    camera.position.z += (Math.random() - 0.5) * fx.shake;
  }

  hud.update({
    hp: me.hp, vehHp: veh ? veh.hp : null, vehName: vdef?.name ?? '', hotbar: hotbar(), selected, keyLabels: slotLabels(), inVehicle: !!veh,
  });

  touch?.setContext({
    playing: playing && !touchPaused, inVehicle: !!veh, vehicleType: veh?.type ?? '', physgun: selectedItem() === 'physgun', chat: net.mode === 'multi',
  });
  playersEl.textContent = s.players.map((p) => (p.id === net.id ? `${p.name} (toi)` : p.name)).join('\n');
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
