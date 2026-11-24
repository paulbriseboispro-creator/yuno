# Suppression du système « mineurs » — guide de reprise

Décision de Paul (2026-11-24) : **Yuno est réservé aux majeurs. On supprime tout
le système qui permettait d'accepter des mineurs en soirée** (réglage « autoriser
les mineurs », soirée « sans alcool », document d'autorisation parentale à
télécharger / signer / renvoyer, table `minor_ticket_docs`, bucket de stockage,
filtres « mineurs » des écrans Clients). Suppression propre, sans reste.

Ce document sert à reprendre le chantier si la session s'arrête. Mettre à jour
la section « État » à chaque étape franchie.

## Ce qui RESTE (ne pas supprimer)

- La **date de naissance au paiement** (billet et table) : elle sert à refuser un
  mineur. Elle devient une porte « majeurs seulement », sans branche mineur.
- `src/components/AgeGate.tsx` (panier boissons, `GuestDrinkCheckout`,
  `PostCheckoutUpsell`) : porte 18+ qui BLOQUE un mineur. À garder (la variable
  `storedMinor` y désigne un mineur refusé, c'est correct).
- `_shared/age-declaration.ts` + `ageDeclaration` de `create-table-checkout` :
  déclaration sur l'honneur de majorité. À garder.
- `venues.min_age`, `can_sell_alcohol*` : sans rapport, à garder.
- `src/lib/birthDate.ts` : garder ; seul le commentaire ligne 81 cite
  `MinorAuthGate` (à reformuler).
- Faux positifs du grep : `useLiveNightData.ts` (`last10minOrders`),
  `App.tsx` / `AdminOrders` / `AdminOrganizers` (« minOrders », « adMINORganizers »).

## Base de données (prod, vérifié le 2026-11-24)

**Aucune donnée réelle** : 0 ligne `minor_ticket_docs`, 0 soirée `alcohol_free`
ou `minors_disabled`, 0 club / orga `minors_allowed`, 0 document posé, 0 billet
avec `minor_auth_doc_url`. Seuls 3 fichiers de test (juin 2026) en stockage.

Objets à supprimer (migration `20261220100000_remove_minors_system.sql`) :

| Type | Objet |
|---|---|
| Colonnes | `events.minors_disabled`, `events.alcohol_free`, `venues.minors_allowed`, `venues.minor_auth_doc_url`, `venues.minor_auth_doc_name`, `organizer_profiles.minors_allowed`, `organizer_profiles.minor_auth_doc_url`, `organizer_profiles.minor_auth_doc_name`, `tickets.minor_auth_doc_url` |
| Table | `public.minor_ticket_docs` (+ index `idx_minor_ticket_docs_event_email`, policies « Anyone can record a minor ticket », « Event owners read minor ticket docs ») |
| Triggers | `trg_event_alcohol_free` (events), `trg_venue_minors_allowed` (venues), `trg_organizer_minors_allowed` (organizer_profiles) |
| Fonctions | `compute_event_alcohol_free()`, `sync_events_alcohol_free_from_venue()`, `sync_events_alcohol_free_from_organizer()` |
| Bucket | `minor-auth-uploads` (public !) + policies storage « Public read minor auth uploads », « Anyone can upload minor auth docs » (INSERT anon ouvert = vrai risque à fermer) |

Fonctions VIVANTES qui citent ces colonnes, à réécrire AVANT le DROP (repartir
de `pg_get_functiondef`, jamais d'un vieux fichier) :

- `block_support_sensitive_orgprofile_write` : lignes `minors_allowed`,
  `minor_auth_doc_url`, `minor_auth_doc_name` (INSERT et UPDATE) à retirer.
- `get_event_scan_manifest` : clé `'alcohol_free', e.alcohol_free` du bloc event à retirer.
- `protect_event_columns_from_partner` : lignes `minors_disabled` et `alcohol_free` à retirer.
- `protect_event_columns_from_cohost` : `'alcohol_free'` dans la liste blanche à retirer.

Fichiers de stockage à supprimer par l'API Storage (service role), PAS par SQL :

- `minor-auth-uploads/8f270ac7-8f59-4e4d-894f-5013d943de04/a675b488-f215-4d58-a2c3-4f9160cbc792.pdf`
- `minor-auth-uploads/8f270ac7-8f59-4e4d-894f-5013d943de04/f37c71d9-b91f-4ff1-b702-5ee0cd62f87b.pdf`
- `profile-photos/e873a207-586d-4f59-94c1-2a9bcafe05be/minor-auth-1781432109419.pdf` (modèle vide déposé par un orga)

Puis supprimer le bucket vide. Ordre : 1) front déployé sans lecture de ces
colonnes, 2) edge redéployée, 3) migration (sinon un vieux bundle qui
sélectionne `alcohol_free` tombe — PostgREST rend une erreur sur toute la requête).
Répéter la migration en transaction annulée sur la prod avant (le DROP sans
CASCADE échoue s'il reste une dépendance : c'est le filet).

