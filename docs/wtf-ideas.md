# WTF SIMULATOR : banque d'idées WTF

Idées pour le jeu entre copains. Chaque idée tient dans les contraintes du projet : boîtes, cylindres, sphères et prismes, impulsions, explosions, projectiles et props. Pas de terrain déformable, pas d'eau, pas de modèles complexes, pas d'IA ennemie. Les ids sont en `snake_case`. Dimensions en mètres (L × H × l).

---

## 1. Dix véhicules

Cinq terrestres, cinq aériens. Les cinq obligatoires sont en tête, les cinq inventés suivent.

### 1.1 `tank` : Tank 🛡️
- **Taille** : 4,2 × 1,8 × 2,6 m
- **Couleurs** : vert armée, canon noir, rivets jaunes
- **Commandes** : Z/S avancer et reculer, Q/D pivoter sur place (chenilles). La tourelle et le canon suivent la caméra.
- **Arme** : clic gauche, obus explosif (rayon 5 m). Clic droit maintenu, mitrailleuse coaxiale.
- **Comportement WTF** : le tir fait « pschitt » comme un bouchon de champagne au lieu de « BOUM ». Les props légers sont écrasés au passage des chenilles.
- **Points de vie** : élevés
- **Roquettes** : insensible (0 dégât)

### 1.2 `avion_chasse` : Avion de chasse ✈️
- **Taille** : 8 × 2,6 × 9 m (envergure)
- **Couleurs** : gris acier, bande rouge, verrière bleue
- **Commandes** : Z accélérer, S freiner, flèches haut/bas ou souris pour piquer et cabrer, Q/D roulis. L rentre et sort le train.
- **Arme** : clic gauche, mitrailleuse. Clic droit, missile à tête chercheuse (recharge 4 s).
- **Crash** : si la vitesse d'impact dépasse un seuil (environ 40 m/s), explosion. Sinon, il creuse un sillon en tirets sur le sol.
- **Comportement WTF** : si le train est rentré au sol, l'avion glisse sur le ventre avec un bruit de tôle. Le pilote n'a pas le droit de se vexer.
- **Points de vie** : moyens
- **Roquettes** : sensible (explosion)

### 1.3 `helicoptere` : Hélicoptère 🚁
- **Taille** : 6 × 2,8 × 8 m (pales incluses)
- **Couleurs** : jaune pompier, vitres noires
- **Commandes** : Espace monter, Maj descendre, Z/S avancer et incliner, Q/D lacet
- **Gadget** : clic gauche maintenu, treuil qui accroche une caisse ou un prop et le soulève. Clic droit, largage.
- **Comportement WTF** : le souffle des pales fait voler les chapeaux et les caisses légères autour de lui. Le son « pwop pwop » est volontairement trop fort.
- **Points de vie** : moyens
- **Roquettes** : sensible (dégâts moyens)

### 1.4 `ovni` : Soucoupe volante 🛸
- **Taille** : diamètre 6 m, hauteur 1,8 m
- **Couleurs** : argent, dôme vert fluo, lumières qui clignotent
- **Commandes** : Espace monter, Maj descendre, Z/S/Q/D se déplacer
- **Gadget** : clic gauche maintenu, rayon tracteur qui soulève un prop, une caisse ou un véhicule léger. Clic droit, éjection radiale (impulsion dans toutes les directions).
- **Comportement WTF** : « bloop bloop » à chaque rebond. Il rebondit sur le sol comme une balle de ping-pong.
- **Points de vie** : faibles
- **Roquettes** : très sensible (dégâts doublés)

