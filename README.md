# Jeu 3D

Monde ouvert 3D en vue à la première personne, style cartoon léger. Tu conduis des véhicules (voiture, pelleteuse avec godet, d'autres à venir) et tu joues **entre amis, sur le même Wi-Fi**.

C'est une vraie application : tu la lances, un menu s'ouvre, tu choisis.

## Jouer

1. Télécharge **`Jeu3D-…-portable.exe`** (aucune installation, il suffit de le lancer) ou **`Jeu3D-Installer-….exe`** dans l'onglet [*Releases*](../../releases) du dépôt.
2. Lance-le, tape ton pseudo, puis :
   - **Jouer en solo** : ta partie, sur ton ordinateur.
   - **Héberger une partie** : ton ordinateur devient le serveur. Tes amis sur le même Wi-Fi te voient apparaître dans leur menu.
   - **Rejoindre une partie** : les parties détectées sur ton Wi-Fi s'affichent, un clic suffit. Sinon, tape l'adresse de l'hôte (affichée dans son écran de pause).

Au premier lancement, Windows peut demander une autorisation de pare-feu : **autorise les réseaux privés** (sans ça, tes amis ne te voient pas). Windows peut aussi afficher un avertissement « SmartScreen » car l'application n'est pas signée : *Informations complémentaires → Exécuter quand même*.

Tout le monde doit être sur le même Wi-Fi (ou réseau local). Pas de redirection de port, pas de compte.

### Sauvegarde
La partie est stockée **chez l'hôte**, dans `%APPDATA%\Jeu 3D\saves\` (`multi.json` pour l'hébergement, `solo.json` en solo) : caisses, véhicules et dernière position de chaque pseudo. Elle est enregistrée toutes les 30 s et quand l'hôte quitte. Supprime le fichier pour repartir de zéro.

> L'hôte doit garder le jeu ouvert : c'est lui le serveur. S'il quitte, les autres reviennent au menu.

### Sans installer : depuis un navigateur
Un ami peut aussi rejoindre sans l'application, en ouvrant dans son navigateur l'adresse de l'hôte (par exemple `http://192.168.0.101:3000`, affichée dans l'écran de pause de l'hôte).

## Commandes

| Action | Touches |
|---|---|
| Marcher / sauter | Z Q S D / Espace |
| Regarder | Souris |
| Monter / descendre d'un véhicule | E (à proximité) |
| **Zoom caméra en véhicule** | **Molette** (réglage mémorisé) |
| Voiture | Z/S accélérer, Q/D tourner |
| Pelleteuse | Z/S avancer, Q/D tourner · ←/→ pivoter la cabine · ↑/↓ flèche · R/F bras · T/G godet |
| Pause / menu principal | Échap |
| Plein écran | F11 |

Les touches sont lues par position physique : elles marchent en AZERTY et en QWERTY.

## Développement

```
npm install
npm run app        # compile et lance l'application
npm run dev        # serveur + client dans le navigateur avec rechargement (http://localhost:5173)
npm run dist       # compile et fabrique les .exe dans release/
```

- `shared/` : constantes, protocole réseau et **simulation physique** (Rapier).
- `server/` : serveur Node (HTTP + WebSocket, boucle à 60 Hz, sauvegarde), réutilisé par l'application.
- `electron/` : application de bureau (menu, démarrage du serveur, détection des parties par diffusion UDP).
- `src/` : client Three.js (rendu, caméra, entrées, interpolation des états reçus).

Le serveur est **autoritaire** : il fait toute la physique et envoie l'état du monde 30 fois par seconde ; les clients dessinent et envoient leurs commandes.

### Publier une version
```
git tag v0.1.0
git push --tags
```
Le workflow `.github/workflows/release.yml` compile les `.exe` et les publie dans les Releases.

## Licence des outils d'assistance
Le dossier `.claude/` contient des agents et skills adaptés du dépôt [affaan-m/ecc](https://github.com/affaan-m/ecc) (licence dans `.claude/ECC-LICENSE`).
