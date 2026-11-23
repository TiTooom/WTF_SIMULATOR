// PROPRIÉTAIRE : game-camera-driving. Citadine : petite, nerveuse (0-90 % en ~3 s), ~24,5 m/s (88 km/h), braque court, dérape volontiers.
import { makeArcadeCar } from './arcade';

export const def = makeArcadeCar({
  type: 'citadine', name: 'la citadine', emoji: '🚗', mass: 800, accel: 12, half: [1, 0.45, 2], seats: 2, maxHp: 100,
  maxSpeed: 24.5, turnRate: 2.75, grip: 12, driftGrip: 2.2, assist: 0.2, brake: 18,
});