### 1.5 `camion_articule` : Camion avec remorque articulée 🚚
- **Taille** : 12 × 3,6 × 2,6 m (cabine 3,2 m + remorque 8 m)
- **Couleurs** : cabine rouge, remorque blanche avec un logo de pomme de terre
- **Commandes** : Z/S avancer et reculer, Q/D tourner, H klaxon, la remorque suit par articulation physique
- **Gadget** : clic gauche, largage de la remorque (elle continue en roue libre). Clic droit, ouverture de la benne qui déverse les caisses.
- **Comportement WTF** : klaxon « pouêt-pouêt » en trois tons. Si on freine fort, la remorque fait un tête-à-queue (jackknife) et le camion a l'air de chercher la sortie.
- **Points de vie** : élevés
- **Roquettes** : moyennement sensible (la remorque encaisse, la cabine explose)

### 1.6 `canape_fusee` : Canapé-fusée 🛋️ (aérien)
- **Taille** : 2,4 × 1,2 × 1,1 m
- **Couleurs** : velours bordeaux, coussins jaunes, boosters gris
- **Commandes** : Z propulsion (maintenue = poussée), Q/D rotation sur lui-même, Espace saut « ressort »
- **Gadget** : clic gauche, lancer un coussin (projectile mou, faible impulsion, rebondit). Clic droit, boost turbo de 2 s.
- **Comportement WTF** : à chaque atterrissage il fait « boïoïng » et les coussins ricochent. Le passager reste assis, comme si de rien n'était.
- **Points de vie** : moyens
- **Roquettes** : moyennement sensible (la mousse amortit une partie des dégâts)

