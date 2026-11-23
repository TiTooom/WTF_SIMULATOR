# Grand Theft Auto : Edition UniLaSalle

Monde ouvert 3D en vue à la première personne, style cartoon léger. Tu conduis des véhicules (voiture, pelleteuse avec godet, d'autres à venir) et tu joues **entre amis, sur le même Wi-Fi**, avec 12 véhicules (qui explosent), 33 objets WTF, un pistolet à gravité façon Garry's Mod, un chat, du son et des touches que tu règles comme tu veux.

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

La **molette** règle le zoom de la caméra en véhicule.

### Son
Moteurs dont la hauteur suit la vitesse (et qu'on entend de loin chez les autres joueurs), vérins de la pelleteuse, pas, vent, sons d'interface et de chat. Tout est généré en direct : aucun fichier audio, donc un jeu léger.

### Mises à jour (Windows)
Tu n'as à télécharger le `.exe` **qu'une seule fois**. À chaque lancement (puis toutes les 30 min), le jeu cherche une nouvelle version sur GitHub. S'il en trouve une, un bandeau vert apparaît dans le menu, le téléchargement se fait seul en arrière-plan, puis un bouton **« Redémarrer et mettre à jour »** installe la nouvelle version et relance le jeu. Si tu ne cliques pas, elle s'installe toute seule à la fermeture du jeu. Tes sauvegardes et réglages sont conservés.

> Pour jouer ensemble, tout le monde doit avoir la **même version** : l'hôte fournit lui-même le jeu aux navigateurs, mais l'application d'un ami dépend de sa propre version.

Sur macOS, la mise à jour automatique n'existe pas (elle exige une signature Apple payante) : il faut retélécharger le `.dmg`.

### Sauvegarde
La partie est stockée **chez l'hôte**, dans `%APPDATA%\GTA Edition UniLaSalle\saves\` sous Windows ou `~/Library/Application Support/GTA Edition UniLaSalle/saves/` sous macOS (`multi.json` pour l'hébergement, `solo.json` en solo) : caisses, véhicules et dernière position de chaque pseudo. Elle est enregistrée toutes les 30 s et quand l'hôte quitte. Supprime le fichier pour repartir de zéro. Tes réglages (touches, volumes) sont dans `settings.json`, au même endroit. Les sauvegardes de l'ancien nom (« Jeu 3D ») sont reprises automatiquement.

> L'hôte doit garder le jeu ouvert : c'est lui le serveur. S'il quitte, les autres reviennent au menu.

### Sans installer : depuis un navigateur
Un ami peut aussi rejoindre sans l'application, en ouvrant dans son navigateur l'adresse de l'hôte (par exemple `http://192.168.0.101:3000`, affichée dans l'écran de pause de l'hôte). Ses réglages sont alors enregistrés dans ce navigateur.

## Les véhicules (12)

| | Véhicule | Particularité |
|---|---|---|
| 🚗 | Voiture (×2) | Pour apprendre. Fragile aux explosions. |
| 🚜 | Pelleteuse | Bras articulé, godet qui soulève et déplace les caisses. |
| 🛡️ | **Tank** | Quasi insensible aux roquettes. La tourelle suit la caméra. Clic gauche : obus (qui fait « pschitt »). Clic droit maintenu : mitrailleuse. |
| 🚚 | **Camion articulé** | Remorque articulée (tête-à-queue possible !). Clic gauche : larguer/rattacher la remorque. Clic droit : benne qui déverse des caisses. |
| 🛒 | **Caddie turbo** | Léger et nerveux, dérapage, turbo, « bip » à chaque choc. 2 places. |
| 🍦 | **Camion de glaces** | Musique, lance-cornets qui ralentissent, mode disco qui fait sauter les petits véhicules. |
| 🚽 | **Toilettes à roulettes** | Ventouse qui attire les objets, chasse d'eau qui propulse… en arrière. |
| ✈️ | **Avion de chasse** | Piste d'atterrissage, train rentrant, mitrailleuse, missiles. **Explose si tu t'écrases trop vite.** |
| 🚁 | **Hélicoptère** | Vol stationnaire assisté, treuil qui accroche caisses et véhicules, souffle du rotor. 3 places. |
| 🛸 | **OVNI** | Rebondit comme une balle, rayon tracteur, éjection radiale. |
| 🛋️ | **Canapé-fusée** | Propulsé, saut à ressort, lance des coussins, turbo. 2 places. |
| 🎈 | **Dirigeable à pédales** | Il va aussi vite que tu martèles la touche. Touché, il se dégonfle et plane. |

Les véhicules **peuvent exploser** (chocs trop violents, roquettes, crash) puis réapparaissent après ~12 s. Chaque type a ses points de vie et son blindage.

## Inventaire et objets (33)

**Tab** ouvre l'inventaire : clique un objet pour le mettre dans l'emplacement actif de la barre (chiffres **1 à 9** ou molette pour choisir). **Clic gauche** utilise l'objet, **clic droit** pour son action secondaire.

- **Outils** : 🧲 *Pistolet à gravité* (saisis et déplace presque tout, même un copain ; molette = distance ; clic droit = geler), 🧽 *Gomme*, 🔥 *Soudure* (relie deux objets).
- **Construction** : planche, bloc, rampe, mur, pilier, ballon flottant (soulève une caisse ou une voiture), trampoline, barrique explosive, roue géante, propulseur.
- **Armes** : lance-roquettes, grenade, mitraillette, mine collante, fusil à ventouses, lance-tomates.
- **WTF** : canon à confettis, bombe à poulets, canne à pêche à vaches, chaussures à ressorts, super-aimant, trompette-tornade, champignon rétrécisseur, pastèque-bombe, ventilateur portatif.
- **Mobilité** : jetpack, grappin, parachute, bottes de gravité réduite, téléporteur.

Les props que tu poses restent dans le monde (sauvegardés), avec une limite par joueur.

## Un monde à explorer
Piste d'atterrissage et héliport, piste de cascade avec rampes et cerceaux, ville miniature à démolir, arène, parking de supermarché, château de caisses, pont… et quelques **easter eggs** cachés (vache sur le toit, bouton « NE PAS APPUYER », piano-caisse, pilier de 300 m…). Des panneaux près du départ indiquent les directions ; `/lieu <nom>` te téléporte.

## Chat, commandes, événements et modes
**Entrée** ouvre le chat. Les commandes commencent par `/` : `/help` liste tout.

| Commande | Effet |
|---|---|
| `/spawn <véhicule>`, `/drive <véhicule>` | crée un véhicule devant toi / monte dedans (3 par joueur) |
| `/tp <véhicule ou pseudo>`, `/lieu <nom>` | te téléporte |
| `/clear` | supprime tes objets posés |
| `/party`, `/klaxon`, `/miaou` | ambiance |
| `/gravite <n>`, `/taille <n>`, `/meteo <événement>`, `/mode <mode>`, `/annonce <texte>`, `/reset oui` | **réservé à l'hôte** (le premier joueur de la partie) |

- **Événements chaos** (`/meteo`, ou au hasard toutes les 4 à 8 min à plusieurs) : pluie de caisses, gravité lunaire, klaxons hurlants, sol glissant, gnome géant, tremblement de terre, aimant géant, party générale, touches inversées, vent violent.
- **Modes** : *roi de la colline* et *démolition derby* (`/mode`), classement dans le chat.

## Commandes par défaut (modifiables dans Options)

| Action | Touches |
|---|---|
| Marcher / sauter | Z Q S D / Espace |
| Regarder | Souris |
| Utiliser l'objet / action secondaire | Clic gauche / clic droit |
| Choisir un objet, inventaire | 1-9 ou molette, Tab |
| Monter / descendre d'un véhicule | E (à proximité) |
| Chat | Entrée |
| **Zoom caméra en véhicule** | **Molette** |
| Véhicules au sol | Z/S accélérer, Q/D tourner, Espace frein à main, H klaxon, clics = armes |
| Aéronefs | Z/S piquer-cabrer, Q/D roulis, Maj/Ctrl gaz ou altitude, lacet sur les touches Z/C physiques, H action spéciale (train…) |
| Pelleteuse | Z/S avancer, Q/D tourner · ←/→ pivoter la cabine · ↑/↓ flèche · R/F bras · T/G godet |
| Pause / options / menu principal | Échap |
| Plein écran | F11 (Windows) · Ctrl+Cmd+F (macOS) |

Les touches sont lues par position physique : les réglages marchent en AZERTY comme en QWERTY.

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
