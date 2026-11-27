# Grand Theft Auto : Edition UniLaSalle

Jeu de ville en **vue de dessus inclinée**, style bande dessinée, inspiré de *GTA: Chinatown Wars*. Tu conduis, tu fais du commerce de marchandises complètement absurdes entre cinq quartiers, tu évites la police, tu enchaînes des missions de 3 à 7 minutes et tu joues **entre amis, sur le même Wi-Fi**. Pas de mobile : ordinateur uniquement (application ou navigateur).

C'est une vraie application : tu la lances, un menu s'ouvre, tu choisis.

## Jouer

1. Télécharge ta version dans l'onglet [*Releases*](../../releases) du dépôt :
   - **Windows** : `GTA-UniLaSalle-Setup-….exe`. Double-clique : l'installation est automatique (sans question) et le jeu se lance. Ensuite, un raccourci *GTA Edition UniLaSalle* apparaît dans le menu Démarrer.
   - **macOS** : `GTA-UniLaSalle-…-mac-arm64.dmg` pour les Mac Apple Silicon (M1 et suivants) ou `…-mac-x64.dmg` pour les Mac Intel. Ouvre le `.dmg` et glisse *GTA Edition UniLaSalle* dans *Applications*.
2. Lance-le, tape ton pseudo, puis :
   - **Jouer en solo** : ta partie, sur ton ordinateur.
   - **Héberger une partie** : ton ordinateur devient le serveur. Tes amis sur le même Wi-Fi te voient apparaître dans leur menu.
   - **Rejoindre une partie** : les parties détectées sur ton Wi-Fi s'affichent, un clic suffit. Sinon, tape l'adresse de l'hôte (affichée dans son écran de pause, avec un bouton **Copier l'adresse**).
   - **Options** : touches, sensibilité de la souris, volumes (voir plus bas).

Au premier lancement en tant qu'hôte, le pare-feu peut demander une autorisation : **autorise les connexions entrantes / réseaux privés** (sans ça, tes amis ne te voient pas).

L'application n'est pas signée (une signature officielle est payante), donc le système affiche un avertissement la première fois :
- **Windows** (« SmartScreen ») : *Informations complémentaires → Exécuter quand même*.
- **macOS** (« GTA Edition UniLaSalle ne peut pas être ouvert… » ou « est endommagé ») : dans *Applications*, **clic droit sur GTA Edition UniLaSalle → Ouvrir → Ouvrir**. Si le message « endommagé » persiste, ouvre le Terminal et tape une seule fois :
  ```
  xattr -cr "/Applications/GTA Edition UniLaSalle.app"
  ```
  Puis relance l'application normalement.

Tout le monde doit être sur le même Wi-Fi (ou réseau local). Pas de redirection de port, pas de compte.

### Chat
En partie multijoueur, appuie sur **Entrée** pour écrire, **Entrée** pour envoyer, **Échap** pour annuler. Les messages s'estompent au bout de 10 s ; les nouveaux arrivants voient les 30 derniers messages. Le serveur annonce les arrivées et départs, limite chaque joueur à 5 messages par 5 secondes et 200 caractères.

### Options
Menu principal → **Options**, ou **Échap → Options** en jeu. Les réglages valent pour toutes les parties :
- **Touches** : clique sur une touche, appuie sur la nouvelle. Si elle servait déjà, les deux actions échangent leurs touches. Le noms des touches suit ton clavier (AZERTY, QWERTY…).
- **Sensibilité de la souris**.
- **Volumes** : général et effets.

La **molette** règle le zoom de la caméra.

### Son
Moteurs dont la hauteur suit la vitesse (et qu'on entend de loin chez les autres joueurs), sirènes, pas, explosions, sons d'interface, de chat et de mini-jeux. Tout est généré en direct : aucun fichier audio, donc un jeu léger.

### Mises à jour (Windows)
Tu n'as à télécharger le `.exe` **qu'une seule fois**. À chaque lancement (puis toutes les 30 min), le jeu cherche une nouvelle version sur GitHub. S'il en trouve une, un bandeau vert apparaît dans le menu, le téléchargement se fait seul en arrière-plan, puis un bouton **« Redémarrer et mettre à jour »** installe la nouvelle version et relance le jeu. Si tu ne cliques pas, elle s'installe toute seule à la fermeture du jeu. Tes sauvegardes et réglages sont conservés.

> Pour jouer ensemble, tout le monde doit avoir la **même version** : l'hôte fournit lui-même le jeu aux navigateurs, mais l'application d'un ami dépend de sa propre version.

Sur macOS, la mise à jour automatique n'existe pas (elle exige une signature Apple payante) : il faut retélécharger le `.dmg`.

### Sauvegarde
La partie est stockée **chez l'hôte**, dans `%APPDATA%\GTA Edition UniLaSalle\saves\` sous Windows ou `~/Library/Application Support/GTA Edition UniLaSalle/saves/` sous macOS (`multi.json` pour l'hébergement, `solo.json` en solo) : caisses, véhicules et dernière position de chaque pseudo. Elle est enregistrée toutes les 30 s et quand l'hôte quitte. Supprime le fichier pour repartir de zéro. Tes réglages (touches, volumes) sont dans `settings.json`, au même endroit. Les sauvegardes de l'ancien nom (« Jeu 3D ») sont reprises automatiquement.

> L'hôte doit garder le jeu ouvert : c'est lui le serveur. S'il quitte, les autres reviennent au menu.

### Sans installer : depuis un navigateur
Un ami peut aussi rejoindre sans l'application, **sur ordinateur**, en ouvrant dans son navigateur l'adresse de l'hôte (saisis l'adresse IP, pas un nom) (par exemple `http://192.168.0.101:3000`, affichée dans l'écran de pause de l'hôte). Ses réglages sont alors enregistrés dans ce navigateur.

