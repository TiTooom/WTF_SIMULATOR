// Page de test des captures (chargée par tests/captures.html via Vite) : rend une scène selon `?shot=` SANS serveur de jeu.
// Remplit window.__shot = { ready, calls, tris, cityDraw, chunks, ms, signs, geoms, tex } pour tests/captures.ts.
// La caméra est la VRAIE `CameraRig` de src/camera.ts (mêmes angles et distances qu'en jeu).
import * as THREE from 'three';
import { CITY, getCity } from '../shared/city/layout';
import type { Mark, PrivateState, VehicleSnap } from '../shared/protocol';
import { CameraRig } from '../src/camera';
import { Fx } from '../src/fx';
import { createHud } from '../src/hud';
import { buildAvatar, playerColor, setAvatarState } from '../src/models';
import { XRay } from '../src/gfx';
import { ProjectilesView } from '../src/projectiles';
import { MarkersView } from '../src/markers';
import { PedsView } from '../src/peds';
import { buildEnvironment } from '../src/scene';
import { Pda } from '../src/ui/pda';
import { pushSms } from '../src/ui/pda/sms';
import { playComic, showMissionResult } from '../src/ui/comic';
import { viewFor } from '../src/vehicles';
import type { VehicleView } from '../src/vehicles/types';

const q = new URLSearchParams(location.search);
const shot = q.get('shot') ?? 'city';
const info = { ready: false, calls: 0, tris: 0, cityDraw: 0, chunks: 0, ms: 0, signs: 0, geoms: 0, tex: 0, shot };
(window as unknown as { __shot: typeof info }).__shot = info;

const ME: PrivateState = {
  money: 12480, bag: {}, bagCap: 30, stars: 3, starProgress: 0.45, district: 'docks', unread: 2,
  mission: { id: 'm1', step: 2, steps: 4, text: 'Livre la caisse de café au Vieux Bourg', ms: 83000, timeLimitMs: 240000 },
  marks: [
    { x: -40, z: -60, k: 'mission', label: 'Livraison' }, { x: 120, z: 90, k: 'dealer', label: 'Dealer' }, { x: -200, z: 140, k: 'planque' },
    { x: 20, z: 220, k: 'camera' }, { x: 260, z: -120, k: 'donneur', label: 'Contact' }, { x: -90, z: -250, k: 'cible', label: 'Cible' },
  ] satisfies Mark[],
  medals: {},
};

if (shot.startsWith('comic_') || shot.startsWith('result_')) {
  // Pages « BD » : aucune scène 3D (rapide), seulement la planche ou l'écran de résultat
  document.body.style.background = '#0a0a16';
  if (shot.startsWith('comic_')) {
    const img = shot.slice(6);
    void playComic([{ img, who: img === 'explosion' || img === 'medaille' || img === 'argent' ? undefined : 'Léa', text: "C'est la dernière fois que je prête ma voiture à quelqu'un du campus, promis !" }]);
    setTimeout(() => { info.ready = true; }, 2600);
  } else {
    const tier = shot.slice(7) as 'bronze' | 'argent' | 'or';
    void showMissionResult({ title: 'La caisse de café', medal: tier === ('none' as string) ? null : tier, stats: { ms: 187000, damage: 24, accuracy: 0.72 }, reward: 1500, par: { ms: 200000, maxDamage: 30, minAccuracy: 0.8 } });
    setTimeout(() => { info.ready = true; }, 4200);
  }
} else {
  void run3d();
}

