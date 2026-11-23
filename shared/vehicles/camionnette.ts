// PROPRIÉTAIRE : game-camera-driving. Camionnette : lourde, lente, robuste, grande adhérence mais braque peu.
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'camionnette', name: 'la camionnette', emoji: '🚐', mass: 1800, accel: 8, half: [1.1, 0.8, 2.6], seats: 3, maxHp: 180,
  maxSpeed: 20, turnRate: 1.75, grip: 10, assist: 0.25, armor: { impact: 0.8, explosion: 1.1, bullet: 0.9 },
});
