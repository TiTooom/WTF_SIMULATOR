// Guidage en jeu (PROPRIÉTAIRE : art-toon) : tutoriel d'onboarding + conseils contextuels. 100 % client : aucune logique de jeu, aucun envoi réseau.
// Tout texte passe par `textContent`. Style BD (cartouche crème, contour noir, ombre dure) cohérent avec le HUD.
//
// API pour main.ts :
//   const guide = new Guide({ keyLabel: (a) => L(a) });          // une fois ; `keyLabel(action)` = nom de la touche RÉGLÉE (jamais codé en dur)
//   guide.update(ctx, dt);                                        // chaque image (voir GuideCtx) ; renvoie rien
//   guide.notify('sms' | 'mort' | 'arrete' | 'buy' | 'sell' | 'mission' | 'minigame' | 'mission_fin');   // événements serveur déjà reçus par main.ts
//   hud.topOffset(guide.topHeight);                               // les toasts du HUD se décalent sous le panneau de tutoriel
//   guide.reset();                                                // « Rejouer le tutoriel » : efface la mémoire (conseils déjà vus + tutoriel)
//   guide.setEnabled(false);                                      // désactive les CONSEILS (le tutoriel reste jusqu'à sa fin ou « Passer »)
//   guide.skipTutorial();                                         // « Passer le tutoriel » (aussi : touche F2, ou clic sur le lien quand la souris est libre)
// Mémoire : localStorage `gta-guide-v1` (try/catch : navigation privée ou stockage plein = pas de mémoire, jamais d'erreur).
import type { ActionId } from '../../shared/settings';

/** Contexte de l'image courante, rempli par main.ts (tous les champs sauf x, z, onFoot, stars, money, bagCount sont facultatifs). */
export interface GuideCtx {
  x: number; z: number;
  /** À pied (false : dans un véhicule). */
  onFoot: boolean;
  /** Cap de la caméra (rad, même convention que le yaw du joueur : avant = (−sin, −cos)) : oriente la flèche vers l'objectif. Absent : pas de flèche. */
  camYaw?: number;
  /** Véhicule libre à portée de la touche d'interaction. */
  vehicleNear?: boolean;
  /** Dealer à portée (`me.shop` défini). */
  dealerNear?: boolean;
  /** Cachette à portée de la touche d'interaction. */
  hideSpotNear?: boolean;
  /** Le joueur est caché (PlayerSnap.an === 5). */
  hidden?: boolean;
  /** Une caméra de surveillance est proche (≤ ~25 m). */
  cameraNear?: boolean;
  /** Un donneur de mission est proche et aucune mission n'est en cours. */
  giverNear?: boolean;
  stars: number;
  /** État de recherche (HudState.search). */
  search?: 'libre' | 'repere' | 'recherche' | 'cache';
  /** Mission ou activité (taxi...) en cours. */
  mission?: boolean;
  /** Mini-jeu ouvert. */
  minigame?: boolean;
  pdaOpen?: boolean;
  money: number;
  /** Nombre total d'articles dans le sac. */
  bagCount: number;
  unread?: number;
  /** Repères (me.marks) : sert à la flèche et à la distance de l'objectif (dealer, donneur de mission). */
  marks?: readonly { k: string; x: number; z: number }[];
  /** Pause, BD plein écran, mini-jeu plein écran : rien n'est affiché (et le temps ne compte pas). */
  blocked?: boolean;
}
export type GuideEvent = 'sms' | 'mort' | 'arrete' | 'buy' | 'sell' | 'mission' | 'mission_fin' | 'minigame';
export interface GuideOptions {
  /** Nom de la touche réglée pour une action (ex : « Z »). */
  keyLabel: (action: ActionId) => string;
  /** Stockage (défaut : localStorage s'il existe). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Touche (event.code) « Passer le tutoriel ». Défaut : F2. */
  skipCode?: string;
}

const KEY = 'gta-guide-v1';
const TIP_MS = 6000;
const TIP_GAP_MS = 1500;
const DONE_MS = 1100;

