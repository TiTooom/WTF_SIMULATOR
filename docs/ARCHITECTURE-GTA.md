# Grand Theft Auto : Edition UniLaSalle — architecture v3 (référence de l'équipe)

Remplace `docs/ARCHITECTURE.md`, `CONTENT-BRIEF.md` et `wtf-ideas.md` (ancien jeu WTF, obsolètes). Source de vérité des contrats entre agents.

## 0. Décisions
- **Produit** : ville en vue de dessus inclinée façon GTA: Chinatown Wars (voir `DA.md`), coop LAN, PC uniquement (appli Electron ou navigateur).
- **Argent et sac individuels** par joueur (commande `/donner <pseudo> <montant>`).
- **Violence fidèle à Chinatown Wars** (pistolet, fusil à pompe, Molotov, piétons renversables) mais **sans sang explicite**.
- **École** : clins d'œil légers (campus, annales, café de la machine), aucune personne réelle ni filière précise caricaturée. Marchandises fictives et absurdes, aucun nom de drogue réelle.
- **Release** : même dépôt GitHub (`WTF_SIMULATOR`) et même `appId` ; l'auto-update remplace l'ancien jeu. Ne pas toucher `package.json > build.publish`.
- **Logique de jeu** : des *systèmes* serveur (`server/systems/*.ts`) branchés autour de `Sim`, via `GameSystem` et un bus d'événements typé. `sim.ts` reste le moteur physique.
- **Pool de véhicules fixe** (jamais de `removeRigidBody`) : recyclage par téléportation et `setEnabled(false)`. Les références entre ticks sont des `VRef {id, gen}` revalidées par `sim.resolveRef()`. **Piège Rapier** : toujours `bodyOk`.
- **Trafic** : voitures du pool pilotées par une IA qui produit un `Input` (`v.ai.input`). **Piétons** : données pures sans corps Rapier, sur rails (tour des îlots).
- **État privé** par joueur : message `me` (10 Hz max, seulement s'il change). Le snapshot public reste commun (delta).
- **Sauvegarde v3** : positions + `systems: Record<SystemId, unknown>`, chaque système sérialise sans lire Rapier. Anciennes sauvegardes ignorées sans erreur.
- **Un seul rédacteur par fichier** (voir §4). L'intégrateur (chef) modifie seul `protocol.ts`, `api.ts`, `sim.ts`, `server.ts`, `server/game.ts`, `main.ts`, `net.ts`, `index.html`, `settings.ts`, uniquement en fenêtre d'intégration (fin de vague).

## 1. Purge (vague 0, intégrateur seul, `tsc` + `vite build` verts à chaque étape)
**Supprimer** : `shared/packs/`, tous les véhicules `shared/vehicles/*` sauf `car.ts` (remplacé en vague 2) et leurs vues `src/vehicles/*`, `shared/world.ts` (→ `shared/city/`), `server/events.ts`, `modes.ts`, `extras.ts` (→ `server/game.ts`), `src/inventory.ts`, commandes `/gravite /taille /clear /meteo /party /klaxon /miaou /annonce /reset /lieu /mode`, `HANDLERS/ITEMS/ITEM_BY_ID`, `runItems`, `holster`, `spawnExtraVehicle`, `setGravity`, `EXC`, `VEHICLE_SPECS`, `treeLayout`, `crateLayout`, barre d'objets du HUD et de `main.ts`, `?item=`, tests `objets1/2/3 aeronefs aeriens monde vehicules2`, `docs/wtf-ideas.md`, `docs/CONTENT-BRIEF.md`. Réglages : retirer `throttleUp/Down yawLeft/Right inventory slot1..9`, groupe Pelleteuse, champ `hotbar`.
**Conserver** : `electron/` entier, `shared/guard.ts`, `server/index.ts`, HTTP/WebSocket/heartbeat/Origin/chat/boucle 60 Hz/snapshots 30 Hz/disjoncteur/sauvegarde atomique de `server/server.ts`, `src/chat.ts`, `src/ui/settingsPanel.ts`, `src/settings.ts`, `src/gfx.ts` (toon + contours), `src/fx.ts`, `src/audio.ts`, `src/net.ts`, `src/camera` (dans `main.ts`), noyau physique de `sim.ts` (joueurs, `driveArcade`, chocs, explosions, projectiles, `raycast`, `buildSnapshot`).
**Ordre** : (1) client sans inventaire ; (2) `server/game.ts` vide (`installGame`) à la place d'`installExtras`, suppression extras/events/modes ; (3) sim sans objets, suppression `packs/` ; (4) un seul véhicule (`car`), monde vidé ; (5) `Input` réduit ; (6) docs.
Sortie : une voiture sur un sol plat, à pied et en voiture, chat/réglages/sauvegarde OK, tests restants verts.

## 2. Ville (`shared/city/`, déterministe, identique client/serveur)
```ts
export const CITY = { SEED: 20260601, N: 10, CELL: 64, HALF: 320, ROAD: 8, SIDEWALK: 3, LOT: 50, CHUNK: 128, BORDER: 330 } as const;
```
- Grille 10×10, rues sur toutes les lignes (11×11 = 121 intersections, 220 tronçons), circulation à droite. Trottoirs et marquages **visuels uniquement** (pas de bordure physique).
- 5 quartiers par Voronoï (Manhattan) sur les centres de cellules : `campus` (Les Agros, vert), `docks` (La Bande des Mouettes, bleu), `vieux_bourg` (La Confrérie du Fromage, jaune), `zone_indus` (Les Clés de 12, orange), `les_hauts` (Le Club des Golfeurs, violet).
- `getCity(): CityLayout` mémoïsée : `blocks`, `buildings` (boîtes), `nodes`/`edges` (graphe routier), `pois` (dealer, planque, commissariat, hôpital, camera, parking, donneur, spawn), `districtAt`, `blockAt`, `chunkOf`, `nearestNode`. POI garantis : 2 dealers + 1 planque + 3 caméras + 1 donneur par quartier, 1 commissariat, 1 hôpital, ~20 parkings. ~8 % d'îlots parc/place.
- Rapier : sol + ~300 cuboïdes fixes (bâtiments) + 4 murs de bordure. Budget serveur < 4 ms/pas avec 4 joueurs.
- Client `src/city/cityView.ts` : 25 chunks construits une fois, 3×3 visibles, `InstancedMesh` + coques de contour, ≤ ~150 appels de dessin, brouillard ~150 m.

## 3. Contrats (extraits ; `protocol.ts`, `api.ts`, `ids.ts`, `game.ts` écrits par l'intégrateur en vague 1, ajouts seulement en fin de liste)
```ts
// shared/ids.ts
VEHICLE_TYPES = ['citadine','berline','camionnette','police']; DISTRICT_IDS; GANG_IDS = ['agros','mouettes','fromagers','cles_de_12','golfeurs'];
GOOD_IDS (marchandises fictives, réglables par economy); MINIGAME_KINDS = ['tournevis','court_circuit','digicode','dosage','fouille','brise_glace','desamorcage','liasses'];
CrimeKind = 'vol_vehicule'|'pieton_renverse'|'agression_flic'|'flic_detruit'|'deal_vu'|'camera_detruite'|'tir'|'explosion'; MedalTier = 'bronze'|'argent'|'or';
SystemId = 'traffic'|'peds'|'police'|'economy'|'missions'|'minigames'|'activities'; PedKind = 'passant'|'etudiant'|'dealer'|'flic'|'gang';

// Input : f s jump(roulade/frein à main) run yaw hn(klaxon/sirène) act(activité) m1 m2 ao ad
// PlayerSnap + ws? (étoiles) an? ; VehicleSnap + lv? lk? ai? ; Snapshot.peds?: number[] (PED_STRIDE = 6 : id,kind,x,z,yaw,st)
// ClientMsg += { type:'game', m: GameClientMsg } : trade | stash | mission | mg | sms_lu   (TOUT champ revalidé côté serveur)
// ServerMsg += { type:'me', s: PrivateState } | { type:'game', e: GameServerEvent }
// PrivateState : money, bag, bagCap, stars, starProgress, district, shop?, stash?, mission?, activity?, marks[≤16], medals, unread
// GameServerEvent : sms | mg_start | mg_end | mission | vignettes | arrete | mort | monde(camsDown) | toast

// shared/api.ts : VRef {id,gen} ; SimVehicle + gen pooled locked livery ai:{input}|null lastHitBy ;
// SimHooks : onInteract canEnter onEnter onVehicleDestroyed onPlayerKilled onShot ;
// Sim : acquireVehicle(type,x,z,yaw,opts) releaseVehicle(v) refOf(v) resolveRef(r) playerPos(p) ; VEHICLE_POOL = { citadine:14, berline:12, camionnette:6, police:10 }

// shared/game.ts : GameEvents (vehicleDestroyed pedKnocked crime playerDied playerBusted enteredVehicle trade minigameDone cameraDestroyed), GameBus on/emit,
// GameCtx { sim, bus, city, mode, sendTo, broadcast, get }, GameSystem { id, preStep?, postStep?, onJoin?, onLeave?, onInteract?, canEnter?, onMessage?, privateView?, serialize?, restore? }
// server/game.ts : installGame(sim, {mode, saved}) ; SYSTEMS = [traffic, peds, police, economy, minigames, missions, activities]
```
Contrats métier (signatures imposées) :
- **camera-driving** : `makeArcadeCar(spec: CarSpec): VehicleDef` (`shared/vehicles/arcade.ts`), `steerTo(pose, target, opts)` (`shared/ai/drive.ts`), `lanesOf/nextLane` (`shared/city/lanes.ts`), `src/camera.ts`.
- **economy** : `unitPrice/quote/rollTip` (`shared/economy/prices.ts`) avec la formule de `DA.md` ; `MarketState { noise, events, camsUp, police }`.
- **missions** : `stepPed` (`shared/peds.ts`, pur), `addCrime/copDestroyed/copsWanted/CRIME_HEAT` (`shared/wanted.ts`), `MissionDef/MissionStep` (`shared/missions/types.ts` : aller, livrer, voler, detruire, semer, minijeu, attendre), 5 missions (une par quartier), médailles bronze/argent/or (temps, dégâts, précision), checkpoints, rejouable. Détruire des voitures de police fait **baisser** l'indice.
- **minigames** : `RULES: Record<MinigameKind, MinigameRule>` (`minMs maxMs cancelDist validate(seed,difficulty,result)`), `createMinigames({send})` côté client. Le serveur valide le résultat (durée minimale plausible, `sid` unique, annulation si éloigné/touché). Entrées souris/clavier uniquement.
- **SaveData v3** : `{ version: 3, players: Record<pseudo, Vec3>, systems: Partial<Record<SystemId, unknown>> }`. Le pool n'est pas sauvegardé.

## 4. Propriétaires de fichiers
| Propriétaire | shared/ | server/ | src/ | tests/ |
|---|---|---|---|---|
| **Intégrateur** (chef, agent general-purpose) | `protocol api ids game sim constants settings registry props guard`, `city/layout.ts`, `city/districts.ts`, `vehicles/index.ts` | `server.ts game.ts commands.ts index.ts` | `main.ts net.ts settings.ts chat.ts audio.ts vehicles/types.ts ui/settingsPanel.ts`, `index.html`, `electron/*` | `smoke robustesse harness charge` |
| **art-toon** | — | — | `gfx scene models fx props projectiles hud markers peds`, `city/cityView.ts`, `vehicles/index.ts` + 4 vues véhicules, `ui/pda.ts` `pda.css` `pda/carte.ts` `pda/sms.ts` `ui/comic.ts` | `captures` |
| **game-camera-driving** | `vehicles/arcade.ts` + 4 véhicules, `city/lanes.ts`, `ai/drive.ts`, `onfoot.ts` | `systems/traffic.ts` | `camera.ts`, `aim.ts` | `conduite trafic` |
| **game-economy** | `economy/{goods,gangs,prices,tips}.ts` | `systems/economy.ts` | `ui/pda/marche.ts`, `ui/shop.ts` | `economie` |
| **game-missions** | `wanted.ts peds.ts activities.ts`, `missions/*` | `systems/{peds,police,missions,activities}.ts` | `ui/pda/missions.ts`, `ui/pda/stats.ts` | `pietons police missions` |
| **game-minigames** | `minigames/rules.ts` | `systems/minigames.ts` | `minigames/*` (index + 8 jeux + sons) | `minijeux` |

Un besoin dans le fichier d'un autre agent passe par une demande à l'intégrateur dans le compte rendu. L'intégrateur crée en vague 1 des **squelettes** typés pour tous les fichiers des spécialistes (corps vides) pour que `tsc` reste vert. Sons via `registerSound`, commandes de debug via `registerCommand` dans le système de chacun.

## 5. Vagues
Règles en parallèle : pas de `npm run build/dist/app` ni electron-builder ; `tsc` filtré sur ses fichiers ; port de test 3100-3999 avec `SAVE_DIR` temporaire ; pas de commit (l'intégrateur valide en fin de vague : `tsc`, `vite build`, tous les tests).
- **Vague 0** purge (§1), intégrateur seul.
- **Vague 1** contrats et fondations, intégrateur seul : `ids/protocol/api/game`, `city/layout+districts`, colliders de la ville dans `sim.ts`, pool + `resolveRef` + `ai.input` + hooks + SaveData v3, `server/game.ts` (bus, `me`, `game`, `peds`, sauvegarde `systems`, reconstruction), `net.onMe/onGame`, extraction `src/camera.ts`, squelettes. Tests : pool stable (`bodies.len()` constant après 10 000 acquire/release), `resolveRef` null après recyclage, aller-retour v3, message `game` malformé sans effet.
- **Vague 2** en parallèle : camera-driving (4 voitures + lanes + `steerTo` + camera.ts), art-toon (cityView, scene, vues véhicules, peds, hud, coquille PDA), economy (données et prix purs), minigames (rules + 3 premiers jeux + système serveur), missions (piétons sur rails + `systems/peds.ts`). Fin : l'intégrateur branche `SYSTEMS`, PDA, cityView, PedsView ; partie à 2 en LAN.
- **Vague 3** systèmes : trafic (≤ 24 civils), police + étoiles + arrestation/mort, économie en jeu (dealers, tuyaux SMS, caméras, `deal_vu`), vol de voiture par mini-jeu, repères/mini-carte/gyrophares. Test de charge : 4 bots, 80 piétons, 24 civils, 10 policiers → < 4 ms moyen, p99 < 10 ms, snapshot < 8 Ko.
- **Vague 4** missions (5), activités (taxi, justicier), équilibrage économie, 5 mini-jeux restants, vignettes BD, réglage du ressenti de conduite.
- **Vague 5** solidité (disjoncteur avec systèmes actifs, sauvegarde, robustesse réseau), mise à jour de `CLAUDE.md`, version 0.4.0, release.

## 6. Risques et budgets
Rapier empoisonné → pool sans retrait, `VRef`, `bodyOk`, `serialize` sans Rapier, disjoncteur. Perf serveur : piétons sans corps, IA à 20 Hz, grille spatiale, plafonds stricts (pool, 80 piétons, 150 débris). Perf client : instanciation par chunk, ≤ 150 appels de dessin. Réseau : delta public + `me` privé, piétons en liste à plat (~3 Ko/snapshot). Triche : tout `GameClientMsg` revalidé, prix et résultats calculés côté serveur.
