import type { ChatMsg } from '../shared/protocol';

const MAX_LINES = 50;
const FADE_AFTER_MS = 10_000;

export interface Chat {
  add(m: ChatMsg): void;
  open(): void;
  close(sendIt: boolean): void;
  isOpen(): boolean;
  setEnabled(enabled: boolean): void;
}

export function createChat(opts: {
  send: (text: string) => void;
  onOpen: () => void; // le jeu libère la souris et ignore les touches
  onClose: () => void; // le jeu reprend la souris
}): Chat {
  const root = document.getElementById('chat')!;
  const log = document.getElementById('chatLog')!;
  const input = document.getElementById('chatInput') as HTMLInputElement;
  let open = false;
  let enabled = false;

  const refresh = () => {
    const now = Date.now();
    for (const line of Array.from(log.children) as HTMLElement[])
      line.classList.toggle('faded', !open && now - Number(line.dataset.t) > FADE_AFTER_MS);
    log.scrollTop = log.scrollHeight;
  };
  setInterval(refresh, 1000);

  const chat: Chat = {
    add(m) {
      const line = document.createElement('div');
      line.dataset.t = String(Date.now());
      if (m.sys) {
        line.className = 'sys';
        line.textContent = m.text; // textContent : jamais de HTML venant d'un autre joueur
      } else {
        const who = document.createElement('b');
        who.textContent = m.from + ' : ';
        line.append(who, document.createTextNode(m.text));
      }
      log.appendChild(line);
      while (log.children.length > MAX_LINES) log.firstChild!.remove();
      refresh();
    },
    open() {
      if (!enabled || open) return;
      open = true;
      root.classList.add('open');
      input.value = '';
      opts.onOpen();
      input.focus();
      refresh();
    },
    close(sendIt) {
      if (!open) return;
      const text = input.value.trim();
      open = false;
      root.classList.remove('open');
      input.blur();
      input.value = '';
      if (sendIt && text) opts.send(text);
      opts.onClose();
      refresh();
    },
    isOpen: () => open,
    setEnabled(e) {
      enabled = e;
      root.style.display = e ? 'block' : 'none';
    },
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // les touches du jeu ne doivent pas réagir pendant la saisie
    if (e.key === 'Enter') chat.close(true);
    else if (e.key === 'Escape') chat.close(false);
  });
  return chat;
}
