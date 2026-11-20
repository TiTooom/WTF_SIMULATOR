# Jeu 3D

Vrai jeu à télécharger (application Windows Electron, `.exe` portable + installateur, publiés dans les Releases GitHub). Plus d'itch.io. Three.js (rendu) + Rapier (physique, côté serveur) + Node (serveur intégré à l'app) + Vite + TypeScript strict.

## Scope
- Monde ouvert plat, vue première personne, style cartoon léger (MeshToonMaterial, contours, pas d'ombres) pour petites configs.
- Le joueur conduit tout type de véhicule (voiture, camion + remorque, avion/chasseur, engins de chantier), chacun avec sa spécificité
  (remorque, train rentrant + tir, godet...) et interagit avec l'environnement (casser, construire, déplacer). Physique arcade crédible.
- Ordre des véhicules : voiture + marche (fait) → pelleteuse (fait) → camion/remorque → avion.
- **Tout se fait dans l'application, aucune commande ni .bat** : menu Solo / Héberger / Rejoindre. Multi entre amis sans enjeu : l'hôte = serveur (même Wi-Fi uniquement, LAN, pas de NAT traversal), parties détectées par diffusion UDP (port 41234) ou adresse saisie. Sauvegarde chez l'hôte dans `%APPDATA%/Jeu 3D/saves/` (`solo.json`, `multi.json`).

## Architecture
- `shared/` : constantes + génération déterministe du monde (arbres, caisses), protocole, **simulation Rapier** (`sim.ts`).
- `server/server.ts` : `startServer()` (HTTP statique + `/info` + WebSocket + boucle 60 Hz + snapshots 30 Hz + sauvegarde atomique). `server/index.ts` = lancement CLI pour le dev uniquement.
- `electron/` : `main.ts` (fenêtre, démarre/arrête le serveur, IPC), `preload.ts` (API `launcher`), `menu.html` (menu), `discovery.ts` (annonce/écoute UDP).
  - Sécurité : `contextIsolation`, sandbox, pas de nodeIntegration. Le menu (file:) a l'API complète ; une page de jeu distante (hôte d'un ami) n'a que `backToMenu`. Les handlers IPC sensibles vérifient `senderFrame.url` (file:).
- `src/` : client. Aucune physique : il dessine l'état interpolé (~100 ms de retard) et envoie ses commandes (`Input`). Pause = Échap (pointer lock perdu).
- Serveur **autoritaire** : toute logique de jeu va dans `shared/sim.ts`, jamais dans le client.
- Ajouter un véhicule : `makeXxx` dans `sim.ts` (+ `VEHICLE_SPECS`, `SaveData`), modèle dans `src/models.ts`, caméra dans `CAMS` (`src/main.ts`), type dans `protocol.ts`.

## Commandes
- `npm run app` : compile et lance l'application · `npm run dev` : serveur + client dans le navigateur (http://localhost:5173) · `npm run build` : types + client + app · `npm run dist` : `.exe` dans `release/`.
- Mise à jour auto (Windows seulement, `electron/updater.ts` + `electron-updater`, dépôt public) : le tag `vX.Y.Z` doit égaler `version` de package.json ; la release doit contenir `latest.yml` + `.blockmap` + installateur NSIS. Pas d'auto-update sur macOS (app non signée). Ne pas remettre de cible `portable` (non mise à jour).
- Release : tag `v*` → `.github/workflows/release.yml` (jobs Windows + macOS ; les `.dmg` ne se fabriquent que sur un Mac/runner macOS). macOS : app non signée mais signée « ad hoc » par `scripts/adhoc-sign.cjs` (hook `afterPack`) ; menu d'application minimal sur darwin (`electron/main.ts`). **Le build macOS n'a jamais été exécuté** (développé sous Windows) : à vérifier au premier tag.
- **Piège** : l'éditeur (VS Code/Claude Code) définit `ELECTRON_RUN_AS_NODE=1` ; pour lancer Electron depuis son terminal il faut le retirer (`env -u ELECTRON_RUN_AS_NODE npx electron .`).
- Test automatisé de l'app : lancer Electron avec `--remote-debugging-port=9333` et piloter le menu via le protocole CDP.

## Règles
- Pas fixe 1/60 côté serveur. Garder le client léger (pas d'asset lourd).
- Les touches sont lues via `event.code` (position physique) : AZERTY et QWERTY fonctionnent.
- Chaque nouveau joueur apparaît décalé (sinon sa caméra est dans un autre joueur).
