// Commandes de chat (« /quelquechose ») exécutées côté serveur, jamais diffusées telles quelles.
// Extensible : d'autres fichiers (systèmes de jeu) appellent registerCommand('nom', handler, 'aide') sans toucher à celui-ci.
import type { SimPlayer } from '../shared/api';
import type { Sim } from '../shared/sim';
import { VEHICLES, VEHICLE_BY_TYPE } from '../shared/vehicles';
import type { VehicleDef } from '../shared/api';

export interface CmdCtx {
  sim: Sim;
  player: SimPlayer;
  args: string[]; // mots après le nom de la commande
  /** Réponse privée (message système visible uniquement par l'auteur). */
  reply(text: string): void;
  /** Annonce publique dans le chat de tout le monde. */
  announce(text: string): void;
}
export type CommandHandler = (ctx: CmdCtx) => void;

interface Cmd { handler: CommandHandler; help: string }
const commands = new Map<string, Cmd>();

export function registerCommand(name: string, handler: CommandHandler, help = '') {
  commands.set(name.toLowerCase().replace(/^\//, ''), { handler, help });
}

/** Exécute une ligne de chat commençant par « / ». Retourne false si ce n'est pas une commande. */
export function runCommand(sim: Sim, player: SimPlayer, line: string, reply: (t: string) => void): boolean {
  if (!line.startsWith('/')) return false;
  const [name, ...args] = line.slice(1).trim().split(/\s+/);
  const cmd = commands.get((name ?? '').toLowerCase());
  if (!cmd) {
    reply(`Commande inconnue : /${name ?? ''}. Tape /help pour la liste.`);
    return true;
  }
  try {
    cmd.handler({ sim, player, args, reply, announce: (t) => sim.announce(t) });
  } catch (e) {
    if (sim.noteError(e)) { reply('Le monde a hoqueté, réessaie dans un instant.'); return true; }
    reply('Aïe, la commande a planté (le serveur va bien).');
    sim.log(`[commands] /${name} : ${(e as Error)?.stack ?? e}`);
  }
  return true;
}

// ---------- Gouvernance : le chef de la bande (premier joueur du multi) garde les commandes qui touchent tout le monde ----------
const NOT_HOST = [
  'Seul le chef de la bande peut faire ça. Demande-lui gentiment (ou apporte des croissants).',
  'Seul le chef de la bande peut faire ça. Toi, tu as le droit de regarder.',
  'Seul le chef de la bande peut faire ça. Ton grade : touriste.',
];
/** Vrai si le joueur peut lancer une commande réservée à l'hôte ; sinon répond (drôlement) et retourne false. */
export function requireHost(ctx: { sim: Sim; player: SimPlayer; reply(t: string): void }): boolean {
  if (ctx.sim.isHost(ctx.player)) return true;
  ctx.reply(NOT_HOST[Math.floor(Math.random() * NOT_HOST.length)]);
  return false;
}

// ---------- Utilitaires ----------
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Retrouve un type de véhicule par identifiant, nom français (« la voiture ») ou début de mot. */
export function findVehicleDef(word: string): VehicleDef | null {
  let w = norm(word).replace(/[-\s]/g, '_');
  if (w === 'car' || w === 'voiture') w = 'citadine'; // ancien nom (vague 0)
  if (!w) return null;
  const direct = VEHICLE_BY_TYPE.get(w);
  if (direct) return direct;
  const names = (d: VehicleDef) => [d.type, norm(d.name).replace(/^(le|la|l'|les)\s*/, '').replace(/\s+/g, '_')];
  return VEHICLES.find((d) => names(d).some((n) => n === w)) ?? VEHICLES.find((d) => names(d).some((n) => n.startsWith(w) || n.includes(w))) ?? null;
}

function typeList() {
  return VEHICLES.map((d) => d.type).join(', ');
}

// ---------- Commandes de base ----------
registerCommand('help', ({ reply }) => {
  reply('Commandes : ' + [...commands.entries()].map(([n, c]) => (c.help.startsWith('/') ? c.help : `/${n}${c.help ? ` (${c.help})` : ''}`)).join(' · '));
}, 'cette aide');

registerCommand('drive', ({ sim, player, args, reply }) => {
  const def = findVehicleDef(args[0] ?? '');
  if (!def) return reply(`Usage : /drive <type>. Types : ${typeList()}`);
  const t = player.body.translation();
  let best = null as (typeof sim.vehicles)[number] | null;
  let bd = Infinity;
  for (const v of sim.vehicles) {
    if (v.def !== def || v.dead || v.pooled || v.driver || !v.behavior.body) continue;
    const vt = v.behavior.body.translation();
    const d = Math.hypot(vt.x - t.x, vt.z - t.z);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return reply('Aucun véhicule libre de ce type pour le moment.');
  if (!sim.enterVehicle(player, best, 0, true)) reply('Impossible de monter dedans.');
}, '/drive <type> : monte dans le véhicule libre le plus proche de ce type');

registerCommand('tp', ({ sim, player, args, reply }) => {
  const word = args.join(' ');
  if (!word) return reply('Usage : /tp <pseudo ou type de véhicule>');
  let target: { x: number; y: number; z: number } | null = null;
  const nw = norm(word);
  for (const q of sim.players.values()) {
    if (q === player || !norm(q.name).startsWith(nw)) continue;
    target = (q.vehicle?.behavior.body ?? q.body).translation();
    break;
  }
  if (!target) {
    const def = findVehicleDef(word);
    const t = player.body.translation();
    let bd = Infinity;
    for (const v of sim.vehicles) {
      if (!def || v.def !== def || v.dead || v.pooled || !v.behavior.body) continue;
      const vt = v.behavior.body.translation();
      const d = Math.hypot(vt.x - t.x, vt.z - t.z);
      if (d < bd) { bd = d; target = vt; }
    }
  }
  if (!target) return reply(`Personne ni rien de tel : « ${word} ».`);
  sim.teleportPlayer(player, target.x + 3, target.y + 2, target.z);
}, '/tp <pseudo|type> : se téléporter');
