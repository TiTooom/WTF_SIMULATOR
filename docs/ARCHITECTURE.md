# WTF SIMULATOR — architecture v2 (document de référence de l'équipe)

Bac à sable 3D multijoueur entre copains. Serveur **autoritaire** (Node + Rapier) + client Three.js. Rendu cartoon sans assets : boîtes, cylindres, sphères, prismes colorés avec **contours noirs**. Tout le texte visible est en **français**.

## Règles d'or
1. **Les fichiers contrats ne changent pas sans nécessité** : `shared/protocol.ts`, `shared/api.ts`, `shared/props.ts`, `shared/settings.ts`. Si tu as VRAIMENT besoin d'un changement, fais-le de façon **additive** (nouveau champ optionnel) et signale-le dans ton compte rendu.
2. **Chacun édite ses fichiers.** Tu ne modifies pas le fichier d'un autre agent. Plusieurs agents travaillent en même temps dans le même dossier : si `tsc` signale des erreurs dans des fichiers qui ne sont pas à toi, ignore-les (filtre : `npx tsc --noEmit 2>&1 | grep -E "tes/fichiers"`).
3. **N'exécute jamais** `npm run build`, `npm run dist`, `npm run app`, ni `electron-builder` (ils écrasent `dist/` et plantent les autres agents). N'installe pas de dépendances.
4. **Ports isolés pour tes tests** : prends un numéro `N` entre 3100 et 3999 (ex : dérivé du nom de ta tâche) et utilise `PORT=N SAVE_DIR=<dossier temporaire à toi> npx tsx server/index.ts` (serveur), `SERVER_PORT=N npx vite --port N+1000` (client en dev), Chrome headless pour les captures. Nettoie tes processus (`Get-Process`/`Stop-Process` sur TES pid) à la fin. **Ne touche jamais** `%APPDATA%\WTF SIMULATOR` (sauvegardes réelles du joueur).
5. **Ne jamais** supprimer ni écraser des fichiers hors de ton périmètre. Pas de `git commit`/`git push` : le chef d'équipe s'en charge.
6. **Jeu drôle avant tout** : en cas de doute entre réaliste et marrant, choisis marrant. Mais **jouable** : pas de crash serveur, pas d'écran noir, pas de véhicule impossible à piloter.

