// Commandes de chat (« /quelquechose ») exécutées côté serveur, jamais diffusées telles quelles.
// Extensible : d'autres fichiers (événements, modes…) appellent registerCommand('party', handler, 'aide') sans toucher à celui-ci.
// Les véhicules créés par /spawn sont de vrais véhicules du monde mais NE se sauvegardent qu'en vie (voir Sim.serialize, champ `extra`).
import * as THREE from 'three';
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
const MAX_SPAWN_PER_PLAYER = 3;
const spawnedBy = (sim: Sim, id: string) => sim.vehicles.filter((v) => v.extra && !v.dead && v.owner === id).length;

// ---------- Utilitaires ----------
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Retrouve un type de véhicule par identifiant, nom français (« la voiture ») ou début de mot. */
export function findVehicleDef(word: string): VehicleDef | null {
  const w = norm(word).replace(/[-\s]/g, '_');
  if (!w) return null;
  const direct = VEHICLE_BY_TYPE.get(w);
  if (direct) return direct;
  const names = (d: VehicleDef) => [d.type, norm(d.name).replace(/^(le|la|l'|les)\s*/, '').replace(/\s+/g, '_')];
  return VEHICLES.find((d) => names(d).some((n) => n === w)) ?? VEHICLES.find((d) => names(d).some((n) => n.startsWith(w) || n.includes(w))) ?? null;
}

function typeList() {
  return VEHICLES.map((d) => d.type).join(', ');
}

function frontOf(p: SimPlayer, dist: number) {
  const yaw = p.input.yaw;
  const t = p.body.translation();
  // Même convention que la marche : avant = (0, 0, -1) tourné de `yaw`
  const d = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x: t.x + d.x * dist, z: t.z + d.z * dist, yaw };
}

// ---------- Commandes de base ----------
registerCommand('help', ({ reply }) => {
  reply('Commandes : ' + [...commands.entries()].map(([n, c]) => (c.help.startsWith('/') ? c.help : `/${n}${c.help ? ` (${c.help})` : ''}`)).join(' · '));
}, 'cette aide');

registerCommand('spawn', ({ sim, player, args, reply, announce }) => {
  const def = findVehicleDef(args[0] ?? '');
  if (!def) return reply(`Usage : /spawn <type>. Types : ${typeList()}`);
  if (spawnedBy(sim, player.id) >= MAX_SPAWN_PER_PLAYER) return reply(`Tu as déjà invoqué ${MAX_SPAWN_PER_PLAYER} véhicules ! Fais-en exploser un avant d'en demander un autre.`);
  const f = frontOf(player, 8);
  const v = sim.spawnExtraVehicle(def, f.x, f.z, f.yaw, 1.5, player.id);
  if (!v) return reply('Trop de véhicules en jeu ! Détruis-en un d\'abord (ou fais-le exploser).');
  announce(`${player.name} a invoqué ${def.name} ${def.emoji}`);
}, '/spawn <type> : crée un véhicule devant toi');

registerCommand('drive', ({ sim, player, args, reply }) => {
  const def = findVehicleDef(args[0] ?? '');
  if (!def) return reply(`Usage : /drive <type>. Types : ${typeList()}`);
  const t = player.body.translation();
  let best = null as (typeof sim.vehicles)[number] | null;
  let bd = Infinity;
  for (const v of sim.vehicles) {
    if (v.def !== def || v.dead || v.driver || !v.behavior.body) continue;
    const vt = v.behavior.body.translation();
    const d = Math.hypot(vt.x - t.x, vt.z - t.z);
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) {
    if (spawnedBy(sim, player.id) >= MAX_SPAWN_PER_PLAYER) return reply(`Tu as déjà invoqué ${MAX_SPAWN_PER_PLAYER} véhicules ! Fais-en exploser un avant d'en demander un autre.`);
    const f = frontOf(player, 8);
    best = sim.spawnExtraVehicle(def, f.x, f.z, f.yaw, 1.5, player.id);
    if (!best) return reply('Trop de véhicules en jeu !');
  }
  if (!sim.enterVehicle(player, best, 0)) reply('Impossible de monter dedans.');
}, '/drive <type> : monte dans un véhicule de ce type');

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
      if (!def || v.def !== def || v.dead || !v.behavior.body) continue;
      const vt = v.behavior.body.translation();
      const d = Math.hypot(vt.x - t.x, vt.z - t.z);
      if (d < bd) { bd = d; target = vt; }
    }
  }
  if (!target) return reply(`Personne ni rien de tel : « ${word} ».`);
  sim.teleportPlayer(player, target.x + 3, target.y + 2, target.z);
}, '/tp <pseudo|type> : se téléporter');

registerCommand('clear', ({ sim, player, reply }) => {
  let n = 0;
  for (const p of [...sim.props.values()]) if (p.owner === player.id) { sim.removeProp(p); n++; }
  reply(n ? `${n} objet(s) supprimé(s).` : 'Tu n\'as rien posé.');
}, 'supprime tes objets');

registerCommand('gravite', ({ sim, player, args, reply, announce }) => {
  if (!requireHost({ sim, player, reply })) return;
  const raw = (args[0] ?? '').replace(',', '.');
  if (raw === '' ) return reply('Usage : /gravite <valeur> (normal : -9.81, lune : -1.6, 0 = apesanteur ; « normal » remet tout d\'équerre)');
  const v = raw === 'normal' ? -9.81 : Number(raw);
  if (!Number.isFinite(v)) return reply('Ce n\'est pas un nombre.');
  const g = v === 0 ? 0 : -Math.min(40, Math.abs(v)); // même plafond que le cœur : on annonce la valeur réellement appliquée
  sim.setGravity(g);
  announce(`${player.name} a réglé la gravité à ${Math.abs(g).toFixed(1)} m/s²${g === 0 ? ' (on flotte !)' : ''}`);
}, '/gravite <valeur>');

registerCommand('taille', ({ sim, player, args, reply, announce }) => {
  const v = Number((args[0] ?? '').replace(',', '.'));
  if (!Number.isFinite(v)) return reply('Usage : /taille <0.5 à 3> [pseudo]');
  const s = Math.max(0.5, Math.min(3, v));
  let who = player;
  const other = args.slice(1).join(' ').trim().toLowerCase();
  if (other && other !== player.name.toLowerCase()) {
    if (!requireHost({ sim, player, reply })) return; // changer la taille d'un autre : réservé au chef
    const q = [...sim.players.values()].find((x) => x.name.toLowerCase() === other);
    if (!q) return reply(`Personne ne s'appelle « ${args.slice(1).join(' ')} ».`);
    who = q;
  }
  sim.applyMod(who, { scale: s }, 120);
  announce(`${who.name} est maintenant ${s > 1 ? 'géant' : s < 1 ? 'minuscule' : 'normal'} (×${s})`);
}, '/taille <0.5-3> [pseudo]');
