import * as THREE from 'three';
import { PED_KINDS } from '../shared/ids';
import { PED_STRIDE, type Input, type PlayerSnap, type PrivateState } from '../shared/protocol';
import { defaultSettings, type ActionId, type Settings } from '../shared/settings';
import { AutoLock, computeAim, type AimTarget } from './aim';
import { GameAudio, SOUNDS, registerSound } from './audio';
import { CameraRig } from './camera';
import { createChat } from './chat';
import { Fx } from './fx';
import { copsInSight, createHud } from './hud';
import { buildAvatar, disposeAvatar, setAvatarState } from './models';
import { MarkersView } from './markers';
import { createMinigames } from './minigames';
import { Net } from './net';
import { PedsView } from './peds';
import { ProjectilesView } from './projectiles';
import { PropsView } from './props';
import { buildEnvironment } from './scene';
import { launcher, loadSettings, saveSettings } from './settings';
import { Pda } from './ui/pda';
import { installMarcheTab, notePrices, resetMarket } from './ui/pda/marche';
import { ShopUi } from './ui/shop';
import './ui/pda/missions'; // enregistre l'onglet Missions (et ses vignettes) : surtout pas depuis pda.ts (cycle)
import { noteGameEvent, noteMe } from './ui/pda/stats';
import { showMissionResult, showVignettes } from './ui/comic';
import { missionById } from '../shared/missions';
import { getLayout, keyLabel, openSettings } from './ui/settingsPanel';
import { viewFor } from './vehicles';
import type { VehicleView } from './vehicles/types';

// ---------- Rendu ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const city = buildEnvironment(scene);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 600);
const rig = new CameraRig(camera);
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
const pedsView = new PedsView(scene);
const markers = new MarkersView(scene, camera);
const autoLock = new AutoLock();
let lockPos: [number, number, number] | null = null; // cible verrouillée (monde) : le réticule s'y place
// Sons de la voiture de police et du klaxon civil (le serveur envoie `siren`, `siren_off`, `horn_car`) : enregistrés s'ils manquent
if (!SOUNDS.horn_car) registerSound('horn_car', (a) => SOUNDS.horn_1(a, {}));
if (!SOUNDS.siren) registerSound('siren', (a) => { for (let i = 0; i < 4; i++) a.tone(i % 2 ? 640 : 960, i % 2 ? 640 : 960, 0.22, 0.2, 'square', i * 0.22); });
if (!SOUNDS.siren_off) registerSound('siren_off', (a) => a.tone(700, 300, 0.18, 0.15, 'square'));
const hud = createHud();
hud.setVisible(false);
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

const URLP = new URLSearchParams(location.search);

// Les navigateurs n'autorisent le son qu'après un geste du joueur
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => audio.resume(), { capture: true });
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest?.('button')) audio.play('click');
});

// ---------- Entrées ----------
const keys = new Set<string>();
/** Touches physiquement maintenues, même pendant un mini-jeu / le PDA : restituées à la fermeture pour ne pas casser la conduite. */
const held = new Set<string>();
addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName !== 'INPUT') held.add(e.code); }, true);
addEventListener('keyup', (e) => held.delete(e.code), true);
const blockedAim = () => chat.isOpen() || settingsOpen || pda.isOpen() || shop.isOpen() || mg.active();
/** Les touches sont lues par code physique (event.code) : le même réglage marche en AZERTY et en QWERTY. */
const isDown = (a: ActionId) => !!settings.keys[a] && keys.has(settings.keys[a]);
const axis = (pos: ActionId, neg: ActionId) => (isDown(pos) ? 1 : 0) - (isDown(neg) ? 1 : 0);
let yaw = 0; // à pied : direction du personnage (vers le curseur)
// Vue de dessus : caméra inclinée (src/camera.ts), curseur virtuel (la souris reste capturée pour que Échap = pause)
let cursorX = innerWidth / 2;
let cursorY = innerHeight / 2;
{
  // ?aim=<yawDeg>,<pitchDeg> : regard initial (tests)
  const a = (URLP.get('aim') ?? '').split(',').map(Number);
  if (a.length === 2 && a.every(Number.isFinite)) yaw = (a[0] * Math.PI) / 180;
}
let lastMouseMove = 0;
let m1 = 0, m2 = 0;
let inVehicle = false;
let aimO: [number, number, number] = [0, 0, 0];
let aimD: [number, number, number] = [0, 0, -1];

