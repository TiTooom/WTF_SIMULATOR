# Grand Theft Auto : Edition UniLaSalle

Vrai jeu à télécharger (application Windows Electron, installateur NSIS publié dans les Releases GitHub, dépôt `TiTooom/WTF_SIMULATOR` conservé volontairement : l'auto-update remplace l'ancien jeu WTF SIMULATOR). Jouable aussi dans un navigateur **sur ordinateur** : **pas de mobile ni de tactile** (décision du projet). Three.js (rendu) + Rapier (physique, côté serveur) + Node (serveur intégré) + Vite + TypeScript strict.

Inspiré de GTA: Chinatown Wars (voir `DA.md`) : vue de dessus inclinée, cel-shading BD à contours noirs, conduite arcade, économie de rue à marchandises **fictives**, étoiles de recherche, missions courtes à médailles, mini-jeux < 4 s, PDA. Violence « fidèle à Chinatown Wars » mais **sans sang explicite**. Clins d'œil légers à l'école, aucune personne réelle, aucune drogue réelle. Argent et sac **individuels** (`/donner`). Coop LAN : l'hôte est le serveur (même Wi-Fi, UDP 41234, pas de NAT traversal). Sauvegarde chez l'hôte dans `%APPDATA%/GTA Edition UniLaSalle/saves/` (`solo.json`, `multi.json`, copie `.bak`).

**Plan, contrats et propriétaires de fichiers : `docs/ARCHITECTURE-GTA.md` (source de vérité).** Vagues 0 à 5 faites ; reste la release (voir plus bas).

## Architecture
- `shared/` : constantes, protocole (`protocol.ts`), contrats (`ids.ts`, `api.ts`, `game.ts`), **simulation Rapier** (`sim.ts`), ville déterministe (`city/layout.ts`, `districts.ts`, `lanes.ts`), véhicules (`vehicles/arcade.ts` + 4 types), `economy/` (prix, gangs, marchandises, commerce : logique pure), `wanted.ts`, `peds.ts`, `missions/`, `activities.ts`, `minigames/rules.ts`, `onfoot.ts`, `ai/drive.ts`, `me.ts` (état privé compact).
- `server/server.ts` : HTTP statique + `/info` + WebSocket + boucle 60 Hz + snapshots delta 30 Hz compacts + sauvegarde atomique + disjoncteur. `server/game.ts` : `installGame` (bus d'événements typé, `SYSTEMS`). **Systèmes de jeu** dans `server/systems/` : `traffic, peds, police, economy, minigames, theft, missions, activities` (interface `GameSystem`, ordre = ordre d'appel).
- `electron/` : fenêtre, menu (`menu.html`, `menu.ts`), IPC, `discovery.ts` (UDP), `updater.ts`. Sécurité : `contextIsolation`, sandbox, pas de nodeIntegration ; le menu (file:) a l'API complète, une page distante n'a que `backToMenu` et les réglages ; handlers sensibles vérifient `senderFrame.url`.
- `src/` : client. **Aucune physique ni logique de jeu** : il dessine l'état interpolé (~100 ms de retard) et envoie des `Input`. `main.ts` (intégration), `camera.ts` (CameraRig : ressort, anticipation, pivot en virage, réagit aux commandes), `aim.ts` (verrouillage), `gfx.ts` (toon + contours coque inversée + estompage des bâtiments + silhouettes XRay), `city/cityView.ts` (25 chunks instanciés), `peds.ts`, `markers.ts`, `hud.ts`, `models.ts`, `fx.ts`, `vehicles/`, `minigames/`, `ui/` (PDA, boutique, vignettes BD, panneau de réglages).
- Serveur **autoritaire** : toute logique (économie, prix, missions, étoiles, résultats de mini-jeux) côté serveur, jamais dans le client. Tout message client (`GameClientMsg`, `Input`) est revalidé (`parseGameMsg`, `sim.setInput`).
- Ajouter un système : créer `server/systems/<id>.ts` (`SystemFactory`), ajouter l'id à `SYSTEM_IDS` (`shared/ids.ts`) et à `SYSTEMS` (`server/game.ts`).

