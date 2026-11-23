// Interface en jeu : viseur, barres de vie (joueur, véhicule), flash de dégâts.

export interface HudState {
  hp: number; // 0..100
  vehHp: number | null; // 0..1 du véhicule conduit
  vehName: string;
  inVehicle: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

export function createHud() {
  const crosshair = $('crosshair');
  const hpFill = $('hpFill');
  const hpText = $('hpText');
  const vehBox = $('vehBox');
  const vehFill = $('vehFill');
  const vehLabel = $('vehLabel');
  const damage = $('damage');
  let flashT = 0;

  return {
    setVisible(v: boolean) {
      for (const e of [crosshair, $('vitals')]) e.style.display = v ? '' : 'none';
    },
    update(s: HudState) {
      crosshair.classList.toggle('veh', s.inVehicle);
      const hp = Math.max(0, Math.min(100, s.hp));
      hpFill.style.width = hp + '%';
      hpFill.style.background = hp > 55 ? '#4cd964' : hp > 25 ? '#ffcc00' : '#ff3b30';
      hpText.textContent = String(Math.ceil(hp));
      vehBox.style.display = s.vehHp === null ? 'none' : '';
      if (s.vehHp !== null) {
        const v = Math.max(0, Math.min(1, s.vehHp));
        vehFill.style.width = v * 100 + '%';
        vehFill.style.background = v > 0.5 ? '#4cd964' : v > 0.25 ? '#ffcc00' : '#ff3b30';
        vehLabel.textContent = s.vehName;
      }
    },
    /** Flash rouge de dégâts (1 = mort). */
    flash(strength: number) {
      flashT = Math.max(flashT, strength);
      damage.style.opacity = String(Math.min(0.75, flashT * 0.6));
    },
    tick(dt: number) {
      if (flashT > 0) {
        flashT = Math.max(0, flashT - dt * 1.4);
        damage.style.opacity = String(Math.min(0.75, flashT * 0.6));
      }
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