## Carte du code
- `shared/protocol.ts` — messages réseau (Input v2 : visée, boutons souris, gaz, lacet, klaxon, objet sélectionné, molette ; Snapshot : players/vehicles/props/proj/fx).
- `shared/api.ts` — **contrat d'extension** : `SimApi` (ce que le serveur offre), `VehicleDef`/`VehicleBehavior`, `ItemDef`/`ItemHandler`/`UseCtx`, `Pack`, groupes de collision `G`/`grp()`.
- `shared/props.ts` — `PropKind` (props décrits par des données : forme, taille, couleur, masse, rebond, gravité, explosif…), `wedgeVertices()` (rampes).
- `shared/registry.ts` — agrège les paquets (`shared/packs/*.ts`) : `ITEMS`, `HANDLERS`, `PROP_KINDS`, `DEFAULT_HOTBAR`.
- `shared/vehicles/index.ts` — registre des véhicules (`VEHICLES`, un fichier par type : `shared/vehicles/<type>.ts` côté serveur, `src/vehicles/<type>.ts` côté client).
- `shared/sim.ts` — simulation (cœur). Implémente `SimApi`. **Appartient à l'agent « cœur serveur ».**
- `server/server.ts` — HTTP + WebSocket + boucle + sauvegarde + chat + commandes de chat.
- `src/` — client : `main.ts` (boucle), `net.ts`, `vehicles/*` (modèles + caméra + aide), `props.ts` (dessin des props), `fx.ts` (effets), `hud.ts` (barre d'objets, vie, viseur), `inventory.ts`, `audio.ts`, `chat.ts`, `ui/settingsPanel.ts`.

## Contrats de contenu

### Un véhicule = 2 fichiers
- **Serveur** `shared/vehicles/<type>.ts` : `export const def: VehicleDef`. `create()` construit les corps Rapier (châssis dynamique avec `enabledRotations` adaptées, colliders via `api.sliding(...)` pour les véhicules au sol, groupes `grp(G.VEHICLE)`) et retourne un `VehicleBehavior` : `step(ctx)` lit `ctx.input` (voir Input) et applique des forces/impulsions ; `anim()` renvoie `{sp, st, a[]}` ; `dispose()` retire tous les corps.
  - Au sol : utilise `api.driveArcade()` ou ta propre logique. Avions/hélico/OVNI : rotations libres, forces de portance/poussée arcade, stabilisation douce (le but est de s'amuser, pas de simuler).
  - Armes : `api.spawnProjectile(...)` ; visée via `ctx.input.ad/ao` (direction de la caméra) ; cadence gérée par le véhicule.
  - Dégâts/explosions/blindage : gérés par le cœur à partir de `def.maxHp`, `def.armor`, `def.impact`. Un avion explose à l'impact grâce à `impact.threshold` bas et `impact.scale` fort (ou `onImpact`).
  - Passagers : `def.seats`.
- **Client** `src/vehicles/<type>.ts` : `export const view: VehicleViewDef` (voir `src/vehicles/types.ts`) : `build()` → `{group, update(snap, dt)}` (modèle en primitives avec contours, utilise `box()` et `outlined()` de `src/gfx.ts`), `cam: {height, distance, pitch}`, `hud(snap, L)` (texte d'aide, `L('forward')` = nom de la touche), `engine`: paramètres du son moteur.
  - L'avant du véhicule est **−z**. Hauteur du sol = y=0. Le châssis physique est centré sur le corps Rapier.

### Un objet d'inventaire = une entrée de paquet
`shared/packs/<paquet>.ts` exporte `pack: Pack` : `items` (ItemDef), `props` (PropKind créés par les objets), `handlers` (id → `{use, tick, holster}`). Les handlers utilisent uniquement `UseCtx`/`SimApi`. Effets visuels : `api.fx({k:'boom'|'confetti'|'text'|'ring'|'spark'|'smoke'|'flash'|'sound'|'beam', p, ...})`. Projectiles : `api.spawnProjectile`. Effets temporaires sur le joueur : `api.applyMod`.
- **Paquets** : `core` (outils : pistolet à gravité, gomme, soudure), `build` (10 objets de construction), `weapons` (6), `wtf` (9), `move` (5). 30 objets + 3 outils.
- Les `props` d'un paquet sont dessinés par le client à partir des données (`PropKind`) : **pas de code client** pour un objet qui ne crée que des props/projectiles/fx génériques. Besoin d'un visuel spécial (apparence de projectile, effet) → l'ajouter dans `src/fx.ts` / `src/projectiles.ts` si ces fichiers existent, sinon le dire dans le compte rendu.

### Effets visuels (`FxEvent.k`)
`boom` (a = rayon) · `smoke` · `spark` · `confetti` (c = couleur) · `text` (s = texte flottant) · `ring` (onde de choc) · `flash` · `sound` (s = nom : `horn_*`, `boing`, `pop`, `zap`, `whoosh`…) · `beam` (p → t, rayon) · `shake` (a = intensité). Le client ignore silencieusement les kinds inconnus.

## Physique et dégâts (cœur)
- Pas fixe 1/60, snapshots 30 Hz. Chocs : Δv par pas > `def.impact.threshold` → dégâts. PV à 0 → explosion + débris + réapparition au point d'origine après ~12 s. Joueur : 100 PV, réapparition immédiate avec annonce drôle dans le chat.
- Explosions : impulsion radiale (props, véhicules, joueurs), dégâts avec atténuation par distance, multipliés par `armor.explosion` du véhicule.
- Props explosifs (`PropKind.explosive`), props destructibles (`hp`).
- Pistolet à gravité (physgun) : saisit prop/véhicule vide/joueur visé (m1 maintenu), molette = distance, m2 = geler/dégeler, relâcher = lancer avec la vitesse courante.

## Commandes de chat (serveur)
`/spawn <type>` crée un véhicule devant soi · `/drive <type>` monte dans (ou crée puis monte dans) un véhicule de ce type · `/tp <type>` se téléporte à côté · `/clear` supprime ses props · `/gravite <valeur>` · `/help`. D'autres peuvent être ajoutées par les équipes dans `server/commands.ts`.

## Test automatisé
- URL de jeu : `http://localhost:<port>/?name=Bot&cmd=/drive%20tank` → le client rejoint seul, envoie la commande de chat après la connexion (utile pour les captures d'écran de véhicules).
- Harnais physique sans rendu : `tests/harness.ts` (créé par le cœur serveur) pour piloter un véhicule avec des entrées scriptées et afficher sa télémétrie.
- Capture : `chrome.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=9000 --window-size=1000,600 --screenshot=<fichier>.png <url>`.

## Contenu à produire (identifiants définitifs — idées détaillées dans docs/wtf-ideas.md)

**Véhicules** (ordre du registre `shared/vehicles/index.ts`) : `car`, `excavator` (existants, à porter dans le nouveau système) puis les 10 nouveaux : `tank` (insensible aux roquettes, canon qui suit la caméra), `camion_articule` (remorque articulée), `caddie_turbo`, `camion_glaces`, `toilettes_roulettes`, `avion_chasse`, `helicoptere`, `ovni`, `canape_fusee`, `dirigeable_pedales`. `VehicleSnap.type` est l'identifiant ci-dessus.

**Paquets d'objets** (ids dans `shared/packs/<paquet>.ts`) :
- `core` : `physgun` (pistolet à gravité), `remover` (gomme), `welder` (soudure).
- `build` : `planche`, `bloc`, `rampe`, `mur`, `pilier`, `ballon_flottant`, `trampoline`, `barrique_explosive`, `roue_geante`, `propulseur`.
- `weapons` : `lance_roquettes`, `grenade`, `mitraillette`, `mine_collante`, `fusil_ventouses`, `lance_tomates`.
- `wtf` : `canon_confettis`, `bombe_poulets`, `canne_vaches`, `chaussures_ressorts`, `super_aimant`, `trompette_tornade`, `champignon_retrecisseur`, `pasteque_bombe`, `ventilateur_portatif`.
- `move` : `jetpack`, `grappin`, `parachute`, `bottes_gravite`, `teleporteur`.

**Autres** : événements chaos + commandes de chat + modes (`server/events.ts`, `server/commands.ts`, `server/modes.ts`), décor + easter eggs (`shared/world.ts`, `src/scene.ts`).

**Touches** (Input v2) : `f`/`s` = avant-arrière / droite-gauche (WASD) ; `th` = gaz/altitude (Maj+/Ctrl) ; `yw` = lacet (Z/C physiques) ; `hn` = klaxon / action spéciale (H) ; `jump` (Espace) = frein à main/turbo en véhicule ; `m1`/`m2` = clic gauche/droit ; molette = zoom en véhicule, distance du pistolet à gravité, sinon changement d'emplacement de la barre ; chiffres 1-9 = emplacements ; Tab = inventaire. Convention aéronefs : `f` positif = piquer, négatif = cabrer ; `s` = roulis.

## Précisions du cœur serveur (additif)
- **`power` d'une explosion** ≈ vitesse (m/s) donnée au centre à un objet léger : Δv = power × atténuation / (1 + masse/400). Valeurs typiques 12–25. `damage` = dégâts au centre (décroissants, × `armor.explosion`).
- **Chocs** : Δv linéaire d'un pas moins la gravité ; `SimVehicle.noImpactUntil?` (ms, optionnel) désactive la détection (utilisé par le pistolet à gravité). Un véhicule a 1,5 s de grâce après création/réapparition.
- **`SimPlayer.scratch`** (clés utilisées par le cœur) : `kb: [vx, vz]` = élan horizontal (explosions, lancer), `heldUntil: ms` = joueur tenu par le pistolet à gravité (la marche est suspendue).
- **Projectiles** : `Snapshot.proj[i*8+1]` = index dans `PROJECTILE_KINDS` (`shared/constants.ts`, ajouter à la fin) ; kind inconnu = `PROJECTILE_KINDS.length` (apparence générique).
- **Commandes** : `import { registerCommand } from './commands'` puis `registerCommand('party', ({ sim, player, args, reply, announce }) => …, '/party : aide')`. `reply` = message privé, `announce` = chat public.
- **/spawn** : véhicules « extra » (12 vivants max) ; ils se sauvegardent tant qu'ils sont en vie, ne réapparaissent pas quand détruits (leur emplacement d'index est réutilisé pour le même type).
- **Sauvegarde v2** : props (id de kind, pose, gelé), véhicules par type + rang (n-ième véhicule de ce type), `state()/restore()`. Les soudures ne sont pas sauvegardées. Une sauvegarde v1 est ignorée.
- **Décor** : `shared/world.ts` peut exporter `buildWorld(sim: Sim)` (import dynamique, ignoré s'il est absent). Attention : dans le serveur empaqueté par esbuild, l'import dynamique n'est pas inclus : ajouter alors un import statique dans `shared/sim.ts`.
- **Harnais** : `npx tsx tests/harness.ts <type> [avance|virage|tir|crash] [secondes]` · `npx tsx tests/smoke.ts` (vérifications PASS/FAIL).
