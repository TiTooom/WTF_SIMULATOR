// PROPRIÉTAIRE : game-camera-driving
// Conduite arcade façon Chinatown Wars : forte adhérence, frein à main (jump) qui fait déraper de façon lisible, aide directionnelle subtile
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
  /** Accélération à vitesse nulle (m/s²) ; elle décroît en 1 - (v/vmax)² : la vitesse de pointe est réellement atteinte. */
  accel: number;
  half: [number, number, number]; // demi-dimensions du châssis
  seats: number;
  maxHp: number;
  /** Vitesse de pointe avant (m/s). Défaut 25. */
  maxSpeed?: number;
  /** Vitesse de lacet maximale (rad/s) à basse vitesse. Défaut 2,3. */
  turnRate?: number;
  /** Adhérence latérale (1/s) : plus grand = plus collé. Défaut 12. */
  grip?: number;
  /** Adhérence latérale pendant le frein à main (1/s) : plus petit = glisse plus. Défaut 2,4. */
  driftGrip?: number;
  /** Aide directionnelle 0..0,3 (appliquée seulement sans braquage actif). Défaut 0,2. */
  assist?: number;
  /** Freinage (m/s²). Défaut 17. */
  brake?: number;
  /** Sirène : `hn` bascule la sirène (anim a[0] = 1) au lieu de klaxonner. */
  siren?: boolean;
  armor?: { impact: number; explosion: number; bullet: number };
}

