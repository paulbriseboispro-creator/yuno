# Brief — Automatisations email v2 : trois recettes de plus, audiences automatiques, suggestions au pro

> Brief d'exécution écrit le 2026-09-15 pour une session dédiée. Statut : **à construire**.
> Lire d'abord CLAUDE.md § « Automatisations email » et § « Politique d'envoi Yuno »,
> puis `docs/designs/EMAIL_AUTOMATION_PLAN.md` (doctrine + addendum politique).
> Tout ce qui suit s'appuie sur du code livré et déployé le 15/09 : ne rien recréer.

## 0. Ce qui existe déjà (ne pas refaire)

| Brique | Où | Ce qu'elle fait |
|---|---|---|
| 6 recettes | `email_automations` (kind), `collect_email_automations()` (migrations `20260915120000` + `140000`) | abandoned_checkout, last_call, post_event_thanks, post_event_missed, welcome, win_back |
| Registre des envois | `email_automation_sends` (unique automation × trigger_key × email, raison d'exclusion écrite au moment dû) | garantie anti-doublon, bilan |
| Campagnes enfants | `email_campaigns.automation_id`, `child_kind = 'automation'`, une par (recette, soirée), `status = 'sending'`, drainées par `sweepSendingCampaigns` | même file, même quota, même liste de suppression, mêmes liens suivis, même attribution |
| Politique anti-spam | `email_send_policy(email, kind)` + `email_marketing_pressure()` + `marketing_email_log` | pression 1/24 h · 3/7 j (auto), 2 · 5 (urgent), 3 · 8 (campagne) ; fatigue 8 envois/90 j sans ouverture ; aversion 2 désabonnements/30 j ; « une soirée, un message » tous expéditeurs, le pro avant Yuno |
| Modèles Yuno | `src/lib/email/starters.ts` (`auto_<kind>`, 3 langues dans `src/i18n/locales/{fr,en,es}.ts` clés `studio.starter.auto_*`) | créés d'un clic quand le pro allume ; retouchables dans le Studio |
| Page pro | `src/components/campaigns/EmailAutomationsPanel.tsx` (club, orga ET plateforme), `AUTOMATION_META` dans `src/lib/email/automations.ts` | interrupteur, délai, modèle, objet, bilan, exclus avec raison |
| Stats | `get_email_automation_stats(p_venue_id, p_organizer_user_id)` | par recette : en file, envoyés, ouvertures, clics uniques, désabonnés, exclus, ids des enfants (revenu via `get_email_campaign_attribution`) |
| Aperçu et test | `FollowupPreviewDialog` + `send-campaign` (`send_test` + `automation_id`) | l'email tel qu'il partira avec la prochaine soirée |
| Assistant owner | `list_email_automations`, `set_email_automation` (owner-assistant) | lecture + allumer/éteindre/délai |
| Mode d'emploi | `ohelp.pg.campaigns.s19-22` (owner), `ohelp.org.campaigns.s10-13` (orga), `src/data/{owner,organizer}HelpContent.ts` | |

Invariants à respecter au mot près : rien n'entre dans une campagne sans passer par le
registre de consentement (`newsletter_subscriptions`, portée club / orga / plateforme via
`marketing_scope_match`) ; les exclusions se posent dans le CASE `judged` de
`collect_email_automations`, jamais dans le Deno ; un enfant sans soirée reliée perd ses
blocs Yuno (`_email_blocks_without_live`) ; « merci » et « on t'a manqué » exigent un scan.

## 1. Les trois recettes à ajouter

Même mécanique que les six existantes : un `kind` dans le CHECK de `email_automations`, une
branche « candidats » dans `collect_email_automations`, une entrée `AUTOMATION_META`, un
starter `auto_<kind>` en 3 langues, les clés `em.auto.kind.<kind>.*` (title, desc, trigger,
rule1-3), l'article assistant, le mode d'emploi. Chaque recette = une seule campagne
enfant par (recette, soirée) ; `trigger_key` = id de la soirée.

### 1a. `table_upsell` — « Passe en table »
- **Cible** : détenteurs d'un billet payé (`tickets.status IN ('paid','used')`, email connu)
  pour une soirée à venir, sans réservation de table (`table_reservations` paid/pending
  absente pour cet email), tant que `events.tables_enabled AND NOT tables_sold_out` et qu'au
  moins une formule/table est encore libre (réutiliser la logique `tablesLeft` de
  `fetchStudioLiveData` côté SQL, ou une RPC existante de disponibilité).
- **Délai** : `delay_hours` AVANT le début, options 48 / 72 / 120 / 168 h, défaut 72.
- **Consentement** : opt-in registre de la portée (comme les autres) ; l'accord coché au
  checkout est déjà versé par le trigger d'achat.
- **Contenu du starter** : header, texte court (« tu as ton billet, voilà la soirée en mieux »),
  bloc Table VIP live `cond: null`, layout `showcase`, kicker « Entre amis », 3 perks
  (coupe-file, carré à vous, hôte dédié), note (acompte / arrivée), CTA « Voir les tables » ;
  accent or par défaut (déjà le défaut du bloc). Pas de bloc Billetterie (ils ont déjà leur
  billet).
- **Palier de pression** : `automation` (1/24 h). Une seule fois par personne et par soirée.
- **Ne pas confondre** avec le push `vip_upsell` (`push-automations.ts`) : il reste ; l'email
  est la version « design du pro » pour les gens sans app.

### 1b. `tier_closing` — « Le tarif monte »
- **Cible** : personnes qui ont montré un intérêt pour la soirée sans acheter : clic sur un
  lien de la soirée dans une campagne/recette (`email_campaign_events` `clicked` sur un lien
  `/l/`, `/event`, `/events`, comme `collect_campaign_followups`) OU inscrit en liste
  d'attente de la soirée (`event_waitlist`) ; toujours filtré par l'opt-in du registre.
- **Déclencheur** : le palier de billetterie ouvert (`ticket_rounds`, mode paliers) a
  `tickets_sold >= 85 %` de son quota, il reste ≥ 1 billet, et un palier suivant plus cher
  existe. Un seul envoi par personne et par soirée, quel que soit le nombre de paliers.
  Lire le schéma réel de `ticket_rounds` (quota, ordre, `manually_sold_out`, prix) dans
  `src/integrations/supabase/types.ts` avant d'écrire la requête ; ne rien deviner.
- **Délai** : pas un délai, un seuil ; garder `delay_hours` = 0 et masquer le sélecteur
  (ajouter `meta.noDelay`), ou proposer le seuil (75 / 85 / 95 %) dans `delay_hours`
  détourné → préférer une colonne `threshold_pct` propre sur `email_automations`.
- **Contenu du starter** : header, texte (« il reste N billets à ce prix, ensuite c'est X € »),
  bloc Billetterie live `priceDisplay: 'rows'` (montre que la prévente monte), compte à
  rebours, CTA. Layout `banner` : c'est une relance courte.
- **Palier de pression** : `urgent` (2/24 h, 5/7 j) — c'est une rareté réelle.

### 1c. `new_event` — « Nouvelle soirée »
- **Cible** : toute la base opt-in de la portée (imports compris — c'est LA recette qui met
  une base importée au travail), sauf ceux qui ont déjà billet / table / place.
- **Déclencheur** : `events.published_at` (pas `created_at`, pas une régénération de modèle
  récurrent : voir `get_new_events_to_announce()` du push `new_event`, même règle), soirée
  `status IN ('published','featured')`, `is_active`, non annulée, qui vend quelque chose,
  start_at > now + 48 h. Envoi `delay_hours` après la publication (2 / 6 / 24 h, défaut 6).
- **Anti-rafale** : un club qui publie 6 dates d'un coup ne doit produire QU'UN email par
  contact sous 7 jours. Règle : la recette n'annonce que la soirée la plus proche parmi
  celles publiées sous 24 h, et le cooldown 48 h + la pression 3/7 j font le reste. Écrire
  `already_event` / `cooldown` dans le registre pour les autres, pour que le bilan l'explique.
- **Contenu du starter** : reprendre `invitation` (header, texte, carte Soirée `showcase`
  affiche en grand, Billetterie live, Liste invités, texte de fin). C'est l'email d'annonce.
- **Palier de pression** : `automation`.

## 2. Audiences automatiques : le pro n'a rien à choisir

Le pro ne choisit JAMAIS l'audience d'une recette. Le moteur la calcule, dans cet ordre,
et l'explique :

1. **Source** = registre de consentement de la portée (`newsletter_subscriptions` opt-in,
   non supprimé), donc : achats, guest list, formulaire, suivi, **et fichiers importés**.
   Une base importée est entière éligible à `new_event`, `last_call`, `win_back` ; jamais
   à `welcome` (déjà exclu) ; `abandoned_checkout`, `table_upsell`, `tier_closing`,
   `post_event_*` partent de faits (checkout, billet, clic, scan) et n'ont pas de base.
2. **Exclusions au moment dû** (CASE `judged`) : déjà dedans (billet/table/place), acheté
   depuis, désabonné, supprimé, cooldown 48 h, une soirée un message, puis
   `email_send_policy`.
3. **Priorité quand la base dépasse ce que le quota du jour permet** : ordonner les
   candidats par engagement décroissant avant `LIMIT` — (a) a ouvert ou cliqué sous 90 j,
   (b) est venu sous 180 j (scan / billet payé), (c) inscrit sous 30 j, (d) le reste. Le
   quota et le rodage (`email_sender_daily_cap`) restent gérés par la file : les non-servis
   partent le lendemain, ce n'est pas un échec. Ajouter ce tri dans les branches
   `last_call`, `new_event`, `win_back`.
4. **Ce que le pro voit** : sur chaque recette, une ligne « Yuno cible : … » générée à
   partir de la définition (ex. « toute ta base sans billet, les plus engagés d'abord »),
   et le compteur « éligibles maintenant » (nouvelle RPC
   `preview_email_automation(p_venue_id, p_organizer_user_id, p_kind)` → `{ eligible,
   next_event_title, next_due_at }`, SECURITY DEFINER, garde `_email_scope_guard`,
   requête légère : compter, pas lister).

## 3. Le système de suggestions (« Yuno te propose d'allumer… »)

RPC `get_email_automation_suggestions(p_venue_id, p_organizer_user_id)` → tableau de
`{ kind, reason_key, reason_vars, reach }`, calculé sur des faits des 30 derniers jours,
démo exclue, et SEULEMENT pour les recettes éteintes :

| kind | Condition | reason_key (3 langues) |
|---|---|---|
| abandoned_checkout | ≥ 3 checkouts pending non payés sur 30 j | `em.auto.sug.abandoned` « {n} paniers abandonnés ce mois, personne ne les a relancés » |
| last_call | prochaine soirée sous 10 j qui vend encore, base ≥ 50 | `em.auto.sug.lastCall` « {event} dans {d} jours, {n} contacts sans billet » |
| table_upsell | prochaine soirée avec tables libres et ≥ 20 billets vendus | `em.auto.sug.tableUpsell` |
| new_event | ≥ 1 soirée publiée sur 30 j sans campagne reliée (aucune `email_campaigns.event_id` = elle) | `em.auto.sug.newEvent` |
| post_event_thanks / missed | ≥ 1 soirée passée avec scans sur 30 j | `em.auto.sug.thanks` / `.missed` |
| win_back | ≥ 30 clients silencieux depuis 60 j | `em.auto.sug.winBack` |
| welcome | ≥ 10 nouvelles inscriptions sur 30 j | `em.auto.sug.welcome` |
| tier_closing | soirée en mode paliers avec un palier > 70 % | `em.auto.sug.tier` |

Surfaces : (1) bandeau « Suggestions » en tête de la page Automatisations avec bouton
« Allumer » (crée le modèle Yuno + enable, comme `toggle`) ; (2) une carte sur la page
Campagnes (club + orga) quand ≥ 1 suggestion ; (3) une notification `staff_notifications`
/ `organizer_notifications` type `automation_suggested` UNE fois par recette et par mois
(dedup via `dedup_key`), catalogue `NOTIF_CATALOGUE` + `notif.type.*` ×3. Jamais de push.

## 4. Traçabilité pour le pro

- Chaque recette : « prochains départs » = les lignes `queued` du registre avec `due_at`
  future (compte + première date) ; « cette semaine » = envoyés / ouvertures / clics /
  ventes attribuées sur 7 j (dériver de `get_email_automation_stats` en ajoutant une
  fenêtre `p_days`).
- Chaque enfant reste une campagne avec son rapport complet (déjà le cas).
- Bilan hebdomadaire : étendre `audience-weekly-recap.ts` (push owner du lundi) d'une ligne
  « automatisations : X emails, Y ventes attribuées » — pas un nouvel email.
- Le CRM client (`CustomerTimelineSheet`) affiche les emails automatiques reçus par la
  personne, via `email_automation_sends` (kind + date + statut). Vérifier le composant avant.

## 5. Design des modèles

- Un starter par recette, même grammaire que les six existants (`starters.ts`), 3 langues,
  aucun texte en dur hors i18n. Kicker, accroche, perks et note REMPLIS (c'est ce qui rend
  l'email vendeur, pas la structure). Layouts : `banner` pour l'urgent (tier_closing,
  abandoned), `showcase` pour l'annonce (new_event, table_upsell).
- Vérifier chaque starter par un test vitest qui le rend via `renderEmailHtml` avec un
  `live` complet ET avec `live` vide (aucune ligne d'exemple ne doit fuiter), à côté des
  tests existants dans `src/lib/email/__tests__/`.
- Ne pas toucher au renderer ni au port Deno sauf nécessité ; si un bloc change de forme,
  répercuter dans `supabase/functions/_shared/email-studio-html.ts`.

## 6. Obligations de fin de chantier

1. i18n ×3 pour chaque clé (main dictionary pour `em.auto.*`, section `help` pour `ohelp.*`).
2. Mode d'emploi owner + orga : compléter `ohelp.pg.campaigns.s19b` / `ohelp.org.campaigns.s10b`
   (liste des recettes) et ajouter une section « Yuno choisit qui reçoit quoi ».
3. `owner-assistant` : article `email-automations` (les 9 recettes, les suggestions), tool
   `set_email_automation` accepte les nouveaux kinds ; redéployer.
4. CLAUDE.md § « Automatisations email » : les 9 recettes, la priorité par engagement, les
   suggestions.
5. Validation : `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run`, `vite build` sur
   un worktree HEAD, `supabase db push`, `supabase db lint --linked` (faux positifs connus :
   `_auto_cand`, cast `uuid[]`), smoke test en transaction annulée via `supabase db query
   --linked -f` avec `set_config('request.jwt.claims','{"role":"service_role"}',true)` :
   créer les 3 recettes sur le club démo, appeler `collect_email_automations()`, lire
   `email_automation_sends`, ROLLBACK.
6. Déployer `process-scheduled-campaigns` seulement si le Deno change (le moteur est SQL),
   `owner-assistant` toujours. Commits bisectés, `git add <fichiers>` explicites, push avec
   `git -c 'credential.helper=!gh auth git-credential' push`.

## 7. Pièges connus de ce dépôt (lire avant de coder)

- Plusieurs sessions Claude partagent ce working tree : `git status` montre des fichiers
  d'autres sessions (rosterExport, OwnerVipOrders, MyOrders, seed démo, deno.lock). Ne
  jamais les stager, ne jamais `git stash`.
- Le hook RTK peut inventer des contenus : lire avec l'outil Read ou `/usr/bin/sed`,
  `/usr/bin/grep`, `/usr/bin/git`.
- Une fonction plpgsql `STABLE` ne peut pas créer de table temporaire ; le moteur utilise
  `_auto_cand` en `ON COMMIT DROP` dans une fonction VOLATILE.
- `venues.id` est `text`, `events.id` est `uuid`, `email_campaigns.venue_id` est `text`.
- `= ANY(sous-requête)` ≠ `= ANY(tableau)` ; `EXISTS` ou `= ANY(fonction())` matérialisé.
- Tout compte affiché vient d'une RPC, jamais d'un `select` agrégé côté front.
