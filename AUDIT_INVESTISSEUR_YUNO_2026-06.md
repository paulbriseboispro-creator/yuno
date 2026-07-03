# Audit investisseur — Yuno

**Panel simulé :** Partner McKinsey · Investisseur Sequoia · CEO marketplace >1 Md€ · ex-Head of Product Stripe · spécialiste marketplaces (Uber/Airbnb/Deliveroo) · expert Growth B2B SaaS · CFO startups · CTO SaaS · expert UX mobile · psychologue conso · exploitant clubs/bars 20 ans.

**Date :** 2026-06-29 · **Méthode :** 17 agents IA indépendants, ancrés dans le code réel du dépôt (189 pages, 94 edge functions, 495 migrations). Audit adversarial : chaque expert raisonne seul, un red-team cherche activement les causes d'échec.

> ⚠️ **Avertissement de cadrage.** Ce rapport juge l'état RÉEL de Yuno (multi-faces, 3 piliers, 6+ rôles, **non déployé, zéro test, zéro client, zéro revenu**), pas le « MVP commande de boissons » décrit dans le brief. L'écart entre les deux est lui-même le constat central.

---

## Note de cadrage — « En MVP ça n'existe pas dans la nuit, il faut du solide »

Le fondateur précise : il n'a pas voulu un MVP bricolé parce que la nuit ne pardonne pas un produit fragile. **C'est juste sur l'axe FIABILITÉ, et c'est le mauvais axe qui a guidé la construction.**

La nuit est l'environnement le plus impitoyable de l'hospitality : un paiement qui échoue ou un QR qui ne scanne pas au pic à 1h du matin, et le staff abandonne l'outil pour toujours puis le dit à tous les autres patrons. Donc oui : « du solide dès le départ » est une exigence réelle.

Mais **solide ≠ large.** Ce sont deux axes distincts :

| | **Étroit (1 flow)** | **Large (3 piliers, 6 rôles)** |
|---|---|---|
| **Solide** (fiable, durci, testé, déployé) | ✅ Le bon quadrant pour lancer dans la nuit | Réservé aux boîtes financées avec une équipe |
| **Fragile** (zéro test, non validé, non déployé) | Acceptable pour un prototype jetable | ❌ **Là où Yuno est aujourd'hui** |

189 pages + 94 edge functions **sans un seul test automatisé et non déployées** ne sont pas « solides » : c'est *large et fragile* — précisément le quadrant que l'argument du fondateur condamne. Chaque surface ajoutée a dilué le budget de durcissement que « solide » réclame.

**Reformulation retenue par le panel :** dans la nuit, le MVP n'est pas « minimum de fonctionnalités », c'est **« minimum de surface, maximum de durcissement »**. L'instinct du fondateur (il faut du solide) est bon ; il justifie de *concentrer* la solidité sur une flow bulletproof testée dans un vrai club, pas de l'*étaler* sur dix flows plausibles. C'est le fil directeur du plan 90 jours.

---

## Résumé exécutif

## Verdict en 2 lignes

**REFUSER en l'état — mais ce n'est pas un mépris, c'est un séquencement.** Yuno est un produit techniquement remarquable construit à l'envers : 119 pages, 94 edge functions et 495 migrations livrées AVANT le premier client, sur six segments B2B et trois piliers à la fois, sans déploiement, sans test, sans validation marché, avec une exposition pénale alcool-mineurs critique et un bus factor de 1.

## Ce qui est remarquable (à créditer sans réserve)

- **Vélocité et qualité de build solo.** 278 commits, architecture cohérente (feature-folders, TypeScript strict, `fees.ts` centralisé, code-splitting, dual design system). Le founder construit vite ET proprement — c'est rare et c'est le seul actif humain qui compte ici.
- **Architecture paiement mature.** Stripe Connect en direct-charge avec le **club = marchand de record** (`on_behalf_of` le club, Yuno = `application_fee`) est le meilleur choix du projet : Yuno n'est pas vendeur d'alcool, le relevé client porte le nom du club, le risque réglementaire de collecte de fonds est correctement esquivé sur ce point précis. Beaucoup de pré-seed ratent ça.
- **Honnêteté technique.** Zéro IA-gadget, pas de LLM saupoudré pour le deck. Le moteur de hype est de la vraie data-science (S-curve, empirical-Bayes shrinkage, confiance exposée).
- **Le wedge réel existe DÉJÀ dans le code.** `event_collab_contracts` + contrat-cadre récurrent + partage de revenus contractualisé eIDAS club↔BDE est la SEULE chose que Shotgun, Fever et Xceed ne font pas nativement, et c'est culturellement ancré en France.

## Ce qui est mortel (et qui dicte le NON)

- **Boil-the-ocean pré-PMF.** Tout le produit est du capital immobilisé dans des paris non testés. Le marché ne paie pas pour du code. Le ratio construction/validation est quasi infini : ~6-12 mois sur l'OFFRE, ~0 sur la DEMANDE. 0 club signé, 0 transaction, 0 euro réel, `demo_is_live()` toggle dans le code.
- **Positionnement contre tous les incumbents à la fois.** Six segments B2B sans tête de pont = l'exact inverse de *Crossing the Chasm*. Pire : **Xceed fait déjà les 3 piliers (guestlist + tickets + VIP bottle service) avec 25 M d'utilisateurs sur exactement le terrain de Yuno** (Paris, Marseille, Toulouse, Barcelone, Madrid, Ibiza). La thèse multi-pilier n'est pas un océan bleu, c'est l'océan rouge de Xceed.
- **Le pilier mis en avant comme MVP est le pire.** La commande de boissons skip-the-bar est un cimetière d'apps (Yoello, Butlr, Barpay, Rooam), un JTBD qui échoue à 1h du matin (déplace la file, ne la supprime pas — flux click&collect `preparing`/`markAsReady`/scan QR), une concurrence frontale POS (Toast/Square/Sunday) sans aucune intégration, et le pire revenu/txn (~0,27€). Le founder optimise pour la mauvaise unit economics.
- **Exposition pénale CRITIQUE vérifiée dans le code.** Guest checkout sans age gate backend (`create-checkout/index.ts:157` crée l'order sans aucune vérif d'âge), date de naissance auto-déclarée jamais KYC ni re-vérifiée, pas de blocage horaire alcool (Loi Évin), pas de vérif SIRET/licence club. Vente d'alcool à mineur en France = crime (L.3353-1), Yuno = co-auteur facilitateur. Amende CNIL jusqu'à 20 M€ pour données mineurs. **Solo, sans équipe compliance pour répondre à une mise en demeure.**
- **Système financier sans filet.** Zéro test sur des chemins qui calculent splits, commissions, refunds, clawbacks Stripe Connect — l'historique documente déjà des bugs financiers réels trouvés par chance. Admin opérateur non fonctionnel (pas de refund, pas de suspension, pas de kill-switch event). Cap Supabase 402 = le prod n'est même pas le repo. Flux QR 100% online-only, zéro résilience offline (fatal en soirée 4G saturée).
- **Aucun moat.** 0/5 sur les sources classiques (data, réseau, marque, techno, distribution) — toutes nulles car 0 transaction. La vélocité de build est une commodité, pas une barrière.

## Décision

**Non finançable par du VC aujourd'hui.** Mais le chemin NON→OUI est clair et court (8-12 semaines) car le seul actif défendable est déjà codé. La condition du OUI n'est pas « construire plus », c'est **détruire 90% du scope** et prouver la liquidité récurrente sur un atomic network d'UNE ville avec 3-5 BDE, plus boucler les bloquants compliance. Le NON est un NON de séquencement.

---

## Scorecard globale

| Dimension | Note / 100 | Justification |
|---|---:|---|
| Vision | **40** | Insight client juste (parcours nightlife unifié) et wedge BDE génuinement différenciant. Mais 'OS du nightlife' = vision de destination sans vision de séquençage, démentie par Xceed qui fait déjà les 3 piliers à 25M users. Sans beachhead ni why-now, c'est une liste de courses, pas une vision. La licorne n'est possible que via une vision DÉRIVÉE (wedge BDE FR puis remontée). |
| Produit | **36** | Exécution technique et esthétique remarquables (dual design system, Stripe Connect club=marchand, contrats eIDAS). Mais résout le mauvais problème au coeur du pitch (file au bar = non-douleur monétisable, le club VEUT la file), met en avant le pilier le plus faible (boisson click&collect, JTBD échoue à 1h), et la promesse 'simple comme Apple' est incompatible avec 119 pages / 6 rôles. PMF latent sur un wedge non mis en avant. |
| Marché | **56** | Le marché sous-jacent est réel et assez grand : billetterie FR ~60-90M€, co-soirée club↔BDE ~12-40M€ vierge. Mais Yuno additionne illégitimement 3 TAM non cumulables (même euro client partagé), a priorisé le plus petit segment (order&pay <20M€, cimetière) comme MVP, et le SOM solo réaliste à 3 ans plafonne à 150-350k€ ARR avec focus, tend vers zéro sans. Le marché n'est pas le problème, la capacité d'1 personne à le capturer en se dispersant l'est. |
| Timing | **30** | Mauvais timing pour un entrant non financé : consolidation DÉJÀ jouée (Fever/Dice 06/2025, DoorDash/SevenRooms 1,2Md$, Zenchef/CoverManager). Arriver pré-revenu pendant la phase finale = les places de leader sont prises et les survivants ont des bilans de guerre. Seule fenêtre favorable : micro-locale, le wedge BDE FR sous-servi, mais étroite. |
| Business model | **42** | STRUCTURE juste (hybride SaaS+marketplace à la Shopify/Toast, ne jamais paywaller la vente). Mais exécution non calibrée : commission 3-4% empilée PAR-DESSUS Stripe sans posséder l'acquisition ni le hardware (take rate compressible), plancher 0,99€ pousse le take effectif à 6-8% précisément sur le wedge BDE (hostile à la conversion), abo 39-99€ là où Shotgun facture 0€ d'abo, pricing 49/99/199 même pas dans Stripe (live=39/69/99), et ZÉRO validation de pricing power. La question à 10M€ est répondue à 0%. |
| Scalabilité | **24** | Infra (Supabase+CF+Stripe) scale horizontalement sans effort marginal. Mais la scalabilité d'une marketplace se juge à l'effet réseau : effets réseau faibles/hyper-locaux/non-cumulatifs (chaque ville = cold start neuf), double cold start B2B+B2C insoluble en solo sans capital de subvention, liquidité hits-driven + saisonnière sans cliquet. Recentré sur le wedge BDE viral intra-campus, monterait vers 50. |
| Concurrence | **20** | Sur 3 piliers, 2 sont des confrontations frontales perdantes (billet vs Shotgun/Fever/Xceed, boisson vs Toast/Square/Sunday + cimetière d'apps). Xceed = miroir vivant exact (3 piliers, 25M users, même géographie). Le seul vrai différenciateur (co-soirée club↔BDE) existe mais n'est pas positionné comme le coeur. Veille concurrentielle imprécise (Partiful classé concurrent à tort, Xceed absent de la liste, narratif Sunday daté). |
| Moat | **8** | Quasi-inexistant : 0/5 sur data/réseau/marque/techno/distribution, tout copiable en ≤1 trimestre. Le 8 (pas 0) reflète l'unique actif latent — le contrat-cadre récurrent club↔BDE — qui POURRAIT devenir un network effect local défendable s'il était focalisé et prouvé sur une ville. Mais option non exercée : code construit, réseau inexistant, switching cost nul. |
| Exécution | **64** | Au-dessus de la moyenne pré-seed : stack cohérente, Stripe Connect direct-charge mature, vite.config exemplaire, moteur de hype = vraie data-science, 1 TODO/0 FIXME. Plafonné par : 0 test sur les chemins d'argent (bugs financiers déjà vécus), 0 résilience offline (fatal en soirée), RLS 158 policies non auditées comme seule défense, 495 migrations avec lot fantôme, admin non fonctionnel, 933 appels Supabase bruts sans couche data, bus factor 1. Surtout : exécution dirigée vers le mauvais objectif (boil the ocean avant PMF). |
| Financement | **18** | Non-finançable par du VC en l'état (NON net) : pré-revenu, pré-déploiement, 0 traction, solo, compliance critique ouverte avec responsabilité pénale potentielle. Valo réaliste 0,8-1,5 M€ = territoire angel/FFF. Le 18 crédite la qualité d'exécution exceptionnelle (qui ouvre un pré-seed 2,5-4 M€ SI un pilote signé arrive) et le chemin court vers le OUI (8-12 semaines). |
| Potentiel de licorne | **12** | Très faible en trajectoire actuelle. Le wedge défendable (BDE↔club) a un TAM structurellement petit ; le marché nightlife software FR/UE est déjà en consolidation par des acteurs 100-5000× plus gros. Issue la plus probable et honorable : acqui-hire/acquisition 5-30 M€, pas une licorne. Le 12 garde une probabilité faible-mais-non-nulle conditionnée à gagner le wedge → cheval de Troie vers le club mainstream → devenir consolidateur. |
| Probabilité d'atteindre 10 M€ ARR | **8** | 8%. Arithmétiquement traçable (~1200 clubs actifs transactants OU débordement bars/festivals/multi-pays) mais traverse les incumbents les mieux capitalisés, en solo, avec un cycle de vente B2B 1-3 mois et un churn nightlife élevé. Chemin Series A+ avec force de vente terrain multi-pays, pas chemin de solo founder. Possible uniquement après pivot radical + levée + recrutement. |
| Probabilité d'atteindre 100 M€ ARR | **2** | 2%. Exigerait de dominer le nightlife software paneuropéen contre Fever (~2Md$), Weezevent (350M€ GMV), Xceed (25M users) en phase de consolidation finale. Le wedge BDE seul ne porte pas cette échelle ; il faudrait l'utiliser comme tête de pont vers l'OS club mainstream multi-pays. Quasi impossible sans changement de nature complet de l'équipe et du capital. |
| Probabilité d'atteindre 1 Md€ de valorisation | **1** | 1%. Même Fever a mis 10 ans et 527M$ pour ~2Md$. Un solo founder pré-revenu sur un wedge à TAM intrinsèquement petit, dans un secteur hits-driven/saisonnier/non-cumulatif, face à des consolidateurs établis : la probabilité est résiduelle. Non nulle uniquement par optionnalité extrême (pivot + multiples levées + exécution parfaite sur 8-10 ans). |
| Probabilité d'échec | **82** | 82%. Convergence de facteurs mortels : 0 validation marché, double cold start insoluble en solo, exposition pénale alcool-mineurs non résolue, bus factor 1 sans redondance réglementaire, take rate sans pricing power prouvé, churn nightlife élevé non observé, concurrence frontale avec des bilans à 9 chiffres. Le burn dérisoire (~150-600€/mois) et la qualité d'exécution rabattent le chiffre sous 90 : le founder PEUT pivoter quasi gratuitement, ce qui laisse une vraie chance de survie via le wedge BDE recentré. |

---

## Décision d'investissement : REFUSER

## Pourquoi REFUSER aujourd'hui

**Ce n'est pas un NON de mépris — la qualité d'exécution est rare et le wedge gagnant est déjà codé. C'est un NON de séquencement.** Quatre raisons rendent l'investissement impossible en l'état :

1. **Zéro validation marché sur l'hypothèse la plus dangereuse du business.** 119 pages construites avant de prouver qu'un seul club paie et REVIENT. Si le marché veut payer la commission mais pas l'abo (ou l'inverse), tout l'édifice s'effondre par-dessous. Le capital le plus rare (le temps avant PMF) a été investi du mauvais côté du bilan. Aucune unit economics n'est calculable car 0 transaction.

2. **Exposition pénale alcool-mineurs CRITIQUE et vérifiée.** Guest checkout sans age gate backend (`create-checkout/index.ts:157`), date auto-déclarée jamais KYC, pas de blocage Loi Évin, pas de vérif licence club. Vente d'alcool à mineur en France = crime (L.3353-1), Yuno = co-auteur. Amende CNIL jusqu'à 20 M€. Investir maintenant = garantie d'un rewrite compliance + responsabilité pénale du founder dès le premier mineur servi, sans personne pour répondre à une mise en demeure.

3. **Positionnement contre tous les incumbents à la fois, sans tête de pont.** Six segments B2B en simultané = l'inverse de *Crossing the Chasm*. Xceed fait déjà les 3 piliers avec 25M users sur le terrain exact de Yuno. Le pilier mis en avant comme MVP (boisson skip-the-bar) est le pire des trois : cimetière d'apps, JTBD qui échoue à 1h, concurrence POS frontale sans intégration. Aucun moat (0/5).

4. **Solo + zéro test sur des paiements + non déployé.** Bus factor 1 sur un système qui calcule splits/commissions/refunds Stripe Connect, sans filet de régression (bugs financiers déjà vécus), avec admin non fonctionnel et flux QR online-only. Le produit n'est ni testé, ni déployable, ni opérable.

## Ce qui ferait passer à INVESTIR (pré-seed 2,5-4 M€)

Le chemin NON→OUI est clair et court (8-12 semaines) car 95% du travail dur (le code) est fait. Conditions cumulatives :

- **Bloc compliance fermé** : age gate backend réel (Stripe Identity), vérif licence club, MFA admin, P0 opérateur (refund/suspension/kill-switch), 10-15 tests sur les chemins d'argent + légal.
- **Preuve de wedge** : pilier boisson tué du discours, 4 rôles masqués, focus 100% co-soirée club↔BDE dans UNE ville, **3-5 BDE/clubs facturés** avec GMV réelle transitée.
- **Preuve de rétention** : au moins un BDE qui refait une soirée récurrente SANS relance sur 3 mois — le seul signal de PMF qui compte.
- **Dé-risquage bus factor** : co-founder ou advisor compliance/ops à bord.

Si ces quatre blocs sont validés, Yuno devient un dossier pré-seed crédible avec une exécution exceptionnelle et un wedge Blue Ocean prouvé. Le déclencheur du OUI est réalisable — il exige du founder le courage psychologique de geler 90% de ce qu'il a brillamment construit.

**Fourchette de valorisation :** 0,8 - 1,5 M€ pré-money en l'état (territoire angel/FFF, pas VC). Passe à 2,5 - 4 M€ pré-money SI un pilote signé + bloc compliance bouclé + rétention BDE prouvée sur 3 mois (territoire pré-seed crédible). Le code construit porte quasi zéro valeur de valorisation aujourd'hui — sa largeur est même un passif de maintenance solo. Un VC paie l'optionnalité de marché prouvée, pas des lignes de code réplicables.

**Jalons clés exigés avant un seed :**
- Semaine 0 : décision fondatrice — 1 wedge (co-soirée club↔BDE), 1 ville (pas Paris), 4 rôles + pilier boisson masqués par flag, feature freeze inscrit dans CLAUDE.md
- Semaines 1-2 : cap Supabase 402 levé + 3 bloquants compliance fermés (age gate backend réel, vérif licence club, KYC âge) + MFA admin
- Semaines 3-4 : produit opérable — P0 admin (refund/suspension/kill-switch), résilience offline scan d'entrée, 10-15 tests sur chemins argent+légal, flux refund/chargeback testé en Stripe live
- Semaines 5-8 : 3-5 BDE/clubs réels signés et facturés dans la ville cible, GMV réelle transitée, zéro paid acquisition
- Semaines 9-12 : preuve de rétention — au moins 1 BDE refait une co-soirée récurrente SANS relance ; co-founder/advisor compliance recruté (dé-risquage bus factor)
- Jalon de levée : pilote signé + compliance bouclée + rétention prouvée = dossier pré-seed 2,5-4 M€

**KPI à instrumenter et prouver :**
- Nombre de BDE/clubs pilotes FACTURÉS (cible : 3-5 sous 60 jours) — le seul KPI qui valide l'hypothèse à 0%
- Taux de rétention récurrente : % de BDE qui refont une soirée SANS relance (le seul signal de PMF réel)
- GMV réelle transitée par soirée et take rate effectif ENCAISSÉ (vs annoncé)
- Churn club mensuel observé (l'hypothèse cachée qui fait basculer la LTV de 'acceptable' à 'mort' sur 3 points)
- Liquidité de l'atomic network : nombre de payeurs in-app par soirée dans UN club un samedi (densité, pas couverture)
- CAC réel par club signé (heures founder) — proxy direct du plafond d'acquisition bus-factor-1
- Statut des 4 bloquants compliance (age gate backend, KYC âge, licence club, MFA admin) : binaire fermé/ouvert avant tout go-live alcool
- Couverture de test sur les chemins d'argent et légal (cible : 100% sur commission/split/age gate/refund, 0% ailleurs assumé)

---

# Analyse détaillée par section

## 1. Vision : un "OS du nightlife" qui se bat contre tous les incumbents à la fois

## §1 — Vision

### Le verdict en une phrase
La vision est **ambitieuse, cohérente intellectuellement, et stratégiquement suicidaire dans sa forme actuelle**. Paul ne construit pas un produit, il construit un *écosystème* — et le fait avant d'avoir un seul client. C'est l'erreur de vision la plus classique et la plus mortelle du SaaS multi-faces : confondre "vision de destination" (où on veut arriver dans 7 ans) et "vision d'exécution" (le premier domino qu'on renverse). La vision de destination est défendable. La vision d'exécution est absente, et c'est ce qui tue.

### Ce qui est réellement fort (à créditer précisément)

1. **L'insight des trois piliers EST juste — au niveau du client final.** Un clubber un samedi soir veut : entrer (billet), s'asseoir au carré (table VIP), boire sans faire la queue (boisson). C'est le même utilisateur, le même soir, le même portefeuille. Personne ne possède ce parcours de bout en bout : Shotgun s'arrête au billet, Sunday au pay-at-table, Toast à l'encaissement. **L'unification du parcours nightlife est un vrai espace conceptuel.** Le problème n'est pas l'insight, c'est l'ordre d'attaque.

2. **Le wedge co-soirée club↔organisateur/BDE est le seul morceau génuinement différenciant et il existe DÉJÀ dans le code.** Les `event_collab_contracts`, le contrat-cadre récurrent signable une fois pour toute la résidence, le partage de revenus contractualisé tickets/tables/boissons entre un club et une asso étudiante — **aucun incumbent ne fait ça nativement.** Shotgun vend des billets, il ne gère pas le contrat de répartition de revenus entre le Warehouse et le BDE de Sciences Po qui co-produit la soirée du jeudi. C'est un Job-To-Be-Done réel, mal servi, et géographiquement ancré (les BDE = phénomène franco-français massif, ~3 500 associations étudiantes, des dizaines de milliers de soirées/an). **C'est là qu'est la licorne potentielle, pas dans "l'OS du nightlife".**

3. **La sophistication financière dépasse largement le stade pré-seed.** L'architecture "club = marchand de record" (direct charges, `on_behalf_of` le club, Yuno = application_fee) est exactement ce qu'il faut pour ne PAS être requalifié vendeur d'alcool ni établissement de paiement. C'est une décision d'architecture que des startups série A se plantent encore. Vision d'exécution juridico-technique : excellente.

### Ce qui est mortel (criticité critique)

1. **"OS du nightlife" = se positionner contre Shotgun + Fever + Xceed + Tablelist + Sunday + Toast/Square SIMULTANÉMENT.** C'est la définition même d'une thèse non-finançable pour un solo pré-revenu. Chaque pilier a un incumbent qui pèse 100 à 5 000× la surface de Yuno (Fever : ~724 M$ ARR, valo ~2 Md$ ; Weezevent : 350 M€ CA ; Zenchef-CoverManager : 36 000 restos). **On ne devient pas l'OS d'une industrie en attaquant ses six segments à la fois — on devient l'OS en étant indispensable sur UN segment, puis en remontant la chaîne (Crossing the Chasm, Moore).** Toast est devenu l'OS du resto US en partant du POS et UN segment, pas en faisant billet+table+boisson+DJ+staff dès le jour 1.

2. **Xceed est le contre-exemple vivant qui détruit la thèse de différenciation.** Xceed (Barcelone) fait DÉJÀ guestlist + tickets + VIP bottle service, sur exactement la géographie de Yuno (Paris, Marseille, Toulouse, Barcelone, Madrid, Ibiza, Lisbonne, Rome), avec **25 millions de clubbers** et le cold-start déjà résolu. La vision "je fais les 3 piliers" n'est pas un océan bleu — c'est un océan déjà occupé par quelqu'un qui a 25 M d'utilisateurs d'avance. **Le seul espace que Xceed ne couvre pas en profondeur : la commande boisson skip-the-bar (pilier perdant) et le contrat co-soirée BDE (pilier gagnant).** La vision devrait être l'intersection de ces deux trous, pas l'union des six piliers.

3. **La vision est démentie par l'exécution : 119 pages construites avant un club signé = vision inversée.** Une vision forte se prouve par un *séquençage*, pas par une *surface*. Construire l'app DJ, les affiliés, les promoteurs, le vestiaire et le bouncer avant d'avoir prouvé qu'UN club veut payer 49€/mois, c'est du Lean Startup à l'envers : on a construit le produit complet avant le moindre cycle build-measure-learn. Le risque n'est pas de mal construire (l'exécution solo est impressionnante), c'est d'avoir construit *la mauvaise chose, trop large*. La vélocité IA a permis de coder 6 mois de roadmap en 1 mois — ce qui a **amplifié le risque au lieu de le réduire**, parce que ça a permis de fuir la validation marché plus longtemps.

### Ce qui manque pour que ça devienne une licorne

| Manque | Impact | Criticité |
|---|---|---|
| **Une tête de pont (beachhead) déclarée** | Sans "je gagne les BDE + clubs partenaires de Lyon/Toulouse d'abord", il n'y a pas de cold-start résolvable | critique |
| **Une preuve de liquidité locale** (3-5 clubs réels, un samedi rempli) | Le network effect ne démarre pas avec 119 pages, il démarre avec une ville où l'offre et la demande coexistent | critique |
| **Un "why now"** | Pourquoi 2026 et pas 2020 ? Aucun changement réglementaire/technologique/comportemental n'est articulé | élevé |
| **Un moat défendable au-delà du code** | Le code se recopie ; la liquidité, les contrats exclusifs club-BDE et la data de transaction sont les vrais moats — aucun n'existe | élevé |
| **Un co-fondateur ou première embauche** | Bus factor = 1 sur paiements + alcool + RGPD = un investisseur série A ne signe pas | élevé |

### Peut-elle devenir une licorne ?
**Pas la vision actuelle. Une vision dérivée, oui — potentiellement.** Le chemin licorne réaliste n'est PAS "l'OS du nightlife mondial". C'est : **devenir le standard de la co-soirée monétisée club↔organisateur en France (wedge BDE), prouver la liquidité dans 5 villes, puis remonter vers le billet et la table VIP par effet de réseau, en s'intégrant aux POS au lieu de les combattre, et en tuant définitivement le pilier boisson skip-the-bar.** Ce chemin-là peut faire 50-100 M€ de GMV en France à 3-4 ans et justifier une valo de croissance. "L'OS du nightlife" en frontal contre Fever/Xceed avec 0€ et 1 personne : non.

**Différenciante ?** Sur le wedge co-soirée/BDE : oui, franchement. Sur "les 3 piliers" : non, Xceed le fait déjà. **Forte ?** Comme rêve : oui. Comme plan : non, parce qu'une vision sans séquençage n'est pas une vision, c'est une liste de courses.

## 2. Taille de marché : Yuno additionne trois TAM qu'il ne peut pas capturer en même temps

## §2 — Taille de marché (TAM / SAM / SOM chiffrés)

### Méthode et niveau de confiance
Je chiffre **séparément** les trois marchés que Yuno prétend adresser, parce que les additionner est précisément l'erreur stratégique à exposer. Toutes les estimations sont datées (cutoff jan 2026, données publiques secteur). Confiance explicitée par ligne. **Aucun chiffre fabriqué : chaque hypothèse est posée.**

---

### Marché A — Billetterie / découverte événementielle nightlife (UE)

**Hypothèses :** Marché billetterie événementielle mondiale ~80-85 Md$ de GMV (2025) ; nightlife/clubbing/festivals ≈ 12-15% du volume live ; revenu plateforme = take-rate sur GMV, pas le GMV lui-même (erreur classique : confondre GMV et marché adressable plateforme).

| Niveau | Périmètre | Estimation | Confiance |
|---|---|---|---|
| **TAM UE** (revenu plateforme billetterie nightlife+festivals) | GMV billetterie nightlife UE ~6-9 Md€ × take-rate moyen ~5% | **~300-450 M€/an de revenu plateforme** | moyen |
| **TAM France** | GMV nightlife/festival FR ~1,2-1,8 Md€ × 5% | **~60-90 M€/an** | moyen |
| **SAM France** (clubs récurrents + soirées étudiantes + festivals indé, hors gros festivals déjà verrouillés par Weezevent) | ~40% du TAM FR atteignable par un nouvel entrant | **~25-35 M€/an** | faible-moyen |

Incumbents installés : Shotgun (marque promoteurs FR), Fever (capital+découverte), Weezevent (350 M€ CA, festivals), RA (électronique). **Ce marché est un océan rouge consolidé.**

---

### Marché B — Pay-at-table / order & pay (boisson skip-the-bar, UE)

**Hypothèses :** Le marché order&pay est compté en revenu logiciel/transaction, pas en valeur des consos. Sunday (mieux capitalisé) a dû couper 60% de ses marchés en 2022 puis remonter à 3 500 restos avec 21 M$ levés — **signal que le revenu unitaire par établissement est faible et le churn élevé.**

| Niveau | Périmètre | Estimation | Confiance |
|---|---|---|---|
| **TAM UE** (order&pay hospitality, tous segments) | ~150-250 M€/an de revenu plateforme | moyen | 
| **TAM France nightlife seul** (bars/clubs, pas restos) | Le JTBD échoue en club bondé à 1h (cf. cimetière Yoello/Butlr/Barpay) | **~10-20 M€/an, ET en décroissance de pertinence** | faible |
| **SAM réaliste** | Quasi nul en club pur : le bar n'a pas la main-d'œuvre pour préparer des commandes app pendant le rush | **< 5 M€/an** | faible |

**Verdict : ce pilier — celui que Paul met en avant comme MVP — est le plus petit marché ET le plus mortel.** C'est un cimetière d'apps mono-villes sans gagnant paneuropéen. **Criticité critique : le fondateur a priorisé le marché le plus faible des trois.**

---

### Marché C — POS / encaissement (UE)

**Hypothèses :** Toast/Square/Lightspeed/SumUp possèdent le terminal, le hardware, la data de vente.

| Niveau | Estimation | Confiance |
|---|---|---|
| **TAM UE POS hospitality** | ~2-4 Md€/an (logiciel+matériel+transaction) | élevé |
| **SAM Yuno** | **0 €** — Yuno n'a aucune intégration POS et ne peut pas concurrencer le hardware | élevé |

**Yuno ne joue PAS sur ce marché. Il doit s'y intégrer ou mourir.** L'inclure dans la vision "OS" est une dilution pure.

---

### Le piège central : Yuno additionne-t-il ces TAM ou se disperse-t-il ?

**Il se disperse — et l'addition est une illusion comptable.** On NE peut PAS sommer A+B+C pour clamer un "TAM de ~500 M€+" :

1. **Les take-rates ne se cumulent pas sur le même euro.** Un billet vendu via Yuno génère 4% une fois. La conso prise au bar génère 3% une fois. Ce ne sont pas des marchés empilables, ce sont des *moments* du même client. Le revenu réel par établissement reste petit.
2. **Chaque pilier supplémentaire DIVISE le focus go-to-market par le nombre de piliers** sans multiplier le revenu par établissement proportionnellement. C'est le contraire d'une synergie : c'est une taxe de complexité.
3. **Le seul TAM qui compte vraiment pour le wedge crédible n'est dans aucune de ces trois cases :** le marché de la **monétisation contractualisée des co-soirées club↔organisateur/BDE en France**. Marché vierge, donc non chiffré publiquement. Estimation par construction : ~3 500 BDE/assos × ~5-15 soirées/an × GMV moyen 8-20 k€/soirée ≈ **0,3-1 Md€ de GMV co-soirée étudiante FR/an** ; take-rate Yuno ~4% ⇒ **~12-40 M€/an de revenu plateforme adressable, sans incumbent natif.** Confiance : faible (extrapolation), mais c'est le SEUL chiffre qui représente un océan bleu réel.

---

### SOM réaliste à 3 ans — solo founder, pré-revenu, pré-PMF

**Hypothèses dures et assumées :** 1 personne, 0€ levé, 0 client aujourd'hui ; vélocité IA élevée mais bande passante GTM = celle d'UNE personne ; cycle de vente B2B nightlife = 1-3 mois ; churn nightlife élevé (établissements fragiles). Je modélise le **scénario focus wedge BDE/club FR**, pas le scénario "OS".

| Scénario | Hypothèses | GMV an 3 | Revenu Yuno an 3 (take ~4% + abos) | Confiance |
|---|---|---|---|---|
| **Réaliste (focus wedge)** | 30-60 clubs/orgas actifs dans 3-4 villes FR, ~150-300 co-soirées/an | 3-6 M€ GMV | **~150-350 k€/an** | moyen |
| **Optimiste (focus + 1 embauche GTM + petit pre-seed)** | 120-200 établissements, 5-6 villes | 12-20 M€ GMV | **~600 k€-1 M€/an** | faible |
| **Statu quo (garde les 3 piliers + 6 rôles, reste solo, pas de focus)** | Dispersion, pas de liquidité locale, écrasé par Xceed/Shotgun | < 1 M€ GMV | **~30-80 k€/an, probable churn-to-zero** | moyen |

**Lecture brutale :** même le scénario réaliste optimisé plafonne à quelques centaines de k€ ARR à 3 ans **avec** un focus radical. Sans focus, le SOM tend vers zéro non par incapacité technique mais par dispersion GTM. **La taille de marché n'est PAS le problème de Yuno — le marché FR nightlife+BDE est largement assez grand pour une boîte à 10-30 M€ ARR à terme. Le problème est la capacité d'UNE personne à capturer un marché fragmenté contre des incumbents capitalisés, en se dispersant sur 3 piliers et 6 rôles au lieu d'en dominer un.**

### Informations manquantes qui changeraient tout
- **Pipeline réel de clubs/BDE intéressés** (LOIs, lettres d'intention) : absent → tout le SOM est théorique.
- **GMV moyen par co-soirée BDE** : non mesuré → fourchette large.
- **Capacité à lever un pre-seed** : sans ça, le scénario réaliste lui-même est tendu (1 personne ne couvre pas vente+support+conformité+dev).

## 3. Product-Market Fit — le problème est-il assez douloureux pour que QUELQU'UN paie ?

## Verdict d'ouverture

Yuno n'a aucun signal de PMF parce qu'il n'a aucun utilisateur, mais ce n'est pas le vrai problème. Le vrai problème est que **les trois piliers n'ont pas la même qualité de PMF latent, et le fondateur met en avant le pire des trois comme MVP**. J'ai vérifié le code : le pilier boisson (`Cart.tsx` 1270 LOC, `Barman.tsx` 1502 LOC, `OrderPreparationView.tsx` avec `clickCollect.preparing` / `markAsReady`) implémente un modèle de commande-paiement-attente-récupération au bar. C'est le job-to-be-done le plus faible du marché nightlife, et c'est un cimetière documenté (Yoello, Butlr, Barpay, LineSkip — aucun gagnant paneuropéen). Appliquons Jobs To Be Done sérieusement aux deux faces.

## JTBD face client (B2C) — pilier par pilier

| Pilier | Job réel du client | Douleur (0-10) | Yuno résout-il mieux que le statu quo ? | Fréquence d'achat |
|---|---|---|---|---|
| **Billet** | « Entrer dans LA soirée que je veux ce week-end, sans me faire refouler » | 7 | Non — Shotgun/Dice/Xceed le font déjà, avec l'inventaire d'events. Yuno part sans offre. | 2-4×/mois |
| **Table VIP / bottle** | « Réserver une expérience de groupe, montrer mon statut, garantir ma place » | 8 (mais segment étroit) | Partiellement — vrai trou en France de ville moyenne, mais peu de clubs ont une vraie culture bottle. | 1-3×/an |
| **Boisson skip-queue** | « Avoir mon verre vite à 1h du matin dans le bruit et la foule » | 6 ressenti, **2 résolu** | **NON.** Voir démonstration ci-dessous. | Théoriquement haute, en pratique nulle |

**Démonstration JTBD du pilier boisson (criticité CRITIQUE).** Le job du clubber à 1h du matin n'est pas « payer plus vite », c'est « avoir le verre en main ». Le flow Yuno vérifié dans le code impose : ouvrir l'app → trouver l'event lié (`une commande boisson doit être attachée à un event`, contrainte dure du code) → naviguer le menu → ajouter au panier → AgeGate + CGV → payer Stripe → écran `clickCollect.preparing` → attendre que le barman passe `markAsReady` → se lever, fendre la foule, montrer son QR (`OrderQR.tsx`), récupérer. Ce parcours **ne bat pas « je tends ma carte au barman »** dans 80 % des situations. Pire : il déplace le goulot d'étranglement (la file) vers une zone de retrait qui n'existe pas physiquement dans un club bondé, et il suppose que le bar a la main-d'œuvre pour préparer des commandes app pendant le rush — ce qui est faux les soirs où ça compte. Le JTBD échoue côté opérationnel, pas côté techno. C'est exactement pourquoi Sunday a dû pivoter de l'app fan vers l'infrastructure POS (OEM NCR Voyix) pour survivre. Yuno construit l'app fan que Sunday a abandonnée.

## JTBD face établissement (B2B) — la question qui tue

**« La file d'attente au bar est-elle un problème que les clubs VEULENT résoudre ? »** Réponse brutale d'opérateur : **non, pas pour les boissons.** Un bar bondé est un signal de désirabilité (preuve sociale), il pousse à la consommation impulsive, et surtout la marge d'un club ne vient pas du débit de service mais de la pénétration bottle/table et du ticket d'entrée. Réduire la file boisson, c'est résoudre un problème que le club **monétise** déjà (le bar plein vend du champagne à 15€ le verre à des gens qui attendent). Aucun gérant ne paie 49-199€/mois pour rendre son bar moins bondé.

Là où le club a une vraie douleur monétisable : **(1) le no-show et le yield sur les tables VIP** (une table à 800€ qui ne vient pas = perte sèche), **(2) le remplissage des soirées creuses du mardi/mercredi**, **(3) le vol interne au bar et la réconciliation de caisse**, **(4) la donnée client qu'il n'a aujourd'hui jamais**. Le code de Yuno a justement les briques pour 1, 2 et 4 (analytics démographie, prévision hype, co-soirée BDE pour remplir). Le fondateur a construit la solution au bon problème **et met en avant le mauvais**.

## Le client paiera-t-il, à quelle fréquence, et y a-t-il mieux ?

**Côté B2C :** le client ne paiera jamais d'abonnement, et la commission de 3-4 % est invisible pour lui (absorbée ou ajoutée). Sa seule décision est « est-ce que j'installe l'app et je l'utilise ». Or pour le billet il a déjà Shotgun/Dice, et pour la boisson le flow est plus lent que le statu quo. **Le coût d'acquisition d'une app fan sans inventaire d'events propre est prohibitif** (Cold Start non résolu).

**Côté B2B :** l'hypothèse de pricing du code (`Core/Essential 49€/Pro 99€/Elite 199€` + commission) n'a **zéro validation**. La question de Head of Product : un club paie-t-il 99€/mois pour Yuno alors qu'il a **déjà un POS (Toast/Square/SumUp/Zettle) qui possède l'encaissement et la data de vente**, et déjà Shotgun pour le billet ? Le code ne montre **aucune intégration POS** — Yuno se positionne en remplaçant frontal de l'incumbent le mieux installé du bar, ce qui est intenable. Il existe déjà une solution meilleure sur chaque pilier pris isolément ; le seul espace où Yuno fait quelque chose que personne ne fait nativement, c'est **le partage de revenus contractualisé club↔BDE sur co-soirée récurrente** (`event_collab_contracts`, contrat-cadre). C'est le seul JTBD réel, mal servi, géographiquement ancré (BDE = France).

## Score PMF

Le problème « file au bar » est faiblement douloureux et mal monétisable pour le club ; le client ne paie pas et le flow est plus lent que le statu quo. Le PMF latent réel est sur un pilier (VIP/yield/no-show) et un wedge (co-soirée BDE) que le fondateur ne met PAS en avant. C'est un misfit de positionnement, pas un misfit de capacité.

## 4. Analyse des personas — la voix terrain qui tue ou fait vivre l'adoption

## 4. Analyse des personas — la voix terrain qui tue ou fait vivre l'adoption

**Cadrage Jobs-To-Be-Done.** Yuno n'achète pas de l'attention, il achète un changement de comportement chez des gens qui sont au pic de leur charge cognitive (le barman à 1h du matin), qui n'ont aucun temps libre pour apprendre un outil (le patron en plein service), ou qui sont ivres et impatients (le client). Le produit a été conçu côté écran (119 pages, jolies analytics) et quasi jamais côté **paume de main d'un barman trempé de sueur**. C'est l'écart fatal. Je note chaque persona avec un verdict d'adoption réelle, pas théorique.

---

### 4.1 Le BARMAN — le persona qui décide de la vie ou de la mort du pilier boissons

**Réalité vérifiée dans le code.** `Barman.tsx` fait 55 KB / ~1500 LOC. Le flux est : commande payée dans l'app → `prep_requested` → la commande tombe dans une file `queue → preparing → ready` → le barman **scanne le QR du client** (`@yudiel/react-qr-scanner`) pour passer la commande en `served`. Mode Click & Collect optionnel : le barman prépare en amont, le client vient chercher.

**Motivations réelles d'un barman.** Faire un maximum de couverts/services à l'heure (son rythme, sa fierté, parfois son pourboire). Ne JAMAIS casser son flow. Garder le contrôle visuel de sa zone. En boîte, le bon barman est une machine : il lit 4 clients d'un coup d'œil, mémorise 3 commandes, encaisse au TPE sans regarder. Son unité de mesure, c'est la seconde.

**Frustrations que Yuno crée (et non résout) :**
- **Un écran de plus.** Le barman a déjà : le TPE, parfois une caisse, les bouteilles, la glace, le shaker. Yuno ajoute un téléphone/tablette à surveiller ET un scanner QR à dégainer. C'est une troisième main qu'il n'a pas.
- **Le scan QR au pic est un cauchemar opérationnel.** À 1h du matin : lumière noire/stroboscope (le scanner caméra galère en basse lumière + flashs), écran de client fissuré, luminosité au minimum pour économiser la batterie, mains qui tremblent, client bourré qui ne trouve pas son QR. Chaque scan raté = file qui s'allonge DERRIÈRE l'app, exactement ce que Yuno prétend supprimer.
- **Double file invisible.** Le job-to-be-done « skip the bar queue » échoue par construction : le client a payé dans l'app, mais il doit quand même **venir au bar, attendre que le barman prépare, présenter son QR, se faire scanner**. On a juste déplacé la file. Pire : on crée deux files concurrentes (les clients app vs les clients cash au comptoir) que le barman doit arbitrer en temps réel. Le barman privilégiera toujours le client physique qui agite un billet de 50€ devant lui.

**OBJECTIONS du barman (celles qui tuent l'adoption — criticité ÉLEVÉE) :**
1. *« Pendant le rush, je n'ai pas le temps de regarder un écran et de scanner. »* C'est l'objection terminale. Aucune feature ne la résout, seul un changement de staffing (un "runner" dédié aux commandes app) la résout — et ce coût RH, le patron ne le paiera pas pour un volume non prouvé.
2. *« Si le système plante ou le wifi tombe, je fais comment ? »* La boîte n'a souvent pas de wifi fiable au bar. Le code dépend d'un realtime Supabase. Pas de mode offline visible → un coupure réseau = barman aveugle sur sa file de commandes payées.
3. *« Ça me prend mes pourboires. »* Aux US/UK c'est dirimant. En France moins, mais le barman perd le contact humain qui génère les généreux. Il sabotera silencieusement l'outil.

**Comportement réel prévisible : le contournement.** Le barman marquera les commandes "servies" en masse sans scanner (le code a un fallback `served` legacy), ou ignorera la tablette et servira au comptoir comme d'habitude. **Quand le staff contourne l'outil, la data client — argument de vente n°1 de Yuno au patron — devient fausse, et le ROI s'effondre.**

---

### 4.2 Le PATRON DE CLUB (owner) — celui qui signe le chèque et tue le deal

**Motivations.** Remplir sa boîte, vendre des tables VIP (sa vraie marge), limiter le vol, ne PAS exploser son coût d'exploitation, et surtout **ne rien changer qui marche déjà un samedi plein**. Un patron de club rentable est structurellement conservateur sur ses opérations : un samedi raté = une semaine de CA perdue.

**Frustrations légitimes que Yuno adresse bien.** Le vol interne (le barman qui « oublie » d'encaisser pour un pote), l'absence de data client, la difficulté à vendre des tables à l'avance. Sur le papier, Yuno coche ces cases. Le bottle service digitalisé (`VipServiceTimer`, `MinimumSpendBar`, `VipUpsellStats`) est le morceau le mieux pensé et le plus différenciant.

**OBJECTIONS du patron (criticité CRITIQUE pour le go-to-market) :**
1. *« J'ai déjà un POS (caisse). Pourquoi j'en mettrais un deuxième ? »* Yuno n'a AUCUNE intégration POS (Toast, Square, Tiller, Zelty, L'Addition). Le patron devra double-saisir ou abandonner sa caisse existante. C'est un non immédiat. Le pilier boissons est en concurrence frontale avec l'incumbent le mieux installé du bar, et perd.
2. *« Réduire la file au bar ? Mais la file FAIT VENDRE. »* **C'est l'objection que le fondateur n'a manifestement pas internalisée.** La rareté, l'attente, la foule au bar = signal social que l'endroit est "the place to be". Un bar vide donne l'impression d'une soirée ratée. Beaucoup de patrons ne VEULENT PAS fluidifier — ils veulent que ça déborde. Yuno vend une solution à un problème que la moitié de la cible ne considère pas comme un problème. **Le JTBD "réduire la file" est partiellement anti-corrélé à l'intérêt économique du club.**
3. *« Tu prends 3-4% de commission ET 49-199€/mois ET je dois changer mes habitudes ? »* Pour un produit non prouvé, sans référence client, le patron veut être payé pour tester, pas payer. Le toggle "absorber la commission" prouve que le fondateur sait que la commission est un point de friction — mais alors c'est le club qui mange la marge.
4. *« Qui répond si ça plante un samedi à 2h ? »* Bus factor = 1 (Paul). Aucun patron sérieux ne met une dépendance opérationnelle critique (le paiement de sa soirée) sur un fournisseur solo sans astreinte, sans SLA, sans équipe support. C'est rédhibitoire pour tout club au-dessus de 200 personnes.

**VERDICT OPÉRATEUR (20 ans de métier) : non, je n'installe pas Yuno comme OS de mon club.** Je prends peut-être **un seul module** : la billetterie + la table VIP à l'avance, parce que ça me ramène du cash AVANT la soirée sans toucher à mes opérations du bar. Mais la commande de boissons au bar ? Jamais en l'état — ça désorganise mon meilleur barman un samedi plein pour un gain hypothétique. Et le risque qu'un mineur achète de l'alcool via un guest checkout sans contrôle d'âge (faille critique vérifiée dans `create-checkout`), c'est MA licence qui saute, pas celle de Yuno. **Ça, ça transforme le deal de "intéressant" à "danger pour mon fonds de commerce".**

---

### 4.3 Le MANAGER de salle — l'allié potentiel, mais pas le décideur

**Motivations.** Que la soirée roule, zéro incident, staff sous contrôle, reporting propre au patron le lendemain. Le manager est le persona le PLUS susceptible d'aimer Yuno : `ManagerDashboard.tsx`, les analytics live, le pipeline de commandes, le suivi du minimum spend VIP lui donnent une vue d'hélicoptère qu'il n'a pas aujourd'hui.

**Objection.** *« C'est super, mais ce n'est pas moi qui décide, et je ne vais pas me battre pour un outil qui va me faire engueuler par les barmans. »* Le manager n'imposera pas un outil qui crée des frictions avec son équipe de service. **Yuno doit gagner le barman pour gagner le manager.** Inversion de la chaîne d'adoption non résolue.

---

### 4.4 Le CLIENT LAMBDA (sortant régulier) — l'utilisateur dont dépend l'effet réseau

**Motivations.** Entrer vite, boire vite, ne pas perdre ses potes, payer sans galère. Le job-to-be-done réel : *"je veux ma conso sans faire la queue ni sortir 20€ en liquide"*.

**Frustrations que Yuno cible bien :** carte refusée, plus de cash, partage d'addition pénible. Le split payment et le paiement intégré répondent à un vrai besoin.

**OBJECTIONS du client (criticité ÉLEVÉE — cold start) :**
1. *« Pourquoi je téléchargerais une app pour UN bar ? »* Le client ne télécharge pas une PWA pour une soirée. Sans masse critique de clubs dans SA ville, l'app est inutile. C'est le problème du cold start (Chen) : zéro liquidité locale = zéro raison d'installer.
2. *« J'ai payé dans l'app mais je dois quand même faire la queue au bar pour récupérer ? Autant payer au comptoir. »* Si le gain de temps n'est pas spectaculaire et garanti, le client revient au comportement par défaut (tendre sa carte au barman). Le comportement par défaut est le concurrent le plus féroce.
3. *« Mon tel est à 4% de batterie / pas de réseau dans la cave où est le club. »* Réalité physique des sous-sols de clubs : pas de 4G, batterie morte à 2h. L'app dépend des deux.

**Comportement réel.** Le client utilisera Yuno **une fois par curiosité**, et reviendra au cash/carte si le gain n'est pas évident dès le premier essai. La rétention sur ce pilier sera brutale sans une raison récurrente de revenir (et la "raison" — la découverte d'events — appartient déjà à Shotgun/Fever).

---

### 4.5 L'ÉTUDIANT (et le BDE) — le SEUL persona où Yuno a un vrai angle

**C'est ici que se trouve le wedge crédible.** L'étudiant est price-sensitive, social, organisé en assos (BDE), et fréquente des soirées récurrentes. Le code a une vraie sophistication ici : compte organisateur BDE, flag `bde_verified`, **contrat-cadre co-soirée récurrent signé** entre le club et l'asso, partage de revenus contractualisé (tickets/tables/boissons). **C'est le seul morceau que Shotgun/Fever/Xceed ne font PAS nativement : le partage de revenus contractualisé club↔BDE sur une co-soirée récurrente.**

**Motivations BDE.** Remplir la soirée, toucher une part du CA pour financer l'asso, gérer la guest list, ne pas porter le risque financier. Yuno transforme un bricolage Excel + virements informels en contrat propre. JTBD réel, mal servi, géographiquement ancré (le BDE = phénomène français).

**Objection résiduelle.** *« Le club nous donnait déjà 1€ par entrée en liquide, pourquoi formaliser ? »* La formalisation (eIDAS, Stripe Connect) est un gain pour les gros BDE et les clubs qui veulent de la traçabilité comptable, mais une friction pour les petites assos habituées au cash. Segment plus étroit qu'il n'y paraît, mais **réel et défendable**.

---

### 4.6 Le TOURISTE — persona surestimé, faux espoir de TAM

**Réalité.** Le touriste ne télécharge pas une PWA inconnue pour une soirée à l'étranger. Il utilise ce que son hôtel/ses amis locaux lui disent, ou les apps qu'il connaît déjà (Fever pour les expériences, Resident Advisor pour la techno). La barrière langue est gérée (EN/FR/ES) mais ce n'est pas le frein : le frein est l'absence de notoriété et de raison d'installer. **Le touriste est un argument de TAM cosmétique, pas un canal d'acquisition réel.** Ne pas le compter dans le SOM.

---

### 4.7 Le CLIENT VIP (table / bottle service) — le persona le plus rentable, le mieux servi par Yuno

**Motivations.** Statut, vitesse de service, ne pas attendre, impressionner sa table, contrôler sa dépense (ou ne pas la contrôler). C'est le client à forte marge du club.

**Ce que Yuno fait BIEN (à créditer précisément).** `VipServiceTimer`, `MinimumSpendBar` (barre de progression vers le minimum + tracking d'upsell), `VipPriorityLane`, `VipUpsellStats`. La digitalisation du bottle service — réserver à l'avance, suivre sa conso, recommander une bouteille depuis la table sans chercher l'hôtesse — répond à un vrai JTBD premium **sous-servi en Europe continentale hors Espagne/Ibiza**. L'`OG/Blue Ocean` le plus crédible de tout le produit.

**Objection.** Le VIP veut de l'humain (l'hôtesse, le sparkler, le spectacle). Yuno ne doit pas remplacer le théâtre du bottle service, il doit l'outiller. Tant que c'est un superpouvoir donné à l'hôte VIP (`vip-host/`) et pas une self-service froide, c'est gagnant. Le code semble aller dans ce sens (dashboard hôte VIP riche). **Bon instinct produit ici.**

---

### 4.8 Le FESTIVALIER & l'organisateur de festival — terrain de Weezevent, pas de Yuno

**Réalité concurrentielle.** Weezevent (350 M€ CA, leader cashless EU après PlayPass) possède ce terrain : contrôle d'accès, cashless festival, gros volumes. Yuno n'a ni le hardware cashless (bracelets RFID), ni la robustesse load-testée (0 load testing vérifié), ni les références. Un festival = 20 000 transactions/heure sur un réseau saturé. **L'architecture Yuno (933 appels Supabase bruts, realtime, PWA mobile) n'est pas dimensionnée ni prouvée pour ça.** Persona à abandonner — c'est un océan rouge dominé par un incumbent capitalisé.

---

### 4.9 L'EXPLOITANT DE BEACH CLUB — variante saisonnière du club, même verdict

Mêmes objections que le patron de club, avec deux aggravations : (1) le soleil tue la lisibilité des QR et écrans, (2) la saisonnalité (3-4 mois) rend l'abonnement SaaS difficile à justifier sur 12 mois. Le bottle service en day-club (Ibiza, Saint-Tropez, Dubaï) est le SEUL angle intéressant — et c'est précisément là que **Xceed est déjà installé (Ibiza)**. Niche minuscule, concurrence frontale.

---

### 4.10 Le RESTAURANT FESTIF — terrain de Sunday/Zenchef, le pire choix de diversification

**Réalité.** Le pay-at-table restaurant est le marché de **Sunday** (3 500 restos, OEM NCR/Aloha, 21 M$ levés) et la réservation est celui de **Zenchef+CoverManager** (36 000 restos, PSG Equity, 20 pays) et de **SevenRooms** (racheté 1,2 Md$ par DoorDash). Trois géants consolidés. Yuno arrivant sur ce terrain = suicide stratégique. Le restaurant festif est mentionné dans la vision mais ne doit RIEN représenter dans le focus. Criticité CRITIQUE si le fondateur y consacre une seule heure de plus.

---

## VERDICT OPÉRATEUR GLOBAL (patron de club, 20 ans de métier, brutal)

**Installerais-je Yuno comme "OS de mon club" ? NON.** Trop large, trop risqué, fournisseur solo sans astreinte, et ça touche à mes opérations critiques un samedi plein. Je ne mets pas le paiement de ma meilleure soirée entre les mains d'un mec seul sans SLA.

**Le barman scannera-t-il vraiment des QR au pic à 1h ? NON, il contournera.** C'est la mort silencieuse du pilier boissons. Le contournement falsifie la data, qui est l'argument de vente n°1. Cercle vicieux vérifié dans le code (fallback "served" legacy, dépendance realtime sans offline).

**Le vol interne est-il réglé ? PARTIELLEMENT, et seulement si le barman utilise l'outil — ce qu'il ne fera pas spontanément.** Le paiement upfront dans l'app retire le cash des mains du barman (vrai gain anti-vol), MAIS uniquement sur les commandes qui passent PAR l'app. Tant que le comptoir cash/carte coexiste, le vol migre simplement vers les transactions hors-app. On ne supprime le vol qu'en supprimant le cash au bar — décision que 90% des patrons refuseront.

**Les clubs VEULENT-ils réduire la file ? PAS TOUS, et c'est le trou dans la thèse.** La file fait vendre et signale le succès. Yuno doit pivoter son discours : pas "on supprime la file" (que le patron ne veut pas), mais "on augmente le panier moyen et le pré-paiement" (que le patron veut). Le pilier qui survit à ce test, c'est la **table VIP/bottle service** (panier moyen, pré-paiement, statut) et la **billetterie+co-soirée BDE** (cash avant la soirée, zéro friction bar). 

**Ce que j'achèterais réellement, en tant qu'opérateur :** la billetterie + la réservation de table VIP + le contrat de co-soirée avec les BDE. Trois choses qui me ramènent du **cash AVANT la nuit sans toucher à mon bar**. Le "skip the bar queue" — je le jette. C'est joli en démo, c'est mortel en service.

## 5. Marketplace & Cold Start Problem — Yuno est-il vraiment une marketplace ?

## 5.1 Diagnostic préalable : Yuno n'est PAS une marketplace. C'est un SaaS B2B multi-tenant avec une couche conso vestigiale.

La première erreur du fondateur — et celle du PRD lui-même (« *Yuno is a multi-venue nightlife marketplace connecting clubbers with clubs* ») — est une erreur de taxonomie qui contamine toute la stratégie. **Une marketplace véritable agrège une offre fragmentée et une demande fragmentée, et crée de la valeur par l'appariement (matching) entre les deux côtés.** Airbnb apparie des hôtes inconnus à des voyageurs inconnus ; le voyageur vient SUR Airbnb précisément parce que des milliers d'hôtes y sont. Le côté demande choisit la plateforme à cause de l'offre, et inversement. C'est ça, l'effet réseau cross-side.

Yuno ne fait pas ça. J'ai vérifié dans le code : `Explore.tsx` (52,6 ko, ligne 551) agrège bien des events `visibility='public' AND is_discoverable=true` cross-venue — donc une surface de découverte existe techniquement. Mais le job-to-be-done réel de Yuno côté conso n'est PAS « découvre un club que tu ne connais pas ». C'est « **achète ton billet / ta table / ta conso pour la soirée où tu vas DÉJÀ** ». Le sortant arrive sur Yuno via un lien partagé par le club, le BDE, le promoteur ou un ami — pas via une recherche de découverte. L'analytics origines clients (globe Mapbox, RPC `event_origin_cities`) confirme cette mécanique : on mesure d'où viennent les acheteurs d'UN event, pas comment des fans découvrent de nouveaux clubs.

**Conséquence brutale :** Yuno est un **outil de conversion top-of-funnel-géré-par-le-club**, packagé en SaaS, avec une fine pellicule consumer-facing par-dessus. C'est le modèle Shotgun/Weezevent (billetterie SaaS où la « marketplace » est un sous-produit), PAS le modèle Fever/Dice (média de découverte propriétaire qui POSSÈDE l'audience). Cette distinction est **le point le plus important de tout l'audit marketplace**, car elle détermine d'où vient la demande — et donc si le cold start est résoluble.

| | Marketplace vraie (Fever, Airbnb) | Yuno (réalité vérifiée) |
|---|---|---|
| Origine de la demande | La plateforme possède l'audience (média, SEO, app installée) | Le club/orga amène ses propres clients via un lien |
| Valeur du matching | Découverte d'offre inconnue | Quasi nulle — l'acheteur sait déjà où il va |
| Effet réseau cross-side | Fort (+ d'offre → + de demande) | **Quasi inexistant** — chaque venue est un silo |
| Ce que c'est vraiment | Marketplace | **SaaS de billetterie/encaissement + couche conso** |

Criticité de la mauvaise auto-classification : **élevée**. Tant que Paul pense « marketplace », il va sous-investir dans le SaaS (le vrai produit qui crée de la valeur et de la rétention) et sur-investir dans une découverte consumer qui ne décollera jamais sans un budget média de type Fever (527 M$ levés). Niveau de confiance : **élevé** (ancré dans le code et le PRD).

## 5.2 Le double cold start : deux problèmes de poule-et-l'œuf empilés, en solo, à zéro capital

Andrew Chen (*The Cold Start Problem*, 2021) définit l'« atomic network » : le plus petit réseau stable qui peut se maintenir et croître par lui-même. Pour Uber, c'est « assez de chauffeurs dans un quartier pour qu'un passager ait une voiture en <5 min ». **Pour Yuno, l'atomic network n'est PAS une ville. C'est UNE soirée dans UN club, un samedi soir, avec assez de sortants qui paient via l'app pour que ça vaille le coup pour le club d'imposer le QR au bar et de scanner les billets.** C'est tout. Si tu ne peux pas remplir CETTE cellule, rien d'autre ne compte.

Le problème : Yuno doit résoudre **DEUX cold starts simultanés**, et ils sont couplés de façon vicieuse.

**Cold start B2B (l'offre — clubs/orgas).** Pourquoi un club signerait-il une plateforme à zéro utilisateur, zéro réputation, un fondateur solo, pas de référence, et un produit qui touche sa caisse (le truc le plus sacré d'un patron de boîte) ? Le club a déjà un POS (Toast/Square/SumUp), déjà peut-être Shotgun pour le billet, déjà un système qui marche un samedi à 1h du matin. Le coût de switch perçu est énorme et le risque opérationnel (le bar qui plante en plein rush) est inacceptable. **Ce côté est froid ET gelé.**

**Cold start B2C (la demande — sortants).** Pourquoi un sortant téléchargerait-il une PWA pour acheter une conso, alors que tendre sa carte au barman fonctionne ? La réponse honnête : il ne le fait QUE si le club l'y force/incite fortement (file dédiée Yuno, prix, accès VIP). Donc la demande B2C **dépend entièrement** de l'offre B2B ayant déjà adopté ET activement poussé l'app. **La demande ne peut pas amorcer l'offre.**

C'est là que le couplage devient mortel : dans une marketplace classique tu peux subventionner UN côté pour amorcer l'autre (Uber a payé les chauffeurs). Ici, **le côté demande n'a aucun levier pour attirer le côté offre** — un sortant ne fait pas venir un club. Et le côté offre (le club) doit faire TOUT le travail d'acquisition de la demande lui-même (pousser ses propres clients vers l'app). Donc Yuno ne subventionne pas une marketplace : **il vend un outil que le club doit lui-même rentabiliser en éduquant ses propres clients.** C'est du SaaS pur, avec la difficulté d'adoption d'une marketplace, sans le bénéfice de l'effet réseau d'une marketplace. **Le pire des deux mondes.** Criticité : **critique**. Confiance : **élevée**.

En solo, sans équipe sales terrain, sans capital de subvention : le double cold start est **structurellement quasi-insoluble pour les piliers billet et boisson**. C'est ce qui justifie de tuer ces piliers (voir §5.6).

## 5.3 Effets réseau : hyper-locaux, faibles, et essentiellement transactionnels — pas de douve

Question clé d'un investisseur marketplace : *quand le réseau grandit, la valeur pour chaque utilisateur augmente-t-elle ?* Décomposons les effets réseau revendiqués :

| Effet réseau | Existe-t-il ? | Portée | Force | Verdict |
|---|---|---|---|---|
| Cross-side classique (+ clubs → + valeur pour sortants) | Marginalement (Explore) | Ville | **Faible** | Le sortant veut SON club, pas un catalogue |
| Same-side offre (+ clubs → valeur entre clubs) | Non | — | Nulle | Les clubs sont concurrents, ne partagent pas d'audience |
| Data network effect (+ transactions → meilleures recos/analytics) | Embryonnaire | Venue | Faible | Pas assez de volume, et la data ne traverse pas les venues |
| **Effet collab club↔BDE (le seul réel)** | **Oui** | **Bi-partite local** | **Moyen** | **Voir §5.6 — c'est le vrai actif** |

Le diagnostic de Chen sur les « network effects locaux vs globaux » est central ici. **Le nightlife est le réseau le PLUS hyper-local qui existe.** La liquidité d'un samedi soir à Lyon n'apporte STRICTEMENT RIEN à un sortant de Bordeaux. Pire que Uber (où au moins la marque traverse les villes) : un fan de techno ne se soucie pas qu'un beach club d'Ibiza soit sur Yuno. Il n'y a **aucune économie d'agrégation cross-ville côté demande.** Chaque ville est un cold start neuf et complet. C'est exactement pourquoi Xceed (25 M de clubbers) reste la vraie menace : il a déjà payé ce coût ville par ville sur le terrain exact de Yuno (Barcelone, Madrid, Ibiza, Paris, Marseille, Toulouse, Lisbonne).

**Verdict effet réseau : faible, hyper-local, transactionnel.** Yuno n'a pas de douve d'effet réseau défendable sur ses piliers principaux. La seule douve potentielle est le **switching cost SaaS** (un club qui a mis son floor plan, son staff, sa billetterie dans Yuno migre difficilement) — mais c'est une douve de SaaS, pas de marketplace, et elle ne joue qu'APRÈS adoption. Criticité de l'absence de douve réseau : **élevée**. Confiance : **élevée**.

## 5.4 Saisonnalité + nature « hits-driven » : la liquidité ne s'accumule pas, elle se reconstruit chaque semaine

C'est un angle que le fondateur ignore totalement et qui est **fatal pour toute thèse d'effet réseau cumulatif**. Le nightlife est :

1. **Hits-driven (logique de blockbuster).** La valeur n'est pas dans le club, elle est dans LA soirée. Un même club fait salle comble avec un gros DJ et désert la semaine d'après. La liquidité de Yuno est donc liée à un calendrier d'events discrets, pas à un flux continu. Contrairement à Uber (demande quotidienne, lissée, prévisible), la demande nightlife est **spiky, événementielle et non-récurrente sur la même offre.** Tu ne « construis » pas une liquidité durable — tu la reconstitues à chaque event.

2. **Saisonnier et géo-volatil.** Pics énormes (rentrée étudiante septembre, fêtes de fin d'année, festivals d'été, saison Ibiza juin-sept) et creux mortels (janvier-février, été en ville). Un beach club fait 100 % de son CA sur 4 mois. Cette saisonnalité **casse la régularité dont un effet réseau a besoin pour se renforcer.** Entre deux saisons, le réseau se refroidit — il faut le ré-amorcer (« hard side churn » de Chen : le côté difficile, ici les clubs/orgas, disparaît hors saison).

3. **Churn d'offre élevé.** ~30 % des bars/clubs ferment ou changent de mains sous 2-3 ans. Le côté offre est intrinsèquement instable.

**Implication marketplace :** une liquidité qui ne s'accumule pas n'engendre pas d'effet de cliquet (ratchet). Chaque rentrée, Yuno repart quasi de zéro sur l'engagement conso. **La seule façon de battre la saisonnalité est la RÉCURRENCE structurelle** — et c'est précisément ce que le code de Yuno fait de mieux : le contrat-cadre récurrent co-soirée (`generate_recurring_events`, signature une fois pour toute la résidence) et les soirées étudiantes BDE qui ont, elles, une vraie cadence hebdomadaire/mensuelle sur l'année universitaire. C'est le seul segment où la liquidité PEUT s'installer dans le temps. Criticité de la saisonnalité ignorée : **élevée**. Confiance : **élevée**.

## 5.5 Stratégie de lancement pour atteindre la densité dans UNE ville (la seule qui peut marcher)

La règle de Chen est non-négociable : **on ne lance pas une ville, on lance un atomic network, puis on densifie.** L'erreur que Yuno doit éviter à tout prix : « ouvrir Paris » (10 000 lieux, dilution totale, aucun samedi ne ressent de différence). La bonne unité de lancement n'est pas la ville — c'est **une scène (scene)** : un cluster social dense où les mêmes gens se croisent, se parlent, et où le bouche-à-oreille est instantané.

**Le meilleur atomic network pour Yuno, ancré dans ce que le code fait déjà : UNE ville étudiante de taille moyenne (Lille, Lyon, Montpellier, Toulouse, Rennes), via les BDE.** Pourquoi c'est l'unique stratégie de lancement crédible :

- **Le BDE résout les DEUX cold starts d'un coup.** Une asso étudiante EST à la fois l'offre (elle organise la soirée, c'est l'orga) ET le canal de demande captif (elle a une liste de 500-3000 étudiants qu'elle peut activer gratuitement via ses propres réseaux). **Un seul acteur amorce les deux côtés.** C'est le seul nœud du graphe où le double cold start s'effondre en cold start simple.
- **Récurrence native** → bat la saisonnalité (soirées d'intégration, galas, jeudis étudiants récurrents sur 8 mois universitaires).
- **Hyper-densité sociale** → effet réseau local maximal : dans une promo, tout le monde se connaît, le « j'ai pris mon billet sur Yuno » se propage en heures, pas en semaines.
- **Le wedge produit existe et est défendable** (§5.6) : aucun incumbent (Shotgun, Fever, Xceed) ne fait le **partage de revenus contractualisé club↔asso** sur une co-soirée récurrente.

**Séquence de lancement (la seule que je financerais) :**

1. **Sème la demande AVANT l'offre, manuellement.** Signe 1 BDE qui a déjà une soirée prévue dans 3 semaines avec un club partenaire. Pas de la prospection à froid — un BDE qui a un pain point réel (gérer la billetterie + la répartition d'argent avec le club est un cauchemar Excel/cash aujourd'hui).
2. **Fais UNE soirée parfaite.** Tout le tunnel : billet via Yuno, contrat de partage signé, payout automatique au club et au BDE, analytics démographiques post-soirée. **Objectif unique : que le trésorier du BDE et le patron du club disent « plus jamais sans ça ».**
3. **Densifie le campus, pas la ville.** Le BDE #1 parle au BDE #2 (les assos se connaissent, fédérations type FAGE/réseaux d'écoles). 5-8 BDE sur une seule ville → tu possèdes la scène étudiante nightlife de cette ville.
4. **Le club, lui, vient PAR les BDE** (« 3 assos veulent faire leur soirée chez toi via Yuno »). Tu inverses le rapport de force : le club n'adopte pas un SaaS, il accepte un canal de revenus qui lui amène des soirées.
5. **SEULEMENT après densité prouvée sur 1 ville**, réplique ville par ville (chaque ville = cold start neuf, mais le playbook est rodé).

**Ce que ça implique de SACRIFIER :** la commande de boissons skip-the-bar (cimetière d'apps, JTBD qui ne tient pas en club bondé), 4 des 6 rôles, et la découverte consumer généraliste. Voir §5.6.

## 5.6 Le seul vrai actif marketplace de Yuno : le wedge co-soirée club↔BDE

J'ai vérifié dans le code : 11 migrations touchent `event_collab_contracts`, avec `create_event_collab_contract`, contrat-cadre récurrent, split négociable tickets/tables/boissons, retenue de payout jusqu'à fin+2j, contrats eIDAS, flag `is_bde` + `bde_verified` + commission plancher 0,49 €. **C'est le morceau le plus sophistiqué ET le plus différencié de tout le produit.** C'est aussi le seul endroit où Yuno fait quelque chose de structurellement absent chez Shotgun/Fever/Xceed : **arbitrer et exécuter automatiquement le partage d'argent entre deux entités juridiques distinctes (un club et une asso) sur une soirée co-produite et récurrente.**

C'est un **vrai effet réseau bi-partite, hyper-local, récurrent** : chaque club connecté à plusieurs BDE, chaque BDE connecté à plusieurs clubs, et le contrat de confiance (argent garanti, automatique, traçable) augmente avec le nombre de collaborations réussies. **C'est le seul graphe de Yuno où plus de nœuds = plus de valeur pour chaque nœud.** Et le JTBD est aigu et mal servi : aujourd'hui, la répartition club/BDE se fait au cash, à la confiance, en fin de soirée, avec des disputes. Yuno la rend contractuelle, automatique, auditée. **Ça, c'est finançable.**

**Recommandation marketplace (celle d'un CEO de marketplace >1 Md€) :** Yuno doit se redéfinir non pas comme « l'OS du nightlife » mais comme **« le rail de revenu-partagé entre clubs et organisateurs/assos étudiantes »**, lancé sur une ville étudiante, sur le pilier co-soirée. C'est un wedge (Crossing the Chasm : UN segment tête-de-pont, dominé totalement, avant toute traversée), avec un effet réseau réel, une récurrence qui bat la saisonnalité, et un double-cold-start qui s'effondre grâce à l'acteur BDE bi-face. Tout le reste — boisson, découverte généraliste, 4 rôles sur 6, les 119 pages — est de la dette d'opportunité construite avant la tête de pont. Criticité de ne PAS recentrer : **critique**. Confiance dans le wedge : **moyenne-élevée** (le produit existe et est bon ; ce qui reste non prouvé, c'est que les BDE paieront/convertiront — zéro validation marché à ce jour).

## 6. SaaS — quelles fonctionnalités garder, lesquelles SUPPRIMER, et quel est le wedge minimal viable

## Le diagnostic en une phrase

Yuno a construit **119 pages et 94 edge functions pour 6 segments B2B avant de signer un seul client**. C'est l'anti-Lean Startup parfait : le produit est une suite complète d'OS nightlife, pas un MVP. La discipline produit ici n'est pas d'ajouter, c'est de **supprimer 70 % de la surface** pour pouvoir vendre, déployer et maintenir.

## Carte des fonctionnalités : garder / parquer / tuer

| Fonctionnalité (vérifiée dans le code) | Décision | Justification Head of Product |
|---|---|---|
| **Co-soirée club↔organisateur/BDE** (`event_collab_contracts`, contrat-cadre récurrent, partage revenus tickets/tables/boissons) | **GARDER — c'est le wedge** | Seul JTBD que Shotgun/Fever/Xceed ne font PAS nativement. Ancré FR (BDE). Crée un network effect bi-face local (le BDE amène les fans, le club amène le lieu). |
| **Billetterie événements** (`TicketSelection`, `TicketCheckout`) | **GARDER — support du wedge** | Nécessaire pour vendre la co-soirée. Mais ne pas prétendre concurrencer Shotgun en frontal sur la découverte. |
| **Tables VIP / bottle service** (`FloorPlanEditor`, `TableCheckout`) | **GARDER si la cible le justifie** | Vrai trou EU continentale hors Espagne/Ibiza. Bon levier de yield/no-show, vraie douleur club. Mais SOM étroit. |
| **Commande boisson skip-queue** (`Cart`, `Barman`, `MyOrders`, click&collect) | **TUER (ou parker en V3)** | Pilier le plus faible : cimetière concurrentiel, JTBD qui échoue à 1h du matin, concurrence frontale Toast/Square/Sunday sans intégration POS. C'est le pilier que le fondateur appelle « MVP ». Erreur de focus. |
| **Marketplace DJ** (booking, contrats séquestre Stripe `dj-payout`) | **PARKER** | Beau, sophistiqué, mais c'est une 2e marketplace cold-start à amorcer en parallèle. Risque DSP2/ACPR (séquestre de fonds tiers sans agrément). Zéro priorité pré-PMF. |
| **Affiliés / promoteurs multi-villes** | **TUER pré-PMF** | Levier de croissance d'un produit qui marche déjà. Inutile sans liquidité de base. |
| **Staff opérationnel** (Bouncer 1905 LOC, Cloakroom, VipHost, Manager) | **RÉDUIRE au strict nécessaire de la co-soirée** | Bouncer/scan d'entrée = utile pour valider le billet. Vestiaire/hôte VIP/manager = sur-ingénierie pré-revenu. |
| **Analytics avancées** (démographie, globe Mapbox origines, prévision hype) | **GARDER une vue, parker le reste** | La data client est la vraie douleur club non servie. Mais 1 dashboard « qui est venu, combien j'ai gagné, qui n'est pas venu » suffit. Le globe Mapbox est du theatre. |

## Le wedge minimal viable (MVV)

**Cible :** un club de ville moyenne FR + son/ses BDE étudiants partenaires.

**Promesse unique :** « Signez UN contrat-cadre de co-soirée avec votre BDE, vendez billets + tables, partagez les revenus automatiquement et légalement, voyez qui est venu et combien vous avez gagné. »

**Surface produit MVV (ce qui reste après la coupe) :**
1. Onboarding club + Stripe Connect (déjà solide, `club = marchand de record`).
2. Création d'event + billetterie + plan de tables VIP.
3. Contrat co-soirée signé club↔BDE avec split automatique (le différenciateur).
4. Scan d'entrée (Bouncer, version dégraissée).
5. UN dashboard : revenu net, no-show, démographie de base.

Cela représente peut-être **25-30 pages au lieu de 119, et ~25 edge functions au lieu de 94**. Tout le reste est de la dette qui ralentit le déploiement (cap Supabase 402), gonfle la surface de QA (zéro test sur 210k LOC) et disperse le message commercial.

## Pourquoi supprimer est l'acte le plus rentable ici

L'audit technique le dit : `933 appels Supabase bruts sans couche data`, `11 god-pages > 1000 LOC`, `0 test`. Chaque pilier conservé multiplie la surface à maintenir par un solo founder (bus factor = 1). En Lean Startup, le but du MVP est d'**apprendre vite avec le minimum** ; Yuno a maximisé la construction et minimisé l'apprentissage. Supprimer 70 % du scope n'est pas une perte — c'est ce qui rend le produit **vendable, déployable et survivable**. Le code n'est pas jeté, il est parqué derrière un feature flag (`demo_is_live()` existe déjà) et ressorti pilier par pilier une fois la liquidité prouvée dans 3-5 clubs.

## 7. Business model — la commission tient-elle, le SaaS a-t-il un pricing power, et le toggle d'absorption détruit-il l'économie ?

## 7.1 Le modèle déclaré vs. le modèle codé (deux chiffres différents — premier red flag de gouvernance financière)

Le fondateur décrit « commission 3% boissons / 4% billets-tables + abonnement 49/99/199 ». **Le code dit autre chose**, et c'est important pour un CFO :

| Élément | Doc / pitch | Code LIVE vérifié | Code refonte (non déployé) |
|---|---|---|---|
| Commission billets/tables | 4% | **4% min 0,99€** (BDE: min 0,49€) — `_shared/commission.ts` | inchangé |
| Commission boissons | 3% | **3% sans minimum** | inchangé |
| Frais Stripe | « 1,5% » | **1,5% + 0,25€/txn** (`fees.ts:STRIPE_PERCENT`) | inchangé |
| Abonnement Essential/Pro/Elite | 49/99/199 | **39/69/99 €** (prix Stripe live, `club-subscription:45`) | 49/99/199 (à créer dans Stripe) |
| Doc-rot | — | un commentaire checkout disait « 7% » (corrigé) | — |

**Constat CFO #1 (criticité moyenne).** Le pricing annoncé n'est pas le pricing facturable. Les prix Stripe live sont encore 39/69/99 ; la grille 49/99/199 n'existe nulle part dans Stripe. Tant que les 4 prix (essential/pro × mensuel/annuel) ne sont pas créés et que `PRICE_TO_PLAN` n'est pas mis à jour, **le MRR cible est non encaissable**. Ce n'est pas un détail : c'est la différence entre un business model écrit et un business model opérationnel. Pré-revenu, ça se règle en 2h, mais ça révèle un pattern : le modèle vit dans des docs et des `const`, pas dans Stripe.

## 7.2 Le modèle est-il juste ? La thèse « gagner 2× » est correcte mais mal calibrée

La thèse (doc PRICING_STRATEGY §1) est : **hybride SaaS + marketplace, comme Shopify/Square/Toast — ne jamais paywaller la vente, monétiser la croissance.** C'est intellectuellement juste, et c'est même le meilleur réflexe stratégique de tout le dossier. Square take rate ~2,6%+0,10€, Toast ~2,49%+0,15$ + SaaS 69$+/terminal, Shopify 2,9%+0,30$ + abo. Le modèle de Yuno copie une structure éprouvée.

**Mais Yuno n'est ni Square ni Shopify, et l'analogie casse sur trois points financiers durs :**

1. **Square/Toast possèdent le terminal (le hardware d'encaissement). Yuno ne possède RIEN.** Le take rate d'un POS est défendable parce qu'il remplace l'acquéreur bancaire ET fournit le matériel. Yuno se branche sur Stripe (qui est déjà l'acquéreur) et ne fournit aucun hardware. **Yuno empile sa commission PAR-DESSUS Stripe, pas À LA PLACE de l'acquéreur.** Le client paie donc Stripe (1,5%+0,25€) ET Yuno (3-4%) ET, parfois, le promoteur. C'est de la commission en cascade sur une marge club déjà fine.

2. **Le take rate de Yuno (3-4%) est SUPÉRIEUR à celui des incumbents nightlife sur le pilier le plus contesté (le billet).** Shotgun/DICE facturent typiquement un fee fan de 2-5% mais **0€ d'abonnement**. Or le pitch de Yuno empile un take rate comparable ET un abonnement 39-99€. Pour qu'un club accepte de payer les deux, l'outillage de croissance (CRM, promo, VIP, orchestration) doit créer une valeur que Shotgun ne fournit pas. **Cette valeur n'est validée par aucun client.** Pricing power réel = inconnu, probablement faible au lancement (un club sans marque qui débarque ne peut pas imposer un abo à des établissements qui ont déjà Shotgun gratuit côté SaaS).

3. **La commission est-elle soutenable face aux marges club ?** Sur un billet à 15€ : commission Yuno 4% = 0,60€, mais le **plancher 0,99€ s'applique** → le client paie 0,99€ de fee (6,6% effectif) + Stripe 0,25€+1,5%. Sur les petits paniers, le plancher 0,99€ pousse le take rate effectif à 6-8%, ce qui devient visible et hostile à la conversion fan. **Le plancher est une bombe à conversion sur le segment étudiant/BDE** (paniers 8-15€), précisément le wedge que l'intel concurrentielle identifie comme le seul défendable. Le plancher BDE à 0,49€ atténue mais ne résout pas : à 10€, 0,49€ = 4,9% effectif.

## 7.3 Le toggle « le club absorbe la commission » — détruit-il l'économie ? Non, mais il révèle l'absence de pricing power

Le toggle `absorb_yuno_fees` (Option C, per-merchant) permet au club de **payer lui-même la commission Yuno** au lieu de la refacturer au fêtard. Analyse CFO :

- **Ce qu'il NE détruit PAS :** le revenu de Yuno. Que la commission soit payée par le fan (mode défaut) ou absorbée par le club (mode opt-in), **Yuno encaisse exactement le même `application_fee`**. Le bug corrigé le 2026-06-24 (le line_item facturait `serviceFee` au lieu de `transactionFee` → le client payait quand même) le confirme : l'architecture vise à préserver le revenu Yuno dans les deux modes. **Donc non, le toggle ne détruit pas l'unit economics de Yuno.**
- **Ce qu'il révèle (criticité élevée) :** si Yuno doit offrir un mode où le club mange la commission pour pouvoir afficher « zéro frais Yuno » au fan, c'est l'aveu que **la commission visible côté fan est un frein concurrentiel**. Le toggle est une rustine marketing contre la transparence hostile du plancher 0,99€. Dans un marché où Shotgun affiche un fee fan « normalisé », Yuno crée une option pour cacher son propre fee. C'est défensif, pas offensif.
- **Le vrai danger économique du toggle :** il transforme la commission en **coût direct pour le club**, donc en ligne de P&L que le club surveille. Un club qui absorbe 4% sur 30k€/mois de billets paie 1 200€/mois de commission Yuno EN PLUS de son abo. À ce niveau, le club fait le calcul et compare à Weezevent/Shotgun. **Le toggle rend le take rate négociable de facto** — et un solo founder sans levier négociera vers le bas. Pricing power → érodé dès le premier gros client.

## 7.4 Unit economics par transaction (hypothèses explicites)

**Hypothèses (confiance moyenne, dérivées du code + paniers nightlife typiques) :**

| Type | Panier moyen | Commission Yuno | Stripe (sur total) | **Revenu net Yuno / txn** | Take rate net |
|---|---|---|---|---|---|
| Boisson | 9€ | 3% = 0,27€ | — (payé par fan/club) | **~0,27€** | 3,0% |
| Billet club | 20€ | max(0,99€, 4%=0,80€) = 0,99€ | — | **~0,99€** | 4,95% |
| Billet BDE | 10€ | max(0,49€, 0,40€) = 0,49€ | — | **~0,49€** | 4,9% |
| Table VIP | 250€ | 4% = 10€ | — | **~10€** | 4,0% |
| Booking DJ (séquestre) | 400€ cachet | 4% min 2€ cap 250€ = 16€ | — | **~16€** | 4,0% |

**Le revenu marketplace par transaction est minuscule en valeur absolue.** Une boisson rapporte 0,27€ à Yuno. **Il faut ~37 000 boissons vendues pour faire 10k€ de revenu commission boissons.** Le pilier boissons — celui que le fondateur met en avant — est le **pire générateur de revenu par transaction** (0,27€) ET le pilier que l'intel concurrentielle classe comme un cimetière (Sunday a dû pivoter vers l'OEM POS, les apps QR-bar sont mortes). **Le revenu de Yuno viendra des tables VIP (10€/txn) et des billets (0,99€/txn), pas des boissons.** Le fondateur met en avant le mauvais pilier économique.

## 7.5 LTV / CAC / payback (hypothèses explicites, confiance faible — aucune donnée réelle)

**Aucune métrique réelle n'existe** (0 client, 0 churn observé, 0 CAC mesuré). Tout ci-dessous est modélisé. Confiance : **faible**.

- **ARPU club (hypothèse) :** abo moyen 60€/mois (mix Core gratuit / Essential 49 / Pro 99) + commission. Pour un club faisant 25k€/mois de GMV mixte à ~3,5% net → 875€/mois de commission. **Mais le mix réel sera dominé par Core gratuit au lancement** (le doc admet que « vendre est gratuit »). ARPU abo réaliste an 1 : **20-40€/mois** (beaucoup de Core, peu de Pro). ARPU total (abo+commission) hypothétique : **150-400€/mois/club actif**, ENTIÈREMENT dépendant du GMV par club.
- **Churn (hypothèse) :** SaaS SMB nightlife = saisonnier et volatil. Les clubs ferment, changent de saison, testent puis abandonnent. Churn mensuel hypothétique **5-10%** (élevé, secteur SMB hospitality). LTV = ARPU / churn ≈ 250€ / 0,07 ≈ **3 500€** (confiance faible).
- **CAC (hypothèse) :** vente B2B nightlife = terrain, relationnelle, ville par ville. Un club ne s'auto-onboarde pas. CAC réaliste avec un solo founder qui démarche en direct : **temps founder ≈ gratuit en cash mais coûteux en bus-factor**. Si embauche d'un commercial : CAC **800-2 500€/club** (cycle de vente long, démos, négo). 
- **Payback :** LTV 3 500€ / CAC ~1 500€ = ratio **~2,3×** (sous le 3× sain). Payback ARPU 250€ → ~6 mois si CAC 1 500€. **Acceptable EN THÉORIE, mais entièrement non validé** et fragile au churn élevé. Si churn = 10% et ARPU = 150€, LTV s'effondre à 1 500€ et le ratio LTV/CAC tombe à ~1× → **modèle non finançable**.

## 7.6 Verdict business model

**La structure est bonne (hybride SaaS+marketplace, ne pas paywaller la vente), l'exécution financière est non calibrée et non validée.** Les trois failles fatales du modèle :

1. **Yuno empile sa commission sur Stripe sans posséder l'acquisition ni le hardware** → take rate fragile, compressible, comparé en permanence à Shotgun (0€ abo) et au POS existant.
2. **Le plancher 0,99€ rend le take rate effectif hostile (6-8%) sur les petits paniers étudiants** — précisément le seul wedge défendable.
3. **Le toggle d'absorption rend le take rate négociable de facto** et révèle que la commission est un frein, pas un atout — pricing power réel proche de zéro au lancement.

Le modèle ne s'effondre pas mathématiquement, mais **il n'a aucun pricing power tant qu'aucun club n'a prouvé qu'il paie l'abo Pro pour l'outillage de croissance plutôt que de rester sur Core gratuit + Shotgun.** C'est LA question à 10M€ et elle est à 0% validée.

## 8. Concurrence

## 8. Concurrence

### 8.1 Constat-cadre : Yuno n'affronte pas des concurrents, il affronte une consolidation déjà jouée

Le biais le plus dangereux du dossier fondateur est de traiter la concurrence comme une liste d'acteurs à dépasser. Ce n'est pas la réalité. Sur les 12 mois précédant ce rapport (mi-2024 → mi-2025), les trois piliers exacts de Yuno ont été redécoupés par trois opérations de consolidation majeures :

- **Fever a racheté Dice** (juin 2025) → fusion découverte + billetterie live sous un acteur à ~724 M$ d'ARR.
- **DoorDash a racheté SevenRooms pour 1,2 Md$** (mai 2025, all-cash) → la réservation/CRM hospitality devient une feature d'une plateforme de commerce mondiale.
- **Zenchef a fusionné avec CoverManager sous PSG Equity** (juillet 2025), après Formitable/Resengo/Tablebooker → champion européen de la réservation resto (36 000 restos, 20 pays).

**Lecture VC brutale** : les acheteurs stratégiques du marché de Yuno *sont déjà en train de tout racheter*. Un solo-founder pré-revenu (0 € de CA, 0 client signé, produit non déployé) se positionne face à des bilans de plusieurs centaines de millions, sans aucun des trois actifs qui font gagner ce secteur : **liquidité** (offre d'events), **distribution** (audience fan), **données de transaction**. Yuno a construit 119 pages de logiciel mais possède zéro des trois moats qui comptent. C'est l'inversion exacte de l'ordre de bataille.

**Criticité du constat-cadre : ÉLEVÉ.**

---

### 8.2 Tableau concurrentiel maître

Chaque ligne est notée par pilier de confrontation. "Menace" = niveau de danger pour Yuno aujourd'hui. "Pourquoi IL gagne / IL perd" est l'analyse adversariale. "Angle Yuno" = le seul levier crédible, s'il existe.

| Concurrent | Pilier(s) attaqué(s) | Positionnement | Forces | Faiblesses | Pourquoi IL gagne | Pourquoi IL perd | Angle d'attaque de Yuno | Menace |
|---|---|---|---|---|---|---|---|---|
| **Shotgun** (FR, Paris) | Billet + découverte | Guide nightlife underground + billetterie, fans 18-30, électro/clubs/festivals | Marque culturelle forte chez promoteurs FR ; possède DÉJÀ les orgas/BDE que Yuno veut signer ; capital-efficient | Sous-capitalisé (~3,4 M$ levés, dernier tour public 2020) ; s'arrête au billet — pas de pay-at-table ni bottle service ; pas d'outillage ops club | Il a déjà la liquidité FR sur le segment exact de Yuno (clubs FR, BDE) | S'il reste billet-only, il laisse l'ops club et le partage de revenus co-soirée ouverts ; sous-capitalisation = vulnérable si Fever attaque la France | Le wedge co-soirée club↔BDE contractualisé (event_collab_contracts) que Shotgun ne fait PAS nativement | **CRITIQUE** |
| **Fever** (ES/global) | Découverte + billet | Découverte d'expériences de masse + billetterie + média propriétaire + production d'events (Candlelight) | ~724 M$ ARR, valo ~2 Md$, 40+ pays, 527 M$ levés, EBITDA positif ; seul acteur qui combine découverte de masse + billet + capital + rentabilité | Généraliste "experiences", pas spécialiste club/bottle service/boisson ; ne descend pas dans l'ops opérationnelle club | Capital + distribution + rentabilité ; peut racheter ou écraser n'importe qui s'il décide d'entrer | S'il ne voit jamais le segment club FR de ville moyenne (trop petit pour lui), il l'ignore | Profondeur verticale ops club (staff, VIP, co-soirée) que Fever ne descendra jamais faire ; Yuno gagne par indifférence de Fever, pas par confrontation | **CRITIQUE** (sur découverte+billet) |
| **Xceed** (Barcelone) | **Les 3 piliers** | Guestlist gratuite + tickets + VIP bottle service, QR 2-taps, + volet B2B "Xceed Pro" | **25 M de clubbers** ; fait DÉJÀ guestlist+ticket+VIP ; présent Barcelone/Madrid/Ibiza/**Paris/Marseille/Toulouse**/Lisbonne/Rome/Milan/Londres = terrain exact de Yuno ; network effect cold-start déjà résolu | Pas (ou peu) de commande de boissons skip-the-bar ; outillage ops club (bouncer/vestiaire/hôte VIP) moins poussé | C'est le contre-exemple vivant : la thèse multi-pilier de Yuno EST faisable… mais déjà occupée avec 25 M d'users | S'il néglige les villes FR secondaires et l'outillage staff opérationnel profond | Outillage opérationnel club + co-soirée BDE dans les villes FR que Xceed couvre en surface, pas en profondeur | **CRITIQUE** (analogue le plus dangereux) |
| **Dice** (UK, filiale Fever) | Billet | Anti-touting, allocation, fan-first | ~238 M$ levés historiques, marque fan forte ; désormais munition de Fever | Licenciements 2023, racheté = perte d'autonomie | Via Fever | Indirect | Voir Fever | MOYENNE (indirecte, via Fever) |
| **Weezevent** (FR/BE) | Billet + cashless | Cashless festival + contrôle d'accès, leader EU cashless (post-fusion PlayPass) | **350 M€ CA (2023)**, ~15 000 events, clients Hellfest/Rock en Seine/F1/PSG, ancrage FR/EU | Orienté gros événements/festivals, pas l'expérience club récurrente ni le bottle service | Domine le cashless festival FR avec un bilan énorme | S'il reste sur le festival/grand event et ignore le club récurrent | Yuno ne joue pas le festival ; pas de collision frontale SI Yuno reste sur le club récurrent | ÉLEVÉE (si Yuno vise les festivals — à éviter) |
| **Eventbrite** (global) | Billet | Billetterie self-service généraliste mondiale | Échelle mondiale, distribution SEO | Faible sur nightlife premium, commodité pas premium, marque "corporate event" | Volume et notoriété | Sur le nightlife premium FR, il ne se bat même pas | Yuno est premium/curé là où Eventbrite est commodité | FAIBLE |
| **Resident Advisor (RA)** | Billet (électro) | Billetterie spécialisée électronique anti-touting + autorité culturelle | 27 M de fans, 50 pays, autorité absolue sur le clubbing électro, ownership data promoteur | Pas de bottle service ni pay-at-table, modèle communautaire | Sur les clubs électro exigeants, il est l'autorité | Sur le mainstream/bars et l'ops club, il n'est pas présent | Yuno cible mainstream + ops, pas le purisme électro | ÉLEVÉE (segment électro) / FAIBLE (mainstream) |
| **Partiful** (US, a16z) | — | Consumer social : invitations entre amis | 500k MAU, valo ~140 M$, viralité UX exemplaire | **Pas du B2B nightlife** — pas le marché de Yuno | N/A (faux concurrent) | N/A | À retirer des menaces. Inspiration UX pure sur la viralité de l'invitation | **FAIBLE (faux concurrent)** |
| **Sunday** (sunday.app) | Boisson / pay-at-table | Pay-at-table QR resto, désormais infra POS-intégrée | 3 500 restos, **a triplé sa base en 12 mois, 21 M$ levés fin 2025**, OEM NCR Voyix (Aloha Pay-at-Table powered by sunday) | A dû brûler du cash + couper 60% des marchés (2022) avant de retrouver la croissance | Mieux capitalisé que Yuno sur le mécanisme exact ; a trouvé la valeur dans l'intégration POS | S'il reste resto et ne touche pas le club nightlife | Yuno ne devrait PAS jouer ce pilier — c'est un marché dur que Sunday a failli ne pas survivre | **CRITIQUE** (preuve que le pilier boisson est un piège) |
| **Tablelist / TablelistPro** (US) | VIP + ops | VIP bottle service fan + logiciel gestion club (résa VIP, ticketing, guest list, staff, CRM) | L'analogue B2B le plus proche du périmètre Yuno ; intégration résa→ops | US-centré, pas de boisson skip-the-bar, marque faible hors US | Aux US, il a le précédent du modèle multi-surface | Absent d'Europe | **Preuve que le modèle multi-surface existe** → Yuno n'invente pas la catégorie ; l'EU continentale est ouverte | MOYENNE (absent EU) |
| **Discotech** (US) | VIP + billet | Bottle service + guestlist + tickets, marketplace fan | 1 000+ clubs, référence produit US/Vegas | US/Vegas-centré, absent EU | Aux US, échelle réelle | Absent EU | Référence produit, pas une menace EU | FAIBLE (EU) |
| **SevenRooms** (DoorDash, 1,2 Md$) | VIP / CRM résa | CRM + réservations + table management hospitality premium | Adossé à DoorDash (commerce mondial), CRM premium | Resto-centré, pas nightlife club ; si DoorDash pousse l'EU = menace | Capital DoorDash + CRM premium | S'il reste resto haut de gamme et n'entre pas dans le club nightlife EU | Yuno = nightlife club spécifique, pas CRM resto | ÉLEVÉE (CRM/résa premium si DoorDash pousse EU) |
| **Zenchef + CoverManager** (PSG Equity) | Résa (resto) | Champion EU réservation resto | 36 000 restos, 20 pays, bilan PE | Resto, pas nightlife club/bottle service | Domine la résa resto EU | Le club nightlife n'est pas son cœur | Yuno = nightlife, pas résa resto ; adjacent mais pas frontal | MOYENNE (adjacence, débordement possible) |
| **POS modernes** (Toast 23-28%, Square 27%, Lightspeed, SumUp, Zettle) | **Boisson / encaissement** | Propriétaires du terminal d'encaissement bar | Possèdent DÉJÀ le hardware, les données de vente, le terminal ; mieux installés que quiconque | Pas de couche découverte/billet/VIP fan-facing | Ils détiennent l'encaissement — Yuno ne le remplace pas | Ils ne font pas la découverte ni la co-soirée orga | Yuno doit s'INTÉGRER (pas concurrencer) — or **aucune intégration POS n'existe dans le code** | **CRITIQUE** (le pilier boisson affronte l'incumbent le mieux installé) |
| **Order & Pay / Glady / Yoello / Butlr / Barpay / Rooam** | Boisson skip-the-bar | Apps QR-order bars/clubs locales | Quelques traction régionales | **Cimetière d'apps mono-ville** ; aucun gagnant paneuropéen émergé | Localement, parfois | Le JTBD échoue en rush (le bar n'a pas la main-d'œuvre pour préparer les commandes app à 1h) | **Aucun** — l'absence de gagnant ici n'est PAS un espace blanc, c'est un signal que le job ne tient pas | **CRITIQUE comme signal** (pas comme concurrent) |

---

### 8.3 Analyse par pilier : où Yuno se bat, et contre qui

#### Pilier 1 — Billetterie / découverte (le plus contesté)

C'est le pilier le plus **encombré** et le plus **consolidé**. Trois incumbents financés y règnent : **Shotgun** possède déjà les promoteurs et BDE FR que Yuno veut signer ; **Fever** a le capital et la rentabilité pour écraser ou ignorer ; **Xceed** fait déjà les trois piliers avec 25 M d'utilisateurs sur le terrain géographique exact de Yuno (Paris, Marseille, Toulouse). **Crossing the Chasm** est sans appel ici : on ne traverse pas le gouffre en attaquant un segment déjà tenu par un incumbent installé sans tête de pont à soi. Yuno n'a même pas d'early adopters.

**Verdict pilier 1** : confrontation frontale = suicidaire. Le seul angle est de NE PAS vendre du billet "comme Shotgun" mais de vendre le billet **comme sous-produit de la co-soirée club↔BDE** — un wedge où l'orga vient pour le partage de revenus contractualisé, pas pour la billetterie nue.

#### Pilier 2 — Tables VIP / bottle service

Le seul pilier avec un **espace blanc géographique crédible**. Tablelist/Discotech = US. Xceed = Sud EU + Ibiza. **L'Europe continentale hors Espagne/Ibiza est sous-servie** en bottle service "premium app". C'est le seul angle Blue Ocean défendable de Yuno. **MAIS** le marché est étroit : peu de villes FR ont une vraie culture bottle service (Paris, Côte d'Azur, quelques métropoles). Le SOM est petit. C'est un wedge réel mais pas un marché de licorne à lui seul.

#### Pilier 3 — Commande de boissons skip-the-bar (le plus faible — le fondateur le met en avant comme MVP)

**C'est le pilier que le fondateur présente comme son MVP, et c'est objectivement le plus mauvais.** Trois preuves convergentes :

1. **Le segment est un cimetière** : Yoello, Butlr, Barpay, Rooam — aucun gagnant paneuropéen. Ce n'est pas un espace blanc, c'est un signal que le JTBD ne tient pas en club bondé à 1h du matin.
2. **Sunday, mieux capitalisé, a failli ne pas survivre** au même mécanisme (coupe 60% des marchés, pivot 2022). Il n'a survécu qu'en devenant **infrastructure POS** (OEM NCR), pas app fan. La valeur est dans l'intégration POS — que Yuno n'a pas.
3. **Les POS (Toast/Square) possèdent l'encaissement.** Yuno ne remplace pas un POS, il s'y branche ou il meurt. Or il n'existe **aucune intégration POS** dans le code. Le pilier boisson de Yuno affronte donc frontalement l'incumbent le mieux installé du bar, sans l'actif clé.

**Verdict pilier 3 : à tuer.** Garder ce pilier comme "MVP" est l'erreur de focus la plus coûteuse du dossier.

---

### 8.4 Frameworks appliqués

| Framework | Verdict appliqué à Yuno |
|---|---|
| **Crossing the Chasm (Moore)** | Yuno vise simultanément 6 segments B2B (clubs, orgas/BDE, promoteurs, affiliés, DJs, staff) = 6 "main streets" sans tête de pont. Moore est catégorique : on prend UN segment, on le domine, on traverse. Yuno fait l'inverse exact. **Sans early adopters, le gouffre n'est pas franchissable.** |
| **Cold Start Problem (Chen)** | Tout marketplace nightlife meurt sans liquidité locale (assez d'events ET de fans dans UNE ville). Fever/Shotgun/Xceed ont résolu le cold start ; Yuno part de zéro contre eux. Le réseau ne démarre pas avec 119 pages, il démarre avec **un club rempli un samedi soir**. Le code construit ne crée aucune liquidité. |
| **Porter (5 forces)** | Pouvoir des acheteurs (clubs) = ÉLEVÉ (ils ont déjà un POS + Shotgun). Menace des substituts = MAXIMALE (cash + barman + POS existant). Barrières à l'entrée pour Yuno = quasi nulles ; pour ses rivaux = capital + réseau. **Mauvaise structure d'industrie pour un entrant non financé.** |
| **Blue Ocean** | **Pas d'océan bleu sur les 3 piliers à la fois.** Chaque pilier est rouge avec un incumbent dominant. Le seul filet d'eau bleue : bottle service EU continentale + co-soirée BDE contractualisée. |
| **Network effects** | Aucun effet de réseau amorcé (0 user, 0 club). Les rivaux ont des effets de réseau cross-side déjà tournants. Yuno est en position de pur retardataire sans flywheel. |

---

### 8.5 Conclusion : se battre sur 3-4 marchés contre des spécialistes financés est-il tenable ?

**Non. En l'état, c'est intenable et structurellement perdant.** Yuno se positionne simultanément contre :
- **Shotgun + Fever + Xceed** sur le billet/découverte (océan rouge consolidé),
- **Tablelist + Xceed + SevenRooms/DoorDash** sur le VIP (un espace blanc EU mince),
- **Toast + Square + Sunday** sur la boisson (océan rouge ET cimetière, sans l'actif POS requis).

Être faible partout contre des acteurs qui sont forts chacun sur leur pilier, avec 100 à 5 000 fois la surface économique de Yuno (qui est à zéro), n'est pas une stratégie — c'est une dispersion fatale. **Le danger n'est pas l'incapacité à construire (l'exécution solo est impressionnante), c'est d'avoir construit à l'envers : 119 pages avant un club signé, 6 segments avant 1 tête de pont, 3 piliers dont 2 sont déjà perdus.**

### 8.6 L'angle d'attaque le moins suicidaire

Il existe **un seul wedge défendable**, et il est déjà à moitié construit dans le code :

> **L'OS opérationnel du club FR de ville moyenne, ancré sur la collaboration club↔organisateur/BDE avec contrats de partage de revenus signés (event_collab_contracts, contrat-cadre récurrent).**

Pourquoi c'est le seul angle crédible :

1. **C'est un JTBD réel et mal servi.** Le partage de revenus contractualisé entre un club et une asso étudiante sur une co-soirée récurrente, Shotgun/Fever/Xceed ne le font **pas nativement**. C'est le seul morceau où Yuno fait quelque chose que les incumbents ne font pas.
2. **C'est géographiquement ancré.** Le BDE est une institution française. C'est un fossé culturel que les acteurs ES/UK/US ne traversent pas facilement.
3. **Ça crée la liquidité par le côté offre.** Une asso étudiante apporte sa propre audience (la promesse de remplissage), ce qui attaque le cold-start par le seul côté qui a un effet de levier : l'orga amène ses gens, le club amène son lieu.
4. **Le bottle service EU continentale** peut être un add-on de monétisation par-dessus ce wedge, pas un pilier autonome.

**Ce que cela implique de tuer immédiatement** : le pilier boisson skip-the-bar (cimetière + pas d'intégration POS), 4 des 6 rôles (garder club owner + orga/BDE, geler promoteur/affilié/DJ-marketplace/staff complet pour plus tard). Prouver la liquidité dans **3-5 clubs FR réels** sur le wedge co-soirée, PUIS étendre. C'est l'ordre de bataille inverse de celui suivi jusqu'ici.

**Sinon : Yuno se fait écraser par Xceed (même périmètre, 25 M d'users, cold-start résolu) ou ignorer par Fever (qui ne le verra jamais).** Les deux issues sont mortelles. La fenêtre n'est pas "construire plus", elle est "se concentrer sur le seul morceau que personne d'autre ne sert et où l'orga apporte la liquidité gratuitement".

## 9. Moat — l'avantage concurrentiel défendable (ou son absence)

## 9. Moat — l'avantage concurrentiel défendable

### 9.0 Verdict en une phrase

**Yuno n'a aucun moat aujourd'hui. Zéro. Et la quasi-totalité de ce qui est construit est copiable par Shotgun, Sunday ou Xceed en un trimestre — la plupart en deux semaines.** Le seul actif potentiellement défendable n'est pas dans les trois piliers que le fondateur met en avant : c'est un détail enterré dans le code (le contrat-cadre récurrent club↔BDE). Et même celui-là n'est PAS un moat tant qu'il n'a pas de réseau autour. Un moat est un *résultat*, pas une *feature*. À ce jour Yuno a des features ; il n'a aucun résultat.

Je rappelle la définition opératoire d'un moat (Warren Buffett / Hamilton Helmer, *7 Powers*) : c'est ce qui permet de **maintenir des prix supérieurs aux coûts dans la durée malgré la concurrence**. Il faut DEUX conditions simultanées : un *benefit* (les clients préfèrent vous) ET une *barrier* (le concurrent ne peut pas répliquer le benefit sans coût prohibitif). Yuno n'a, pour l'instant, ni l'un ni l'autre prouvé sur le marché.

### 9.1 Passons en revue les 5 sources classiques de moat

| Source de moat | Yuno a-t-il ça ? | Défendable ? | Copiable par Shotgun/Sunday/Xceed en… |
|---|---|---|---|
| **Données** (data network effect) | Non — 0 transaction, 0 client | Non | N/A — ils ont déjà les données, Yuno a un schéma vide |
| **Effets de réseau** (marketplace) | Non — cold-start non amorcé sur aucune ville | Non | Ils les ont déjà résolus (Fever 40 pays, Xceed 25 M users) |
| **Marque** | Non — inconnue, 0 fan, 0 promoteur | Non | Shotgun EST la marque culturelle clubbing FR |
| **Technologie / coûts** | Non — Stripe Connect + Supabase = commodités assemblées | Non | C'est leur stack aussi. 1 trimestre max |
| **Distribution / switching cost** | Non — aucun club branché, aucun verrouillage | Non | Ils ont la distribution ; Yuno part de 0 |

**Score brutal : 0/5.** Aucune des cinq cases n'est cochée avec une preuve marché. Ce tableau est le cœur du problème : Yuno a construit l'équivalent de l'inventaire d'une usine sans avoir signé un seul client, dans une industrie où l'inventaire n'a aucune valeur sans réseau.

### 9.2 Pourquoi chaque "avantage" supposé tombe sous la première pression

**"On a 3 piliers intégrés, personne d'autre."** Faux et dangereux. (1) Xceed fait DÉJÀ guestlist + billet + bottle service, sur exactement la même géographie (Barcelone, Madrid, Ibiza, Paris, Marseille, Toulouse, Lisbonne), avec 25 M de clubbers. L'intégration multi-pilier n'est pas un moat, c'est une *table stake* déjà occupée. (2) L'intégration n'est un moat que si elle crée un *switching cost* ou un *network effect* — or aucun club n'est branché, donc le coût de départ est nul. Un "bundle" sans réseau n'est pas un moat, c'est juste plus de surface à maintenir (94 edge functions, 495 migrations) pour un seul développeur.

**"Notre architecture financière Stripe Connect double destination est sophistiquée."** Vraie sophistication d'exécution (je la crédite en §moat-positif ci-dessous), mais **techniquement non-défendable**. Stripe Connect direct charges + `on_behalf_of` + application_fee est documenté publiquement par Stripe ; n'importe quel ingénieur le réimplémente en 2-3 semaines. Ce n'est pas un brevet, c'est un tutoriel. Sunday, Shotgun et Weezevent ont tous une plomberie Connect équivalente ou supérieure (Weezevent traite 350 M€ de GMV cashless).

**"On a des contrats co-soirée eIDAS signés."** C'est le point le plus intéressant — voir 9.3 — mais le PDF eIDAS lui-même n'est pas le moat (DocuSign le fait, n'importe qui peut générer un PDF horodaté). Le moat *potentiel* est le réseau bilatéral club↔asso, pas le bout de papier.

**"On collecte la data client."** Vous collecterez la data *quand vous aurez des transactions*. À 0 transaction, le data moat est une promesse, pas un actif. Et c'est un moat à retardement très long : il faut des centaines de milliers de transactions par ville avant que la data crée un avantage de recommandation/ciblage qu'un nouvel entrant ne peut rattraper. Fever a 724 M$ d'ARR de data d'avance.

### 9.3 Le SEUL wedge potentiellement défendable : le réseau club↔BDE contractualisé

C'est le constat le plus important de toute cette section, et il contredit le fondateur. Le code montre un investissement massif et réel sur **la collaboration club↔organisateur/BDE** : `event_collab_contracts` (1:1 par événement), un contrat-cadre récurrent (migration `20260626140000`, **33 Ko** — la plus grosse du repo), splits de revenus négociables tickets/tables/boissons, double-consentement pour pause/suppression, rétention des payouts partenaire, attestation alcool de l'orga. C'est le seul morceau de Yuno qui fait quelque chose que **Shotgun, Fever et Xceed ne font PAS nativement** : le partage de revenus contractualisé entre un club et une association étudiante sur une co-soirée récurrente.

Pourquoi c'est potentiellement un moat (les deux conditions de Helmer) :
- **Benefit réel** : un BDE qui co-organise sa soirée mensuelle dans un club a un vrai JTBD (Jobs To Be Done) mal servi — sécuriser sa part de revenu, signer une fois pour la résidence, voir sa démographie. Shotgun s'arrête au billet ; il ne gère pas le split contractuel club↔asso.
- **Barrier possible (2-sided + ancrage géo)** : le BDE est un phénomène **français/européen continental** que les acteurs US (Tablelist, Discotech) ignorent, et que les acteurs FR (Shotgun) traitent comme un simple émetteur de billets. Si Yuno verrouille la relation contractuelle récurrente entre N clubs et M assos d'une même ville, il crée un **effet de réseau biparti local** : plus de clubs sur Yuno → plus d'assos veulent y être → et inversement. C'est le *seul* endroit où le Cold Start (Andrew Chen) peut s'amorcer avec une atomic network minuscule (1 club + 3-5 BDE d'une ville étudiante = liquidité suffisante).

**Mais ATTENTION — ce n'est un moat que SI :** (a) Yuno tue les 2 autres piliers et 4 des 6 rôles pour concentrer toute la vélocité dessus ; (b) il prouve la rétention récurrente sur 3-5 villes étudiantes réelles (Lille, Lyon, Toulouse, Montpellier, Rennes) ; (c) le switching cost devient réel parce que l'historique de revenus, les contrats signés et la base de fans étudiants vivent dans Yuno. Aujourd'hui, **rien de tout ça n'est prouvé**. Le code existe, le réseau n'existe pas. Criticité de la confusion feature-vs-moat : **élevée**.

### 9.4 Ce qui est, à l'inverse, copiable en un trimestre par les incumbents

| Capacité Yuno | Qui copie | Délai estimé | Confiance |
|---|---|---|---|
| Commande boisson skip-queue | Toast/Square/Sunday (ont déjà le POS) | Déjà fait ou 1 mois | élevée |
| Billetterie + QR entrée | Shotgun/Dice/Xceed (cœur de métier) | Déjà fait | élevée |
| Tables VIP / bottle service | Xceed (déjà), Tablelist (déjà) | Déjà fait | élevée |
| Stripe Connect split co-event | N'importe quel concurrent capitalisé | 2-4 semaines | élevée |
| Analytics démographie/origines | Shotgun/Fever (ont déjà la data) | 1 mois | moyenne |
| **Contrat-cadre récurrent club↔BDE** | Shotgun (a les promoteurs FR), mais pas leur ADN | 1-2 trimestres + ils n'y pensent pas | **moyenne** |

La seule ligne où le délai dépasse un trimestre ET où l'incumbent n'a pas l'incitation immédiate à le faire, c'est le contrat club↔BDE. Tout le reste est rattrapable trivialement par un acteur qui a déjà la distribution. **Construire largement ne crée pas de moat ; ça crée juste plus de choses à défendre avec moins de focus.**

### 9.5 Comment construire un VRAI moat à partir d'ici (séquencement)

1. **Choisir le réseau, pas le produit.** Le moat de Yuno ne peut être qu'un *network effect local biparti* sur le segment BDE↔club. Tout le reste est commodité.
2. **Dominer UNE ville étudiante** (Crossing the Chasm : une tête de pont, pas 6 segments). Objectif : 1 club + 5 BDE + 3 soirées récurrentes signées, liquidité prouvée un samedi soir réel.
3. **Transformer le contrat récurrent en switching cost** : l'historique financier, les contrats eIDAS, la base de fans étudiants et les analytics démographiques doivent devenir le *system of record* du club ET de l'asso. Partir de Yuno = perdre son historique de partage de revenus. C'est le seul verrou crédible.
4. **Empiler un data network effect par-dessus, plus tard** : une fois 5-10 villes verrouillées, la donnée croisée fans/soirées/démographie devient un avantage de matching qu'un nouvel entrant ne rattrape pas. Mais c'est une conséquence du réseau, pas un point de départ.
5. **Ne jamais affronter Toast/Square sur l'encaissement boisson** : c'est un combat perdu d'avance (ils ont le hardware et le terminal). S'intégrer au POS, pas le remplacer.

**En clair : Yuno doit cesser d'être "l'OS du nightlife" (ocean, indéfendable) et devenir "le rail de co-soirée club↔asso étudiante en France" (lake, défendable par effet de réseau local).** C'est le seul chemin vers un moat. Aujourd'hui le moat = 0, et 95 % du code construit ne contribue pas à le créer.

## 10. Go-To-Market — la ville, la tête de pont, la première vente

## 10.1 Verdict d'entrée : tu n'as pas de problème de produit, tu as un problème de tête de pont

Reprends le constat brutal en une ligne : **119 pages, 0 client.** Tu as construit l'OS du nightlife avant d'avoir prouvé qu'une seule personne en France veut payer pour une seule de tes features. Un GTM, ce n'est pas "comment je vends mes 3 piliers à 6 rôles". C'est : **quel est le plus petit segment que je peux dominer entièrement, dans une seule ville, en un seul samedi soir.** Tout le reste est de la distraction qui te coûte du temps de runway.

**Crossing the Chasm (Moore) appliqué sans pitié.** Tu n'as même pas d'early adopters — tu es *avant* le early market. Pire : tu vises simultanément 6 segments B2B (clubs, orgas/BDE, promoteurs, affiliés, DJs, staff) et 3 piliers. Moore est catégorique et il a raison : **on prend UNE niche, on la sature, on en fait une référence, PUIS on traverse le gouffre vers l'adjacent.** Faire l'inverse — viser large pour "maximiser le marché" — est la cause de mort n°1 des marketplaces pré-PMF. Tu n'as pas assez de force de frappe (1 fondateur, 0€ de CA, 0 brand) pour allumer 6 réseaux à froid en parallèle. Le réseau ne démarre pas avec 119 pages. Il démarre avec **un club rempli un samedi soir grâce à toi.**

## 10.2 LE WEDGE : co-soirée club ↔ BDE étudiant (et rien d'autre au lancement)

Vérifié dans le code, c'est ton SEUL actif réellement différencié. Personne ne le fait nativement parmi tes concurrents :

- `collabContractTerms.ts` (447 LOC) + `collabContractData.ts` : couche de contrat numérique club↔orga signé.
- Migration `20260626140000_collab_series_contract.sql` = **33 Ko** : le contrat-cadre récurrent — l'orga signe UNE fois, toutes les occurrences de la résidence sont auto-acceptées, avec partage de revenus contractualisé (tickets/tables/boissons), preuve par soirée, résiliable pour l'avenir.
- `20260624160000_bde_event_moderation_gate.sql` : compte BDE vérifié, plancher commission 0,49€, soirées privées par défaut.
- Toute la chaîne consentement à double accord (`collab_action_consent.sql`, 16 Ko), notifications, amendements.

**Pourquoi c'est LE wedge (Jobs-To-Be-Done) :** Une asso étudiante (BDE) qui organise sa soirée mensuelle dans un club fait aujourd'hui ça avec un **Google Sheet, des virements Lydia, un fichier Excel de guestlist, et une engueulade post-soirée sur "qui a vendu combien et qui touche quoi".** Le JTBD réel : *"je veux co-organiser une soirée récurrente avec un club, partager les recettes de façon claire et automatique, sans me battre sur les chiffres ni avancer la trésorerie."* Shotgun ne fait PAS ça (il s'arrête au billet, le partage de revenu club↔asso n'est pas contractualisé). Fever/Xceed non plus. C'est un JTBD réel, mal servi, **géographiquement ancré en France** (les BDE/BDS, c'est une institution française : ~3 500 écoles supérieures, chacune avec un bureau des étudiants qui fait 3-10 soirées/an).

**Décision GTM n°1, non négociable : au lancement tu vends UNIQUEMENT "la co-soirée club↔BDE clé en main". Pas le pilier boissons. Pas le booking DJ. Pas l'affiliation multi-ville.** Tout ça reste dans le code, dormant, dé-priorisé du discours commercial. Tu vends un wedge, pas un OS.

## 10.3 La ville : LYON (et voici pourquoi, pas Paris)

Je défends un choix précis. Classement des candidates :

| Ville | Densité étudiante | Densité clubs co-soirée | Concurrence (Shotgun) | Accès terrain solo | Verdict |
|---|---|---|---|---|---|
| **Paris** | Très élevée | Très élevée | **Saturée** (Shotgun est né là, possède les promoteurs) | Diluée, anonyme | ❌ Tu te fais écraser |
| **Lyon** | ~160 000 étudiants, 2e pôle FR | Élevée (clubs + ~30 grandes écoles/fac avec BDE actifs) | Présent mais **pas dominant** | Ville à taille humaine, scène concentrée | ✅ **CHOIX** |
| Toulouse | ~130 000 étudiants | Moyenne | Faible | Bon, mais scène club plus diffuse | 🥈 Plan B |
| Montpellier | Très étudiante | Moyenne-faible (peu de gros clubs) | Faible | Bon | 🥉 |
| Lille | ~115 000 étudiants, grosses écoles | Moyenne | Présent | Bon (proximité BDE↔clubs) | Alternative crédible |

**Pourquoi Lyon précisément (Cold Start Theory, Chen) :**

1. **La liquidité atomique est atteignable.** Le "réseau atomique" minimal de Chen pour ton wedge = *1 club + 1 BDE + assez d'étudiants de cette école pour remplir une soirée.* Lyon a une densité où un seul fondateur peut, à pied/métro, couvrir physiquement la scène : ~10-15 clubs qui comptent, ~30 BDE/BDS de grandes écoles (EM Lyon, INSA, Centrale, IAE, les fac Lyon 1/2/3). **Tu peux serrer toutes les mains qui comptent en 3 semaines.** À Paris, c'est 10× la surface et tu es invisible.
2. **Le côté "hard side" du marketplace est le club, pas l'étudiant.** Chen : on commence par le côté difficile à acquérir. Le club est rare et a du pouvoir de négociation (il a déjà un POS, déjà Shotgun). Lyon te donne un nombre de clubs assez petit pour les signer un par un, assez grand pour créer une preuve sociale locale ("3 clubs lyonnais utilisent Yuno" est crédible ; "3 clubs parisiens" est noyé).
3. **L'étudiant est le "easy side" qui se remplit tout seul SI le BDE pousse.** Le BDE EST ton canal de distribution B2C gratuit (cf. §11). Un BDE qui adopte = 200-2000 étudiants poussés vers l'app sans CAC.
4. **Single-city density (la règle d'or marketplace).** Mieux vaut être à 80% de pénétration dans Lyon qu'à 2% dans 10 villes. Tu veux que, à Lyon, "co-soirée étudiante = Yuno" devienne un réflexe. C'est la seule façon de générer du bouche-à-oreille et de la preuve sociale qui passe le gouffre.

**Niveau de confiance : moyen.** Lyon vs Lille vs Toulouse est défendable dans les trois sens ; ce qui n'est PAS débattable c'est **NE PAS lancer à Paris d'abord** (suicide concurrentiel) et **UNE seule ville**. Donnée manquante critique : où Paul a-t-il un réseau personnel (ancien BDE, club ami, ville d'origine) ? **Le bon choix de ville #1 est souvent "là où le fondateur a un avantage déloyal de réseau"** — si Paul connaît 2 patrons de club à Montpellier, lance Montpellier. L'avantage relationnel bat la taille de marché à ce stade. Je n'ai pas cette info ; elle peut renverser le choix Lyon.

## 10.4 Signer les 5 premiers clubs : la vente B2B terrain

**Cible : 3 à 5 clubs lyonnais, pas plus.** C'est ton "bowling pin" (Moore). Tu n'as pas besoin de 50 clubs, tu as besoin de 3 qui font des co-soirées étudiantes et qui deviennent ta vitrine.

**Le cycle de vente réel (B2B nightlife, criticité du timing) :**

- **Le club décide en 1-2 rendez-vous physiques, jamais par email.** Le patron de club est un opérateur terrain, méfiant, occupé, sollicité. Tu ne vends pas par démo Zoom. Tu vas au club en semaine (mardi-jeudi après-midi, jamais le week-end), tu paies un verre, tu montres l'app sur ton téléphone.
- **Cycle réaliste : 2-6 semaines** entre premier contact et première soirée live. Le facteur limitant n'est pas la décision (rapide), c'est **le calendrier de la prochaine co-soirée BDE** (elles sont planifiées 1-2 mois à l'avance).
- **Pré-requis bloquant que tu ne contrôles pas encore :** le club doit faire son onboarding Stripe Connect (KYC). C'est ton point de friction n°1 dans le funnel d'activation. Prévois de l'accompagner main dans la main.

**Le pitch (30 secondes, pas de pitch deck) :**
> "Tu fais des soirées étudiantes avec les BDE. Aujourd'hui le partage des recettes avec l'asso c'est l'enfer — Excel, virements, prises de tête. Yuno: l'asso et toi signez un contrat de partage une fois, ensuite chaque billet, chaque table, chaque conso se split automatiquement, chacun reçoit sa part sur son compte, et tu as le rapport clair à la fin. Tu ne changes RIEN à ta caisse. Première soirée gratuite, je suis là le soir pour que ça roule."

**Les 5 objections que tu vas entendre (et la réponse) :**

1. *"J'ai déjà Shotgun."* → "Garde Shotgun pour la billetterie grand public. Yuno c'est pour TES co-soirées BDE, là où Shotgun ne gère pas le partage avec l'asso. Les deux coexistent." (Ne JAMAIS attaquer Shotgun frontalement — tu perds.)
2. *"J'ai déjà une caisse / un POS."* → "On ne touche pas à ta caisse. Yuno, c'est la billetterie + le partage avec l'asso, en amont. Ta caisse reste ta caisse." (CRITIQUE : ton pilier boissons concurrence le POS = guerre perdue. NE LE MENTIONNE PAS en vente.)
3. *"C'est quoi la commission ?"* → "4% sur les billets et tables, 3% sur les boissons. Et tu peux choisir de l'absorber ou de la faire payer au client" (le toggle `absorb_yuno_fees` est ici une vraie arme).
4. *"Et si ça bug le soir J ?"* → Ta plus grosse objection, légitime, et **tu as ZÉRO test automatisé pour la rassurer.** Réponse : "Je suis physiquement présent à chaque première soirée." Ça ne scale pas mais c'est la seule réponse honnête à ce stade. **Criticité élevée : un bug de paiement ou de scan QR un samedi soir bondé = mort de ta réputation locale, et le bouche-à-oreille nightlife est impitoyable.**
5. *"L'app est utilisée par d'autres clubs ?"* → Le problème du cold start. Réponse honnête au club #1 : "Tu es le premier à Lyon, je te donne 6 mois gratuits + je m'occupe de tout." (le toggle early-adopter 90j existe déjà ; étends-le.)

## 10.5 Premiers utilisateurs B2C : le BDE EST le canal, pas un canal

Ici ta thèse multi-faces devient un atout au lieu d'un fardeau. **Tu n'acquiers PAS les étudiants un par un.** Tu signes le BDE, et le BDE pousse ses 200-2000 membres vers l'app pour leur propre soirée. C'est un **canal de distribution encapsulé** : une signature B2B (le BDE) débloque des centaines d'installs B2C à CAC quasi nul. C'est exactement pourquoi le wedge co-soirée est supérieur au wedge boissons — le pilier boissons n'a aucun distributeur, tu dois acquérir chaque buveur. (Détaillé en §11.)

## 10.6 Viralité : où elle existe vraiment dans ton produit

**Boucles virales réelles déjà dans le code (à activer, pas à construire) :**

1. **Split payment / partage d'addition** → boucle d'invitation : un étudiant achète une table VIP, partage la note avec 5 potes → 5 installs. C'est ta meilleure boucle organique native nightlife (le groupe est l'unité sociale).
2. **Guestlist BDE** : l'asso envoie le lien guestlist → chaque inscrit télécharge l'app pour son QR. Distribution gratuite, virale par construction (l'étudiant n'a pas le choix, son entrée passe par là).
3. **Liens trackés DJ/orga + pages publiques /o /dj** (déjà codé, OG share worker Cloudflare) : chaque DJ/orga partage sa page → acquisition.
4. **Recap post-soirée** ("ta nuit", démographie, hype) : artefact partageable sur les stories Insta. C'est ton hook viral B2C le plus sous-exploité — un beau recap de soirée = pub gratuite.

**Criticité : la viralité ne sauve PAS un cold start non résolu.** Toutes ces boucles ne s'allument que s'il y a *déjà* du contenu (une soirée live, une guestlist remplie). La viralité amplifie la liquidité, elle ne la crée pas. D'où la séquence : club signé → BDE signé → soirée live → boucles virales → 2e BDE de la même ville. Ne compte jamais sur "ça va devenir viral" pour résoudre le démarrage.

## 10.7 Le plan 90 jours (séquence, pas big bang)

| Phase | Semaines | Objectif | Métrique de succès |
|---|---|---|---|
| **0. Pré-launch bloquant** | S1-S2 | Lever cap Supabase 402, P0 admin (refund, suspension, kill-switch event), tester refund Stripe LIVE, age-gate guest checkout (cf. audit conformité — **CRITIQUE**), MFA admin | Une soirée test de bout en bout sans intervention manuelle |
| **1. Tête de pont** | S3-S6 | Signer club #1 + BDE #1 à Lyon, faire 1 co-soirée live (Paul présent) | 1 soirée réelle, 0 incident paiement, NPS club > 8 |
| **2. Densification locale** | S7-S10 | 3-5 clubs, 5-8 BDE, soirées récurrentes via le contrat-cadre | GMV récurrent, 1er club qui REVIENT sans relance |
| **3. Preuve de rétention** | S11-S13 | Mesurer rétention BDE (refont-ils une soirée ?) + take-rate réel | ≥60% des BDE refont une 2e soirée = signal PMF du wedge |

**Le seul signal de PMF qui compte ici : un BDE qui refait une soirée Yuno sans que Paul ait à le relancer.** Tout le reste (installs, GMV brut, nombre de pages) est du théâtre de vanité. Si après 3 co-soirées aucun BDE ne revient spontanément, le wedge est faux et il faut pivoter — pas ajouter une 120e page.

## 11. Acquisition — canaux, CAC réalistes, et pourquoi le BDE est le vrai wedge

## 11.1 La hiérarchie des canaux : un seul a un CAC viable à ton stade

Classement honnête des canaux d'acquisition pour Yuno, du meilleur au pire CAC à ton stade (solo, 0€, pré-PMF). **Toutes les estimations CAC sont des ordres de grandeur, confiance faible-moyenne, hypothèses explicitées — tu n'as AUCUNE donnée réelle, ce sont des benchmarks SaaS/nightlife adaptés.**

| Canal | Cible | CAC estimé | Confiance | Scalabilité | Verdict |
|---|---|---|---|---|---|
| **BDE/asso (B2B2C)** | 1 BDE → 200-2000 étudiants | **~0-15€ par étudiant activé** (coût = temps de Paul ÷ étudiants débloqués) | Moyenne | Encapsulée (limitée au nb de BDE) | ✅ **LE wedge** |
| **Vente terrain club** | Patron de club | **Temps fondateur : ~3-8h/club signé**, CAC monétaire ~0€ | Moyenne | Faible (ne scale pas au-delà de Paul) | ✅ Indispensable mais goulot |
| **Ambassadeurs campus** | Étudiants relais | ~5-20€/install (goodies + commission) | Faible | Moyenne | 🟡 Phase 2 |
| **Referral / parrainage** | Étudiants existants | ~2-8€/install (si boucle native) | Faible | Bonne (si PMF) | 🟡 Gratuit mais nécessite base |
| **TikTok/Insta organique** | Étudiants | Variable, ~0€ direct mais temps énorme | Faible | Bonne si ça prend | 🟡 Hit-or-miss |
| **Insta/TikTok ads payantes** | Étudiants | **~3-8€/install app, mais CAC réel >>30-50€** (install ≠ user actif nightlife) | Faible | Bonne | ❌ Trop tôt, brûle du cash sans PMF |
| **SEO** | Recherche events | ~0€ mais **12-18 mois** de latence | Moyenne | Bonne (long terme) | ❌ Trop lent pour ton runway |
| **Guerrilla (flyers, stickers campus)** | Étudiants | ~1-5€/contact, conversion faible | Faible | Faible | 🟡 Appoint local |

## 11.2 OUI, le levier BDE/étudiant déjà codé EST le vrai wedge — et voici la démonstration

**Confirmé dans le code** (`bde_verified`, plancher commission 0,49€, gate de modération super-admin, soirées privées par défaut). Ce n'est pas un gadget, c'est ton meilleur asset GTM, pour 4 raisons structurelles :

1. **C'est le seul canal avec un effet de levier de distribution (B2B2C).** Tous tes autres canaux B2C sont linéaires (1€ → 1 user). Le BDE est *exponentiel par signature* : 1 acte de vente (signer le BDE) → 200-2000 utilisateurs poussés. C'est la définition d'un wedge à fort levier. Ton **CAC effectif par étudiant tend vers 0** parce que le coût d'acquisition est amorti sur toute l'asso.

2. **Le BDE résout TON cold start à lui seul.** Le problème de la poule et l'œuf (pas d'étudiants sans soirées, pas de soirées sans clubs) est court-circuité : le BDE apporte SIMULTANÉMENT la demande (ses membres) ET aide à apporter l'offre (il a déjà une relation avec un club). C'est rarissime — un canal qui remplit les deux côtés du marketplace d'un coup.

3. **Ancrage géographique = barrière concurrentielle locale.** Les BDE sont une institution **française** que les géants ignorent : Fever (généraliste expériences) et Xceed (clubbers grand public, Sud-EU) ne courtisent pas les bureaux des étudiants un par un. Shotgun touche les promoteurs, pas la mécanique de partage de revenu club↔asso. Tu as un **angle que les incumbents ne défendent pas**, sur un terrain culturel précis.

4. **Rétention naturelle (récurrence intégrée).** Un BDE fait des soirées TOUTE l'année (rentrée, Halloween, gala, fin d'année...). Le contrat-cadre récurrent que tu as codé (`collab_series_contract`, 33 Ko) transforme une signature en revenu récurrent automatique. C'est ton meilleur mécanisme de rétention, déjà construit.

**Réserve critique (criticité élevée) : le BDE est un wedge à fort levier MAIS à plafond bas (petit SOM).** Il y a ~3 500 établissements d'enseignement supérieur en France, mais seule une fraction a un BDE actif organisant de vraies soirées en club récurrentes — estimation réaliste : **800-1500 BDE "adressables"** qui font ≥2 soirées club/an. À ~3-8 soirées/BDE/an et un panier moyen de quelques milliers d'euros de GMV par soirée, le **SAM du wedge BDE pur est de l'ordre de quelques dizaines de millions d'euros de GMV/an, soit ~1-3 M€ de commission/an à saturation nationale** (confiance faible, hypothèses : ~1000 BDE actifs × ~5 soirées × ~5-10k€ GMV × 3,5% take). **C'est un excellent point d'entrée, PAS une thèse de licorne à lui seul.** Le wedge BDE est ta porte d'entrée pour traverser le gouffre (Moore) vers le marché adjacent — les co-soirées promoteurs, puis la billetterie club récurrente — mais ne le confonds pas avec le marché final. Si tu lèves sur "on va dominer le BDE français", l'investisseur lucide verra le plafond. Le bon récit : *"le BDE est le wedge de cold start ; le marché est l'OS opérationnel du club FR de ville moyenne, qu'on atteint via les co-soirées."*

## 11.3 Acquisition B2B (les clubs) : il n'y a qu'une méthode et elle ne scale pas (encore)

**Vente directe terrain, point.** À ton stade, oublie le channel/revendeurs, oublie l'inbound, oublie les ads B2B.

- **Coût : le temps de Paul.** ~3-8h par club signé (repérage, RDV, onboarding Stripe, présence soirée 1). CAC monétaire ≈ 0€, CAC en temps = ton goulot d'étranglement réel.
- **Le bus factor = 1 est ici un risque de croissance, pas juste un risque technique (criticité élevée).** Tant que Paul est le seul commercial, ton acquisition B2B plafonne à ~1-2 clubs/semaine en sprint. Au-delà de Lyon, il te faut soit un commercial, soit que le produit s'auto-vende par preuve sociale locale (les clubs lyonnais en parlent entre eux). Ne lève pas avant d'avoir prouvé que la preuve sociale locale réduit le temps de vente du club #4 vs club #1.
- **Channel secondaire à terme : le BDE comme prescripteur inverse.** Un BDE qui adore Yuno peut *traîner* son club préféré dessus ("on veut faire la soirée sur Yuno, tu t'inscris ?"). Inverse classique du B2B2C : l'utilisateur final tire le marchand. À cultiver explicitement.

## 11.4 Acquisition B2C (les étudiants) : encapsulée d'abord, payante jamais (au début)

**Phase 1 — 100% via le BDE (CAC ~0).** Le BDE pousse le lien guestlist/billetterie à ses membres sur ses propres canaux (groupes WhatsApp/Insta de promo, listes mail asso, affichage campus). L'étudiant DOIT passer par l'app pour son billet/QR → install forcé, gratuit, qualifié. **C'est de loin ton meilleur CAC et il est déjà construit.**

**Phase 2 — Ambassadeurs campus (quand tu as 3+ BDE actifs).** Recrute 1-2 étudiants influents/campus, rémunérés à la commission sur guestlist (tu as déjà tout le système promoteur/affilié codé : `record_promoter_conversion`, commission au scan). CAC ~5-20€/install effectif. **Réutilise ton infra promoteur existante** au lieu de construire — c'est précisément ce pour quoi elle a été codée.

**Phase 3 — Boucles natives (referral + split + recap).** Gratuites, déjà dans le produit :
- Split payment → invitation de groupe (la table VIP partagée à 5 = 5 installs).
- Recap post-soirée partageable sur stories → impressions gratuites.
- Parrainage étudiant (à coder si la boucle native ne suffit pas).
CAC ~2-8€, mais **uniquement viable APRÈS un premier socle d'utilisateurs actifs** (les boucles ont besoin de carburant).

**Ce qu'il NE faut PAS faire maintenant (criticité élevée) : les ads payantes Insta/TikTok.** Le CAC d'install affiché (~3-8€) est un mirage : pour le nightlife, l'install ≠ utilisateur actif. Le CAC d'un *utilisateur qui achète réellement un billet* via ads froides est plutôt **30-50€+**, et tu n'as **aucune donnée de LTV** pour savoir si tu récupères ce coût. Brûler du budget ads avant PMF, c'est acheter de la vanité (compteur d'installs) au prix de ton runway. **Règle : zéro euro de paid acquisition tant que tu n'as pas un BDE qui refait une soirée spontanément.**

## 11.5 LTV / CAC : pourquoi tu ne peux pas encore calculer le ratio (et l'impact)

**Information manquante critique :** tu n'as ni LTV B2C, ni LTV B2B, ni rétention, ni panier moyen réel — **0 donnée, car 0 transaction.** Tout calcul de ratio LTV/CAC serait fabriqué. Voici les hypothèses à *valider en priorité*, pas à supposer :

- **LTV club (B2B) :** si abo Pro ~99€/mois × durée de vie + commission sur GMV. À ~5-10k€ GMV/soirée × 3,5% × 5 soirées/an = ~875-1750€/an de commission/club + abo. **LTV club potentiellement forte SI rétention >12 mois** — mais churn nightlife inconnu, et un club qui teste 1 soirée puis abandonne (très probable au début) a une LTV proche de 0. *Hypothèse la plus dangereuse de tout le business : que les clubs restent.*
- **LTV étudiant (B2C) :** dérisoire individuellement (commission de 3-4% sur quelques billets/an). **Le B2C ne se monétise PAS directement — il sert la liquidité et la data.** Ne base aucune unit economics sur le revenu par étudiant.
- **Le seul ratio qui compte au lancement : temps de Paul investi par club ÷ commission récurrente générée par ce club.** Si signer + onboarder + babysitter un club coûte 8h et qu'il génère 1500€/an de commission, c'est viable. S'il génère 200€ et churne en 2 mois, tout le modèle s'effondre — exactement le risque "erreur de direction structurelle" de l'audit.

## 11.6 Le canal au meilleur CAC réaliste — verdict net

**Gagnant incontesté : le BDE comme canal B2B2C.** CAC effectif par étudiant proche de 0, résout le cold start des deux côtés, ancré géographiquement, rétention récurrente intégrée, et **déjà codé.** C'est la seule chose dans ton arsenal qui combine *fort levier* + *bas coût* + *différenciation défendable*.

**Mais attention à ne pas le sur-vendre :** c'est un wedge de *cold start*, pas un *marché final*. La séquence finançable :
1. **Wedge :** dominer le BDE↔club à Lyon (cold start résolu, preuve de rétention).
2. **Traversée du gouffre (Moore) :** étendre aux co-soirées promoteurs, puis à la billetterie club récurrente (réutiliser les rôles déjà codés).
3. **Marché :** devenir l'OS opérationnel du club FR de ville moyenne — facturer l'outillage de croissance (abo Pro/Elite), pas le droit de vendre.

**Ce qu'il faut tuer côté acquisition :** tout discours/effort sur le pilier boissons skip-the-bar (cimetière d'apps, concurrence frontale POS), sur 4 des 6 rôles, et sur le paid acquisition. Concentre 100% de l'énergie d'acquisition sur **signer des BDE et des clubs lyonnais, un par un, à la main.** Le reste du code attend son tour.

## 12. UX — la promesse « simple comme Apple/Revolut » survit-elle à 6 rôles, 3 piliers et au flow boisson à 1h du matin ?

## La promesse contre la réalité du code

Le fondateur vend une expérience « extrêmement simple, type Apple/Uber/Revolut ». J'ai mesuré la réalité : **119 pages, 12 guards de rôle distincts** (`OwnerRoute`, `OrgAppRoute`, `PromoterRoute`, `AffiliateRoute`, `VipHostRoute`, `BarmanRoute`, `BouncerRoute`, `CloakroomRoute`, `DJRoute`, `ManagerRoute`, `BrowserRoute`), des god-pages comme `MyOrders.tsx` (1842 LOC) et `Bouncer.tsx` (1905 LOC). Apple et Revolut sont simples **parce qu'ils font une chose** (un téléphone, un compte). La simplicité d'Apple n'est pas un thème sombre et des animations Framer Motion — c'est un refus radical de fonctionnalités. Yuno a l'esthétique premium (design systems séparés public/pro, motion cohérent : ce sont de vrais atouts) mais **l'architecture d'information d'un ERP**. On ne peut pas être « simple comme Apple » avec 6 faces et 3 piliers. La promesse est intrinsèquement incompatible avec le scope construit. C'est une dissonance qui se verra dès la première démo investisseur sérieuse.

## Le flow boisson à 1h du matin — la friction décortiquée

C'est le cœur du sujet UX, et le code est sans appel. Le modèle vérifié est un **click & collect** (`OrderPreparationView` → `clickCollect.preparing` → `markAsReady`, récupération via `OrderQR.tsx`). Voici les points de friction réels, dans l'ordre chronologique d'un samedi 1h du matin, dans le bruit et la foule :

| Étape | Friction | Sévérité |
|---|---|---|
| Sortir le téléphone, déverrouiller | Mains prises (verre, manteau), écran lumineux dans le noir | Moyenne |
| Trouver l'event lié (le code IMPOSE qu'une commande boisson soit attachée à un event) | Si le client n'a pas de billet scanné / event actif, où va la commande ? Friction de contexte. | Élevée |
| Naviguer le menu, ajouter au panier | OK en théorie, mais réseau saturé en sous-sol de club (3G/pas de wifi) | Élevée |
| AgeGate + acceptation CGV **à chaque event** | Re-friction légale au pire moment | Moyenne |
| Paiement Stripe (3D Secure possible) | Saisie de code bancaire dans une boîte de nuit = échec fréquent (le problème même que Yuno prétend résoudre) | Élevée |
| Écran `preparing` → attendre `ready` | **Le client attend quand même**, juste assis au lieu de debout. Le job « avoir mon verre » n'est PAS résolu plus vite. | CRITIQUE |
| Se lever, fendre la foule, montrer le QR au barman qui scanne | Re-traverse la foule. Le barman doit basculer en `scanMode: serve`, scanner, servir — pendant le rush. | CRITIQUE |

**Conclusion UX dure :** ce flow a **plus d'étapes** que « je lève la main, je tends ma carte ». Il déplace l'attente sans la supprimer et ajoute des points d'échec (réseau, 3DS, batterie). Uber a réussi parce que l'alternative (héler un taxi sous la pluie) était pire ; ici l'alternative (le barman) est souvent meilleure. Le seul contexte où ce flow gagne : **table VIP / bouteille servie à la table** (le serveur apporte, pas de file) — ce qui renforce que le pilier à garder est le VIP, pas la boisson skip-queue.

## Friction côté barman (l'autre face oubliée)

`Barman.tsx` confirme un `scanMode: 'serve' | 'cancel'`, un son de notification « louder, longer » et une vue de préparation. En clair : on demande à un barman débordé pendant le rush de **regarder une tablette, basculer de mode, scanner un QR par commande**. Un barman expérimenté sert 60-100 verres/heure à la main. L'interrompre pour scanner détruit son débit. **L'UX échoue côté opérateur autant que côté client** — et c'est l'opérateur qui paie l'abonnement.

## Ce qui est excellent en UX (à créditer précisément)

- **Le design system pro et la cohérence motion** (Framer Motion, tokens CSS, reduced-motion) sont d'un niveau rare en pré-seed. La couche esthétique est crédible.
- **L'onboarding owner fast-path 7 étapes pillar-aware** et le découplage paiement/paywall montrent une vraie sensibilité UX produit.
- **Le contrat co-soirée signé** transforme une négociation pénible (qui touche quoi entre club et BDE) en un flow guidé. **C'est le seul endroit où l'UX résout une vraie douleur sans alternative meilleure.** Là, la promesse « simple » tient enfin, parce que le scope est étroit.

## Temps d'usage et simplicité — le verdict

La complexité réelle (6 rôles, 3 piliers, 12 guards) rend la promesse Apple/Revolut **non crédible au niveau plateforme**. Elle ne devient crédible que si on **réduit le produit à un job** — précisément le wedge co-soirée. La simplicité n'est pas un objectif de surface (le thème est déjà beau), c'est un objectif de scope. Tant que Yuno garde 3 piliers, chaque utilisateur paie le coût cognitif des deux autres.

## 13. Architecture technique : la bonne stack pour le mauvais combat

## 13.1 — Verdict d'ensemble

L'architecture de Yuno est, pris isolément, **étonnamment compétente pour un solo founder pré-seed**. La stack (Vite 8 + React 18 + TS + Supabase 100% + Stripe Connect + Cloudflare Workers) est cohérente, moderne et défendable. Le problème n'est pas la qualité des choix techniques pris un par un. Le problème est qu'on a construit une **infrastructure de niveau Série A (94 edge functions, 495 migrations, 158 policies RLS, 229 000 lignes de front) pour valider zéro hypothèse marché**, avec **zéro test automatisé sur un système qui déplace de l'argent, vend de l'alcool et traite des données de mineurs**. En tant que CTO qui signe pour 10 M€, le risque technique n'est pas "ça ne marche pas" — c'est "ça marche assez bien pour donner une fausse confiance et aller en prod avec des trous fatals".

## 13.2 — La stack est-elle la bonne pour l'ambition ? Oui à 80%, avec deux trous structurels

| Couche | Choix | Verdict CTO | Justification |
|---|---|---|---|
| Front SPA | Vite 8 (rolldown) + React 18 | **Bon** | Build 39 Mo, code-splitting propre (mapbox/recharts/jspdf lazy, manualChunks vendor). Le `vite.config.ts` est l'un des meilleurs fichiers du repo. |
| PWA / SW | vite-plugin-pwa + workbox | **Bon mais incomplet** | Le service worker exclut **délibérément** `/functions/`, `/auth/`, `orders`, `payments` du cache (négative lookahead ligne 95). C'est la bonne décision — un SW périmé ne peut pas casser un checkout. Mais ça signifie aussi : **zéro résilience offline sur le chemin transactionnel** (cf. 13.4). |
| Backend | 100% Supabase (Postgres + RLS + Auth + Storage + Deno edge) | **Risqué à l'échelle visée** | Excellent pour aller vite en solo. Mauvais comme **seule** ligne de défense pour des paiements. RLS = la sécurité. 158 policies non auditées = 158 façons de fuiter ou de bloquer en silence. |
| Paiements | Stripe Connect direct charges, club = marchand de record | **Excellent** | Le meilleur choix de tout le projet. Yuno n'est jamais vendeur d'alcool ni de record, `application_fee` propre, `on_behalf_of` le club. C'est ce que Sunday/Shotgun font. Architecturalement plus mature que 90% des pré-seed. |
| Hébergement | Cloudflare Workers (assets-only) | **Bon** | Free tier illimité, SPA fallback natif, `_headers` pour CSP prod. Pas de mur de coût front. |
| Tests | **0** (eslint seul) | **CRITIQUE** | Voir 13.5. C'est le trou qui peut tuer. |

## 13.3 — Scalabilité : le pic de soirée, le vrai stress-test

Le profil de charge du nightlife est **brutalement spiky** : une file de 200 personnes à l'entrée à minuit, un bar qui prend 40 commandes en 5 minutes au rush, un drop de billets pour une grosse soirée qui fait 500 checkouts en 10 minutes. Ce n'est pas une charge moyenne, c'est une rafale.

**Ce qui tient :** Postgres derrière Supabase encaisse sans problème quelques centaines de RPS sur des requêtes indexées. Stripe absorbe le pic de checkout (c'est son métier). Le code-splitting évite de servir 39 Mo à chaque fan.

**Ce qui inquiète, classé par criticité :**

1. **Le cap edge functions à 94 = mur réglementaire ET technique (CRITIQUE).** Le `supabase functions deploy` renvoie 402 dès qu'on dépasse le spend cap. Conséquence vérifiée : **des fonctions sont codées mais pas déployées** (auth mineurs, staff PIN). Donc le système en "prod" n'est même pas le système dans le repo. Pire : 94 fonctions Deno = 94 cold-starts potentiels. À 2h du matin, un cold-start de 800ms sur `verify-ticket-payment` pendant que 50 personnes scannent à l'entrée, c'est une file qui se forme. Aucun load test n'existe (confirmé : 0 fichier de test).

2. **RLS sous charge (ÉLEVÉ).** 158 policies. Chaque requête front (et il y en a 933 brutes, 189 fichiers touchent `supabase.from/rpc`) re-évalue les policies. Des policies complexes avec sous-requêtes (joins venue→staff→roles) coûtent cher par appel. Sans `EXPLAIN ANALYZE` sur les policies chaudes, on ignore lesquelles s'effondrent à 200 connexions concurrentes. C'est exactement le genre de chose qui passe en démo (1 user) et meurt en soirée réelle (200 users).

3. **Pas de couche data = pas de cache applicatif, pas de batching (ÉLEVÉ).** React Query est installé mais court-circuité (33 usages vs 793 appels directs). Donc : chaque composant refait ses requêtes, pas de dédup, pas de cache partagé, 41 souscriptions realtime ouvertes. Sur le dashboard owner en soirée live, ça veut dire N souscriptions websocket + N polls. Supabase Realtime a des **limites de connexions concurrentes par plan** — un club avec 10 staff connectés + le dashboard owner ouvert peut saturer le quota realtime sans prévenir.

4. **Mapbox + PWA + Recharts au montage = TTI lourd sur 4G saturée (MOYEN).** Lazy-loadé, donc OK pour le fan moyen. Mais le globe Mapbox des "origines clients" est un luxe analytics qui n'a aucune valeur pré-PMF.

**Architecture idéale recommandée pour l'ambition affichée :** garder Supabase comme backend principal (c'est le bon levier de vélocité solo), mais (a) **introduire une vraie couche data** (`src/data/*` typée, React Query partout, fin des 933 appels nus) avant tout scale, (b) **mettre les chemins critiques de soirée (scan billet, validation paiement) sur des fonctions edge avec warm-up / pas de cold-start**, idéalement précompilées et monitorées, (c) **load-tester le scénario "200 scans en 10 min" et "500 checkouts en 10 min"** avant le premier vrai samedi soir. Sans ces trois, la première grosse soirée est un pari.

## 13.4 — Le flow QR offline : LE trou opérationnel fatal (CRITIQUE)

C'est le point que le mandat désigne, et la vérification code le confirme noir sur blanc. **Le club à 2h du matin a une 4G saturée par 300 smartphones.** La question : le flow QR (barman scanne → commande récupérée ; bouncer scanne → billet validé) fonctionne-t-il offline ?

**Réponse vérifiée dans le code : NON. Pas du tout.**

- `src/pages/Barman.tsx` valide une commande par un `supabase.from('orders').update()` **direct, synchrone, online-only**. Aucun fallback. Si le réseau tombe, le `.update()` échoue (catch → toast d'erreur) et la commande n'avance pas.
- **Aucun mécanisme de file offline nulle part** : recherche exhaustive de `BackgroundSync`, `workbox-background-sync`, `outbox`, `pending_orders` → **zéro résultat**. Le seul artefact offline du projet est `OfflineBanner.tsx` (une bannière "vous êtes hors ligne") et un `navigator.onLine` dans un hook VIP. C'est cosmétique, pas fonctionnel.
- Le service worker **exclut volontairement** `/functions/` et les tables transactionnelles du cache (bon pour éviter de casser un paiement périmé, mais ça veut dire qu'il n'y a **aucune** stratégie de résilience réseau sur le chemin qui compte).
- Le scan billet (Bouncer/promoteur/orga) passe par les mêmes appels Supabase live. Pas de validation cryptographique locale du QR : le code scanné est un token serveur, donc **toute validation exige un aller-retour réseau**. Réseau mort = porte bloquée.

**Pourquoi c'est fatal et pas juste gênant :** dans le nightlife, le moment de vérité est précisément le moment où le réseau est le pire — l'entrée bondée, le bar en rush. Un POS classique (Toast, Square, SumUp) fonctionne offline et synchronise après ; c'est une exigence non négociable du retail/hospitality. Yuno arrive sur ce marché avec **moins de résilience qu'une caisse enregistreuse des années 90**. Le premier samedi où la 4G sature, le barman ne peut plus servir et le bouncer ne peut plus valider de billet. C'est un churn instantané et définitif du club. **Aucun club ne re-essaiera après une soirée où l'app a planté à l'entrée.**

**Correctif obligatoire avant tout pilote :** (1) pré-charger en local (IndexedDB) la liste des billets valides de la soirée côté Bouncer pour une **validation offline-first** avec dédup anti-double-scan, sync à la reconnexion ; (2) une **file d'écriture offline (outbox + Background Sync)** pour les actions barman (marquer préparé/servi) qui rejoue à la reconnexion ; (3) un mode dégradé explicite à l'UI. C'est 3-5 jours de travail, mais sans ça le pilier "skip the queue" est un mensonge marketing le soir où ça compte.

## 13.5 — Sécurité : RLS comme seule défense, zéro test sur les paiements (CRITIQUE)

**Le combo "100% Supabase + solo + zéro test" sur une plateforme de paiement est un risque critique, sans nuance.** Voici pourquoi, hiérarchisé :

1. **Zéro test sur des paiements (CRITIQUE).** 0 fichier `.test/.spec`. Le calcul de commission (`utils/fees.ts`), le split Stripe Connect (direct vs separate charges), le refund, le clawback de transfert co-event, le plancher de commission BDE à 0,49€ — **tout ça repose sur l'absence de bug, vérifiée à la main**. L'historique projet documente déjà des bugs financiers réels (line item Stripe facturant `serviceFee` au lieu de `transactionFee` → le client payait la commission qu'il ne devait pas ; fuites TTC vs HT corrigées). Ces bugs ont été trouvés par chance, pas par un test. **Un seul bug de split non détecté = de l'argent envoyé au mauvais compte Stripe, des chargebacks, et potentiellement une requalification de Yuno en collecteur de fonds.** Un système financier sans test de régression sur les chemins d'argent est, pour un investisseur, un no-go en l'état.

2. **RLS comme seule frontière (ÉLEVÉ).** 158 policies, non auditées pour cohérence. RLS est un excellent modèle, mais c'est une défense **déclarative et silencieuse** : une policy trop laxiste fuite des données sans erreur ; une policy trop stricte bloque sans message (l'historique projet est rempli de bugs "0 résultat EN SILENCE à cause de RLS" — recherche orga, deletes admin no-op, embed PostgREST ambigu). Sans audit de cohérence ni test d'accès par rôle, on ne peut pas affirmer qu'un promoteur ne peut pas lire les revenus d'un autre club. C'est invérifiable aujourd'hui.

3. **Migrations fantômes = dérive entre l'historique et la réalité live (ÉLEVÉ).** 495 migrations, dont un lot "sécurité" marqué appliqué sans l'être (MFA Vault, hash IP, crons RGPD), re-appliqué une fois. La leçon documentée par le founder lui-même : "vérifier l'objet live, pas l'historique". Ça veut dire que **personne ne peut garantir l'état réel du schéma de sécurité en prod**. Pour un système qui traite des paiements et des données de mineurs, c'est intenable.

4. **Gestion des secrets (ÉLEVÉ → MOYEN).** Bon point : les `sk_` Stripe, service_role, Resend vivent dans les secrets Supabase / `.env.local`, jamais commités. Le CSP du `vite.config` est sérieux. Mauvais point : 46 des 63 fonctions déclarées tournent avec `verify_jwt = false` (crons + webhooks légitimes, mais c'est une grande surface où un secret cron mal géré ouvre la porte — l'historique confirme un Vault `cron_secret` absent qui cassait TOUS les crons). Admin sans MFA obligatoire = un compte admin compromis pilote toute la plateforme.

5. **CORS-lock `yunoapp.eu` (MOYEN, à double tranchant).** Les edge functions n'autorisent que cette origine. Bien pour la sécurité, mais ça produit un **échec silencieux** (pas de toast) en local et impose que la prod serve depuis ce domaine exact. Un "échec silencieux" sur un chemin de paiement est exactement le genre de chose qu'un test E2E attraperait et qu'aucun humain ne verra avant un client.

## 13.6 — Bus factor = 1 : le risque qui amplifie tous les autres (ÉLEVÉ)

119 pages, 94 fonctions, le système de paiement, la conformité, les 495 migrations — **tout repose sur une seule tête**. La vélocité assistée IA est réelle et impressionnante (50 commits/mois, 3 piliers construits proprement). Mais : pas de revue de code par un pair sur des chemins d'argent, pas de second cerveau sur la conformité alcool/mineurs, et une mise en demeure CNIL ou un incident Stripe un samedi soir n'a personne pour répondre. Pour un investisseur, le bus factor de 1 sur une fintech-adjacente est un risque de continuité d'exploitation, pas un détail RH.

## 13.7 — Architecture idéale recommandée (la version finançable)

Je ne recommande PAS de jeter la stack — elle est bonne. Je recommande de **rétrécir le périmètre et durcir le noyau** :

1. **Geler 2 piliers, garder 1.** Tuer la commande de boissons skip-the-bar (pilier le plus faible techniquement à cause de l'offline, et commercialement à cause des POS incumbents) et le pilier que la compétition a déjà mangé. Concentrer le cœur technique sur le wedge co-soirée club↔BDE.
2. **Couche data avant scale.** Encapsuler les 933 appels nus, React Query partout. C'est ce qui détermine la vélocité post-lancement.
3. **Tests sur les 3 chemins d'argent + le scan offline.** Pas "100% coverage" : juste fees.ts, le split Stripe, le refund/clawback, et un test E2E du scan billet offline. ~5 jours. C'est le minimum vital avant qu'un euro réel transite.
4. **Offline-first sur Bouncer + Barman.** IndexedDB + Background Sync. Non négociable pour un produit nightlife.
5. **Audit RLS par rôle + MFA admin obligatoire + réconciliation schéma live.** Prouver que les frontières tiennent.
6. **Load-test le pic de soirée** (200 scans / 500 checkouts en 10 min) avant le premier vrai samedi.

**Compression d'effort (CC+gstack vs équipe humaine) :** couche data ~1 semaine équipe / ~1 jour assisté ; tests des chemins d'argent ~3 jours / ~4h ; offline-first scan ~1 semaine / ~1 jour. Le "lac" est entièrement atteignable. Ce qui manque n'est pas la capacité de construire — c'est la discipline de durcir le noyau **avant** d'élargir.

## 14. IA : un moteur statistique crédible, mais aucune donnée pour l'alimenter

## 14.1 — État réel de l'IA dans Yuno : quasi nul, et c'est honnête

Premier constat factuel, vérifié dans le code : **il n'y a presque aucune IA dans Yuno aujourd'hui, et c'est plutôt sain.** Recherche exhaustive des edge functions "gemini/openai/gpt/llm/recommend/smart" → **une seule** (`send-next-event-recommendation`), qui est une recommandation à base de règles, pas un modèle. Pas de LLM dans le checkout, pas de RAG, pas de pricing dynamique automatisé, pas de support IA. Le founder n'a pas saupoudré de l'"IA" pour le pitch deck. **Crédit : zéro IA-gadget. C'est rare et ça mérite d'être noté.**

Le seul vrai morceau d'"intelligence" est le **moteur de prévision de hype** (`src/lib/hypeForecast.ts`, 18 Ko + `hypePostEvent.ts`, 16 Ko). Il faut le juger précisément.

## 14.2 — Le moteur de hype est-il crédible ? Le modèle, oui. Les données, non. (criticité MOYEN→ÉLEVÉ)

J'ai lu le code. **Ce n'est pas un gadget — c'est un vrai modèle statistique, bien conçu**, ce qui est inattendu pour un solo founder. Il fait trois choses correctes :

1. **Pace forecast par S-curve** : modélise que les ventes de billets nightlife suivent une courbe back-loaded (lente puis spike final), apprend la courbe `g(f)` sur les **propres événements passés du club**, avec **empirical-Bayes shrinkage** vers un prior générique quand l'historique est mince. `projectedFinal = currentSold / g(f)`. C'est la bonne méthode, exactement ce qu'un data scientist ferait.
2. **Demand Pressure Index** : corrige la projection brute par des indicateurs avancés (trafic vs baseline, funnel view→cart→checkout→buy, dwell time, returning visitors, vélocité des favoris, diversité des sources, accélération des ventes), nudge ±30%. Légitime.
3. **Confidence explicite** : le modèle **expose** son incertitude (faible loin de l'event / peu d'historique, élevée près des portes avec historique) au lieu de la cacher. C'est de l'honnêteté statistique, pas du theater.
4. Pur, déterministe, testable, réutilisable serveur. Bonne ingénierie. (Ironie : c'est le fichier le plus testable du repo, et il n'a... aucun test.)

**MAIS — le problème fatal du cold-start data (ÉLEVÉ) :** ce moteur **ne vaut rien sans historique**, et Yuno a **zéro événement réel, zéro client**. Le modèle le sait (il fait du shrinkage vers un prior), mais un prior générique "nightlife" inventé sans aucune donnée terrain n'est pas calibré — c'est une supposition habillée en math. Concrètement : pour les 5-10 premières soirées d'un nouveau club, la prévision sera **du bruit présenté avec une fausse précision**. Pire risque produit : un owner qui voit "projeté : 280 entrées, confiance moyenne", sous-commande son stock ou son staff, fait un flop, et **blâme Yuno**. Une prévision fausse avec une UI confiante est pire que pas de prévision. Le `confidence` affiché atténue ça mais ne le résout pas.

**Verdict :** garder le moteur (il est bon), mais (a) **ne pas le mettre en avant comme feature de vente** tant qu'il n'a pas 20-30 événements réels pour se calibrer, (b) afficher la confiance de façon **dominante** ("prévision indisponible — pas assez d'historique" plutôt qu'un chiffre fragile), (c) ne JAMAIS automatiser une décision (stock, pricing) sur sa sortie avant calibration prouvée. C'est de l'IA qui sera crédible dans 12 mois de données, pas aujourd'hui.

## 14.3 — Où l'IA crée de la valeur RÉELLE vs gadget (priorisé)

Le test pour chaque usage : *est-ce que ça résout un job-to-be-done douloureux du club/fan, ou est-ce que c'est de l'IA pour le deck ?*

| Usage IA | Valeur réelle | Verdict | Pré-requis donnée | Quand |
|---|---|---|---|---|
| **Prévision stock soirée** (combien de bouteilles/fûts commander) | **TRÈS HAUTE** | Le vrai 10-star. Le club perd de l'argent sur le sur-stock (alcool périmé) et le sous-stock (rupture en plein rush = ventes perdues). | Historique ventes par soirée × météo × line-up × jour. Yuno a la donnée transactionnelle pour le construire. | Après ~15-20 soirées/club. **Le seul usage IA qui justifie un abonnement Pro.** |
| **Pricing dynamique billets/tables** (yield management façon airline) | **HAUTE** | Maximiser le yield : monter le prix quand la demande est forte (DPI déjà calculé !), early-bird quand elle est faible. Le DemandPressureIndex est *déjà la moitié du moteur de pricing*. | Le moteur de hype existe déjà. Calibration. | Phase 2. Énorme upside revenue partagé club/Yuno. |
| **Détection de fraude / anti-fraude scan** (double-scan, billets revendus) | **HAUTE** | Job réel du nightlife (touting, faux billets). Pattern detection sur les scans. | Données de scan (existent côté Bouncer). | Quand il y a du volume. |
| **CRM / segmentation client + relance** (qui faire revenir, quand) | **MOYENNE-HAUTE** | Le founder vend déjà "collecter la data client". L'IA qui transforme la data en relances ciblées ("tes superfans n'ont pas réservé ta prochaine soirée") crée de la rétention club. | Profils + historique achats. Existe. | Phase 2. |
| **Support / FAQ IA** (LLM sur les questions club/fan) | **FAIBLE-MOYENNE** | Utile à l'échelle (réduit le coût support), inutile à 0 client. | Volume de tickets support. | Plus tard. Pas un différenciateur. |
| **Reco d'événements au fan** ("tu pourrais aimer cette soirée") | **FAIBLE** sans liquidité | Classique mais sans valeur tant qu'il n'y a pas assez d'events/fans dans une ville (cold-start marketplace). Une seule fn existe, à base de règles — c'est suffisant pour l'instant. | Liquidité locale (le vrai problème, pas l'algo). | Quand le marché existe. |
| **Génération de contenu marketing** (descriptions soirées, push) | **GADGET** | Joli, faible valeur, facile à imiter. `emailCampaign.ts` existe déjà sans IA. Ne pas prioriser. | — | Jamais en priorité. |

## 14.4 — La règle d'or IA pour Yuno : la donnée d'abord, le modèle ensuite

Le diagnostic IA reflète le diagnostic stratégique global du dossier : **Yuno a construit le moteur avant d'avoir le carburant.** Le moteur de hype est une preuve que Paul peut construire de la vraie data-science. Mais **toute l'IA qui crée de la valeur (stock, pricing, CRM, fraude) dépend d'un historique transactionnel que Yuno n'a pas, parce qu'il n'a aucun client.**

La séquence correcte, en tant que CTO :

1. **Maintenant (0 client) :** ne construire AUCUNE nouvelle IA. Geler le moteur de hype en mode "low-confidence, ne pas vendre". L'IA est une distraction pré-PMF — c'est exactement le piège "boil the ocean" appliqué à l'IA.
2. **Pilote (3-5 clubs réels) :** instrumenter proprement la collecte (ventes par soirée, scans, no-show, météo, line-up). **La valeur IA future se gagne ici, en stockant la bonne donnée dès la première soirée.** C'est le seul investissement IA qui compte aujourd'hui : le schéma de données, pas l'algo.
3. **Post-PMF (15-20 soirées/club) :** activer la **prévision de stock** en premier (le seul usage qui justifie à lui seul un palier Pro), puis le **pricing dynamique** (réutilise le DPI déjà codé). Ce sont les deux usages qui transforment l'IA en revenu, pas en gadget.
4. **Échelle :** fraude, CRM, support.

**Ce qu'il ne faut surtout PAS faire :** brancher un LLM dans le produit pour cocher la case "IA" du pitch. Le founder ne l'a pas fait jusqu'ici — c'est une bonne décision qu'il faut tenir. La défense IA de Yuno n'est pas un modèle, c'est **la donnée propriétaire de transaction nightlife** qu'il accumulera SI et seulement si il atteint la liquidité sur un wedge. Pas de clients → pas de données → pas d'IA défendable. L'ordre est non négociable.

## 14.5 — Note de dimension

Voir scores : **Exécution = 62/100**. L'exécution technique pure est largement au-dessus de la moyenne pré-seed (architecture cohérente, Stripe Connect mature, moteur de hype légitime, vite.config exemplaire). Elle est plombée à 62 par les trous qui comptent pour un produit qui touche de l'argent : zéro test, zéro résilience offline sur le chemin critique, RLS non auditée, migrations fantômes, et surtout une exécution **dirigée vers le mauvais objectif** (construire large avant de valider). Bien exécuter la mauvaise chose reste de la mauvaise exécution stratégique.

## 15. Finances — prévisions, runway, burn solo, unit economics par établissement et chemin vers 10M€ ARR

## 15.1 État financier réel : pré-revenu intégral

**0€ de CA. 0€ de MRR. 0 client signé. 0 transaction réelle.** Le code contient un toggle `demo_is_live()` — tout ce qui ressemble à de l'activité est de la démo. Il n'y a **rien à modéliser à partir de réel** : tout ce qui suit est une projection à hypothèses explicites, pas une prévision ancrée. Confiance globale : **faible**, par construction.

**Le seul actif financier vérifiable est le CODE** : 189 pages, 94 edge functions, 3 piliers. Valeur de remplacement (effort humain) si on devait rebâtir : avec une équipe de 3-4 ingénieurs, ce périmètre = **18-30 mois-homme** ≈ 250-450k€ de coût de dev. C'est l'actif. Le passif, c'est qu'il a été construit **avant toute validation** — donc une partie de cette valeur est potentiellement du capital brûlé sur la mauvaise chose (les piliers boissons + 4 rôles sur 6, que l'intel recommande de tuer).

## 15.2 Burn et runway d'un solo founder (confiance moyenne — coûts infra connus, coût de vie estimé)

Le burn cash d'un solo founder pré-revenu est **dominé par le coût de vie et l'infra**, pas par la masse salariale :

| Poste | Coût mensuel (hypothèse FR) | Note |
|---|---|---|
| Salaire / coût de vie founder | 2 000 - 3 500 € | minimum vital, non versé en cash si auto-financé |
| Supabase (Pro + au-delà du cap) | 25 - 100 € | **le cap 402 bloque les nouvelles edge functions** — relever le cap = surcoût |
| Stripe | variable (% du GMV) | pas de coût fixe |
| Cloudflare Workers | 0 € (free tier assets-only) | bien joué — coût d'hébergement front = 0 |
| Mapbox / Resend / domaine | 20 - 80 € | usage-based |
| Outillage / IA (dev assisté) | 100 - 400 € | le vrai accélérateur de vélocité |
| **Burn cash hors salaire** | **~150 - 600 €/mois** | **extrêmement bas — c'est la force du setup** |
| **Burn TOUT compris** | **~2 200 - 4 100 €/mois** | si le founder se paie |

**Constat CFO majeur (positif) :** le burn infra est dérisoire (~150-600€/mois). Un solo founder peut tenir **des années** sur très peu de cash. Avec 50k€ de runway personnel, le founder a **12-24 mois** s'il ne se paie pas un vrai salaire. **Ce n'est PAS le cash le facteur limitant. C'est le bus-factor=1 et le temps founder.** Le risque financier n'est pas l'insolvabilité, c'est le **coût d'opportunité** : des mois de runway brûlés à construire avant de vendre.

**Risque caché (criticité moyenne) :** le cap Supabase 402 qui bloque le déploiement de nouvelles edge functions est un **plafond opérationnel déguisé en problème technique**. Relever le cap = relever le spend cap Supabase = engager du cash récurrent. Et certaines fonctions critiques (auth mineurs, staff PIN) sont codées mais **non déployées faute de cap** — donc des fonctionnalités de conformité existent sur disque mais pas en prod. Financièrement : la conformité alcool/mineurs est **bloquée derrière une décision de spend**, pas seulement derrière du code.

## 15.3 Unit economics par établissement — combien de clubs pour 10k€ MRR puis 1M€ ARR

**Hypothèses (confiance faible-moyenne) :**
- ARPU total par club actif = **abo + commission**. On modélise 3 scénarios de GMV/club/mois.
- Mix transactionnel par club : 40% billets (panier 20€), 30% tables VIP (panier 250€), 30% boissons (panier 9€).
- Take rate net effectif Yuno (après plancher) ≈ **4,2%** sur ce mix (tiré vers le haut par les tables/billets, pas les boissons).

| Scénario club | GMV/mois | Commission Yuno (4,2%) | Abo moyen | **ARPU total/mois** |
|---|---|---|---|---|
| Club faible (bar, peu de VIP) | 8 000 € | 336 € | 30 € | **~366 €** |
| Club médian (club de ville moyenne) | 25 000 € | 1 050 € | 60 € | **~1 110 €** |
| Club fort (gros club + VIP) | 70 000 € | 2 940 € | 99 € | **~3 040 €** |

### Chemin vers 10k€ MRR (≈ premier signal de viabilité)

- Avec des **clubs médians (1 110€ ARPU)** : **~9 clubs actifs payants/transactants.** 
- Avec des **clubs faibles (366€)** : **~28 clubs.**
- Réaliste an 1 (mix faible-médian) : **15-25 clubs actifs** pour 10k€ MRR. **Atteignable dans UNE ville si la liquidité locale est résolue** (Cold Start). C'est le jalon crédible. Confiance : moyenne.

### Chemin vers 1M€ ARR (≈ 83k€ MRR)

- Clubs médians : **~75 clubs actifs.** 
- Mix réaliste : **100-250 clubs actifs transactants.** 
- À l'échelle française : ~150-200 clubs répartis sur 5-8 villes. **Crédible MAIS suppose résolu le cold-start dans chaque ville** (assez d'events ET de fans). Le multi-ville multiplie le coût d'acquisition terrain. Confiance : faible (dépend entièrement de la liquidité locale non prouvée).

### Chemin vers 10M€ ARR (≈ 833k€ MRR) — la question posée

- Clubs médians (1 110€) : **~750 clubs actifs.** 
- Mix réaliste (faible-médian, 600€ ARPU moyen) : **~1 150 - 1 400 clubs actifs transactants.**
- **Réalité de marché (confiance faible, mais directionnelle) :** la France compte ~1 500 discothèques/clubs déclarés et quelques milliers de bars festifs. **10M€ ARR = capturer ~50-80% de TOUTES les discothèques françaises actives, OU déborder massivement sur les bars + festivals + plusieurs pays.** 
- **Verdict CFO :** 10M€ ARR sur la France seule = **non crédible sans s'étendre aux bars festifs ET à plusieurs pays ET à plusieurs piliers**. Or chaque extension géographique est un nouveau cold-start contre Xceed (Sud EU, 25M users), Shotgun (FR), Fever (mastodonte). **Le chemin vers 10M€ existe arithmétiquement (≈1 200 clubs) mais traverse frontalement les incumbents les mieux capitalisés du secteur.** Ce n'est pas un chemin de solo founder ; c'est un chemin Series A+ avec une équipe vente terrain multi-pays.

## 15.4 Prévisions réalistes 36 mois (fourchettes, hypothèses explicites, confiance faible)

**Hypothèse maîtresse :** le founder tue les piliers perdants, se concentre sur le wedge club↔BDE en France, et signe en direct. Sans focus, ces chiffres s'effondrent.

| | An 1 (validation) | An 2 (traction) | An 3 (scale early) |
|---|---|---|---|
| Clubs actifs (fourchette) | 5 - 20 | 30 - 80 | 80 - 200 |
| ARPU/mois (mix) | 250 - 500 € | 400 - 700 € | 500 - 900 € |
| **MRR (fourchette)** | **1,5k - 8k €** | **15k - 50k €** | **50k - 150k €** |
| **ARR sortie** | **20k - 95k €** | **180k - 600k €** | **600k - 1,8M €** |
| Burn (avec 1-2 embauches an 2-3) | ~3k €/mois | ~15-25k €/mois | ~40-70k €/mois |
| Cash-flow | légèrement négatif | négatif (embauches) | proche breakeven possible |

**Lecture :** le scénario haut atteint ~1,8M€ ARR à 36 mois — un beau résultat de seed/pré-Series A français, **mais conditionné à la résolution du cold-start dans 5-8 villes contre 3 incumbents.** Le scénario bas (20k → 600k ARR) est plus probable vu le bus-factor=1 et l'absence totale de validation. **L'écart entre les deux = entièrement la qualité de l'exécution GO-TO-MARKET, pas la qualité du produit (déjà sur-construit).**

## 15.5 Le vrai problème financier : le capital est déjà investi du mauvais côté

**Constat CFO central et brutal.** Le founder a dépensé son actif le plus rare — le temps avant PMF — à construire de la SURFACE (189 pages, 6 rôles, 3 piliers) au lieu de PREUVE (1 club rempli un samedi). En termes de portefeuille :

- **Capital de construction dépensé :** ~6-12 mois de temps founder (la totalité du runway pré-validation) sur l'OFFRE.
- **Capital de validation dépensé :** ~0. Aucun euro, aucune semaine sur la DEMANDE.
- **Ratio construction/validation : ∞.** C'est l'inverse exact de ce qu'un CFO/board exige avant un chèque. Lean Startup, Cold Start, Crossing the Chasm convergent : **on valide une tête de pont AVANT de bâtir la plateforme.** Ici la plateforme précède la demande de 189 pages.

**Recommandation financière (10M€ de mon argent) : NON en l'état, mais réorientable à coût quasi nul.** Le burn est si bas que le founder peut se permettre 4-8 semaines de validation pure (1 club pilote, wedge co-soirée BDE, GMV réel, take rate accepté, abo Pro payé). **Si UN club paie l'abo Pro et accepte le take rate sur du GMV réel, le risque chute de ~70% et l'histoire devient finançable en seed (300-600k€) sur la thèse 'OS opérationnel du club FR de ville moyenne'.** Sans ce signal, aucun chiffre de cette section n'est autre chose qu'un tableur.

## 16. Roadmap 12 / 24 / 36 mois

Roadmap calibrée pour un **solo founder à vélocité IA élevée**, puis une première embauche post-seed. Réaliste signifie : aucune ligne n'assume une équipe avant le M18. Chaque horizon a un **jalon de sortie unique** — si le jalon n'est pas atteint, on ne passe pas à l'horizon suivant, on pivote ou on s'arrête.

### Horizon 0-12 mois — 'Prouver le wedge dans une ville' (le seul horizon qui compte)

**Trimestre 1 (M0-M3) — Gate de mise en conformité + déploiement.**
- Lever cap Supabase 402, déployer les edge functions critiques, P0 admin (refund/suspension/kill-switch), MFA admin. *(technique/ops)*
- Fermer les 3 bloquants alcool/mineurs (guest checkout, licence club, vérif d'âge réelle). *(conformité)*
- Feature freeze + masquage : MVP réduit = billetterie + table VIP + co-soirée club↔BDE. Boissons skip-the-bar masquée, 4 rôles masqués. *(focus produit)*
- 10-15 tests revenue-critical + QA navigateur complète du parcours wedge.
- CGU/CGV + politique de confidentialité d'avocat.
- **Jalon T1** : produit déployé sur yunoapp.eu, parcours wedge parfait, légalement défendable, 0 bloquant critique restant.

**Trimestre 2 (M3-M6) — Les 3 premiers pilotes.**
- Founder-led sales : signer 3 clubs + leurs BDE partenaires dans UNE ville. Onboarding manuel, présence physique aux soirées.
- Première co-soirée réelle facturée : billet + table + split revenu + payout en Stripe live.
- Instrumenter les 3 métriques PMF.
- **Jalon T2** : 3 co-soirées réelles encaissées, 0 incident paiement/conformité, premier euro de commission réel.

**Trimestre 3 (M6-M9) — Densifier la ville (atomic network).**
- Passer de 3 à 8-10 clubs dans la même ville. Le réseau BDE↔clubs se densifie (un BDE travaille avec plusieurs clubs, un club avec plusieurs BDE → effet de réseau local).
- Itérer sur le contrat-cadre récurrent (signer une fois → toute la résidence).
- Premier test de pricing payant : facturer l'abonnement (Essential 49€) à au moins 2 clubs.
- **Jalon T3** : rétention club M3 > 60%, ≥ 30% du GMV des soirées partenaires passe par Yuno, ≥ 2 abonnements payés.

**Trimestre 4 (M9-M12) — Décision de financement.**
- Consolider la data : cohortes de rétention, GMV cumulé, take-rate net réel.
- Décider : (a) lever un seed sur la traction du wedge, ou (b) bootstrap si l'unit economics tient seul.
- **Jalon T4 / sortie 12 mois** : 8-10 clubs actifs dans 1 ville, PMF signal clair (rétention + % GMV), deck de seed honnête prêt. **Si pas de PMF signal ici → pivot du wedge, pas expansion.**

### Horizon 12-24 mois — 'Réveiller le scope construit + 2e-3e villes'

*Conditionné à un PMF signal au M12.* C'est ici, et seulement ici, qu'on rallume progressivement le code déjà bâti.

- **Expansion géographique** : répliquer le playbook ville-par-ville sur 2-3 villes FR secondaires que Xceed ne couvre PAS en profondeur (c'est le seul angle d'entrée crédible identifié en competitive intelligence). Une ville à la fois, même méthode atomic-network.
- **Première embauche** (post-seed) : un profil ops/compliance ou un co-founder technique pour casser le bus factor=1. Priorité au risque réglementaire, pas au feature dev.
- **Réactiver des rôles** un par un, tirés par la demande des pilotes : promoteur (si les clubs le réclament), DJ marketplace (si la liquidité événements le justifie).
- **Intégration POS** (Toast/Square/SumUp) : pré-requis pour rallumer la boisson skip-the-bar sérieusement. Yuno se branche, ne remplace pas.
- **Tests** : passer de 15 tests ciblés à une couverture des chemins métier principaux. Monitoring + alerting mature.
- **Refactor dette** : découper progressivement les god-pages réactivées, introduire la couche data sur les domaines actifs.
- **Jalon 24 mois** : 25-40 clubs sur 3 villes, MRR récurrent, équipe de 2-3, rôle promoteur OU DJ réactivé avec usage réel, première intégration POS pilote.

### Horizon 24-36 mois — 'Plateforme régionale + 2e marché'

*Conditionné à une croissance multi-villes saine.*

- **2e marché géographique** : Espagne ou Belgique (proximité culturelle nightlife, terrain partiellement libre hors zones Xceed denses). Localisation déjà prête (ES dans l'i18n).
- **Rallumer le pilier boisson** uniquement avec intégration POS réelle, sur les clubs où le JTBD opérationnel tient (capacité main-d'œuvre au bar).
- **Elite tier** : construire loyalty/prédictif/multi-établissement/API — seulement si des groupes multi-établissements le demandent (signal de demande, pas de spéculation).
- **Écosystème** : ouvrir l'API aux promoteurs/affiliés, marketplace DJ à pleine échelle.
- **Équipe** : 5-8 personnes (eng, ops, sales, compliance, design).
- **Jalon 36 mois** : leader régional sur la niche co-soirée club↔orga FR, présence dans 2 pays, ARR significatif, défendabilité par effet de réseau local (densité ville-par-ville) + données de transaction propriétaires.

### Le principe qui gouverne toute la roadmap

**On n'élargit jamais sans avoir saturé l'étape précédente.** Le péché originel de Yuno est d'avoir construit 36 mois de roadmap en 1 mois de code. Cette roadmap inverse la logique : on remet la surface déjà construite en sommeil, et on la **rallume seulement quand la demande prouvée le justifie**. Chaque rallumage est tiré par un client qui paie, jamais poussé par une hypothèse. C'est l'opposé exact du 'boil the ocean' qui a produit l'état actuel — et c'est la seule trajectoire finançable.

## 18. SWOT — analyse spécifique Yuno

Cette matrice n'est pas générique. Chaque case est ancrée dans l'état réel vérifié du code (189 pages, 94 edge functions, 495 migrations, 0 test, 0 client, non déployé) et dans le paysage concurrentiel réel (Xceed 25M users, Fever ~724M$ ARR, Shotgun sur le billet FR, Sunday/Toast/Square sur la boisson).

## Forces (Strengths) — internes, réelles

| # | Force | Pourquoi c'est réel et précis | Solidité |
|---|-------|-------------------------------|----------|
| S1 | **Architecture financière multi-tenant correcte** | Stripe Connect direct charges, `on_behalf_of` le club = club marchand de record. Yuno n'est jamais vendeur d'alcool, relevé client = nom du club, commission via `application_fee`. Co-soirée 2-parts en mode `separate` (charge plateforme + transferts webhook). C'est la bonne décision juridico-technique, rare à ce stade. | Élevée |
| S2 | **Le wedge co-soirée club↔organisateur/BDE** | `event_collab_contracts` + contrat-cadre récurrent + partage de revenus contractualisé tickets/tables/boissons signé eIDAS. C'est le SEUL morceau du produit que Shotgun/Fever/Xceed ne font PAS nativement. JTBD réel, mal servi, ancré géographiquement (BDE = France). C'est votre unique actif défendable. | Élevée |
| S3 | **Vitesse d'exécution solo assistée IA** | 278 commits, 189 pages, 94 functions, 3 piliers en quelques mois, architecturalement cohérents (feature-folders, TypeScript partout, `utils/fees.ts` centralisé, conventions homogènes, 1 TODO / 0 FIXME). Preuve que le fondateur PEUT construire vite ET propre. | Élevée |
| S4 | **Profondeur opérationnelle club** | Outillage staff complet (barman, bouncer, vestiaire, hôte VIP, manager), floor plan VIP, QR scanning, démographie participants, origines clients (globe Mapbox). Xceed ne descend pas à ce niveau d'ops staff. | Moyenne |
| S5 | **Design system dual (public/pro) et UX premium** | Tailwind + shadcn cohérent, Framer Motion, Recharts. Positionnement premium tenu visuellement. | Moyenne |

**Verdict forces :** vos vraies forces sont S1 (paiements) et S2 (le wedge collab). S3 est une force d'exécution, pas un moat — la vitesse de construction ne crée aucune barrière à l'entrée (cf. Porter §20). Ne confondez jamais « je construis vite » avec « j'ai un avantage durable ».

## Faiblesses (Weaknesses) — internes, fatales si non corrigées

| # | Faiblesse | Preuve dans l'état réel | Criticité |
|---|-----------|-------------------------|-----------|
| W1 | **Zéro client, zéro revenu, zéro PMF** | `demo_is_live()` toggle dans le code, aucun établissement signé connu, aucune métrique d'usage. L'hypothèse centrale (« clubs paient 49-199€/mois + 3-4% ») a 0 validation. | **Critique** |
| W2 | **Boil the ocean avant PMF** | 3 piliers + 6 rôles construits AVANT une seule tête de pont. Violation frontale de Lean Startup et de Crossing the Chasm. Le risque n'est pas de mal construire, c'est d'avoir construit la mauvaise chose, trop large. | **Critique** |
| W3 | **Zéro test automatisé** | 0 fichier `.test.*` / `.spec.*` dans `src/`. Une plateforme qui manipule paiements + alcool + données mineurs + RGPD sans aucun filet de régression. | **Critique** |
| W4 | **Trous de conformité alcool/mineurs béants** | Vérifié dans le code : guest checkout sans age gate backend (`create-checkout/index.ts:157` accepte un `guestEmail` et crée l'order sans appel MinorAuthGate), date de naissance auto-déclarée jamais re-validée, aucun blocage horaire (pas de happy-hour enforcement), aucune vérif SIRET/licence alcool à l'onboarding Stripe Connect. | **Critique** |
| W5 | **Bus factor = 1** | Tout (119/189 pages, 94 functions, paiements, conformité) repose sur Paul. Une mise en demeure CNIL/ACPR ou un chargeback de masse = personne pour répondre. | Élevée |
| W6 | **Dette structurelle qui tuera la vélocité post-launch** | 933 appels `supabase.from()/rpc()` bruts sans couche data, React Query court-circuité (33 vs 793), 11 god-pages > 1000 LOC (Bouncer 1905, MyOrders 1842), 43 fichiers morts, 1154 hex inline. Un changement de schéma touche des dizaines de fichiers. | Élevée |
| W7 | **Admin opérateur non fonctionnel** | Pas de refund, pas de recovery compte, pas de suspension, pas de kill-switch event. « Inexploitable en l'état pour gérer du live ». On ne peut pas opérer une marketplace de paiements sans ces P0. | Élevée |
| W8 | **Déploiement incomplet + cap Supabase 402** | Front non déployé, plusieurs edge functions codées mais bloquées au déploiement (cap dépense). Le produit n'existe pas encore pour un utilisateur. | Élevée |

**Verdict faiblesses :** W1+W2 sont le cœur du diagnostic. Vous avez inversé l'ordre Lean Startup : construire 189 pages avant de valider qu'UN club veut payer. W3+W4 transforment chaque jour de prod en exposition pénale (vente alcool mineurs = crime en France, art. L.3353-1).

## Opportunités (Opportunities) — externes, exploitables

| # | Opportunité | Justification | Confiance |
|---|-------------|---------------|-----------|
| O1 | **Espace blanc co-soirée club↔BDE en France** | Aucun incumbent (Shotgun/Fever/Xceed) ne fait le partage de revenus contractualisé club↔asso étudiante. Marché ancré FR, JTBD réel. C'est votre unique angle Blue Ocean crédible. | Moyenne |
| O2 | **Bottle service digitalisé hors Espagne/Ibiza** | Tablelist/Discotech = US, Xceed = Sud-EU + Ibiza. Les villes FR/EU moyennes sont sous-servies. MAIS marché étroit (peu de villes ont une vraie culture bottle service) → petit SOM. | Faible-Moyenne |
| O3 | **Consolidation = portes de sortie / partenariats** | DoorDash↔SevenRooms (1,2 Md$), Zenchef↔CoverManager (PSG), Fever↔Dice. Les acheteurs stratégiques rachètent tout. Un wedge prouvé (3-5 clubs liquides) peut devenir une cible d'acquisition ou un partenariat OEM (cf. Sunday↔NCR Voyix). | Faible |
| O4 | **Intégration POS plutôt que concurrence** | Sunday a survécu en devenant l'infra de paiement DU POS (NCR), pas en restant une app fan. Yuno pourrait se brancher sur Toast/Square au lieu de les concurrencer sur la boisson. | Moyenne |
| O5 | **Saisonnalité festivals / beach clubs été** | Marché EU saisonnier exploitable pour un pilote concentré. | Faible |

**Verdict opportunités :** O1 est la seule qui justifie d'exister. Toutes les autres sont conditionnées à un recentrage. Aucune opportunité n'est exploitable tant que W1 (zéro client) n'est pas attaquée.

## Menaces (Threats) — externes, existentielles

| # | Menace | Détail | Criticité |
|---|--------|--------|-----------|
| T1 | **Xceed — l'analogue qui fait déjà les 3 piliers, avec 25M users** | Guestlist + tickets + VIP bottle service, QR en 2 taps, volet B2B « Xceed Pro », présent à Paris/Marseille/Toulouse/Barcelone/Madrid/Ibiza/Lisbonne. Cold start déjà résolu. C'est le contre-exemple vivant : votre thèse multi-pilier est faisable… mais déjà occupée. | **Critique** |
| T2 | **Fever — 724M$ ARR, valo ~2Md$, EBITDA+, 527M$ levés** | Découverte de masse + billetterie + média + production. S'il descend dans le bottle service, vous n'avez aucune défense. | **Critique** |
| T3 | **Shotgun possède déjà les promoteurs/orgas FR** | Marque culturelle forte chez exactement votre cible (clubs FR, BDE). Incumbent du pilier billet en France. | **Critique** |
| T4 | **POS modernes (Toast 23-28%, Square 27%, Sunday)** | Propriétaires de l'encaissement, du hardware, des données de vente. Yuno n'a AUCUNE intégration POS. Le pilier boisson est en concurrence frontale avec l'incumbent le mieux installé du bar. | **Critique** |
| T5 | **Le pilier boisson skip-the-bar = cimetière** | Yoello, Butlr, Barpay, Rooam, LineSkip : apps mono-ville mortes. Aucun gagnant paneuropéen. Signal que le JTBD ne tient pas en club bondé à 1h du matin. | Élevée |
| T6 | **Risque réglementaire pénal France** | Vente alcool mineur = crime (L.3353-1), Yuno = co-auteur facilitateur. CNIL : données mineurs conservées sans limite = amende jusqu'à 4% CA / 20M€. Statut DSP2 flou (escrow DJ) = risque ACPR. | **Critique** |
| T7 | **Pouvoir des acheteurs élevé** | Les clubs ont DÉJÀ un POS et DÉJÀ Shotgun. Coût de switch faible vers vous, mais coût de switch ÉLEVÉ pour les déloger de l'existant. | Élevée |

## Synthèse SWOT — la matrice TOWS (stratégies croisées)

- **S2 × O1 (Forces × Opportunités, stratégie offensive) :** miser TOUT sur le wedge co-soirée club↔BDE. C'est votre seule force défendable rencontrant votre seule opportunité Blue Ocean. C'est là, et nulle part ailleurs, que se joue Yuno.
- **W2 × T1 (Faiblesses × Menaces, stratégie de survie) :** votre « boil the ocean » vous met frontalement face à Xceed qui a déjà 25M users sur le même périmètre. Tuer le pilier boisson + abandonner 4 des 6 rôles n'est pas une option, c'est une condition de survie.
- **S1 × T6 (Forces × Menaces, défensif) :** votre architecture paiement saine ne vous protège PAS du risque pénal alcool/mineurs — le merchant-of-record est conforme pour le non-alcool seulement. Il faut un KYC ID réel + blocage guest alcool AVANT toute vente.
- **W1 × O3 (Faiblesses × Opportunités) :** sans 3-5 clubs liquides prouvés, aucune porte de sortie / acquisition / partenariat OEM n'est crédible. La consolidation joue CONTRE vous tant que vous n'avez pas de traction.

**Verdict d'ensemble :** la SWOT de Yuno est déséquilibrée vers les faiblesses internes structurelles (boil the ocean, zéro client, zéro test, conformité béante) et les menaces externes critiques (Xceed/Fever/Shotgun/Toast). Les forces réelles se réduisent à deux actifs (paiements + wedge collab). Le seul chemin finançable est le recentrage brutal sur S2×O1.

## 19. PESTEL — environnement macro du nightlife UE appliqué à Yuno

Analyse des six forces macro, chacune notée par son impact NET sur Yuno (favorable / défavorable / mixte) et sa criticité. Le nightlife UE est un secteur lourdement réglementé, cyclique, et culturellement en mutation — chaque facteur a une traduction directe sur le code construit.

## P — Politique

| Facteur | Impact sur Yuno | Criticité |
|---------|-----------------|-----------|
| **Politiques municipales anti-nuisance** | Les arrêtés préfectoraux/municipaux (fermeture, bruit, sécurité) ferment ou contraignent les clubs — vos clients B2B. Un club fermé = un tenant perdu. La densité de clubs viables par ville plafonne votre SOM. | Moyenne |
| **Souveraineté/régulation des plateformes UE (DMA/DSA)** | Marketplace multi-faces = exposition future aux obligations DSA (modération, transparence). Marginal à votre taille, mais structurel si vous grandissez. | Faible |
| **Soutien public à la vie nocturne (Night Mayors, conseils de la nuit)** | Paris, Berlin, Amsterdam structurent la « night economy ». Opportunité de partenariats institutionnels — mais ne génère pas de revenu direct. | Faible |

**Net P : mixte, faible.** La politique ne tue pas Yuno mais limite le nombre de clients viables par géographie.

## E — Économique

| Facteur | Impact sur Yuno | Criticité |
|---------|-----------------|-----------|
| **Inflation des sorties / pouvoir d'achat Gen Z** | Le panier nightlife se contracte. Moins de bottle service, moins de dépense par tête. Affecte directement votre assiette de commission (3-4%) ET la willingness-to-pay des clubs pour 49-199€/mois. | **Élevée** |
| **Cyclicité + saisonnalité forte** | Le clubbing est saisonnier (été beach clubs, rentrée BDE, creux janvier-février). Revenus en dents de scie → MRR instable, churn saisonnier, prévisions difficiles. | Élevée |
| **Take-rate squeeze** | Vous facturez 3% boissons / 4% billets/tables PLUS un abo. Shotgun/Xceed sont déjà installés ; pour déloger, vous devrez sous-tarifer ou absorber (vous avez déjà un toggle « cover the Yuno commission »). Compression de marge structurelle. | Élevée |
| **Coût d'acquisition B2B élevé** | Signer un club = vente terrain, longue, relationnelle. CAC B2B nightlife est notoirement élevé (cycle de vente, méfiance des patrons). Avec 0 réseau commercial, votre CAC réel est inconnu et probablement prohibitif. | **Élevée** |

**Net E : défavorable, élevé.** L'économie du nightlife post-inflation + la cyclicité + le take-rate squeeze attaquent directement vos deux sources de revenu (abo + commission). C'est le facteur macro le plus menaçant pour le business model.

## S — Socioculturel

| Facteur | Impact sur Yuno | Criticité |
|---------|-----------------|-----------|
| **Mouvement sobriété Gen Z / « sober curious »** | Tendance lourde : les 18-25 boivent moins. Attaque DIRECTEMENT le pilier boisson (déjà le plus faible) ET le bottle service (alcool-centré). Votre cœur de cible consomme moins d'alcool chaque année. | **Élevée** |
| **Déclin structurel du clubbing classique** | Fermetures de clubs en série UK/UE post-COVID, montée des events éphémères/day parties. Votre TAM de « clubs récurrents » rétrécit. | Élevée |
| **Culture BDE/étudiante française** | FAVORABLE et spécifique : les assos étudiantes organisent des soirées récurrentes, cherchent à partager les revenus avec les clubs. C'est EXACTEMENT votre wedge co-soirée. Ancrage culturel français réel. | **Élevée (favorable)** |
| **Friction d'usage en club bondé** | Le JTBD « skip the bar » échoue souvent : à 1h du matin, scanner un QR + payer + attendre ne bat pas « je tends ma carte au barman ». Le comportement réel contredit l'hypothèse produit. | Élevée |

**Net S : mixte mais structurellement défavorable au cœur alcool, fortement favorable au wedge BDE.** La sobriété Gen Z + le déclin du clubbing sapent les piliers boisson et VIP. La culture BDE FR est le seul vent favorable — et c'est précisément votre angle défendable.

## T — Technologique

| Facteur | Impact sur Yuno | Criticité |
|---------|-----------------|-----------|
| **Maturité Stripe Connect / Supabase / no-code-adjacent** | FAVORABLE : la stack moderne permet à un solo de construire ce qu'une équipe de 10 faisait. C'est ce qui vous a permis 94 functions / 189 pages. Mais cette même facilité abaisse la barrière à l'entrée pour TOUS — donc aucun moat technologique. | Mixte |
| **Domination du POS (Toast/Square)** | Les POS possèdent le terminal, le hardware, les données de vente. Sans intégration POS, le pilier boisson est mort-né côté ops (le bar n'a pas la main-d'œuvre pour traiter des commandes app pendant le rush). | **Élevée** |
| **Risque perf / charge non testé** | 0 load testing du scanning barman simultané, 933 requêtes + PWA + Mapbox. Un samedi soir à 500 commandes/h non testé. | Élevée |
| **PWA vs app native** | PWA limite l'expérience premium promise (Apple/Uber-like) — push notifications fragiles, pas de Wallet natif. Écart entre l'ambition « premium » et le support technique. | Moyenne |

**Net T : mixte.** La technologie vous a donné la vitesse mais aucun moat. L'absence d'intégration POS est le trou technologique le plus coûteux pour le pilier boisson.

## E — Environnemental

| Facteur | Impact sur Yuno | Criticité |
|---------|-----------------|-----------|
| **Dématérialisation (fin du cash, billets/reçus papier)** | FAVORABLE et aligné : QR, billets digitaux, cashless. Argument ESG léger mais réel pour les festivals (Weezevent en a fait un axe). | Faible (favorable) |
| **Pression énergétique sur les lieux** | Coûts d'exploitation des clubs en hausse → moins de budget logiciel. Indirect. | Faible |

**Net E : faible, légèrement favorable.** Facteur le moins déterminant. La dématérialisation joue marginalement pour vous.

## L — Légal (le facteur le plus dangereux)

| Facteur | Impact vérifié sur Yuno | Criticité |
|---------|-------------------------|-----------|
| **Loi sur la vente d'alcool aux mineurs (L.3353-1 Code santé publique)** | Vente alcool <18 = délit. Vérifié dans le code : guest checkout sans age gate backend, date de naissance auto-déclarée jamais validée par KYC, jamais re-vérifiée. Yuno = co-auteur en tant que facilitateur technique de la transaction. Un seul mineur servi = responsabilité pénale. | **Critique** |
| **Loi Évin (1991) — restrictions pub + horaires alcool** | Vérifié : aucun blocage horaire dans `create-checkout` (vente 24/24), affichage de boissons alcoolisées = publicité indirecte régulée. Non-conformité structurelle. | **Critique** |
| **RGPD (CNIL)** | Vérifié : `profiles.birth_date` jamais supprimée (pas de cron RGPD spécifique), pas de consentement parental (<16 ans, Art. 8), démographie participants public (« 45% < 20 ans ») croisée avec géoloc Mapbox = exposition de mineurs. Amende jusqu'à 4% CA / 20M€. | **Critique** |
| **DSP2 / agrément établissement de paiement (ACPR)** | Vérifié : escrow DJ (`dj-payout.ts`) — Yuno détient des fonds tiers 0-2 jours. Risque de requalification en service de paiement nécessitant agrément. Stripe = acquiring, mais Yuno = responsable du service. | Élevée |
| **Licence d'exploitation alcool des clubs** | Vérifié : onboarding Stripe Connect sans vérif SIRET ni certificat d'agrément. Un escroc peut ouvrir un « club » et vendre de l'alcool. | **Critique** |
| **Responsabilité événementielle / sécurité** | Billetterie + tables = obligations de sécurité événementielle (jauges, contrôle d'accès). Le rôle bouncer existe mais la responsabilité juridique du contrôle d'accès est ambiguë. | Moyenne |

**Net L : défavorable, CRITIQUE.** Le légal est le facteur PESTEL qui peut faire échouer Yuno du jour au lendemain. Quatre expositions critiques vérifiées dans le code. Investir maintenant = garantie d'un rewrite conformité de 500k-1M€ avant le moindre revenu. Aucune de ces failles n'est négociable avant un go-live alcool.

## Synthèse PESTEL

| Dimension | Net | Criticité | Le point qui compte |
|-----------|-----|-----------|---------------------|
| Politique | Mixte | Faible | Densité de clubs viables limite le SOM |
| Économique | Défavorable | **Élevée** | Inflation + saisonnalité + take-rate squeeze attaquent le revenu |
| Socioculturel | Mixte | **Élevée** | Sobriété Gen Z tue l'alcool ; culture BDE FR = seul vent favorable |
| Technologique | Mixte | Élevée | Vitesse sans moat ; absence d'intégration POS fatale au pilier boisson |
| Environnemental | Favorable | Faible | Dématérialisation marginalement positive |
| Légal | **Défavorable** | **CRITIQUE** | 4 expositions pénales/RGPD vérifiées = peut tuer Yuno immédiatement |

**Lecture stratégique :** trois des six dimensions (E, S, L) convergent vers un même verdict — le cœur alcool de Yuno (boisson + bottle service) est attaqué par la macro (inflation, sobriété, légal) tandis que le wedge BDE (S favorable) est le seul terrain où le vent souffle dans votre dos. Le PESTEL confirme la recommandation : pivoter vers l'OS opérationnel du club + co-soirée BDE, dé-risquer l'alcool, intégrer le POS.

## 20. Porter — les 5 forces du secteur nightlife SaaS/marketplace

Analyse des cinq forces de Porter appliquées au secteur exact de Yuno (SaaS + marketplace nightlife multi-pilier en Europe). Chaque force est notée en intensité (faible/moyenne/élevée) du point de vue d'un NOUVEL entrant non financé, pré-revenu — c'est la perspective qui compte ici, pas celle d'un incumbent.

## Force 1 — Pouvoir de négociation des CLIENTS (clubs, orgas, fans) — **ÉLEVÉ**

**Côté B2B (clubs / orgas / BDE) :**
- Les clubs ont DÉJÀ un POS (Toast, Square, SumUp) et DÉJÀ une billetterie (Shotgun en France). Le coût de switch VERS Yuno est faible, mais le coût de DÉLOGER l'existant est élevé : un patron de club ne remplace pas son encaissement pour un solo pré-revenu sans références.
- Très peu de clubs « premium » par ville → marché concentré → chaque client a un poids individuel énorme. Perdre 1 club sur 5 = -20% de revenu. C'est l'inverse d'un SaaS PLG où la perte d'un compte est diluée.
- Le toggle « cover the Yuno commission » que vous avez codé est un AVEU de ce pouvoir : vous anticipez déjà devoir absorber la commission pour convaincre. C'est une concession de pricing avant même d'avoir un client.
- Multi-homing trivial : un club peut garder Shotgun pour le billet ET tester Yuno pour le VIP. Rien ne le retient.

**Côté B2C (fans) :**
- Aucune fidélité. Un fan utilise l'app que son club/event impose ce soir-là. Zéro pricing power côté fan.

**Verdict force 1 : ÉLEVÉ.** Les acheteurs ont des alternatives installées, un coût de switch bas vers vous mais élevé pour vous adopter en remplacement, et une concentration qui leur donne un levier individuel fort. Vous avez déjà commencé à céder du pricing (toggle absorption).

## Force 2 — Pouvoir de négociation des FOURNISSEURS (Stripe, Supabase, Mapbox, Resend) — **MOYEN**

- **Stripe :** fournisseur critique ET concentré. Stripe peut fermer votre compte Connect si le statut DSP2 (escrow DJ, détention de fonds) est jugé non conforme, ou si les chargebacks alcool/mineurs explosent. Vous êtes structurellement dépendant : pas de Stripe = pas de produit. Pouvoir Stripe = élevé en cas de litige réglementaire.
- **Supabase :** vous avez DÉJÀ touché le cap (erreur 402 bloquant le déploiement de nouvelles edge functions). Le fournisseur dicte votre capacité de déploiement. C'est un pouvoir fournisseur qui se matérialise AUJOURD'HUI, pas en théorie. Lock-in fort (495 migrations, 158 policies RLS, Auth, Storage — migrer hors Supabase serait un chantier de plusieurs mois).
- **Mapbox / Resend :** substituables, pouvoir faible.

**Verdict force 2 : MOYEN, tendance élevée sur Stripe.** Le risque n'est pas le prix mais la DÉPENDANCE binaire : un litige Stripe (alcool/mineurs/DSP2) ou un cap Supabase non levé met le produit à l'arrêt. Le lock-in que vous subissez est plus dangereux que le coût.

## Force 3 — Menace des NOUVEAUX ENTRANTS — **ÉLEVÉE (contre vous)**

C'est la force la plus mal comprise par les fondateurs. La barrière à l'entrée pour CONSTRUIRE est aujourd'hui quasi nulle (vous-même l'avez prouvé : un solo + IA = 94 functions en quelques mois). Donc :
- N'importe qui peut répliquer votre code. Votre vitesse de construction (S3 dans le SWOT) n'est PAS un moat — c'est une commodité.
- Les VRAIES barrières dans ce secteur sont : la **liquidité** (offre d'events + audience fans dans UNE ville), la **distribution** (marque culturelle), et les **données de transaction**. Vous avez ZÉRO des trois. Xceed (25M users), Fever (724M$ ARR), Shotgun (marque FR) ont résolu le cold start ; vous démarrez à froid contre eux.
- Porter dit : quand les barrières à l'entrée sont basses pour les nouveaux entrants ET que les incumbents ont des barrières (capital, réseau) que vous n'avez pas, la structure d'industrie est MAUVAISE pour un entrant non financé. C'est exactement votre cas.

**Verdict force 3 : ÉLEVÉE et défavorable.** La facilité d'entrée joue CONTRE vous deux fois : elle n'empêche personne de vous copier, et elle ne vous protège pas des géants déjà installés.

## Force 4 — Menace des PRODUITS DE SUBSTITUTION — **MAXIMALE (critique)**

Les substituts ne sont pas seulement les concurrents directs — ce sont toutes les façons de faire le job SANS Yuno :
- **Le cash + le barman + le POS existant** = le substitut numéro 1. Pour la boisson, « je tends ma carte au barman » bat souvent « je scanne un QR, je paie, j'attends, je vais chercher ». Le JTBD skip-the-bar échoue côté opérationnel (le bar n'a pas la main-d'œuvre pour préparer des commandes app pendant le rush). Le cimetière d'apps (Yoello, Butlr, Rooam, Barpay) le prouve.
- **Shotgun / Dice / Fever** pour le billet — substituts installés avec marque et audience.
- **Sunday / Toast Pay-at-Table** pour le pay-at-table — Sunday a survécu en devenant l'infra DU POS (NCR), pas une app fan. Le substitut a déjà gagné en s'intégrant au terminal.
- **Tablelist / Xceed** pour le bottle service.
- **WhatsApp + Excel** pour la co-soirée BDE — le substitut artisanal actuel. C'est le SEUL endroit où votre produit bat clairement le substitut (contrat de partage de revenus signé vs Excel + virement manuel). D'où l'importance du wedge.

**Verdict force 4 : MAXIMALE.** Sur 2 de vos 3 piliers, le substitut (cash/POS pour la boisson, Shotgun/Fever pour le billet) est plus fort que votre offre. Le seul pilier où vous battez le substitut artisanal est la co-soirée BDE.

## Force 5 — INTENSITÉ CONCURRENTIELLE (rivalité) — **ÉLEVÉE**

- Le secteur vient de vivre une vague de consolidation (Fever↔Dice juin 2025, DoorDash↔SevenRooms 1,2Md$ mai 2025, Zenchef↔CoverManager juillet 2025). Les rivaux ont des bilans de plusieurs centaines de millions et rachètent l'adjacent exact de Yuno.
- Vous vous positionnez contre TOUS les incumbents à la fois : Shotgun/Fever/Xceed sur le billet, Tablelist/Xceed sur le VIP, Toast/Square/Sunday sur la boisson. Aucune d'entre eux n'a besoin de vous voir pour vous écraser — Xceed (même périmètre, 25M users) vous écrase par recouvrement, Fever vous ignore.
- La différenciation est faible : tout le monde fait QR + tickets + VIP. Seule la co-soirée BDE vous différencie réellement.

**Verdict force 5 : ÉLEVÉE.** Rivalité intense, incumbents capitalisés, consolidation en cours, différenciation faible sauf sur le wedge.

## Synthèse Porter — attractivité réelle du secteur

| Force | Intensité (pour Yuno entrant) | Effet net |
|-------|-------------------------------|-----------|
| 1. Pouvoir des clients | **Élevé** | Marge comprimée, concession pricing déjà concédée |
| 2. Pouvoir des fournisseurs | Moyen→Élevé (Stripe/Supabase) | Dépendance binaire, lock-in subi |
| 3. Menace nouveaux entrants | **Élevée** | Pas de moat ; vous êtes vous-même un nouvel entrant fragile |
| 4. Substituts | **Maximale** | Cash/POS/Shotgun battent 2 piliers sur 3 |
| 5. Rivalité | **Élevée** | Incumbents capitalisés, consolidation, faible différenciation |

**Score d'attractivité du secteur pour un entrant non financé : TRÈS FAIBLE.** Quatre des cinq forces sont défavorables, dont deux à l'intensité maximale (substituts) et critique. C'est une structure d'industrie hostile à un nouvel entrant pré-revenu : acheteurs puissants, substituts dominants, rivaux capitalisés, et aucune barrière qui vous protège tout en n'empêchant personne de vous copier.

**MAIS — la nuance qui sauve la thèse :** Porter analyse un SECTEUR, pas une NICHE. Le secteur « nightlife SaaS multi-pilier » est ininvestissable pour vous. La niche « OS opérationnel du club FR de ville moyenne + co-soirée club↔BDE contractualisée » a un profil de forces RADICALEMENT différent :
- Pouvoir clients : plus faible (les BDE n'ont pas d'alternative installée — leur substitut est WhatsApp + Excel).
- Substituts : faibles (personne ne fait le contrat de partage de revenus club↔asso).
- Rivalité : quasi nulle (Shotgun/Fever/Xceed ne font pas ce JTBD).
- Nouveaux entrants : la barrière devient la RELATION terrain avec les clubs/BDE FR, pas le code.

**Conclusion d'investisseur :** dans son périmètre actuel (3 piliers, 6 rôles, tous les incumbents en face), le secteur de Yuno a une attractivité Porter TRÈS FAIBLE — c'est un non-investissement. Recentré sur la niche co-soirée BDE FR, le profil Porter devient acceptable car vous quittez l'océan rouge pour le seul JTBD mal servi. La décision n'est pas « le secteur est-il bon » (non), mais « pouvez-vous quitter le secteur hostile pour la niche défendable » (oui, le code du wedge existe déjà). C'est tout l'enjeu du recentrage.

## 21. Analyse VC — Investirais-je ? (Sequoia)

## 21. Analyse VC — Investirais-je ? (perspective Sequoia)

### 21.1 La décision : NON en l'état. Conditionnel OUI sur preuve.

**Décision aujourd'hui : NON.** Je n'écris pas de chèque sur Yuno tel qu'il est : solo founder, pré-revenu, pré-déploiement, 0 client, 0 transaction, construit à l'envers (119 pages avant un club signé), positionné frontalement contre Shotgun + Fever + Xceed + Sunday + Toast *simultanément*, avec une exposition réglementaire alcool/mineurs **critique** non résolue (guest checkout sans age gate, pas de KYC d'identité, pas de vérification de licence club).

**Mais ce n'est pas un NON de mépris.** C'est un NON de *séquencement*. Ce founder a une qualité d'exécution rare (50 commits/mois en solo, architecture cohérente, Stripe Connect propre, contrats eIDAS — du jamais-vu en pré-seed). Le problème n'est pas "peut-il construire". Le problème est "construit-il la bonne chose, et y a-t-il une demande". À ce jour : **inconnu, parce que jamais testé sur un marché.** Je ne finance pas l'inconnu de la demande ; je finance la *réduction* de cet inconnu. Donc je donne au founder le chemin exact du NON → OUI.

### 21.2 Pourquoi NON, en termes Sequoia (le filtre dur)

Sequoia finance d'abord le **marché et le timing**, ensuite l'équipe, ensuite le produit. Application :

- **Market** : le nightlife software est un marché réel mais **déjà en phase de consolidation** (Fever↔Dice juin 2025, DoorDash↔SevenRooms 1,2 Md$, Zenchef↔CoverManager sous PSG). Les acheteurs stratégiques rachètent déjà tout. Un nouvel entrant non-financé arrive *après* le tournant de la consolidation. Mauvais timing pour une entrée généraliste. Criticité : **élevée**.
- **Équipe** : solo, bus factor = 1, aucune compliance/aucun co-founder. Pour un SaaS qui touche paiements + alcool + mineurs + RGPD, le bus factor 1 est un risque *régalien*, pas seulement opérationnel. Une mise en demeure CNIL ou un contrôle alcool, et il n'y a personne pour répondre. Criticité : **élevée**.
- **Produit** : excellente exécution, **zéro validation**. C'est le red flag central. Lean Startup est violé de bout en bout : pas de Build-Measure-Learn, juste Build-Build-Build. 0 test automatisé sur des rails de paiement et d'alcool = dette de risque, pas dette technique.
- **Traction** : nulle. Pas de DAU/MAU, pas de GMV, pas de club signé, `demo_is_live()` toggle dans le code. **Pour un seed je veux des signaux de demande ; ici il n'y en a aucun.**

### 21.3 Valorisation réaliste (si un tour avait lieu malgré tout)

Hypothèses explicitées, confiance moyenne. Marché 2026, France/UE, founder solo technique sans track record de sortie connu, pré-revenu, pré-déploiement.

| Scénario | Pré-money | Instrument | Conditions | Mon avis |
|---|---|---|---|---|
| **État actuel (rien de plus)** | **0,8–1,5 M€** | SAFE post-money plafonné | Aucune traction, valorisé sur la seule qualité d'exécution + optionnalité | Je ne participe pas. C'est de l'angel/FFF, pas du VC |
| **+ pilote signé (1 ville, 3-5 BDE, GMV réelle)** | **2,5–4 M€** | SAFE / pré-seed | Liquidité prouvée sur le wedge co-soirée, scope gelé | Intéressant pour un pré-seed |
| **+ rétention récurrente prouvée (3 mois, 3-5 clubs)** | **5–8 M€** | Seed equity | Net revenue retention >100 % sur le rail BDE, compliance bouclée | Là je discute d'un vrai seed |

Pourquoi si bas en l'état : en pré-seed UE, **le code ne porte quasiment aucune valeur** — il est largement réplicable et, pire, sa *largeur* est un passif (maintenance solo, dette d'archi sans couche data, 933 appels Supabase bruts). Un VC paie pour de l'optionnalité de *marché* prouvée, pas pour des lignes de code. Le founder a probablement l'intuition inverse ("j'ai construit énormément, ça vaut cher") — c'est une erreur de valorisation classique du founder technique. **Confiance sur la fourchette : moyenne** (très dépendante de la profondeur du founder et de signaux que je n'ai pas : sa capacité de vente B2B, son réseau clubs/BDE).

### 21.4 Les KPI que j'exige de VOIR avant un seed

Je ne regarde aucun KPI produit (pages, fonctions, migrations — ce sont des vanity metrics d'ingénieur). Je veux des **KPI de demande et de rétention**, sur le wedge unique (co-soirée club↔BDE), une ville :

1. **GMV mensuel réel** sur des transactions live (pas démo) — au moins 3 mois consécutifs en croissance.
2. **Take rate effectif encaissé** (commission réellement perçue après absorption/refunds), pas le take rate affiché.
3. **Net Revenue Retention des clubs** : un club signé continue-t-il à organiser des co-soirées le mois suivant ? Cible >100 %.
4. **Liquidité d'atomic network** : sur une ville, combien de clubs ET de BDE actifs simultanément (les deux faces). Un seul côté = pas de réseau.
5. **CAC vs payback** : combien coûte la signature d'un club + d'un BDE, en combien de mois de commission est-ce remboursé. (Hypothèse : si CAC club > 6 mois de commission, le modèle ne tient pas sans abo — or l'abo n'est pas validé.)
6. **Conversion fan→achat** sur une soirée réelle (le taux où le QR/skip-queue ou le billet convertit vraiment).
7. **Taux de no-show / fill rate** comparé au statu quo du club (la preuve que Yuno crée de la valeur mesurable, pas juste un canal de plus).

Sans ces 7 chiffres mesurés sur du *live*, il n'y a pas de seed possible. **Toute la valeur d'information est dans la transition de 0 transaction à 1000 transactions réelles.**

### 21.5 Les milestones précis qui me font passer de NON à OUI

Voici exactement ce qui transforme mon NON en OUI. Si le founder coche ça en 8-12 semaines, je reprends la conversation sérieusement :

**Bloc A — Survie réglementaire (BLOQUANT absolu, sinon pas de discussion) :**
- Age gate sur le guest checkout côté backend (aujourd'hui : trou critique, mineur anonyme achète de l'alcool).
- KYC d'identité réel pour la vente d'alcool (Onfido/Stripe Identity), fin de l'auto-déclaration.
- Attestation de licence alcool + SIRET avant onboarding club.
- MFA admin obligatoire + P0 admin (refund, suspension, kill-switch event).
Sans le Bloc A, **aucun investisseur sérieux ne touche à ça** — c'est une responsabilité pénale potentielle (L.3353-1) et une amende CNIL jusqu'à 20 M€. Criticité : **critique**.

**Bloc B — Preuve de wedge (ce qui crée la valeur) :**
- **Tuer 2 piliers (boisson, et réduire VIP au minimum) et 4 rôles.** Focus total sur co-soirée club↔BDE.
- **1 ville étudiante, 1 club ancre, 3-5 BDE, 3 soirées récurrentes live** avec GMV réel et contrats signés.
- **Rétention sur 3 mois** : les mêmes clubs/BDE reviennent. C'est LE signal de PMF.
- Les 7 KPI du 21.4 mesurés et présentés.

**Bloc C — Dé-risquage du bus factor :**
- Soit un co-founder (idéalement business/sales B2B ou compliance), soit un advisor opérationnel nightlife avec du skin in the game. Le solo founder technique sur un marché B2B de vente terrain est un handicap de distribution majeur.

**Le déclencheur unique du OUI :** *liquidité récurrente prouvée sur une atomic network d'une ville* + *Bloc A bouclé*. Si je vois 3-5 BDE qui re-signent leur soirée mensuelle dans le même club via Yuno sur 3 mois, avec de la GMV qui croît et de la compliance propre, **alors le data/network moat devient crédible et je passe à OUI** sur la fourchette 2,5–4 M€.

### 21.6 Potentiel de licorne — l'évaluation honnête

Probabilité d'atteindre 1 Md€ de valo : **très faible en trajectoire actuelle, faible-mais-non-nulle en trajectoire focalisée.** Raisons :
- Le marché du nightlife software FR/UE est *réel mais pas géant*. Même le champion (Fever) a mis 10 ans + 527 M$ levés pour ~2 Md$ de valo, et c'est un généraliste *experiences* mondial, pas un pure-play nightlife. Le TAM d'un "rail co-soirée club↔BDE" est, lui, **petit** (peu de villes à vraie densité BDE+clubbing) — excellent pour un wedge défendable, plafonnant pour une licorne.
- Le chemin licorne suppose : (1) gagner le wedge BDE, (2) l'utiliser comme cheval de Troie pour étendre au club mainstream, (3) devenir l'OS opérationnel multi-ville, (4) se faire racheter ou consolider plutôt que d'être consolidé. C'est jouable mais **long et capital-intensif**, exactement ce qu'un solo founder pré-revenu n'a pas.
- L'issue la plus probable et *parfaitement honorable* n'est pas la licorne : c'est un **acqui-hire ou une acquisition stratégique** par Shotgun, Weezevent ou un POS européen qui voudrait l'angle BDE + l'exécution Stripe Connect. Valeur réaliste de cette issue : 5–30 M€ selon la traction. C'est un bon résultat pour un founder solo, ce n'est pas un rendement de fonds Sequoia.

**Conclusion VC :** Yuno est un *excellent candidat acqui-hire / petit seed focalisé*, et un *mauvais candidat licorne en l'état*. Le founder a sur-construit le risque et sous-construit la preuve. Mon conseil, en tant que personne qui mettrait son propre argent : **ne déployez pas l'état actuel, gelez 90 % du scope, prouvez la liquidité du wedge BDE sur une ville, bouclez la compliance alcool — et revenez me voir avec 3 mois de rétention récurrente.** À ce moment-là, et seulement là, c'est un OUI.

## 22. Ce qui peut tuer Yuno — 50 scénarios d'échec, du plus probable au plus mortel

Ces 50 scénarios sont **spécifiques à Yuno** (solo founder, 189 pages avant 1 client, 3 piliers, alcool, non déployé, cap Supabase 402, concurrence Xceed/Shotgun/Fever/Sunday). Classés par **probabilité décroissante**. Chacun: le scénario + pourquoi il est mortel. Quand un scénario est marqué **[FATAL]**, il peut à lui seul tuer la boîte.

### Tranche 1 — Quasi-certains (probabilité > 70%)

1. **Cold start jamais résolu dans la 1re ville.** [FATAL] Aucun marketplace nightlife ne survit sans liquidité locale (assez d'events ET de fans dans UNE ville le même samedi). Yuno part de zéro contre Xceed (25M users) et Shotgun (qui possède déjà les promoteurs FR). Sans ~5 clubs réels remplis le même soir, l'app est vide, le fan ne revient pas, le club voit 0 vente et churn. *Mortel: c'est la cause de mort #1 de toute marketplace, et Yuno a construit 189 pages avant de tester la liquidité d'un seul club.*

2. **Le 1er club refuse de payer 49-199€/mois ET 3-4% de commission.** [FATAL] L'hypothèse de revenu (abo + take-rate) a **0 validation**. Le club a déjà un POS (Toast/Square/SumUp) qui prend l'encaissement, déjà Shotgun pour le billet. Pourquoi paierait-il deux fois? Si la réponse est non, le business model s'effondre après 94 edge functions et 495 migrations. *Mortel: 94 fonctions construites sur une hypothèse de prix jamais confrontée à un acheteur réel.*

3. **Le fondateur solo brûle 6-12 mois à maintenir 189 pages au lieu de vendre.** [FATAL] Bus factor = 1. Chaque heure passée à régénérer i18n trilingue (2,2 Mo), à corriger une god-page de 1905 LOC (Bouncer), à câbler un 6e rôle, est une heure NON passée en porte-à-porte clubs. La surface construite devient le piège: elle exige de la maintenance avant d'avoir un euro. *Mortel: le scope se retourne contre son créateur — l'actif devient passif.*

4. **Premier déploiement: cap Supabase 402 bloque les edge functions critiques le jour J.** Plusieurs fonctions (auth mineurs, staff PIN, etc.) sont codées mais NON déployées. Le go-live se heurte à un mur ops trivial mais bloquant. *Mortel à court terme: pas de checkout = pas de revenu, et le fondateur découvre le blocage en production.*

5. **Un mineur achète de l'alcool via guest checkout (zéro age gate backend).** [FATAL] Confirmé dans le code (`create-checkout/index.ts:157-159` — guest checkout sans aucun appel MinorAuthGate). Article L.3353-1 du Code de la santé publique: vente d'alcool à mineur = délit, Yuno = co-auteur (facilitateur technique). Un seul cas médiatisé, un seul contrôle, et c'est fermeture + responsabilité pénale du fondateur. *Mortel: risque régalien non assurable, déclenché par UNE transaction.*

6. **Le pilier boisson skip-the-bar ne tient pas le JTBD en club bondé.** Le segment est un cimetière (Yoello, Butlr, Barpay, Rooam): aucun gagnant paneuropéen. À 1h du matin en boîte pleine, scanner-payer-attendre-aller chercher sa conso ne bat pas "je tends ma carte au barman". Le bar n'a pas la main-d'œuvre pour préparer des commandes app pendant le rush. *Mortel pour le pilier que le fondateur met en avant comme MVP — il a misé sur le plus faible.*

7. **Aucun PMF signal n'arrive parce qu'aucune métrique n'est instrumentée.** Pas de DAU/MAU, pas de funnel conversion, code en mode démo (`demo_is_live()` confirmé). Le fondateur ne saura pas s'il a un PMF même s'il l'avait. *Mortel: on pilote à l'aveugle, on persévère sur du mort, on tue sur du vivant.*

8. **Un bug de paiement non testé (0 test automatisé) cause un double-débit ou un mauvais split Stripe Connect.** 933 appels Supabase bruts, 0 test sur la logique de paiement multi-tenant. Un mauvais `transfer_data` ou `application_fee` et le club est sous-payé ou le client sur-débité. *Mortel pour la confiance: en B2B nightlife, un club lésé une fois ne revient jamais et le dit à tous les autres.*

9. **Xceed descend (ou est déjà) sur les villes FR cibles de Yuno.** Même périmètre exact (guestlist + tickets + VIP bottle service + Xceed Pro B2B), déjà présent Paris/Marseille/Toulouse, 25M clubbers. Yuno arrive 5 ans trop tard sur sa propre thèse. *Mortel: l'espace n'est pas vide, il est occupé par un acteur financé qui a résolu le cold start.*

10. **Le fondateur épuise son cash personnel avant le 1er euro de revenu récurrent.** Construire ≠ vendre. Sans levée (et il n'est pas finançable en l'état — verdict des 3 audits), le runway personnel d'un solo founder pré-revenu est fini. *Mortel: la boîte meurt de faim avant la traction.*

### Tranche 2 — Très probables (50-70%)

11. **Le club signé pilote utilise Yuno 2 soirs puis revient au POS existant** parce que le double système (POS + Yuno) double la charge staff sans bénéfice net prouvé. *Mortel: churn du pilote = pas de référence = pas de 2e club.*

12. **Le barman n'adopte pas le scan QR sous le rush** (god-page Barman 1905 LOC, UX non testée sous charge, 0 load testing). Si le staff sabote l'outil, le club l'abandonne. *Mortel: l'adoption opérationnelle terrain tue plus de SaaS B2B que la techno.*

13. **CNIL: données mineurs (`birth_date`) conservées indéfiniment, sans consentement parental.** Confirmé: pas de cron de suppression, pas de droit à l'oubli implémenté. Amende jusqu'à 4% du CA ou 20M€. *Mortel à moyen terme: une plainte suffit à déclencher un contrôle.*

14. **Un escroc ouvre un "club" fictif (aucune vérif licence alcool/SIRET), vend, et disparaît.** Stripe Connect KYC ne vérifie pas l'agrément alcool local. *Mortel pour la réputation + responsabilité plateforme.*

15. **L'admin panel non fonctionnel rend impossible la gestion d'un incident live** (pas de refund, pas de recovery compte, pas de suspension, pas de kill-switch event — audit SUPERADMIN: "inexploitable en l'état"). Premier litige client = paralysie opérationnelle. *Mortel: on ne peut pas opérer un service de paiement sans pouvoir rembourser ni suspendre.*

16. **Le fondateur tombe malade / s'épuise / arrête 3 semaines.** Bus factor = 1, aucune équipe compliance, aucun co-founder. Mise en demeure CNIL/ACPR = impossible à traiter. *Mortel: la boîte n'a aucune redondance humaine.*

17. **Shotgun ajoute le pay-at-table ou le VIP, ou un club FR préfère rester sur Shotgun** qu'il connaît déjà. L'incumbent possède les promoteurs et orgas que Yuno veut signer. *Mortel sur le pilier billet en France — le plus contesté.*

18. **Le chargeback rate explose faute de logique dispute intelligente** (non implémentée). Stripe peut geler/fermer le compte plateforme au-delà d'un seuil. *Mortel: sans Stripe, pas de produit du tout.*

19. **ACPR/DSP2: Yuno détient des fonds tiers (escrow DJ 0-2j, transferts retenus collab)** sans agrément d'établissement de paiement. Requalification possible. *Mortel: interdiction de manipuler les fonds = mort du modèle marketplace.*

20. **Le contrat co-soirée club↔BDE (le seul vrai wedge) ne trouve pas preneur** parce que les BDE étudiants n'ont ni budget ni process pour signer un contrat eIDAS de partage de revenus. *Mortel: le seul angle défendable s'avère sans demande solvable.*

21. **La régénération i18n trilingue (2,2 Mo, 30 948 lignes) introduit des clés orphelines / white-screens** à chaque feature. *Mortel à petit feu: la vélocité ralentit jusqu'à l'arrêt.*

22. **Une god-page > 1000 LOC (11 au total) devient impossible à débugger en prod sous incident.** *Mortel pour le temps de résolution: un bug payment dans MyOrders 1842 LOC se corrige en heures, pas en minutes.*

23. **Le client ne comprend pas qui débite sa carte** (relevé = nom du club, pas Yuno). Confusion → litige → chargeback. *Mortel cumulé avec #18.*

24. **Sunday (mieux capitalisé, 21M$ levés, OEM NCR) prouve que même bien financé le pay-at-table brûle du cash** — un solo pré-revenu n'a aucune chance sur ce mécanisme. *Mortel par analogie: si Sunday a dû couper 60% de ses marchés, Yuno n'a pas le coussin.*

25. **Aucune intégration POS (Toast/Square/Lightspeed).** Yuno tente de remplacer le POS au lieu de s'y brancher. Les clubs ne jettent pas leur terminal. *Mortel: le pilier boisson est en frontal avec l'incumbent le mieux installé.*

### Tranche 3 — Probables (30-50%)

26. **Happy hours / horaires légaux alcool non bloqués** (vente 24/24 dans le code). Loi Évin. *Mortel régalien si contrôle.*

27. **Les 158 policies RLS contiennent une faille d'isolation tenant** non auditée → un club voit les données d'un autre. *Mortel pour la confiance B2B.*

28. **Admin sans MFA obligatoire + `sk_` Stripe dans les edge functions** → compromission du compte plateforme. *Mortel: accès total aux fonds et données.*

29. **Le setup d'un nouvel environnement échoue** (495 migrations, ghost migrations Lovable, checksums divergents). *Mortel pour la continuité: impossible de reconstruire la prod après un incident.*

30. **Le fondateur tente les 6 segments (clubs, orgas/BDE, promoteurs, affiliés, DJs, staff) et n'en domine aucun.** Crossing the Chasm: 6 "main streets" sans tête de pont. *Mortel: dilution de l'effort = aucun segment ne bascule.*

31. **Fever (724M$ ARR) ou un acquéreur stratégique copie le wedge collab en 1 sprint** s'il devient intéressant. Pas de moat défendable. *Mortel: aucune barrière à la copie.*

32. **Le PWA + Mapbox + 933 requêtes ralentit l'app sur mobile en réseau dégradé (club, sous-sol).** *Mortel pour l'UX: en club, pas de 4G = pas de commande.*

33. **Le toggle "absorber la commission" mal câblé refacture le client** (déjà arrivé une fois: line_item Stripe facturait serviceFee au lieu de transactionFee, cf. mémoire projet). *Mortel cumulé: érode la confiance club + client.*

34. **Le fondateur sur-construit la prochaine feature (un 7e rôle, une 4e analytics) au lieu de signer le 2e club.** Pattern d'évitement classique du builder. *Mortel: le produit grossit, la traction reste à zéro.*

35. **Le marché FR du "vrai" bottle service est trop étroit** (peu de villes ont la culture). SOM minuscule. *Mortel pour la taille: même en gagnant, le marché ne nourrit pas une scale-up.*

36. **Le club veut payer la commission mais PAS l'abonnement** (ou l'inverse). Le pricing à deux étages casse. *Mortel: chaque étage validé séparément peut invalider l'autre.*

37. **Resend / emails de confirmation cassés** (déjà eu un bug PGRST201 avalant les confirmations billet/VIP). Pas de billet reçu = litige + no-show. *Mortel cumulé: revenue-critical.*

38. **Le DJ marketplace avec séquestre Stripe attire un litige cachet** sans preuve contractuelle forte. *Mortel pour ce sous-pilier + risque DSP2.*

39. **Concurrence sur la data: Yuno promet "data client" mais ne peut pas la livrer mieux que le POS** qui a déjà toutes les ventes. *Mortel pour l'argument de vente principal.*

40. **Le fondateur ne peut pas répondre à un appel d'offres / due diligence technique** (0 test, 0 doc d'archi à jour, dette structurelle documentée). *Mortel pour la levée: un VC technique passe en 10 min.*

### Tranche 4 — Possibles mais moins probables (< 30%), souvent à fort impact

41. **Procédure pénale alcool-mineur visant personnellement le fondateur** (pas la société). *Mortel personnel: même si la boîte survit, le fondateur est exposé.*

42. **Stripe ferme le compte pour activité "alcool + données mineurs" jugée à risque.** *Mortel: dépendance fournisseur totale.*

43. **Une fuite de données (location Mapbox + age des participants, "45% < 20 ans")** exploitée → scandale + CNIL + réputation. *Mortel: dé-anonymisation de mineurs.*

44. **Le co-founder/employé clé recruté trop tard ne peut pas reprendre 210 600 lignes non testées.** Onboarding impossible. *Mortel pour le passage à l'échelle humaine.*

45. **Un club concurrent / Shotgun fait du FUD sur la conformité alcool de Yuno** auprès des clubs cibles. *Mortel commercial: la conformité devient l'argument anti-Yuno.*

46. **Cloudflare Workers assets-only + CORS-lock yunoapp.eu casse en prod** sur un cas non prévu (sous-domaine, app mobile). *Mortel ponctuel: checkout HS = revenu HS.*

47. **Le marché bascule vers le cashless festival (Weezevent, 350M€ CA)** et Yuno n'a pas l'échelle event. *Mortel sur le segment festival si Yuno y va.*

48. **DoorDash/SevenRooms (1,2Md$) pousse le CRM/réservation premium en EU** et avale le segment table. *Mortel concurrentiel haut de gamme.*

49. **Le fondateur pivote trop tard** parce que le sunk cost de 189 pages l'empêche de tuer le pilier boisson. *Mortel cognitif: l'attachement au code construit retarde la décision qui sauve.*

50. **Yuno réussit techniquement mais reste un "feature", pas une "company"** — racheté pour une bouchée de pain ou ignoré par Fever/Xceed qui ne le verront jamais. *Mortel pour la thèse VC: pas un outcome 10M€, au mieux un acqui-hire.*

---

**Synthèse red-team:** les 10 premiers scénarios (cold start, prix non validé, solo-maintenance, cap 402, mineur-alcool, JTBD boisson, zéro métrique, bug paiement, Xceed, runway) sont **tous à probabilité > 50%** et **au moins 5 sont individuellement fatals**. Yuno ne meurt pas d'un risque exotique: il meurt du combo le plus banal — **construit la mauvaise chose, trop large, sans client, contre tous les incumbents à la fois, sans pouvoir l'opérer ni le prouver.** Le risque #1 n'est pas technique (l'exécution solo est réellement impressionnante), c'est **stratégique et séquentiel**: tout a été fait à l'envers.

## 23. Ce qui peut faire exploser Yuno — les 50 leviers, du plus impactant au moins

Préambule méthodo : « exploser » ici veut dire upside asymétrique, pas "feature sympa". J'ai trié par impact réel sur la survie et la valeur, en croisant ce qui est **déjà codé** (donc activable en jours, pas en mois) avec ce qui est **défendable** (un fossé que Shotgun/Fever/Xceed ne creusent pas). Verdict transversal d'abord, car il conditionne tout le reste : **les 5 premiers leviers concentrent 80% de l'upside ; les 45 autres ne valent rien tant que les 5 premiers ne sont pas prouvés sur 3 clubs réels.** Ne lisez pas cette liste comme un backlog. Lisez-la comme une carte de priorités où tout sous le n°10 est du bruit avant PMF.

### Le cœur de réacteur (n°1-5) — l'unique chemin finançable

**1. Le wedge co-soirée club↔BDE, DÉJÀ CODÉ, est le seul océan bleu réel.** C'est le constat le plus important de tout le dossier. `event_collab_contracts` + contrat-cadre récurrent (migration `20260626140000` LIVE) + hub symétrique (`CollabProposalsInbox`) + `bde_verified` + plancher commission 0,49€ : vous avez construit le **partage de revenus contractualisé signé entre un club et une asso étudiante sur une co-soirée récurrente**. Shotgun ne le fait pas. Fever ne le fait pas. Xceed ne le fait pas. C'est un JTBD (Jobs To Be Done) réel — "je suis un BDE, je veux organiser ma soirée récurrente dans un club partenaire sans me faire arnaquer sur la répartition et sans paperasse" — mal servi, géographiquement ancré (le BDE est une institution **française**), et avec un point d'entrée viral intégré (chaque promo d'asso renouvelle ses membres tous les ans). **Impact : critique. C'est votre raison d'exister. Tout le reste est secondaire.**

**2. La boucle d'acquisition virale gratuite du BDE.** Un BDE = 200-2000 étudiants captifs qui ressortent chaque semestre. Contrairement à un club (acquisition B2B lente, cycle de vente long, déjà sous Shotgun), une asso étudiante n'a quasi pas de coût d'acquisition : on en signe une, elle ramène ses adhérents (côté fan) ET son club partenaire (côté offre). C'est un **résolveur de cold start à deux faces simultané** (Chen, *Cold Start Problem*). Vous tenez peut-être le seul mécanisme de la nightlife française où l'offre ET la demande arrivent dans le même contrat. **Impact : critique.** Personne d'autre dans le dossier concurrentiel n'a ce levier.

**3. Le "club OS" opérationnel comme fossé de rétention (pas d'acquisition).** L'outillage staff que vous avez déjà — Bouncer, Vestiaire, Hôte VIP, Manager, scan QR, floor plan VIP — n'attirera jamais un client (personne ne change de plateforme pour un meilleur écran de videur). Mais une fois le club dedans via le BDE, ces outils créent une **rétention que Shotgun n'a pas** : Shotgun s'arrête au billet, vous gérez la soirée. Le levier n'est pas "vendre l'OS", c'est "une fois entré par le BDE, le club ne peut plus partir parce que tout son ops vit chez vous". **Impact : élevé.** C'est le mur de sortie, pas la porte d'entrée.

**4. La donnée transactionnelle propriétaire post-PMF.** Une fois 5-10 clubs FR actifs, vous détenez quelque chose qu'aucun POS ne corrèle : qui vient, d'où (origines clients Mapbox), démographie réelle des participants, no-show, yield par soirée, ROI promoteur, crédits conso liés à l'événement. C'est l'actif que Fever a payé 2 Md$ pour accumuler. **Mais attention** : cette donnée ne vaut rien à 0 club et devient un passif RGPD à risque maximal si elle inclut des mineurs (voir §24). **Impact : élevé, conditionnel à la traction.**

**5. Le contrat-cadre récurrent comme verrou de revenus.** "Signer une fois pour toute la résidence" (memory `project_collab_series_contract`) transforme une vente ponctuelle en abonnement de fait : chaque occurrence auto-acceptée génère de la commission sans friction de re-signature. C'est un mécanisme de **revenu récurrent déguisé** sur des soirées récurrentes (le mardi étudiant, le jeudi techno). Le LTV par couple club-BDE explose vs une transaction one-shot. **Impact : élevé.** C'est ce qui transforme un wedge en business.

### Leviers de monétisation et d'expansion défendables (n°6-15)

**6. Double monétisation abonnement + commission (déjà pricée).** Le modèle "jamais paywaller la vente, monétiser la croissance" (Core gratuit gros / Essential 49 / Pro 99) est stratégiquement juste : il maximise l'adoption (zéro friction à vendre) et capture la valeur sur la croissance. C'est la bonne réponse au pouvoir de négociation élevé des clubs (Porter). **Impact : élevé** — mais 0 validation que les clubs paieront 49-199€/mois (hypothèse la plus dangereuse, voir §24).

**7. Toggle "absorber la commission Yuno".** Permet au club de manger la commission pour afficher un prix rond au fan, ou de la répercuter. Petit détail, gros effet sur l'adoption : enlève l'objection "vous prenez sur MON client". **Impact : moyen-élevé.** C'est un lubrifiant de vente B2B sous-estimé.

**8. Expansion festival / beach club via le cashless.** Vous avez déjà les briques (billetterie + crédits conso + scan). Le festival est un marché à 350 M€ de CA rien que sur Weezevent en France. **Mais** c'est un océan rouge consolidé (Weezevent + PlayPass) et un cycle de vente annuel brutal. À garder comme **expansion post-PMF, jamais comme entrée**. **Impact : moyen, timing critique.**

**9. Marketplace DJ avec paiement séquestré.** `dj_booking_contracts` + escrow Stripe + payout auto : c'est un produit complet, rare en pré-seed. Le DJ est un acteur viral (il partage sa page, ramène son audience). **Mais** l'escrow déclenche un risque DSP2/ACPR (voir §24) et c'est un 7e segment à ne PAS prioriser. **Impact : moyen, fort potentiel viral, risque réglementaire élevé.**

**10. Liens trackés et boucle promoteur/affilié.** `tracked_links`, commission au scan guestlist, fenêtres horaires : vous avez une machine d'attribution que peu d'incumbents exposent au niveau du promoteur individuel. Le promoteur est un vendeur gratuit motivé par la commission. **Impact : moyen-élevé** comme amplificateur, **inutile sans offre signée d'abord.**

**11. Crédits conso liés à l'événement.** Le pré-achat de boissons rattaché au billet ([start−2h, end+2h]) est un mécanisme de cash-in anticipé élégant qui contourne le pilier "skip-the-bar" perdant en le transformant en "acheter sa conso avec son billet". C'est la **bonne façon de faire de la boisson** : pas une app de commande au bar (cimetière), mais un upsell au moment du billet. **Impact : moyen.** Pivot intelligent d'un pilier mort.

**12. Contrats eIDAS signés.** Niveau de professionnalisme légal rare en startup. Pour le segment BDE (qui a besoin de couvrir l'asso et son bureau légalement), c'est un **argument de vente différenciant**. **Impact : moyen.** Transforme une faiblesse perçue (jeune asso) en sérieux.

**13. Multilingue EN/FR/ES natif.** L'i18n complet ouvre l'Espagne/Ibiza sans rewrite — mais c'est précisément le terrain de Xceed (25 M users). À voir comme **option d'expansion**, pas comme avantage immédiat. **Impact : moyen, défensif.**

**14. Analytics post-soirée (verdict "hype").** Le moteur `usePostEventAnalysis` donne au club un verdict actionnable post-event. C'est un hook de rétention (le club revient voir son score). **Impact : moyen.** Engagement, pas acquisition.

**15. Architecture "club = marchand de record".** Stripe direct charges + on_behalf_of : vous évitez d'être le vendeur d'alcool de record, ce qui est juridiquement vital. C'est un **levier de dé-risquage** (pas de croissance), correctement architecturé. **Impact : élevé en tant que protection, nul en tant qu'attrait.**

### Leviers d'exécution et de vélocité (n°16-30)

**16. Vélocité de construction solo assistée IA** (50 commits/mois, 3 piliers en semaines) — prouve que vous pouvez itérer vite *une fois la direction juste trouvée*. **17. Design systems séparés public/pro** déjà matures — pas de dette UX. **18. Centralisation des frais (`fees.ts`)** — un seul endroit pour changer la commission, agilité pricing. **19. PWA + push** — pas de friction app store, mise à jour instantanée. **20. RLS granulaire par tenant** — base multi-tenant saine pour scaler les clubs. **21. Onboarding fast-path pillar-aware** — réduit le time-to-value B2B. **22. Reveal d'adresse au choix (lieu secret)** — feature nightlife réelle (after, lieux confidentiels) que les généralistes ne font pas. **23. Système de slugs publics propres** (/o, /dj) — SEO et partageabilité. **24. OG share worker Cloudflare** — aperçus de lien soignés, viralité du partage. **25. Mode d'emploi synchronisé** — réduit le support solo. **26. Notifs deep-link vers la commande exacte** — UX opérationnelle léchée. **27. Globe Mapbox origines clients** — wow-factor de démo B2B (vendre le rêve data au club). **28. Démographie participants** — argument de vente aux marques/sponsors du club. **29. Co-event accounting (TVA, exports PDF/CSV)** — répond au vrai besoin compta du club, friction administrative que Shotgun ignore. **30. Toggle demo `demo_is_live()`** — permet de faire des démos commerciales convaincantes sans vrai trafic (à double tranchant, voir §24).

### Leviers de marché et de positionnement (n°31-45)

**31. Niche villes FR/EU secondaires** que Xceed ne couvre pas en profondeur (Xceed = grandes métropoles + Ibiza). **32. Le BDE comme cheval de Troie vers le club** : signer l'asso pour signer le club derrière. **33. Récurrence étudiante** : le calendrier universitaire crée une demande prévisible et saisonnière. **34. Partenariats écoles/universités** comme canal d'acquisition B2B2C gratuit. **35. Bouche-à-oreille inter-BDE** (les bureaux se parlent entre villes/écoles). **36. Sponsoring marque sur soirées étudiantes** (Red Bull, etc. ciblent les BDE — vous tenez la data d'audience). **37. Verticalisation "OS du club FR"** comme positionnement Blue Ocean défendable (vs les 3 piliers diffus). **38. Intégration POS** (Toast/Square/SumUp) — au lieu de concurrencer le POS sur la boisson, s'y brancher : c'est le pivot qui sauve Sunday (OEM NCR). **39. Marque culturelle nightlife FR** à construire avant que Fever ne descende. **40. Affiliés multi-villes** pour amorcer la liquidité ville par ville. **41. Programme early adopters (3 mois gratuits via toggle Super Admin)** — déjà codé, accélère le cold start. **42. Annuel 2 mois offerts** — améliore le cash et réduit le churn. **43. Modules premium à la carte** — monétisation incrémentale post-adoption. **44. White-label club** (retrait branding Yuno en payant) — levier d'upsell premium déjà pricé. **45. Plancher commission BDE 0,49€** — protège la marge sur petits paniers étudiants tout en restant indolore.

### Leviers spéculatifs / long terme (n°46-50)

**46. Données agrégées anonymisées revendables** aux marques/villes (tendances nightlife) — actif data à 5+ ans, sous réserve RGPD strict. **47. Expansion Espagne via l'i18n ES** (mais frontale avec Xceed). **48. API/plateforme pour des intégrateurs tiers** (POS, CRM) — far future. **49. Crédit/financement de soirée** pour les BDE (avance de trésorerie sur billetterie) — fintech adjacent, risque réglementaire majeur. **50. Marketplace de prestataires nightlife** (traiteurs, sécurité, déco) — extension de l'écosystème, dilutif tant que le cœur n'est pas prouvé.

### Le seul tableau qui compte

| Levier | Codé ? | Défendable vs incumbents ? | Activable en | Verdict |
|---|---|---|---|---|
| Co-soirée club↔BDE contractualisée | OUI (LIVE) | OUI (personne ne le fait) | Jours | **L'unique pari** |
| Boucle virale BDE (cold start 2-faces) | Partiel | OUI | Semaines | **À prouver d'urgence** |
| Club OS / rétention staff | OUI | OUI (Shotgun s'arrête au billet) | Déployé | Mur de sortie |
| Pilier boisson skip-the-bar | OUI | NON (cimetière + POS) | — | **À TUER** |
| Affronter les 3 piliers à la fois | OUI | NON | — | **À ABANDONNER** |

**Conclusion de §23 :** vous n'avez pas 50 leviers. Vous avez **UN** levier (le wedge BDE, déjà codé) et 49 amplificateurs qui ne s'allument que s'il fonctionne. La bonne nouvelle, énorme : ce levier est **déjà construit, déjà LIVE en base, et structurellement unique en France**. La mauvaise : vous l'avez enterré sous 118 autres pages qui le rendent invisible, à vous comme aux investisseurs.

## 24. Ce que le fondateur ne voit probablement pas — angles morts, biais, et hypothèses fatales

Cette section est l'inverse de la précédente. §23 était l'optimiste lucide. §24 est le révélateur d'angles morts. Je vais être brutal parce que c'est la seule chose utile : vous avez construit avec un talent rare, et c'est exactement ce qui rend ces angles morts dangereux — votre compétence d'exécution masque vos erreurs de direction.

### Le méta-angle-mort : vous confondez "construit" avec "validé"

Le biais central, celui dont tous les autres dérivent : **vous traitez 119 pages comme une preuve d'avance alors que c'est une preuve de risque.** Chaque page construite avant le premier client signé est une hypothèse non testée que vous avez payée d'avance en temps. 189 pages, 94 fonctions, 495 migrations : ce n'est pas un fossé concurrentiel, c'est **du capital immobilisé dans des paris non vérifiés.** Xceed a 25 M d'utilisateurs ; vous avez 25 M de lignes-équivalent de spec. Le marché ne paie pas pour du code. Il paie pour un problème résolu, prouvé par quelqu'un qui sort sa carte bleue. Vous n'avez aucune de ces preuves.

### Les 7 hypothèses les plus dangereuses (par criticité)

**H1 — "Si je le construis, ils viendront." (CRITIQUE).** C'est le mythe fondateur le plus mortel et vous êtes en plein dedans. La preuve : 119 pages, 0 client. Lean Startup dit l'inverse : construire le minimum pour *invalider* une hypothèse, le plus vite possible. Vous avez maximisé le construit et minimisé l'appris. **Test invalidant immédiat :** appelez 10 BDE et 10 clubs cette semaine. Demandez-leur de signer une lettre d'intention payante (pas un "oui ça a l'air cool"). Si vous n'en signez aucun, aucune ligne de code de plus ne doit être écrite.

**H2 — "Je peux gagner sur 3 marchés à la fois." (CRITIQUE).** Crossing the Chasm est catégorique : on prend UN segment, on le domine, on traverse le gouffre, PUIS on étend. Vous visez simultanément billet (océan rouge : Shotgun/Fever/Xceed), table VIP (Tablelist/Xceed) et boisson (cimetière + Toast/Square/Sunday). Trois fronts, trois incumbents mieux capitalisés, zéro tête de pont. Vous ne dispersez pas vos forces — vous les dispersez **contre les armées les plus fortes de chaque front.** Le pilier boisson est le pire des trois (job-to-be-done qui ne tient pas en club bondé à 1h, POS qui possède déjà l'encaissement) et c'est précisément celui que vous mettez en avant comme "MVP".

**H3 — "Les clubs veulent réduire la file d'attente." (ÉLEVÉE).** Hypothèse non vérifiée et probablement fausse côté opérationnel. Un bar bondé n'a **pas la main-d'œuvre** pour préparer des commandes app pendant le rush — la file au bar EST le mécanisme de débit. Et côté business : le club ne gagne pas plus en réduisant la file, il gagne plus en vendant des bouteilles VIP et des entrées. Vous résolvez une douleur du *fan* (attendre) en croyant résoudre une douleur du *club* (qui n'en est pas une, voire un anti-objectif : la file crée de la rareté perçue). **JTBD du club ≠ JTBD du fan, et c'est le club qui paie.**

**H4 — "Les clubs paieront 49-199€/mois + 3-4% de commission." (ÉLEVÉE).** Zéro validation. Pire : votre propre note pricing (memory `project_pricing_strategy`) dit que le risque central est "si clubs ne veulent pas payer croissance mais payer commission, le business model s'effondre". Vous avez identifié le risque fatal et construit 94 edge functions par-dessus sans le tester. Le club a déjà un POS (Toast 23-28% du marché) et déjà Shotgun. Votre pouvoir de négociation (Porter) est quasi nul.

**H5 — "La complexité que j'ai construite est de la valeur." (ÉLEVÉE).** 6+ rôles, 3 piliers, marketplace DJ, escrow, contrats eIDAS : vous prenez la sophistication pour un avantage. Mais chaque rôle est une surface à maintenir, à QA, à supporter — seul. 11 god-pages > 1000 LOC (Bouncer 1905), 933 appels Supabase bruts sans couche data : votre vélocité **post-lancement** sera très faible parce qu'un changement de schéma touche des dizaines de fichiers. La complexité n'est pas un fossé, c'est une **ancre**. Vos concurrents font moins et le font à 25 M d'utilisateurs.

**H6 — "Je ne suis pas le vendeur d'alcool, donc je suis couvert." (CRITIQUE, réglementaire).** Faux et c'est le risque qui peut vous mettre en prison. L'audit conformité est sans appel : guest checkout sans age gate backend (`create-checkout` ligne 156-160), date de naissance auto-déclarée jamais vérifiée, jamais re-validée, licence alcool des clubs jamais contrôlée. En France, faciliter la vente d'alcool à un mineur (L. 3353-1) fait de Yuno un **co-auteur**, pas un tiers neutre. Le "merchant of record = club" vous couvre sur la TVA et le statut DSP2, **pas** sur la responsabilité pénale de facilitation. Un seul mineur alcoolisé identifié = fermeture du service + plainte. Et vous êtes solo, sans équipe compliance pour répondre à une mise en demeure.

**H7 — "Je déploierai quand ce sera prêt, et ce sera bientôt prêt." (ÉLEVÉE).** L'admin opérateur est non fonctionnel (pas de refund, pas de recovery compte, pas de suspension, pas de kill-switch event), le cap Supabase 402 bloque le déploiement de nouvelles fonctions, zéro test sur des paiements réels. "Bientôt prêt" est l'illusion la plus tenace du fondateur solo. Vous êtes à 10-15 jours **minimum** de pouvoir gérer un seul client live sans catastrophe opérationnelle — et ça, c'est avant la conformité.

### Les biais cognitifs à l'œuvre (nommés)

**Sunk cost sur les 119 pages.** Plus vous avez construit, plus tuer le pilier boisson et abandonner 4 rôles vous semble "gâcher". C'est exactement l'inverse : le code déjà écrit est un coût irrécupérable, il ne doit JAMAIS peser dans la décision de focus. La question n'est pas "qu'est-ce que j'ai construit ?" mais "qu'est-ce qu'un club paierait demain ?".

**Biais du constructeur solo (builder's high).** Construire procure une dopamine immédiate et mesurable (commits, pages, fonctions). Vendre procure du rejet, de l'attente, de l'ambiguïté. Vous fuyez inconsciemment l'inconfort de la vente vers le confort de la construction. 50 commits en 1 mois sans 1 appel client est le symptôme clinique.

**Complexité prise pour de la valeur (engineer's fallacy).** Vous mesurez le progrès en surface technique (94 fonctions) au lieu de le mesurer en apprentissage marché (0 insight client validé). Plus c'est sophistiqué, plus ça "sent" l'avance — alors que la sophistication pré-PMF est du sur-engineering pur.

**Faux sentiment d'avance ("tout est codé").** Vous croyez être en avance parce que le produit est complet. Mais la complétude pré-PMF est une dette, pas un actif. Un concurrent qui démarre demain avec 1 page et 3 clubs signés est **devant vous**, pas derrière.

**Biais de confirmation par le code qui marche.** Le build est vert, les démos tournent (`demo_is_live()`), donc "ça marche". Mais "le code s'exécute" et "le marché en veut" sont deux univers. La démo qui tourne renforce dangereusement l'illusion de validation.

**Optimisme de planification.** "10-15 jours pour être prêt" est presque certainement 2-3x sous-estimé une fois la conformité alcool/mineurs (KYC ID réel, age gate guest, attestation licence club) ajoutée. Et c'est avant le premier bug en prod sur de l'argent réel.

### Les angles morts structurels (ce que vous ne voyez littéralement pas)

**Le bus factor = 1 est un angle mort réglementaire, pas seulement technique.** Une mise en demeure CNIL ou une plainte alcool-mineur arrive avec des délais légaux. Solo, sans avocat ni co-fondateur, vous ne pouvez pas y répondre tout en faisant tourner la plateforme. Le risque n'est pas "je tombe malade", c'est "je reçois un courrier de l'ACPR et je suis seul".

**Vous ne voyez pas que Xceed est votre miroir.** Xceed fait DÉJÀ vos 3 piliers (guestlist + tickets + VIP bottle service) à 25 M d'utilisateurs sur VOTRE terrain (Sud EU + Paris/Marseille/Toulouse). Ce n'est pas un risque lointain, c'est la preuve vivante que votre thèse multi-pilier est faisable **et déjà occupée**. Votre seule échappatoire est ce que Xceed ne fait pas : le contrat de partage de revenus club↔BDE récurrent. Vous l'avez codé sans réaliser que c'est votre **seule** porte de sortie.

**Vous ne voyez pas la consolidation en cours.** Fever/Dice, DoorDash/SevenRooms (1,2 Md$), Zenchef/CoverManager : les acheteurs stratégiques de votre marché rachètent tout, maintenant. La fenêtre pour construire un actif (liquidité locale + data) avant qu'un géant ne descende est étroite. Vous la dépensez à construire des pages au lieu de signer des clubs.

**Vous ne voyez pas que `demo_is_live()` est un piège psychologique.** Le toggle démo vous permet de montrer un produit "vivant" — à vous-même comme aux autres. C'est exactement ce qui retarde le moment de vérité (un vrai client, un vrai paiement, un vrai échec). Désactivez-le mentalement : tant qu'aucun euro réel n'a transité, rien n'est validé.

**Vous ne voyez pas le coût d'opportunité du focus.** Chaque jour passé sur le 6e rôle ou le 3e pilier est un jour non passé à signer un BDE. À ce stade, votre ressource la plus rare n'est pas le code (vous en produisez énormément), c'est **l'apprentissage marché**, et vous en produisez zéro.

### La vérité que personne ne vous dira (et que je dois vous dire)

Vous êtes un excellent constructeur en train d'échouer pour une raison qui n'a rien à voir avec la construction. Le produit n'est pas le problème. La **séquence** est le problème : vous avez construit l'océan avant de prouver que quelqu'un veut boire une goutte. La sortie n'est pas plus de code. C'est : **(1) tuer le pilier boisson, (2) abandonner 4 des 6 rôles, (3) tout miser sur le wedge co-soirée club↔BDE en France, (4) signer 3-5 BDE/clubs réels avec de l'argent réel avant la fin de l'été, (5) ne rien construire de nouveau tant que ces 5 ne sont pas signés.** Si vous faites ça, vous avez le seul produit nightlife français avec un fossé que les géants ne creusent pas. Si vous continuez à construire, vous serez écrasé par Xceed ou ignoré par Fever — avec le plus beau codebase pré-PMF jamais enterré.

## 25. Les meilleures recommandations

Cette section transforme l'audit en plan d'action. Lecture brutale d'abord : **Yuno n'a pas un problème de construction, il a un problème de direction.** Le fondateur a prouvé qu'il peut bâtir (189 pages, 94 edge functions, 495 migrations, 50 commits en un mois, architecture financière Stripe Connect propre). Ce qu'il n'a pas prouvé, c'est qu'une seule personne veut payer pour ça. Le code est en avance de 18 mois sur le marché ; le marché est à zéro. **Tout ce qui suit a un seul objectif : inverser cet ordre — valider avant d'élargir.**

Les recommandations sont regroupées par thème, mais la priorité absolue traverse les thèmes : **arrêter d'élargir, choisir un wedge, déployer, signer 3-5 pilotes dans une ville.** Le détail noté Impact/Facilité/Coût/ROI/Temps est dans le bloc `recommendations` structuré (33 recommandations actionnables). Voici la lecture stratégique par thème.

### A. Focus produit (le levier #1 — 'déconstruire' avant de construire)

| # | Recommandation | Criticité du non-fait |
|---|---|---|
| A1 | **Choisir UN wedge** : co-soirée club↔BDE/orga avec contrats de partage de revenus signés (le seul morceau que Shotgun/Fever/Xceed ne font pas nativement). | critique |
| A2 | **Feature freeze écrit** dans CLAUDE.md : zéro nouvelle page/fonction/rôle jusqu'à PMF. | élevé |
| A3 | **Tuer le pilier boissons skip-the-bar** pour le MVP (cimetière d'apps Yoello/Butlr/Barpay, JTBD opérationnel fragile, frontal contre POS). | élevé |
| A4 | **Abandonner 4 des 6 rôles** : garder club owner + organisateur/BDE. Masquer promoteur, affilié, DJ marketplace, ops staff (sauf scan d'entrée). | élevé |

Le contre-instinct ici est total : le fondateur doit **retirer** la majorité de ce qu'il a construit du MVP. Pas le supprimer (flags), mais le sortir de la trajectoire de validation. *Crossing the Chasm* (Moore) est sans appel : on prend UN segment, on le domine, on traverse. Yuno vise 6 'main streets' sans tête de pont. C'est l'erreur que Moore décrit comme fatale.

### B. Conformité (les bloquants pénaux — non négociables avant le premier euro)

| # | Recommandation | Criticité |
|---|---|---|
| B1 | **Fermer le guest checkout alcool sans age gate** (create-checkout/index.ts:156-160). Un mineur anonyme achète de l'alcool aujourd'hui. | critique |
| B2 | **Exiger licence/SIRET + agrément alcool du club** avant activation des ventes (pas Stripe KYC seul). | critique |
| B3 | **Vérification d'âge réelle** (Stripe Identity/Onfido) au lieu de la date auto-déclarée jamais revalidée. | critique |
| B4 | Purge RGPD birth_date + droit à l'oubli testé (exposition CNIL 4% CA / 20M€). | élevé |
| B5 | Enforcement horaires Loi Évin + e-signature parentale qualifiée. | moyen |

En France, faciliter la vente d'alcool à un mineur via un moyen technique fait de Yuno un **co-auteur potentiel** (L.3353-1). Le fondateur solo (bus factor=1) ne peut pas répondre à une mise en demeure. Ces points ne sont pas des 'features' — ce sont la condition d'existence légale.

### C. Technique / ops (rendre le pilote possible et survivable)

| # | Recommandation | Criticité |
|---|---|---|
| C1 | **Lever le cap Supabase 402** — pré-requis absolu, rien ne se déploie sans. | critique |
| C2 | **P0 admin** : refund 1-clic, suspension, recovery, kill-switch event/contenu. | critique |
| C3 | **Tester refund/chargeback en Stripe live** une fois, end-to-end. | élevé |
| C4 | **10-15 tests** ciblés revenue-critical + conformité (pas de couverture globale). | élevé |
| C5 | MFA admin obligatoire (2h), audit RLS échantillonné, monitoring d'erreurs (Sentry), load-test scan barman. | élevé |

La dette structurelle (933 appels Supabase bruts, 11 god-pages >1000 LOC) est réelle mais **secondaire** : on ne refactorise que ce que le wedge utilise. Refactorer du code gelé est du gaspillage. La priorité C est de pouvoir *opérer un live sans catastrophe* (chargebacks, crash à l'entrée, fonction non déployable).

### D. GTM (la seule chose qui crée de la valeur maintenant)

| # | Recommandation | Criticité |
|---|---|---|
| D1 | **Recruter en personne 3-5 clubs/BDE** dans la ville où Paul a un réseau. Founder-led sales, onboarding manuel, présence physique. | transformateur |
| D2 | **Valider le pricing en conversation** (49-99€ + 3-4%) AVANT de coder Elite. | transformateur |
| D3 | Instrumenter 3 métriques PMF : GMV/club/mois, rétention M2/M3, % du GMV club passant par Yuno. | élevé |
| D4 | Faire du **contrat co-soirée signé** le héros marketing. | élevé |

*Cold Start* (Chen) : un marketplace nightlife meurt sans liquidité locale. Le réseau ne démarre pas avec 119 pages, il démarre avec **un club rempli un samedi soir**. Fever/Shotgun/Xceed ont résolu le cold start ; Yuno part de zéro contre eux. La seule arme d'un nouvel entrant non financé est l'**atomic network** dans une micro-géographie : une ville, une poignée de clubs, les BDE qui les remplissent. *JTBD* : le job réel et mal servi n'est pas 'commander une bière plus vite', c'est 'une asso étudiante et un club se partagent les revenus d'une co-soirée récurrente sans dispute' — c'est le seul wedge où Yuno bat les incumbents.

### E. Financement (raconter la vérité, lever sur la traction)

Le deck ne doit PAS dire 'OS mondial du nightlife'. Il doit dire : 'wedge co-soirée club↔BDE en France, X clubs pilotes facturés, Y€ de GMV, Z% de rétention M3'. Un investisseur de 10M€ n'achète pas 189 pages — il achète une boucle de rétention prouvée dans une niche. La surface du code est, paradoxalement, un **anti-signal** en pré-seed : elle prouve la dispersion, pas la discipline.

**Verdict de la section** : sur ~33 recommandations, les 4 premières (A1-A4 : choisir, geler, tuer la boisson, couper les rôles) créent plus de valeur que les 29 autres réunies. Tout investissement de temps avant A1-A4 est du temps brûlé à polir un produit que personne n'a validé.

## 26. Priorisation

Principe directeur de cette section, à contre-courant de l'intuition du fondateur : **le travail de priorisation ici consiste à RETIRER, pas à ajouter.** Le produit a déjà trop de surface (189 pages). Le 'MVP' n'est pas une liste de choses à construire — c'est une liste de choses à **garder allumées**, tout le reste étant masqué. Les V2/V3 ci-dessous ne sont pas des features à coder (la plupart existent déjà dans le code) ; ce sont des features à **réactiver dans cet ordre, tirées par la demande**.

### TOP 10 PRIORITÉS ABSOLUES (l'ordre est l'ordre d'exécution)

1. **Choisir le wedge** : co-soirée club↔BDE/orga avec contrat de partage de revenus signé. Une phrase, une décision. *(focus)*
2. **Lever le cap Supabase 402** : sans ça, rien ne se déploie. *(ops, 2h)*
3. **Fermer le guest checkout alcool sans age gate** : bloquant pénal. *(conformité, 1j)*
4. **Exiger licence alcool club avant ventes** : bloquant pénal. *(conformité, 2j)*
5. **Vérification d'âge réelle (Stripe Identity/Onfido)** : bloquant pénal. *(conformité, 5-7j)*
6. **P0 admin** (refund, suspension, recovery, kill-switch event/contenu) : impossible d'opérer du live sans. *(ops, 3-4j)*
7. **Feature freeze + masquer boissons skip-the-bar + 4 rôles** : réduire la surface au wedge. *(focus, 3-4j)*
8. **Tester refund/chargeback en Stripe live + 10-15 tests revenue-critical** : filet sur l'argent. *(technique, 4-5j)*
9. **MFA admin + monitoring d'erreurs + QA navigateur du parcours wedge** : survie opérationnelle. *(technique, 3j)*
10. **Signer 3-5 pilotes founder-led dans UNE ville** : la seule chose qui crée de la valeur. *(GTM, 4-6 semaines)*

### TOP 20 FEATURES MVP — le VRAI MVP réduit (ce qu'on GARDE allumé)

Ce MVP retire ~70% de la surface construite. Il ne reste que le strict nécessaire au wedge co-soirée club↔BDE :

1. Billetterie d'événement (achat, QR billet)
2. Réservation table VIP / bottle service (floor plan, QR)
3. Co-soirée club↔organisateur : proposition + acceptation
4. Contrat de partage de revenus signé (eIDAS) tickets/tables
5. Contrat-cadre récurrent (signer une fois → toute la résidence)
6. Split de revenu Stripe Connect (mode separate, transferts webhook)
7. Payout / versement aux deux parties (cron release)
8. Dashboard club owner (revenu, soirées, commandes)
9. Dashboard organisateur/BDE (sa part, ses soirées)
10. Scan d'entrée (bouncer — billet + guest list uniquement)
11. Onboarding club avec attestation licence alcool obligatoire
12. Vérification d'âge réelle sur achat alcool
13. Refund club-side
14. Notifications de vente (deep-link vers la commande)
15. Page publique événement (poster, line-up, partage)
16. Page publique club/organisateur (vitrine conversion)
17. Analytics post-soirée essentielles (remplissage, no-show, CA, ma part)
18. Emails transactionnels (confirmation billet/VIP, reçu fiscal)
19. Admin opérateur P0 (refund, suspension, kill-switch)
20. i18n EN/FR/ES sur le parcours wedge uniquement

**Tout le reste est masqué derrière des flags** : boissons skip-the-bar, menu digital, barman, vestiaire, hôte VIP, manager, promoteur, affilié, marketplace DJ, contrats DJ séquestre, analytics avancées (globe Mapbox, démographie fine), story builder, loyalty, etc.

### TOP 20 FEATURES V2 — réactivation tirée par la demande (12-24 mois, post-PMF)

Ordre = priorité de réactivation, déclenchée par un client qui paie :

1. Intégration POS (Toast/Square/SumUp) — pré-requis de tout le reste côté bar
2. Commande de boissons skip-the-bar (rallumée AVEC POS, sur clubs où le JTBD tient)
3. Menu digital + paiement boisson intégré
4. Rôle barman (préparation commandes, scan conso)
5. Marketplace DJ — découverte + booking (si liquidité événements suffisante)
6. Contrats DJ sécurisés / séquestre (après avis ACPR/DSP2)
7. Rôle promoteur owner-scoped (commission au scan guestlist)
8. Système affilié multi-ville
9. CRM clients léger (clients_basic)
10. Email promotionnel / campagnes
11. Analytics avancées : démographie participants, origines clients (globe Mapbox)
12. Prévision de hype post-soirée
13. Crédits conso liés à la soirée du billet
14. Story builder avancé
15. Abonnement Essential/Pro payant facturé (validation pricing réelle)
16. Toggle 'absorber la commission Yuno'
17. Reçu fiscal / facture séparée du billet (PDF isomorphe)
18. Rôles ops complémentaires : vestiaire, hôte VIP, manager
19. Tracked links / liens bio par club et par soirée
20. Multilingue à pleine échelle + 2e/3e ville FR

### TOP 20 FEATURES V3 — plateforme / scale (24-36 mois, conditionné multi-villes)

1. 2e marché géographique (Espagne / Belgique)
2. Elite tier : loyalty programme
3. Elite : analytics prédictif
4. Elite : multi-établissement (groupes)
5. Elite : API publique partenaires
6. Leaderboard / gamification
7. Cashless festival (concurrence Weezevent — gros events)
8. Pay-at-table restaurant festif (concurrence Sunday — avec POS)
9. Programme de fidélité cross-club
10. Découverte publique à l'échelle (Explore, recommandations)
11. Notifications push géo-filtrées cross-club
12. Marketplace DJ à pleine échelle (tiers, vérification, dispos)
13. Outils marketing avancés (segmentation, automation)
14. Reporting comptable complet (TVA, exports multi-format)
15. SSO / rôles d'équipe granulaires côté club
16. Webhooks / intégrations tierces (compta, billetterie externe)
17. White-label / branding club complet
18. Programme partenaires / revendeurs
19. Mobile app native (au-delà de la PWA) si la rétention le justifie
20. Data products (benchmarks anonymisés pour les clubs)

### Lecture finale de la priorisation

La hiérarchie MVP→V2→V3 dit une chose simple : **presque tout le code déjà écrit est du V2/V3 prématuré.** Le fondateur a construit la V3 avant le MVP. La discipline de priorisation consiste à reconnaître que ce n'est pas un gâchis (le code est réutilisable, l'architecture est saine) mais que c'est, aujourd'hui, du **passif de focus** : chaque page allumée est une surface à QA, à sécuriser, à maintenir, à expliquer au pilote. Éteindre n'est pas détruire — c'est concentrer le feu sur le seul front où Yuno peut gagner.

## 17. Tableau des risques (structuré)

| # | Risque | Catégorie | Impact | Probabilité | Mitigation | Comment mitiger |
|---:|---|---|---|---|---|---|
| 1 | Cold start jamais résolu — pas de liquidité locale (events × fans) dans la 1re ville | Marché / Network effects | critique | quasi-certaine | très difficile | Cold Start (Chen): saturer UNE ville, atomic network = 1 club rempli le samedi. Densité avant largeur. Sacrifier 5 des 6 segments. Aucune feature ne remplace un club plein. |
| 2 | Hypothèse de prix (abo 49-199€ + 3-4% commission) jamais validée par un acheteur réel | Marché / Business model | critique | quasi-certaine | modérée | Lean Startup: 5 entretiens de vente AVANT toute feature. Lettre d'intention payante. Si le club refuse l'abo OU la commission, le modèle change immédiatement. |
| 3 | Solo founder épuise son temps en maintenance de 189 pages / 94 fonctions au lieu de vendre (bus factor = 1) | Exécution / Humain | critique | quasi-certaine | difficile | Freeze scope brutal (1 pilier, 1 ville, 1 club). Geler le code, passer 80% du temps en terrain. Recruter un commercial avant un dev. |
| 4 | Guest checkout vend de l'alcool sans aucune vérif d'âge backend (confirmé create-checkout:157-159) | Conformité / Alcool-mineurs | critique | élevée | modérée | Bloquant pré-launch: refuser le guest checkout si event non alcohol_free. Age gate serveur obligatoire avant tout line_item alcool. |
| 5 | Vérification d'âge auto-déclarée, jamais KYC, jamais re-validée — responsabilité pénale L.3353-1 | Conformité / Alcool-mineurs | critique | élevée | difficile | Intégrer KYC ID tiers (Onfido/Stripe Identity) pour l'alcool. Sans cela, défense légale = nulle. Coût rewrite 500k-1M€ si fait après launch. |
| 6 | Bug de paiement / mauvais split Stripe Connect non détecté (0 test automatisé sur la logique financière) | Technique / Financier | critique | élevée | modérée | Suite de tests ciblée sur fees.ts + create-checkout + webhooks AVANT live. Tester refund Stripe en live. Un club lésé une fois = perdu. |
| 7 | Xceed (25M users, même périmètre 3-piliers, déjà présent FR) occupe l'espace stratégique de Yuno | Concurrentiel | critique | élevée | très difficile | Trouver un wedge que Xceed ne sert PAS: collab club↔BDE contractualisée (FR-ancré). Ne pas affronter Xceed sur son terrain frontal. |
| 8 | Runway personnel du fondateur épuisé avant 1er revenu récurrent (non finançable en l'état) | Financier | critique | élevée | difficile | Time-box la validation (3-5 clubs payants en 90j) avant de brûler plus de cash. Revenu pilote > levée. Sinon arrêter. |
| 9 | Admin panel non fonctionnel (pas de refund/recovery/suspension/kill-switch) — service non opérable en live | Exécution / Ops | critique | quasi-certaine | modérée | P0 bloquant: refund, recovery compte, suspension, kill-switch event. 2-3 jours. Impossible d'opérer un service de paiement sans ces leviers. |
| 10 | Fondateur indisponible (maladie/burnout) — aucune redondance, mise en demeure régalien impossible à traiter | Exécution / Humain | critique | moyenne | difficile | Documenter l'architecture, automatiser le déploiement, identifier un relais. Le bus factor = 1 est le risque le plus sous-estimé. |
| 11 | Chargeback rate élevé (pas de dispute routing) → Stripe gèle/ferme le compte plateforme | Financier / Technique | critique | moyenne | modérée | Logique dispute Stripe + descripteur clair sur relevé. Monitorer le taux. Dépendance Stripe = single point of failure absolu. |
| 12 | Admin sans MFA obligatoire + sk_ Stripe dans edge functions — compromission compte plateforme | Technique / Sécurité | critique | moyenne | facile | MFA admin obligatoire (2h ops). Secrets uniquement en Vault Supabase. Rotation des clés. Accès admin = accès total aux fonds. |
| 13 | Stratégie 6 segments sans tête de pont (Crossing the Chasm) — aucun segment ne bascule | Marché / Stratégie | critique | élevée | modérée | Choisir UN segment beachhead (clubs FR ville moyenne). Dominer, traverser le gouffre, puis étendre. Abandonner 4-5 rôles temporairement. |
| 14 | Pilier boisson skip-the-bar: JTBD échoue en club bondé, segment = cimetière sans gagnant EU | Produit / Marché | élevé | élevée | facile | Tuer le pilier boisson. C'est le plus faible et le plus mis en avant. Le retirer libère le focus et supprime une partie du risque alcool. |
| 15 | Aucune métrique d'usage instrumentée (pas de DAU/MAU/funnel) — PMF invisible même s'il existait | Produit / Data | élevé | quasi-certaine | facile | Instrumenter funnel + activation avant le 1er club. Définir 1 métrique North Star (ex: ventes/club/soir). Sortir du mode démo. |
| 16 | Cap Supabase 402 bloque le déploiement des edge functions critiques le jour du go-live | Technique / Ops | élevé | quasi-certaine | facile | Lever le spend cap Supabase (action ops triviale) AVANT toute date de launch. Vérifier que 100% des fonctions revenue-critical sont déployées. |
| 17 | Données mineurs (birth_date) conservées indéfiniment, sans consentement parental — RGPD Art 5/8 | Conformité / RGPD | élevé | élevée | modérée | Cron de suppression birth_date post-event +90j. Droit à l'oubli implémenté et testé. Consentement parental < 16 ans. Audit CNIL préventif. |
| 18 | Aucune vérif licence alcool/SIRET des clubs — escroc peut ouvrir un club fictif et vendre | Conformité / Juridique | élevé | moyenne | modérée | Attestation SIRET + certificat agrément alcool obligatoire avant onboarding. Ne pas s'appuyer sur le seul KYC Stripe. |
| 19 | Shotgun possède déjà les promoteurs/orgas FR cibles — pilier billet frontal perdu d'avance | Concurrentiel | élevé | élevée | difficile | Ne pas concurrencer Shotgun sur le billet pur. Se différencier par l'OS opérationnel club + collab BDE que Shotgun ne fait pas. |
| 20 | DSP2/ACPR: détention de fonds tiers (escrow DJ, transferts retenus) sans agrément établissement de paiement | Conformité / Juridique | élevé | moyenne | difficile | Consulter l'ACPR sur le statut. S'appuyer au maximum sur Stripe Connect (agréé) sans jamais détenir les fonds en propre. |
| 21 | Adoption staff terrain échoue (barman ne scanne pas sous le rush, 0 load test, god-page 1905 LOC) | Produit / Opérationnel | élevé | élevée | modérée | Tester l'UX barman en conditions réelles (1 vrai samedi). Load testing scan concurrent. L'adoption opérationnelle tue plus que la techno. |
| 22 | Le club abandonne après 2 soirs (double système POS + Yuno, charge staff doublée, ROI non prouvé) | Produit / Marché | élevé | élevée | modérée | Prouver un ROI net chiffré au pilote (CA additionnel, temps gagné). S'intégrer au POS plutôt que le doubler. Définir un succès mesurable du pilote. |
| 23 | Aucune intégration POS (Toast/Square/Lightspeed) — Yuno affronte l'incumbent le mieux installé du bar | Concurrentiel / Technique | élevé | élevée | difficile | Se brancher sur le POS, ne pas le remplacer. Sunday a survécu en devenant infra POS (OEM NCR), pas app fan. |
| 24 | Wedge collab club↔BDE (seul angle défendable) sans demande solvable (BDE = pas de budget/process contrat) | Marché | élevé | moyenne | modérée | Valider la demande BDE par 5 entretiens avant de miser dessus. Vérifier qu'un BDE signe et paie réellement un partage de revenus. |
| 25 | 11 god-pages > 1000 LOC + 933 appels Supabase bruts sans couche data — vélocité post-launch très faible | Technique / Dette | élevé | élevée | difficile | Refactor ciblé des chemins revenue-critical (checkout, barman, refund). Couche data minimale. Ne pas tout refactorer — prioriser le payment path. |
| 26 | 158 policies RLS non auditées — faille d'isolation tenant possible (un club voit les données d'un autre) | Technique / Sécurité | élevé | moyenne | modérée | Audit complet RLS + tests d'isolation tenant automatisés. Pentest ciblé. Une fuite cross-tenant = perte de confiance B2B irréversible. |
| 27 | Sunk cost de 189 pages empêche de tuer le pilier boisson / pivoter à temps | Exécution / Cognitif | élevé | moyenne | modérée | Décision de scope dictée par la donnée marché, pas par le code construit. Le code est un coût irrécupérable, pas un argument. |
| 28 | Pas de moat — Fever/Xceed copient le wedge en 1 sprint s'il marche | Concurrentiel | élevé | moyenne | très difficile | Construire un moat de distribution (densité locale, relation club) et de données, pas de feature. La feature seule est copiable. |
| 29 | Fuite/dé-anonymisation données mineurs (Mapbox geoloc + age participants affichés publiquement) | Conformité / Sécurité | élevé | faible | modérée | Agréger/flouter toute démographie mineurs. Jamais de croisement age × location exposé. Risque réputationnel + CNIL majeur si exploité. |
| 30 | Due diligence VC échoue (0 test, dette documentée, archi non à jour) — non finançable | Financier | élevé | élevée | modérée | Avant toute levée: traction réelle (3-5 clubs payants) + tests sur le payment path + 1 doc archi propre. La traction couvre la dette aux yeux d'un VC. |
| 31 | Yuno reste une 'feature' pas une 'company' — au mieux acqui-hire, pas un outcome 10M€ | Stratégie / Financier | élevé | moyenne | très difficile | Prouver un effet de réseau local défendable et une expansion ville-par-ville réplicable. Sans cela, la thèse VC ne tient pas. |
| 32 | 495 migrations (legacy Lovable + ghost migrations) — setup nouvel environnement à risque, états incohérents | Technique / Ops | moyen | moyenne | difficile | Vérifier l'objet live (pas l'historique). Squash/baseline des migrations. Tester un setup from-scratch reproductible pour la continuité. |
| 33 | Happy hours / horaires légaux alcool non bloqués (vente 24/24) — non-conformité Loi Évin | Conformité / Alcool | moyen | moyenne | facile | Bloc temporel par juridiction dans create-checkout. Paramétrer les fenêtres légales locales. Risque faible en proba mais facile à corriger. |
| 34 | Perf mobile dégradée en club (PWA + Mapbox + 933 requêtes, sous-sol sans 4G) | Technique / Produit | moyen | moyenne | modérée | Mode offline-first / dégradé pour le checkout et le scan. Lazy-load agressif Mapbox. Tester en conditions réseau réelles de club. |
| 35 | Toggle 'absorber la commission' mal câblé refacture le client (bug déjà survenu une fois) | Technique / Financier | moyen | moyenne | facile | Tests dédiés sur tous les chemins de calcul de frais. Le bug serviceFee/transactionFee a déjà mordu — c'est un signal de fragilité du calcul. |
| 36 | Emails de confirmation billet/VIP cassés (bug PGRST201 déjà rencontré) — litiges + no-show | Technique / Produit | moyen | moyenne | facile | Tests d'intégration sur le flux de confirmation. Monitoring des échecs Resend (déjà partiellement durci). Revenue-critical. |
| 37 | Autorisation parentale = upload PDF DIY non validé (mineur peut uploader un faux document) | Conformité / Alcool | moyen | faible | modérée | eSignature légale (Docusign/Hellosign) au lieu d'un upload libre. Validation du contenu. Faible proba mais défense légale nulle en l'état. |
| 38 | DJ marketplace + séquestre Stripe attire un litige cachet sans preuve contractuelle forte | Juridique / Financier | moyen | faible | modérée | Renforcer la valeur probante du contrat numérique. Sous-pilier non prioritaire — envisager de le geler jusqu'au PMF du cœur. |
| 39 | Argument de vente 'data client' non livrable mieux que le POS (qui a déjà toutes les ventes) | Marché / Produit | moyen | moyenne | difficile | Redéfinir la proposition de valeur autour de ce que le POS ne fait PAS (acquisition fan, collab orga, billetterie). La data seule ne vend pas. |
| 40 | CORS-lock yunoapp.eu / Cloudflare Workers assets-only casse sur un cas non prévu en prod | Technique / Ops | moyen | faible | facile | Tester tous les chemins origine (app, sous-domaines) avant launch. Le checkout échoue en silence si l'origine ne matche pas — monitorer. |

---

# Tableau des opportunités

| # | Opportunité | Upside | Faisabilité |
|---:|---|---|---|
| 1 | Activer et tout miser sur le wedge co-soirée club↔BDE déjà codé (event_collab_contracts + contrat-cadre récurrent LIVE + bde_verified) | Seul océan bleu réel du dossier : partage de revenus contractualisé club↔asso étudiante récurrent, que Shotgun/Fever/Xceed ne font PAS. JTBD réel, ancré FR, déjà construit, activable en jours. | élevée |
| 2 | Exploiter le BDE comme résolveur de cold start à deux faces (l'asso ramène fans ET club partenaire dans le même contrat) | Acquisition quasi gratuite + renouvellement annuel des promos = boucle virale auto-entretenue. Résout le problème n°1 de tout marketplace nightlife (liquidité locale) là où les concurrents ont dû lever des centaines de M$. | moyenne |
| 3 | Utiliser le BDE comme cheval de Troie B2B vers le club, puis verrouiller le club avec l'outillage ops (staff, VIP, floor plan, scan) déjà construit | Transforme une entrée à faible friction (l'asso) en rétention élevée (le club ne peut plus partir car tout son ops vit chez Yuno). Mur de sortie que Shotgun, qui s'arrête au billet, ne peut pas opposer. | moyenne |
| 4 | Tuer le pilier boisson skip-the-bar et le remplacer par les crédits conso liés au billet (déjà codés) | Sort du cimetière d'apps QR-order et de la concurrence frontale Toast/Square/Sunday. Transforme un pilier perdant en upsell au moment du billet, là où le cash-in est naturel. Libère 100% du focus sur le wedge. | élevée |
| 5 | S'intégrer au POS (Toast/Square/SumUp) au lieu de le concurrencer, sur le modèle OEM qui a sauvé Sunday (NCR) | La valeur de la boisson est dans l'intégration POS, pas dans le QR. Désamorce l'incumbent le mieux installé du bar et ouvre un canal de distribution au lieu d'un front de guerre. | faible |
| 6 | Capitaliser sur le contrat-cadre récurrent comme revenu récurrent déguisé (signer une fois → toutes occurrences auto-acceptées) | Convertit une vente ponctuelle en abonnement de fait sur les soirées récurrentes (mardi étudiant, jeudi techno). Multiplie le LTV par couple club-BDE et stabilise le revenu. | élevée |
| 7 | Monétiser la data transactionnelle propriétaire (origines clients Mapbox, démographie participants, yield, no-show) auprès des clubs et marques | Actif que Fever a payé 2 Md$ pour accumuler. Argument de vente aux sponsors des soirées étudiantes (Red Bull cible les BDE). Différenciant vs POS qui ne corrèle pas l'audience. | moyenne |
| 8 | Vendre les contrats eIDAS et l'accounting co-event (TVA, exports PDF/CSV) comme sérieux légal/administratif au segment BDE | Transforme une faiblesse perçue (jeune asso étudiante) en argument de confiance. Répond à un besoin compta réel que Shotgun ignore. Friction administrative résolue = adoption. | élevée |
| 9 | Activer la marketplace DJ (booking + escrow + payout) comme amplificateur viral une fois le wedge prouvé | Le DJ partage sa page et ramène son audience (acteur viral). Produit complet rare en pré-seed. Étend l'écosystème sans rebâtir. | moyenne |
| 10 | Construire la marque culturelle nightlife FR et la liquidité locale ville par ville (affiliés multi-villes, early adopters 3 mois gratuits) | Fenêtre étroite avant que Fever ne descende dans le bottle service. Posséder 3-5 clubs remplis le samedi soir dans une ville crée le seul actif défendable : la liquidité locale qu'aucun capital ne remplace. | moyenne |

## Angles morts du fondateur

- Le méta-angle-mort : confondre 'construit' (119 pages, 94 fonctions, 495 migrations) avec 'validé'. Le code pré-PMF est du capital immobilisé dans des paris non testés, pas un fossé concurrentiel. Le marché ne paie pas pour du code.
- Xceed est votre miroir vivant : il fait DÉJÀ vos 3 piliers (guestlist + tickets + VIP bottle service) à 25 M d'utilisateurs sur votre terrain (Sud EU + Paris/Marseille/Toulouse). Votre thèse multi-pilier est faisable ET déjà occupée. Seule échappatoire : le wedge BDE que Xceed ne fait pas.
- La responsabilité pénale alcool-mineur (L. 3353-1) ne disparaît pas avec le statut 'club = marchand de record'. Guest checkout sans age gate backend + date auto-déclarée jamais vérifiée = Yuno co-auteur. Un seul mineur alcoolisé = fermeture + plainte. Vous êtes solo, sans équipe compliance.
- Le JTBD du club n'est pas le JTBD du fan, et c'est le club qui paie. Réduire la file aide le fan ; le club gagne sur les bouteilles VIP et les entrées, et la file crée même de la rareté perçue. Vous résolvez la mauvaise douleur pour le mauvais payeur.
- La consolidation est en cours MAINTENANT (Fever/Dice, DoorDash/SevenRooms 1,2 Md$, Zenchef/CoverManager). Les acheteurs stratégiques rachètent tout. La fenêtre pour bâtir un actif (liquidité + data) avant qu'un géant ne descende est étroite — et vous la dépensez à coder des pages.
- demo_is_live() est un piège psychologique : un produit 'vivant' en démo retarde le moment de vérité (vrai client, vrai paiement, vrai échec). Tant qu'aucun euro réel n'a transité, rien n'est validé, quel que soit le nombre de démos réussies.
- Le bus factor = 1 est un angle mort réglementaire, pas seulement technique. Une mise en demeure CNIL ou ACPR arrive avec des délais légaux ; seul, sans avocat ni co-fondateur, vous ne pouvez pas y répondre tout en faisant tourner la plateforme.
- Le coût d'opportunité du focus : à ce stade, la ressource la plus rare n'est pas le code (vous en produisez énormément) mais l'apprentissage marché (vous en produisez zéro). Chaque jour sur le 6e rôle est un jour non passé à signer un BDE.
- La complexité construite (6+ rôles, 11 god-pages >1000 LOC, 933 appels Supabase sans couche data) est une ancre, pas un fossé : votre vélocité POST-lancement sera très faible car un changement de schéma touche des dizaines de fichiers. Vos concurrents font moins, mieux, à plus grande échelle.
- Le pilier boisson skip-the-bar — mis en avant comme 'MVP' — est le pire des trois : cimetière d'apps QR-order paneuropéennes (le JTBD ne tient pas en club bondé à 1h), et Toast/Square/Sunday possèdent déjà l'encaissement. C'est l'angle mort de priorisation le plus coûteux.

## Biais cognitifs à surveiller

- Sunk cost fallacy sur les 119 pages : plus vous avez construit, plus tuer le pilier boisson et abandonner 4 rôles semble 'gâcher'. Le code déjà écrit est un coût irrécupérable qui ne doit jamais peser dans la décision de focus.
- Biais du constructeur solo (builder's high) : construire procure une dopamine immédiate et mesurable (commits, pages) ; vendre procure rejet, attente, ambiguïté. Vous fuyez inconsciemment la vente vers le confort de la construction — 50 commits/mois, 0 appel client.
- Engineer's fallacy / complexité prise pour de la valeur : mesurer le progrès en surface technique (94 fonctions) au lieu de l'apprentissage marché (0 insight client validé). La sophistication pré-PMF est du sur-engineering, pas une avance.
- Faux sentiment d'avance ('tout est codé') : croire être devant parce que le produit est complet. La complétude pré-PMF est une dette, pas un actif. Un concurrent qui démarre avec 1 page et 3 clubs signés est devant vous.
- Biais de confirmation par le code qui marche : build vert + démos qui tournent = 'ça marche'. Mais 'le code s'exécute' et 'le marché en veut' sont deux univers ; la démo renforce dangereusement l'illusion de validation.
- Optimisme de planification : '10-15 jours pour être prêt' est presque certainement 2-3x sous-estimé une fois la conformité alcool/mineurs (KYC réel, age gate guest, attestation licence club) et le premier bug prod sur de l'argent réel ajoutés.
- 'Si je le construis, ils viendront' (field of dreams fallacy) : le mythe fondateur le plus mortel. Lean Startup exige de construire le minimum pour invalider une hypothèse vite ; vous avez maximisé le construit et minimisé l'appris.
- 'Je peux gagner sur 3 marchés à la fois' : déni du gouffre de Crossing the Chasm. Viser 3 piliers et 6 segments simultanément contre 3 incumbents mieux capitalisés, sans tête de pont, c'est disperser ses forces contre les armées les plus fortes de chaque front.

---

# Recommandations priorisées

| # | Recommandation | Impact | Facilité | Coût | ROI | Temps |
|---:|---|---|---|---|---|---|
| 1 | DÉCISION FONDATRICE — Tuer la dispersion. Choisir UN wedge (co-soirée club↔BDE/orga avec contrats de partage de revenus signés), une ville (celle où Paul a un réseau réel), et un objectif unique : 3 à 5 établissements pilotes facturés sous 60 jours. Tout le reste est gelé. | transformateur | modérée | faible | très élevé | 1 semaine de décision + 8 semaines d'exécution |
| 2 | Lever le cap de dépense Supabase (erreur 402) AVANT toute autre chose technique. Sans ça, rien de nouveau ne se déploie. Pré-requis ops absolu. | transformateur | facile | faible | très élevé | 2 heures |
| 3 | BLOQUANT CONFORMITÉ (CRITIQUE) — Fermer le guest checkout alcool sans age gate côté backend (create-checkout/index.ts). Refuser tout achat alcool en invité non vérifié. Risque pénal L.3353-1 = co-auteur. | transformateur | facile | faible | très élevé | 1 jour |
| 4 | BLOQUANT CONFORMITÉ (CRITIQUE) — Exiger l'attestation de licence/SIRET + agrément alcool du club AVANT onboarding et activation des ventes alcool (pas Stripe KYC seul). Champ obligatoire + revue manuelle solo au lancement (faible volume). | transformateur | modérée | faible | élevé | 2 jours |
| 5 | BLOQUANT CONFORMITÉ (CRITIQUE) — Implémenter une vérification d'âge réelle (Stripe Identity ou Onfido) pour tout achat alcool, au lieu de la date auto-déclarée. Au minimum : KYC déclenché une fois, jamais re-vendable indéfiniment. | transformateur | difficile | moyen | élevé | 5-7 jours intégration |
| 6 | Construire les P0 admin opérateur manquants : remboursement Stripe en 1 clic, suspension de compte, recovery, annulation/kill-switch d'événement, kill-switch contenu. Sans ça, impossible de gérer du live. | transformateur | modérée | faible | très élevé | 3-4 jours |
| 7 | GTM pilote — Recruter en personne 3-5 clubs/assos BDE de la ville cible. Pas de marketing, pas de pub. Founder-led sales, onboarding manuel, présence physique aux premières soirées. Cold Start = remplir UN samedi soir réel. | transformateur | modérée | faible | très élevé | 4-6 semaines |
| 8 | Valider l'hypothèse de pricing AVANT de coder Elite : demander aux 3-5 pilotes s'ils paieraient 49-99€/mois + 3-4% commission. Si non, le business model (94 fonctions construites dessus) s'effondre. Test conversationnel, pas développement. | transformateur | facile | faible | très élevé | 1 semaine |
| 9 | Geler le scope produit par écrit (feature freeze) : aucune nouvelle page, aucune nouvelle edge function, aucun nouveau rôle jusqu'à PMF du wedge. Inscrire la règle dans CLAUDE.md. | élevé | facile | faible | très élevé | 1 jour |
| 10 | Décommissionner le pilier 'commande de boissons skip-the-bar' pour le MVP (cimetière d'apps, JTBD opérationnel fragile en club bondé, concurrence frontale POS). Le masquer derrière un flag, ne pas le supprimer. | élevé | modérée | faible | élevé | 2-3 jours |
| 11 | Abandonner 4 des 6 rôles pro pour le MVP : ne garder que club owner + organisateur/BDE. Masquer promoteur, affilié, DJ marketplace et la majorité du staff ops (garder uniquement scan d'entrée). | élevé | modérée | faible | élevé | 3-4 jours (flags + routing) |
| 12 | Tester en conditions réelles (Stripe live, petits montants) le flux complet : achat → paiement → refund → chargeback. Une fois, end-to-end, avant le premier euro réel. | élevé | facile | faible | élevé | 1 jour |
| 13 | Écrire 10-15 tests automatisés ciblés UNIQUEMENT sur les chemins critiques argent + conformité (calcul commission, split co-event, age gate, refund). Pas de couverture globale : un filet sur le revenue-critical et le légal. | élevé | modérée | faible | élevé | 3-4 jours |
| 14 | Rendre la MFA obligatoire sur le compte super admin. Un seul compte tient toute la plateforme financière. 2h de config. | élevé | facile | faible | très élevé | 2 heures |
| 15 | Auditer la cohérence des 158 policies RLS sur les tables sensibles (orders, payouts, profiles, birth_date, contrats). Vérifier qu'aucun tenant ne voit les données d'un autre. Échantillonnage manuel par rôle. | élevé | modérée | faible | élevé | 2-3 jours |
| 16 | Implémenter un cron de purge RGPD de birth_date après event + délai (90j), et un vrai flux 'droit à l'oubli' testé. Conservation indéfinie = exposition CNIL (4% CA / 20M€). | élevé | modérée | faible | élevé | 2 jours |
| 17 | Consulter un avocat spécialisé (paiements/DSP2 + alcool) sur le statut de l'escrow DJ et la qualification potentielle d'établissement de paiement (ACPR). 2-3h de conseil avant de manipuler des fonds tiers en séquestre. | élevé | facile | moyen | élevé | 1 semaine (prise de RDV) |
| 18 | Définir et instrumenter 3 métriques PMF brutales : (1) GMV traité par club/mois, (2) rétention club M2/M3, (3) % de revenus du club passant par Yuno. Si <30% du GMV passe par Yuno, le club ne l'a pas adopté. | élevé | facile | faible | élevé | 2 jours |
| 19 | Faire du contrat de partage de revenus co-soirée club↔BDE signé eIDAS le héros marketing du pilote. C'est le SEUL morceau que Shotgun/Fever/Xceed ne font pas nativement. JTBD réel, mal servi, ancré France. | élevé | facile | faible | très élevé | continu |
| 20 | Intégrer (ou prévoir l'intégration) un POS au lieu de le concurrencer. Yuno se branche sur Toast/Square/SumUp ou meurt sur l'encaissement. Au minimum, ne PAS présenter Yuno comme un remplaçant de caisse. | élevé | difficile | moyen | moyen | V2 (post-PMF) |
| 21 | Mettre en place un monitoring d'erreurs basique (Sentry ou équivalent) avant le live. Solo founder = besoin d'alertes automatiques sur les échecs paiement/checkout silencieux (CORS-lock cause déjà des échecs muets). | élevé | facile | faible | élevé | 1 jour |
| 22 | Load-test le scan barman/bouncer en conditions de rush (entrées simultanées une nuit de samedi). 0 test de charge actuel. Un crash à l'entrée d'un club = mort de la réputation pilote. | élevé | modérée | faible | élevé | 2 jours |
| 23 | Rédiger des CGU/CGV et une politique de confidentialité spécifiques (vente d'alcool, données mineurs, rôle marketplace, marchand de record = club). Modèle d'avocat. Bouclier juridique minimal avant le live. | élevé | modérée | moyen | élevé | 1 semaine (avec avocat) |
| 24 | Préparer un récit de financement honnête : pas 'leader mondial nightlife OS', mais 'wedge co-soirée club↔BDE France, X clubs pilotes, Y GMV, Z rétention'. Lever sur la traction du wedge, pas sur la surface du code. | élevé | facile | faible | élevé | 1 semaine (deck) |
| 25 | Recruter (post-PMF, pas avant) une 1ère embauche compliance/ops ou un co-founder pour casser le bus factor = 1. Une mise en demeure CNIL/ACPR aujourd'hui est impossible à traiter seul. | élevé | difficile | élevé | moyen | post-seed |
| 26 | Benchmarker frontalement Xceed (même périmètre 3 piliers, 25M users, terrain France/Sud-EU) : identifier précisément les 2-3 villes FR secondaires qu'il ne couvre PAS en profondeur. C'est là le seul espace d'entrée crédible. | élevé | facile | faible | élevé | 2-3 jours |
| 27 | Faire une QA navigateur complète du parcours wedge (achat billet → entrée scan → co-soirée → split revenu → payout) AVANT le pilote. 8-12h. C'est le seul flux qui doit être parfait. | élevé | facile | faible | élevé | 8-12 heures |
| 28 | Mesurer et fixer l'unit economics réel : avec commission 3-4% et Stripe 1.5%+0.25€, calculer la marge nette par transaction et le panier moyen nécessaire pour que l'abonnement 49€ soit rentable côté club. Vérifier que ça tient. | élevé | facile | faible | élevé | 1 jour |
| 29 | Bloquer les ventes d'alcool hors plage horaire légale (enforcement Loi Évin / horaires locaux) au niveau backend. Param par établissement. | moyen | facile | faible | moyen | 1 jour |
| 30 | Remplacer l'autorisation parentale par upload PDF DIY par une e-signature qualifiée (DocuSign/HelloSign) pour les événements admettant des mineurs. Sinon ne pas autoriser mineurs au lancement. | moyen | modérée | moyen | moyen | 3 jours |
| 31 | Réduire la dette structurelle UNIQUEMENT sur les god-pages que le wedge utilise (refactor Bouncer 1905 LOC, MyOrders 1842, TicketSelection 1167 seulement si dans le scope MVP). Ne pas refactorer ce qui est gelé. | moyen | modérée | faible | moyen | 3-5 jours ciblés |
| 32 | Introduire une mince couche data (repository) sur les 5-10 tables du wedge seulement, pour découpler des 933 appels supabase.from() bruts. Pas un refactor global : juste les chemins critiques. | moyen | modérée | faible | moyen | 3-4 jours |
| 33 | Documenter et figer l'état des 495 migrations : marquer la baseline propre, vérifier l'objet live vs historique (ghost migrations), garantir qu'un nouvel environnement se reconstruit. Risque setup env. | moyen | modérée | faible | moyen | 2 jours |

---

# Plan d'action — 90 prochains jours

## Principe directeur : RÉTRÉCIR et VALIDER, ne JAMAIS construire plus

La ressource la plus rare n'est pas le code (le founder en produit énormément) mais l'apprentissage marché (zéro à ce jour). Chaque jour sur le 6e rôle est un jour non passé à signer un BDE. **Feature freeze total** inscrit dans CLAUDE.md : aucune nouvelle page, aucune nouvelle edge function, aucun nouveau rôle jusqu'au PMF du wedge.

---

### Semaine 0 (avant tout) — La décision fondatrice
- **Tuer la dispersion par écrit.** Choisir UN wedge : co-soirée club↔BDE/orga avec contrats de partage de revenus signés. UNE ville : celle où Paul a un réseau réel (PAS Paris — suicide concurrentiel face à Shotgun ; viser une ville moyenne à densité BDE+clubbing). UN objectif : 3-5 BDE/clubs pilotes facturés sous 60 jours.
- **Masquer (flag, ne pas supprimer) :** pilier boisson skip-the-bar, marketplace DJ, affiliés, promoteurs, et 4 des 6 rôles. Ne garder que **club owner + organisateur/BDE + scan d'entrée**.
- Retirer le pilier boisson du discours de vente : le mentionner déclenche l'objection POS et fait perdre le deal.

### Semaines 1-2 — Débloquer + bloquants compliance (NON NÉGOCIABLE)
- **Lever le cap de dépense Supabase (402).** Pré-requis ops absolu : sans ça rien ne se déploie.
- **BLOQUANT — Fermer le guest checkout alcool sans age gate backend** (`create-checkout/index.ts`). Refuser tout achat alcool en invité non vérifié.
- **BLOQUANT — Vérif d'âge réelle** (Stripe Identity ou Onfido) déclenchée une fois pour tout achat alcool, jamais re-vendable indéfiniment. Tuer la date auto-déclarée.
- **BLOQUANT — Attestation licence/SIRET + agrément alcool du club** AVANT activation des ventes alcool. Champ obligatoire + revue manuelle solo (faible volume au lancement).
- **MFA obligatoire** sur le compte super admin (2h de config).

### Semaines 3-4 — Rendre le produit OPÉRABLE
- **P0 admin opérateur :** refund Stripe 1-clic, suspension de compte, recovery, kill-switch event, kill-switch contenu. Sans ça, impossible de gérer du live.
- **Résilience offline minimale** sur le scan d'entrée (validation crypto locale + outbox/background sync). Un scan qui plante à l'entrée bondée = churn club instantané et définitif.
- **10-15 tests automatisés ciblés UNIQUEMENT** sur revenue-critical + légal : calcul commission, split co-event, age gate, refund. Pas de couverture globale — un filet sur l'argent et le droit.
- Aligner le pricing Stripe sur la grille cible. Tester end-to-end en Stripe live (petits montants) : achat → paiement → refund → chargeback, une fois.

### Semaines 5-8 — PROUVER LA LIQUIDITÉ (le vrai jalon)
- **Signer et facturer 3-5 BDE/clubs réels** dans la ville cible. Le BDE amène SA propre audience (500-3000 étudiants activables gratuitement) → effondre le double cold start en cold start simple. C'est le seul canal d'acquisition CAC~0 déjà codé.
- **INTERDICTION de paid acquisition** (Insta/TikTok ads) — le CAC réel nightlife est 30-50€+, pas 3-8€, et il n'y a aucune donnée LTV. Pré-PMF, le paid achète de la vanité au prix du runway.
- Vendre sur les vraies douleurs monétisables : no-show VIP, remplissage soirées creuses, partage de revenus contractualisé (substitut actuel = WhatsApp + Excel). PAS l'anti-file.

### Semaines 9-12 — VALIDER LA RÉTENTION (le seul signal de PMF)
- **Le signal qui compte : un BDE qui refait une soirée SANS relance.** La cadence hebdo/mensuelle universitaire bat la saisonnalité nightlife — c'est le seul antidote au churn d'offre ~30%.
- Mesurer : rétention sur 3 mois de co-soirées récurrentes, GMV transitée réelle, take rate effectif encaissé, churn club.
- **Dé-risquer le bus factor :** recruter un co-founder ou advisor compliance/ops. Un VC ne financera pas un système argent+alcool+mineurs+RGPD sur bus factor 1.
- Si 3 BDE reviennent spontanément → dossier pré-seed avec pilote signé. Sinon → l'hypothèse de rétention (le coeur du business model) est fausse, et il faut le savoir AVANT de lever.

---

# Annexe A — Audit terrain (code réel)

## A.1 — Audit technique / scope

AUDIT TECHNIQUE YUNO — CONSTAT FACTUEL (2026-06-29)

SYNTHÈSE EXÉCUTIVE

Yuno est une plateforme multi-faces (nightlife SaaS/marketplace) construite en solo par un fondateur avec vitesse assistée par IA, sur un codebase actuellement non testé et partiellement non déployé. L'écart entre l'ambition affichée (MVP commande de boissons) et la réalité construite (3 piliers, 6+ rôles, marketplace complexe, systèmes financiers multi-tenant) est stratégiquement dangereux : c'est un cas classique de « boil the ocean avant PMF ». Le produit est architecturalement fonctionnel, mais n'a aucun utilisateur réel validé et fait face à des risques critiques de déploiement, de sécurité opérationnelle et de viabilité business.

ÉTAT QUANTIFIÉ VÉRIFIÉ

Codebase : 726 fichiers TS/TSX, 189 pages React (moyennes ~920 LOC), 94 edge functions Deno, 495 migrations SQL, ~210 600 lignes code frontend, 2.2 Mo i18n (30 948 lignes trilingue EN/FR/ES), 39 Mo build production.

TROIS PILIERS CONSTRUITS :
1. Billetterie événements (TicketSelection 1167 LOC, TicketCheckout 1122 LOC, EventDetails 1312 LOC)
2. Tables VIP/Bottle service (FloorPlanEditor 1188 LOC, système floor plan complet, QR scanning)
3. Commande boissons skip-queue (MyOrders 1842 LOC, Barman 1502 LOC, menu digital, paiement intégré)

SIX+ RÔLES AVEC DASHBOARDS : Club owner, Organisateur/BDE, Promoteur, Affilié, DJ, Staff opérationnel (Barman 1905 LOC, Bouncer 1905 LOC, Vestiaire, Host VIP, Manager).

ARCHITECTURE FINANCIÈRE MULTI-TENANT : Stripe Connect double destination, RLS Supabase (158 policies), commissions 4% billets/tables + 3% boissons (centralisées fees.ts), webhook gestion payout.

DETTE STRUCTURELLE DOCUMENTÉE : 43 fichiers morts, React Query court-circuité (33 vs 793 appels direct), 933 appels supabase.from()/rpc() sans couche data, 1154 hex couleur inline, 11 god-pages > 1000 LOC.

TESTS AUTOMATISÉS : 0 fichiers .test.* ou .spec.* dans src/ (zéro couverture).

DÉPLOIEMENT : Frontend build OK (Cloudflare Workers), backend incomplet (plusieurs edge functions non déployées cap 402), admin panel manquant P0 critiques.

GIT/VÉLOCITÉ : 50 commits (1 mois), 1-2 commits/jour, vitesse de construction très élevée mais sans validation marché.

RISQUES CRITIQUES

CRITICITÉ ÉLEVÉ :

1. ZÉRO UTILISATEUR RÉEL VALIDÉ : Aucune mention de client/établissement signé, aucune métrique d'utilisation, code contient demo_is_live() toggle. Plateforme construite en spec, jamais testée marché.

2. ABSENCE TOTALE DE TESTS AUTOMATISÉS : 0 framework testé, paiements/auth/RGPD/alcool mineurs sans filet. Niveau confiance très faible.

3. DÉPLOIEMENT INCOMPLET : Admin panel dysfonctionnel (Orders/Subscriptions lecture seule), P0 manquants (remboursement, recovery compte, suspension, annulation événement, kill-switch contenu). Audit SUPERADMIN : « partiellement prêt mais incomplet — inexploitable en l'état pour gérer du live ».

4. ÉCART SCOPE vs FOCUS LEAN STARTUP : Fondateur décrit « MVP boissons », réalité = 3 piliers, 6 rôles, 94 edge functions. Pas de validation rapide du 1er pilier, construction « boil the ocean ».

5. CAP SUPABASE EDGE FUNCTIONS 402 : Bloque déploiement nouveaux edge functions. Pré-requis ops immédiat avant go-live.

6. ARCHITECTURE SANS COUCHE DATA : 933 appels Supabase bruts dispersés, React Query court-circuité. Un changement schéma touche dizaines de fichiers. Vitesse feature post-lancement = très faible.

7. GOD-PAGES CRITIQUE : 11 pages > 1000 LOC (Bouncer 1905, MyOrders 1842, TicketSelection 1167) mélangent état + logique + UI. Maintenabilité compromise.

8. CONFORMITÉ ALCOOL/MINEURS : Aucun test age verification flow, refund logic testée démo seul. Risque légal si vérification fausse.

9. HISTORIQUE MIGRATIONS SUPABASE : 495 migrations (legacy Lovable + reconciliation), ghost migrations. Setup nouvel environnement complexe, états potentiellement incohérents.

10. RLS & SÉCURITÉ : 158 policies complexes sans audit complet, admin account sans MFA obligatoire, sk_ Stripe en edge functions = risque compromis.

POINTS POSITIFS À CRÉDITER

1. ARCHITECTURE GLOBALE SAINE : Feature-folders propre, TypeScript partout, RLS granulaire par rôle/tenant, intégrité serveur solide (triggers atomiques).

2. CONVENTIONS HOMOGÈNES : Hooks useX, PascalCase, très peu rustines (1 TODO, 0 FIXME, 3 XXX), centralisation frais (utils/fees.ts).

3. SOPHISTICATION BUSINESS : Stripe Connect correct (club = marchand), revenue split multi-face, marketplace DJ avec contrats sécurisés, analytics KPIs clés (no-show, yield, ROI promoteur).

4. VITESSE CONSTRUCTION : 50 commits 1 mois, 94 edge functions, 189 pages, 3 piliers. Assistée IA mais architecturalement cohérente. Preuve fondateur PEUT construire rapidement proprement.

5. DESIGN & UX : Design systems séparés (public/pro), Framer Motion animations cohérentes, Recharts analytics, Tailwind + shadcn cohérent.

VALIDATIONS MANQUANTES CRITIQUES

PRODUIT-MARCHÉ : Aucun utilisateur/établissement réel confirmé, pas PMF signal, pas DAU/MAU/conversion metrics. Hypothèse « clubs paient 49-199€/mois + 3-4% commission » = 0 validation.

RÉGLEMENTAIRE : Age verification flow = non testé, RGPD crons existent mais jamais testé « right to be forgotten », PCI-DSS compliance check inconnu.

SÉCURITÉ OPÉRATIONNELLE : 0 penetration testing, RLS 158 policies sans audit cohérence complète, admin sans MFA obligatoire, sk_ exposé edge functions.

PERFORMANCE : 0 load testing barman scanning simultané, 0 edge function testing sous charge, 933 requêtes + PWA + Mapbox = risque perf montée.

VERDICT STRATÉGIQUE

CRITICITÉ : ÉLEVÉ — LANCEMENT PRÉMATURÉ SANS CORRECTIFS PRIORITAIRES.

Yuno N'EST PAS un MVP. C'est une plateforme complète construite sans validation marché. Risque central : erreur direction structurelle non corrigée avant go-live (ex: si clubs ne veulent pas « payer croissance » mais « payer commission », business model s'effondre après 94 edge functions + 495 migrations).

SÉQUENÇAGE PRE-LAUNCH CRITIQUE :
1. Lever cap Supabase 402 (ops)
2. Implémenter P0 admin (remboursement, recovery, suspension, kill-switch) — 2-3 jours
3. Tester refund Stripe live — 1 jour
4. Age verification alcool + test — 1 jour
5. MFA obligatoire admin — 2h ops
6. QA navigateur compète — 8-12 heures

TIMING RÉALISTE : 10-15 jours fin juillet. GO-LIVE SANS CELA = catastrophe opérationnelle (chargebacks, compliance, customer churn).

BENCHMARK vs CONCURRENTS : Yuno = position unique (3 piliers + marketplace) MAIS construction avant traction = Airbnb/Uber strategy sans capital initial Airbnb. Risque implosion >> potentiel.

RECOMMANDATION INVESTISSEUR (10M€) : NE DÉPLOYEZ PAS état actuel. Investissez 2-3 semaines : (1) validation ultra-rapide 1 bar pilote boissons seul, (2) admin operationalizability 4-5 jours, (3) freeze scope (boissons seul), (4) chaos engineering testing. Équipe capable, produit pas prêt vrais clients payants. 2-3 semaines = risque baissé 70%, solide ante Series A.

FICHIERS CLÉS AUDITÉS : /Users/paul/Desktop/yuno-app/TECH_DEBT_AUDIT.md, PLAN_NETTOYAGE.md, AUDIT_SUPERADMIN.md, AUDIT_ANALYTICS_OWNER.md, CLAUDE.md, README.md, docs/PRICING_STRATEGY.md, wrangler.jsonc, src/App.tsx, supabase/functions/*, package.json.

## A.2 — Audit conformité / paiements / réglementaire

# AUDIT CONFORMITÉ YUNO — PAIEMENTS, ALCOOL, MINEURS

## SYNTHÈSE

Yuno manipule l'argent pour la vente d'alcool et de services en ligne via Stripe Connect double destination (club/organizer), sans agrément formelle de plateforme de paiement ou établissement. L'architecture « club = marchand de record » est audacieuse techniquement mais **exposée réglementairement en France**. Trois expositions majeures et critiques détectées :

1. **Vente d'alcool à mineurs sans vérification d'âge cryptographique** : la date de naissance est acceptée auto-déclarée (code `MinorAuthGate.tsx`), jamais validée contre identité, **jamais revalidée sur co-achats**, et **totalement absente du flux guest checkout**. Un mineur peut déclarer 18 ans une fois et acheter indéfiniment.

2. **Guest checkout sans age gate** : fonctionnalité `create-checkout/index.ts` autorise clients non-authentifiés à acheter des boissons alcoolisées **directement, zéro barrière d'âge**. Aucun MinorAuthGate appelé côté backend pour les invités.

3. **Absence de vérification licence alcool des clubs** : Yuno compte sur Stripe Connect KYC seul; Stripe ne vérifie pas l'agrément secteur alcool local (France). Escroc fictif peut ouvrir compte club et vendre alcool sans licence.

**Criticité réglementaire globale : CRITIQUE**. France : vente alcool à mineur = crime (article L. 3353-1 Code de la santé publique); responsabilité pénale de la plateforme facitriatrice. CNIL : données mineurs conservées indéfiniment = exposé RGPD (amende 4% CA, plafond 20M€). Stripe Connect statut DSP2 flou = risque fermeture compte.

**État du produit :** NON DÉPLOYÉ en production, zéro test automatisé, une seule personne (Paul, bus factor = 1). Tout risque opérationnel amplifie le risque réglementaire.

---

## DÉTAIL CRITIQUE #1 : VENTE ALCOOL À MINEURS

### Faille : Pas de vérification d'âge stricte

**Code observé :**
- `MinorAuthGate.tsx:31-39` — simple calcul d'âge civil (date naissance → année courante).
- Aucun KYC (vérification identité, scan passeport/carte).
- Aucun appel tiers de confiance (Onfido, Idemia, Stripe Radar).

**Brèche :**
```typescript
// MinorAuthGate.tsx:52-53
const age = birthDate ? ageFromDate(birthDate) : null;
const isAdult = age !== null && age >= 18;
```
Le mineur tape une date de naissance fausse (« 2006-01-01 » quand il est né 2010) → système croit qu'il a 18 ans. **Zéro défense légale.**

### Faille : Pas de re-validation par achat

**Code observé :**
- Date sauvegardée sur `profiles.birth_date` une fois → réutilisée silencieusement sur tous les achats futurs.
- Aucune re-vérification annuelle.
- Aucune vérification du côté du barman (code QR → juste nom + token, pas âge).

**Scénario :** Mineur de 15 ans tape 1991-05-15 une fois → après 3 ans, profil revendique 22 ans (vrai mathématiquement mais mineur réel reste 18) → achète indéfiniment.

### Faille critique : Guest checkout SANS age gate

**Code observé :**
```typescript
// create-checkout/index.ts:156-160
const isGuestCheckout = !user && !!guestEmail;
if (isGuestCheckout) {
  logStep("Guest checkout — no account creation", { guestEmail });
}
// ... pas d'appel à MinorAuthGate
```

**Conséquence :**
- Mineur envoie `guestEmail: "junior17@gmail.com"` → commande boissons alcool → zéro validation âge.
- Système crée simplement `orders[user_email: junior17@gmail.com, is_guest: true]`.
- **Trace légale parfaite de la responsabilité de Yuno.**

### Droit pénal français applicable

| Loi | Texte | Sanction | Statut Yuno |
|-----|-------|----------|------------|
| L. 3353-1 Code santé publique | Interdiction vente alcool <18 | 450€—4 500€; fermeture établissement | Complice (fourni moyen technique) |
| Loi Évin (1991) | Restrictions pub alcool | 15 000€—100 000€ | Publicitaire indirecte (boissons visibles) |
| Loi du 31 déc 1989 | Responsabilité du fournisseur | Pénalité pénale | **Co-auteur** (Yuno facilite transaction) |

**Risque : Fermeture service + amende + responsabilité civile clients alcoolisés mineurs.**

---

## DÉTAIL CRITIQUE #2 : ABSENCE VÉRIFICATION LICENCE ALCOOL CLUB

### Yuno accepte clubs sans KYC secteur

**Code observé :**
- Onboarding Stripe Connect : email + Express account (`stripe-connect/index.ts:76-80`).
- Aucune vérification SIRET/SIREN avant la création.
- Aucune demande certificat d'exploitation (agrément mairie).
- Aucun audit Yuno des antécédents.

**Risque :** 
1. Escroc crée compte Stripe fictif avec email temp.
2. Ouvre « club » dans Yuno (pas de vérification).
3. Liste boissons alcoolisées.
4. Reçoit commandes mineurs.
5. Disparaît avec les fonds avant payout (si Yuno tient l'argent).

### Happy hours non bloqués

**Code observé :**
- Aucun bloc temporel dans `create-checkout/index.ts`.
- Boissons vendables 24h/24.

**Droit français :** Loi Évin interdit alcool après 22h dans les bars (Happy hour window : 11h—22h). Yuno ne tient pas compte des fuseaux horaires locaux ou heures légales.

---

## DÉTAIL ÉLEVÉ #3 : DONNÉES MINEURS & RGPD

### Collecte sans consentement explicite

**Code observé :**
- `MinorAuthGate.tsx:79-87` — charge `profiles.birth_date` de la DB, pré-remplit si présent.
- Aucune demande consentement explicite avant de sauvegarder.
- Aucun consentement parental pour mineurs (< 16 ans en France).

**RGPD :** Collecte data mineurs sans consentement parental = violation Art 8 (mineur consentement parental).

### Conservation indéfinie

**Code observé :**
- `profiles.birth_date` jamais supprimée (pas de cron RGPD spécifique).
- Aucune policy d'oubli explicite.
- Aucune demande de suppression honorée post-event.

**RGPD :** Conservation indéfinie = violation Art 5(1)(e) (limitation durée). CNIL peut infliger **4% du CA ou 20M€ d'amende**.

### Démo sensible via event_audience_demographics

**Code observé :**
- Migration `20260621190000_event_audience_demographics.sql` collecte démographie inférée.
- Tableau public : "45% participants < 20 ans" → attractif pour prédateurs.
- Mapbox géoloc pointé sur chaque guest.

**Risque :** Données mineurs de-anonymisées via croisement location + age → exposition prédateurs.

---

## DÉTAIL ÉLEVÉ #4 : ESCROW DJ & STATUT DSP2

### DJ payout = escrow sans agrément

**Code observé :**
```typescript
// dj-payout.ts:39-44
function computeDjEscrowFeeCents(cachetCents: number): number {
  const RATE = 0.04;
  const MIN_CENTS = 200; // 2€
  const CAP_CENTS = 25000; // 250€
  return Math.min(CAP_CENTS, Math.max(MIN_CENTS, Math.round(cachetCents * RATE)));
}
```

Club paie cachet → charge Stripe → **Yuno détient l'argent 0—2 jours** (acompte release immédiat, balance release après event).

**DSP2 Directive 2015/2366/EU :** Si Yuno manipule fonds tiers, peut déclencher obligation d'agrément d'établissement de paiement (PSD2 Art 67-72). Stripe = acquiring, mais Yuno = responsable du service.

**Risque :** ACPR (banque centrale France) peut interdire Yuno de manipuler fonds sans agrément.

---

## DÉTAIL MOYEN #5 : AUTORISATION PARENTALE = SIMPLE PDF

**Code observé :**
```typescript
// 20260614010000 : accepte PDF/TXT ; 20260614020000 restreint à PDF/TXT
// Mais zéro validation contenu
const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  // Juste upload, pas de parsing/validation
  const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
  await supabase.storage.from('minor-auth-uploads').upload(path, file, ...);
};
```

**Problème :** Mineur peut télécharger n'importe quel PDF (reçu Carrefour, magazine scanné) → Yuno l'accepte.

**Légalement :** Faux document = crime (contrefaçon). Si contrôle, document invalide = Yuno pas de défense.

---

## RÉSUMÉ EXPOSITIONS CLASSÉES

### 🔴 CRITIQUE (Impératif pré-launch)

1. **Vente alcool mineurs non vérifiée** — test auto-déclaration sans KYC
2. **Guest checkout = zéro age gate** — mineur achète alcool anonyme
3. **Absence certificat alcool clubs** — escroc peut ouvrir et vendre

### 🟠 ÉLEVÉ (12 mois)

4. **Données mineurs conservées indéfiniment** — violation RGPD
5. **Date naissance jamais re-validée** — même personne peut être 18 ans et 12 ans selon historique
6. **Escrow DJ sans agrément DSP2** — Yuno manipule fonds sans certification
7. **Happy hours alcool non bloqués** — vente hors-horaire légale

### 🟡 MOYEN (18 mois)

8. **Autorisation parentale = DIY PDF** — document peut être faux, pas vérifié
9. **Pas de test automatisé** — régression silencieuse, aucune trace audit
10. **Co-event alcool auto-signé** — Yuno vs. organizer dispute sans preuve forte

---

## POINTS POSITIFS

1. ✅ **Merchant of record = conforme non-alcool** — Stripe Connect Direct mode standard.
2. ✅ **RLS (Row-Level Security) DB** — Supabase RLS appliqué, moins accès non-autorisé.
3. ✅ **Contrats co-event eIDAS** — professionnalisme légal rare en startup.
4. ✅ **Minors allowed = design réfléchi** — distinction alcohol-free / minors allowed est UX-saine.
5. ✅ **Commission affichée transparente** — 3—4% clair, moins risque requalification.

---

## RECOMMANDATIONS PRIORITAIRES

### PRE-LAUNCH (BLOQUANT)

1. **Intégrer KYC ID** : Onfido / Stripe Radar pour mineurs (scan passport/carte).
2. **Bloquer guest alcool** : refuser guest checkout si `event.alcohol_free=false`.
3. **Club license attestation** : demander SIRET + certificat agrément alcool avant onboarding.
4. **Happy hour enforcement** : vérifier horaire (France : after 22h = blocked).

### PHASE 1 (6 mois)

5. **Parental consent tiers** : eSignature légale (Docusign / Hellosign) vs. PDF DIY.
6. **RGPD data retention** : cron supprime `birth_date` après event + 90j.
7. **DSP2 audit** : consulter ACPR sur statut agrément paiement.
8. **Refund / chargeback** : intégrer Stripe dispute routing intelligent.

### PHASE 2 (12 mois)

9. **Loi Évin compliance** : audit légal post-hoc; update CGU.
10. **Test suite** : coverage alcool + paiements + mineurs (pas manual).
11. **Churn analytics** : tracker churn mineurs vs. adultes (regulatory red flag).

---

## CONCLUSION

Yuno a une **technologie paiement solide** (Stripe Connect split, RLS DB, contrats eIDAS) mais **ZÉRO conformité alcool-mineurs pré-launch**. Investiture maintenant = garantie de rewrite 500k—1M€ pré-déploiement. Bus factor solo (Paul) amplifie risque opérationnel. **Verdict : gating conformité stricte obligatoire avant revenue.**

## A.3 — Intelligence concurrentielle

## PAYSAGE CONCURRENTIEL RÉEL DE YUNO — Competitive Intelligence (cutoff jan 2026, sources web juin 2026)

### Constat-cadre (criticité ÉLEVÉE)
Yuno n'affronte pas "des concurrents". Il affronte **une vague de consolidation déjà jouée** sur ses TROIS piliers à la fois, par des acteurs qui pèsent 100 à 5 000 fois sa surface économique (Yuno = 0 € de CA, 0 client). Sur 12 mois (mi-2024 → mi-2025), trois deals ont redessiné l'adjacent exact de Yuno :
- **Fever a racheté Dice** (juin 2025) → consolidation billetterie live + découverte.
- **DoorDash a racheté SevenRooms pour 1,2 Md$** (mai 2025, all-cash) → la réservation/CRM hospitality devient une feature d'une plateforme de commerce géante.
- **Zenchef a fusionné avec CoverManager sous PSG Equity** (juillet 2025), après avoir absorbé Formitable, Resengo, Tablebooker → champion européen de la réservation resto (36 000 restos, 20 pays).

Traduction VC : les acheteurs stratégiques du marché de Yuno **sont déjà en train de tout racheter**. Un solo-founder pré-revenu qui construit en parallèle billet + table VIP + boisson se positionne face à des bilans de plusieurs centaines de millions, sans aucun des trois actifs qui comptent dans ce secteur : **liquidité (offre d'events), distribution (audience fan), et données de transaction**.

---

### PILIER 1 — Billetterie / découverte nightlife (le pilier le PLUS contesté)

**Shotgun (FR, Paris).** Positionnement : guide nightlife underground + billetterie, fans 18-30, électronique/clubs/festivals. Financement modeste et ancien (~3,4 M$ levés, dernier tour public 2 M€ en 2020 avec Newfund/Venrex) — *signal ambigu* : soit capital-efficient et rentable, soit sous-capitalisé face à Fever. **Force** : marque culturelle forte chez les promoteurs FR, exactement la cible de Yuno (clubs FR, BDE étudiants). **Faiblesse exploitable** : pas de pay-at-table ni de bottle service intégré ; Shotgun s'arrête au billet. **Menace pour Yuno : CRITIQUE sur le pilier billet en France** — c'est l'incumbent qui possède déjà les promoteurs et orgas que Yuno veut signer.

**Dice (UK, désormais filiale Fever).** ~238 M$ levés, CA ~28,5 M£ (2022), licenciements 2023, **racheté par Fever juin 2025**. Force : anti-touting, allocation, fan-first. Aujourd'hui = munition de Fever. Menace : indirecte, via Fever.

**Fever (le mastodonte).** **724 M$ d'ARR estimé, valo ~2 Md$, 40+ pays, 527 M$ levés (dont 100 M$ en juin 2025 via L Catterton/Point72), EBITDA positif.** Modèle : découverte d'expériences + billetterie + média propriétaire + production d'events (Candlelight, immersifs). **C'est le seul acteur qui combine découverte de masse + billetterie + capital + rentabilité.** Faiblesse : généraliste "experiences", pas spécialiste club/bottle service/boisson. Menace pour Yuno : **CRITIQUE sur découverte+billet** ; si Fever décide de descendre dans le bottle service, Yuno n'a aucune défense.

**Xceed (Barcelone) — l'analogue le PLUS dangereux pour Yuno.** Venture-backed, **25 M de clubbers**, présent à Barcelone, Madrid, Ibiza, Paris, Marseille, Toulouse, Lisbonne, Rome, Milan, Londres... **Il fait DÉJÀ les trois choses que Yuno veut faire** : guestlist gratuite + tickets + VIP bottle service, QR d'entrée en 2 taps, **plus un volet B2B "Xceed Pro"** (event & ticketing management). Géographie = exactement le terrain de Yuno (Europe du Sud + France). **Menace : CRITIQUE.** C'est le contre-exemple vivant qui prouve que la thèse multi-pilier de Yuno est faisable… mais déjà occupée, avec 25 M d'utilisateurs et un network effect à froid déjà résolu. La seule chose que Yuno fait que Xceed ne semble pas faire à fond : la **commande de boissons skip-the-bar** et l'**outillage opérationnel club** (staff, stock, encaissement).

**Weezevent (FR/BE).** **350 M€ de CA (2023)**, ~15 000 events, leader européen cashless après la fusion PlayPass. Force : cashless festival + contrôle d'accès, ancré FR/EU, clients Hellfest/Rock en Seine/F1/PSG. Faiblesse : orienté gros événements/festivals, pas l'expérience club récurrente ni le bottle service. Menace : ÉLEVÉE sur le pilier billet+cashless si Yuno vise festivals.

**Eventbrite.** Généraliste mondial, self-service, faible sur nightlife premium. Menace : FAIBLE (commodité, pas premium).

**Resident Advisor (RA).** 27 M de fans, 50 pays, billetterie spécialisée électronique anti-touting, ownership data promoteur. Force : autorité culturelle absolue sur le clubbing électronique. Faiblesse : pas de bottle service, pas de pay-at-table, modèle communautaire. Menace : ÉLEVÉE sur le segment clubs électroniques exigeants, FAIBLE sur le mainstream/bars.

**Partiful (US, a16z).** **Faux concurrent** : c'est du *consumer social* (invitations entre amis, 500k MAU, valo ~140 M$), pas du B2B nightlife. À retirer de la liste des menaces. À garder comme *inspiration UX* sur la viralité de l'invitation, rien de plus.

---

### PILIER 2 — Réservation tables VIP / bottle service

**Tablelist + TablelistPro (US).** L'analogue B2B le plus proche : VIP bottle service côté fan **+ logiciel de gestion club** (réservations VIP, ticketing, guest list, staff, CRM) — quasi le même périmètre que Yuno. Force : intégration verticale réservation→ops. Faiblesse : US-centré, pas de boisson skip-the-bar, marque faible hors États-Unis. Menace : MOYENNE en EU (absent), mais **preuve que le modèle multi-surface existe et a un précédent** → Yuno n'invente pas la catégorie.

**Discotech (US).** 1 000+ clubs, bottle service + guestlist + tickets, marketplace fan. US/Vegas-centré. Menace EU : FAIBLE, mais référence produit.

**SevenRooms (désormais DoorDash, 1,2 Md$).** CRM + réservations + table management hospitality haut de gamme, adossé à une plateforme de commerce mondiale. Menace : ÉLEVÉE sur le CRM/réservation premium si DoorDash pousse en EU.

**Espace blanc réel ici** : le bottle service "premium app" est sous-servi **en Europe continentale hors Espagne/Ibiza** (Tablelist/Discotech = US, Xceed = Sud EU + Ibiza). C'est le seul *vrai* angle Blue Ocean crédible de Yuno : **le bottle service digitalisé pour les clubs de villes FR/EU secondaires que Xceed ne couvre pas en profondeur**. Mais c'est un marché étroit (peu de villes ont une vraie culture bottle service), donc petit SOM.

---

### PILIER 3 — Commande de boissons "skip the bar" (le pilier le PLUS FAIBLE — criticité CRITIQUE)

**C'est le pilier que le fondateur met en avant comme MVP, et c'est le plus mauvais.**

**Sunday (sunday.app) — le contre-récit important.** Le narratif "Sunday s'est effondré" est **faux et daté** : ils ont coupé 60% de leurs marchés et licencié **en 2022** (pivot douloureux), MAIS ont **triplé leur base client sur 12 mois, atteint 3 500 restos, relevé 21 M$ fin 2025**, et signé un partenariat OEM avec **NCR Voyix (Aloha Pay-at-Table powered by sunday)**. Leçon pour Yuno, double et brutale :
1. Le pay-at-table QR **est un marché dur** : Sunday, mieux capitalisé, a dû brûler du cash et réduire la voilure avant de retrouver la croissance. Un solo-founder pré-revenu sur le même mécanisme part avec un handicap structurel.
2. Sunday a survécu en devenant **l'infrastructure de paiement intégrée au POS** (NCR), pas en restant une app fan. La valeur est dans l'intégration POS, pas dans le QR sexy.

**QR-order bars/clubs (Yoello UK, Butlr UK, Barpay/LineSkip US, Rooam US).** **Cimetière d'apps locales.** Le segment "skip the bar queue en boîte" est jonché d'apps mono-ville (Fresno, Charlotte) et de solutions UK régionales. **Aucun gagnant paneuropéen n'a émergé**, ce qui n'est PAS un espace blanc — c'est un **signal que le job-to-be-done ne tient pas** : en club bondé à 1h du matin, scanner un QR, payer, attendre, et aller chercher sa conso ne bat pas toujours "je tends ma carte au barman". Le JTBD échoue souvent côté opérationnel (le bar n'a pas la main-d'œuvre pour préparer des commandes app pendant le rush).

**POS modernes (Toast 23-28%, Square 27%, Lightspeed, SumUp, Zettle).** Ce sont les **vrais propriétaires de l'encaissement**. Yuno ne remplace pas un POS — il se branche dessus ou il meurt. Or Yuno n'a **aucune intégration POS** mentionnée. Toast/Square possèdent déjà le terminal, les données de vente, le hardware. Menace : CRITIQUE — le pilier boisson de Yuno est en concurrence frontale avec l'incumbent le mieux installé du bar.

---

### SYNTHÈSE STRATÉGIQUE — le vrai paysage et l'espace blanc

**Frameworks appliqués :**

- **Crossing the Chasm** : Yuno n'a même pas d'early adopters. Pire, il vise simultanément 6 segments B2B (clubs, orgas/BDE, promoteurs, affiliés, DJs, staff) — soit **6 "main streets" sans tête de pont**. Moore est catégorique : on prend UN segment, on le domine, on traverse. Yuno fait l'inverse.
- **Cold Start (Chen)** : tout marketplace nightlife meurt sans liquidité locale (assez d'events ET assez de fans dans UNE ville). Fever/Shotgun/Xceed ont résolu le cold start ; Yuno part de zéro contre eux. Le réseau ne démarre pas avec 119 pages, il démarre avec **un club rempli un samedi soir**.
- **Porter** : pouvoir des fournisseurs (Stripe, Supabase, Mapbox) = OK. Pouvoir des acheteurs (clubs) = ÉLEVÉ (ils ont déjà un POS, déjà Shotgun). Menace des substituts = MAXIMALE (le cash + le barman + le POS existant). Barrières à l'entrée pour Yuno = quasi nulles ; pour ses rivaux = leur capital et leur réseau. Porter dit : **mauvaise structure d'industrie pour un nouvel entrant non financé.**
- **Blue Ocean** : il n'y a **pas d'océan bleu sur les trois piliers à la fois**. Chaque pilier est un océan rouge avec un incumbent dominant (Shotgun/Fever/Xceed sur le billet, Tablelist/Xceed sur le VIP, Toast/Square/Sunday sur la boisson).

**Où est l'espace blanc CRÉDIBLE, s'il existe ?**
Pas dans "faire les trois". Le seul angle défendable est une **niche d'intégration verticale que personne ne couvre proprement en France** : *l'OS opérationnel du club FR de ville moyenne* — billetterie + table VIP + outillage staff (bouncer/vestiaire/hôte VIP) + co-soirée orga/BDE — **en laissant tomber la commande de boissons skip-the-bar** (pilier perdant) et en **s'intégrant** au POS plutôt que de le concurrencer. Le wedge le plus crédible dans tout le code construit : **la collaboration club↔organisateur/BDE avec contrats de partage de revenus signés** (event_collab_contracts, contrat-cadre récurrent). C'est le seul morceau où Yuno fait quelque chose que Shotgun/Fever/Xceed ne font PAS de façon native : **le partage de revenus contractualisé entre un club et une asso étudiante sur une co-soirée récurrente.** Ça, c'est un JTBD réel, mal servi, et géographiquement ancré (BDE = France).

**Verdict d'investisseur (10 M€ de mon argent) : NON en l'état.** Pas parce que c'est mal construit (la qualité d'exécution solo est impressionnante), mais parce que c'est **construit à l'envers** : 119 pages avant un seul club signé, 6 segments avant 1 tête de pont, 3 piliers dont 2 sont des océans rouges déjà consolidés (billet) ou des cimetières (boisson). Le seul chemin finançable : **tuer le pilier boisson, abandonner 4 des 6 rôles, et tout miser sur le wedge co-soirée club↔BDE en France**, prouver la liquidité dans 3-5 clubs réels, PUIS étendre. Sinon Yuno se fait écraser par Xceed (même périmètre, 25 M d'users) ou ignorer par Fever (qui ne le verra jamais).

---

# Annexe B — Vérités brutales agrégées du panel (68)

- **[CRITIQUE]** Le fondateur a priorisé le plus petit et le plus mortel des trois marchés (boisson skip-the-bar, < 5 M€ SAM FR, cimetière d'apps) comme MVP, alors que le seul océan bleu réel (co-soirée contractualisée club↔BDE, ~12-40 M€ revenu plateforme FR sans incumbent natif) existe déjà dans le code mais n'est pas la tête d'affiche.
  - *Pourquoi :* C'est une inversion de priorité stratégique. Mettre en avant le pilier perdant comme MVP signifie que le premier cycle de validation marché testera l'hypothèse la plus faible. Sunday, bien mieux capitalisé, a dû brûler du cash et couper 60% de ses marchés sur ce mécanisme. Un solo pré-revenu n'a aucune chance frontale ici, et le wedge gagnant (BDE) reste enfoui.
- **[CRITIQUE]** La vision 'OS du nightlife' positionne Yuno contre Shotgun + Fever + Xceed + Tablelist + Sunday + Toast/Square simultanément, soit 6 segments B2B sans aucune tête de pont — l'exact inverse de Crossing the Chasm.
  - *Pourquoi :* Aucun marketplace nightlife ne survit sans liquidité locale résolue dans UNE ville (Cold Start). Yuno part de zéro contre des acteurs qui ont déjà résolu le cold-start (Fever, Shotgun, Xceed=25M users). Attaquer six 'main streets' à la fois garantit de n'en dominer aucune. Le réseau ne démarre pas avec 119 pages, il démarre avec un club rempli un samedi soir — et il n'y en a aucun.
- **[CRITIQUE]** 119 pages, 94 edge functions et 495 migrations ont été construites AVANT le moindre cycle build-measure-learn — la vélocité IA a amplifié le risque au lieu de le réduire en permettant de fuir la validation marché plus longtemps.
  - *Pourquoi :* C'est du Lean Startup à l'envers : produit complet avant le premier client. Le risque n'est pas de mal construire (l'exécution est impressionnante) mais d'avoir construit la mauvaise chose, trop large. Pire, si l'hypothèse de base est fausse (les clubs veulent payer une commission, pas 'payer la croissance'), tout l'édifice de 94 fonctions et 495 migrations s'effondre après coup. Construire vite la mauvaise chose reste construire la mauvaise chose.
- **[CRITIQUE]** Vous affrontez Xceed qui fait DÉJÀ vos 3 piliers (guestlist + tickets + VIP bottle service) avec 25 millions d'utilisateurs et un volet B2B, sur exactement votre terrain (Paris, Marseille, Toulouse, Barcelone, Madrid, Ibiza). Le cold start qu'il vous reste à résoudre, ils l'ont résolu il y a des années. Votre thèse multi-pilier n'est pas fausse — elle est déjà occupée.
  - *Pourquoi :* Cold Start (Chen) + Crossing the Chasm : un marketplace nightlife meurt sans liquidité locale. Yuno part de 0 client contre un acteur de 25M users sur le même périmètre géographique et fonctionnel. Il n'existe aucune raison pour un club ou un fan de choisir un solo pré-revenu non déployé plutôt qu'un réseau déjà liquide.
- **[CRITIQUE]** Le pilier que vous mettez en avant comme MVP — la commande de boissons skip-the-bar — est le PLUS MAUVAIS des trois. C'est un cimetière d'apps mortes (Yoello, Butlr, Rooam, Barpay, LineSkip), aucun gagnant paneuropéen, et le JTBD échoue côté opérationnel : à 1h du matin en club bondé, scanner+payer+attendre ne bat pas 'je tends ma carte au barman', et le bar n'a pas la main-d'œuvre pour traiter des commandes app pendant le rush.
  - *Pourquoi :* Le fondateur a construit 189 pages autour d'une hypothèse produit que le marché a déjà invalidée à plusieurs reprises. Sans intégration POS (Toast/Square possèdent le terminal, le hardware, les données), ce pilier est mort-né. C'est l'inverse du Lean Startup : valider le pilier le plus risqué EN PREMIER, pas le construire le plus profondément.
- **[CRITIQUE]** Quatre expositions pénales/RGPD CRITIQUES vérifiées dans le code : guest checkout sans age gate backend (create-checkout/index.ts:157 crée l'order sans aucune vérification d'âge), date de naissance auto-déclarée jamais validée par KYC ni re-vérifiée, aucun blocage horaire alcool (Loi Évin), aucune vérif SIRET/licence alcool à l'onboarding club. Vente d'alcool à mineur = crime en France (L.3353-1), Yuno = co-auteur facilitateur.
  - *Pourquoi :* Un seul go-live alcool dans cet état = responsabilité pénale du fondateur dès le premier mineur servi, + amende CNIL jusqu'à 4% du CA ou 20M€ pour données mineurs conservées sans limite. Bus factor = 1 : personne pour répondre à une mise en demeure. Investir maintenant = garantie d'un rewrite conformité de 500k-1M€ avant le moindre euro de revenu.
- **[CRITIQUE]** Vous avez construit à l'envers : 189 pages, 94 edge functions, 495 migrations, 6 segments B2B et 3 piliers AVANT un seul club signé, avant une seule métrique d'usage, avec un toggle demo_is_live() dans le code. C'est le 'boil the ocean' pré-PMF dans sa forme la plus pure.
  - *Pourquoi :* Lean Startup + Crossing the Chasm sont catégoriques : on prend UN segment, on le domine, on traverse le gouffre. Yuno vise 6 'main streets' sans tête de pont. Le risque n'a jamais été votre capacité à construire (elle est impressionnante) — c'est d'avoir construit la mauvaise chose, trop large, et de découvrir après 278 commits que les clubs veulent payer une commission mais pas un abo (ou l'inverse), faisant s'effondrer le business model par-dessous l'édifice.
- **[CRITIQUE]** Yuno n'a aucun moat. 0/5 sur les sources classiques (data, réseau, marque, techno, distribution) — toutes nulles car 0 transaction et 0 client. Un moat est un résultat marché, pas une feature ; Yuno a 119 pages de features et zéro résultat.
  - *Pourquoi :* Sans moat ni preuve de réseau, tout ce qui est construit est copiable en ≤1 trimestre par Shotgun/Sunday/Xceed/Toast qui ont DÉJÀ la distribution, les données et le capital. Le bundle 3-piliers n'est pas défendable : Xceed le fait déjà avec 25 M d'utilisateurs sur la même géographie.
- **[CRITIQUE]** Décision VC = NON en l'état. Solo, pré-revenu, pré-déploiement, 0 traction, exposition réglementaire alcool/mineurs critique (guest checkout sans age gate backend, pas de KYC identité, pas de vérif licence club).
  - *Pourquoi :* Aucun VC sérieux ne finance un SaaS qui touche paiements + alcool + mineurs + RGPD avec une responsabilité pénale potentielle (L.3353-1) et une amende CNIL jusqu'à 20 M€ non résolues, sur un bus factor de 1 sans personne pour répondre à une mise en demeure.
- **[CRITIQUE]** Double cold start (B2B clubs + B2C sortants) couplé de façon mortelle : la demande ne peut PAS amorcer l'offre (un sortant ne fait pas venir un club), et l'offre doit faire tout le travail d'acquisition de la demande elle-même. C'est le pire des deux mondes : difficulté d'adoption d'une marketplace, sans le bénéfice de l'effet réseau d'une marketplace.
  - *Pourquoi :* En solo, sans force de vente terrain et sans capital de subvention (Uber a payé ses chauffeurs ; Yuno ne peut subventionner personne), le double cold start est structurellement quasi-insoluble pour les piliers billet et boisson. C'est la raison mathématique pour laquelle ces piliers doivent mourir.
- **[CRITIQUE]** L'atomic network de Yuno n'est ni une ville ni un pays — c'est UNE soirée, dans UN club, un samedi, avec assez de payeurs in-app. Le fondateur a construit 119 pages et vise 6 villes/segments avant d'avoir rempli une seule de ces cellules. C'est l'inverse exact de la méthode Cold Start.
  - *Pourquoi :* Lancer 'une ville' (10 000 lieux à Paris) = dilution totale, aucun samedi ne ressent la différence, le réseau ne s'amorce jamais. Sans densité sur un atomic network unique d'abord, aucune réplication n'est possible. C'est la cause racine du risque d'implosion : boil-the-ocean avant la moindre tête de pont.
- **[CRITIQUE]** Le pilier que le fondateur appelle « MVP » (commande de boisson skip-queue) est le plus faible des trois et résout un JTBD qui échoue à 1h du matin. Le code confirme un modèle click&collect (clickCollect.preparing / markAsReady / récupération QR) qui a PLUS d'étapes que tendre sa carte au barman. Il déplace la file sans la supprimer.
  - *Pourquoi :* Construire le go-to-market autour du pilier le plus faible garantit l'échec de la première démo et du premier pilote. C'est un cimetière concurrentiel documenté (Yoello, Butlr, Barpay) et une concurrence frontale avec Toast/Square/Sunday sans aucune intégration POS dans le code.
- **[CRITIQUE]** L'age gate boisson est 100% côté front (composant AgeGate, self-declare YYYY-MM-DD). Le backend create-checkout traite le guest checkout (ligne 157) SANS aucune vérification d'âge serveur. Un appel direct à l'edge function bypasse totalement le gate. La date de naissance est auto-déclarée, jamais validée contre une identité, et réutilisée silencieusement à vie.
  - *Pourquoi :* En France, vente d'alcool à mineur via une plateforme = responsabilité pénale du facilitateur (L.3353-1). Un contrôle 100% client-side n'a aucune valeur juridique. C'est un risque régalien qui peut fermer le service, indépendamment de toute traction.
- **[CRITIQUE]** Le coût d'acquisition d'une app fan B2C sans inventaire d'events propre est prohibitif (Cold Start non résolu). Xceed couvre déjà le même périmètre 3-piliers avec 25M d'utilisateurs sur exactement le terrain de Yuno (Europe du Sud + France). Le network effect à froid est déjà résolu par un concurrent.
  - *Pourquoi :* Yuno doit amorcer la liquidité (assez d'events ET assez de fans dans UNE ville) à partir de zéro, contre un acteur qui l'a déjà fait. Sans wedge B2B étroit qui amène sa propre audience (le BDE amène les étudiants), le produit n'a aucun moteur d'acquisition viable.
- **[CRITIQUE]** Le bus factor = 1 n'est pas qu'un risque technique, c'est un plafond d'acquisition B2B. Tant que Paul est le seul commercial terrain, l'acquisition club plafonne à ~1-2 clubs/semaine et ne dépasse jamais une ville. Et avec ZÉRO test automatisé sur les paiements, un seul bug un samedi soir bondé peut tuer la réputation locale — le bouche-à-oreille nightlife est impitoyable.
  - *Pourquoi :* L'acquisition B2B repose entièrement sur la présence physique du fondateur (seule réponse honnête à l'objection 'et si ça bug le soir J', faute de tests). Ça ne scale pas, et un incident de paiement/scan QR en soirée live anéantit la preuve sociale locale qui est ton unique moteur de croissance au-delà du club #1.
- **[CRITIQUE]** Aucune unit economics calculable car 0 transaction. L'hypothèse la plus dangereuse et non testée du business entier : que les clubs RESTENT après leur première soirée. Un club qui teste 1 soirée puis abandonne a une LTV proche de 0, et tout le modèle (abo + commission) s'effondre. Le seul signal de PMF qui compte — un BDE qui refait une soirée sans relance — n'a jamais été observé.
  - *Pourquoi :* Construire 119 pages avant de valider la rétention, c'est l'erreur de direction structurelle de l'audit : si le marché veut 'payer la commission' mais pas 'payer la croissance' (l'abo), le business model s'écroule après 94 edge functions. Aucun montant d'acquisition ne compense une rétention nulle.
- **[CRITIQUE]** Le levier BDE B2B2C ne s'active réellement que si le guest checkout est sécurisé côté âge — or l'audit conformité confirme qu'il ne l'est PAS (mineur anonyme peut acheter de l'alcool, create-checkout/index.ts:156-160). Or le coeur de cible BDE = étudiants de 18-25 ans avec une fraction de mineurs (L1, BTS). Vendre de l'alcool à des soirées étudiantes via une app sans age-gate guest = responsabilité pénale française garantie (L.3353-1).
  - *Pourquoi :* Le canal d'acquisition le plus puissant (soirées étudiantes) est aussi celui qui maximise l'exposition réglementaire alcool-mineurs. Lancer le wedge BDE sans résoudre l'age-gate d'abord, c'est transformer ton meilleur canal de croissance en bombe juridique. Le pré-launch bloquant de §10.7 n'est pas optionnel.
- **[CRITIQUE]** Le ratio construction/validation est infini : ~6-12 mois de temps founder (tout le runway pré-PMF) dépensés sur l'OFFRE, ~0 sur la DEMANDE. C'est l'inverse exact de ce qu'un board exige avant un chèque. Le capital le plus rare (le temps avant PMF) a été investi du mauvais côté du bilan. Mais le burn cash est si bas (~150-600€/mois hors salaire) que la réorientation coûte quasi rien.
  - *Pourquoi :* Le risque n'est pas l'insolvabilité (burn dérisoire) mais le coût d'opportunité : des mois brûlés à construire 189 pages avant de prouver qu'un seul club paie. Le modèle entier repose sur une hypothèse de pricing power à 0% validée. C'est LA chose qui peut faire échouer Yuno.
- **[CRITIQUE]** Le flow QR ne fonctionne PAS offline — aucune file, aucun background sync, validation 100% online-only. Vérifié dans Barman.tsx (.from('orders').update() direct) et confirmé par l'absence totale de BackgroundSync/outbox dans tout le repo.
  - *Pourquoi :* Le nightlife a son moment de vérité (entrée bondée, bar en rush) précisément quand la 4G est la pire. Yuno arrive avec moins de résilience qu'une caisse enregistreuse des années 90. Le premier samedi où le réseau sature, le barman ne sert plus et le bouncer ne valide plus de billet. Aucun club ne re-essaie après une soirée où l'app a planté à l'entrée. C'est un churn instantané et définitif sur le pilier 'skip the queue' qui est censé être le différenciateur.
- **[CRITIQUE]** Zéro test automatisé sur un système qui calcule des splits Stripe Connect, des commissions, des refunds et des clawbacks de transfert. L'historique projet documente déjà des bugs financiers réels (line item facturant serviceFee au lieu de transactionFee → client surfacturé ; fuites TTC vs HT) trouvés par chance, pas par un test.
  - *Pourquoi :* Un seul bug de split non détecté = argent envoyé au mauvais compte Stripe, chargebacks, et risque de requalification de Yuno en collecteur de fonds (DSP2/ACPR). Un système financier sans test de régression sur les chemins d'argent est un no-go pour un investisseur. Le code 'marche en démo' ne prouve rien sur la justesse des calculs sous des cas réels.
- **[CRITIQUE]** Le barman ne scannera pas de QR au pic à 1h du matin — il contournera l'outil, et ce contournement falsifie la data client qui est l'argument de vente n°1 de Yuno au patron. Vérifié dans Barman.tsx : flux 100% dépendant du scan QR + realtime sans mode offline, avec un fallback 'served' legacy qui rend le bypass trivial.
  - *Pourquoi :* Si le persona qui exécute l'outil le sabote silencieusement, le pilier boissons s'effondre ET la promesse data (revente au patron) devient mensongère. C'est un échec en cascade : pas d'usage barman → pas de data → pas de ROI → churn patron.
- **[CRITIQUE]** Yuno vend 'réduire la file au bar' alors qu'une grande partie des patrons de club NE VEULENT PAS fluidifier — la file fait vendre et signale le succès social de la soirée. Le JTBD principal du pilier boissons est partiellement anti-corrélé à l'intérêt économique du client B2B.
  - *Pourquoi :* Vendre la solution à un problème que la cible ne considère pas comme un problème = friction d'adoption structurelle. Le fondateur doit repositionner sur 'panier moyen + pré-paiement' (que le patron veut) et non 'anti-file'.
- **[CRITIQUE]** Absence totale d'intégration POS (Toast, Square, Zelty, L'Addition, Tiller). Le patron a déjà une caisse ; Yuno l'oblige à double-saisir ou à abandonner son système. C'est un 'non' immédiat sur le pilier boissons. Sunday n'a survécu qu'en devenant l'infra DANS le POS (OEM NCR), pas une app à côté.
  - *Pourquoi :* Le pilier le plus mis en avant par le fondateur (MVP boissons) entre en concurrence frontale avec l'incumbent le mieux installé du bar — le POS — sans s'y intégrer. Sans intégration POS, le pilier boissons est mort-né en B2B.
- **[CRITIQUE]** Le guest checkout permet à un mineur d'acheter de l'alcool sans aucune barrière d'âge côté backend (create-checkout). Pour le patron, ce n'est pas le risque de Yuno, c'est SA licence d'exploitation qui saute. Ça transforme le deal de 'intéressant' à 'danger pour mon fonds de commerce'.
  - *Pourquoi :* Un opérateur expérimenté flaire immédiatement le risque pénal (L.3353-1) reporté sur lui. Aucun patron sérieux ne branche un outil qui peut lui faire perdre sa licence. C'est un tueur d'adoption B2B, pas seulement un risque légal pour Yuno.
- **[CRITIQUE]** Aucune validation marché d'un seul des 10 personas : 0 club signé, 0 barman testeur, 0 client réel. Les objections les plus mortelles (barman au pic, patron qui aime la file, double-saisie POS) n'ont jamais été confrontées au terrain. Le produit a été conçu côté écran, pas côté paume de main du barman.
  - *Pourquoi :* Lean Startup inversé : 119 pages avant un seul cycle build-measure-learn avec un opérateur réel. Chaque hypothèse persona ci-dessus pourrait invalider le produit, et aucune n'est testée. Un pilote 'boissons-only OU VIP-only' dans UN club aurait coûté 2 semaines et évité des mois de construction à l'aveugle.
- **[CRITIQUE]** Le pilier que le fondateur met en avant comme MVP (commande de boissons skip-the-bar) est objectivement le plus mauvais des trois : c'est à la fois un océan rouge (Toast/Square/Sunday) et un cimetière d'apps mono-ville (Yoello, Butlr, Barpay, Rooam) où aucun gagnant paneuropéen n'a émergé — signal que le JTBD ne tient pas en club bondé à 1h du matin.
  - *Pourquoi :* Investir le focus et la narration sur le pilier le plus perdant détourne l'énergie du seul wedge défendable (co-soirée club↔BDE). Pire : sans aucune intégration POS dans le code, Yuno affronte frontalement l'incumbent le mieux installé du bar sans l'actif clé. Sunday, dix fois mieux capitalisé, a failli mourir sur ce mécanisme exact et n'a survécu qu'en devenant infra POS (OEM NCR), pas app fan.
- **[CRITIQUE]** Xceed (Barcelone, 25 M de clubbers) fait DÉJÀ les trois piliers de Yuno (guestlist + ticket + VIP bottle service) sur le terrain géographique exact de Yuno (Paris, Marseille, Toulouse), avec un network effect cold-start déjà résolu. La thèse multi-pilier de Yuno est faisable — mais déjà occupée par un acteur 25 millions de fois plus avancé en liquidité.
  - *Pourquoi :* Cela invalide l'hypothèse implicite que la combinaison 3-piliers est un différenciateur. Ce n'est pas un océan bleu, c'est l'océan rouge de Xceed. Yuno n'a aucune défense si Xceed approfondit l'outillage ops club, et aucun avantage de distribution pour rattraper 25 M d'utilisateurs en partant de zéro.
- **[CRITIQUE]** Les acheteurs stratégiques du marché de Yuno sont en pleine consolidation (Fever→Dice juin 2025, DoorDash→SevenRooms 1,2 Md$ mai 2025, Zenchef→CoverManager juillet 2025). Yuno se positionne contre des bilans de centaines de millions sans posséder aucun des trois actifs qui comptent : liquidité, distribution, données de transaction.
  - *Pourquoi :* Le timing est le pire possible : entrer pré-revenu sur un marché en phase de consolidation finale, c'est arriver quand les places de leader sont déjà prises et que les survivants ont des bilans de guerre. 119 pages de code ne pèsent rien face à un club rempli un samedi soir, qui est le vrai actif que personne chez Yuno ne possède.
- **[ÉLEVÉ]** Xceed fait déjà guestlist + tickets + VIP bottle service sur exactement la géographie de Yuno (Paris, Marseille, Toulouse, Barcelone, Madrid, Ibiza) avec 25 millions de clubbers. La thèse des 'trois piliers' n'est pas un océan bleu, c'est un océan déjà occupé avec 25M d'utilisateurs d'avance.
  - *Pourquoi :* La différenciation revendiquée (faire les 3 choses) est démentie par un concurrent vivant qui les fait déjà à l'échelle, sur le même terrain. Le seul espace que Xceed ne couvre pas en profondeur est l'intersection contrat-co-soirée-BDE + boisson — et seul le premier est viable. La vision doit être cette intersection, pas l'union des piliers.
- **[ÉLEVÉ]** Yuno additionne trois TAM (billetterie ~60-90M€ FR, order&pay <20M€ FR, POS où SAM=0€) qui ne se cumulent pas sur le même euro client. Les take-rates ne s'empilent pas, ils se partagent un même moment de dépense. Chaque pilier ajouté divise le focus GTM sans multiplier le revenu par établissement.
  - *Pourquoi :* C'est une illusion comptable classique qui gonfle artificiellement le marché perçu et justifie la dispersion. Le revenu réel par établissement reste petit (un billet = 4% une fois, une conso = 3% une fois). Chaque pilier supplémentaire est une taxe de complexité, pas une synergie. L'investisseur sérieux voit immédiatement le bluff du TAM additionné.
- **[ÉLEVÉ]** Le SOM réaliste à 3 ans plafonne à ~150-350 k€ ARR même AVEC un focus radical, et tend vers ~30-80 k€ avec churn-to-zero si le scope reste à 3 piliers + 6 rôles. Le marché n'est pas le problème ; la capacité d'UNE personne à capturer un marché fragmenté contre des incumbents capitalisés en se dispersant l'est.
  - *Pourquoi :* Le marché FR nightlife+BDE est assez grand pour une boîte 10-30M€ ARR à terme, mais la bande passante GTM = 1 personne, le cycle de vente B2B = 1-3 mois, le churn nightlife est élevé, et 0€ levé ne couvre pas vente+support+conformité+dev simultanément. La vélocité IA accélère le code, pas l'acquisition client — qui reste le goulot d'étranglement réel.
- **[ÉLEVÉ]** Votre vitesse de construction solo assistée IA n'est PAS un moat — c'est une commodité. La même facilité qui vous a permis 94 functions permet à n'importe qui de vous copier, et ne vous protège pas d'incumbents capitalisés (Fever 724M$ ARR, valo ~2Md$) qui ont les trois actifs qui comptent et que vous n'avez pas : liquidité, distribution, données de transaction.
  - *Pourquoi :* Porter : la barrière à l'entrée pour construire est quasi nulle, donc la construction ne crée aucune défense. Les vraies barrières du secteur (réseau, marque, données) sont détenues par Xceed/Fever/Shotgun. Un fondateur qui croit que 'je construis vite et proprement' est un avantage durable se trompe de couche d'analyse.
- **[ÉLEVÉ]** Zéro test automatisé sur une plateforme qui manipule paiements, alcool, données mineurs et RGPD ; admin opérateur non fonctionnel (pas de refund, pas de recovery compte, pas de suspension, pas de kill-switch event) ; cap Supabase 402 bloquant le déploiement ; 933 appels Supabase bruts sans couche data ; 11 god-pages > 1000 LOC. Le produit n'est ni testé, ni déployable, ni opérable en l'état.
  - *Pourquoi :* Même si la stratégie était parfaite, le produit ne peut pas aller en prod : impossible de rembourser un client, de suspendre un fraudeur, ou de couper un event problématique. Un go-live dans cet état = catastrophe opérationnelle (chargebacks ingérables, fraude, churn). Et la dette structurelle (933 appels bruts) garantit que la vélocité de feature s'effondrera juste après le lancement, au moment où il faudra itérer vite sur les retours des premiers clients.
- **[ÉLEVÉ]** Le seul wedge potentiellement défendable (contrat-cadre récurrent club↔BDE, la plus grosse migration du repo à 33 Ko) n'est PAS dans les 3 piliers que le fondateur met en avant — et n'est toujours pas un moat tant qu'il n'a pas de réseau biparti local prouvé.
  - *Pourquoi :* Le fondateur disperse sa vélocité sur boisson/billet/VIP/6 rôles (océans rouges déjà consolidés) au lieu de concentrer 100 % sur le seul endroit où il fait quelque chose que les incumbents ne font pas nativement : le partage de revenus contractualisé club↔asso étudiante. C'est une confusion feature-vs-moat coûteuse.
- **[ÉLEVÉ]** Valorisation réaliste en l'état : 0,8–1,5 M€ pré-money (territoire angel/FFF, pas VC). Le code construit porte quasiment zéro valeur de valorisation — pire, sa largeur est un passif de maintenance solo.
  - *Pourquoi :* Le founder technique sur-valorise probablement le volume de code construit. En pré-seed UE, un VC paie l'optionnalité de marché prouvée, pas des lignes de code réplicables. La largeur (94 edge fns, 495 migrations, 933 appels Supabase bruts sans couche data) augmente le coût de maintenance solo sans créer de valeur défendable.
- **[ÉLEVÉ]** Yuno n'est pas une marketplace — c'est un SaaS de billetterie/encaissement avec une couche conso vestigiale. Le sortant n'arrive jamais par découverte ; il vient via un lien que le club lui pousse. Donc l'effet réseau cross-side, le cœur de toute thèse marketplace, est quasi inexistant.
  - *Pourquoi :* Tant que le fondateur croit construire une marketplace, il sur-investit dans une découverte consumer qui exige un budget média type Fever (527 M$ levés) et sous-investit dans le SaaS, le vrai produit. La valo et la stratégie GTM sont fondées sur la mauvaise nature de produit. Vérifié dans Explore.tsx (gating is_discoverable) et le PRD.
- **[ÉLEVÉ]** La liquidité nightlife ne s'accumule jamais : hits-driven (la valeur est dans LA soirée, pas le club), saisonnière (beach club = 4 mois/an, creux mortel jan-fév), churn d'offre ~30 % sur 2-3 ans. Pas d'effet de cliquet. Chaque rentrée, on repart quasi de zéro.
  - *Pourquoi :* Toute thèse d'effet réseau cumulatif s'effondre. Le seul antidote est la récurrence structurelle — et le seul segment de Yuno qui l'a nativement est le BDE étudiant (cadence hebdo/mensuelle sur l'année universitaire). Le fondateur ignore totalement cette dimension dans son dossier.
- **[ÉLEVÉ]** Le pilier boisson skip-the-bar — celui que le fondateur met en avant comme MVP — est le plus faible des trois pour des raisons de cold start ET de JTBD : aucun gagnant paneuropéen n'a émergé (cimetière d'apps mono-ville), et en club bondé à 1h, scanner+payer+attendre+aller chercher sa conso ne bat pas tendre sa carte au barman. Le bar n'a souvent pas la main-d'œuvre pour traiter les commandes app pendant le rush.
  - *Pourquoi :* Investir l'amorçage marketplace sur le pilier où le job-to-be-done lui-même ne tient pas est une perte sèche. Sunday a survécu en devenant l'infra POS (NCR), pas une app fan. Yuno n'a aucune intégration POS. Ce pilier consomme de l'énergie d'amorçage sans jamais atteindre la liquidité.
- **[ÉLEVÉ]** La file d'attente au bar n'est PAS un problème que les clubs veulent résoudre — c'est un problème qu'ils MONÉTISENT. Un bar bondé est une preuve sociale qui pousse la consommation impulsive et vend du champagne au verre à des gens qui attendent. Aucun gérant ne paie 49-199€/mois pour rendre son bar moins plein.
  - *Pourquoi :* Le problème central que Yuno met en avant côté B2B n'a pas de willingness-to-pay. La vraie douleur monétisable du club est ailleurs (no-show VIP, remplissage soirées creuses, vol de caisse, data client) — et le fondateur a justement construit ces briques mais ne les met pas en avant.
- **[ÉLEVÉ]** La promesse « simple comme Apple/Revolut » est structurellement incompatible avec 119 pages, 12 guards de rôle et 3 piliers. Apple est simple parce qu'il REFUSE des fonctionnalités. Yuno a l'esthétique premium mais l'architecture d'information d'un ERP nightlife.
  - *Pourquoi :* La dissonance entre le pitch (simple) et le produit (suite complète multi-faces) détruit la crédibilité du positionnement dès qu'un investisseur ou un client manipule réellement l'app. La simplicité est un problème de scope, pas de thème — et le scope n'a pas été coupé.
- **[ÉLEVÉ]** Le wedge réel et finançable est enterré sous le scope : le contrat de partage de revenus club↔BDE sur co-soirée récurrente (event_collab_contracts) est la SEULE chose que Shotgun/Fever/Xceed ne font pas nativement, et c'est ancré FR. Le fondateur l'a construit mais ne le vend pas comme le produit.
  - *Pourquoi :* Il y a un produit finançable à l'intérieur de Yuno, mais il faut tuer le pilier boisson, parker la marketplace DJ et les affiliés, et réduire le staff. Tant que les 3 piliers coexistent, le message commercial est dilué et le solo founder ne peut ni vendre ni maintenir clairement une seule proposition de valeur.
- **[ÉLEVÉ]** Le BDE est le seul vrai wedge — mais c'est un wedge à fort levier ET à plafond bas. Le SAM du BDE pur (~800-1500 assos adressables, ~1-3 M€ de commission/an à saturation nationale) ne porte pas une thèse de licorne. C'est une porte d'entrée pour traverser le gouffre vers l'OS opérationnel du club, pas le marché final. Le confondre avec le marché = lever sur un récit que tout investisseur lucide démontera.
  - *Pourquoi :* Un wedge mal cadré conduit soit à un sous-investissement (le fondateur croit que c'est petit et abandonne), soit à un sur-récit (l'investisseur voit le plafond et passe). Le cadrage Moore correct — wedge de cold start → marché adjacent — est ce qui rend l'histoire finançable.
- **[ÉLEVÉ]** Lancer à Paris serait un suicide concurrentiel. Shotgun y est né, possède les promoteurs et orgas, et un solo-founder à 0€ y est totalement invisible. La densité de Paris est un piège : elle dilue ta force de frappe au lieu de la concentrer. La seule stratégie marketplace qui marche au démarrage est la saturation mono-ville (80% d'une petite ville > 2% de dix villes).
  - *Pourquoi :* Le cold start (Chen) ne se résout que par densité locale atomique. Disperser l'unique commercial (Paul) sur un marché trop grand garantit qu'aucun réseau atomique n'atteint la masse critique — et donc qu'aucune boucle virale ne s'allume jamais.
- **[ÉLEVÉ]** Le pilier boissons skip-the-bar, que le fondateur met en avant comme MVP, est le plus mauvais des trois et doit être totalement retiré du discours d'acquisition. C'est un cimetière d'apps mono-ville (Yoello, Butlr, Barpay) et une concurrence frontale avec le POS (Toast/Square/Sunday) que tu ne peux pas gagner. En vente club, le mentionner déclenche l'objection POS et te fait perdre.
  - *Pourquoi :* Vendre le pilier le plus faible et le plus contesté positionne Yuno contre les incumbents les mieux installés (les POS possèdent déjà le terminal, le hardware, les données de vente). Le JTBD échoue souvent côté opérationnel : en club bondé à 1h du matin, le bar n'a pas la main-d'oeuvre pour préparer des commandes app.
- **[ÉLEVÉ]** Le founder met en avant le PIRE pilier économique. La boisson rapporte 0,27€ par transaction à Yuno (3% sur 9€). Il faut vendre 37 000 boissons pour faire 10k€ de revenu commission. Le pilier 'skip-the-bar' qu'il présente comme son MVP est à la fois le plus faible générateur de revenu/txn ET un cimetière concurrentiel (Sunday a pivoté vers l'OEM POS, les apps QR-bar sont mortes). Le revenu de Yuno viendra des tables VIP (10€/txn) et des billets (0,99€/txn), pas des boissons.
  - *Pourquoi :* Toute l'allocation d'effort et le pitch sont structurés autour du pilier le moins rentable et le plus contesté. Le founder optimise pour la mauvaise unit economics.
- **[ÉLEVÉ]** Yuno empile sa commission 3-4% PAR-DESSUS Stripe (1,5%+0,25€), sans posséder l'acquisition bancaire ni le hardware d'encaissement. Square/Toast peuvent prendre 2,6% parce qu'ils REMPLACENT l'acquéreur et fournissent le terminal. Yuno ajoute une couche de commission en cascade sur une marge club déjà fine, en concurrence directe avec Shotgun (0€ d'abo) et le POS déjà installé.
  - *Pourquoi :* Le take rate n'a aucune défense structurelle. Un club qui fait le calcul comparera à Shotgun et au POS et négociera vers le bas. Pricing power réel proche de zéro au lancement.
- **[ÉLEVÉ]** Le plancher de commission 0,99€ (0,49€ BDE) transforme le take rate en 6-8% effectif sur les petits paniers — précisément sur le segment étudiant/BDE qui est le SEUL wedge défendable selon l'intel concurrentielle. Sur un billet BDE à 10€, le fan paie 4,9% de fee Yuno + Stripe. C'est une bombe à conversion sur le terrain qu'il faut absolument gagner.
  - *Pourquoi :* Le plancher rend hostile la conversion exactement là où Yuno doit gagner. Le mécanisme de monétisation sabote le seul go-to-market crédible.
- **[ÉLEVÉ]** 10M€ ARR sur la France seule = capturer 50-80% de TOUTES les discothèques françaises (~1 500), OU déborder sur bars+festivals+plusieurs pays. Arithmétiquement il faut ~1 200 clubs actifs transactants. Chaque extension géographique est un nouveau cold-start frontal contre Xceed (25M users, même périmètre, Sud EU) et Shotgun (FR). Ce n'est pas un chemin de solo founder, c'est un chemin Series A+ avec une force de vente terrain multi-pays.
  - *Pourquoi :* L'objectif '10M€ ARR' est arithmétiquement traçable mais traverse les incumbents les mieux capitalisés du secteur. Le chemin existe sur tableur, pas sur le terrain compétitif réel.
- **[ÉLEVÉ]** Avec churn SMB hospitality réaliste de 10% mensuel et ARPU bas dominé par du Core gratuit, la LTV s'effondre à ~1 500€ et le ratio LTV/CAC tombe à ~1× — modèle non finançable. Le scénario sain (LTV/CAC 2,3×) suppose un churn de 7% et un ARPU de 250€ qui ne sont eux-mêmes basés sur AUCUNE donnée réelle. Toute la viabilité tient dans une fourchette de churn non observée.
  - *Pourquoi :* Les unit economics basculent de 'acceptable' à 'mort' sur un delta de churn de 3 points, et personne ne connaît le churn réel. Le modèle financier est un château de cartes d'hypothèses sans une seule observation.
- **[ÉLEVÉ]** Le cap edge functions à 94 (erreur 402 au déploiement) signifie que des fonctions sont codées mais NON déployées — le système en prod n'est même pas celui du repo. Combiné aux 495 migrations avec un lot 'sécurité' fantôme (marqué appliqué sans l'être), l'état réel live est invérifiable.
  - *Pourquoi :* On ne peut pas auditer ce qu'on ne peut pas voir. Pour un système qui traite paiements et données de mineurs, ne pas pouvoir garantir l'état réel du schéma de sécurité et des fonctions en prod est intenable. C'est aussi un mur opérationnel immédiat : impossible de déployer les correctifs P0 (auth mineurs, staff PIN) sans d'abord lever le cap.
- **[ÉLEVÉ]** Architecture sans couche data : 933 appels supabase.from/rpc nus, React Query installé mais court-circuité (33 vs ~793 appels directs), 41 souscriptions realtime éparpillées. Pas de cache applicatif, pas de dédup, pas de batching.
  - *Pourquoi :* Deux conséquences : (1) la vélocité feature post-lancement s'effondre — un changement de schéma touche des dizaines de fichiers ; pour une plateforme qui doit itérer vite face à Xceed/Shotgun/Fever, c'est un boulet. (2) Sous charge de soirée, l'absence de cache + N souscriptions realtime peut saturer le quota Supabase Realtime sans alerte. Ça passe en démo (1 user), ça meurt en soirée réelle (200 users).
- **[ÉLEVÉ]** Le moteur de hype est un vrai modèle statistique bien conçu (S-curve, empirical-Bayes shrinkage, confiance exposée) mais il n'a AUCUNE donnée pour se calibrer : 0 client, 0 événement réel. Le prior 'générique nightlife' est une supposition habillée en math.
  - *Pourquoi :* Une prévision fausse avec une UI confiante est pire que pas de prévision. Un owner qui voit 'projeté : 280 entrées' sous-commande stock/staff, fait un flop, et blâme Yuno. C'est le piège classique : l'IA construite avant la donnée. Le moteur sera crédible dans 12 mois de transactions réelles, pas aujourd'hui. Le mettre en avant comme feature de vente maintenant est un risque de réputation produit.
- **[ÉLEVÉ]** RLS (158 policies) est la SEULE frontière de sécurité des données, non auditée pour cohérence par rôle. L'historique est rempli de bugs 'RLS renvoie 0 résultat EN SILENCE' (recherche orga, deletes admin no-op).
  - *Pourquoi :* RLS est déclarative et silencieuse : une policy trop laxiste fuite des données sans erreur ; trop stricte bloque sans message. Sans audit + test d'accès par rôle, impossible d'affirmer qu'un promoteur ne peut pas lire les revenus d'un autre club, ou qu'un staff d'un venue ne voit pas les données d'un autre. Pour du multi-tenant financier, l'invérifiabilité de l'isolation tenant est un risque de fuite de données majeur.
- **[ÉLEVÉ]** Le 'skip the bar queue' ne supprime pas la file, il la déplace : le client paie dans l'app PUIS vient au bar attendre la préparation et le scan. On crée même deux files concurrentes (app vs comptoir) que le barman arbitre au détriment des commandes app. Le JTBD échoue par construction.
  - *Pourquoi :* Si le bénéfice promis (gagner du temps) n'est pas réel ni garanti dès le premier essai, le client revient au comportement par défaut (carte au barman), qui est le concurrent le plus féroce. Rétention quasi nulle sur ce pilier.
- **[ÉLEVÉ]** Bus factor = 1 (Paul solo, sans astreinte ni SLA) sur un outil qui manipulerait le paiement de la meilleure soirée d'un club un samedi à 2h du matin. Aucun club au-dessus de ~200 personnes ne mettra une dépendance opérationnelle critique sur un fournisseur solo.
  - *Pourquoi :* L'opérabilité 24/7 est non-négociable pour un système d'encaissement live. Le solo founder plafonne la taille des clients signables aux petits établissements, ce qui contredit l'ambition 'OS du nightlife' et limite drastiquement le ACV.
- **[ÉLEVÉ]** Yuno vise simultanément 6 segments B2B (clubs, orgas/BDE, promoteurs, affiliés, DJs, staff) = 6 têtes de pont à zéro early adopter. Crossing the Chasm est catégorique : on domine UN segment avant de traverser. Yuno a construit l'inverse exact — l'étendue avant la tête de pont.
  - *Pourquoi :* La dispersion sur 6 segments contre des spécialistes financés garantit d'être faible partout et fort nulle part. Sans tête de pont, le gouffre (chasm) n'est pas franchissable : pas de référence client crédible à montrer au segment suivant, pas de bouche-à-oreille concentré, pas de flywheel.
- **[ÉLEVÉ]** Le seul wedge défendable (OS opérationnel du club FR de ville moyenne + co-soirée club↔BDE contractualisée via event_collab_contracts) est déjà à moitié construit, mais enterré sous 2 piliers perdants et 4 rôles superflus. Personne n'a encore prouvé la liquidité dans un seul club réel.
  - *Pourquoi :* Le partage de revenus contractualisé club↔asso étudiante sur co-soirée récurrente est le SEUL morceau que Shotgun/Fever/Xceed ne font pas nativement, et il est culturellement ancré FR (le BDE n'existe pas chez les rivaux ES/UK/US). C'est l'unique angle où l'orga apporte la liquidité gratuitement par son audience. Le gâcher en le noyant dans le scope est l'erreur stratégique la plus coûteuse du dossier.
- **[MOYEN]** Le SEUL actif défendable dans tout le code construit est le wedge co-soirée club↔organisateur/BDE : event_collab_contracts + contrat-cadre récurrent + partage de revenus contractualisé signé eIDAS. C'est la seule chose que Shotgun/Fever/Xceed ne font PAS nativement, le seul JTBD réel mal servi (substitut actuel = WhatsApp + Excel), et il est culturellement ancré en France (BDE).
  - *Pourquoi :* C'est une bonne nouvelle déguisée en mauvaise : 95% du produit construit est de l'océan rouge ininvestissable, mais 5% est un Blue Ocean crédible déjà codé. Le chemin finançable est de TUER le pilier boisson, abandonner 4 des 6 rôles, et tout miser sur ce wedge dans 3-5 clubs FR réels pour prouver la liquidité. La difficulté n'est pas technique — elle est psychologique : accepter de jeter 90% de ce qui a été construit avec talent.
- **[MOYEN]** Potentiel de licorne très faible en trajectoire actuelle. L'issue honnête la plus probable est un acqui-hire / acquisition stratégique (5–30 M€) par Shotgun/Weezevent/un POS européen, pas une licorne.
  - *Pourquoi :* Le wedge BDE défendable a un TAM intrinsèquement petit (peu de villes à vraie densité BDE+clubbing). Même Fever a mis 10 ans et 527 M$ pour ~2 Md$. Excellent candidat acqui-hire pour un founder solo, mauvais candidat rendement de fonds Sequoia.
- **[MOYEN]** Le seul actif marketplace réel et défendable est enterré sous le reste : le wedge co-soirée club↔BDE avec partage de revenus contractualisé (event_collab_contracts, 11 migrations, contrat-cadre récurrent, payout auto, eIDAS). C'est le seul graphe où plus de nœuds = plus de valeur, le seul JTBD aigu et mal servi, et le seul nœud (le BDE bi-face) qui effondre le double cold start en cold start simple.
  - *Pourquoi :* Aucun incumbent (Shotgun, Fever, Xceed) n'exécute le partage d'argent automatique entre deux entités juridiques sur une co-soirée récurrente. Le BDE est à la fois l'offre ET un canal de demande captif (500-3000 étudiants activables gratuitement). C'est la seule stratégie de lancement finançable. Mais : zéro validation que les BDE paieront/convertiront — risque de demande non prouvé.
- **[MOYEN]** Interdiction absolue de paid acquisition (Insta/TikTok ads) avant PMF. Le CAC d'install affiché (~3-8€) est un mirage : pour le nightlife, le CAC d'un utilisateur qui achète réellement via ads froides est plutôt 30-50€+, et il n'existe aucune donnée de LTV pour savoir si c'est récupéré. Brûler du budget ads = acheter de la vanité (compteur d'installs) au prix du runway.
  - *Pourquoi :* Le paid acquisition pré-PMF est le moyen le plus rapide de cramer du cash sans apprendre. Tant que le BDE (CAC ~0, déjà codé) n'est pas saturé localement et qu'aucun BDE ne revient spontanément, chaque euro de paid est gaspillé sur un produit non validé.
- **[MOYEN]** Le toggle 'le club absorbe la commission' ne détruit pas le revenu Yuno (l'application_fee reste identique dans les deux modes), MAIS il rend le take rate négociable de facto et révèle que la commission visible est un frein concurrentiel qu'il faut cacher au fan. C'est une rustine défensive contre la transparence hostile du plancher, pas une arme. Un club qui absorbe 4% sur 30k€/mois paie 1 200€/mois de commission en ligne de P&L surveillée.
  - *Pourquoi :* Crée une pression baissière permanente sur le take rate dès le premier gros client, qu'un solo founder sans levier ne pourra pas tenir.
- **[MOYEN]** Le pricing annoncé (49/99/199) n'existe nulle part dans Stripe. Les prix live sont 39/69/99. La grille cible et le toggle d'absorption sont dans des docs et des const non déployés. Le MRR cible est littéralement non encaissable aujourd'hui. Pré-revenu, c'est réglable en 2h, mais ça prouve que le modèle vit dans des tableurs, pas en production.
  - *Pourquoi :* Écart entre business model écrit et business model opérationnel. Symptôme du pattern 'construire avant déployer/valider' qui infecte tout le projet.
- **[MOYEN]** Bus factor = 1. Tout (119 pages, 94 fonctions, le système de paiement, la conformité alcool/mineurs, 495 migrations) repose sur une seule personne, sans revue de pair sur les chemins d'argent.
  - *Pourquoi :* Pour une fintech-adjacente, c'est un risque de continuité d'exploitation, pas un détail RH. Un incident Stripe un samedi soir, une mise en demeure CNIL, ou simplement Paul indisponible = personne pour répondre sur un système qui déplace de l'argent réel. La vélocité IA est réelle mais ne couvre pas le risque humain.
- **[MOYEN]** Le seul wedge réellement défendable et différenciant est étroit : le bottle service digitalisé (VipServiceTimer/MinimumSpendBar) + le contrat de co-soirée récurrent club↔BDE. C'est aussi ce que le code fait de mieux. Tout le reste (boissons, festival, resto festif, touriste) est un océan rouge déjà consolidé.
  - *Pourquoi :* Le fondateur a construit son meilleur actif (VIP + co-soirée BDE) en le noyant sous 6 piliers/rôles génériques perdants. Le risque n'est pas l'incapacité à construire mais le mauvais focus : il faut tuer 4 piliers et tout miser sur VIP + BDE en France, sinon Xceed (même périmètre, 25M users) écrase et Fever ignore.
- **[MOYEN]** Partiful est listé par le fondateur comme concurrent : c'est une erreur d'analyse de marché. Partiful est du consumer social (invitations entre amis, 500k MAU), pas du B2B nightlife. L'inclure révèle une cartographie concurrentielle imprécise.
  - *Pourquoi :* Confondre un acteur consumer social avec un concurrent B2B nightlife signale que la veille concurrentielle du fondateur n'a pas distingué les vraies menaces (Xceed, Shotgun, Fever) des distractions. Une mauvaise carte de la concurrence = de mauvaises décisions de positionnement et de produit.
- **[FAIBLE]** Chemin précis NON→OUI clair et atteignable : Bloc A compliance bloquant + Bloc B preuve de wedge (tuer 2 piliers + 4 rôles, 1 ville, 3-5 BDE, 3 mois de rétention récurrente) + Bloc C dé-risquage bus factor (co-founder/advisor).
  - *Pourquoi :* C'est le point d'espoir : la qualité d'exécution est rare et le déclencheur du OUI (liquidité récurrente prouvée sur une atomic network d'une ville + compliance bouclée) est réalisable en 8-12 semaines si le founder accepte de geler 90 % du scope. Le NON est un NON de séquencement, pas de mépris.
- **[FAIBLE]** Crédit rare à inscrire : aucune IA-gadget. Pas de LLM saupoudré dans le produit pour cocher la case du pitch deck. Une seule edge function 'recommandation' à base de règles, pas de modèle. Et la stack (Stripe Connect direct-charge, vite.config, code-splitting) est plus mature que 90% des pré-seed.
  - *Pourquoi :* C'est un signal positif sur la maturité du founder : il construit ce qui sert, pas ce qui brille. Le risque inverse existe (continuer à raffiner techniquement au lieu d'aller chercher un client), mais sur l'axe 'honnêteté technique', Yuno est nettement au-dessus de la moyenne. À préserver : ne pas céder à la tentation d'ajouter un LLM pour la levée.
