// PROPRIÉTAIRE : game-camera-driving. Camionnette : lourde, lente (0-90 % en ~4,6 s), robuste, braque large, freine long, aide renforcée.
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'camionnette', name: 'la camionnette', emoji: '🚐', mass: 1800, accel: 6.2, half: [1.1, 0.8, 2.6], seats: 3, maxHp: 180,
  maxSpeed: 19.5, turnRate: 1.9, grip: 10, driftGrip: 3, assist: 0.25, brake: 12, armor: { impact: 0.8, explosion: 1.1, bullet: 0.9 },
});
