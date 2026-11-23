// PROPRIÉTAIRE : game-camera-driving. Citadine : petite, nerveuse, ~25 m/s (90 km/h).
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'citadine', name: 'la citadine', emoji: '🚗', mass: 800, accel: 12, half: [1, 0.45, 2], seats: 2, maxHp: 100,
  maxSpeed: 25, turnRate: 2.4, grip: 12, assist: 0.2,
});