const CSS = `
.gd{position:fixed;z-index:7;pointer-events:none;font-family:"Segoe UI",Verdana,sans-serif;font-weight:800;color:#1b1b2b}
.gd-tuto{left:50%;top:14px;transform:translateX(-50%);display:none;align-items:center;gap:12px;max-width:min(560px,80vw);padding:8px 16px 8px 12px;border:4px solid #000;border-radius:12px;background:#fff6dc;box-shadow:5px 5px 0 #000}
.gd-tuto.on{display:flex}
.gd-arrow{display:none;flex-direction:column;align-items:center;min-width:46px;font-size:12px;color:#c92a35}
.gd-arrow.on{display:flex}
.gd-arrow i{font-style:normal;font-size:34px;line-height:1;color:#e63946;-webkit-text-stroke:2px #000;paint-order:stroke fill;transition:transform .1s}
.gd-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.gd-tag{font-size:11px;letter-spacing:.1em;color:#c92a35}
.gd-text{font-size:18px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gd-skip{font-size:12px;color:#4a4d6a;pointer-events:auto;cursor:pointer;text-decoration:underline;background:none;border:0;padding:0;font-family:inherit;font-weight:800;text-align:left}
.gd-ok{display:none;width:34px;height:34px;border:4px solid #000;border-radius:50%;background:#3ddc84;color:#fff;font-size:22px;line-height:26px;text-align:center;-webkit-text-stroke:1px #000;animation:gdpop .25s ease-out;flex:none}
.gd-tuto.done .gd-ok{display:block}
@keyframes gdpop{from{transform:scale(.3)}to{transform:scale(1)}}
.gd-tip{left:50%;bottom:78px;transform:translateX(-50%) translateY(10px);max-width:min(460px,60vw);padding:6px 16px;border:4px solid #000;border-radius:14px;background:#fff;box-shadow:4px 4px 0 #000;font-size:16px;line-height:1.25;text-align:center;opacity:0;transition:opacity .3s,transform .3s;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gd-tip.on{opacity:1;transform:translateX(-50%) translateY(0)}
`;

/** Étapes du tutoriel (texte construit à l'affichage : les touches viennent des réglages). */
interface Step { id: string; text(k: (a: ActionId) => string): string; target?: string[]; tip?: string }
const STEPS: readonly Step[] = [
  { id: 'move', text: (k) => `Bouge avec ${k('forward')} ${k('left')} ${k('back')} ${k('right')}` },
  { id: 'car', text: (k) => `Approche-toi d'une voiture et appuie sur ${k('interact')}`, tip: 'car' },
  { id: 'dealer', text: () => 'Roule jusqu\'au dealer (flèche €)', target: ['dealer'], tip: 'dealer' },
  { id: 'buy', text: () => 'Achète une marchandise', target: ['dealer'] },
  { id: 'pda', text: (k) => `Ouvre le PDA (${k('pda')}) pour comparer les prix` },
  { id: 'sell', text: () => 'Revends-la dans un autre quartier' },
  { id: 'mission', text: () => 'Prends ta première mission', target: ['donneur', 'mission'] },
];

type Tip = { id: string; text: string; urgent?: boolean };