## Pièges
- **Rapier critique** : lire/écrire un corps RETIRÉ du monde empoisonne définitivement Rapier. Les véhicules sont dans un **pool fixe jamais retiré** (`acquireVehicle/releaseVehicle`) ; on ne garde que des `VRef {id, gen}` revalidées par `sim.resolveRef()` et `bodyOk` (`shared/guard.ts`). Les piétons n'ont pas de corps. Un disjoncteur recrée la simulation (`installGame(fresh, {saved})`).
- `serialize()` d'un système ne lit **jamais** Rapier ; `restore()` valide tout (Map, clés `__proto__`/`constructor`/`prototype` filtrées).
- Budgets mesurés par `tests/charge.ts` : pas serveur moyen < 4 ms, snapshot delta < 8 Ko, `me` < 1 Ko. Les pics de pas sur Windows viennent des autres processus (quantum de 15,6 ms) : juger sur le minimum de 3 passages.
- **Sécurité réseau** : Origin + `Host` (localhost/IP privées seulement : les amis saisissent l'IP, pas un nom), seau à jetons par socket, comptes liés à un secret client hashé (`claims`), CSP sur le jeu. Aucun `innerHTML` avec des données réseau (toujours `textContent`).
- Les touches sont lues via `event.code` (position physique) : AZERTY et QWERTY fonctionnent. Une touche = une action.
- Pas fixe 1/60 côté serveur. Garder le client léger (pas d'asset lourd, ≤ 150 appels de dessin).
- Chaque nouveau joueur apparaît sur un POI `spawn` différent.
- **L'éditeur** (VS Code/Claude Code) définit `ELECTRON_RUN_AS_NODE=1` : pour lancer Electron depuis son terminal, `env -u ELECTRON_RUN_AS_NODE npm run app` (en tâche de fond, sinon l'app se ferme avec la commande).

## Tests
`npx tsx tests/<suite>.ts` : `smoke, robustesse, vehicules1, conduite, economie, economie-sim, pietons, minijeux, minijeux-reel, trafic, police, missions, disjoncteur, sauvegarde, reseau, charge, captures, reel`. Les suites « réel » et `captures` lancent Chrome headless en CDP (rendu logiciel) et sont sensibles à la charge machine : à lancer sur machine calme. Test automatisé de l'app : Electron avec `--remote-debugging-port=9333`.
- URL de test client : `?name= &cmd=/drive%20<type> &aim= &nopause`. `/debug stars|money|mg <kind>` (hôte seulement). `window.__wtf` expose audio et mesures (drawCalls) pour les tests.

## Commandes
- `npm run app` : compile et lance l'application · `npm run dev` : serveur + client dans le navigateur (http://localhost:5173) · `npm run build` : types + client + app · `npm run dist` : `.exe` dans `release/`.
- Mise à jour auto (Windows seulement, `electron/updater.ts` + `electron-updater`, dépôt public) : le tag `vX.Y.Z` doit égaler `version` de `package.json` ; la release doit contenir `latest.yml` + `.blockmap` + installateur NSIS (`GTA-UniLaSalle-Setup-X.Y.Z.exe`). Pas d'auto-update sur macOS (app non signée). Ne pas remettre de cible `portable`.
- Release : tag `v*` → `.github/workflows/release.yml` (jobs Windows + macOS). macOS : signature « ad hoc » par `scripts/adhoc-sign.cjs`. **Le build macOS n'a jamais été exécuté** : à vérifier au premier tag. **Créer un tag publie le nouveau jeu en remplacement de l'ancien chez tous les joueurs : confirmer avec l'utilisateur avant.**
- Version actuelle : 0.4.0 (pas encore taguée).

## Règles de travail
- Un commit avant chaque grosse passe, push entre les vagues, au nom de l'utilisateur, **sans ligne Co-Authored-By**.
- Agents (`.claude/agents/`) : `art-toon`, `game-camera-driving`, `game-economy`, `game-missions`, `game-minigames` + agents génériques (architect, planner, reviewers, build-error-resolver…). Un seul rédacteur par fichier pendant les vagues parallèles ; les fichiers d'intégration (`protocol.ts`, `api.ts`, `sim.ts`, `server.ts`, `game.ts`, `main.ts`, `net.ts`) sont modifiés en fin de vague.
