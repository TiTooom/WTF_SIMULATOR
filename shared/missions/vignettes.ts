// PROPRIÉTAIRE : game-missions
// Planches BD d'introduction et de fin de chaque mission (données pures). Le serveur envoie `{ k: 'vignettes', id }` ; le client joue le script
// enregistré sous cet id (`registerVignettes`, src/ui/comic.ts). src/ui/pda/missions.ts enregistre tout ce fichier au chargement.
// Ton : humour de campus, violence « dessin animé », jamais de sang, aucune personne réelle.
import type { MissionDef } from './types';

/** Même forme que `Panel` de src/ui/comic.ts (image parmi COMIC_IMAGES, texte, qui parle). */
export interface VignettePanel { img: string; text: string; who?: string }

export const vignetteId = (missionId: string, part: 'intro' | 'fin'): string => `m_${missionId}_${part}`;

export const MISSION_VIGNETTES: Record<string, VignettePanel[]> = {
  [vignetteId('annales', 'intro')]: [
    { img: 'ville_aube', text: 'Campus des Agros, 7 h 42. Les cafés fument, les cernes aussi.' },
    { img: 'amphi', who: 'Le Délégué', text: 'Les annales de la semaine prochaine sont dans une benne derrière la reprographie. Ne me demande pas comment.' },
    { img: 'ruelle', who: 'Toi', text: 'Une benne. Évidemment.' },
    { img: 'voiture', who: 'Le Délégué', text: 'Et à la bibliothèque, on ne rentre pas à pied avec des annales sous le bras. Trouve-toi une voiture.' },
  ],
  [vignetteId('annales', 'fin')]: [
    { img: 'liasses', who: 'Le Délégué', text: 'Quinze pages de sujets qui datent de 2009 ? Génial. Personne n\'ira vérifier.' },
    { img: 'ville_aube', text: 'Le campus respire. La photocopieuse, elle, réclame un congé.' },
  ],
  [vignetteId('sardines', 'intro')]: [
    { img: 'rue_nuit', text: 'Les Docks, 23 h. Ça sent la marée et la paperasse en retard.' },
    { img: 'ruelle', who: 'Capitaine Mouette', text: 'J\'ai des sardines « non homologuées ». Une camionnette m\'attend. Enfin, elle attend quelqu\'un.' },
    { img: 'poursuite', who: 'Capitaine Mouette', text: 'La police municipale va te coller aux basques. Pousse-la dans le décor, elle adore ça.' },
  ],
  [vignetteId('sardines', 'fin')]: [
    { img: 'explosion', text: 'Deux voitures de police au tapis, une camionnette qui sent le poisson. Une réussite.' },
    { img: 'liasses', who: 'Capitaine Mouette', text: 'Pour la facture, je mettrai « poisson d\'avril ». Tiens, ta part.' },
  ],
  [vignetteId('fromage', 'intro')]: [
    { img: 'ville_aube', text: 'Le Vieux Bourg sent le lait fermenté depuis quatre siècles.' },
    { img: 'ruelle', who: 'Frère Brie', text: 'Une berline, une meule, une cave. Et surtout, du silence. Le fromage a l\'oreille fine.' },
    { img: 'voiture', who: 'Toi', text: 'Et si la berline n\'est pas à moi ?' },
    { img: 'rue_nuit', who: 'Frère Brie', text: 'Elle n\'est jamais à personne, ici. Après l\'affinage, il restera les camionnettes rivales.' },
  ],
  [vignetteId('fromage', 'fin')]: [
    { img: 'explosion', text: 'Trois camionnettes rivales en confettis de tôle. Le cheddar est fier.' },
    { img: 'liasses', who: 'Frère Brie', text: 'Un homme de goût. Et d\'odorat, visiblement.' },
  ],
  [vignetteId('ecrous', 'intro')]: [
    { img: 'rue_nuit', text: 'La Zone Indus ne dort jamais. Elle vérifie ses boulons.' },
    { img: 'ruelle', who: 'Ginette des Clés', text: 'Cinq cents écrous de 12. Pas de 13, pas de 11. Et le portail est équipé d\'une caméra et d\'un digicode.' },
    { img: 'amphi', who: 'Toi', text: 'Tu as un plan ?' },
    { img: 'explosion', who: 'Ginette des Clés', text: 'Oui. Il est très bruyant.' },
  ],
  [vignetteId('ecrous', 'fin')]: [
    { img: 'voiture', text: 'La camionnette du chef roule, lourde de quincaillerie.' },
    { img: 'liasses', who: 'Ginette des Clés', text: 'Pile douze. Tu as un avenir dans la clé à molette.' },
  ],
  [vignetteId('golf', 'intro')]: [
    { img: 'ville_aube', text: 'Les Hauts. Ici, même les pelouses ont un pedigree.' },
    { img: 'amphi', who: 'Monsieur Birdie', text: 'Une bombe, dans mon amphi ! Une bombe à confettis, certes, mais un confetti, ça tache.' },
    { img: 'poursuite', who: 'Monsieur Birdie', text: 'Désamorce, vole la berline du voisin, sème la police. Tout ça en six minutes, j\'ai un départ à 14 h.' },
  ],
  [vignetteId('golf', 'fin')]: [
    { img: 'explosion', text: 'Un seul confetti a survécu. Il est encadré.' },
    { img: 'liasses', who: 'Monsieur Birdie', text: 'Trou en un ! Je ne sais pas ce que ça veut dire, mais tiens, ça brille.' },
  ],
};

/** Vérifie que chaque mission a ses deux planches (utilisé par les tests). */
export const hasVignettes = (m: Pick<MissionDef, 'id'>): boolean =>
  !!MISSION_VIGNETTES[vignetteId(m.id, 'intro')]?.length && !!MISSION_VIGNETTES[vignetteId(m.id, 'fin')]?.length;
