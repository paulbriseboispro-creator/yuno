# Yuno CRM — premier vrai compte Shotgun (WOH) testé dans l'espace Amoris : diagnostic et plan

> Diagnostic du 2026-10-17, ~18 h (Paris), quatre heures après la connexion.
> Mesuré sur la prod, **en lecture seule** : requêtes SQL directes, et les RPC
> de la Console jouées **en tant que le titulaire du compte** (rôle
> `authenticated`, jeton du compte, transaction annulée). Rien n'a été écrit.
> Compte : organisation **Amoris** (`06ce47f8-…`, produit `suite` + CRM ajouté).
> Billetterie connectée : le compte Shotgun de **WOH** (Shotgun l'affiche
> « Club Sonore », id `179715`). **Choix de Paul (17/10) : Yuno CRM se teste
> dans l'espace Amoris avec le Shotgun de WOH, et la connexion reste là.** On ne
> la déconnecte pas, on ne la purge pas, on ne la déménage pas.
> Prochaine soirée Shotgun : « CLUB SONORE X EXCLUSIVE X WOH & FRIENDS X
> NONSENSE PARIS », jeudi 29/10 19 h (Paris). Prochaine soirée Yuno d'Amoris :
> « House Of Masquerade », Ségovie, nuit du 28 au 29/10.

---

## 1. Verdict en dix lignes

1. **La connexion est saine.** Import complet en 10 min 48 s (15 passes),
   281 soirées depuis 09/2022, 48 388 billets, zéro doublon, zéro billet
   orphelin, prix exacts au centime, synchro horaire sans erreur depuis.
2. **Les scans de la porte remonteront** : un scan Shotgun avance bien le
   curseur de synchro (vérifié sur les 12 563 billets scannés).
3. **L'essai CRM d'Amoris finit lundi 19/10 à 10 h 14 (Paris).** Ensuite les
   campagnes et automatisations CRM sont refusées (`crm_paused`) et les 5 000
   Yunits d'essai expirent. Pour tester l'envoi : **« Offrir Yuno CRM » à Amoris
   dans `/admin/organizers`** (geste de Paul).
4. **On ne peut écrire qu'à 299 personnes sur 18 058 (1,7 %).** Shotgun n'a
   jamais posé la question newsletter à 85 % des acheteurs.
5. **Les 299 accords sont bien ceux de WOH**, y compris les 202 personnes qui
   n'ont acheté que sur des soirées co-organisées (vérifié le 17/10, §5.1).
   C'est la base joignable du test.
6. **L'expéditeur par défaut serait « Amoris » (Madrid)** alors que ces
   personnes ont dit oui à WOH. Avant un vrai envoi, mettre « WOH » comme nom
   d'expéditeur et une adresse postale dans Réglages › Envoi (session S3).
7. **Quatre chiffres sont faux ou trompeurs** : l'Allemagne devient « DD »,
   6 702 ventes venues d'Instagram/Facebook sont classées « Autre site », la
   règle « porte mesurée si ≥ 50 % scannés » éteint 236 soirées sur 269 alors
   que le scanner Shotgun a servi sur 127, et « 756 billets vendus » veut dire
   52 payants + 704 entrées gratuites.
8. **Vitesse : 20 écrans sur 22 sous 4 s.** Seul Analyses › Ventes (90 j)
   dépasse : 6,4 s à chaud, **8,8 s à froid, au-delà du délai de 8 s** de l'API.
9. **L'intelligence tourne déjà** : 16 952 profils, 23 familles d'hypothèses
   calculées (artistes, groupes, jour, créneau très marqués) ; elles passent
   « confirmées » après le calcul de cette nuit, le score « Chances de venir »
   de la soirée du 29/10 aussi.
10. **SMS : Octopush ne débloquera rien seul.** 81 % des acheteurs ont un
    numéro, mais aucun n'a donné d'accord SMS. Il faut d'abord ouvrir le
    recueil du numéro sur les pages d'inscription.

---

## 2. Ce qui est en place et vérifié

