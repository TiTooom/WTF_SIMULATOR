// PROPRIÉTAIRE : game-camera-driving
// Conduite arcade façon Chinatown Wars : forte adhérence, frein à main (jump) qui fait déraper, aide directionnelle subtile
// pour négocier les angles droits de la grille de rues. Un seul modèle physique paramétré par CarSpec ; les 4 voitures
// (citadine, berline, camionnette, police) sont dans leurs fichiers.
// Le corps est piloté au niveau des vitesses (linvel/angvel) : aucune référence conservée entre deux ticks (piège Rapier).
import RAPIER from '@dimforge/rapier3d-compat';
import { G, grp, type VehicleDef } from '../api';
import type { VehicleType } from '../ids';

export interface CarSpec {
  type: VehicleType;
  name: string; // « la citadine » (avec article)
  emoji: string;
  mass: number;
  accel: number; // m/s² à vitesse nulle
  half: [number, number, number]; // demi-dimensions du châssis
  seats: number;
  maxHp: number;
  /** Vitesse de pointe avant (m/s). Défaut 25. */
  maxSpeed?: number;
  /** Vitesse de lacet maximale (rad/s) à basse vitesse. Défaut 2,3. */
  turnRate?: number;
  /** Adhérence latérale (1/s) : plus grand = plus collé. Défaut 12. */
  grip?: number;
  /** Aide directionnelle 0..0,3 (appliquée seulement sans braquage actif). Défaut 0,2. */
  assist?: number;
  /** Sirène : `hn` bascule la sirène (anim a[0] = 1) au lieu de klaxonner. */
  siren?: boolean;
  armor?: { impact: number; explosion: number; bullet: number };
}

const BRAKE = 20; // m/s² de freinage (f opposé au mouvement)
const ROLL = 1.0; // 1/s : frottement de roulement sans gaz
const REVERSE = 0.35; // vitesse arrière max = REVERSE × maxSpeed
const HANDBRAKE_DECEL = 9; // m/s² retirés à la vitesse totale tant que le frein à main est tiré
const HANDBRAKE_GRIP = 1.4; // adhérence réduite (1/s) : la voiture glisse
const HANDBRAKE_TURN = 1.35; // surcroît de lacet en dérapage
const ASSIST_CONE = 0.42; // rad (~24°) : l'aide ne corrige que les petits écarts à l'axe d'une rue
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function makeArcadeCar(spec: CarSpec): VehicleDef {
  const vmax = spec.maxSpeed ?? 25;
  const turnMax = spec.turnRate ?? 2.3;
  const grip = spec.grip ?? 12;
  const assist = clamp(spec.assist ?? 0.2, 0, 0.29);
  return {
    type: spec.type, name: spec.name, emoji: spec.emoji, enterRadius: 5, exitOffset: 3.5, seats: spec.seats, maxHp: spec.maxHp,
    armor: spec.armor ?? { impact: 1, explosion: 1.3, bullet: 1 }, impact: { threshold: 7, scale: 3.5 }, spawns: [],
    create(api, x, y, z, yaw) {
      const body = api.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setLinearDamping(0.02).setAngularDamping(2.5).enabledRotations(false, true, false),
      );
      api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(...spec.half).setMass(spec.mass)).setCollisionGroups(grp(G.VEHICLE)), body);
      let steer = 0;
      let drifting = 0;
      let siren = 0;
      let sirenPrev = 0;
      let hornAt = 0;
      return {
        body,
        step({ input, api, dt }) {
          const q = body.rotation();
          const h = 2 * Math.atan2(q.y, q.w); // lacet (rotations limitées à l'axe Y)
          const fx = -Math.sin(h), fz = -Math.cos(h); // avant
          const rx = Math.cos(h), rz = -Math.sin(h); // droite
          const v = body.linvel();
          let vf = v.x * fx + v.z * fz;
          let vl = v.x * rx + v.z * rz;
          const f = clamp(Number.isFinite(input.f) ? input.f : 0, -1, 1);
          const sIn = clamp(Number.isFinite(input.s) ? input.s : 0, -1, 1);
          const hand = input.jump ? 1 : 0;

          // --- Longitudinal ---
          if (f > 0.01) {
            if (vf < -0.5) vf += BRAKE * f * dt; // on freine d'abord si on roule en marche arrière
            else vf += spec.accel * f * Math.max(0, 1 - Math.max(vf, 0) / vmax) * dt;
          } else if (f < -0.01) {
            if (vf > 0.5) vf -= BRAKE * -f * dt;
            else vf -= spec.accel * 0.8 * -f * Math.max(0, 1 - Math.max(-vf, 0) / (vmax * REVERSE)) * dt;
          } else {
            vf -= vf * ROLL * dt;
          }

          // --- Adhérence latérale (forte), relâchée au frein à main ---
          const g = hand ? HANDBRAKE_GRIP : grip;
          vl -= vl * (1 - Math.exp(-g * dt));
          // Pas de réduction « arcade » quand on glisse : la vitesse du glissement s'use doucement (freinage latéral naturel)

          // --- Frein à main : ralentit la vitesse totale ---
          let nx = fx * vf + rx * vl, nz = fz * vf + rz * vl;
          if (hand) {
            const sp = Math.hypot(nx, nz);
            if (sp > 0.01) {
              const k = Math.max(0, sp - HANDBRAKE_DECEL * dt) / sp;
              nx *= k; nz *= k;
            }
          }
          body.setLinvel({ x: nx, y: v.y, z: nz }, true);

          // --- Lacet : proportionnel à la vitesse, moindre à haute vitesse, inversé en marche arrière ---
          const sp = Math.hypot(nx, nz);
          const dirSign = clamp(vf / 4, -1, 1); // 0 à l'arrêt : pas de pivot sur place
          const speedFactor = 1 - 0.5 * clamp(sp / vmax, 0, 1);
          let rate = -sIn * turnMax * speedFactor * dirSign * (hand && Math.abs(vf) > 3 ? HANDBRAKE_TURN : 1);
          // Aide : sans braquage, recale doucement le cap sur l'axe de rue le plus proche (rues alignées sur x et z)
          if (Math.abs(sIn) < 0.05 && !hand && Math.abs(vf) > 4) {
            const quarter = Math.PI / 2;
            let err = Math.round(h / quarter) * quarter - h;
            err = Math.atan2(Math.sin(err), Math.cos(err));
            if (Math.abs(err) < ASSIST_CONE) rate += clamp(err * assist * 10, -0.7, 0.7) * Math.min(1, Math.abs(vf) / 10) * Math.sign(vf);
          }
          body.setAngvel({ x: 0, y: rate, z: 0 }, true);
          steer = sIn;
          drifting = Math.abs(vl) > 3 ? 1 : 0;

          // --- Klaxon / sirène ---
          const t = body.translation();
          if (spec.siren) {
            if (input.hn && !sirenPrev) {
              siren = siren ? 0 : 1;
              api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: siren ? 'siren' : 'siren_off' });
            }
            sirenPrev = input.hn ? 1 : 0;
          } else if (input.hn && api.time > hornAt) {
            hornAt = api.time + 600;
            api.fx({ k: 'sound', p: [t.x, t.y, t.z], s: 'horn_car' });
          }
        },
        // a[0] : sirène allumée (police) ; a[1] : dérapage en cours (fumée de pneus côté client)
        anim: () => ({ sp: api.forwardSpeed(body), st: steer, a: [siren, drifting] }),
        dispose() { /* jamais appelé pour un véhicule du pool */ },
      };
    },
  };
}