async function run3d() {
  const W = innerWidth, H = innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const city = buildEnvironment(scene);
  const camera = new THREE.PerspectiveCamera(45, W / H, 1, 600);
  const rig = new CameraRig(camera);
  /** Caméra de jeu à pied (zoom = molette) centrée sur (tx, tz). */
  const gameCam = (tx: number, tz: number, zoom = 1) => { rig.zoom = zoom; rig.update(0.016, { pos: [tx, 0.85, tz] }); };
  /** Caméra de jeu en véhicule (cap 0, vitesse sp) : la caméra converge vers sa position de croisière. */
  const driveCam = (tx: number, tz: number, sp = 20, zoom = 1) => {
    rig.zoom = zoom;
    for (let i = 0; i < 200; i++) rig.update(0.05, { pos: [tx, 0.5, tz], veh: { q: [0, 0, 0, 1], sp, camDistance: 9.5 } });
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
  function pedsFrame(n: number, cx: number, cz: number, t: number, spread = 1): Float32Array {
    const a = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 * (1 + Math.floor(i / 40)), r = (5 + (i % 4) * 2.2) * spread + Math.floor(i / 40) * 5;
      const st = i % 11 === 0 ? 2 : i % 7 === 0 ? 1 : 0;
      a.set([i + 1, i % 5, cx + Math.cos(ang) * r + (st === 2 ? 0 : t * 0.5), cz + Math.sin(ang) * r, ang + Math.PI, st], i * 6);
    }
    return a;
  }

  // Cas « joueur derrière un immeuble haut » : le plus haut bâtiment dont la face nord donne sur la rue ; le joueur est collé contre cette face
  // (la caméra est au sud, l'immeuble est donc entre elle et lui). occluded = à pied, occluded_car = en voiture, occluded_off = sans aucun correctif.
  const occ = shot.startsWith('occluded');
  const xray = new XRay(renderer, scene, camera);
  let occTarget: THREE.Object3D | null = null, occMate: THREE.Object3D | null = null, occFocus: [number, number, number] = [0, 0.85, 0];
  if (occ) {
    const cty = getCity();
    const cand = cty.buildings.filter((b) => { const k = cty.blocks[b.block]; return k && k.kind === 'batiments' && b.z - b.d / 2 - (k.z - CITY.LOT / 2) < 4 && Math.abs(b.x) < 200 && Math.abs(b.z) < 200; }).sort((a, b) => b.h - a.h)[0];
    const car = shot === 'occluded_car';
    const px = cand.x, pz = cand.z - cand.d / 2 - (car ? 6 : 3.2);
    occFocus = [px, car ? 0.45 : 0.85, pz];
    console.log(`occluded : immeuble h=${cand.h.toFixed(1)} w=${cand.w.toFixed(1)} d=${cand.d.toFixed(1)} en (${cand.x.toFixed(1)}, ${cand.z.toFixed(1)}), joueur en (${px.toFixed(1)}, ${pz.toFixed(1)})`);
    if (car) { driveCam(px, pz, 0); addVehicle('berline', px, pz, 0, { sp: 0 }, 2); occTarget = views[views.length - 1].group; }
    else {
      gameCam(px, pz);
      const me = buildAvatar('Léa'); me.position.set(px, 0.85, pz); setAvatarState(me, 0, false); scene.add(me); occTarget = me;
    }
    const mate = buildAvatar('Sam'); mate.position.set(px + 9, 0.85, pz + 0.5); mate.rotation.y = 0.6; scene.add(mate); occMate = mate;
    addVehicle('citadine', px - 9, pz, Math.PI / 2, {}, 1);
  }
  const hud = createHud();
  const fx = new Fx(scene, { fx() {}, play() {} } as never);
  const projView = new ProjectilesView(scene, fx);
  const avatars: THREE.Group[] = [];
  // Repères : proches (dans le cadre) et lointains (flèches de bord), mêmes réglages qu'en jeu
  const NEAR: Mark[] = [
    { x: -7, z: -2, k: 'danger', label: 'flic' }, { x: 8, z: -4, k: 'danger', label: 'flic' }, { x: -2, z: -6, k: 'dealer', label: 'Dealer' },
    { x: 11, z: -8, k: 'planque' }, { x: -12, z: -7, k: 'donneur', label: 'Contact' },
    { x: 24, z: -30, k: 'mission', label: 'Livraison' }, { x: -45, z: 18, k: 'cible', label: 'Cible' },
    { x: 5, z: 55, k: 'dealer', label: 'Dealer' }, { x: -10, z: 4, k: 'mission', label: 'Départ' },
  ];
  const mk = new MarkersView(scene, camera);
  let pda: Pda | null = null;

  if (shot === 'city_high') {
    camera.position.set(0, 65, 55); camera.lookAt(0, 0, -10);
    for (let i = 0; i < 12; i++) addVehicle(types[i % 4], -20 + (i % 6) * 12, -4 + Math.floor(i / 6) * 4, Math.PI / 2, i % 4 === 1 ? { lv: 1 } : {});
  } else if (shot === 'vehicles') {
    camera.position.set(0, 6.5, 13); camera.lookAt(0, 0.3, 0);
    types.forEach((t, i) => addVehicle(t, -9 + i * 6, 0, -0.5 + i * 0.1, { sp: 3, st: 0.3 }, i + 1));
    addVehicle('berline', -9, 7, 0.4, { hp: 0.9, lv: 1 }, 3);
    addVehicle('police', 3, 7, 3, { a: [0] }, 0);
    addVehicle('police', 9, 7, 3.4, { a: [1] }, 0);
  } else if (shot === 'taxi') {
    gameCam(0, 0, 0.55);
    addVehicle('berline', -4, 1.5, Math.PI / 2 + 0.1, { lv: 1 }, 2);
    addVehicle('berline', 4, -2.5, -Math.PI / 2, { lv: 1 }, 5);
    addVehicle('police', 0, -7, 0.5, { a: [1] }, 0);
    addVehicle('berline', -8, -6, 0.3, {}, 3);
  } else if (shot === 'peds') {
    camera.position.set(0, 9, 14); camera.lookAt(0, 0.5, 0);
  } else if (shot === 'avatars') {
    camera.position.set(0, 4.2, 7); camera.lookAt(0, 0.4, 0);
    const names = ['Léa', 'Tom', 'Camille', 'Sam', 'Inès', 'Max', 'Zoé', 'Hugo'];
    names.forEach((n, i) => {
      const a = buildAvatar(n);
      a.position.set(-6.3 + i * 1.8, 0.85, 0);
      a.rotation.y = i < 6 ? 0.5 : Math.PI + 0.4; // de face (vers la caméra) pour juger les visages
      avatars.push(a);
      scene.add(a);
    });
    setAvatarState(avatars[3], 1); setAvatarState(avatars[4], 3, true);
    avatars[5].rotation.x = 1.1;
  } else if (shot === 'fx') {
    gameCam(0, -2, 1.6);
    addVehicle('citadine', 4, 2, 0.4, { hp: 0.12, a: [0, 1], sp: 8 }, 1);
    addVehicle('police', -5, 3, -0.3, { a: [1] }, 0);
  } else if (shot === 'markers') {
    gameCam(0, 0);
    types.forEach((t, i) => addVehicle(t, -9 + i * 6, 3.5 + (i % 2) * -1, Math.PI / 2, { sp: 0 }, i + 2));
  } else if (shot === 'markers_drive') {
    driveCam(0, 0, 22);
    addVehicle('citadine', 0, 0, 0, { sp: 22 }, 1);
  } else if (shot === 'street') {
    // Un carrefour vu de la caméra de jeu, un peu dézoomée : enseignes, panneaux, bouches d'incendie
    const [sx, sz] = city.signPos[Math.min(8, city.signPos.length - 1)];
    gameCam(sx, sz - 1, 1.6);
    addVehicle('berline', sx + 6, sz + 8, Math.PI / 2, { lv: 1 }, 1);
    addVehicle('police', sx - 5, sz + 10.5, -Math.PI / 2, { a: [1] }, 0);
  } else if (shot === 'perf') {
    driveCam(0, 0, 25);
    for (let i = 0; i < 12; i++) addVehicle(types[i % 4], -22 + (i % 6) * 9, -8 + Math.floor(i / 6) * 9, Math.PI / 2, i % 4 === 1 ? { lv: 1 } : { sp: 2, a: [1] });
  } else if (occ) {
    // scène déjà posée plus haut
  } else {
    // city / hud / pda_*
    gameCam(0, 0);
    types.forEach((t, i) => addVehicle(t, -9 + i * 6, 3.5 + (i % 2) * -1, Math.PI / 2, { sp: 0 }, i + 2));
    addVehicle('police', 12, -2.5, -Math.PI / 2, {}, 0);
  }
  const markList: readonly Mark[] = shot === 'hud' || shot === 'city' ? ME.marks
    : shot === 'markers' ? NEAR.slice(0, 9)
      : shot === 'markers_drive' ? [{ x: 0, z: -34, k: 'mission', label: 'Livraison' }, { x: 14, z: -20, k: 'cible', label: 'Cible' }, { x: -6, z: 10, k: 'dealer', label: 'Dealer' }, { x: 40, z: -10, k: 'danger', label: 'flic' }]
        : shot === 'perf' ? Array.from({ length: 16 }, (_, i) => ({ x: ((i * 37) % 70) - 35, z: ((i * 53) % 60) - 30, k: (['mission', 'dealer', 'planque', 'cible', 'donneur', 'camera'] as const)[i % 6], label: i % 3 ? undefined : 'Repère' })) : [];
  mk.update(markList, 0.016, [0, 0, 0]);
  if (shot.startsWith('pda')) {
    pda = new Pda(document.body, { send: () => {}, now: () => 100000, player: () => ({ x: -30, z: 50, yaw: 0.8 }), mates: () => [{ name: 'Sam', x: 90, z: -40 }] });
    pushSms({ id: 1, from: 'Contact anonyme', text: 'Descente de police aux Docks demain matin. Les sardines vont devenir rares...', at: 40000, tip: { good: 'sardines_de_quai', district: 'docks', mult: 2.8, until: 190000 } });
    pushSms({ id: 2, from: 'Maman', text: "N'oublie pas de manger quelque chose de chaud ce soir !", at: 90000 });
    pda.setState(ME);
    pda.open(shot === 'pda_sms' ? 'sms' : 'carte');
  }
  void pda;

  if (shot === 'fx' || shot === 'perf') {
    const ev = (k: string, p: [number, number, number], o: object = {}) => fx.handle({ k, p, ...o });
    ev('boom', [0, 1, -3], { a: 7 });
    ev('boom', [-9, 1, -2], { a: 3 });
    ev('spark', [3, 0.5, 1], { b: 18 });
    ev('impact', [8, 1, -3], { s: 'POW !' });
    ev('debris', [5, 1, -6], { b: 10, c: 0x2f80ed });
    ev('siren', [-5, 2.2, 3], { a: 2 });
    projView.update(new Float32Array([1, 2, -6, 2, 2, 8, 0, -9, 2, 1, -12, 1, 2, 7, 0, 0, 3, 0, -3, 1, 4, 0, 6, 0, 4, 0, 5, 0.6, 1, 6, 0, 0]), 1 / 30);
  }

  const street = occ ? { x: occFocus[0], z: occFocus[2] } : shot === 'street' ? { x: city.signPos[Math.min(8, city.signPos.length - 1)][0], z: city.signPos[Math.min(8, city.signPos.length - 1)][1] - 1 } : { x: 0, z: 0 };
  let frames = 0;
  const t0 = performance.now();
  const loop = () => {
    frames++;
    const t = frames / 60;
    if (shot === 'avatars') avatars.forEach((a, i) => { a.position.z = i < 3 || i > 5 ? ((frames * (i + 1) * 0.03) % 4) - 2 : 0; });
    if (shot === 'peds') peds.update(pedsFrame(30, 0, 0, t), 1 / 30);
    else if (shot === 'perf') peds.update(pedsFrame(160, 0, -6, t, 1.5), 1 / 30);
    else if (shot !== 'vehicles' && shot !== 'taxi') peds.update(pedsFrame(shot === 'street' || occ ? 8 : 40, street.x, street.z, t), 1 / 30);
    if (shot === 'city_high') city.update(0, 0);
    if (shot === 'street') city.update(street.x, street.z);
    const edge = shot === 'hud_edge';
    hud.update({ hp: 80, vehHp: null, vehName: '', inVehicle: false, x: edge ? 326 : -30 + t, z: edge ? -326 : 50, yaw: 0.8, cops: edge ? 2 : undefined },
      shot === 'hud' || shot === 'city' || edge || shot === 'perf' ? ME : null);
    hud.setVisible(shot.startsWith('hud') || shot === 'perf');
    if (edge && frames === 2) { hud.alert('arrete', 60000); hud.toast('Livraison validée'); hud.toast('Livraison validée'); hud.toast('Arrêté par la police !'); hud.setHint('ZQSD : marcher · Espace : roulade'); }
    if (markList.length) mk.update(markList, 1 / 30, [0, 0, 0]);
    if ((shot === 'fx' || shot === 'perf') && frames < 7) fx.update(1 / 30, camera);
    if (occ) {
      const off = shot === 'occluded_off', xr = shot === 'occluded_xray'; // xray : sans trou, silhouette seule
      city.occludeRadius = off || xr ? 0 : shot === 'occluded_car' ? 6.5 : 5.5;
      city.ghostInside = !off && !xr; // off / xray : on montre le défaut brut (l'intérieur noir du bâtiment) et la silhouette seule
      city.update(occFocus);
      xray.clear();
      if (!off) { if (occTarget) xray.add(occTarget, playerColor('Léa'), 0.6); if (occMate) xray.add(occMate, playerColor('Sam'), 0.35); }
    } else if (shot === 'perf') {
      xray.clear(); xray.add(views[0].group, 0xe63946, 0.6); xray.add(views[1].group, 0x1d8cf8, 0.35); // pire cas : 2 véhicules en silhouette
    }
    renderer.render(scene, camera);
    if (occ || shot === 'perf') xray.render();
    if (frames === 12) {
      info.calls = renderer.info.render.calls;
      info.tris = renderer.info.render.triangles;
      info.geoms = renderer.info.memory.geometries;
      info.tex = renderer.info.memory.textures;
      info.cityDraw = city.drawCalls;
      info.chunks = city.chunksVisible;
      info.signs = city.signCount;
      info.ms = (performance.now() - t0) / frames;
      info.ready = true;
    }
    requestAnimationFrame(loop);
  };
  void getCity();
  loop();
}