export class Guide {
  private readonly k: (a: ActionId) => string;
  private readonly store: GuideOptions['storage'];
  private readonly skipCode: string;
  private mem: { seen: string[]; tuto?: 'done' | 'skipped'; off?: boolean } = { seen: [] };
  private readonly tutoEl = document.createElement('div');
  private readonly arrowEl = document.createElement('div');
  private readonly arrowI = document.createElement('i');
  private readonly arrowD = document.createElement('span');
  private readonly tagEl = document.createElement('div');
  private readonly textEl = document.createElement('div');
  private readonly skipEl = document.createElement('button');
  private readonly okEl = document.createElement('div');
  private readonly tipEl = document.createElement('div');
  private style: HTMLStyleElement | null = null;
  private step = 0;
  private doneT = 0; // > 0 : « ✓ » affiché, on passera à l'étape suivante à 0
  private moved = 0;
  private last: { x: number; z: number } | null = null;
  private stepBag = 0;
  private bought = false;
  private ev = new Set<GuideEvent>();
  private queue: Tip[] = [];
  private tipT = 0;
  private gapT = 0;
  private prevStars = 0;
  private lastText = '';
  private lastTag = '';
  private enabledNow = true;
  private tutoOn = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === this.skipCode && this.tutoOn && (e.target as HTMLElement | null)?.tagName !== 'INPUT') { e.preventDefault(); this.skipTutorial(); }
  };

  constructor(opts: GuideOptions) {
    this.k = opts.keyLabel;
    this.skipCode = opts.skipCode ?? 'F2';
    this.store = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;
    this.load();
    if (!document.getElementById('gd-css')) {
      const st = this.style = document.createElement('style');
      st.id = 'gd-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.tutoEl.className = 'gd gd-tuto';
    this.arrowEl.className = 'gd-arrow';
    this.arrowI.textContent = '▲';
    this.arrowEl.append(this.arrowI, this.arrowD);
    const body = document.createElement('div'); body.className = 'gd-body';
    this.tagEl.className = 'gd-tag';
    this.textEl.className = 'gd-text';
    this.skipEl.className = 'gd-skip';
    this.skipEl.type = 'button';
    this.skipEl.textContent = `Passer le tutoriel (${this.skipCode})`;
    this.skipEl.addEventListener('click', () => this.skipTutorial());
    this.okEl.className = 'gd-ok';
    this.okEl.textContent = '✓';
    body.append(this.tagEl, this.textEl, this.skipEl);
    this.tutoEl.append(this.arrowEl, body, this.okEl);
    this.tipEl.className = 'gd gd-tip';
    document.body.append(this.tutoEl, this.tipEl);
    addEventListener('keydown', this.onKey, true);
  }

  // ---------- Mémoire ----------
  private load() {
    try {
      const raw = this.store?.getItem(KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { seen?: unknown; tuto?: unknown; off?: unknown };
      this.mem = {
        seen: Array.isArray(j.seen) ? j.seen.filter((s): s is string => typeof s === 'string').slice(0, 64) : [],
        tuto: j.tuto === 'done' || j.tuto === 'skipped' ? j.tuto : undefined,
        off: j.off === true,
      };
    } catch { /* stockage illisible : on repart de zéro */ }
  }
  private save() {
    try { this.store?.setItem(KEY, JSON.stringify(this.mem)); } catch { /* stockage indisponible */ }
  }

  // ---------- API ----------
  /** Hauteur occupée en haut au centre (px) : à passer à `hud.topOffset`. */
  get topHeight(): number { return this.tutoOn ? 92 : 0; }
  tutorialActive(): boolean { return this.tutoOn; }
  /** Numéro de l'étape en cours (0..STEPS.length) ; STEPS.length = terminé. */
  get currentStep(): number { return this.step; }
  get stepCount(): number { return STEPS.length; }
  isEnabled(): boolean { return !this.mem.off; }
  setEnabled(on: boolean): void {
    this.mem.off = !on;
    this.save();
    if (!on) { this.queue.length = 0; this.tipT = 0; this.tipEl.classList.remove('on'); }
  }
  /** Efface la mémoire : le tutoriel repart de zéro et les conseils déjà vus reviennent. */
  reset(): void {
    this.mem = { seen: [], off: this.mem.off };
    this.save();
    this.step = 0; this.doneT = 0; this.moved = 0; this.bought = false; this.queue.length = 0; this.tipT = 0; this.last = null; this.ev.clear();
    this.tipEl.classList.remove('on');
  }
  skipTutorial(): void {
    if (!this.tutoOn && this.mem.tuto) return;
    this.mem.tuto = 'skipped';
    this.save();
    this.tutoOn = false;
    this.tutoEl.classList.remove('on', 'done');
  }
  notify(e: GuideEvent): void {
    this.ev.add(e);
    if (e === 'sms') this.tip('sms', `Un tuyau ! Ouvre le PDA (${this.k('pda')}) pour le lire.`);
    else if (e === 'mort') this.tip('mort', "Tu as perdu ton sac. Tu repars de l'hôpital : à toi de jouer !", true);
    else if (e === 'arrete') this.tip('arrete', "Arrêté ! Les flics t'ont pris ton sac. La prochaine fois, cache-toi ou fonce.", true);
    else if (e === 'minigame') this.tip('minigame', "Mini-jeu : suis les consignes à l'écran, plus c'est réussi, mieux tu es payé.");
    else if (e === 'mission_fin') this.tip('fin', 'Mission terminée ! Ton argent est dans le HUD, les contacts en ont peut-être d\'autres.');
  }
  /** Affiche un conseil une seule fois (mémorisé) ; `urgent` passe devant le tutoriel. */
  tip(id: string, text: string, urgent = false): void {
    if (this.mem.off || this.mem.seen.includes(id) || this.queue.some((t) => t.id === id)) return;
    this.queue.push({ id, text, urgent });
  }
  private markSeen(id: string) {
    if (!this.mem.seen.includes(id)) { this.mem.seen.push(id); this.save(); }
  }
  setVisible(v: boolean): void {
    this.tutoEl.style.visibility = this.tipEl.style.visibility = v ? '' : 'hidden';
  }
  dispose(): void {
    removeEventListener('keydown', this.onKey, true);
    this.tutoEl.remove(); this.tipEl.remove(); this.style?.remove();
  }

  // ---------- Image par image ----------
  update(c: GuideCtx, dt: number): void {
    this.setVisible(!c.blocked);
    if (c.blocked) { this.last = null; return; }
    // distance parcourue (les téléportations ne comptent pas)
    if (this.last) { const d = Math.hypot(c.x - this.last.x, c.z - this.last.z); if (d < 5) this.moved += d; }
    this.last = { x: c.x, z: c.z };

    if (!this.mem.tuto && !this.tutoOn && this.step < STEPS.length) this.startTutorial(c);
    if (this.tutoOn) this.updateTutorial(c, dt);
    this.updateTips(c, dt);
    this.prevStars = c.stars;
    this.ev.clear();
  }

  private startTutorial(c: GuideCtx) {
    this.tutoOn = true;
    this.moved = 0;
    this.stepBag = c.bagCount;
    this.tutoEl.classList.add('on');
  }

  private nearest(c: GuideCtx, kinds: string[]): { d: number; x: number; z: number } | null {
    let best: { d: number; x: number; z: number } | null = null;
    for (const m of c.marks ?? []) {
      if (!kinds.includes(m.k)) continue;
      const d = Math.hypot(m.x - c.x, m.z - c.z);
      if (!best || d < best.d) best = { d, x: m.x, z: m.z };
    }
    return best;
  }

  private stepDone(c: GuideCtx, id: string): boolean {
    switch (id) {
      case 'move': return this.moved >= 6;
      case 'car': return !c.onFoot;
      case 'dealer': return !!c.dealerNear;
      case 'buy': return this.ev.has('buy') || c.bagCount > this.stepBag;
      case 'pda': return !!c.pdaOpen;
      case 'sell': return this.ev.has('sell') || (this.bought && c.bagCount < this.stepBag);
      case 'mission': return !!c.mission || this.ev.has('mission');
    }
    return false;
  }

  private updateTutorial(c: GuideCtx, dt: number) {
    if (this.step >= STEPS.length) { this.finishTutorial(); return; }
    const st = STEPS[this.step];
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) {
        this.tutoEl.classList.remove('done');
        this.step++;
        this.stepBag = c.bagCount;
        if (this.step >= STEPS.length) { this.finishTutorial(); return; }
      }
    } else {
      if (st.id === 'sell' && c.bagCount > this.stepBag) this.stepBag = c.bagCount; // on revend ce qu'on a (le sac a pu grossir)
      if (st.id === 'pda') this.bought = this.bought || c.bagCount > 0;
      if (this.stepDone(c, st.id)) {
        this.doneT = DONE_MS / 1000;
        this.tutoEl.classList.add('done');
        if (st.tip) this.markSeen(st.tip);
        if (st.id === 'buy') { this.bought = true; this.markSeen('dealer'); }
        if (st.id === 'pda') this.stepBag = c.bagCount;
      }
    }
    const cur = STEPS[Math.min(this.step, STEPS.length - 1)];
    const tag = `OBJECTIF ${Math.min(this.step + 1, STEPS.length)} SUR ${STEPS.length}`;
    const text = cur.text(this.k);
    if (tag !== this.lastTag) { this.tagEl.textContent = tag; this.lastTag = tag; }
    if (text !== this.lastText) { this.textEl.textContent = text; this.lastText = text; }
    // flèche vers l'objectif (dealer, donneur) : distance toujours, rotation si le cap de la caméra est connu
    const tg = cur.target ? this.nearest(c, cur.target) : null;
    this.arrowEl.classList.toggle('on', !!tg && this.doneT <= 0 && tg.d > 6);
    if (tg) {
      this.arrowD.textContent = `${Math.round(tg.d)} m`;
      if (c.camYaw !== undefined) {
        const rel = Math.atan2(-(tg.x - c.x), -(tg.z - c.z)) - c.camYaw;
        this.arrowI.style.transform = `rotate(${-rel}rad)`;
        this.arrowI.style.display = '';
      } else this.arrowI.style.display = 'none';
    }
  }

  private finishTutorial() {
    this.mem.tuto = 'done';
    this.save();
    this.tutoOn = false;
    this.tutoEl.classList.remove('on', 'done');
    this.tip('fintuto', `Tutoriel terminé ! Pour revoir les touches : F1. Bonne route dans les rues d'Amiens.`, true);
  }

  private updateTips(c: GuideCtx, dt: number) {
    if (this.mem.off) return;
    // cadence : un seul conseil à la fois (6 s), 1,5 s de répit entre deux
    if (this.tipT > 0) {
      this.tipT -= dt * 1000;
      if (this.tipT <= 0) { this.tipEl.classList.remove('on'); this.gapT = TIP_GAP_MS; }
      return;
    }
    if (this.gapT > 0) this.gapT -= dt * 1000;
    // détection des situations
    const tuto = this.tutoOn;
    if (!tuto) {
      if (c.onFoot && c.vehicleNear) this.tip('car', `${this.k('interact')} pour monter dans la voiture.`);
      if (c.dealerNear) this.tip('dealer', `${this.k('interact')} pour parler au dealer : achète bas, revends haut, comme au marché de Saint-Leu.`);
      if (c.giverNear && !c.mission) this.tip('donneur', 'Un contact a du boulot pour toi : approche-toi, tu seras payé.');
      if (c.minigame) this.tip('minigame', "Mini-jeu : suis les consignes à l'écran, plus c'est réussi, mieux tu es payé.");
      if (c.money < 40 && c.bagCount === 0 && !c.mission) this.tip('fauche', 'Fauché ? Prends une mission ou revends des marchandises.');
      if (c.pdaOpen) this.tip('pda', 'Le PDA : carte, SMS, statistiques et prix du marché, tout est là.');
    }
    if (c.stars > 0 && this.prevStars === 0) this.tip('etoile', 'La police te cherche : détruis leurs voitures ou cache-toi hors de leur champ de vision.', true);
    if (c.stars > 0 && c.hideSpotNear && !c.hidden) this.tip('cachette', `${this.k('interact')} pour te cacher ici : tant que les flics ne te voient pas, ils te perdent.`, true);
    if (c.hidden) this.tip('cache', 'Tu es caché. Attends que les flics s\'éloignent, puis ressors.');
    if (c.cameraNear) this.tip('camera', "Une caméra de surveillance : reste hors du cône rouge, ou détruis-la.");
    if ((c.unread ?? 0) > 0 && !tuto) this.tip('sms_nonlus', `Nouveau SMS : ouvre le PDA (${this.k('pda')}).`);

    if (this.gapT > 0) return;
    const i = this.queue.findIndex((t) => t.urgent || !tuto);
    if (i < 0) return;
    const [t] = this.queue.splice(i, 1);
    this.markSeen(t.id);
    this.tipEl.textContent = t.text.slice(0, 140);
    this.tipEl.classList.add('on');
    this.tipT = TIP_MS;
  }
}