Après la migration : régénérer `src/integrations/supabase/types.ts` (stderr
redirigé), lancer `python3 scripts/check-selects.py`, `supabase db lint --linked`.
`scripts/crm-bench/schema/base.sql` cite `minor_auth_doc_url` et `alcohol_free`
(schéma du banc) : retirer ces colonnes.

Migrations historiques (`20260613020000`, `20260613040000`, `20260614000000` →
`030000`, etc.) : NE PAS réécrire (déjà appliquées, checksum).

## Edge functions

- `create-ticket-checkout/index.ts` : `minorAuthDocUrl` lu ligne ~100, écrit
  `minor_auth_doc_url` lignes ~942 et ~1232 → retirer. À redéployer.
- `_shared/console-help-articles.ts` : texte d'aide qui parle des mineurs →
  réécrire / retirer ; redéployer `owner-assistant`.
- `_shared/email-image-host.ts` : cite le bucket `minor-auth-uploads` comme
  exemple de bucket refusé → vérifier (probablement un simple commentaire /
  liste) ; test miroir `src/lib/email/__tests__/emailImageHost.test.ts` utilise
  ce nom comme exemple de bucket interdit → remplacer par un autre nom.
- Vérifier aussi `yuno-assistant` (`CLIENT_KNOWLEDGE_BASE`) et
  `owner-assistant` (`HELP_ARTICLES`) pour « mineur / minor / menor ».

## Front

À SUPPRIMER entièrement :
- `src/components/MinorAuthGate.tsx` → remplacer par une porte « date de
  naissance, majeurs seulement » (nouveau composant, ex. `AdultBirthGate`) avec
  les seules props utiles : `userId`, `onReady`, `onBirthDate(iso|null)`,
  `onBirthState`, `error`, `invalidField`, `onBlur`, `anchorRef`, `hint`.
  Garder : lecture/sauvegarde de `profiles.birth_date`, refus « tu dois être
  majeur » (`minorAuth.mustBeAdult` → renommer la clé).
