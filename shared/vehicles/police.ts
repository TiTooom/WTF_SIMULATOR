// PROPRIÉTAIRE : game-camera-driving. Voiture de police : la plus rapide, sirène (hn bascule, anim a[0] = 1).
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'police', name: 'la voiture de police', emoji: '🚓', mass: 1200, accel: 14, half: [1.05, 0.5, 2.3], seats: 4, maxHp: 150,
  maxSpeed: 31, turnRate: 2.3, grip: 13, assist: 0.2, siren: true, armor: { impact: 0.85, explosion: 1.1, bullet: 0.8 },
});
