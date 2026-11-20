// Panneau d'inventaire : tous les objets du registre par catégorie ; un clic (ou un glisser-déposer) place l'objet
// dans l'emplacement actif de la barre. La barre est persistée par le jeu (settings.hotbar).
import type { ItemCategory, ItemDef } from '../shared/api';
import { ITEMS, ITEM_BY_ID } from '../shared/registry';

const CATS: Array<[ItemCategory, string]> = [
  ['tool', 'Outils'], ['build', 'Construction'], ['weapon', 'Armes'], ['wtf', 'WTF'], ['move', 'Mobilité'],
];

export interface InventoryOpts {
  getHotbar(): string[];
  setHotbar(h: string[]): void;
  getSelected(): number;
  setSelected(i: number): void;
  keyLabels(): string[];
  onOpen(): void;
  onClose(): void;
}

export function createInventory(o: InventoryOpts) {
  const root = document.createElement('div');
  root.id = 'inventory';
  root.style.display = 'none';
  document.body.appendChild(root);
  let isOpen = false;
  let tab: ItemCategory | 'all' = 'all';
  let items: ItemDef[] = ITEMS;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function assign(slot: number, id: string) {
    const h = [...o.getHotbar()];
    h[slot] = id;
    o.setHotbar(h);
    render();
  }

  function render() {
    root.textContent = '';
    const card = el('div', 'inv-card');
    const head = el('div', 'inv-head');
    head.append(el('h2', undefined, 'Inventaire'), el('span', 'inv-hint', 'Clique un objet pour le mettre dans l’emplacement choisi (ou glisse-le dessus). Tab ou Échap pour fermer.'));
    card.appendChild(head);

    items = ITEMS;
    if (!items.length) {
      card.appendChild(el('div', 'inv-empty', 'Aucun objet pour l’instant'));
    } else {
      const tabs = el('div', 'inv-tabs');
      const tabBtn = (id: ItemCategory | 'all', label: string) => {
        const b = el('button', 'inv-tab' + (tab === id ? ' on' : ''), label);
        b.type = 'button';
        b.addEventListener('click', () => { tab = id; render(); });
        tabs.appendChild(b);
      };
      tabBtn('all', 'Tout');
      for (const [id, label] of CATS) if (items.some((i) => i.cat === id)) tabBtn(id, label);
      card.appendChild(tabs);

      const grid = el('div', 'inv-grid');
      for (const [cat, label] of CATS) {
        const list = items.filter((i) => i.cat === cat && (tab === 'all' || tab === cat));
        if (!list.length) continue;
        grid.appendChild(el('div', 'inv-sect', label));
        const row = el('div', 'inv-row');
        for (const it of list) {
          const c = el('button', 'inv-item');
          c.type = 'button';
          c.draggable = true;
          c.dataset.id = it.id;
          c.append(el('span', 'ie', it.emoji), el('span', 'in', it.name), el('span', 'id', it.desc));
          c.addEventListener('click', () => assign(o.getSelected(), it.id));
          c.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', it.id));
          row.appendChild(c);
        }
        grid.appendChild(row);
      }
      card.appendChild(grid);
    }

    // Barre d'objets (cibles de dépôt ; clic = choisir l'emplacement actif ; double-clic = vider)
    const hb = o.getHotbar();
    const labels = o.keyLabels();
    const bar = el('div', 'inv-bar');
    for (let i = 0; i < 9; i++) {
      const it = ITEM_BY_ID.get(hb[i]);
      const s = el('div', 'slot' + (i === o.getSelected() ? ' sel' : ''));
      s.dataset.slot = String(i);
      s.append(el('span', 'num', labels[i] ?? String(i + 1)), el('span', 'emoji', it?.emoji ?? ''), el('span', 'nm', it?.name ?? ''));
      s.addEventListener('click', () => { o.setSelected(i); render(); });
      s.addEventListener('dblclick', () => assign(i, ''));
      s.addEventListener('dragover', (e) => e.preventDefault());
      s.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer?.getData('text/plain');
        if (id && ITEM_BY_ID.has(id)) { o.setSelected(i); assign(i, id); }
      });
      bar.appendChild(s);
    }
    card.appendChild(bar);
    card.appendChild(el('div', 'inv-hint', 'Barre d’objets : clique un emplacement pour le choisir, double-clic pour le vider.'));
    root.appendChild(card);
  }

  const api = {
    isOpen: () => isOpen,
    open() {
      if (isOpen) return;
      isOpen = true;
      render();
      root.style.display = 'flex';
      o.onOpen();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      root.style.display = 'none';
      o.onClose();
    },
    toggle() {
      if (isOpen) api.close();
      else api.open();
    },
    refresh() {
      if (isOpen) render();
    },
  };
  return api;
}
export type Inventory = ReturnType<typeof createInventory>;
