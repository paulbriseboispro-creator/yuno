# Prompt — Yuno Tickets › Clients, Segments, Imports (copie de Yuno CRM)

À coller dans une nouvelle session Claude Code ouverte sur `~/Desktop/yuno-app.nosync`.

---

J'ai besoin que tu transposes dans Yuno Tickets toute la partie **Clients** de Yuno CRM : la liste des clients et la fiche client, les **Segments** (avec le catalogue de segments) et les **Imports** de fichiers. Dans Yuno CRM c'est excellent ; je veux exactement la même chose dans la Console Yuno Tickets (Club `/owner`, Manager `/manager`, Organisateur `/organizer-app`), branchée sur les ventes Yuno. Tout doit être pareil ; adapte seulement les couleurs et les polices à Yuno Tickets. Fais une transposition parfaite : prends tout un par un, vérifie ton travail, et dis-moi quand c'est fini.

## Le modèle à suivre : les Analyses, transposées le 22/10

C'est la deuxième étape d'un chantier déjà commencé. Les Analyses du CRM sont transposées dans Yuno Tickets sur la branche `tix/analytics` (PR https://github.com/paulbriseboispro-creator/yuno/pull/26, à lire en entier avant de commencer, migration `20261109300000_tix_analytics.sql` déjà en prod). Reprends **la même méthode et les mêmes briques**, ne réinvente rien :

- **SQL** : les écrans du CRM lisent des tables temporaires (`_cp` les personnes, `_cr` les contacts, `_cpt` les ventes). Pour Yuno Tickets, on recopie depuis la prod (`pg_get_functiondef`, jamais un vieux fichier de migration) chaque fonction `crm_*`, sous le nom `tix_*`, en remplaçant uniquement la source :
  - `_crm_people_build` → `_tix_people_build` (existe déjà dans la migration des Analyses, à réutiliser et compléter si besoin) ;
  - `contact_build_rows(…, 'crm')` → `contact_build_rows(…, 'suite')` ;
  - `_crm_file_history` → `_tix_file_history` (existe déjà) ;
  - les ventes : `_tix_sales` (billets, tables VIP sans place, guest list en canal `invitation`), les soirées : `_tix_scope_events` ;
  - les campagnes : `NOT crm_campaign_is_crm(id)` ; les contacts, fichiers, accords, imports : `product IS NULL` ;
  - la porte : `_tix_allowed` (via `analytics_scope_gate`), l'argent : `_tix_money_gate`.
  Aucune fonction du CRM n'est modifiée. Toute nouvelle fonction finit par ses `REVOKE` / `GRANT` explicites, et celles qui créent des tables temporaires entrent dans `demo_preview_writable_rpc`.
- **Front** : copie des écrans du CRM dans `src/tickets/…`, avec le script de portage de la session des Analyses (variables CSS `var(--…)` → `var(--ya-…)`, clés `yc.` → `ya.`, couleurs en dur remplacées), le thème `src/tickets/analytics/theme.css` (à partager, pas à recopier), les primitives `src/tickets/analytics/kit.tsx`, `useTixScope` / `useTixRoutes` / `useTixT`, la section de textes `tixana` (`fromCrm.ts` généré + `tickets.ts` qui l'emporte, vouvoiement, jamais le mot Shotgun).
- **Interrupteur** : derrière `TIX_ANALYSES_LIVE` (ou un interrupteur frère) ; l'existant (`OwnerCustomers`, `OrgAppCustomers`, base de contacts `…/campaigns/contacts`, `ContactImportDialog`) reste en place jusqu'à ma validation.

## Ce qu'il y a à transposer dans Yuno CRM

- Écrans : `src/crm/pages/clients/*` (ClientsPage, ClientsOverview, ClientsTable, ClientDrawer, ClientHypotheses), `src/crm/pages/segments/*` (SegmentsPage, SegmentsTable, SegmentDrawer, BestView, MessagesCard, SendsView), `src/crm/pages/imports/*` (ImportsPage, ImportsHome, ImportWizard), `src/crm/components/SegmentCatalog.tsx` et tout ce qu'ils importent.
- Données et règles : `src/crm/data/clients.ts`, `segments.ts`, `segmentCatalog.ts`, `imports.ts`, `src/crm/lib/segments.ts`, `segmentCatalog.ts`, `fileImport.ts`, `filterKeys.ts`, `lifecycle.ts`.
- RPC : `crm_clients_overview`, `crm_clients_list`, `crm_client`, `crm_client_save`, `crm_events_brief`, `crm_audience_count(s)`, `crm_segments_brief`, `crm_segments_overview`, `crm_segment_detail`, `crm_segment_save`, `crm_segment_delete`, `crm_segments_fill_anchors`, `crm_segment_catalog`, `crm_segments_create_many`, `crm_import_check`, `crm_import_commit`, `crm_import_undo`, `crm_imports_overview`, et leurs aides (`_crm_filter_sql`, `_crm_people_build` et ses colonnes, effacement d'un contact, etc.). Fais l'inventaire complet toi-même avant d'écrire une ligne.

## Les décisions à me poser AVANT de coder (AskUserQuestion)

1. **Où vivent les segments de Yuno Tickets.** Les campagnes e-mail, SMS et push de Yuno Tickets visent aujourd'hui `contact_segments` (portée club ET organisateur) et `venue_segments`. Les segments du CRM vivent dans `crm_segments`. Un segment créé dans le nouvel écran doit pouvoir être visé par une campagne de Yuno Tickets sans casser une campagne qui vise un ancien segment. Propose-moi les options (stocker dans `contact_segments` avec la grammaire de filtre du CRM, ajouter un produit à `crm_segments` et l'apprendre au moteur d'envoi, etc.) avec ta recommandation.
2. **« Écrire à… » depuis Clients / Segments** : aujourd'hui les Analyses ouvrent une campagne sans audience pré-remplie. Avec les segments transposés, propose-moi comment une campagne de Yuno Tickets peut partir pré-ciblée.
3. **Imports** : l'import de la Billetterie (`import_contact_list`, attestation de consentement, repoussoir `email_opt_outs`, doublons) doit rester la seule porte d'écriture ; dis-moi comment l'assistant d'import du CRM s'y branche.
4. Tout ce que tu découvres qui n'a pas d'équivalent dans Yuno Tickets (analyse « Ce qui fait venir », score « Chances de venir », hypothèses, Shotgun) : propose de le masquer ou de l'adapter, ne décide pas seul.

## Règles intouchables (lis `CLAUDE.md`, sections Yuno CRM, « deux produits SÉPARÉS » du 20/10, « Yuno Tickets › Analyses » du 22/10)

- Les deux produits restent séparés : aucune donnée du CRM dans Yuno Tickets et inversement (colonnes `product`, `NULL` = Yuno Tickets). Un compte à deux produits (WOH, Amoris) ne voit dans Yuno Tickets que ses contacts, fichiers et accords Yuno Tickets.
- Le consentement ne se contourne jamais : opt-in newsletter non supprimé, SMS < 36 mois sans STOP ; jamais réabonner un désabonné ; la liste de suppression reste commune.
- Chaque chiffre suit `metrics.ts` et `fees.ts` (CA club net des frais Yuno ; la dépense d'un client reste une dépense, jamais un « CA »).
- La prod est sur une petite machine : un test SQL lourd à la fois, chaque migration répétée d'abord en prod dans une transaction annulée (`BEGIN … ROLLBACK`), puis `supabase db lint --linked`. Aucune migration appliquée en prod ni push sans mon accord explicite.
- Travaille dans un worktree à toi (branche `tix/clients`, partant de `tix/analytics` tant que la PR #26 n'est pas fusionnée), commits séparés par sujet, jamais `git add -A`.
- Textes en trois langues, vouvoiement ; mode d'emploi et assistant au moment de la mise en ligne.

## Vérification exigée

- Chiffres comparés à l'existant de Yuno Tickets (base de contacts, Clients) sur la démo club `womber`, la démo organisateur `organizer@womber.fr` et Amoris (House Of Masquerade), en rôle `authenticated` ; chaque écran sous 3 s.
- Captures pleine page avec `scripts/demo/drive.mjs` (le panneau navigateur masqué fige les animations) : ordinateur et téléphone, thème sombre et clair, Club et Organisateur.
- Typage, lint 0 erreur, `npx vitest run`, `npm run build`.
- À la fin : ce qui est fait, ce qui reste, ce qui n'a pas d'équivalent, et la PR prête.