## La ville
Une ville de 640 m avec **5 quartiers**, chacun contrôlé par un gang (clins d'œil à la vie étudiante, personne de réel) : **Le Campus** (Les Ingés), **Saint-Leu** (Les Mouettes de Saint-Leu), **La Cathédrale** (La Confrérie du Macaron), **Amiens Nord** (Les Clés de 12), **La Citadelle** (Le Club de la Citadelle). Piétons, circulation, voitures garées à voler, police.

## Ce qu'on y fait
- **Conduire** : 4 véhicules (citadine, berline, camionnette, voiture de police) avec une conduite arcade : forte adhérence, frein à main pour déraper. La caméra anticipe, pivote dans les virages et suit tes commandes.
- **Voler une voiture garée** : un petit mini-jeu (tournevis dans le contact, court-circuit…).
- **Le commerce de rue** : achète des marchandises **fictives** (café de la machine, annales secrètes, croissants pirates, ficelles picardes…) chez les dealers et revends-les là où elles sont demandées. Les prix varient selon le quartier, le gang et les **tuyaux reçus par SMS** sur ton **PDA**. Gare aux caméras et à la police : un échange vu fait monter la recherche.
- **La police** : des étoiles de recherche (0 à 5). Les policiers et les caméras ont un **champ de vision** dessiné au sol, bloqué par les bâtiments : **disparais de leur vue** assez longtemps et les étoiles tombent. Près d'une **cachette** (anneau vert), **E** te cache, à condition qu'aucun policier ne t'ait vu entrer. Détruire des voitures de police fait aussi baisser la recherche. Arrêté, tu perds ton sac et une partie de ton argent. Taper dans le vide ne dérange personne.
- **5 missions** (une par quartier) avec checkpoints, retour immédiat au dernier checkpoint en cas d'échec et **médailles bronze, argent, or**. En multi, la mission est partagée avec les joueurs à moins de 30 m.
- **Activités annexes** : taxi (dans une berline jaune garée) et justicier (dans une voiture de police), avec la touche d'activité.
- **8 mini-jeux** : tournevis, court-circuit, digicode, dosage, fouille, brise-glace, désamorçage, liasses. Souris et clavier, **sans limite de temps**, consignes affichées avant de commencer, abandon libre avec Échap.
- **Argent individuel** : chacun son argent et son sac, et `/donner <pseudo> <montant>` pour s'entraider.

## Commandes par défaut (modifiables dans Options)

| Action | Touches |
|---|---|
| Se déplacer | Z Q S D (selon ton clavier) : haut, gauche, bas, droite de l'écran |
| Viser | Souris (le curseur est un viseur ; Échap pour le libérer) |
| Courir / roulade (à pied) | Maj gauche / Espace |
| Monter / descendre, parler au dealer, se cacher | E |
| Conduire | Z/S accélérer et freiner, Q/D tourner, Espace frein à main, H klaxon ou sirène |
| Activité (taxi, justicier) | Q (position physique, voir Options) |
| PDA (carte, SMS, marché, missions, stats) | Tab |
| Chat | Entrée |
| Zoom de la caméra | Molette |
| Aide des commandes | F1 (ou le bouton « ? ») |
| Passer le tutoriel | F2 |
| Pause / options / menu principal | Échap |
| Plein écran | F11 (Windows) · Ctrl+Cmd+F (macOS) |

Les touches sont lues par position physique : les réglages marchent en AZERTY comme en QWERTY.

## Chat et commandes
**Entrée** ouvre le chat. Les commandes commencent par `/` : `/help` liste tout. `/drive <véhicule>` monte dans la voiture libre la plus proche, `/tp <pseudo>` te téléporte, `/donner <pseudo> <montant>` envoie de l'argent, `/nom` change de pseudo. `/debug` est réservé à l'hôte (outils de test).

## Développement

```
npm install
npm run app        # compile et lance l'application
npm run dev        # serveur + client dans le navigateur avec rechargement (http://localhost:5173)
npm run dist       # fabrique les installables de l'OS courant dans release/ (.exe sous Windows, .dmg sous macOS)
```

- `shared/` : constantes, protocole réseau, **réglages** et **simulation physique** (Rapier).
- `server/` : serveur Node (HTTP + WebSocket, boucle à 60 Hz, chat, sauvegarde), réutilisé par l'application.
- `electron/` : application de bureau (menu, démarrage du serveur, détection des parties par diffusion UDP, mises à jour, stockage des réglages).
- `src/` : client Three.js (rendu, caméra, entrées, son, chat, panneau d'options, interpolation des états reçus).

Le serveur est **autoritaire** : il fait toute la physique et envoie l'état du monde 30 fois par seconde ; les clients dessinent et envoient leurs commandes.

### Publier une version
1. Change `"version"` dans `package.json` (ex : `0.2.1`) et fais un commit.
2. Crée le tag **identique** et pousse-le :
```
git tag v0.2.1
git push origin main --tags
```
Le workflow `.github/workflows/release.yml` fabrique les `.exe` (sur un serveur Windows) et les `.dmg` (sur un serveur macOS, car une app macOS ne peut pas être fabriquée depuis Windows) puis les publie dans les Releases. Les joueurs Windows reçoivent la mise à jour automatiquement.

## Licence des outils d'assistance
Le dossier `.claude/` contient des agents et skills adaptés du dépôt [affaan-m/ecc](https://github.com/affaan-m/ecc) (licence dans `.claude/ECC-LICENSE`).
