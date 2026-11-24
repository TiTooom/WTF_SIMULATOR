// PROPRIÉTAIRE : game-economy
// Textes des tuyaux SMS (pénurie / surplus), expéditeurs fictifs. Pur : l'aléa vient d'un `rnd` fourni (graine -> déterministe).
// Appelé par prices.ts (rollTip) ; le système serveur n'a normalement pas besoin d'appeler ce fichier directement.
import type { DistrictId, GoodId } from '../ids';
import type { Sms } from '../protocol';
import { GOODS } from './goods';
import { DISTRICTS } from '../city/districts';

export type TipKind = 'penurie' | 'surplus';
/** Tuyau structuré : ce que le client peut lire pour marquer la carte / le marché. */
export interface Tip { good: GoodId; district: DistrictId; kind: TipKind }

export const TIP_SENDERS = ['Cousin Kevin', 'Numéro inconnu', 'Tata Josette', 'Le Fantôme de la BU', 'Michel (ne pas répondre)', 'Bureau des Élèves', 'Un pigeon de la cathédrale', 'Le Livreur du Matin', 'Un ch\'ti anonyme', 'La Mouette de Saint-Leu'];

const PENURIE = [
  (g: string, d: string) => `Grosse pénurie de ${g} à ${d}. Ça se vendra à prix d'or, dépêche-toi.`,
  (g: string, d: string) => `Y a plus un seul ${g} à ${d}. Les gens se battent. Amène-en.`,
  (g: string, d: string) => `Psst. ${d} crève de faim de ${g}. Moi je dis ça, je dis rien.`,
  (g: string, d: string) => `Rupture de ${g} à ${d} : même le directeur de l'école a appelé. Fonce.`,
];
const SURPLUS = [
  (g: string, d: string) => `Camion de ${g} renversé à ${d}. Tout est bradé, rachète avant que ça remonte.`,
  (g: string, d: string) => `${d} déborde de ${g}. Plus personne n'en veut, c'est le moment d'en prendre.`,
  (g: string, d: string) => `Soldes sur ${g} à ${d} : on en donne presque. Ne revends pas là-bas.`,
  (g: string, d: string) => `Trop de ${g} à ${d}, le stock fond comme un macaron sous la pluie d'Amiens. Les prix aussi.`,
];

/** Texte d'un tuyau. `surplus` : prix cassé ; sinon pénurie (prix qui explose). `rnd` choisit la variante. */
export function tipText(good: GoodId, district: DistrictId, surplus: boolean, rnd: () => number = () => 0): string {
  const list = surplus ? SURPLUS : PENURIE;
  const i = Math.min(list.length - 1, Math.floor(rnd() * list.length));
  return list[i](GOODS[good].name.toLowerCase(), DISTRICTS[district].name);
}

/** Construit le SMS (sans `id` ni `at`, ajoutés par le serveur) d'un événement de marché. `mult` < 1 : surplus. */
export function makeTipSms(ev: { good: GoodId; district: DistrictId; mult: number; until: number }, rnd: () => number): Omit<Sms, 'id' | 'at'> {
  const surplus = ev.mult < 1;
  const from = TIP_SENDERS[Math.min(TIP_SENDERS.length - 1, Math.floor(rnd() * TIP_SENDERS.length))];
  return { from, text: tipText(ev.good, ev.district, surplus, rnd), tip: { good: ev.good, district: ev.district, mult: ev.mult, until: ev.until } };
}

/** Lecture structurée d'un SMS (côté client : PDA). */
export function tipOf(sms: Pick<Sms, 'tip'>): Tip | null {
  return sms.tip ? { good: sms.tip.good, district: sms.tip.district, kind: sms.tip.mult < 1 ? 'surplus' : 'penurie' } : null;
}
