import * as THREE from 'three';
import { GROUND, ROAD_X, seeded, treeLayout } from '../shared/constants';
import { canvasTexture, toon, toonRaw } from './gfx';
import { wedgeVertices } from '../shared/props';
import { LABELS, STATICS, treeBlocked, type LabelDef, type StaticDef, type StaticShape } from '../shared/world';

/** Décor statique : ciel, lumière, sol herbeux, route, arbres, nuages. (Les collisions des arbres sont côté serveur.) */
export function buildEnvironment(scene: THREE.Scene) {
  const rand = seeded(1337);
  scene.background = new THREE.Color(0x9fd3ff);
  scene.fog = new THREE.Fog(0x9fd3ff, 80, 300);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  // Sol
  const grass = canvasTexture([256, 256], (g) => {
    g.fillStyle = '#7ec850';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = rand() < 0.5 ? '#6fb842' : '#91dc63';
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 5, 2 + rand() * 5);
    }
    g.strokeStyle = '#4f9c2e';
    g.lineWidth = 2;
    for (let i = 0; i < 45; i++) {
      const x = 8 + rand() * 240, y = 12 + rand() * 236;
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x - 4, y - 9);
      g.moveTo(x, y); g.lineTo(x + 4, y - 9);
      g.moveTo(x, y); g.lineTo(x, y - 11);
      g.stroke();
    }
    const flowers = ['#ffffff', '#ffe066', '#ff8fab'];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = flowers[i % 3];
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, [GROUND / 4, GROUND / 4]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND * 2, GROUND * 2), toon(0xffffff, grass));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Route le long de l'axe Z
  const roadTex = canvasTexture([64, 128], (g) => {
    g.fillStyle = '#4a4e57';
    g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = rand() < 0.5 ? '#40444c' : '#575b65';
      g.fillRect(rand() * 64, rand() * 128, 2, 2);
    }
    g.fillStyle = '#f5f5f5';
    g.fillRect(29, 12, 6, 50);
    g.fillStyle = '#e9d44a';
    g.fillRect(2, 0, 2, 128);
    g.fillRect(60, 0, 2, 128);
  }, [1, GROUND / 4]);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(10, GROUND * 2),
    toonRaw({ map: roadTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(ROAD_X, 0.02, 0);
  scene.add(road);

  // Arbres instanciés
  const trees = treeLayout().filter((t) => !treeBlocked(t)); // les arbres qui gênent un lieu sont retirés
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6), toon(0x8b5a2b), trees.length);
  const leavesLow = new THREE.InstancedMesh(new THREE.ConeGeometry(2.0, 3.0, 7), toon(0x2fa84f), trees.length);
  const leavesTop = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 2.4, 7), toon(0x3cc261), trees.length);
  const m4 = new THREE.Matrix4();
  trees.forEach((t, i) => {
    const place = (mesh: THREE.InstancedMesh, y: number) => mesh.setMatrixAt(i, m4.makeScale(t.s, t.s, t.s).setPosition(t.x, y * t.s, t.z));
    place(trunks, 1.2);
    place(leavesLow, 3.4);
    place(leavesTop, 5.1);
  });
  scene.add(trunks, leavesLow, leavesTop);

  // Nuages
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 5, 8, 6), cloudMat);
      puff.position.set(j * 8 - 12, rand() * 3, rand() * 5);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    cloud.position.set((rand() - 0.5) * 500, 70 + rand() * 30, (rand() - 0.5) * 500);
    scene.add(cloud);
  }

  buildWorldDecor(scene);
}

// ---------- Décor fixe de shared/world.ts : formes instanciées (un draw call par forme) + panneaux de texte ----------
function unitGeometry(shape: StaticShape): THREE.BufferGeometry {
  if (shape === 'box') return new THREE.BoxGeometry(1, 1, 1);
  if (shape === 'cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
  if (shape === 'sphere') return new THREE.SphereGeometry(0.5, 16, 12);
  const v = wedgeVertices(1, 1, 1);
  const P = (i: number) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const pos: number[] = [];
  for (const t of [[0, 2, 1], [1, 2, 3], [2, 4, 3], [3, 4, 5], [0, 1, 5], [0, 5, 4], [0, 4, 2], [1, 3, 5]]) for (const i of t) pos.push(...P(i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1b1b2b, side: THREE.BackSide });

function buildWorldDecor(scene: THREE.Scene) {
  const groups = new Map<string, StaticDef[]>();
  for (const s of STATICS) {
    const key = `${s.shape}${s.glow ? '+' : ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  const scaleOf = (s: StaticDef, grow: number) => {
    const [a, b, c] = s.size;
    if (s.shape === 'cylinder') return sc.set(a + grow, b + grow, a + grow);
    if (s.shape === 'sphere') return sc.set(a + grow, a + grow, a + grow);
    return sc.set(a + grow, b + grow, c + grow);
  };
  for (const [key, list] of groups) {
    const shape = key.replace('+', '') as StaticShape;
    const geo = unitGeometry(shape);
    const mat = key.endsWith('+') ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : toon(0xffffff);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.frustumCulled = false;
    const outlined = list.filter((s) => s.outline ?? (s.collide !== false && !s.glow));
    const edge = outlined.length ? new THREE.InstancedMesh(geo, OUTLINE, outlined.length) : null;
    if (edge) edge.frustumCulled = false;
    list.forEach((s, i) => {
      q.setFromAxisAngle(Y, s.rotY ?? 0);
      pos.set(...s.pos);
      m4.compose(pos, q, scaleOf(s, 0));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.setHex(s.color));
    });
    outlined.forEach((s, i) => {
      q.setFromAxisAngle(Y, s.rotY ?? 0);
      pos.set(...s.pos);
      m4.compose(pos, q, scaleOf(s, Math.min(0.16, 0.06 + Math.min(...s.size.filter((n) => n > 0)) * 0.02)));
      edge!.setMatrixAt(i, m4);
    });
    scene.add(mesh);
    if (edge) scene.add(edge);
  }
  for (const l of LABELS) scene.add(makeLabel(l));
}

function makeLabel(l: LabelDef): THREE.Mesh {
  const lines = l.text.split('\n');
  const W = 512, H = Math.max(64, Math.min(512, Math.round((W * l.h) / l.w)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let size = Math.min((H / lines.length) * 0.82, 120);
  const font = (n: number) => `bold ${n}px "Segoe UI", "Arial Black", sans-serif`;
  g.font = font(size);
  const widest = () => Math.max(...lines.map((t) => g.measureText(t).width));
  while (widest() > W * 0.94 && size > 10) g.font = font((size -= 4));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#' + (l.color ?? 0x222233).toString(16).padStart(6, '0');
  lines.forEach((t, i) => g.fillText(t, W / 2, (H / lines.length) * (i + 0.54)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(l.w, l.h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }),
  );
  mesh.position.set(...l.pos);
  if (l.flat) mesh.rotation.set(-Math.PI / 2, l.rotY ?? 0, 0, 'YXZ');
  else mesh.rotation.y = l.rotY ?? 0;
  return mesh;
}
