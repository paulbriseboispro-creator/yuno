# Yuno CRM — « Qui cibler » devient une campagne de soirée prête à partir

Demande de Paul (03/11) : dans « Qui cibler », le pro accepte 1, 2 ou 3 des
envois proposés ; Yuno prépare tout (dates, audiences, brouillons reliés à la
soirée, relances), protège contre le spam et contre la pub faite à quelqu'un
qui a déjà sa place, puis suit la campagne dans un centre de suivi. Le pro n'a
plus qu'à retoucher le design s'il en a envie.

Statut : **conception, rien d'écrit dans le code.** D1, D2, D4 tranchées le 03/11 ; le nom de D3 reste à confirmer (§ 7).

---

## 1. Ce qui existe déjà (lu dans le code le 03/11)

| Brique | Où | Ce qu'elle fait | Ce qui manque pour l'idée |
|---|---|---|---|
| Audiences « Qui cibler » | `crm_night_targets` (`20261014130000`) | 7 audiences sans place, ordre d'envoi, recouvrement, `moment` + `send_at` | Le moment est FIXE par audience (voir § 2, bug) |
| Plan de soirée | `crm_night_plan` (`20261107130000`), page `/crm/nights/:id/plan` | Regroupe par moment, chaque personne une fois, coût en Yunits, liste ce qui est déjà prévu | Lecture seule ; ne crée rien ; « déjà prévu » n'est relié à aucune étape |
| Filtre `ntgt {e, a}` | `_crm_filter_sql` → `_crm_night_target_set` | Écarte les détenteurs d'un billet valide **au moment où on l'évalue** | — |
| Campagne programmée | cron `scheduled-email-campaigns` → `send-campaign` → `enqueue_campaign_recipients` | L'audience est recalculée **à l'heure d'envoi** : qui a acheté depuis sort | Pas de règle « entre campagnes d'un même plan » ; aucune revérif billet à la sortie de file |
| Exclusions | `exclusions_json` : `recentDays`, `excludeEventBuyers` | Pas deux e-mails en N jours ; détenteurs écartés | `recentDays` compte TOUTES les campagnes CRM, pas le plan |
| Témoin 10 % | `_crm_holdout_pick(campaign_id, …)` | Tiré par campagne | Tiré par campagne ⇒ une personne témoin à l'étape 1 est contactée à l'étape 2 : la mesure est polluée |
| Pression | `email_send_policy` palier `campaign` 3/24 h · 8/7 j | Filet plateforme | Trop large pour un plan coordonné (3 e-mails du même club le même après-midi passent) |
| Relances | recettes `click_no_buy` (6-48 h après un clic vers la page Shotgun, sans achat) et `last_call` | Écartent les détenteurs, une soirée = un message | Recettes de COMPTE, pas de soirée ; `last_call` peut doubler l'étape « veille » d'un plan |
| Scénarios | `manual_segment` + filtre d'entrée `ntgt`, objectif, attentes, 20 h entre étapes | Moteur complet | `event_id` de la course vide sous `manual_segment` (pas d'objectif `bought_event`), modèle copié une fois, base « Vos clients » non lue, **bug probable : au-delà de 3 000 entrées, le reste est perdu** (`manual_done` posé avant le plafond) |
| Base « Vos clients » | `email_cust`, `_crm_customer_auto` | Ouvre « Pas de mention » aux campagnes MANUELLES signées | Les moteurs automatiques (scénarios, recettes) restent à l'accord seul |

### Panier abandonné : impossible avec Shotgun, et ce qui le remplace

Shotgun ne rapporte pas le passage au paiement (`docs/designs/SHOTGUN_API_REFERENCE.md`,
section « Bientôt »). Un panier abandonné serait donc un chiffre inventé. Le signal le plus
proche que Yuno mesure vraiment : **le clic nominatif d'un e-mail du plan vers la page Shotgun
de la soirée, sans achat ensuite** (recette `click_no_buy`). C'est la relance proposée.

## 2. Le bug vu sur vos captures (à corriger d'abord)

Soirée demain 20 h. « Qui cibler » affiche :

