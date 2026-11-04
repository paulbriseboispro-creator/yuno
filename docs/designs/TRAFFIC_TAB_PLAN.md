# Onglet Trafic : l'attention dans Trafic, l'argent dans Ventes (Yuno Tickets + Yuno CRM)

Demande de Paul (27/10) : l'onglet Trafic des Analyses ne parle que d'argent (ventes
et CA par source). Il doit analyser le trafic lui-même (visites, ce qui a été vu,
combien de temps, quand, d'où), globalement et par soirée. Ce qui touche à l'argent
part dans Ventes, sans supprimer toute mention d'argent dans Trafic.

Maquettes (données d'exemple) :
- Yuno Tickets : https://claude.ai/artifact/N6S7DZADbugTQk4hgF9bWj
- Yuno CRM : https://claude.ai/artifact/TBLxSVE5fQhSq7Lh19SAYo

Chaque canevas a quatre planches : Trafic (toutes les soirées), Trafic (une soirée),
Ventes (ce qui arrive), et une planche « ce qui bouge ».

## 0. La règle commune

- **Trafic se compte en personnes, Ventes en euros.** Trafic garde UN seul pont vers
  l'argent : le passage à l'achat (un pourcentage et un nombre de commandes, jamais
  d'euros dans un tableau) et une phrase en bas de page (« Ces visites ont donné
  N commandes, soit X € ») avec un bouton vers Ventes. Chaque source de Ventes
  renvoie à son trafic.
- **On déplace les composants, pas les calculs.** Les RPC qui attribuent une vente à
  une source (`tix_ana_traffic`, `tix_ana_traffic_detail`, `crm_ana_traffic`)
  restent la source de vérité de l'attribution ; Ventes les appelle. Trafic reçoit
  une RPC NEUVE par produit, qui ne lit que des visites et des clics.
- Grammaire de la page inchangée (kit `anaUi`, héros + phrase, 4 tuiles, « À retenir »
  descriptif, tableaux, couverture) ; un pourcentage n'est jamais montré sous
  10 visites / personnes (`MIN_SAMPLE`) ; médianes pour les durées, jamais des
  moyennes (une page laissée ouverte une nuit fausse tout).
- Filtres de la page : période, soirée (`?e=`), comparaison ; Trafic gagne
  « Comparer avec » sur une soirée (`?ce=`, même règle que Ventes : la précédente de
  la série par défaut).

## 1. Ce qui se mesure, par produit

### Yuno Tickets (Yuno porte la page de vente)

Déjà en base, rien à brancher :

| Mesure | Source |
|---|---|
| Visites, visiteurs uniques, nouveaux / revenus, visite n° | `visitor_sessions` (`visitor_id`, `is_returning`, `visit_number`) |
| Source d'arrivée et détail | `referrer_category`, `referrer_domain`, `utm_*`, `entry_page_type`, lien suivi (`landing_page_full` / `tl=`) |
| Temps passé, pages, défilement | `duration_seconds`, `pages_viewed`, `scroll_depth_max` (médiane réelle 30 j : 149 s) |
| Appareil, app Instagram, langue | `device_type`, `user_agent` (4 % ouverts dans Instagram sur 30 j), `language` |
| Ville, pays, distance au club | `city`, `country_code`, `latitude/longitude` × `venues.latitude/longitude` |
| Tunnel de la page soirée | `event_funnel_events` : viewed → selected → details → checkout/payment → purchased (36 894 vues / 3 596 achats sur 60 j) |
| Paiements ratés et raison | `event_funnel_events` step `failed`, `reason` (network, validation, server, sold_out) |
| Partages, liste d'attente | steps `shared`, `waitlist` |
| Clics des liens suivis | `tracked_link_clicks` (appareil, pays, site d'origine) |
| Artistes cliqués | `guest_artist_link_clicks` |
| Repères d'une soirée | `get_event_report.markers` (publication, nouveau tarif, e-mails, push) |

À brancher (lot T6, facultatif, décision D3) :
- `events.tickets_sold_out_at` (posé par trigger au passage « Complet », manuel ou
  stock épuisé) : sans lui, « Visites après Complet » n'est pas datable.
- `visitor_events` pour line-up / plan / vidéo ouverts et « billet Épuisé vu ».
- page suivante après la page du club (quelle soirée est ouverte depuis la page).

### Yuno CRM (la page de vente est chez Shotgun)

Déjà en base :

| Mesure | Source |
|---|---|
| Clics des liens /go/ (stories, bios, partenaires, SMS) | `tracked_links` × `tracked_link_clicks` (2 339 clics CRM à ce jour) |
| Personnes | empreinte salée DU JOUR (`visitor_id`) : une personne par jour et par lien, jamais sur 30 jours. L'écran le dit. |
| Pages d'inscription | `crm_signup_visits` (page, jour, empreinte, `src` : instagram-story, instagram-bio, tiktok-bio, flyer-qr, whatsapp, direct) × `crm_signup_entries` |
| Clics d'e-mails et de SMS | événements des campagnes CRM (nominatifs pour l'e-mail) ; SMS par leur lien court |
| A cliqué sans acheter | règle de la recette `click_no_buy` (`_link_base`, `_email_event_holder`) |
| Plateforme d'achat | `external_tickets.utm->>'utm_medium'` : app 66 %, website 33 % (rendu par Shotgun) |
| Commandes d'un lien | `utm_source = yuno-<code>` (alias compris, `tracked_link_id_for_code`), règle de `crm_night_links` (« en attente » avant la 1re vente) |

À brancher (lot C1) : `tracked_link_clicks.in_app` (Instagram, Facebook, TikTok),
calculé dans `crm_link_hit` ET `record_tracked_link_click` depuis le user-agent qu'ils
reçoivent déjà. Le bouton d'une page /j/ vers Shotgun passe par un lien /go/ de la
page (clic mesuré).

Bientôt, avec l'intégration Shotgun (jamais estimé) : visites de la page Shotgun,
temps passé, paniers abandonnés, page → achat, vues venues d'Instagram sans lien Yuno.

## 2. Plan Yuno Tickets

Fichiers : `src/tickets/analytics/{TrafficTab,TrafficDetail,SalesTab,KeptBlocks,data}.ts(x)`,
textes `src/i18n/locales/tixana/modules/traffic.ts` (triplets [EN, FR, ES]).

**T1. RPC `tix_ana_visits(p_venue_id, p_organizer_user_id, p_period, p_event, p_compare)`**
(migration neuve, SECURITY DEFINER, STABLE, REVOKE / GRANT authenticated, porte
`analytics_scope_gate`, aucune table temporaire pour rester lisible en aperçu démo).
- Portée : pages soirée de `_tix_scope_events` (menées + partenaire d'un contrat) et
  page du club / de l'organisateur. Pas de garde d'argent : aucun montant rendu, sauf
  `bridge.revenue` (CA total de la période, sous `_tix_money_gate`, pour la phrase du bas).
- Rend : `meta` (cases comme `_tix_ana_setup`), `totals` (visites, visiteurs, % nouveaux,
  durée médiane plafonnée à 2 h, pages par visite, passage à l'achat, `prev_*`),
  `series` (visites par case × famille), `sources` (famille, enfants par domaine / lien
  suivi / campagne, visites, visiteurs, médiane durée, médiane défilement, commandes,
  passage), `engagement` (bandes de durée, paliers de défilement 25/50/75/100,
  clics d'artistes, partages), `funnel` (+ `failed` par raison), `heat` (7 × 24, heure
  de Paris), `devices`, `in_app`, `langs`, `cities` (6 + autres, `abroad` par pays),
  `nights` (visites, visiteurs, médiane, passage), `page` (reprend `tix_ana_traffic_detail.page`),
  `links` (clics, personnes, part téléphone, clic → achat), `keep` (constats calculés,
  seuils en SQL, textes `ya.tr.tk.*`).
- Mode soirée (`p_event`) : courbe cumulée J-N de la soirée et de la soirée comparée
  (jours calendaires de la soirée, comme `buildCurve`), `markers` de `get_event_report`,
  heures de la journée, distance au club (< 30 km, 30-150, plus loin), artistes,
  « déjà venus chez vous » parmi les visites connectées (`user_id` × billets passés de la portée).
- Index : ceux de `visitor_sessions` suffisent ((event_id, visited_at),
  (venue_id, visited_at), (organizer_user_id, visited_at)) et
  `event_funnel_events (event_id, created_at)`. Cible < 1 s sur le plus gros compte, 12 mois.
- Vérif : transaction annulée sur la prod, claims d'un owner démo puis d'Amoris, UN
  test lourd à la fois ; égalité visites / tunnel avec `get_visit_analytics` et
  `get_event_traffic` sur les mêmes fenêtres.

**T2. Trafic, toutes les soirées** : réécriture de `TrafficTab.tsx` selon la planche 1
(héros visites par source + bascule visites / visiteurs, « À retenir », 4 tuiles,
« D'où arrivent-ils ? » dépliable, « Que font-ils sur la page ? », « Du coup d'œil à
l'achat », « Quand regardent-ils ? », écran / langue, villes, soirées, page du club,
liens suivis, pont vers Ventes). Hook `useAnaVisits(f, enabled)`. Export CSV = les
sources de visites.

**T3. Trafic, une soirée** : planche 2, même composant en mode `ev`, sélecteur
« Comparer avec » (`?ce=`).

**T4. Ventes, « Ce qui a fait vendre »** : planche 3. Déplacer (pas réécrire) depuis
`TrafficTab` / `TrafficDetail` : le graphique empilé par source (bascule euros /
billets), le tableau des sources avec `SourceLinks`, `MessagesCard` fusionnée dans la
carte noire `madeT`, « Qui vous découvre ? », et la colonne « Nouveaux clients » dans
« Quelles soirées marchent le mieux ? ». `SalesTab` appelle `useAnaTraffic` +
`useAnaTrafficDetail` (déjà en place). Position : après « Quels billets se vendent ? »,
avant « Ce que vous touchez ». En soirée choisie, la même partie sous le rapport.

**T5. Ménage et récit** : supprimer `TrafficKept` et, s'ils n'ont plus d'appelant,
`AcquisitionDashboard`, `BehaviorAnalytics`, `behaviorPrimitives` ; mode d'emploi
(`ohelp.*` Analyses, club + orga, 3 langues), article `owner-assistant`
(`console-help-articles.ts`, redéployer), outil MCP `get_web_traffic` repointé sur
`tix_ana_visits` pour un compte Billetterie (même nom d'outil, description à jour).

**T6 (facultatif, D3).** `events.tickets_sold_out_at` + trigger, `visitor_events`
(line-up, plan, vidéo, épuisé vu), page suivante. Puis on retire les pastilles
« À brancher » des écrans.

## 3. Plan Yuno CRM

Fichiers : `src/crm/pages/analytics/{TrafficTab,SalesTab,AnalyticsPage}.tsx`,
`src/crm/data/analytics.ts`, `src/crm/components/ShotgunSoon.tsx`, textes
`src/i18n/locales/crm/modules/*` (clés `yc.tr.*`).

**C1. `tracked_link_clicks.in_app`** (text NULL : `instagram` | `facebook` | `tiktok`),
posé par `crm_link_hit` et `record_tracked_link_click` depuis `p_ua` ; fonctions
réécrites depuis `pg_get_functiondef` de la prod. Bouton de la page /j/ vers Shotgun
par un lien /go/ de la page (créé avec la page, `utm_source = yuno-<code>`).

**C2. RPC `crm_ana_clicks(p_venue_id, p_organizer_user_id, p_period, p_event, p_compare)`**
(porte `crm_scope_allowed`, STABLE, sans table temporaire, REVOKE / GRANT ; entre dans
`demo_preview_writable_rpc` seulement si elle en crée).
- Familles par emplacement du lien (`_crm_link_kind_ok` / `LINK_KINDS` : story, bio
  Instagram, bio TikTok, partenaire, SMS, autres) + e-mails (clics des campagnes CRM).
- Rend : `totals` (clics, personnes-jour, part dans Instagram, clic → achat, `prev_*`),
  `series` (clics par case × famille), `marks` (création de lien, envois e-mail / SMS),
  `links` (clics, personnes, part Instagram, heure de pointe, commandes rapportées,
  clic → achat, `confirmed`), `pages` (visites, inscrits, taux par page et par `src`),
  `messages` (reçus, cliqueurs, taux, par campagne ; aucun montant), `click_no_buy`
  (compte, règle de la recette), `heat` (7 × 24), `devices`, `countries`,
  `platform` (app / site / widget, toutes ventes et ventes venues d'un lien Yuno),
  `nights` (clics, personnes, liens actifs, inscrits, clic → achat), `keep` (`yc.tr.tk.*`).
- Mode soirée : courbe cumulée J-N vs soirée comparée (même série d'abord), tunnel de
  la page de prévente (vues → inscrits → confirmés → ont pris une place, billet Shotgun
  à la même adresse), heures, liens de la soirée (reprend `crm_night_links`).
- Banc : `scripts/crm-bench` (PGlite, comptes `demo` / `grand`), `same-as-prod.mjs`
  avant toute réécriture, puis la prod en transaction annulée, seul.

**C3. Trafic, toutes les soirées** (planche 1) et **C4. une soirée** (planche 2).
`ShotgunSoonCard` garde ses items (`visits`, `conv`, `carts`) + `page`, à la fin.

**C5. Ventes, « Ce qui a fait vendre »** (planche 3) : graphique empilé et tableau des
sources (depuis `crm_ana_traffic`), `PartnersCard` déplacée, carte noire `madeT` qui
gagne la liste des messages, « Qui vous découvre ? », colonnes « Nouveaux » et
« Via Yuno » dans les soirées. Ajouts ADDITIFS à `crm_ana_traffic__core` : `links`
(commandes et CA par lien Yuno de la période) et `messages` (CA par campagne,
`_crm_email_attrib`) ; aucune clé retirée (le MCP `get_web_traffic` la lit).

**C6. Récit et démo** : FAQ `yc.faq.traffic.*`, article assistant `crm-traffic`
(redéployer `owner-assistant`), MCP `get_web_traffic` (clics ajoutés à sa réponse),
semis démo des clics (`scripts/demo/seed-crm-links.sql` : appareil, pays, heure, `in_app`)
et des visites de pages /j/.

## 4. Décisions à valider par Paul

- **D1 Le pont vers l'argent dans Trafic** : passage à l'achat (pourcentage + nombre de
  commandes) dans les tableaux, et UNE phrase en euros en bas de page. Recommandé.
- **D2 « Personnes » dans le CRM** : comptées une fois par jour et par lien, faute
  d'identifiant durable (choix de vie privée du 05/10). On l'écrit sous le chiffre plutôt
  que d'allonger l'empreinte. Recommandé.
- **D3 Mesures neuves de Yuno Tickets** (date du « Complet », line-up / plan / vidéo
  ouverts, billet épuisé vu, page suivante) : lot T6 après le reste, ou plus tard.
- **D4 Ordre** : Tickets et CRM en parallèle, une session chacun, dans son worktree.

## 5. Deux sessions, sans se marcher dessus

- Tickets touche `src/tickets/analytics/*`, `src/i18n/locales/tixana/*`, ses
  migrations `tix_*`. CRM touche `src/crm/*`, `src/i18n/locales/crm/*`, ses migrations
  `crm_*` et `tracked_link_clicks.in_app`. Fichier commun possible :
  `supabase/functions/_shared/console-help-articles.ts` (une section chacun) et
  `CLAUDE.md` (une section chacun, ajoutée à la fin) ; `git fetch origin main` et un
  horodatage de migration absent de main avant de nommer un fichier.
- Chacune : `npx vitest run`, `npm run lint` (0 erreur), `npm run build`, puis
  vérification dans le navigateur sur un compte démo (`scripts/demo/drive.mjs`).
