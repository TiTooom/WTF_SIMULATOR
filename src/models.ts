import * as THREE from 'three';
import { outlined, toon } from './gfx';

// Modèles communs. Les véhicules sont dans src/vehicles/, les props dans src/props.ts.

function hashColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.55).getHex();
}

/** Joueur distant : capsule de 1,7 m centrée sur le corps physique, yeux vers −z, pastille de nom. */
export function buildAvatar(name: string): THREE.Group {
  const g = new THREE.Group();
  g.add(outlined(new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 10), toon(hashColor(name))), 0.04));
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0x1b1b2b }));
    eye.position.set(x, 0.5, -0.33);
    g.add(eye);
  }
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1b1b2b';
  ctx.strokeText(name, 128, 44);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 44);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 1.5;
  g.add(sprite);
  return g;
}

/** Libère les textures/matériaux propres d'un avatar (les géométries/matériaux toon partagés restent). */
export function disposeAvatar(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}