const ROLL = 1.0; // 1/s : frottement de roulement sans gaz
const REVERSE = 0.33; // vitesse arrière max = REVERSE × maxSpeed
const HANDBRAKE_DECEL = 9; // m/s² retirés à la vitesse totale quand le frein à main est tiré SANS braquer (freinage)
const HANDBRAKE_DECEL_TURN = 3.2; // idem en braquant : on dérape en gardant sa vitesse
const HANDBRAKE_TURN = 1.3; // surcroît de lacet en dérapage
const GRIP_DROP = 16; // 1/s : vitesse à laquelle l'adhérence tombe quand on tire le frein à main
const GRIP_BACK = 7; // 1/s : vitesse à laquelle elle revient au relâchement (sortie de dérapage progressive)
const STEER_IN = 11, STEER_OUT = 14; // 1/s : vitesse du volant (clavier : plus de coups secs)
const DRIFT_SLIP = 0.25, DRIFT_SPAN = 0.65; // rad : le lacet de braquage s'éteint quand l'angle de dérapage approche ~0,85 rad (49°)
const GRIP_TRANSFER = 0.5; // part de la vitesse latérale absorbée par l'adhérence qui repart vers l'avant (on garde son élan)
const IMPACT_DV = 2.2; // m/s perdus en un pas = choc
const SLIDE_S = 0.45; // s de « rattrapage » après un choc : le cap se réaligne sur la direction de glissement
const ASSIST_CONE = 0.42; // rad (~24°) : l'aide ne corrige que les petits écarts à l'axe d'une rue
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function makeArcadeCar(spec: CarSpec): VehicleDef {
  const vmax = spec.maxSpeed ?? 25;
  const turnMax = spec.turnRate ?? 2.3;
  const grip = spec.grip ?? 12;
  const driftGrip = spec.driftGrip ?? 2.4;
  const brake = spec.brake ?? 17;
  const assist = clamp(spec.assist ?? 0.2, 0, 0.29);
  return {
    type: spec.type, name: spec.name, emoji: spec.emoji, enterRadius: 5, exitOffset: 3.5, seats: spec.seats, maxHp: spec.maxHp,
    armor: spec.armor ?? { impact: 1, explosion: 1.3, bullet: 1 }, impact: { threshold: 7, scale: 3.5 }, spawns: [],
    create(api, x, y, z, yaw) {
      const body = api.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setLinearDamping(0.02).setAngularDamping(2.5).enabledRotations(false, true, false)
          .setDominanceGroup(1), // masse « infinie » face aux piétons joueurs (groupe 0) : on ne pousse pas une voiture à pied
      );
      api.world.createCollider(api.sliding(RAPIER.ColliderDesc.cuboid(...spec.half).setMass(spec.mass)).setCollisionGroups(grp(G.VEHICLE)), body);
      let steer = 0; // volant lissé
      let gripNow = grip; // adhérence courante (rampe entre `grip` et `driftGrip`)
      let drifting = 0;
      let siren = 0;
      let sirenPrev = 0;
      let hornAt = 0;
      let lastX = 0, lastZ = 0, lastT = -1e9; // vitesse imposée au pas précédent (détection des chocs)
      let slide = 0; // s restantes de rattrapage après un choc
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

          // --- Choc : la vitesse a chuté sans que nous l'ayons voulu -> on glisse le long de l'obstacle au lieu de s'y planter ---
          if (api.time - lastT < 100 && Math.hypot(lastX, lastZ) > 4 && Math.hypot(v.x - lastX, v.z - lastZ) > IMPACT_DV) slide = SLIDE_S;
          slide = Math.max(0, slide - dt);

          // --- Longitudinal ---
          if (f > 0.01) {
            if (vf < -0.5) vf += brake * f * dt; // on freine d'abord si on roule en marche arrière
            else vf += spec.accel * f * Math.max(0, 1 - (Math.max(vf, 0) / vmax) ** 2) * dt;
          } else if (f < -0.01) {
            if (vf > 0.5) vf -= brake * -f * dt;
            else vf -= spec.accel * 0.8 * -f * Math.max(0, 1 - (Math.max(-vf, 0) / (vmax * REVERSE)) ** 2) * dt;
          } else {
            vf -= vf * ROLL * dt;
          }
          if (vf > vmax) vf -= (vf - vmax) * 1.5 * dt; // au-dessus de la pointe (chute, explosion) : on retombe

          // --- Adhérence latérale : forte, rampe vers le glissement au frein à main, anti-toupie au-delà de ~50° ---
          const gTarget = hand ? driftGrip : grip;
          gripNow += (gTarget - gripNow) * (1 - Math.exp(-(gTarget < gripNow ? GRIP_DROP : GRIP_BACK) * dt));
          const slip = Math.abs(vf) > 1 ? Math.atan2(Math.abs(vl), Math.abs(vf)) : 0;
          const g = gripNow * (1 + 2 * clamp((slip - 0.85) / 0.5, 0, 1));
          const dvl = vl * (1 - Math.exp(-g * dt));
          vl -= dvl;
          // l'adhérence qui reprend transforme une part du glissement en élan vers l'avant (sortie de dérapage sans perte sèche)
          if (!hand && slide <= 0 && Math.abs(vf) > 1) vf += Math.sign(vf) * Math.abs(dvl) * GRIP_TRANSFER * clamp((slip - 0.3) / 0.3, 0, 1);

          // --- Frein à main : ralentit la vitesse totale (franchement en ligne droite, peu en virage) ---
          let nx = fx * vf + rx * vl, nz = fz * vf + rz * vl;
          if (hand) {
            const sp = Math.hypot(nx, nz);
            if (sp > 0.01) {
              const k = Math.max(0, sp - (Math.abs(sIn) > 0.25 ? HANDBRAKE_DECEL_TURN : HANDBRAKE_DECEL) * dt) / sp;
              nx *= k; nz *= k;
            }
          }
          body.setLinvel({ x: nx, y: v.y, z: nz }, true);
          lastX = nx; lastZ = nz; lastT = api.time;

          // --- Lacet : proportionnel à la vitesse, moindre à haute vitesse, inversé en marche arrière ---
          const sp = Math.hypot(nx, nz);
          const sRate = (Math.abs(sIn) > Math.abs(steer) ? STEER_IN : STEER_OUT) * dt;
          steer += clamp(sIn - steer, -sRate, sRate);
          const dirSign = clamp(vf / 4, -1, 1); // 0 à l'arrêt : pas de pivot sur place
          const speedFactor = 1 - 0.5 * clamp(sp / vmax, 0, 1);
          let rate = -steer * turnMax * speedFactor * dirSign * (hand && Math.abs(vf) > 3 ? HANDBRAKE_TURN : 1);
          const hv = sp > 1 ? Math.atan2(-nx, -nz) : h; // cap de la vitesse (même convention que le lacet)
          // Dérapage lisible : le braquage ne fait plus tourner la voiture au-delà de ~50° d'angle de glissement (pas de toupie)
          if (vf > 1 && rate !== 0) {
            const grow = Math.sign(rate) * wrap(h - hv);
            if (grow > DRIFT_SLIP) rate *= 1 - 0.92 * clamp((grow - DRIFT_SLIP) / DRIFT_SPAN, 0, 1);
          }
          // Aide : sans braquage, recale doucement le cap sur l'axe de rue le plus proche (rues alignées sur x et z)
          if (Math.abs(sIn) < 0.05 && !hand && Math.abs(vf) > 4 && slide <= 0) {
            const quarter = Math.PI / 2;
            const err = wrap(Math.round(h / quarter) * quarter - h);
            if (Math.abs(err) < ASSIST_CONE) rate += clamp(err * assist * 10, -0.7, 0.7) * Math.min(1, Math.abs(vf) / 10) * Math.sign(vf);
          }
          // Rattrapage : sortie de dérapage (sans braquage ni frein à main) et après un choc, le cap revient sur la direction du mouvement
          if (sp > 2 && (slide > 0 || (!hand && Math.abs(sIn) < 0.3 && slip > 0.12))) {
            const heading = vf >= 0 ? hv : wrap(hv + Math.PI);
            const w = slide > 0 ? clamp(slide / 0.2, 0, 1) : 0.6;
            rate += clamp(wrap(heading - h) * 5, -3.2, 3.2) * w * clamp(sp / 5, 0, 1);
          }
          body.setAngvel({ x: 0, y: rate, z: 0 }, true);
          drifting = Math.abs(vl) > 2.5 ? 1 : 0;

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
