// PROPRIÉTAIRE : game-camera-driving. Berline : plus rapide mais plus lourde (0-90 % en ~4 s), stable, quatre places, glisse moins.
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'berline', name: 'la berline', emoji: '🚙', mass: 1100, accel: 10, half: [1.05, 0.5, 2.3], seats: 4, maxHp: 130,
  maxSpeed: 27, turnRate: 2.5, grip: 12.5, driftGrip: 2.6, assist: 0.2, brake: 16,
});
