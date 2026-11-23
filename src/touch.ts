// Commandes tactiles (téléphone / tablette) : joystick, regard au doigt, boutons.
// Aucune logique de jeu ici : on ne fait que simuler les touches / boutons que le clavier-souris produirait déjà.
import type { ActionId } from '../shared/settings';

export const isTouchDevice = (): boolean => {
  try {
    if (new URLSearchParams(location.search).has('touch')) return true;
    return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
};

export interface TouchOptions {
  /** Appuie / relâche l'action du jeu (équivalent d'une touche clavier). */
  press(action: ActionId, down: boolean): void;
  look(dx: number, dy: number): void;
  fire(button: 1 | 2, down: boolean): void;
  interact(): void;
  chat(): void;
  inventory(): void;
  pause(): void;
  selectSlot(i: number): void;
  wheel(n: number): void;
}

export interface TouchContext {
  playing: boolean;
  inVehicle: boolean;
  vehicleType: string;
  physgun: boolean;
  chat: boolean;
}

const css = `
body.touch { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; overscroll-behavior: none; }
body.touch #players, body.touch #itemInfo, body.touch #crosshair.veh { display: none; }
body.touch #vitals { top: 10px; bottom: auto; left: 10px; width: 120px; }
body.touch #hud { top: 62px; left: 10px; font-size: 11px; max-width: 44vw; }
body.touch #hotbar { bottom: auto; top: 6px; pointer-events: auto; z-index: 60; gap: 2px; }
body.touch .slot { width: 40px; height: 44px; border-width: 2px; border-radius: 8px; }
body.touch .slot .emoji { font-size: 18px; line-height: 20px; }
body.touch .slot .nm, body.touch .slot .num { display: none; }
body.touch .slot.sel { transform: translateY(3px); }
body.touch #chat { bottom: 190px; width: 46vw; z-index: 70; }
body.touch #chat.open { top: 6px; bottom: auto; width: 70vw; }
body.touch #pause #card, body.touch #card { max-height: 92vh; overflow: auto; }
#touch { position: fixed; inset: 0; z-index: 50; display: none; pointer-events: none; font-family: "Segoe UI", sans-serif; }
#touch.on { display: block; }
#touch .zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
#touch .zl { left: 0; width: 42%; }
#touch .zr { right: 0; width: 58%; }
#touch .stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; background: rgba(255,255,255,.18);
  border: 2px solid rgba(255,255,255,.5); display: none; pointer-events: none; }
#touch .stick i { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; background: rgba(255,255,255,.7); }
#touch .b { position: absolute; border-radius: 50%; background: rgba(27,27,43,.55); border: 3px solid rgba(255,255,255,.65); color: #fff; display: flex;
  align-items: center; justify-content: center; font-weight: 800; text-align: center; line-height: 1.05; pointer-events: auto; touch-action: none;
  text-shadow: 0 1px 2px #000; font-size: 22px; box-sizing: border-box; }
#touch .b small { display: block; font-size: 10px; font-weight: 700; }
#touch .b.sq { border-radius: 12px; }
#touch .b.down { background: rgba(255,224,102,.75); color: #1b1b2b; text-shadow: none; }
#touch .hide { display: none !important; }
#touch .pad { position: absolute; display: grid; gap: 6px; pointer-events: none; }
#touch .pad .b { position: static; width: 52px; height: 52px; font-size: 20px; }
#touchHint { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); z-index: 400; background: rgba(0,0,0,.7); color: #fff; padding: 16px 20px;
  border-radius: 12px; text-align: center; font-family: "Segoe UI", sans-serif; display: none; max-width: 80vw; }
`;

export function createTouch(o: TouchOptions) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.body.classList.add('touch');

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="zone zl"><div class="stick"><i></i></div></div>
    <div class="zone zr"></div>
    <div class="b" data-a="fire" style="right:18px;bottom:26px;width:88px;height:88px">TIR</div>
    <div class="b" data-a="jump" style="right:122px;bottom:18px;width:62px;height:62px">SAUT</div>
    <div class="b" data-a="alt" style="right:104px;bottom:96px;width:56px;height:56px">2<small>tir</small></div>
    <div class="b" data-a="interact" style="right:18px;bottom:128px;width:64px;height:64px">🚪<small>E</small></div>
    <div class="b hide" data-a="horn" style="right:178px;bottom:96px;width:50px;height:50px">📣</div>
    <div class="b hide" data-a="far" style="right:178px;bottom:100px;width:46px;height:46px">＋</div>
    <div class="b hide" data-a="near" style="right:232px;bottom:100px;width:46px;height:46px">－</div>
    <div class="b sq" data-a="pause" style="right:8px;top:8px;width:42px;height:42px;font-size:18px">☰</div>
    <div class="b sq" data-a="inventory" style="right:56px;top:8px;width:42px;height:42px;font-size:18px">🎒</div>
    <div class="b sq hide" data-a="chat" style="right:104px;top:8px;width:42px;height:42px;font-size:18px">💬</div>
    <div class="b sq hide" data-a="padToggle" style="right:8px;top:56px;width:42px;height:42px;font-size:18px">🏗</div>
    <div class="pad hide" id="padPilot" style="left:14px;bottom:150px;grid-template-columns:52px 52px">
      <div class="b sq" data-k="throttleUp">⬆<small>gaz</small></div><div class="b sq" data-k="yawLeft">↶</div>
      <div class="b sq" data-k="throttleDown">⬇<small>frein</small></div><div class="b sq" data-k="yawRight">↷</div>
    </div>
    <div class="pad hide" id="padExca" style="right:8px;top:104px;grid-template-columns:repeat(2,52px)">
      <div class="b sq" data-k="swingLeft">⟲<small>cabine</small></div><div class="b sq" data-k="swingRight">⟳<small>cabine</small></div>
      <div class="b sq" data-k="boomUp">⤒<small>flèche</small></div><div class="b sq" data-k="boomDown">⤓<small>flèche</small></div>
      <div class="b sq" data-k="stickOut">↗<small>bras</small></div><div class="b sq" data-k="stickIn">↙<small>bras</small></div>
      <div class="b sq" data-k="bucketCurl">⌒<small>godet</small></div><div class="b sq" data-k="bucketDump">⌣<small>godet</small></div>
    </div>`;
  document.body.appendChild(root);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const zl = q('.zl'), zr = q('.zr'), stick = q('.stick'), knob = q('.stick i');
  const padPilot = q('#padPilot'), padExca = q('#padExca');
  const btn = (a: string) => q(`[data-a="${a}"]`);

  // ----- Joystick (apparaît où le pouce se pose) -----
  let sId = -1, sx = 0, sy = 0;
  const held = { forward: false, back: false, left: false, right: false };
  const setDir = (k: keyof typeof held, v: boolean) => {
    if (held[k] !== v) { held[k] = v; o.press(k, v); }
  };
  const stickMove = (x: number, y: number) => {
    let dx = x - sx, dy = y - sy;
    const R = 50, d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const T = 16;
    setDir('forward', dy < -T); setDir('back', dy > T); setDir('left', dx < -T); setDir('right', dx > T);
  };
  const stickEnd = () => {
    sId = -1;
    stick.style.display = 'none';
    for (const k of Object.keys(held) as Array<keyof typeof held>) setDir(k, false);
  };
  zl.addEventListener('pointerdown', (e) => {
    if (sId >= 0) return;
    sId = e.pointerId; sx = e.clientX; sy = e.clientY;
    zl.setPointerCapture(e.pointerId);
    stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.style.display = 'block';
    knob.style.transform = '';
    e.preventDefault();
  });
  zl.addEventListener('pointermove', (e) => { if (e.pointerId === sId) stickMove(e.clientX, e.clientY); });
  for (const ev of ['pointerup', 'pointercancel'] as const) zl.addEventListener(ev, (e) => { if (e.pointerId === sId) stickEnd(); });

  // ----- Regard (glisser le doigt sur la moitié droite) -----
  let lId = -1, lx = 0, ly = 0;
  zr.addEventListener('pointerdown', (e) => {
    if (lId >= 0) return;
    lId = e.pointerId; lx = e.clientX; ly = e.clientY;
    zr.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  zr.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lId) return;
    o.look((e.clientX - lx) * 1.6, (e.clientY - ly) * 1.6);
    lx = e.clientX; ly = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) zr.addEventListener(ev, (e) => { if (e.pointerId === lId) lId = -1; });

  // ----- Boutons -----
  const hold = (el: HTMLElement, on: (down: boolean) => void) => {
    let id = -1;
    el.addEventListener('pointerdown', (e) => {
      if (id >= 0) return;
      id = e.pointerId; el.setPointerCapture(e.pointerId); el.classList.add('down'); on(true); e.preventDefault();
    });
    const up = (e: PointerEvent) => { if (e.pointerId === id) { id = -1; el.classList.remove('down'); on(false); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const tap = (el: HTMLElement, fn: () => void) => hold(el, (d) => { if (d) fn(); });

  hold(btn('fire'), (d) => o.fire(1, d));
  hold(btn('alt'), (d) => o.fire(2, d));
  hold(btn('jump'), (d) => o.press('jump', d));
  hold(btn('horn'), (d) => o.press('horn', d));
  tap(btn('interact'), o.interact);
  tap(btn('pause'), o.pause);
  tap(btn('inventory'), o.inventory);
  tap(btn('chat'), o.chat);
  tap(btn('far'), () => o.wheel(1));
  tap(btn('near'), () => o.wheel(-1));
  let padOpen = false;
  tap(btn('padToggle'), () => { padOpen = !padOpen; applyPads(); });
  root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => hold(el, (d) => o.press(el.dataset.k as ActionId, d)));

  // Barre d'objets (le HUD dessine les emplacements ; on lit data-slot)
  document.getElementById('hotbar')?.addEventListener('pointerdown', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (s) { o.selectSlot(Number(s.dataset.slot)); e.preventDefault(); }
  });

  let ctx: TouchContext = { playing: false, inVehicle: false, vehicleType: '', physgun: false, chat: false };
  const show = (el: HTMLElement, v: boolean) => el.classList.toggle('hide', !v);
  function applyPads() {
    const exca = ctx.inVehicle && ctx.vehicleType === 'excavator';
    show(padPilot, ctx.inVehicle);
    show(padExca, exca && padOpen);
    show(btn('padToggle'), exca);
  }

  return {
    /** Met à jour l'affichage selon l'état de la partie (appelé souvent, ne modifie le DOM qu'en cas de changement). */
    setContext(c: TouchContext) {
      if (JSON.stringify(c) === JSON.stringify(ctx)) return;
      const wasPlaying = ctx.playing;
      ctx = c;
      root.classList.toggle('on', c.playing);
      if (wasPlaying && !c.playing) stickEnd();
      show(btn('horn'), c.inVehicle);
      show(btn('far'), c.physgun && !c.inVehicle);
      show(btn('near'), c.physgun && !c.inVehicle);
      show(btn('chat'), c.chat);
      applyPads();
    },
    /** Relâche tout (pause, chat, inventaire ouverts). */
    releaseAll() {
      stickEnd();
      lId = -1;
      o.fire(1, false); o.fire(2, false);
      root.querySelectorAll('.down').forEach((e) => e.classList.remove('down'));
    },
  };
}

/** Plein écran + paysage (le plus confortable en jeu) ; ignoré si le navigateur refuse (iPhone). */
export function goImmersive() {
  try {
    const el = document.documentElement;
    const p = el.requestFullscreen?.();
    void Promise.resolve(p).then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => {});
  } catch { /* refusé : on joue sans */ }
}