- `src/lib/minorTicketDocs.ts` (et `ageFromBirthDate` s'il n'est utilisé qu'ici).

À NETTOYER :
- `src/pages/TicketCheckout.tsx` : états `minorTemplate`, `minorGateReady`,
  `minorDocPending`, `minorDocUrl`, `minorInfo` ; chargement du modèle
  (l. ~453-474) ; insert `minor_ticket_docs` (l. ~784-802) ; `minorAuthDocUrl`
  dans le corps du checkout (l. ~884) ; `alcoholFree` (l. ~444) ; le composant
  (l. ~1267). Envisager d'envoyer la date comme `ageDeclaration` (comme la table).
- `src/pages/TableCheckout.tsx` : `MinorAuthGate acceptsMinors={false}`
  (l. ~1410) → nouveau composant ; commentaire l. ~185.
- `src/pages/OrderConfirmation.tsx` : `alcohol_free` dans le select (l. ~340),
  `minorDoc` / `minor_auth_doc_url`, bloc l. ~482, `alcoholFree` l. ~505.
- `src/pages/TicketSelection.tsx` : `alcohol_free` dans le select (l. ~162/184).
- `src/pages/Bouncer.tsx` : champ `alcoholFree` partout, alerte « mineur, pas
  d'alcool » (l. ~2414, ~2802, ~3345), selects `alcohol_free` (l. ~1117/1127).
- `src/pages/organizer-app/OrgAppCheckin.tsx` : `alcohol_free` (select l. ~305,
  type l. ~103, prop l. ~1048 / ~1314-1353).
- `src/lib/offline/db.ts` : `alcohol_free` dans le type du manifeste.
- `src/pages/PostCheckoutUpsell.tsx` (l. ~133-136) et
  `src/components/upsell/EventDrinksTeaser.tsx` (l. ~37-40) : sautaient une
  soirée `alcohol_free` → retirer la condition et le select.
- `src/pages/OwnerVenue.tsx` : réglage `minorsAllowed`, upload / retrait du
  document (`handleMinorDocUpload`, `handleRemoveMinorDoc`).
- `src/pages/organizer-app/OrgAppProfile.tsx` : même réglage côté orga.
- `src/pages/OwnerEvents.tsx` : `minors_disabled`, `minorsDisabled`,
  `globalMinorsAllowed` (exclusion par soirée).
- `src/pages/OwnerCustomers.tsx`, `src/pages/organizer-app/OrgAppCustomers.tsx` :
  onglet / filtre « mineurs » (`minorClients`, `fetchMinorEmails`,
  `fetchMinorDocsByEmail`, `minorByEmail`).
- `src/pages/LegacyCustomersRoute.tsx` : `'minors'` dans `KEPT_TABS`.
- `src/components/app-shared.tsx` l. ~106 : entrée de barre latérale
  `minorClients.filter` → `?tab=minors`.
- `src/components/owner/OwnerTicketOrders.tsx` : `minorDocs`, `minorDocFor`,
  colonne / badge mineur.
- `src/components/crm/CustomerTimelineSheet.tsx` : `minorDoc`, `minorRows`.
- `src/pages/admin/AdminOrganizers.tsx` / `AdminOrders.tsx` : vérifier (a priori
  faux positif sur le nom).
- `src/types/ticketing.ts` l. ~231 : `alcoholFree`.
- `src/integrations/supabase/publicColumns.ts` l. ~19-50 : `minors_allowed`,
  `minor_auth_doc_url`, `minor_auth_doc_name` + commentaire → retirer (sinon
  toute lecture publique de venues / organizer_profiles tombe après le DROP).

i18n (3 langues, `src/i18n/locales/{en,fr,es}.ts`) : clés `minorAuth.*`,
`minorClients.*`, `tickets.alcoholFree*`, `*minorDocLabel*`, toute clé
« mineurs / minors / menores » ; `ticketCheckout.birthHint` (version « mineurs
acceptés ») vs `birthHintAdults` → ne garder qu'une phrase majeurs.
Aide : `src/i18n/locales/help/{en,fr,es}.ts` (sections « Mineurs / Minors /
Menores »), `src/data/ownerHelpContent.ts`, `src/data/organizerHelpContent.ts`.
Légal : `src/data/legalContent.ts` (passages « mineur ») → dire « réservé aux
majeurs » ; une modification importante = monter la version dans `LEGAL_VERSIONS`
(à vérifier si le passage change le sens).

## Docs

- `CLAUDE.md` : mention « `MinorAuthGate acceptsMinors={false}` » dans la
  section « Paiement billet — la page Vos infos » → remplacer par le nouveau
  composant ; ajouter une règle « Yuno = majeurs seulement, jamais de système
  mineurs ».
- Chercher « mineur » dans `docs/` (PRD, design systems) et corriger.

## Vérification finale

`npx tsc -p tsconfig.app.json --noEmit` (pas `tsc --noEmit` nu : il ne vérifie
rien), `npm run lint`, `npx vitest run`, `npm run build`, `deno check` des edge
touchées (`python3 scripts/deno-check-edge.py create-ticket-checkout owner-assistant`),
puis grep final : `grep -rniE "minor|mineur|menor|alcohol_free|alcoholFree" src supabase/functions worker scripts` ne doit plus rendre que les faux positifs listés plus haut.

## État

- [x] Cartographie (2026-11-24)
- [x] Front (nouveau composant `src/components/AdultBirthGate.tsx`, clés `birthGate.*`)
- [x] Edge (code) : `create-ticket-checkout` refuse une date déclarée < 18 ans
- [x] Migration écrite : `supabase/migrations/20261220100000_remove_minors_system.sql`,
      répétée en transaction annulée sur la prod (OK, rien modifié)
- [x] Docs, aide (3 langues), `CLAUDE.md`, guide
- [x] Vérifié : tsc, lint (0 erreur), vitest (2 328), build, `deno check`
- [x] Commité et poussé sur `main` (2026-11-24) → le web se redéploie seul (Cloudflare)

### Reste à faire en PRODUCTION, dans cet ordre (feu vert de Paul requis)

La prod de `create-ticket-checkout` était identique à `main` avant ce chantier
(vérifié fichier par fichier le 24/11) : on peut la déployer depuis `main`.

1. **Edge** (compatible dans les deux sens, à faire AVANT la migration : l'ancienne
   version écrit `tickets.minor_auth_doc_url`, qui va disparaître) :
   `supabase functions deploy create-ticket-checkout --use-api`
2. **OTA des deux apps natives** : les bundles installés lisent encore
   `events.alcohol_free` (choix du billet, paiement, confirmation, porte du videur,
   Console). Après la migration, ces écrans tomberaient sur une ancienne version.
   `npm run ota:publish` (ou beta → promote), puis laisser les apps se mettre à jour.
   Attention : l'OTA embarque tout `main` (dont le travail admin des autres sessions).
3. **Migration** : `supabase db push` (ou API + ligne dans `schema_migrations` +
   `NOTIFY pgrst, 'reload schema'`). Vérifier d'abord que personne n'écrit en
   prod (`pg_stat_activity`).
4. **Stockage** (API Storage, clé service, jamais SQL) : supprimer les 3 fichiers
   listés plus haut, puis le bucket `minor-auth-uploads`.
5. `supabase gen types … 2>/dev/null > src/integrations/supabase/types.ts`,
   `python3 scripts/check-selects.py`, `supabase db lint --linked`, commit + push.