/** Souris capturée. */
const locked = () => document.pointerLockElement === renderer.domElement;
/** Reprend la main sur le jeu : capture de la souris. */
const grab = () => {
  renderer.domElement.requestPointerLock()?.catch?.(() => {});
};
addEventListener('wheel', (e) => {
  if (!playing || chat.isOpen() || settingsOpen || pda.isOpen() || mg.active()) return;
  if (inVehicle) rig.zoomBy(e.deltaY); // zoom des véhicules, au choix du joueur
}, { passive: true });

renderer.domElement.addEventListener('click', () => { renderer.domElement.requestPointerLock(); });
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  lastMouseMove = performance.now();
  cursorX = Math.max(0, Math.min(innerWidth, cursorX + e.movementX * settings.sensitivity));
  cursorY = Math.max(0, Math.min(innerHeight, cursorY + e.movementY * settings.sensitivity));
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
  if ((e.target as HTMLElement).tagName === 'INPUT' || settingsOpen || !playing || pda.isOpen() || shop.isOpen() || mg.active()) return;
  keys.add(e.code);
  if (!e.repeat) {
    if (e.code === settings.keys.interact && !shop.interact()) net.send({ type: 'interact' });
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
addEventListener('blur', () => { keys.clear(); held.clear(); m1 = m2 = 0; });

const readInput = (): Input => {
  const blocked = chat.isOpen() || settingsOpen || pda.isOpen() || shop.isOpen() || mg.active();
  // En véhicule : commandes relatives au véhicule. À pied : relatives à l'écran (haut = avant), converties pour le serveur
  // (qui attend avant/côté par rapport à la direction `yaw` du personnage) en tenant compte du pivot de la caméra.
  const mv = { f: axis('forward', 'back'), s: axis('right', 'left') };
  if (!inVehicle && (mv.f || mv.s)) {
    const sx = mv.s, sz = -mv.f; // écran : droite = +x, haut = -z
    const c = Math.cos(rig.yaw), si = Math.sin(rig.yaw);
    const wx = sx * c + sz * si, wz = -sx * si + sz * c; // monde
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    mv.s = wx * cy - wz * sy;
    mv.f = -(wx * sy + wz * cy);
    const n = Math.hypot(mv.s, mv.f);
    if (n > 1) { mv.s /= n; mv.f /= n; }
  }
  return {
    f: blocked ? 0 : mv.f, s: blocked ? 0 : mv.s,
    jump: !blocked && isDown('jump') ? 1 : 0, run: !blocked && isDown('sprint') ? 1 : 0, yaw,
    hn: !blocked && isDown('horn') ? 1 : 0, act: !blocked && isDown('activity') ? 1 : 0,
    m1: blocked ? 0 : m1, m2: blocked ? 0 : m2,
    ao: aimO, ad: aimD,
  };
};

// ---------- Réseau, menu, pause, chat ----------
const net = new Net();
let curMe: PlayerSnap | null = null; // moi dans le dernier snapshot échantillonné (carte du PDA)
let mates: { name: string; x: number; z: number }[] = [];
let me_: PrivateState | null = null; // dernier état privé (argent, étoiles, repères…)
let simT = 0; // temps de simulation du dernier snapshot échantillonné (ms) : compte à rebours du PDA
net.onMe = (s) => { me_ = s; noteMe(s); pda.setState(s); shop.setState(s); notePrices(s, net.simTime); };
const mg = createMinigames({ send: (r) => net.send({ type: 'game', m: { k: 'mg', r } }) });
// Échap pendant un mini-jeu ou le PDA : le navigateur libère la souris ; on ne veut pas l'écran de pause pour autant
let quietUntil = 0;
addEventListener('keydown', (e) => { if (e.code === 'Escape' && (mg.active() || pda.isOpen() || shop.isOpen())) quietUntil = performance.now() + 600; }, true);
net.onGame = (e) => {
  noteGameEvent(e);
  if (e.k === 'toast') { hud.toast(e.text); chat.add({ from: '', text: e.text, sys: true }); }
  else if (e.k === 'sms') { hud.toast(`SMS · ${e.sms.from} : ${e.sms.text}`, 5000); audio.play('chat'); }
  else if (e.k === 'vignettes') { keys.clear(); m1 = m2 = 0; void showVignettes(e.id); }
  else if (e.k === 'mg_start') { keys.clear(); m1 = m2 = 0; mg.start(e.s); }
  else if (e.k === 'mg_end') mg.end(e.sid);
  else if (e.k === 'mort') hud.alert('ko');
  else if (e.k === 'arrete') hud.alert('arrete');
  else if (e.k === 'mission') {
    if (e.ev === 'done') {
      keys.clear(); m1 = m2 = 0;
      const def = missionById(e.id);
      void showMissionResult({
        title: def?.name ?? e.id, medal: e.medal ?? null,
        stats: { ms: e.ms, damage: e.damage, accuracy: e.accuracy }, reward: e.reward,
        par: e.par ? { ms: e.par.ms, maxDamage: e.par.maxDamage, minAccuracy: e.par.minAccuracy } : undefined,
      });
    } else if (e.text) hud.toast(e.text);
  }
};
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
    updatePause();
  },
  onClose: () => {
    grab();
    updatePause();
  },
});
installMarcheTab();
const pda = new Pda(document.body, {
  send: (m) => net.send({ type: 'game', m }),
  now: () => simT,
  key: () => settings.keys.pda,
  canOpen: () => playing && !chat.isOpen() && !settingsOpen && !shop.isOpen() && !mg.active(),
  onToggle: (open) => {
    keys.clear();
    m1 = m2 = 0;
    if (open) document.exitPointerLock();
    else { quietUntil = Math.max(quietUntil, performance.now() + 300); grab(); }
    updatePause();
  },
  player: () => (curMe ? { x: curMe.p[0], z: curMe.p[2], yaw: curMe.yaw } : null),
  mates: () => mates,
});
const shop = new ShopUi(document.body, {
  send: (m) => net.send({ type: 'game', m }),
  onToggle: (open) => {
    keys.clear();
    m1 = m2 = 0;
    if (open) document.exitPointerLock();
    else { quietUntil = Math.max(quietUntil, performance.now() + 300); grab(); }
    updatePause();
  },
  toast: (t) => { if (t) hud.toast(t); },
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
  // ?nopause : cache l'écran de pause (captures et tests automatisés en navigateur sans capture de souris)
  const noPause = new URLSearchParams(location.search).has('nopause');
  const quiet = performance.now() < quietUntil;
  pauseEl.style.display = !noPause && playing && !locked() && !chat.isOpen() && !settingsOpen && !pda.isOpen() && !shop.isOpen() && !mg.active() && !quiet ? 'flex' : 'none';
  if (quiet && playing && !locked() && !pda.isOpen() && !shop.isOpen() && !mg.active()) { grab(); setTimeout(updatePause, quietUntil - performance.now() + 20); }
};
document.addEventListener('pointerlockchange', updatePause);
pauseEl.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
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
    resetMarket();
    menu.style.display = 'none';
    playing = true;
    hud.setVisible(true);
    chat.setEnabled(net.mode === 'multi');
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
  audio, net, fx, hud, renderer,
  get settings() { return settings; },
  get props() { return propsView.count; },
  get projectiles() { return projView.count; },
  get fxActive() { return fx.active; },
  get fxHandled() { return fx.handled; },
  get vehicles() { return vehicleViews.filter(Boolean).length; },
  get inVehicle() { return inVehicle; },
  get input() { return readInput(); },
  get me() { return me_; },
  get peds() { return pedsView.count; },
  get drawCalls() { return renderer.info.render.calls; },
  get cityDrawCalls() { return city.drawCalls; },
  get lock() { return lockPos; },
  get pda() { return pda; },
  mg,
};
Object.assign(window, { __wtf: stats });