### 1.7 `caddie_turbo` : Caddie turbo 🛒
- **Taille** : 1,2 × 1,1 × 0,8 m
- **Couleurs** : métal chromé, panier rouge
- **Commandes** : Z accélérer, S freiner et reculer, Q/D tourner, Espace dérapage (frein à main)
- **Gadget** : clic gauche, klaxon « bip-bip ». Clic droit, turbo de 3 s (recharge 10 s, fumée à l'arrière). Un joueur peut monter debout dans le panier comme passager.
- **Comportement WTF** : chaque collision fait « bip » comme une caisse de supermarché. Les roues crient « iiiiiii » dans les virages.
- **Points de vie** : faibles
- **Roquettes** : très sensible (il s'envole en pièces)

### 1.8 `camion_glaces` : Camion de glaces 🍦
- **Taille** : 4 × 2,6 × 1,9 m
- **Couleurs** : blanc et rose, cornet géant jaune sur le toit
- **Commandes** : Z/S avancer et reculer, Q/D tourner, Espace coupe ou lance la musique
- **Gadget** : clic gauche, lancer un cornet (projectile qui éclate en crème et ralentit la cible de 20 % pendant 3 s). Clic droit, « mode disco » de 8 s : les véhicules légers à moins de 30 m reçoivent une petite impulsion en rythme.
- **Comportement WTF** : jingle synthétisé qui s'entend de loin, comme les moteurs. Le camion ralentit de 2 s dès qu'il « sert » quelqu'un.
- **Points de vie** : moyens
- **Roquettes** : sensible (le frigo explose en crème)

### 1.9 `toilettes_roulettes` : Toilettes à roulettes 🚽
- **Taille** : 1,2 × 1,4 × 0,9 m
- **Couleurs** : porcelaine blanche, couvercle bleu
- **Commandes** : Z/S avancer et reculer lentement (c'est lourd), Q/D tourner
- **Gadget** : clic gauche, ventouse qui colle un prop ou un joueur, puis tirer dessus avec un clic droit. Clic droit, chasse d'eau : grosse impulsion vers l'arrière pendant 1,5 s (recharge 8 s).
- **Comportement WTF** : le couvercle s'ouvre tout seul dans les virages avec un « glou-glou ». Le son de la chasse est volontairement long.
- **Points de vie** : élevés (la porcelaine tient)
- **Roquettes** : sensible (éclats, mais pas de feu)

### 1.10 `dirigeable_pedales` : Dirigeable à pédales 🎈 (aérien)
- **Taille** : ballon de 9 × 3,5 × 3,5 m, nacelle en bois dessous
- **Couleurs** : ballon rayé rouge et crème, nacelle marron
- **Commandes** : Z marteler pour pédaler (plus on tape vite, plus il avance, avec un plafond), Q/D virer, Espace monter
- **Gadget** : clic gauche, lâcher du lest (une caisse lourde, toutes les 8 s). Clic droit, trompette qui fait « brrrt ».
- **Comportement WTF** : il ne peut pas aller plus vite que le joueur qui martèle la touche. Quand il est touché, le ballon siffle « pfffff » et descend en planant au lieu d'exploser.
- **Points de vie** : faibles
- **Roquettes** : très sensible (il se dégonfle lentement, sans explosion)

---

## 2. Trente objets d'inventaire

Les outils de base (pistolet à gravité, gomme, soudure) ne sont pas comptés.

### 2.1 Construction (10)

| Id | Objet | Effet (serveur) | Utilisation | Recharge | Blague |
|---|---|---|---|---|---|
| `planche` | Planche 🪵 | Crée une planche fine (3 × 0,2 × 0,1 m), dynamique et légère | Clic gauche poser, clic droit tourner de 90° | 0,5 s | Chaque pont commence par une planche. Le suivant aussi. |
| `bloc` | Bloc 🧱 | Cube de 1 m, masse moyenne, empilable | Clic gauche poser | 0,3 s | Rien ne tient, mais tout tombe avec style. |
| `rampe` | Rampe 📐 | Prisme incliné à 45°, statique, qui envoie les véhicules en l'air | Clic gauche poser, clic droit tourner | 1 s | Chaque copain a déjà testé la rampe « pour voir ». Ça ne passe jamais. |
| `mur` | Mur 🪨 | Panneau statique de 4 × 2,5 m qui bloque tout | Clic gauche poser | 1,5 s | Le mur ne sert à rien, sauf à être détruit au tank. |
| `pilier` | Pilier 🏛️ | Cylindre statique de 5 m de haut | Clic gauche poser, molette pour la hauteur | 0,8 s | Le pilier est toujours celui que tout le monde pousse. |
| `ballon_flottant` | Ballon flottant 🎈 | Sphère avec une force ascendante constante, monte jusqu'à 15 m et soulève un prop ou un véhicule léger attaché | Clic gauche lâcher le ballon attaché à un objet | 4 s | Une voiture qui flotte, c'est un argument de vente. |
| `trampoline` | Trampoline 🤸 | Plateforme qui renvoie avec une impulsion verticale (la vitesse d'impact est doublée) | Clic gauche poser | 2 s | Le trampoline adore les pelleteuses. Il les envoie en orbite. |
| `barrique_explosive` | Barrique explosive 🛢️ | Cylindre rouge, explose au tir ou à l'impact (rayon 4 m, impulsion, props détruits) | Clic gauche poser, clic droit lancer | 6 s | Posée pour la décoration, elle explose aussi pour la décoration. |
| `roue_geante` | Roue géante 🎡 | Cylindre qui tourne à vitesse constante et fait tourner tout ce qui touche son bord | Clic gauche poser, clic droit inverser le sens | 8 s | Un manège sans prévenir : même le plus fier des chauffeurs finit à l'envers. |
| `propulseur` | Propulseur 🚀 | Petit cylindre fixe qui pousse en continu les props proches pendant 10 s dans la direction choisie | Clic gauche poser, molette pour l'orientation | 3 s | Un réacteur de baignoire, ça pousse plus que prévu. |

### 2.2 Armes (6)

| Id | Objet | Effet (serveur) | Utilisation | Recharge | Blague |
|---|---|---|---|---|---|
| `lance_roquettes` | Lance-roquettes 🎯 | Projectile explosif, explosion de 6 m, forte impulsion, dégâts aux véhicules | Clic gauche tirer | 3 s | Le mode d'emploi tient en un mot : BOUM. |
| `grenade` | Grenade à fragments 💣 | Projectile à rebonds, explose après 3 s, impulsion faible | Clic gauche lancer, clic droit lancer en cloche | 2 s | Elle explose trois secondes après que tout le monde a eu le temps de dire « attends ». |
| `mitraillette` | Mitraillette 🔫 | Rafales de projectiles légers, faibles dégâts, pas d'impulsion. Chargeur de 30 balles, 2 s de rechargement | Clic gauche maintenu (rafale), clic droit tir unique | 0 s (rechargement 2 s) | Elle fait « tatatatata » comme une machine à coudre, ce qui la rend beaucoup moins menaçante. |
| `mine_collante` | Mine collante 🪤 | Sphère posée au sol, explose au contact du premier véhicule ou joueur (rayon 3 m) et colle la cible 2 s | Clic gauche poser | 5 s | Elle colle surtout à celui qui l'a posée. |
| `fusil_ventouses` | Fusil à ventouses 🪝 | Projectile qui se fixe sur un prop ou un véhicule, puis tire la cible vers soi (traction) | Clic gauche tirer, clic droit relâcher le câble | 4 s | Une ventouse sur une voiture, c'est un câlin qui n'a rien demandé. |
| `lance_tomates` | Lance-tomates 🍅 | Projectile qui éclabousse : pas de dégâts, mais l'écran de la cible se couvre de rouge 3 s et elle ralentit de 20 % | Clic gauche lancer | 1 s | Le pare-brise est toujours plus drôle quand il est rouge. |

### 2.3 Objets WTF (9)

| Id | Objet | Effet (serveur) | Utilisation | Recharge | Blague |
|---|---|---|---|---|---|
| `canon_confettis` | Canon à confettis 🎉 | Projectile léger ; à l'impact, 300 confettis (particules) et petite impulsion sur les props légers | Clic gauche tirer, clic droit éventail | 3 s | Personne ne voit plus rien, mais tout le monde sourit. |
| `bombe_poulets` | Bombe à poulets 🐔 | À l'impact, libère 12 poulets-cubes jaunes qui courent au hasard pendant 15 s et bousculent légèrement les joueurs | Clic gauche lancer | 6 s | Les poulets ne font pas de dégâts. Ils font de la poussière de dignité. |
| `canne_vaches` | Canne à pêche à vaches 🐄 | Fil qui accroche un prop ou un joueur jusqu'à 25 m et le tire vers soi. La vache-cube suit au bout du fil | Clic gauche maintenu pour lancer, relâcher pour ramener | 2 s | Pêcher une vache, personne n'avait eu l'idée avant. |
| `chaussures_ressorts` | Chaussures à ressorts 👟 | Pendant 20 s : saut ×2 et double saut. À l'atterrissage, petite onde de choc qui renverse les props légers | Espace pour sauter (équipées depuis l'inventaire) | 40 s | On les met une fois et on se sent balle de ping-pong pendant 20 s. |
| `super_aimant` | Super-aimant 🧲 | Pendant 6 s, attire les props dynamiques et les véhicules légers vers le point visé (force selon la distance) | Clic gauche maintenu pour viser, clic droit repousser | 10 s | Il attire les clés, les caisses et le chat. |
| `trompette_tornade` | Trompette-tornade 🎺 | Cône de vent horizontal, impulsion progressive pendant 6 s : pousse props et joueurs | Clic gauche maintenu pour souffler | 8 s | Une trompette qui ne joue pas, mais qui souffle fort. |
| `champignon_retrecisseur` | Champignon rétrécisseur 🍄 | Lancé, il se pose ; dans un rayon de 5 m, les joueurs passent à 60 % de leur taille pendant 15 s (caméra et collisions réduites) | Clic gauche lancer | 12 s | Tout le monde adore être minuscule pendant 15 secondes, surtout les géants qui viennent d'écraser le copain. |
| `pasteque_bombe` | Pastèque-bombe 🍉 | Sphère lourde ; à l'impact, elle éclate en six tranches-sphères qui rebondissent pendant 5 s | Clic gauche lancer | 7 s | Rien ne fait plus d'effet qu'une pastèque qui s'ouvre au mauvais moment. |
| `ventilateur_portatif` | Ventilateur portatif 🌀 | Flux ascendant léger tant qu'on le tient : fait voler les props légers et les joueurs (saut ×1,5) | Clic gauche maintenu, molette pour changer la direction | Batterie 10 s, recharge 4 s | Il fait voler les chapeaux, les caisses et la dignité. |

### 2.4 Mobilité (5)

| Id | Objet | Effet (serveur) | Utilisation | Recharge | Blague |
|---|---|---|---|---|---|
| `jetpack` | Jetpack 🧑‍🚀 | Poussée verticale et avant pendant 8 s, puis surchauffe de 3 s | Espace maintenu pour monter, Z/S pour avancer, clic droit pour couper | Réservoir plein en 10 s au sol | Un jetpack coûte un réservoir et beaucoup d'orgueil. |
| `grappin` | Grappin 🪝 | Crochet jusqu'à 30 m : s'il accroche (prop, sol, mur), tire le joueur vers le point à grande vitesse | Clic gauche lancer, clic droit lâcher | 1 s | Le plus court chemin pour rejoindre le copain qui vient de passer la barrière. |
| `parachute` | Parachute 🪂 | Vitesse de chute divisée par 4 tant qu'il est ouvert | Clic droit maintenu pour ouvrir, relâcher pour refermer | 15 s | On tombe lentement, avec le sourire, pendant que le copain atterrit dans la caisse. |
| `bottes_gravite` | Bottes de gravité réduite 👢 | Gravité ×0,4 pour le porteur pendant 20 s : sauts énormes, temps en l'air doublé | Espace pour sauter (équipées depuis l'inventaire) | 30 s | Le premier pas sur la Lune, version salon. |
| `teleporteur` | Téléporteur 📍 | Clic gauche pose une balise (reste 60 s). Clic droit téléporte le joueur sur la balise, à 30 m maximum | Clic gauche poser, clic droit se téléporter | 10 s | Il n'arrive jamais là où on voulait, mais toujours avant le copain. |

---

## 3. Dix événements chaos

Déclenchables au hasard ou via la commande `/meteo`. Chaque annonce s'affiche dans le chat.

| Id | Nom | Effet | Durée | Annonce dans le chat |
|---|---|---|---|---|
| `pluie_de_caisses` | Pluie de caisses | Des caisses tombent du ciel dans un rayon de 40 m autour de chaque joueur | 20 s | ☔ « Il pleut des caisses ! Ouvrez les parapluies (vous n'en avez pas). » |
| `gravite_lunaire` | Gravité lunaire | Gravité ×0,3 pour tout le monde : sauts énormes, chutes lentes | 30 s | 🌙 « Bienvenue sur la Lune. Ne vous cognez pas au plafond. » |
| `klaxons_hurlants` | Klaxons hurlants | Tous les véhicules klaxonnent toutes les 2 s | 20 s | 📯 « Les klaxons font grève de la discrétion. » |
| `sol_glissant` | Sol glissant | Friction du sol divisée par 10 pour tous | 25 s | 🧊 « Le sol est une patinoire. Bonne chance pour la marche arrière. » |
| `mini_boss` | Gnome géant | Gros cylindre trois fois plus grand, PV élevés. Sans IA : une impulsion vers le joueur le plus proche toutes les 5 s. Il laisse 3 caisses à sa destruction | 60 s ou jusqu'à destruction | 👹 « Un gnome géant vient de sortir de terre. Il n'a pas l'air content. » |
| `tremblement` | Tremblement de terre | Secousse aléatoire : les props légers sautent, les véhicules reçoivent de petites impulsions | 15 s | 🌋 « Ça tremble ! Le chat a déjà fait sa valise. » |
| `aimant_geant` | Aimant géant | Tout objet dynamique léger est attiré vers un point du monde | 20 s | 🧲 « Tout le monde se fait aspirer vers le centre. Pas de panique, c'est la physique. » |
| `party_generale` | Party générale | Confettis, klaxons et sauts améliorés (saut ×1,3) pour tous | 15 s | 🎉 « C'est la fête ! Personne n'a demandé la permission. » |
| `touches_inversees` | Touches inversées | Côté serveur, Q et D sont échangés pour un joueur tiré au sort | 20 s | 🔀 « @pseudo a les mains à l'envers. Bonne chance. » |
| `vent_violent` | Vent violent | Poussée horizontale constante sur tous les objets légers et les joueurs | 20 s | 💨 « Vent de face ! Les chapeaux s'envolent, les vaches aussi. » |

---

## 4. Modes de jeu entre copains

### 4.1 Coopération

**Pont de la honte**
- **Règles** : l'équipe dispose d'un stock commun de planches et a 10 minutes pour construire un pont. Ensuite, chacun traverse en véhicule jusqu'à la zone d'arrivée.
- **Score** : nombre de véhicules arrivés sans tomber, bonus de temps.
- **Côté serveur** : un compteur de planches partagé par l'équipe, une zone d'arrivée (boîte invisible), un chronomètre de manche, la détection de chute d'un véhicule (hors de la zone du pont).

**Convoi à escorter**
- **Règles** : un camion-remorque doit rouler jusqu'au point B. Les autres véhicules le protègent. Le convoi a une barre de PV partagée.
- **Score** : temps d'arrivée et PV restants.
- **Côté serveur** : un véhicule « convoi » avec PV partagés, une liste de points de passage, la fin de manche si les PV tombent à zéro.

**Relais de véhicules**
- **Règles** : chacun fait un tour de circuit avec un véhicule différent. Le relais est une sphère « passe-témoin » qu'on touche à la fin de chaque tour.
- **Score** : temps total de l'équipe.
- **Côté serveur** : des checkpoints ordonnés, un prop passe-témoin transféré au coéquipier suivant, un temps par joueur.

### 4.2 Combat

**Roi de la colline en véhicules**
- **Règles** : une colline au centre de l'arène. Un véhicule à l'intérieur de la zone gagne 1 point par seconde. Premier à 100 points.
- **Score** : points de zone.
- **Côté serveur** : une zone circulaire autour de la colline, un score par joueur, un tirage de la prochaine colline après chaque manche.

**Démolition derby**
- **Règles** : chacun a un véhicule. Le dernier debout gagne. Un véhicule détruit revient après 5 s.
- **Score** : dégâts infligés (PV retirés aux véhicules adverses).
- **Côté serveur** : PV par véhicule, attribution du dernier attaquant, liste des éliminations, respawn après 5 s.

**Bataille de roquettes**
- **Règles** : arène fermée, munitions à ramasser dans les caisses jaunes. Un point par élimination, respawn après 3 s.
- **Score** : éliminations.
- **Côté serveur** : dernier attaquant par cible, apparition de caisses de munitions à intervalles, respawn, compteur par joueur.

---

## 5. Commandes de chat et easter eggs

### 5.1 Commandes de chat

| Commande | Effet | Qui |
|---|---|---|
| `/spawn <objet> [quantité]` | Fait apparaître un objet ou un véhicule devant soi | Hôte |
| `/tp <pseudo>` | Téléporte vers un copain (« tu te rends où là ») | Tous |
| `/gravite <valeur>` | Change la gravité pour tout le monde. `0` = apesanteur, `3` = trampoline géant | Hôte |
| `/party` | Déclenche `party_generale` | Tous |
| `/taille <pseudo> <valeur>` | Agrandit ou rétrécit un joueur (0,5 à 3) | Hôte |
| `/klaxon` | Tous les véhicules klaxonnent | Tous |
| `/meteo <evenement>` | Lance un événement chaos (ex : `/meteo vent_violent`) | Hôte |
| `/miaou` | Fait miauler le personnage à chaque pas pendant 10 s | Tous |
| `/reset oui` | Remet le monde à zéro (il faut confirmer avec `oui`) | Hôte |
| `/annonce <texte>` | Affiche un texte géant au centre de l'écran avec une fanfare | Hôte |

Les commandes passent par le même anti-spam que le chat : 5 messages par 5 secondes.

### 5.2 Easter eggs cachés

Les positions sont fixes et générées à partir de la graine du monde, comme les caisses et les arbres.

1. **La vache sur le toit** : une vache-cube posée au sommet d'un immeuble de caisses. La pousser la fait « meuh » trois fois, puis une caisse dorée apparaît.
2. **Le panneau « ICI RIEN »** : à la lisière du monde. En l'approchant, il affiche « Vraiment, rien. » et lance un petit feu d'artifice.
3. **Le bouton rouge « NE PAS APPUYER »** : une caisse avec un bouton. Appuyer déclenche un événement chaos au hasard.
4. **Le cercle de pierres** : des sphères grises disposées au centre du monde. Quatre joueurs debout dans le cercle font tourner tous les véhicules autour d'eux.
5. **L'arbre à trois troncs** : un arbre dont les feuilles sont des sphères vert fluo, avec une caisse cachée derrière.
6. **Le piano-caisse** : une boîte noire et blanche. La frapper joue cinq notes au hasard (synthèse Web Audio).
7. **La pelleteuse du bout du monde** : une pelleteuse garée à 800 m, immobile. La monter affiche dans le chat : « Tu as trouvé la pelleteuse du bout du monde. »
8. **La caisse qui chante** : une caisse qui joue une petite mélodie synthétisée quand on la casse.
9. **Le pilier-sommet** : un pilier de 300 m avec un cube doré tout en haut. Y arriver affiche « Tu as touché le ciel. »
10. **Le canard géant** : une sphère jaune posée au loin. La toucher fait « COIN COIN » et donne 3 s de vitesse +20 % à tous les joueurs proches.

---

## 6. Idées de décor

| Décor | Ce qu'on y construit | Ce qu'on y fait |
|---|---|---|
| **Piste de cascade** | Rampes, trampolines, cerceaux à traverser, plateformes de saut | Sauts, figures (rotations), distance. Score par figure. |
| **Piste d'atterrissage** | Bande d'asphalte (boîte plate), anneau cible au sol | Poser avion, hélico ou OVNI le plus près possible du centre. Score de précision. |
| **Ville miniature** | Immeubles en caisses et cylindres empilés, rues en planches | Tout démolir au tank, au camion ou à la barrique explosive. Concours de la plus belle destruction. |
| **Parcours d'obstacles** | Tunnels, pendules (sphères suspendues), murs à franchir, rampes | Course à pied ou en véhicule, chronomètre. |
| **Arène de démolition** | Cercle de murs, sol plat, caisses de munitions | Accueille les modes combat (4.2) : derby et bataille de roquettes. |
| **Pont suspendu** | Planches reliées par des câbles (contraintes), deux piles | Mode « Pont de la honte » (4.1), à traverser ou à faire tomber. |
| **Parking de supermarché** | Lignes de places (planches au sol), caddies, grand toit plat | Course de caddies turbo, drift, « bip » à chaque collision. |
| **Château de caisses** | Forteresse en caisses avec donjon-coffre au centre | Mode siège : camion bélier, pelleteuse catapulte, mines collantes pour les défenseurs. |

---

## Synthèse

- 10 véhicules (5 terrestres, 5 aériens), dont tank, avion de chasse, hélicoptère, OVNI et camion articulé.
- 30 objets : 10 construction, 6 armes, 9 WTF, 5 mobilité.
- 10 événements chaos, 6 modes de jeu (3 coop, 3 combat), 10 commandes de chat, 10 easter eggs, 8 décors.
- Tout reste dans les contraintes : boîtes, sphères, cylindres, prismes, impulsions côté serveur, aucune IA ennemie.
- Idées à valider en priorité : camion articulé et caddie turbo (le plus simples), puis canne à vaches et dirigeable (les plus WTF).
