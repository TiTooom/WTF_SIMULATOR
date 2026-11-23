// PROPRIÉTAIRE : game-camera-driving. Berline : plus rapide et plus lourde, quatre places.
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'berline', name: 'la berline', emoji: '🚙', mass: 1100, accel: 11, half: [1.05, 0.5, 2.3], seats: 4, maxHp: 130,
  maxSpeed: 28, turnRate: 2.15, grip: 12, assist: 0.2,
});