// ---------- Boucle de rendu ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aimPoint = new THREE.Vector3();
const crosshairEl = document.getElementById('crosshair')!;
let prevVeh = -1;
let last = performance.now();
let prevPos: [number, number] | null = null;
let walkSpeed = 0;
let prevHp = 100;
let wasFrozen = false;
let wasDead = false;
let lastFocus: [number, number] | null = null;
/** Vitesses de pointe (m/s) des voitures, pour le zoom de la caméra (cf. shared/vehicles/*.ts). */
const VMAX: Record<string, number> = { citadine: 24.5, berline: 27, camionnette: 19.5, police: 30 };
const tmpV = new THREE.Vector3();
const prevDead: boolean[] = [];
const FALLBACK_ME: PlayerSnap = { id: '', name: '', p: [0, 2, 5], yaw: 0, veh: -1, seat: 0, hp: 100 };

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const s = net.sample(now);
  if (!s) {
    renderer.render(scene, camera);
    return;
  }
  simT = net.simTime;

  // Événements visuels et sonores (chacun une seule fois), props et projectiles
  for (const ev of net.drainFx()) fx.handle(ev);
  propsView.update(s.props);
  projView.update(s.proj, dt);
  pedsView.update(s.peds, dt);

  // Véhicules (vue du registre ; modèle de secours si le type n'a pas de vue)
  s.vehicles.forEach((v, i) => {
    let e = vehicleViews[i];
    if (!e || e.type !== v.type) {
      if (e) scene.remove(e.view.group);
      e = vehicleViews[i] = { type: v.type, view: viewFor(v.type).build(i) };
      scene.add(e.view.group);
    }
    const g = e.view.group;
    g.visible = !v.dead;
    if (v.dead) {
      if (!prevDead[i] && v.dead === 1) for (let k = 0; k < 10; k++) fx.puff([v.p[0] + (Math.random() - 0.5) * 3, v.p[1] + 0.5, v.p[2] + (Math.random() - 0.5) * 3], 1.4, true);
      prevDead[i] = true;
      return;
    }
    prevDead[i] = false;
    g.position.set(...v.p);
    g.quaternion.set(...v.q);
    e.view.update(v, dt);
    fx.vehicleFx(v, i, dt);
  });
  while (vehicleViews.length > s.vehicles.length) {
    const e = vehicleViews.pop();
    if (e) scene.remove(e.view.group);
  }

  // Joueurs (les autres ; invisibles quand ils sont dans un véhicule)
  const seen = new Set<string>();
  let me = s.players.find((p) => p.id === net.id);
  for (const p of s.players) {
    seen.add(p.id);
    let av = avatars.get(p.id);
    if (!av) {
      av = buildAvatar(p.name);
      avatars.set(p.id, av);
      scene.add(av);
    }
    av.visible = p.veh < 0;
    setAvatarState(av, p.an, p.id !== net.id);
    av.position.set(...p.p);
    av.rotation.y = p.yaw;
    av.rotation.x = p.an === 2 ? -((now / 90) % (Math.PI * 2)) : 0; // roulade : le personnage fait des tonneaux
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
  curMe = me;
  mates = s.players.filter((p) => p.id !== net.id).map((p) => ({ name: p.name, x: p.p[0], z: p.p[2] }));
  const veh = me.veh >= 0 ? s.vehicles[me.veh] : undefined;
  const vdef = veh ? viewFor(veh.type) : null;
  inVehicle = !!veh;

  // Dégâts : flash rouge (plus fort à la mort)
  if (me.hp < prevHp - 0.5) hud.flash(me.hp <= 0 ? 1 : 0.4);
  prevHp = me.hp;
  hud.tick(dt);

  // Transitions monter / descendre
  if (veh && vdef && prevVeh < 0) {
    rig.onEnterVehicle();
    audio.play('enter');
  } else if (!veh && prevVeh >= 0) {
    yaw = rig.lastVehYaw;
    audio.play('exit');
  }
  prevVeh = veh ? me.veh : -1;

  const multi = net.mode === 'multi';
  // Caméra de dessus inclinée (src/camera.ts) ; texte d'aide selon ce que fait le joueur
  let focus: [number, number, number];
  if (veh && vdef) {
    focus = veh.p;
    hudText.textContent = vdef.hud(veh, L);
  } else {
    focus = me.p;
    let hint = '';
    s.vehicles.forEach((v) => {
      if (v.dead || v.drv) return;
      const d = viewFor(v.type);
      if (Math.hypot(me!.p[0] - v.p[0], me!.p[2] - v.p[2]) < (d.enterRadius ?? 6)) hint = `
${L('interact')} : monter dans ${d.name ?? v.type}`;
    });
    hudText.textContent = `${L('forward')}${L('left')}${L('back')}${L('right')} : marcher · ${L('jump')} : roulade · ${L('sprint')} : courir · ${L('pda')} : PDA`
      + (multi ? ` · ${L('chat')} : chat` : '') + hint + (shop.canInteract() ? `
${L('interact')} : parler au dealer` : '');
  }
  const frozen = mg.active(); // mini-jeu ouvert : caméra et visée figées, entrées nulles, scène non rendue
  if (frozen !== wasFrozen) {
    wasFrozen = frozen;
    hud.setVisible(!frozen);
    if (!frozen) { keys.clear(); for (const k of held) keys.add(k); } // les touches encore maintenues repartent
  }
  // Téléportation (réapparition, hôpital, commissariat) : la caméra saute au lieu de traverser la ville
  const jumped = lastFocus !== null && Math.hypot(focus[0] - lastFocus[0], focus[2] - lastFocus[1]) > 30;
  if (jumped || (wasDead && me.hp > 0)) rig.teleported();
  wasDead = me.hp <= 0;
  lastFocus = [focus[0], focus[2]];
  if (!frozen) rig.update(dt, { pos: focus, veh: veh && vdef ? { q: veh.q, sp: veh.sp, camDistance: vdef.cam.distance, vmax: VMAX[veh.type] } : undefined });
  city.update(focus);
  markers.update(me_?.marks ?? [], dt, focus);

  // Visée : le curseur est projeté sur un plan horizontal à hauteur d'épaule
  if (!frozen) {
    const shoulderY = (veh ? veh.p[1] : me.p[1]) + 1.2;
    ndc.set((cursorX / innerWidth) * 2 - 1, -(cursorY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y < -0.01) {
      const t = (shoulderY - o.y) / d.y;
      aimPoint.set(o.x + d.x * t, shoulderY, o.z + d.z * t);
    } else {
      aimPoint.set(o.x + d.x * 30, shoulderY, o.z + d.z * 30);
    }
    const ox = veh ? veh.p[0] : me.p[0], oz = veh ? veh.p[2] : me.p[2];
    aimO = [ox, shoulderY, oz];
    tmpV.set(aimPoint.x - ox, 0, aimPoint.z - oz);
    if (tmpV.lengthSq() < 0.04) tmpV.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    tmpV.normalize();
    aimD = [tmpV.x, 0, tmpV.z];
    const cursorYaw = Math.atan2(-tmpV.x, -tmpV.z);
    // Verrouillage automatique à pied : flics et gangs debout, sauf visée libre (bouton secondaire)
    lockPos = null;
    if (!veh && me.hp > 0) {
      const targets: AimTarget[] = [];
      const pd = s.peds;
      for (let o2 = 0; o2 + PED_STRIDE <= pd.length; o2 += PED_STRIDE) {
        const kind = PED_KINDS[pd[o2 + 1]];
        if ((kind === 'flic' || kind === 'gang') && pd[o2 + 5] !== 2) targets.push({ id: pd[o2], pos: [pd[o2 + 2], me.p[1], pd[o2 + 3]], aimHeight: 1.2 });
      }
      const t = autoLock.update(me.p, cursorYaw, targets, !blockedAim() && !m2, performance.now());
      const aim = computeAim(me.p, cursorYaw, t?.pos ?? null);
      if (t) { lockPos = t.pos; aimO = aim.origin; aimD = aim.dir; yaw = aim.yaw; } else yaw = cursorYaw;
    } else { autoLock.reset(); if (!veh) yaw = cursorYaw; }
  }
  if (lockPos) {
    tmpV.set(lockPos[0], lockPos[1], lockPos[2]).project(camera);
    crosshairEl.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
    crosshairEl.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
  } else {
    crosshairEl.style.left = `${cursorX}px`;
    crosshairEl.style.top = `${cursorY}px`;
  }
  crosshairEl.classList.toggle('lock', !!lockPos);

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
    hp: me.hp, vehHp: veh ? veh.hp : null, vehName: vdef?.name ?? '', inVehicle: !!veh,
    x: focus[0], z: focus[2], yaw: veh ? Math.atan2(2 * (veh.q[3] * veh.q[1] + veh.q[0] * veh.q[2]), 1 - 2 * (veh.q[1] * veh.q[1] + veh.q[2] * veh.q[2])) : me.yaw,
    mates, cops: copsInSight(focus[0], focus[2], s.peds, s.vehicles),
  }, me_);

  playersEl.textContent = s.players.map((p) => (p.id === net.id ? `${p.name} (toi)` : p.name)).join('\n');
  if (!frozen) renderer.render(scene, camera); // sous un mini-jeu plein écran, la dernière image reste affichée
}
requestAnimationFrame(frame);