| Point | Mesuré | Verdict |
|---|---|---|
| Import initial | 14:26 → 14:36 UTC, 15 passes de ~45 s, 48 384 billets, 281 soirées | ✅ |
| Synchro continue | passes cron à 15:40 et 16:45 UTC, `fail_count = 0`, aucune erreur | ✅ (mais 60 min, voir §4.6) |
| Intégrité | 0 doublon (`connection_id, external_id`), 0 billet sans soirée, 0 soirée non reliée | ✅ |
| Prix | `price = deal_price / 100` sur 48 388 billets (0 écart) ; 134 152 € de billets payants valides | ✅ |
| Statuts | 45 589 valides, 1 361 revendus, 1 209 remboursés (tous datés), 229 annulés | ✅ |
| Devise | 100 % EUR | ✅ |
| Scans et remboursements → curseur | `ticket_updated_at ≥ ticket_scanned_at` sur 12 563 / 12 563 ; idem pour les 1 438 annulations | ✅ la nuit du 29/10 remontera |
| Soirées miroirs | 281 créées, 0 active ou publique | ✅ invisibles du public |
| Jeton Shotgun | Vault, seul l'indice `DPNk` est lisible | ✅ |
| Tables Shotgun | RLS active, aucune policy, aucun droit `anon` / `authenticated` | ✅ |
| Déconnexion | `ticketing_disconnect` efface le jeton et GARDE les données ; seule la purge supprime | ✅ |
| Consentement | dernier signal de chaque adresse, jamais un désabonné, jamais une adresse supprimée | ✅ (règle de rôle à revoir, §5.1) |
| Conditions CRM + DPA | acceptées par le titulaire le 17/10 14:25 UTC | ✅ |
| Migrations | prod = dépôt depuis le 15/10 (27 migrations) | ✅ |
| Fonctions edge | `affiliate-ticket-sync` v20, `send-campaign` v110 = dernier code du connecteur et de l'envoi | ✅ |
| `utm_source` libre gardé par Shotgun | valeurs « lumea-community », « ig », « newsletter » présentes | ✅ **les liens `/go/` marcheront** (hypothèse du 05/10 prouvée) |

Richesse des données (billets) : téléphone 80,7 %, année de naissance 78,3 %,
genre 88,3 %, ville 94,6 %, code postal 94,3 %, artistes sur 141 soirées,
genres sur 163, commandes à plusieurs billets 11 094.

---

## 3. Ce qui bloque avant la soirée (P0)

| # | Problème | Effet | Qui | Quand |
|---|---|---|---|---|
| P0-1 | Essai CRM d'Amoris fini le **19/10 08:14 UTC** | campagnes et automatisations CRM refusées, Yunits d'essai perdus ; lecture et synchro continuent | **Paul** : `/admin/organizers` → Amoris → « Offrir Yuno CRM » | avant lundi 10 h |
| P0-2 | Expéditeur « Amoris », aucun réglage d'envoi (`crm_email_settings` vide, pas d'adresse postale) | les destinataires ont dit oui à WOH | Paul règle Réglages › Envoi ; S3 rend ces champs obligatoires | avant le 1er vrai envoi |

---

## 4. Les données : ce qui est faux, et pourquoi

### 4.1 Pays : l'Allemagne devient « DD »
`countryCodeFrom` (`_shared/ticketing-shotgun.ts`) construit l'index nom → code
en parcourant AA…ZZ avec `Intl.DisplayNames` ; `DD` (code retiré de la RDA)
s'affiche « Germany » et passe avant `DE`. Résultat : **293 billets en « DD »**.
Et les anciens noms anglais ne sont pas reconnus : Turkey (21), Czech Republic
(10), Republic Of Moldova (4) → `null`. Même piège possible pour `YD`, `BU`…
**Correctif** : ignorer les codes retirés (liste explicite), ajouter les noms
historiques, test sur les 64 noms vus, puis rattrapage SQL des billets déjà en base.

### 4.2 Sources : Instagram classé « Autre site »
`_crm_ticket_source` reconnaît `instagram`, `ig`, `facebook`… mais pas les
**domaines référents** que Shotgun écrit dans `utm_source` : `instagram.com`
(6 273 billets), `l.instagram.com`, `facebook.com`, `m.` / `l.facebook.com`,
`snapchat.com`. **6 702 billets valides (15 %) tombent dans « Autre site ».**
Deux familles manquent aussi :
- **e-mail d'un autre outil** : 418 billets viennent de liens Brevo
  (`*.r.ag.d.sendibm3.com`, `sp1-brevo.net`), plus `shotgun-email` (101),
  `outlook.live.com`… ;
- **recherche et IA** : Google (~174), ChatGPT (68).

**Correctif** : normaliser le domaine (retirer `www.`, `l.`, `m.`, `lm.`,
schéma), nouvelles familles `ex` (e-mail externe) et `se` (recherche / IA),
miroir exact `sourceKind` (`src/crm/lib/links.ts`), `SOURCE_KEYS`, listes de
`crm_ana_traffic__core`, tests.

