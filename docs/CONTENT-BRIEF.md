# Briefing commun des équipes de contenu (véhicules, objets, décor)

Lis **dans l'ordre** : `docs/ARCHITECTURE.md` (règles d'or, contrats), `docs/wtf-ideas.md` (le cahier des idées, ta section), `shared/api.ts` + `shared/protocol.ts` + `shared/props.ts`, puis les exemples réels : `shared/vehicles/car.ts`, `shared/vehicles/excavator.ts`, `src/vehicles/types.ts`, `src/vehicles/car.ts`, `src/vehicles/excavator.ts`, `shared/packs/core.ts` (objets existants : physgun/remover/welder), `src/audio.ts` (sons disponibles), `src/fx.ts`, `src/projectiles.ts`, `tests/harness.ts`.

## Ce qui est déjà fait (ne le refais pas)
Le cœur serveur (`shared/sim.ts` : dégâts, chocs, explosions, projectiles, props, physgun, sauvegarde, commandes de chat) et le cœur client (rendu des props/projectiles/fx, HUD, inventaire, contrôles, audio) existent et fonctionnent. **Tu n'édites ni `shared/sim.ts`, ni `src/main.ts`, ni les fichiers contrats.** Si tu as besoin d'une capacité du cœur qui manque (nouvelle fonction `SimApi`, nouveau son, nouvel effet…) : contourne-la dans ton fichier si possible, sinon note-la précisément dans ton compte rendu (le chef d'équipe l'ajoutera).

## Qualité attendue (le jeu doit être SUPER marrant et beau)
- **Cartoon poussé** : primitives colorées avec contours noirs (`box()`, `outlined()`, `toon()` de `src/gfx.ts`), détails (phares, vitres, antennes, rivets, roues, pales, flammes, cornet géant…), animations (roues, hélices, tourelles, clignotants, ressorts, flammes de réacteur). Pas de modèle « boîte grise » : chaque véhicule doit se reconnaître au premier coup d'œil et être drôle à regarder.
- **Jouable** : arcade, pardonnant, réactif ; un joueur qui n'a jamais vu le jeu doit comprendre en 10 s. Jamais de véhicule qui explose tout seul au spawn, qui se retourne sans possibilité de repartir, qui part dans l'espace, ou qui bloque le serveur.
- **WTF** : chaque véhicule/objet a son gag (son ridicule, comportement absurde). Va plus loin que la fiche si tu as une bonne idée, sans casser la jouabilité.
- Tout le texte visible en français.

## Tests (obligatoires, fais-les vraiment et **regarde les résultats**)
1. **Types** : `npx tsc --noEmit 2>&1 | grep -E "tes/fichiers"` sans erreur dans tes fichiers (d'autres équipes travaillent en même temps ; ignore leurs erreurs).
2. **Physique sans rendu** : `npx tsx tests/harness.ts <type> <scénario> [secondes]` (scénarios `avance`, `virage`, `tir`, `crash`) et ta propre fonction `driveScenario(...)` pour vérifier : accélération, virage, freinage, saut/vol, tirs, dégâts, explosion (crash ou roquette), réapparition, sortie du véhicule. Écris tes vérifications dans `tests/<ton-nom>.ts` (PASS/FAIL, lançable avec `npx tsx tests/<ton-nom>.ts`).
3. **Rendu réel (captures)** : lance TON serveur et TON client sur tes ports (voir ton prompt) :
   - serveur : `PORT=<N> SAVE_DIR=<dossier temporaire à toi> npx tsx server/index.ts` (en arrière-plan)
   - client : `SERVER_PORT=<N> npx vite --port <N+1000>` (en arrière-plan)
   - capture : `"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=9000 --window-size=1000,600 --screenshot=<fichier>.png "http://localhost:<N+1000>/?name=Bot&cmd=/drive%20<type>"` (le client rejoint seul et envoie la commande `/drive <type>` qui le met dans le véhicule). Ouvre l'image avec l'outil Read et **juge-la** : modèle reconnaissable ? proportions ? contours ? caméra correcte (on voit tout le véhicule) ? Corrige et recommence jusqu'à ce que ce soit beau et lisible. Pour voir un objet d'inventaire en action, utilise `cmd=/give <id>` si la commande existe, sinon décris le test.
   - Nettoie ensuite **tes** processus (retrouve tes pid ; ne tue pas ceux des autres agents), supprime ton dossier temporaire.
4. Ne lance jamais deux navigateurs Chrome en même temps (la machine est partagée avec d'autres agents) et garde les tests courts.

## Compte rendu final (≤ 15 lignes)
Ce qui est livré (liste), ce qui a été testé et comment, ce qui reste imparfait, et les **demandes au cœur** (capacités manquantes) précises.