- 1er envoi « Achètent tôt » : maintenant
- 2e envoi « Venus une fois, habitent près » : « la semaine d'avant, 3 nov. 14:36 »
- 3e envoi « Dernière minute » : « la veille, 3 nov. 18:00 »

Cause (`crm_night_targets`, l. 63-66 et 142) : `week = GREATEST(now(), J-7 à 18 h)`. Quand J-7
est passé, la date retombe sur `now()` mais le libellé reste « la semaine d'avant ». Les trois
envois tombent donc dans le même après-midi, ce qui est exactement le spam qu'on veut éviter.

Correction (lot 0) : un calendrier qui dépend des jours restants (§ 3.2), et un libellé qui dit
la vraie date. Si deux moments se rejoignent, ils fusionnent en un seul envoi.

## 3. La conception

### 3.1 Le parcours du pro

1. **« Qui cibler »** : chaque carte porte une case « Garder » (cochée d'office). En bas, une
   barre fixe : « 3 envois · 912 personnes joignables · 1 040 Yunits » et le bouton
   **« Préparer ces envois »**.
2. **Fenêtre « Votre campagne pour <soirée> »**, en un seul écran :
   - la **frise** : chaque envoi à sa date et son heure, son audience, son nombre de
     joignables, l'angle, le modèle choisi (vignette) ;
   - les **relances** (§ 3.5), cochées d'office ;
   - les **protections** écrites en clair (§ 3.4) ;
   - le **coût** en Yunits et le solde après ;
   - ce qui bloque, s'il y en a : identité d'expéditeur incomplète (lien vers Réglages ›
     Envoi), solde trop court, aucun joignable ;
   - le bouton **« Lancer la campagne »**.
3. Yuno crée **un e-mail par envoi**, déjà relié à la soirée (blocs live : affiche, tarifs,
   line-up, compte à rebours), avec son objet et son texte selon l'angle, puis le
   **programme**. Le premier départ n'a jamais lieu moins de 2 h après le lancement : le pro
   a le temps de relire (décision D1).
4. Le pro arrive sur le **centre de suivi** (§ 3.6). Chaque envoi s'ouvre dans le Studio
   comme n'importe quel e-mail : il retouche le design, l'objet, le texte, ou décale l'heure.
   Il ne retouche pas l'audience (les protections en dépendent) ; « Détacher du plan » en
   fait un e-mail ordinaire s'il le veut vraiment.

Aucune IA chez Yuno : les brouillons sortent des modèles du CRM (`buildCrmTemplate`). Le
bouton « Préparer avec mon IA » reste là pour qui veut que son IA redessine les brouillons
(outils MCP existants, `update_email_draft`).

### 3.2 Le calendrier, calculé par le serveur

Chaque audience a un rôle : **ouverture** (Achètent tôt, Concept, Line-up, Chances de venir),
**milieu** (Genre, Venus une fois) ou **dernière ligne droite** (Dernière minute). Les dates
dépendent des jours restants J :

| Jours restants | Ouverture | Milieu | Dernière ligne droite |
|---|---|---|---|
| J ≥ 10 | au lancement (+2 h) | J-7, 18 h | J-1, 18 h |
| 4 ≤ J < 10 | au lancement (+2 h) | à mi-chemin, 18 h, s'il reste 36 h de chaque côté | J-1, 18 h |
| 2 ≤ J < 4 | au lancement (+2 h) | fusionné avec l'ouverture | J-1, 18 h |
| J = 1 | au lancement (+2 h) | fusionné avec l'ouverture | jour J 14 h, si c'est à 20 h au moins et 2 h avant le début |
| J = 0 | un seul envoi, au lancement | — | fusionnée |

**Lot 0 fait le 03/11** (migration `20261121100000_crm_night_targets_schedule.sql`, répétée
sur la prod en transaction annulée, smoke `scripts/crm-bench/smoke/night-schedule.sql`) : la
veille passe au jour même 14 h quand elle est à moins de 20 h ; le milieu est J-7 dès 10 jours,
sinon à mi-chemin, gardé seulement à 36 h de maintenant et de la dernière étape ; un moment qui
ne tient pas devient « maintenant ». Le « +2 h » de l'ouverture viendra avec le lancement (lot 2).

Règles fixes : deux envois du plan sont toujours à **36 h au moins** l'un de l'autre (20 h pour
la dernière ligne droite), rien après « 2 h avant l'ouverture des portes », heures calmes du
compte respectées. L'heure 18 h est remplacée par la meilleure heure d'ouverture du compte dès
30 ouvertures mesurées (même seuil que `get_email_send_time_insights`).

Une personne n'est comptée que dans son audience la mieux classée (règle actuelle du plan).

### 3.3 Les brouillons

| Audience | Modèle CRM | Objet par défaut (exemple FR) |
|---|---|---|
| Achètent tôt | `annonce` | « {{soirée}} : le premier tarif part vite » |
| Concept, Line-up | `lineup` | « {{artiste}} à {{soirée}} » |
| Genre | `annonce` | « Une soirée {{genre}} chez {{club}} » |
| Venus une fois, habitent près | `retour` | « On vous revoit à {{soirée}} ? » |
| Dernière minute | `lastcall` | « Ce soir : les dernières places de {{soirée}} » |
| Chances de venir | `annonce` | — |

Les textes vouvoient (règle CRM), ne prêtent aucun motif à la personne (« vous êtes venu une
fois », jamais « vous avez adoré »), et ne promettent jamais de place réservée.

### 3.4 Les protections (anti-spam et « il a déjà son billet »)

Appliquées **par la base**, à chaque mise en file, pour toute campagne qui porte
`night_plan_id`. Rien ne dépend de l'écran.

1. **Déjà une place pour la soirée = jamais d'e-mail du plan.** Revérifié à la mise en file
   (audience `ntgt` + `excludeEventBuyers` forcé) ET, nouveau, à la sortie de file
   (`claim_campaign_recipients` : un billet acheté entre-temps passe en `skipped`,
   `policy:holder_after_queue`, Yunit rendu). La synchro Shotgun passe toutes les 5 à 15 min :
   l'écran le dit (« un achat des dernières minutes peut ne pas encore être vu »).
2. **Au plus 2 e-mails du plan par personne** si la soirée est à moins de 7 jours, 3 sinon
   (décision D2). Raison écrite : `policy:plan_cap`.
3. **36 h entre deux e-mails du plan** pour une même personne (20 h pour la dernière ligne
   droite). Raison : `policy:plan_spacing`.
4. **Les règles Yuno restent au-dessus** : 3/24 h, 8/7 j, fatigue (8 envois sans ouverture),
   désabonnés, liste de suppression, identité de l'expéditeur, gel d'envoi.
5. **Un seul témoin pour tout le plan** : `_crm_holdout_pick('plan:' || plan_id, email)`. Une
   personne témoin ne reçoit AUCUN e-mail du plan, relances comprises. C'est ce qui permet de
   dire « le plan a fait N ventes de plus », pas seulement « l'e-mail 2 a fait N clics ».
6. **Arrêt automatique** : soirée annulée, terminée, ou complète chez Shotgun (tous les tarifs
   épuisés) ⇒ les envois restants passent en pause, le pro est prévenu.
7. **La recette « Dernier appel » s'efface** sur une soirée dont le plan a une dernière ligne
   droite (sinon deux e-mails la veille).

### 3.5 Les relances

- **« A cliqué sans acheter »** (cochée d'office) : 6 à 48 h après un clic vers la page Shotgun
  depuis un e-mail du plan, sans achat. Palier urgent (2/24 h) mais soumise aux règles 2 et 3
  du plan, jamais dans les 2 h avant la soirée. C'est la recette existante `click_no_buy`. Elle
  vaut pour TOUTES les soirées du compte une fois allumée (décision D4).
- **SMS de la dernière ligne droite** : proposé seulement si le compte a l'accès SMS et
  l'identité d'annonceur, aux numéros consentis, 35 Yunits par SMS.
- **Pas de « panier abandonné »** : Shotgun ne le rapporte pas (§ 1).

### 3.6 Le centre de suivi

**Une entrée à part sous Campagnes, en premier : « Plans de soirée »** (`/crm/plans`, nom à
confirmer par Paul). Campagnes devient : Plans de soirée · E-mails · SMS · Automatisations ·
Instagram.

Pourquoi pas ailleurs :
- **Pas dans le tiroir de la soirée seul** : trop caché (remarque de Paul), et on ne voit pas
  d'un coup d'œil toutes les soirées en cours.
- **Pas dans E-mails** : un plan mêle e-mails, SMS et relances.
- **Pas dans Automatisations** : une automatisation est une règle qui vaut pour toutes les
  soirées et ne s'arrête jamais ; un plan sert UNE soirée et se termine avec elle. Les mettre
  ensemble mélange deux idées que le pro doit distinguer.

La page liste :
1. **En cours** : une carte par soirée qui a un plan (date, prochain envoi, acheteurs après un
   e-mail du plan, contre le témoin).
2. **À préparer** : les soirées à venir sans plan, avec le nombre de personnes joignables et
   le bouton « Préparer un plan » (qui ouvre la fenêtre de lancement du § 3.1).
3. **Terminés** : les plans des soirées passées et leur bilan.

`/crm/plans/:soirée` = le suivi d'un plan (remplace l'actuelle page `/crm/nights/:id/plan`,
qui y redirige). Le menu reste à six entrées de premier niveau.

Les autres chemins y mènent tous : dans le tiroir de la soirée, « Qui cibler » affiche
« Plan lancé · Ouvrir le suivi » en tête ; la carte de la soirée porte la pastille « Plan en
cours » ; l'Accueil montre le prochain envoi ; la notification « part dans 2 h » ouvre le suivi ;
dans Campagnes › E-mails, chaque e-mail du plan porte « Plan · <soirée> » et y renvoie.

Contenu du suivi d'un plan, dans cet ordre :

1. **Une phrase** : « 2 envois partis, 1 programmé demain 18 h. 14 acheteurs après un e-mail
   du plan, 9 de plus que le témoin. »
2. **La frise** : chaque envoi avec son état (programmé, en cours, parti, en pause),
   « Modifier », « Décaler », « Retirer ».
3. **Par envoi** : visés, partis, protégés (avec la raison : déjà une place, déjà reçu un
   e-mail du plan, règles Yuno, témoin), ouverts, cliqués, acheteurs (un clic dans les 7 jours
   avant l'achat, `_crm_email_attrib`), CA si la personne voit l'argent.
4. **Les relances** : combien sont parties, combien ont acheté.
5. **Contre le témoin** : verdict `holdoutVerdict` (seulement si |z| ≥ 2 et 10 personnes par
   groupe).
6. **La courbe des ventes** de la soirée avec un repère à chaque envoi.
7. **Actions** : mettre en pause, reprendre, arrêter la campagne.

Notifications : « Votre e-mail part dans 2 h » (une par envoi) et le bilan le lendemain de la
soirée. Accueil : tâche « Votre campagne pour <soirée> part demain 18 h ».

## 4. Pourquoi des campagnes programmées, et pas un Scénario

| | Campagnes programmées reliées par un plan | Scénario `manual_segment` |
|---|---|---|
| Le pro retouche le design | Oui, dans le Studio, jusqu'au départ | Modèle copié une fois, retouches tardives perdues |
| Visible dans Campagnes | Oui | Non (campagnes enfants cachées) |
| Base « Vos clients » (Pas de mention) | Oui, ce sont des campagnes manuelles signées | Non, accord seul |
| Billet pour la soirée | Revérifié à chaque envoi | Objectif `bought_event` impossible (pas de soirée sur la course) |
| Plus de 3 000 personnes | Pas de plafond | Bug probable, le reste est perdu |
| À construire | Une table, une colonne, une garde | Lier une soirée à `manual_segment`, corriger le plafond |

Le point décisif est la base « Vos clients ». Sur WOH, « Qui cibler » compte 141 personnes
joignables par e-mail à l'accord pour cette soirée ; une fois la signature posée, les clients
« Pas de mention » s'y ajoutent, mais seulement dans une campagne manuelle.

## 5. Ce qu'il faut construire

**Base** (une migration, répétée en prod annulée avant application) :
- `crm_night_plans` : id, portée, `event_id`, statut (`active`, `paused`, `done`, `stopped`),
  `accepted_by`, `accepted_at`, `config` (envois choisis, relances, plafond, espacement). Un
  seul plan vivant par (portée, soirée). RLS sans policy, tout par RPC, REVOKE / GRANT
  explicites.
- `email_campaigns.night_plan_id`, `night_plan_step` (et pareil sur `sms_campaigns`).
- `crm_night_plan_schedule(scope, event, steps[])` : le calendrier du § 3.2, une seule source
  lue par « Qui cibler », le plan et la fenêtre de lancement.
- `crm_night_plan_launch(scope, event, steps jsonb, relances jsonb)` : crée le plan et ses
  campagnes (contenus fournis par le front, comme `createDraftFromTemplate`), programme,
  refuse sans identité d'expéditeur, sans solde, en accès assisté, pour un lecteur.
- Garde dans `_enqueue_campaign_recipients_core` (règles 1, 2, 3, 5 du § 3.4) et revérif
  billet dans `claim_campaign_recipients`. Patch ciblé par `pg_get_functiondef` + remplacement
  (jamais recopier ces fonctions).
- `crm_night_plan_set_status`, arrêt automatique dans `ticketing_after_sync` (soirée complète,
  annulée) et au balayage horaire.
- `last_call` : saute une soirée couverte par un plan vivant avec dernière ligne droite.
- `crm_night_plan_report(scope, plan)` pour le suivi.
- Correction du calendrier dans `crm_night_targets` et `crm_night_plan` (lot 0).

**Front** : cases et barre dans `NightTargets.tsx`, fenêtre de lancement, page « Plans de soirée » et suivi d'un plan,
(le suivi reprend `NightPlanReport`), renvois depuis la soirée et Campagnes › E-mails, notifications, tâche de
l'Accueil. Textes `yc.ncp.*` ×3.

**Aide** : FAQ `yc.faq.nightCampaign`, article assistant `crm-night-campaign` (redéployer
`owner-assistant`), outil MCP `get_night_plan` qui rend l'état de la campagne.

**Banc** : `scripts/crm-bench/` (PGlite) : calendrier pour J = 1, 3, 6, 15 ; protections sur
une personne présente dans les trois audiences ; billet acheté entre deux envois ; témoin
commun ; soirée qui devient complète ; 12 000 contacts (temps de mise en file sous 3 s).

## 6. Les lots

| Lot | Contenu | Dépend de |
|---|---|---|
| 0 | Calendrier corrigé dans « Qui cibler » et le Plan de soirée (bug § 2) | rien |
| 1 | Base : table, colonnes, gardes, lancement, statut, arrêt auto, rapport | lot 0 |
| 2 | Front : cases, fenêtre de lancement, création des brouillons | lot 1 |
| 3 | Suivi : page « Plans de soirée », suivi d'un plan, renvois, notifications, Accueil | lot 1, nom D3 |
| 4 | Relances : lien `click_no_buy`, `last_call` qui s'efface, SMS de fin | lot 1, D4 |
| 5 | Aide, assistant, MCP, démo semée | lots 2-4 |

Les lots 2, 3 et 4 peuvent tourner dans des sessions séparées une fois le lot 1 en base : ils
ne touchent pas les mêmes fichiers.

À part, signalé pendant l'analyse : le plafond de 3 000 entrées des Scénarios `manual_segment`
pose `manual_done` avant de couper, et le reste de l'audience n'entre jamais. À vérifier sur le
banc et à corriger séparément.

## 7. Décisions de Paul (03/11)

- **D1. Lancer = programmer** (validé). Les e-mails partent seuls aux dates prévues, premier
  départ au plus tôt 2 h après le lancement, rappel 2 h avant chaque départ, pause à tout
  moment.
- **D2. Plafond par personne** (validé) : 2 e-mails du plan si la soirée est à moins de
  7 jours, 3 sinon ; 36 h entre deux (20 h pour la veille).
- **D3. Le suivi** : Paul trouve le tiroir trop caché. Proposition retenue en § 3.6 : une
  entrée « Plans de soirée » en tête de Campagnes. **Le nom reste à confirmer.**
- **D4. La relance « A cliqué sans acheter »** (validé) : s'allume pour tout le compte, et
  l'écran le dit avant de l'allumer.