### 4.3 La règle de la porte éteint 88 % des soirées
`_crm_event_scan_known` = « au moins la moitié des billets valides scannés ».
Sur ce compte, **79 % des billets valides sont gratuits** (« FREE ENTRY BEFORE
00:00 ») et les trois quarts des gratuits ne viennent pas. Mesuré :

| Soirées passées avec billets | 269 |
|---|---|
| aucun scan (autre prestataire ou pas de scan) | 142 |
| scanner Shotgun utilisé (≥ 10 scans) | 120 |
| dont ≥ 10 % des billets scannés | 120 (4 autres ont ≥ 10 % mais moins de 10 scans : petites soirées) |
| « mesurées » avec la règle actuelle (≥ 50 %) | **33** |
| taux de scan quand le scanner sert : billets payants / gratuits | 62,5 % / 24,9 % |

La distribution est bimodale (0 scan, ou ≥ 10 %) : la porte est mesurée dès
que le scanner a servi. **Règle proposée (D3)** : au moins 10 scans ET au moins
10 % des billets valides → 120 soirées mesurées au lieu de 33. Touche : « Venu »,
présence, « Merci d'être venu », « On t'a manqué » (`20261006230000`), analyses
de guest list, `scanKnown` du front (`src/crm/lib/guestlist.ts`).

### 4.4 Billets gratuits comptés comme ventes
`_crm_ticket_is_sale` compte tout billet valide hors invitation et duplicata,
**y compris à 0 €**. Exemple « Osmoz X Revival » : « 756 vendus » = 52 payants
+ 704 gratuits ; la page Guest list affiche 704 « invités ». Sur le compte :
35 904 billets à 0 € pour 9 669 payants. **Proposé (D4)** : partout « Billets
payants » et « Entrées gratuites » côte à côte, la conversion gratuit → payant
mise en avant ; « Guest list » réservé aux invitations (`deal_channel = invitation`).

### 4.5 Trois totaux de personnes
Intégrations : **18 058** acheteurs (adresses distinctes, tous statuts) ;
Accueil : **17 367** clients ; Analyse : **16 952** profils (ventes seulement).
Les trois sont justes, mais un pro ne peut pas les réconcilier. Une seule
définition affichée (« clients »), l'écart expliqué une fois (« dont 691
seulement remboursés ou annulés »). Et 3 113 billets sans e-mail (vente au
guichet) comptent dans les ventes, jamais dans les personnes : le dire.

### 4.6 Un compte à deux produits n'a pas l'offre du CRM
`crm_sync_scope` et `crm_scope_limits` ne valent que pour un compte CRM **pur**
(`crm_scope_is_crm`). Amoris (Billetterie + CRM) synchronise donc toutes les
**60 min** (défaut de la colonne) au lieu de **15 min**, et la fin d'essai ne
met pas la synchro en pause. Pour la semaine de la soirée, 60 min de retard sur
les ventes, c'est trop. **Correctif** : la cadence suit `crm_scope_has_crm` +
`crm_effective_plan` ; la règle de pause reste celle du compte pur (décision D7).

### 4.7 Petits écarts
- `promoter_sales` (Admin CRM › couverture) compte les billets dont le tarif
  est **visible** des promoteurs (12 078), pas ceux **vendus** par un promoteur :
  libellé à corriger (« tarifs ouverts aux promoteurs »).
- Courbe de l'Accueil : la soirée de comparaison (15/10) a été publiée plus
  tard, d'où une courbe « précédente » à 0 sur J-19…J-12. Pas un bug, mais
  « publiée N jours plus tard » mérite d'être écrit.

---

## 5. Sécurité et confidentialité

### 5.1 Accords pris sur une soirée co-organisée : vérifié, ils sont à WOH
`include_cohosted = true` par défaut. Sur ce compte :

| Rôle du compte Shotgun (WOH) sur la soirée | Soirées | Billets |
|---|---|---|
| `organizer` (sa soirée) | 203 | 15 107 |
| `editor` (co-organisateur) | 53 | 25 317 |
| `viewer` (lecteur) | 25 | 7 964 |

