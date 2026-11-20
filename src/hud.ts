// Interface en jeu : viseur, barres de vie, barre d'objets (9 emplacements), nom/description de l'objet choisi, flash de dégâts.
import { ITEM_BY_ID } from '../shared/registry';

export interface HudState {
  hp: number; // 0..100
  vehHp: number | null; // 0..1 du véhicule conduit
  vehName: string;
  hotbar: string[]; // 9 identifiants ('' = vide)
  selected: number; // 0..8
  keyLabels: string[]; // 9 libellés de touches
  inVehicle: boolean;
}

const $ = (id: string) => document.getElementById(id)!;
const short = (n: string) => (n.length > 11 ? n.slice(0, 10) + '…' : n);

export function createHud() {
  const crosshair = $('crosshair');
  const hpFill = $('hpFill');
  const hpText = $('hpText');
  const vehBox = $('vehBox');
  const vehFill = $('vehFill');
  const vehLabel = $('vehLabel');
  const bar = $('hotbar');
  const info = $('itemInfo');
  const damage = $('damage');
  let sig = '';
  let slots: HTMLElement[] = [];
  let lastSel = -1;
  let flashT = 0;

  const el = (cls: string, text?: string) => {
    const e = document.createElement('div');
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function build(hotbar: string[], labels: string[]) {
    bar.textContent = '';
    slots = hotbar.map((id, i) => {
      const it = ITEM_BY_ID.get(id);
      const s = el('slot');
      s.dataset.slot = String(i);
      s.append(el('num', labels[i] ?? String(i + 1)), el('emoji', it?.emoji ?? ''), el('nm', it ? short(it.name) : ''));
      bar.appendChild(s);
      return s;
    });
  }

  return {
    setVisible(v: boolean) {
      for (const e of [crosshair, $('vitals'), bar, info]) e.style.display = v ? '' : 'none';
    },
    update(s: HudState) {
      const key = s.hotbar.map((id) => id + (ITEM_BY_ID.has(id) ? '+' : '-')).join('|') + '#' + s.keyLabels.join('|');
      if (key !== sig) { sig = key; build(s.hotbar, s.keyLabels); lastSel = -1; }
      if (s.selected !== lastSel) {
        lastSel = s.selected;
        slots.forEach((e, i) => e.classList.toggle('sel', i === s.selected));
        const it = ITEM_BY_ID.get(s.hotbar[s.selected]);
        info.textContent = '';
        if (it) info.append(el('t', `${it.emoji} ${it.name}`), el('d', it.desc));
      }
      bar.classList.toggle('dim', s.inVehicle);
      info.style.visibility = s.inVehicle ? 'hidden' : 'visible';
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
