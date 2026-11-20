// Constantes et génération déterministe du monde, partagées par le serveur (physique) et le client (rendu).

export const STEP = 1 / 60; // pas physique du serveur
export const SNAP_HZ = 30; // fréquence d'envoi des états aux joueurs
export const DEFAULT_PORT = 3000;
export const MAX_PLAYERS = 16;

export const GROUND = 500; // demi-taille du monde plat
export const ROAD_X = -14;

export function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export interface TreeDef { x: number; z: number; s: number }
export function treeLayout(): TreeDef[] {
  const rand = seeded(4242);
  const trees: TreeDef[] = [];
  for (let i = 0; i < 90; i++) {
    let x: number, z: number;
    do {
      x = (rand() - 0.5) * 400;
      z = (rand() - 0.5) * 400;
    } while (Math.hypot(x, z) < 30 || Math.abs(x - ROAD_X) < 9 || Math.hypot(x - 16, z - 12) < 25);
    trees.push({ x, z, s: 0.8 + rand() * 0.7 });
  }
  return trees;
}

export interface CrateDef { x: number; y: number; z: number; s: number; color: number; mass: number }
export function crateLayout(): CrateDef[] {
  const colors = [0xffb347, 0xf4a261, 0xe9c46a];
  const out: CrateDef[] = [];
  // Pyramide
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4 - i; j++)
      out.push({ x: 10 + j * 1.05 + i * 0.5, y: 0.5 + i * 1.05, z: 0, s: 1, color: colors[(i + j) % 3], mass: 1 });
  // Tas à portée de la pelleteuse
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < (i === 1 && j === 1 ? 2 : 1); k++)
        out.push({ x: 13 + i * 1.3, y: 0.6 + k * 1.2, z: 3 + j * 1.3, s: 1.2, color: colors[(i + j + k) % 3], mass: 2 });
  return out;
}

export const SPAWNS = {
  player: [0, 2, 5] as const,
  car: [-6, 1, -4] as const,
  excavator: [16, 1, 12] as const,
};

// Géométrie de la pelleteuse (partagée : le serveur calcule les pièces du bras, le client les dessine)
export const EXC = {
  L1: 4.2, // flèche
  L2: 3.2, // bras
  turretY: 0.5,
  boomPivot: [0.6, 1.0, -0.9] as const,
  limits: { boom: [-0.3, 1.1], stick: [-2.4, -0.2], bucket: [-0.9, 1.3] } as const,
  rest: { swing: 0, boom: 0.45, stick: -1.1, bucket: 0.2 },
};

export const VEHICLE_SPECS = {
  car: { name: 'la voiture', enterRadius: 5, exitOffset: 3.5 },
  excavator: { name: 'la pelleteuse', enterRadius: 7, exitOffset: 4.5 },
} as const;