11 333 personnes sur 18 058 n'ont acheté que sur des soirées co-organisées.
Paul a demandé de vérifier dans Shotgun avant de décider (17/10). Résultat :
- **Dans les données de l'API**, `contact_newsletter_optin` appartient au
  CONTACT et non au billet : une seule valeur par `contact_id` sur tous ses
  billets, aucune exception, y compris pour les 1 304 contacts qui ont acheté
  à la fois sur des soirées de WOH et sur des soirées co-organisées. Un
  `contact_id` = une adresse. C'est donc l'état de la personne dans le carnet
  de contacts de WOH (le compte dont on utilise le jeton).
- **L'aide de Shotgun** (« Gérer vos co-organisateurs ») : sur une soirée
  co-organisée, les acheteurs entrent dans les contacts de l'organisateur ET du
  co-organisateur, qu'il soit éditeur ou lecteur, pour faire des segments et
  des campagnes.
- **L'aide de Shotgun** (« Envoyer une newsletter ») : un e-mail promotionnel
  ne part qu'aux contacts qui ont choisi « Rester informé·e de l'activité de cet
  organisateur », en le suivant ou en achetant. Shotgun laisse donc WOH
  écrire lui-même à ces 299 personnes.

**Conclusion : Yuno applique la même règle que Shotgun.** On garde les 299 et
l'import des soirées co-organisées (D2 réglée, rien à changer dans
`ticketing_after_sync`). Seul angle mort : le libellé exact de la case sur une
page de soirée co-organisée n'est pas documenté ; à demander à Shotgun si un
jour un contact le conteste.

### 5.2 Sortie d'une connexion (pour plus tard, pas pour Amoris)
Constaté en passant : « Déconnecter » garde tous les billets, et « Supprimer
les données » laisse les accords créés par la connexion (298 ici), les
hypothèses et les effectifs de segments. Sans effet sur le test d'Amoris (on
ne touche pas à sa connexion) ; à corriger un jour pour les autres clients,
sans jamais rejouer la purge sur Amoris.

### 5.3 Données personnelles en double
`external_tickets.raw` recopie tout le billet Shotgun, coordonnées comprises
(e-mail, téléphone, nom, année de naissance), à côté des colonnes déjà
extraites : **171 Mo pour 56 000 billets (~3 Ko par billet)**, 23 % de la base.
Minimisation (D6) : retirer les `contact_*` de `raw` après extraction, sortir en
colonnes ce que le CRM lit dans `raw` (`deal_channel`, `deal_visibilities`,
`utm_medium`, `payment_method`, `deal_service_fee`, `contact_id`, `user_id`),
garder un échantillon de schéma sur la connexion. Gain : moitié de la taille,
plus de copie des coordonnées, requêtes plus rapides.

