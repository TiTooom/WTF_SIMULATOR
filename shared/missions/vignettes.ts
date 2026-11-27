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
    { img: 'ville_aube', text: 'Campus des Ingés, 7 h 42. Les cafés fument, les cernes aussi.' },
    { img: 'amphi', who: 'Le Délégué', text: 'Les annales de la semaine prochaine sont dans une benne derrière la reprographie. Ne me demande pas comment.' },
    { img: 'ruelle', who: 'Toi', text: 'Une benne. Évidemment.' },
    { img: 'voiture', who: 'Le Délégué', text: 'Et à la bibliothèque, on ne rentre pas à pied avec des annales sous le bras. Trouve-toi une voiture.' },
  ],
  [vignetteId('annales', 'fin')]: [
    { img: 'liasses', who: 'Le Délégué', text: 'Quinze pages de sujets qui datent de 2009 ? Génial. Personne n\'ira vérifier.' },
    { img: 'ville_aube', text: 'Le campus respire. La photocopieuse, elle, réclame un congé.' },
  ],
  [vignetteId('sardines', 'intro')]: [
    { img: 'rue_nuit', text: 'Saint-Leu, 23 h. Les canaux sentent la vase et la crème tiède.' },
    { img: 'ruelle', who: 'Capitaine Mouette', text: 'J\'ai des ficelles picardes « à manger avant hier ». Une camionnette m\'attend. Enfin, elle attend quelqu\'un.' },
    { img: 'poursuite', who: 'Capitaine Mouette', text: 'La police municipale va te coller aux basques. Pousse-la dans le décor, elle adore ça.' },
  ],
  [vignetteId('sardines', 'fin')]: [
    { img: 'explosion', text: 'Deux voitures de police au tapis, une camionnette qui sent le jambon-champignons. Une réussite.' },
    { img: 'liasses', who: 'Capitaine Mouette', text: 'Pour la facture, je mettrai « poisson d\'avril ». Tiens, ta part.' },
  ],
  [vignetteId('fromage', 'intro')]: [
    { img: 'ville_aube', text: 'La cathédrale d\'Amiens veille depuis huit siècles. Elle en a vu passer, des macarons.' },
    { img: 'ruelle', who: 'Frère Amandin', text: 'Une berline, une cargaison, une crypte. Et surtout, de la douceur. Un macaron, ça s\'effrite.' },
    { img: 'voiture', who: 'Toi', text: 'Et si la berline n\'est pas à moi ?' },
    { img: 'rue_nuit', who: 'Frère Amandin', text: 'Elle n\'est jamais à personne, ici. Une fois la cargaison reposée, il restera les camionnettes rivales.' },
  ],
  [vignetteId('fromage', 'fin')]: [
    { img: 'explosion', text: 'Trois camionnettes rivales en confettis de tôle. La recette est sauve.' },
    { img: 'liasses', who: 'Frère Amandin', text: 'Du goût et du doigté. La Confrérie s\'en souviendra.' },
  ],
  [vignetteId('ecrous', 'intro')]: [
    { img: 'rue_nuit', text: 'Amiens Nord ne dort jamais. On y vérifie ses boulons.' },
    { img: 'ruelle', who: 'Ginette des Clés', text: 'Cinq cents écrous de 12. Pas de 13, pas de 11. Et le portail est équipé d\'une caméra et d\'un digicode.' },
    { img: 'amphi', who: 'Toi', text: 'Tu as un plan ?' },
    { img: 'explosion', who: 'Ginette des Clés', text: 'Oui. Il est très bruyant.' },
  ],
  [vignetteId('ecrous', 'fin')]: [
    { img: 'voiture', text: 'La camionnette du chef roule, lourde de quincaillerie.' },
    { img: 'liasses', who: 'Ginette des Clés', text: 'Pile douze. Tu as un avenir dans la clé à molette.' },
  ],
  [vignetteId('golf', 'intro')]: [
    { img: 'ville_aube', text: 'La Citadelle. Ici, même les briques ont un pedigree.' },
    { img: 'amphi', who: 'Monsieur Rempart', text: 'Une bombe, dans mon amphi ! Une bombe à confettis, certes, mais un confetti, ça tache.' },
    { img: 'poursuite', who: 'Monsieur Rempart', text: 'Désamorce, vole la berline du voisin, sème la police. Tout ça en six minutes, j\'ai une réunion à 14 h.' },
  ],
  [vignetteId('golf', 'fin')]: [
    { img: 'explosion', text: 'Un seul confetti a survécu. Il est encadré dans la Tour Perret.' },
    { img: 'liasses', who: 'Monsieur Rempart', text: 'Les remparts sont saufs ! Tiens, ça brille.' },
  ],
};

/** Vérifie que chaque mission a ses deux planches (utilisé par les tests). */
export const hasVignettes = (m: Pick<MissionDef, 'id'>): boolean =>
  !!MISSION_VIGNETTES[vignetteId(m.id, 'intro')]?.length && !!MISSION_VIGNETTES[vignetteId(m.id, 'fin')]?.length;
