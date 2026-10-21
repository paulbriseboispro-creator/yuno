# Séparation Tickets / CRM (PR 23) — ordre d'application hors vente

État du 21/10/2026. Lecture seule faite aujourd'hui : **rien n'est appliqué en prod, rien n'est déployé.**
Documents liés : `docs/designs/CRM_TICKETS_SEPARATION.md` (rapport de la PR), PR 23
(`claude/crm-tickets-isolation-63f85a`, 64 fichiers, CI verte, mergeable, 5 commits de retard sur `main`).

## 1. Ce qui est vérifié (21/10, prod en lecture seule)

| Point | Résultat |
|---|---|
| 127 gardes md5 de la bascule (`md5(pg_get_functiondef)`) contre la prod | **0 écart** (rejouable : voir § 6) |
| Dernière migration en prod | `20261106500000` ; les 6 de la PR (`20261107…`) sont toutes plus récentes : aucun conflit d'ordre |
| Tables touchées | `contact_engagement` 73 k lignes / 35 Mo, `newsletter_subscriptions` 45 k / 32 Mo, `imported_contacts` 53 k / 26 Mo, `venue_sms_contacts` 36 k / 23 Mo, le reste < 1 Mo. Base entière : 772 Mo |
| Sauvegardes Supabase | physique **tous les jours ≈ 01:25 UTC** (7 conservées), **pas de PITR**. Un retour arrière par sauvegarde perd tout ce qui s'est écrit depuis |
| `pg_dump` | impossible d'ici : pas de `pg_dump` / `psql`, et le mot de passe de la base n'est pas dans `.env.local`. Remplacé par un instantané DANS la base (§ 3, étape 3) |
| Ventes réelles (`cs_live_`) par heure de Paris | 19 h–22 h : 41 sur 53 ; **0 entre 03 h et 08 h** |
| Crons qui touchent ces tables | `ticketing-sync` et `process-scheduled-campaigns` (5 min), `contact-base-cache-refresh` (5 min), `contact-engagement-sweep` (30 min), `crm-analysis-nightly` (**02:19–04:49 UTC**), `crm-score-nightly` (05:27–06:57 UTC) |
| Comptes concernés | CRM pur : 3 AM (vide), Nuits Démo. **Deux produits : Amoris (308 accords, 299 du connecteur), WOH (14 477 accords, tous d'import, 26 793 contacts importés)** |

## 2. Fenêtre proposée

- **Répétition annulée** : nuit du 22 au 23/10, 03 h 35 Paris (01:35 UTC), juste après la sauvegarde de 01:25 UTC.
- **Bascule** : nuit du 23 au 24/10, même heure. Marge de 4 jours avant House Of Masquerade (28/10) et la fin de l'essai
  de WOH (28/10). Pas plus tard que la nuit du 24 au 25.
- Durée à tenir : **< 40 min** (le cron d'analyse du CRM démarre à 02:19 UTC).

## 3. Séquence de la nuit de bascule

Chaque étape qui écrit en prod (3, 4, 5, 6, 7, 8) attend le feu vert de Paul, étape par étape.

| # | Qui | Action | Critère de réussite / d'arrêt |
|---|---|---|---|
| 0 | agent | La veille : fusionner `main` dans la branche, CI verte. Gel : aucune autre migration sur les tables et fonctions touchées | `git diff` des 5 commits de retard relu, tests verts |
| 1 | agent | 01:35 UTC — contrôles : sauvegarde du jour `COMPLETED`, aucune vente depuis 30 min, `pg_stat_activity` calme, **gardes md5 = 0 écart** (§ 6) | un seul écart ⇒ ARRÊT (la bascule refuserait de toute façon) |
| 2 | agent | Capturer les bases de référence (§ 7) | fichiers enregistrés |
| 3 | agent | **Instantané** : schéma `bak_sep_20261021` = copie des 13 tables (≈ 120 Mo) + `bak_sep_20261021.function_defs` (signature + `pg_get_functiondef` des 127 fonctions) | comptes identiques aux tables source |
| 4 | agent | Migrations dans l'ordre, **une requête par fichier**, puis la ligne dans `supabase_migrations.schema_migrations` : `…100000`, `…110000`, `…115000` (additive : colonnes, index NEUFS, rien n'est retiré) | chaque fichier renvoie OK |
| 5 | agent | **Point de contrôle** : tout est additif jusqu'ici, un arrêt n'a rien cassé. Si OK : `…120000`, `…130000` | OK |
| 6 | agent | **`…140000`, la bascule** (une transaction : retrait des anciens index, 127 fonctions remplacées, copie des fichiers importés, contrôles bloquants), puis `NOTIFY pgrst` | la transaction passe entière ou ne change rien |
| 7 | agent | **Tout de suite après** : fusionner la PR 23 (le front part par Cloudflare, ≈ 3 min) | build vert |
| 8 | agent | Edge depuis un worktree PROPRE sur `origin/main`, dans cet ordre : les 5 qui écrivent le consentement SMS (`create-ticket-checkout`, `create-table-checkout`, `create-guest-list-entry`, `verify-ticket-payment`, `verify-table-payment`), puis `send-campaign`, `send-sms-campaign`, `affiliate-ticket-sync`, `process-scheduled-campaigns`, `send-missed-you`, `send-next-event-recommendation`, `owner-assistant` | avant chacune : comparer le déploiement actuel au `main` (`supabase functions download`, règle « prod ≠ main ») |
| 9 | agent | Régénérer `src/integrations/supabase/types.ts` (stderr redirigé), commit séparé | `tsc` propre |
| 10 | agent | Contrôles d'après (§ 8) | tout vert, sinon § 9 |
| 11 | Paul | Relire les écrans du CRM démo, d'Amoris (ton compte) ; WOH seulement avec l'accord de Kevin (accès assisté) | écrans non vides, chiffres cohérents |

**Pourquoi cet ordre** : une migration avant le front (un nouveau front sur l'ancienne base appelle des paramètres qui
n'existent pas : `p_product`, `p_product` de `get_sms_sender_readiness`…). Les edge viennent après, car `send-campaign`
et `send-sms-campaign` appellent des fonctions à signature nouvelle.

## 4. Les trous de la séquence (à connaître, courts)

1. **Entre l'étape 6 et l'étape 8**, l'ancien code des 5 fonctions de paiement fait un `upsert` du consentement SMS avec
   l'ancienne clé `venue_id,phone_e164`, supprimée par la bascule. L'erreur est avalée (le paiement n'est pas touché,
   `sms-consent.ts` le dit) mais **l'accord SMS coché au paiement n'est pas enregistré**. À 03 h 40 cela ne concerne
   personne ; on le vérifie en § 8 (aucun paiement dans l'intervalle).
2. **Entre l'étape 6 et le déploiement du front**, sur un compte à DEUX produits (WOH, Amoris), un import fait par la
   Console CRM avec l'ancien front écrirait côté Billetterie (`p_product` absent = NULL ; un compte CRM pur, lui, est
   forcé à `'crm'` par le déclencheur). Aucun import ne doit avoir lieu cette nuit-là : le dire à Kevin (WOH) et
   Jules (3 AM) la veille.
3. **Fusionner la PR = déployer le front** : ne la fusionner qu'à l'étape 7, jamais avant les migrations.
4. **Aucune migration d'une autre session** sur les fonctions gardées entre la répétition et la bascule : la garde md5
   arrêterait la bascule (sans dégât, mais la nuit serait perdue).

## 5. Répétition annulée (nuit du 22 au 23)

Les six fichiers dans UNE requête, suivis de `DO $$ BEGIN RAISE EXCEPTION 'REHEARSAL_OK'; END $$;` : la seule erreur
attendue est `REHEARSAL_OK`. On mesure la durée et ce qui attend un verrou (`pg_stat_activity` pendant l'exécution).
Elle prend les mêmes verrous que la vraie : à jouer à la même heure calme, une fois. Elle prouve aussi que les
`ALTER TABLE contact_engagement … SET EXPRESSION` (réécriture de 73 k lignes) et la copie des 14 k contacts de WOH
tiennent dans la fenêtre. Si elle dépasse 40 min, ne pas faire la bascule : redécouper.

### Résultat de la répétition du 21/10 (10 h 14 Paris, 08:14 UTC) — FAITE

Les six fichiers enchaînés dans une transaction (verrous `lock_timeout 10 s`, `statement_timeout 600 s`) puis
`RAISE EXCEPTION 'REHEARSAL_OK'` : **aucune erreur, gardes md5 et contrôles bloquants passés, durée totale 109,6 s**,
annulée. Vérifié après : aucune colonne `product`, aucune fonction nouvelle, ancien index toujours là, aucune ligne dans
`schema_migrations`, aucun achat pendant l'exécution. Conséquence : la bascule réelle tient des verrous sur
`newsletter_subscriptions` & co pendant **~1 à 2 minutes** (surtout `…140000`) ; un achat qui tombe dans cette fenêtre
attend (30 s de délai côté service) — à 03 h 40 c'est improbable, en journée environ 1 vente par heure.

Autre fait du jour : d'autres sessions tournent et appliquent des migrations (la plus récente, `20261106510000`).
Prévenir les sessions actives avant la bascule ; la garde md5 arrête tout si une fonction gardée change entre-temps.

## 6. Garde md5, rejouable à tout moment (lecture seule)

Extraire de `20261107140000_…_cutover.sql` les 127 couples `(signature, md5)` des lignes 19 à 159, puis interroger la
prod : `select v.sig from (values …) v(sig, md5) where to_regprocedure(v.sig) is null or
md5(pg_get_functiondef(to_regprocedure(v.sig))) is distinct from v.md5`. **Résultat attendu : aucune ligne.**
(La garde du fichier lui-même refuse de tourner avant la migration de socle ; ce contrôle, lui, tourne maintenant.)

## 7. Bases de référence à capturer avant (étape 2)

- Par compte CRM (3 AM, Amoris, Nuits Démo, WOH) : accords du registre (total, `opted_in`, `connector:%`, avec
  `import_id`), contacts importés, contacts SMS, imports, recettes, campagnes, modèles. Valeurs du 21/10 :

  | Compte | Accords | dont connecteur | Importés | SMS | Imports | Recettes | Campagnes | Modèles |
  |---|---:|---:|---:|---:|---:|---:|---:|---:|
  | 3 AM | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
  | Amoris | 308 | 299 | 1 | 6 | 1 | 1 | 9 | 1 |
  | Nuits Démo | 1 809 | 1 162 | 802 | 708 | 8 | 6 | 48 | 11 |
  | WOH | 14 477 | 0 | 26 793 | 12 223 | 2 | 0 | 5 | 2 |

- Pour les 127 fonctions : `has_function_privilege('anon'|'authenticated', oid, 'EXECUTE')` (règle du dépôt après toute
  migration de fonction : aucune fonction `SECURITY DEFINER` n'y gagne un droit anonyme).
- Dernier statut de `ticketing_sync_runs`, des passes de `process-scheduled-campaigns` et des crons du § 1.

## 8. Contrôles d'après (étape 10)

1. **Comptes** : pour chaque compte, `accords après = accords avant + fichiers copiés` ; Amoris : 6 `ticket_purchase` et
   2 `waitlist` restent côté Billetterie ; CRM pur : tout en `'crm'` ; aucune ligne perdue (comparer à l'instantané).
2. **Index** : les anciens (`uniq_newsletter_subs_email_venue`, `…_organizer`, `uniq_email_opt_outs_venue`,
   `…_organizer`, `venue_sms_contacts_unique_phone`, `…_org_phone`) n'existent plus ; les `…_product` existent.
3. **Fuites** : `scripts/crm-bench/audit-separation.mjs` rejoué sur les définitions de la prod ; la vue Billetterie d'Amoris
   ne montre plus de billet Shotgun (17 410 sur 17 413 avant), la vue CRM de WOH ne montre plus de vente Yuno.
4. **Droits** : mêmes réponses qu'au § 7 pour `anon` / `authenticated`.
5. **Types et sélections** : `supabase db lint --linked` ; `python3 scripts/check-selects.py`.
6. **Vie réelle** : une heure plus tard, `ticketing-sync`, `process-scheduled-campaigns`, `contact-base-cache-refresh`
   verts ; journaux des edge sans `42P10` ni `PGRST202` ; premier calcul du cache de contacts fait (WOH ≈ 14 k lignes,
   Amoris ≈ 17 k) ; aucun paiement entre l'étape 6 et l'étape 8 (sinon compter ceux qui avaient coché le SMS).
7. **Écrans** : compte démo CRM (Audience, Clients, Campagnes, Scénarios, Importer), Amoris côté Tickets ET côté CRM,
   WOH avec l'accord de Kevin. Ces écrans n'ont **jamais tourné sur des données** au banc (seulement compilés).

## 9. Retour arrière

- **Avant l'étape 6** : tout est additif, rien à défaire ; les colonnes `product` inutilisées sont inoffensives.
- **Pendant l'étape 6** : une transaction, soit tout passe, soit rien n'a changé.
- **Après** : **corriger en avant** plutôt que revenir. Le retour exact (recréer les 127 fonctions depuis
  `bak_sep_20261021.function_defs`, vider et recopier les tables depuis l'instantané, recréer les anciens index) n'est
  possible que si aucune ligne nouvelle n'a été écrite depuis, car une adresse peut avoir DEUX lignes (une par produit) et
  l'ancien index unique ne se recréerait plus. À décider dans les 15 premières minutes.
- **Dernier recours** : la sauvegarde physique de 01:25 UTC (perd tout ce qui a été écrit depuis, achats compris).
- Garder l'instantané 14 jours, puis `DROP SCHEMA bak_sep_20261021 CASCADE`.

## 10. À trancher avant la bascule

Voir le message qui accompagne ce document : date, message à Kevin (WOH), accords des fichiers copiés au CRM, forfait
CRM d'un compte à deux produits, et les points non tranchés du rapport (identité du compte, anciennes pages CRM de la
Console `/owner`, MCP d'un compte à deux produits).

## 11. Exécution réelle du 21/10/2026 (08:20-08:29 UTC, 10:20-10:29 Paris)

Fait sur le feu vert explicite de Paul, base calme (0 vente sur 15 min, gardes md5 à `[]`).

| Heure UTC | Étape |
|---|---|
| 08:15 | Instantané `bak_sep_20261021` (13 tables, 127 définitions de fonctions) vérifié complet |
| 08:20-08:22 | Migrations 100000, 110000, 115000, 120000, 130000 (additives, 0,6 à 4,5 s chacune) |
| 08:22:55 | PR 23 fusionnée en rebase (front déployé par Workers Builds) |
| 08:23:43-08:25:27 | **Bascule 140000, une transaction, 103,6 s** (répétition : 109,6 s) |
| 08:27:49-08:28:51 | 12 fonctions edge déployées une à une depuis un worktree propre à `origin/main` |

**Incident, corrigé.** Le script d'application a cherché le fichier de la bascule sous un mauvais nom : le `cat` a échoué mais
l'`INSERT` dans `schema_migrations` est passé, et la ligne `20261107140000` a existé 50 secondes sans que la bascule soit jouée ;
la PR a été fusionnée dans la même commande enchaînée, 2 min 30 avant la vraie bascule. Aucune écriture n'a eu lieu dans
l'intervalle (0 billet, 0 table, 0 guest list, 0 accord, 0 import). Correction : ligne supprimée, bascule rejouée, fichier
vérifié identique (md5) à celui de `main`. Leçon : vérifier l'existence du fichier AVANT d'écrire la ligne de version, et ne
jamais enchaîner la fusion de la PR dans la même commande que l'application d'une migration.

**Contrôles d'après (tous passés)** :

- Aucune ligne de l'instantané perdue (accords, contacts importés, contacts SMS) ; les seuls écarts sont la copie des fichiers
  du compte à deux produits (WOH : +14 477 accords, +26 793 contacts importés, +12 223 contacts SMS, +2 imports).
- Anciens index uniques supprimés, les six `…_product` présents.
- Droits : les 16 fonctions recréées avec un nouveau paramètre n'ont aucun droit `anon` quand elles sont SECURITY DEFINER.
  Constat préexistant, hors bascule : 14 autres fonctions SECURITY DEFINER du moteur d'e-mails gardent un droit `anon` hérité
  des droits par défaut (voir la session « Audit des droits anon »).
- `check-selects.py` : 1189 sélections, 0 mauvaise. `supabase db lint --linked` : aucune erreur réelle (les erreurs listées
  sont des tables temporaires, ou le garde `to_regclass` de `purge_expired_personal_data`).
- Vues par produit : Amoris côté Billetterie 55 clients, côté CRM 17 401 (avant : 17 410 acheteurs Shotgun dans la base
  Billetterie) ; WOH côté CRM 14 491 contacts, tous issus de fichiers, aucun Yuno ; côté Billetterie 14 508 dont 29 nés de
  ventes Yuno. **Le chiffre de 3 706 contacts du doc de séparation ne s'est pas vérifié** : seuls 29 contacts de WOH naissent
  de ventes Yuno.
- Crons `ticketing-sync`, `process-scheduled-campaigns`, `contact-base-cache-refresh`, `crm-scenario-tick`, `crm-signup-relance`
  verts ; passe de synchro de 08:35 `ok` avec la nouvelle fonction.
- Non refait : le banc `audit-separation.mjs` (déjà passé à la répétition) et les écrans (§ 8.7), à passer à la main.

**Reste** : supprimer l'instantané après le 04/11/2026 (`DROP SCHEMA bak_sep_20261021 CASCADE`) ; `types.ts` a environ 35 000
lignes de retard sur la base (une regénération donne un diff énorme, à traiter à part) ; surveiller le premier envoi CRM d'un
compte à deux produits (adresses des fichiers copiés).