### 5.4 À vérifier ou à ranger
- **Effacement chez Shotgun** : si Shotgun anonymise un contact (droit à
  l'oubli), le billet revient sans e-mail ; vérifier que le registre et les
  profils suivent (aujourd'hui non prouvé).
- **Secrets Twilio** toujours posés (4) alors que Twilio est abandonné depuis
  le 05/10 : révoquer chez Twilio puis supprimer les secrets (Paul).
- Secret du cron comparé par `===` (pas en temps constant) : risque faible.
- Fonctions `ticketing_connections_*` exécutables par `anon` : ce sont des
  fonctions de trigger, inappelables directement. Rien à faire.
- Sauvegardes : quotidiennes (offre Pro). Les billets se réimportent ; les
  preuves de consentement et les événements d'e-mail, non. La récupération à
  la minute (PITR) se décidera avec le 2ᵉ ou 3ᵉ client payant.

---

## 6. Vitesse (RPC de la Console, en tant que le titulaire)

| Écran | Temps | |
|---|---|---|
| Coquille, espaces, portefeuille, connexions | 4-31 ms | ✅ |
| Accueil (7 / 30 / 90 j) | 1,2-1,4 s | ✅ |
| Soirées (281) | 0,7 s, **122 Ko** de réponse | ✅ à alléger |
| Détail d'une soirée, plan, cibles, guest list | 0,03-2,6 s | ✅ |
| Analyses › Communauté 12 m | 4,0 s | ⚠️ |
| Analyses › Trafic 90 j | 2,9 s | ✅ |
| **Analyses › Ventes 90 j** | **8,8 s à froid / 6,4 s à chaud** | ❌ au-delà de 8 s |
| Analyses › Ventes 30 j / 12 m / une soirée | 3,9 / 3,5 / 3,6 s | ⚠️ |
| Parcours 90 j | 3,4 s | ✅ |
| Clients (vue, liste), Segments, catalogue | 1,9-4,0 s | ✅ |
| Options d'envoi, aperçu d'audience | 2,3 s | ✅ |

Charge de fond : `contact_base_cache_refresh` (toutes les 5 min) = 3 277
appels, 2,1 s en moyenne, **75 s au pire, 1,9 h de base cumulée** : le plus
gros consommateur. Chaque passe du connecteur coûte ~10 s même sans aucun
billet neuf (post-traitement complet) : à 15 min, 16 min de base par jour pour
ce seul compte.

Cible : tout écran < 3 s à froid sur un compte de 50 000 billets.

---

## 7. Intelligence : ce que le compte peut déjà dire, et ce qu'il pourrait dire

**Déjà calculé (14:37 UTC)** : 16 952 profils, retour médian 50 jours,
2 513 personnes revenues au moins une fois, 23 familles testées. Signaux forts
(encore « à confirmer » jusqu'au 2ᵉ calcul de cette nuit, 02:19-04:49 UTC) :
groupe (z 19,5), artiste (z 17,8, gain ×1,58), créneau (z 14,6), jour (z 12,8),
achat en direct « di » (gain ×2). Score « Chances de venir » de la soirée du
29/10 : calcul de 05:27-06:57 UTC demain.

**Possible avec les données Shotgun, pas encore montré** :
1. **Ce que vous touchez** : prix − frais organisateur Shotgun
   (`deal_service_fee`, 8 919 € sur l'historique) − DL prod.
2. **Gratuit → payant** : qui passe d'une entrée gratuite à un billet payant,
   en combien de soirées ; et l'**absence des gratuits** (75 %) par cohorte.
3. **Heure d'arrivée** : `ticket_scanned_at` sur 120 soirées → courbe
   d'arrivée, part des gratuits arrivés après l'heure limite.
4. **Réseau de partenaires** : quelles soirées co-organisées amènent de
   nouveaux clients sur vos propres soirées (rôle de l'événement).
5. **Groupes** : 11 094 commandes à plusieurs billets → taille de groupe,
   « venus à plusieurs reviennent plus ».
6. **Géographie** fine (94 % de codes postaux) et âge (78 %).

**Toujours « Bientôt »** (rien dans l'API, règle de Paul du 05/10) : visites de
la page Shotgun, paniers abandonnés, `utm_campaign`, acheteur ≠ détenteur.

---

## 8. E-mails et SMS : l'état réel

**E-mail** : prêt techniquement (domaine marketing séparé, file, quotas,
disjoncteur, Yunits). Rodage : 300 e-mails le premier jour, suffisant pour 299.
Ce qui manque : l'expéditeur (D1) et la base.

**Faire grandir la base joignable avant le 29/10** (dans l'ordre d'effet) :
1. **Les accords que WOH a déjà ailleurs** : sa liste Brevo (point 2) et,
   s'il le souhaite, un export de ses 14 264 accords Billetterie Yuno, importés
   dans Amoris avec l'attestation de consentement.
2. **Importer la liste Brevo** qui existe déjà (418 billets viennent de ses
   liens) avec l'attestation de consentement.
3. **Page d'inscription `/j/`** pour la soirée, en story et en bio Instagram
   (Instagram a amené 6 702 billets).
4. **Demander l'accord chez Shotgun** : voir dans le Smartboard si la question
   newsletter peut être posée sur la soirée du 29/10 (85 % n'ont jamais eu la
   question). À vérifier, pas affirmé.
5. Plus tard : un e-mail **strictement pratique** aux détenteurs d'un billet
   de la soirée (horaires, accès, sans promotion), qui n'exige pas d'accord
   marketing. N'existe pas dans le CRM ; à construire avec une lecture juridique.

**SMS** : aucun secret Octopush posé (attendu). Mais même branché, **0 personne
joignable** : Shotgun ne rapporte aucun accord SMS, et le recueil du numéro des
pages d'inscription est encore fermé (`CRM_SMS_SIGNUP_LIVE = false`). Ordre :
abonnement Octopush → secrets → `scripts/sms/octopush-setup.mjs` → identité
légale de l'expéditeur → ouvrir le recueil du numéro → premier SMS aux seuls
inscrits.

---

## 9. La structure cible

1. **Une connexion = un responsable de traitement.** L'espace Yuno porte le nom
   et l'identité légale de l'organisation Shotgun connectée ; le DPA est signé
   par elle.
2. **Le rôle de la soirée devient une donnée de premier rang** :
   `organizer` = votre base (consentement, marketing) ; `editor` = analyse,
   jamais de consentement hérité ; `viewer` = hors import par défaut.
3. **Un billet est une ligne propre** : colonnes typées pour tout ce que le CRM
   lit (`deal_channel`, `is_free`, `source_family`, `org_fee`…), `raw` réduit à
   ce qui n'est pas extrait et sans coordonnées. Plus aucun `raw->>` dans une RPC.
4. **Les agrégats par soirée et par jour se tiennent à jour au fil des passes**
   (une table « night_day_stats » écrite par le post-traitement, seulement pour
   les soirées touchées) au lieu d'être recalculés à chaque écran. C'est ce qui
   met Ventes 90 j sous la seconde.
5. **Le post-traitement est incrémental** : une passe sans billet neuf ne
   recalcule rien ; une passe avec 4 billets ne retouche que leurs soirées et
   leurs personnes.
6. **Les règles qui dépendent du compte se mesurent sur le compte** : porte
   mesurée (scanner utilisé), gratuit / payant, seuils — jamais un seuil fixé sur
   la démo.
7. **Une définition par mot**, partout (clients, ventes, venus) — même règle que
   `src/lib/metrics.ts` côté Billetterie.

---

## 10. Décisions à prendre (recommandation en premier)

| # | Question | Recommandation |
|---|---|---|
| D1 | ~~Qui est l'expéditeur ?~~ **Réglé le 17/10** : le Shotgun est celui de WOH, testé dans Amoris où il reste ; nom d'expéditeur « WOH » dans Réglages › Envoi. | — |
| D2 | ~~Un accord pris sur une soirée co-organisée vaut-il ?~~ **Réglé le 17/10 par les faits** : oui, c'est l'état du contact dans le carnet de WOH, et Shotgun applique la même règle (§5.1). | — |
| D3 | Règle de la porte | **Choisi par Paul le 17/10** : « ≥ 10 scans et ≥ 10 % des billets valides » (33 → 120 soirées mesurées). |
| D4 | Billets à 0 € | **Choisi par Paul le 17/10** : « payants » et « entrées gratuites » à part partout ; « Guest list » = invitations seules. |
| D5 | E-mail pratique aux détenteurs d'un billet | Oui, sans aucune promotion, après lecture juridique. Shotgun propose déjà ce type d'e-mail (« e-mails pratiques ») et prévient qu'un usage marketing peut suspendre le compte. |
| D6 | Coordonnées dans `raw` | Les retirer après extraction. |
| D7 | Cadence d'un compte Billetterie + CRM | 15 min comme un compte CRM ; la fin d'essai met aussi la synchro en pause. |

---

## 11. Plan en sessions

Règles communes : une seule session à la fois écrit sur la prod (migrations,
rattrapages) ; chaque session part d'`origin/main` dans son propre worktree ;
répétition de chaque migration dans une transaction annulée, puis `db lint`,
puis banc des écrans **en tant que le titulaire d'Amoris** (rôle
`authenticated`) avant / après ; mode d'emploi, aide CRM (`yc.faq.*`),
assistant (`_shared/console-help-articles.ts`) et CLAUDE.md dans la même
session que le changement.

Effort : équipe humaine / Claude Code (table de CLAUDE.md).

### S0 — Gestes de Paul (avant lundi 19/10 10 h)
- « Offrir Yuno CRM » à **Amoris** (`/admin/organizers`).
- Réglages › Envoi d'Amoris : nom d'expéditeur « WOH », adresse postale.
- Exporter la liste Brevo de WOH si on veut l'importer (S6).
- Twilio : révoquer les clés, puis on supprime les 4 secrets.
- Ne jamais déconnecter, purger ni déménager la connexion WOH d'Amoris.

### S1 — Données Shotgun justes (pays, sources, totaux) · 1 jour / 30 min
- `countryCodeFrom` : codes retirés ignorés, noms historiques, tests sur les
  64 valeurs vues ; rattrapage SQL de `external_tickets.country_code` par lots.
- `_crm_ticket_source` ⇄ `sourceKind` : domaines référents normalisés,
  familles `ex` (e-mail externe) et `se` (recherche / IA), `SOURCE_KEYS`,
  `crm_ana_traffic__core`, libellés `yc.*` ×3, tests.
- Libellé `promoter_sales` (Admin CRM).
- Totaux de personnes : une définition, l'écart dit une fois.
- Déployer `affiliate-ticket-sync`.
- Fait quand : 0 billet « DD », « Autre site » < 3 % sur Amoris, Intégrations et Accueil disent le même nombre.

### S2 — Porte mesurée et billets gratuits · 2 jours / 45 min (D3 et D4 choisies le 17/10)
- `_crm_event_scan_known` et toutes ses copies (dont la recette « On t'a
  manqué », `scanKnown` du front) sur la nouvelle règle.
- « Payants » / « Entrées gratuites » dans Soirées, détail, Accueil, Ventes,
  Guest list ; conversion gratuit → payant.
- Fait quand : sur Amoris, 120 soirées « mesurées », Osmoz affiche 52 payants + 704 gratuits.

### S3 — Prêt à envoyer : identité de l'expéditeur et garde du premier envoi · 1 jour / 45 min
- Avant le premier envoi CRM d'un espace : nom d'expéditeur, adresse postale
  et raison sociale exigés (Réglages › Envoi), comme pour le SMS ; message
  clair sinon. Aujourd'hui `crm_email_settings` est vide et rien ne bloque.
- Conditions CRM + DPA acceptés par le titulaire de l'espace qui envoie.
- Test d'envoi de bout en bout sur le banc (vers nos adresses seulement).
- Fait quand : un espace sans identité ne peut pas envoyer, avec le bon message.

### S4 — Vitesse et charge · 3 jours / 1 h 30 (sans décision, avant le 25/10)
- Colonnes extraites (`deal_channel`, `is_free`, `source_family`, `org_fee`…)
  remplies par le connecteur + rattrapage ; RPC sans `raw->>`.
- Agrégats par soirée et par jour tenus par le post-traitement ; Ventes 90 j < 3 s à froid.
- Post-traitement incrémental (rien si aucun billet neuf).
- Cadence 15 min pour un compte Billetterie + CRM (D7).
- `contact_base_cache_refresh` incrémental (portées « sales » seulement).
- `crm_nights` paginé ou allégé.
- Fait quand : banc Amoris à froid, tous les écrans < 3 s ; passe sans billet < 1 s.

### S5 — Minimisation et effacement · 1 jour / 45 min (après S4)
- `raw` sans `contact_*` (rattrapage par lots, la nuit, seul sur la base).
- Effacement chez Shotgun propagé (billet anonymisé → profil et registre).
- Suppression des secrets Twilio.
- Fait quand : `external_tickets` divisé par deux, aucune coordonnée hors colonnes.

### S6 — Faire grandir la base pour le 29/10 · 1 jour / 45 min (dans Amoris)
- Import Brevo de WOH avec attestation, vérifié bout en bout.
- Page d'inscription de la soirée + liens `/go/` story et bio (publiés sur
  l'accord de Paul seulement).
- Annonce et dernier appel préparés en brouillon, relus par Paul.
- Fait quand : base joignable de la soirée connue, liens posés, deux brouillons relus.

### S7 — La soirée du 29/10 (runbook) · J-7 → J+2
- J-7 (22/10) : annonce ; J-2 : dernier appel ; synchro surveillée (journal des passes).
- J+1 : scans arrivés (le curseur suit les scans), bilan, familles confirmées,
  score comparé au réel (journal prévu / réel), écarts notés.
- Fait quand : rapport de soirée relu avec Paul, corrections listées.

### S8 — SMS Octopush · 1 jour / 45 min (après la soirée, ou avant si Paul le veut)
- Abonnement (Paul), secrets, `octopush-setup.mjs`, identité légale, test gratuit.
- Ouvrir le recueil du numéro des pages d'inscription (`CRM_SMS_SIGNUP_LIVE`)
  après lecture juridique ; sous-comptes Octopush par club (réponses du 06/10).
- Fait quand : un SMS de test reçu, une inscription par numéro comptée joignable.

### S9 — Intelligence en plus · 4 jours / 2 h (après S2, S4)
- « Ce que vous touchez » (frais Shotgun déduits), gratuit → payant, absence
  des gratuits, courbe d'arrivée, réseau de partenaires, groupes.
- Chaque chiffre sort de la référence Shotgun ou d'une mesure Yuno ; sinon « Bientôt ».

### S10 — Validation « système sain » · ½ jour / 30 min (après S1, S2, S4)
- Banc complet sur Amoris à froid (tous les écrans < 3 s), contrôles de
  justesse (pays, sources, porte, gratuits, totaux), contrôles de sécurité
  (droits, `anon`, Vault, aucune donnée hors de sa portée).
- Rend à Paul une liste « prêt / pas prêt » chiffrée.

### S11 — E-mail pratique aux détenteurs d'une soirée · 2 jours / 1 h (après S3, lecture juridique)
- Audience « détenteurs d'un billet valide de CETTE soirée », sans accord
  marketing, contenu limité (horaires, accès, line-up, changements), aucune
  offre ni lien vers une autre soirée ; garde serveur sur les blocs autorisés ;
  rien de facturé en Yunits ? (à décider) ; mention dans l'aide.
- Fait quand : un e-mail pratique peut partir aux détenteurs de la soirée du
  29/10 depuis Amoris, refusé s'il contient un bloc promotionnel.

### État au 18/10, 1 h (Paris)

Fusionnées dans main (`df5a8af3`) : S1, admin « offert », S3, S6, S4. Prod
vérifiée : 0 billet « DD », Ventes 90 j 0,9 s à chaud / 3,0 s à froid, passe
de synchro 2-4 s, colonnes typées remplies par trigger. Connecteur en prod =
v21 (code S1) : S5 le redéploiera depuis main avec ses changements.
En cours : S5 (minimisation), S11 (e-mail pratique). S7 : relevé programmé le
18/10 à 9 h 15 (tâche planifiée de l'app). À Paul : Réglages › Envoi d'Amoris
(nom, raison sociale, adresse), puis « Recevoir un test » ; publier la page
`/j/la-liste-club-sonore-friends` et importer Brevo quand il le décide.
Pas encore lancées : S2 (porte + gratuits), S8 (SMS) ; puis S9, S10.
S11 (18/10, ~1 h 30) : lecture juridique validée par Paul (1 Yunit / e-mail, 3 par
soirée, jusqu'à 24 h après la fin) ; migration `20261019150000` en prod ;
`send-campaign` + `owner-assistant` redéployés depuis main + S11 ; front sur
`refs/heads/crm/s11-practical-email` (poussée, à fusionner). Test réel fait le
18/10 : e-mail pratique reçu par Paul, bloc Billetterie refusé (402).

### Vagues

| Vague | Sessions | Pourquoi dans cet ordre |
|---|---|---|
| En cours | S1 (données), S4 (vitesse) | aucune décision à attendre |
| Maintenant | S2 (porte + gratuits), S8 (SMS), S3 (prêt à envoyer), S6 (base du 29/10), S7 (la soirée, préparation) | S2 n'applique en prod qu'après S1 et S4 ; S3, S6, S7, S8 touchent d'autres fichiers |
| Après S4 | S5 (minimisation) | repart des colonnes extraites par S4 |
| Après S2 + S4 | S10 (validation), S9 (intelligence) | il faut des chiffres justes et rapides |
| Après S3 | S11 (e-mail pratique) | même chemin d'envoi |
| 22/10 → 31/10 | S7 (la soirée) | calée sur les dates |

### Dates à tenir
- Essai CRM d'Amoris : fin le 19/10 à 10 h 14 (Paris) → « Offrir Yuno CRM » avant.
- Soirée du 29/10 : S7 commence le 22/10 (J-7).

---

## 12. Annexe — chiffres bruts du 17/10

- Connexion `55566e29-be6d-40e3-a979-052c01275302`, créée 14:25:59 UTC,
  import fini 14:36:47, curseur `2026-10-17T16:19:56.315Z_119765877`.
- Accords newsletter par adresse : vrai 300, faux 2 345, jamais demandé 15 413.
  Par billet : vrai 2 090, faux 8 294, null 38 004 (null sur 100 % des ventes
  guichet / hors ligne, 76 % des ventes en ligne).
- Sources (billets valides) : direct 23 464, shotgun 12 054, instagram.com
  6 273, null 2 745, ig 1 561, instagram 398, facebook.com 360, Brevo 418.
- Prix : 0 € 35 920 ; < 10 € 2 444 ; 10-20 € 4 764 ; ≥ 20 € 2 461.
- Base : 735 Mo ; `external_tickets` 171 Mo ; `crm_person_profile` 44 Mo.
- Réutiliser les requêtes : RPC jouées dans un `DO` qui pose
  `request.jwt.claims` (sub = titulaire) et `role = authenticated`, mesure
  `clock_timestamp()` et finit par `RAISE EXCEPTION` (rien n'est gardé).
