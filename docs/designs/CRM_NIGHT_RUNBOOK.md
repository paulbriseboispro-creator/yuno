# Runbook — la soirée WOH du 29/10, premier vrai test de Yuno CRM (J-7 → J+2)

> Session S7 du plan d'audit Amoris × Shotgun (17/10, non commité :
> `CRM_AMORIS_SHOTGUN_AUDIT_PLAN.md` du dossier principal, §1, §2, §7, §11).
> Ce runbook dit ce qu'on regarde chaque jour, à partir de quel chiffre on
> s'inquiète, et qui agit. Le suivi est en **LECTURE SEULE** : aucun envoi,
> aucune écriture en prod sans l'accord de Paul.

## 0. Ce que la soirée doit prouver

Le diagnostic du 17/10 n'a pu que supposer ces cinq points. La soirée les
vérifie, ou les infirme :

| # | Hypothèse | Preuve attendue | Quand |
|---|---|---|---|
| H1 | La synchro tient pendant la vente | chaque passe « ok », jamais plus de 2 × l'intervalle sans passe réussie, écart Shotgun / Yuno ≤ 3 billets | J-7 → J |
| H2 | Les scans de la porte remontent | les scans apparaissent dans Yuno au plus tard une cadence après (60 min aujourd'hui, 15 si S4 a livré D7) ; le total J+1 = les entrées du Smartboard Shotgun | nuit, J+1 |
| H3 | Le score « Chances de venir » prévoit les acheteurs | les personnes « fortes » achètent plus que les « faibles » ; achats réels proches des attendus | J+1 (provisoire), 01/11 (officiel) |
| H4 | Les familles d'hypothèses se confirment et tiennent | ≥ 1 famille « confirmée » le 18/10, aucune bascule après la soirée | 18/10, J+1, J+2 |
| H5 | Ce que Yuno fait se mesure | ventes attribuées aux liens `/go/` et aux e-mails (`utm_source` `yuno-…`), clics, inscriptions `/j/` | J-7 → J+1 |

## 1. Repères

| | |
|---|---|
| Espace | organisation **Amoris**, titulaire `06ce47f8-66a5-42d5-a7bf-56253619ff96` (portée `org:06ce47f8-…`) |
| Connexion | Shotgun de **WOH** (« Club Sonore », `179715`), `55566e29-be6d-40e3-a979-052c01275302`. **Ne JAMAIS la déconnecter, la purger ni la déménager.** |
| Soirée | « CLUB SONORE X EXCLUSIVE X WOH & FRIENDS X NONSENSE PARIS », Shotgun `608383`, miroir `01eccd74-74dc-4787-8be7-0330a10d3a6c` |
| Horaires | jeudi 29/10 **19 h → vendredi 30/10 5 h** (Paris) = 18:00 → 04:00 UTC |
| Rôle de WOH | `editor` (co-organisateur chez Shotgun) |
| Tarifs | FREE ENTRY BEFORE 00:00 (0 €, 200) · ENTRY 10 € BEFORE 1:00 (100) · ENTRY 15 € ALL NIGHT (100) · FESTIV DINNER (0 €, 100) · FESTIV DINNER - Friends (0 €, 100, canal duplicata) — 600 places |
| Soirée de comparaison | « Larry Houl and friends X Nonsense » (15/10), **309 billets** à la fin |
| Ce n'est pas elle | « House Of Masquerade » (Ségovie, nuit du 28 au 29/10) est une soirée **Yuno** d'Amoris, pas une soirée Shotgun : elle n'entre pas dans la Console CRM |

**Les heures qui comptent** (heure de Paris ; **changement d'heure dimanche
25/10**, les tâches planifiées restent en UTC) :

| Tâche | UTC | Paris jusqu'au 24/10 | Paris dès le 25/10 |
|---|---|---|---|
| Synchro (`ticketing-sync`) | toutes les 5 min, prend les connexions dues | — | — |
| Cadence d'Amoris | `sync_interval_minutes` = **60** (15 si S4 / D7 en prod) | un scan remonte en ≤ 65 min | idem |
| Calcul de nuit (familles, profils) | 02:19 → 04:49 | 04:19 → 06:49 | 03:19 → 05:49 |
| Score « Chances de venir » + journal prévu | 05:27 → 06:57 | 07:27 → 08:57 | 06:27 → 07:57 |
| Règlement prévu / réel | fin + 48 h, au calcul du score suivant | — | **dimanche 01/11 vers 8 h** |

Conséquence : la nuit du 29 au 30/10, le calcul de nuit tourne **pendant** la
soirée (03:19 → 05:49, la soirée finit à 5 h) ; il ne voit qu'une partie des
scans. Le calcul qui compte est celui de la nuit du 30 au 31/10.

## 2. Qui fait quoi

| Qui | Quoi |
|---|---|
| **Paul** | tous les gestes : réglages d'envoi, envois (annonce, dernier appel), publication de la page `/j/` et des liens `/go/`, lecture du Smartboard Shotgun (vendus, entrées) pour comparer, regard sur la Console (Accueil, Soirée, bilan), décision sur chaque correction. Relance S7 aux dates du §4. |
| **S7** (suivi) | un relevé par passage (`night-check.mjs`), un compte rendu court (§6), la liste des corrections. Jamais d'écriture, jamais de déconnexion, jamais de relance manuelle d'une synchro. |
| **S6** (base du 29/10) | brouillons annonce + dernier appel, page `/j/`, liens `/go/` story et bio, import Brevo. |
| **S3** (prêt à envoyer) | garde du premier envoi (expéditeur, adresse postale). |
| **S4** (vitesse) | cadence 15 min pour un compte Billetterie + CRM (D7), écrans < 3 s. |
| **S2** (porte, gratuits) | règle « ≥ 10 scans et ≥ 10 % » : décide si la porte du 29/10 est « mesurée ». |
| **S1** (données) | pays, sources (`instagram.com` → Instagram). |

Une migration de S1, S2 ou S4 qui passe entre J-7 et J+2 peut changer un
chiffre d'un relevé à l'autre : la noter dans le journal (§7) le jour même.

## 3. Seuils d'alerte

Le script classe chaque relevé VERT / ORANGE / ROUGE. Mêmes seuils ici :

| Niveau | Signal | Que faire |
|---|---|---|
| 🔴 | connexion ≠ `active` · ≥ 3 échecs de suite · dernière passe réussie il y a plus de 2 × l'intervalle + 10 min · dernière passe `error` / `abandoned` · tâche planifiée éteinte | lire `last_error` et le journal des passes (le relevé les montre), prévenir Paul. **Ne pas** déconnecter, purger ni relancer à la main. Erreur 429 = limiteur Shotgun commun (100 / min / IP) : attendre la passe suivante. |
| 🔴 | aucun scan remonté 2 h après l'ouverture (21 h le 29/10) | demander à Paul si le scanner Shotgun sert ce soir. S'il ne sert pas, la porte sera « non mesurée » : attendu, à noter. S'il sert, regarder la synchro (H1). |
| 🔴 | soirée annulée chez Shotgun | prévenir Paul. |
| 🔴 | campagne `paused` / `failed`, rebonds > 5 % ou plaintes > 0,2 % (≥ 50 envois) | le disjoncteur a joué ou va jouer : ne rien renvoyer, prévenir Paul. |
| 🔴 | abonnement CRM ni actif ni en essai, ou essai fini | campagnes et automatisations refusées (`crm_paused`). Fait le 17/10 20:33 : Yuno CRM offert à Amoris, sans échéance. |
| 🔴 | un écran en erreur, ou > 8 s (l'API coupe) | noter l'écran et le temps, passer à S4. |
| 🟠 | 1 ou 2 échecs · dernière passe `partial` · verrou de synchro > 15 min | relancer le relevé à la passe suivante. |
| 🟠 | écart Shotgun / Yuno > max(3 billets, 2 %) | synchro en retard ou billets non rapportés : relancer après la passe suivante ; s'il reste, c'est une correction. |
| 🟠 | expéditeur ou adresse postale non réglés | **avant tout envoi** : Réglages › Envoi d'Amoris, « WOH » + adresse postale (P0-2). |
| 🟠 | familles pas recalculées depuis 30 h · 2ᵉ calcul absent · score non validé · modèle validé mais soirée sans note | noter ; regarder si le calcul de nuit a tourné (journal des passes de la nuit, `crm_family_status.computed_at`). |
| 🟠 | un écran > 3 s · l'Accueil ou la Soirée ne disent pas le même nombre de ventes que la base · l'Accueil ne montre pas cette soirée | noter, passer à S4 (vitesse) ou à la correction. Un écran entre 3 et 8 s seul ne bloque pas la soirée. |

## 4. Le calendrier

| Jour | Paris | Relevé | Ce qu'on regarde en plus | Gestes de Paul |
|---|---|---|---|---|
| **sam. 18/10** | après 9 h | complet | 2ᵉ calcul de nuit : familles « confirmées » (`crm_family_status.status = 'supported'`, `supported_runs = 2`), modèle du score (`crm_score_model.status = 'ok'`), note de la soirée (`crm_score_night`, `crm_person_night_score`) | « Offrir Yuno CRM » ✅ (17/10 20:33) · Réglages › Envoi « WOH » + adresse |
| 19/10 → 21/10 | matin | rapide (`--no-screens`) si Paul relance | ventes du jour, synchro | import Brevo, page `/j/`, liens `/go/` (avec S6) |
| **jeu. 22/10 (J-7)** | matin, puis 2 h après l'envoi | complet | expéditeur réglé, base joignable, Yunits ; après l'envoi : remis, rebonds, plaintes, protégés, clics ; premières ventes `yuno-m-…` ; liens `/go/` posés ; journal prévu de J-7 (`crm_prediction_nights`, `crm_prediction_people` « d7 ») | **annonce** (brouillon S6 relu) |
| 23/10 → 26/10 | matin | rapide | effet de l'annonce sur la courbe J-N de l'Accueil, ventes payantes / gratuites, sources | — |
| **mar. 27/10 (J-2)** | matin, puis 2 h après l'envoi | complet + `--heavy` | cadence de synchro (15 min si S4 a livré), Qui cibler, Plan de la soirée, résultats du dernier appel | **dernier appel** (brouillon S6 relu) |
| mer. 28/10 (J-1) | matin | complet | rien ne doit avoir bougé dans la synchro ; écart Shotgun / Yuno | — |
| **jeu. 29/10 (J)** | 17 h | complet | dernier état avant les portes | — |
| | 19 h → 5 h | `--no-screens`, à chaque cadence (toutes les heures, ou 30 min si 15 min de cadence) | scans qui montent, scans par heure, dernières ventes, échecs de synchro ; 21 h : alerte si toujours 0 scan ; minuit : fin du tarif gratuit | comparer une fois dans la nuit le nombre d'entrées du Smartboard Shotgun au relevé |
| **ven. 30/10 (J+1)** | 10 h | complet + `--heavy` | **bilan** : scans totaux par tarif, venue des payants / gratuits, porte « mesurée » ou non, prévu / réel provisoire par étiquette, familles après le calcul de nuit (partiel), écran Soirée (bilan) | entrées et vendus du Smartboard, pour comparer · regarder le bilan dans la Console |
| **sam. 31/10 (J+2)** | 10 h | complet | scans tardifs, remboursements, familles après le calcul de la nuit du 30 au 31 (complet), aucune bascule | relire le rapport (§6) et la liste des corrections |
| dim. 01/11 | après 8 h | complet | **prévu / réel officiel** (`crm_prediction_results` « first » et « d7 ») | — |

## 5. Lancer un relevé

Depuis le dossier du dépôt (ou un worktree : le jeton est cherché en remontant) :

```bash
node scripts/crm-bench/night-check.mjs
```

```bash
node scripts/crm-bench/night-check.mjs --no-screens
```

```bash
node scripts/crm-bench/night-check.mjs --heavy
```

- Complet = une requête en lecture seule (`SET TRANSACTION READ ONLY`) +
  les écrans Accueil 30 j, Soirées, Soirée, Ventes de la soirée joués **en tant
  que le titulaire** (rôle `authenticated`, `request.jwt.claims.sub` = titulaire)
  dans un bloc `DO` qui finit **toujours** par `RAISE EXCEPTION` : rien n'est gardé.
- `--heavy` ajoute Ventes 90 j (le plus lourd, 6 à 9 s), Qui cibler et le Plan
  de la soirée : une fois à J-2 et une fois à J+1, pas plus.
- `--no-screens` : la nuit, et dès qu'une autre session migre ou mesure.
- Les écrans sont sautés d'office si une autre requête tourne depuis plus de
  5 s (`pg_stat_activity`) ; `--force` passe outre (à éviter : machine Micro,
  une seule requête lourde à la fois).
- Chaque relevé est gardé dans `scripts/crm-bench/.data/night-check/` (ignoré
  par git) : la section 6 du relevé donne l'écart avec le précédent.
- `--json` rend tout le relevé brut ; `--event`, `--owner`, `--connection`
  servent pour une autre soirée.

Ce que le relevé ne sait pas faire : lire Shotgun (le Smartboard reste la
référence que Paul lit à la main), lire le contenu d'un e-mail, voir l'écran
dessiné (Paul regarde la Console).

## 6. Le compte rendu (un par passage)

Court, dans la conversation avec Paul, puis une ligne dans le journal (§7) :

```
S7 · <jour> <heure> · <J-n / nuit / J+n> · VERT | ORANGE | ROUGE
Synchro : <passes, échecs, dernière passe, cadence>
Soirée : <vendus = payants + gratuits, aujourd'hui / hier, Shotgun ↔ Yuno, scans>
Yuno : <envois, clics, ventes attribuées, inscriptions>
Intelligence : <familles confirmées, score, prévu / réel>
Écrans : <Accueil, Soirée, Ventes>
À corriger : <liste, avec la session qui s'en charge>
```

## 7. Journal du suivi

Une entrée par passage. Les corrections vont au §8.

**sam. 17/10 20:34 — relevé de base (J-12)** · ORANGE
- Synchro : 60 min, 0 échec, 4 passes OK depuis l'import (14:26 → 14:36 UTC), dernière 19:50.
- Soirée : **16 billets = 0 payant + 16 gratuits** (FREE ENTRY BEFORE 00:00) pour **5 acheteurs** (commandes de groupe), 2 avec accord newsletter ; 8 le 14/10, 4 le 16/10, 4 le 17/10. Shotgun 16 / 600, Yuno 16 : aligné. Sources : shotgun 9, direct 7. 0 scan (attendu).
- Yuno : aucun lien `/go/`, aucune page `/j/`, aucune campagne pour la soirée. **Yuno CRM offert à Amoris le 17/10 à 20:33** (actif, sans échéance, 15 000 Yunits) : P0-1 levé. Expéditeur non réglé, pas d'adresse postale (P0-2 ouvert).
- Intelligence : 16 952 profils ; 23 familles, 0 confirmée (attendu : il faut 2 calculs) ; 7 candidates au 2ᵉ calcul (artiste z 17,8 ×1,58 ; achat direct z 14,3 ×2,02 ; découverte z −8,8 ×0,60 ; canal Shotgun z −8,8 ×0,60 ; lancement z 7,2 ×2,92 ; réseaux hors lien Yuno z −6,4 ×0,29 ; 1ʳᵉ venue en groupe z 6,1 ×1,35). Groupe (z 19,5, ×1,26), créneau (14,6, ×1,21), jour (12,8, ×1,20), genre (10,0, ×1,13) ne sont **pas** candidates : effet sûr mais sous le seuil de gain ×1,3 (`status.gain_supported`), elles ne seront pas confirmées cette nuit (voir C4). « Arrive tôt » (×8,41) non plus : 1,3 cas attendu, il en faut 5. Modèle du score pas encore entraîné.
- Écrans : Accueil 30 j 1,4 s · Soirées 0,6 s · Soirée 0,2 s · Ventes de la soirée **4,0 s** (cible 3 s, S4). Accueil = Soirée = base (16).

**dim. 18/10 — après le 2ᵉ calcul de nuit** · à faire (relevé programmé vers 9 h 15).

## 8. Corrections à faire

Déjà connues (plan d'audit) : pays « DD » (S1), sources `instagram.com` (S1),
règle de porte (S2), gratuits comptés en ventes (S2), cadence 60 min d'un
compte Billetterie + CRM (S4), Ventes 90 j > 8 s à froid (S4).

Vues par le suivi :

| # | Vu le | Constat | Effet | Qui |
|---|---|---|---|---|
| C1 | 17/10 | Ventes de la soirée (une soirée, 90 j) : 4,0 s pour 16 billets | au-dessus de la cible de 3 s | S4 |
| C2 | 17/10 | « 16 vendus » sur l'Accueil et la Soirée pour 16 entrées gratuites, 0 € | un pro lit « 16 ventes » ; c'est D4 | S2 |
| C3 | 17/10 | la courbe « précédente » de l'Accueil vaut 0 de J-19 à J-12 (soirée du 15/10 publiée plus tard) | comparaison illisible avant J-11 ; écrire « publiée N jours plus tard » (plan §4.7) | à attribuer |
| C4 | 17/10 | groupe, créneau, jour, genre : effet certain (z 10 à 19,5) mais modéré (×1,13 à ×1,26), donc jamais « confirmées » (seuil ×1,3) ; leur test brut est « non concluant », et au bout de 60 jours (`flat_days`, n ≥ 100) elles passeront « pas de différence nette sur votre compte » | faux sur ce compte : ×1,26 avec z 19,5 est une différence nette | **décision de Paul**, puis S9 : un statut « effet modéré, sûr » ou un seuil de gain qui baisse quand z est très haut |
