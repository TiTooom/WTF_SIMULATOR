// PROPRIÉTAIRE : game-camera-driving. Voiture de police : la plus rapide (0-90 % en ~3,4 s), très accrocheuse, sirène (hn bascule, anim a[0] = 1).
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'police', name: 'la voiture de police', emoji: '🚓', mass: 1200, accel: 13, half: [1.05, 0.5, 2.3], seats: 4, maxHp: 150,
  maxSpeed: 30, turnRate: 2.5, grip: 13.5, driftGrip: 2.6, assist: 0.2, brake: 19, siren: true, armor: { impact: 0.85, explosion: 1.1, bullet: 0.8 },
});
