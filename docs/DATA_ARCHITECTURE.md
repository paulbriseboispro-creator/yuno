# Architecture data — Yuno

> Audit d'intégrité relationnelle, permissions et isolation multi-tenant.
> Établi le **2026-07-04** contre la base live `fulawxvdlwtdlpkycixe` (SELECT + dry-run
> en transactions ROLLBACK, aucune donnée modifiée). Tenir à jour à chaque changement
> de schéma sensible.

Le prompt d'audit d'origine visait un autre modèle (routes `app/api/`, migrations
numérotées `005/006`, table `admin_profiles`, rôle `city_admin` Madrid/Barcelone).
**Rien de tout ça n'existe dans Yuno** : SPA Vite + Supabase, 524 migrations timestampées,
admin plateforme = fonction `is_super_admin()`, isolation scopée par **club (venue)**,
**organisateur** et **staff-venue**. Ce document décrit le vrai modèle.

---

## 1. Les 13 profils

Rôles = enum `app_role` (13 valeurs) matérialisés dans `user_roles(user_id, role)`.
Les guards front (`src/components/*Route.tsx`) valident le rôle + une session (MFA ou PIN).

| # | Rôle (`app_role`) | Stockage identité | Guard front | Portée / scope | Session |
|---|---|---|---|---|---|
| 1 | `client` | `user_roles` (défaut) | — (accès public) | soi-même | — |
| 2 | `owner` | `user_roles` + `venues.owner_id` | `OwnerRoute` | ses venues (`is_venue_owner`) | MFA |
| 3 | `manager` | `manager_permissions(user_id, venue_id, can_*)` | `ManagerRoute` | venue(s), permissions granulaires | PIN |
| 4 | `barman` | `user_roles` + `profiles.venue_id` | `BarmanRoute` | son venue | PIN |
| 5 | `bouncer` | `user_roles` + `profiles.venue_id` | `BouncerRoute` | son venue | PIN |
| 6 | `vip_host` | `user_roles` + `profiles.venue_id` | `VipHostRoute` | son venue | PIN |
| 7 | `cloakroom` | `user_roles` + `profiles.venue_id` | `CloakroomRoute` | son venue | PIN |
| 8 | `dj` | table `djs(user_id, venue_id)` | `DJRoute` | rattaché à un venue | PIN |
| 9 | `promoter` | table `promoters(user_id, venue_id)` | `PromoterRoute` | rattaché à un venue | PIN |
| 10 | `organizer` | table `organizer_profiles` + `events.organizer_user_id` | `OrgAppRoute` | ses events (à plat) | MFA |
| 11 | `affiliate` | table `affiliates(user_id)` | `AffiliateRoute` | son agence d'affiliation | MFA |
| 12 | `affiliate_member` | `affiliate_members(affiliate_id, user_id)` | `AffiliateRoute` | sous un affiliate | PIN |
| 13 | `agency` | table `agencies(owner_user_id)` | `AgencyRoute` | agence promoteurs (`is_agency_owner`) | MFA |

**Super admin** : `role='admin'` dans `user_roles` → fonction `is_super_admin()`
(l'ancien email hardcodé `antoine.music@outlook.fr` a été retiré, migration
`20260220191056`). Pas de route dédiée, checks inline.

**Fonctions helper d'autorisation** (SECURITY DEFINER, utilisées dans les RLS) :
`has_role(uid, role)`, `is_super_admin()`, `is_venue_owner(uid, venue_id)`,
`can_manage_venue(uid, venue_id)` (owner OU manager), `manager_has_permission(...)`,
`is_agency_owner(uid, agency_id)`, `get_user_venue_id(uid)`.

**Note d'historique** : les tables `organizers`, `event_organizers`, `venue_organizers`,
`organizer_team_members` de vieilles migrations **n'existent plus** en live. Le lien
organisateur↔event est aujourd'hui à plat sur `events.organizer_user_id` (FK vers
`profiles`, CASCADE). Seul `organizer_profiles` subsiste. `event_collab_invitations.organizer_id`
pointe encore vers l'ancienne table `organizers(id)` disparue → **colonne legacy** (0 ligne,
voir §5).

---

## 2. Épine dorsale relationnelle

```
venues (id TEXT, owner_id → profiles)         cities = colonne TEXT, pas de table
  │
  ├─ events (venue_id → venues, CASCADE)  ✅ FK confirmée live (20260308121342)
  │    ├─ organizer_user_id → profiles (CASCADE)      ← "propriétaire" event
  │    ├─ partner_organizer_id → profiles (SET NULL)  ← co-event
  │    ├─ partner_venue_id → venues (SET NULL)
  │    ├─ ticket_rounds / tickets            (event_id CASCADE)
  │    ├─ table_reservations                 (event_id CASCADE)
  │    ├─ guest_lists → guest_list_entries   (event_id CASCADE)
  │    ├─ event_djs  [lineup]                (event_id + dj_id CASCADE, UNIQUE)
  │    └─ event_collab_contracts             (event_id CASCADE)
  │
  ├─ drinks / vip_tables / vip_menu_items / table_zones   (venue_id CASCADE)
  ├─ orders (venue_id → venues, NO ACTION ⚠)  + event_id
  ├─ djs → dj_sets / dj_payments             (venue_id / dj_id CASCADE)
  └─ promoters → promoter_clicks / _conversions

profiles (id = auth.users.id) ── venue_id → rattachement staff
```

**DJ ↔ events (lineup)** : `event_djs(event_id, dj_id)` FK + `UNIQUE(event_id, dj_id)`.
`dj_sets` porte le timing/cachet par set (relation distincte, ne pas confondre).

**Ville** : Yuno n'a **pas** de table `cities`. La ville est un TEXT libre
(`venues.city`, `organizer_profiles.city`, `events.location_city`) → doublons possibles
(`"Paris"` vs `"paris"`), pas de normalisation. Acceptable au stade actuel ; à surveiller
si un jour on route la découverte par ville canonique.

---

## 3. État des permissions (RLS) — vérifié live

- **0 table sans RLS** dans `public` (toutes en `ENABLE ROW LEVEL SECURITY`).
- **8 tables** RLS-on / **0 policy** = **deny-all volontaire** (accès uniquement via
  edge functions `service_role`, qui bypasse la RLS) :
  `affiliate_invitations_meta`, `dj_handle_aliases`, `event_sale_access`,
  `event_sale_protection`, `guest_claim_otps`, `organizer_slug_aliases`,
  `pin_reset_tokens`, `ticket_reservations`. ✅ **Correct** — ce sont des OTP / tokens /
  alias jamais lus directement par le client.

> ⚠️ L'analyse statique des 524 migrations annonçait « 149/191 tables sans policy » :
> **artefact de grep** (rate les policies du dump initial + recréations). Le chiffre réel
> live est 8, tous justifiés. Toujours vérifier la RLS contre `pg_policies`, pas les migrations.

### 3.1 Résultats des tests d'isolation multi-tenant (read-only, transactions ROLLBACK)

Méthode : `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …)` pour
impersonner un `auth.uid()`, puis comptage cross-tenant. Comptes réels : owner A =
`womber` (`a810aed8…`), owner B = `irish` (`467789f2…`).

| Test | Attendu | Avant | Verdict |
|---|---|---|---|
| Owner B lit orders/tickets/gle/promoters/manager_perms/campaigns/sms/vip/résas/invoices/revenue/profils-staff de **womber** | 0 | **0 partout** | ✅ isolation OK |
| Owner B lit `guest_lists` de womber | 0 | **6** | ❌ fuite (corrigée, §4) |
| Owner B lit **tous** les `security_logs` | ses users only | **31 (tous)** | ❌ fuite (corrigée par `20260703130000`) |
| Anon lit `orders/tickets/gle/invoices/sms/profiles/promoters/manager_perms/revenue/seclogs` | 0 | **0 partout** | ✅ |
| Anon lit `guest_lists` | listes publiques only | **25 dont 10 masquées** | ❌ fuite (corrigée, §4) |
| Anon lit `notification_log` | 0 | **6** | ❌ fuite (corrigée par `20260703130000`) |
| Anon lit `org_members` (email, token, pin_hash) | 0 | **2** | ❌ fuite (corrigée par `20260703130000`) |
| Anon lit `vip_consumption_facts` (CA VIP cross-club) | 0 | **6** | ❌ fuite (corrigée par `20260703130000`) |

**Conclusion** : l'isolation par venue tient sur toutes les tables transactionnelles
(commandes, billets, VIP, staff, finance). Les fuites trouvées sont des **policies
`USING(true)` trop larges** sur des tables secondaires — toutes colmatées par les deux
migrations ci-dessous.

---

## 4. Corrections produites — ✅ APPLIQUÉES EN PROD le 2026-07-04

> `supabase db push` a appliqué les 3 migrations ci-dessous. Vérifié post-push :
> anon ne voit plus notification_log / org_members / vip_consumption_facts (permission
> denied) / listes privées ; owner cross-tenant = 0 sur guest_lists et security_logs ;
> 22/22 FK présentes ; 0 orphelin ; `assigned_table_id` = UUID ; front `npm run build` vert.

### Migration A — `20260703130000_rls_hardening_reapply.sql`
Idempotente. Re-applique le lot fantôme d'avril (marqué appliqué dans `schema_migrations`
mais jamais exécuté — même pattern que le lot « 12 mai »). Ferme 4 des fuites prouvées
ci-dessus : `notification_log`, `org_members`, `vip_consumption_facts` (→ `security_invoker=on`
+ `REVOKE anon`), `security_logs` (scope owner→ses users), + `event_recap_sent` et
`dj_lineup_notifications` (service_role), + ownership storage `profile-photos`.
**À pousser en premier.**

### Migration C — `20260704130000_table_reservation_fk_and_legacy_cleanup.sql`
Nettoyage §5.1/§5.2 : met à NULL les 13 résas VIP orphelines (assigned 9 + requested 4),
convertit `assigned_table_id`/`requested_table_id` TEXT→UUID, ajoute les 2 FK vers
`vip_tables` (SET NULL), et supprime la colonne morte `event_collab_invitations.organizer_id`
(0 ligne, référençait l'ancienne table `organizers`). Dry-run ROLLBACK OK avant application.

### Migration B — `20260704120000_fk_integrity_and_guest_list_scope.sql`
Vérifiée en dry-run (`BEGIN … ROLLBACK`) : applique proprement, 0 orphelin bloquant.
1. **22 FK ajoutées** (pattern `NOT VALID` + `VALIDATE` → pas de lock long) :
   - rattachement venue → `guest_lists`, `email_campaigns`, `table_packs`,
     `venue_floor_plans`, `venue_hype_baseline`, `vip_consumptions`, `vip_service_moments`,
     `vip_table_waitlist`, `owner_ai_audit_log`, `upsell_cart_rules` (CASCADE) ;
   - refs user → `orders/tickets/table_reservations.claimed_by_user_id`,
     `cloakroom_transactions.staff_id`, `owner_recurring_templates.partner_organizer_id`
     (SET NULL) ;
   - `guest_list_entries.promoter_id` → promoters (SET NULL) ;
   - `upsell_cart_rules.addon/reward_drink_id` → drinks (SET NULL) ;
   - `sms_logs.campaign_id` → sms_campaigns, `guest_claim_otps.order_id` → orders.
2. **Fix RLS `guest_lists`** : la policy SELECT publique était `USING(true)`. Remplacée par
   4 policies scopées (public = `is_active AND visible_on_club_page` ; owner/manager ;
   promoteur = sa part ; DJ = sa part). Vérifié : anon passe de 25→15 listes (0 masquée),
   cross-tenant caché = 0. Le flux lien-privé (`get_guest_list_by_token`, SECURITY DEFINER)
   reste intact.

---

## 5. Données à trancher / orphelins (SQL de nettoyage préparé, NON exécuté)

Politique retenue : **aucune suppression sur la prod sans validation explicite de Paul.**
Requêtes de détection ci-dessous prêtes à l'emploi.

### 5.1 Orphelins réels détectés live

| Cible | Orphelins | Nature | Reco |
|---|---|---|---|
| `table_reservations.assigned_table_id` → `vip_tables` | **9** | résa VIP pointant une table supprimée | à nettoyer (mettre à NULL) + convertir TEXT→UUID + FK |
| `table_reservations.requested_table_id` → `vip_tables` | **4** | idem (demande initiale) | idem |
| `invoices.event_id` → `events` | **22** | facture dont l'event a été supprimé | **garder** (ledger : la facture doit survivre) — voir 5.3 |
| `invoices.ticket_id` → `tickets` | **18** | idem | garder |
| `invoices.order_id` / `table_reservation_id` | **2 / 2** | idem | garder |

```sql
-- DÉTECTION (read-only) — résas VIP pointant une table disparue
SELECT id, event_id, assigned_table_id, requested_table_id, created_at
FROM table_reservations
WHERE (assigned_table_id  IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vip_tables t WHERE t.id::text = assigned_table_id))
   OR (requested_table_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vip_tables t WHERE t.id::text = requested_table_id));

-- NETTOYAGE (à valider avant exécution) — délie les tables mortes, garde la résa
UPDATE table_reservations SET assigned_table_id = NULL
 WHERE assigned_table_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vip_tables t WHERE t.id::text = assigned_table_id);
UPDATE table_reservations SET requested_table_id = NULL
 WHERE requested_table_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vip_tables t WHERE t.id::text = requested_table_id);
```

### 5.2 Dérive de typage `assigned_table_id` / `requested_table_id`

Colonnes en **TEXT** alors que `vip_tables.id` est **UUID** (contenu = UUID valides,
0 non-UUID). Empêche toute FK. Utilisées à 19 endroits du front (`useOwnerVipData`,
`useTableAvailability`, `useVipHost`, `VipMenu`, `MyOrders`, `VipPlacementRequests`…).
**Reco** (après nettoyage 5.1, à réviser — blast radius front) :
```sql
ALTER TABLE table_reservations
  ALTER COLUMN assigned_table_id  TYPE uuid USING assigned_table_id::uuid,
  ALTER COLUMN requested_table_id TYPE uuid USING requested_table_id::uuid;
ALTER TABLE table_reservations
  ADD CONSTRAINT table_reservations_assigned_table_id_fkey
    FOREIGN KEY (assigned_table_id)  REFERENCES vip_tables(id) ON DELETE SET NULL,
  ADD CONSTRAINT table_reservations_requested_table_id_fkey
    FOREIGN KEY (requested_table_id) REFERENCES vip_tables(id) ON DELETE SET NULL;
```

### 5.3 Colonnes FK-less **assumées** (ne pas contraindre)

- **Ledger / légal** : `invoices.*`, `revenue_distributions.*`, `cgv_acceptances`,
  `terms_acceptances`, `admin_audit_log`, `transfer_clawbacks`. Un registre comptable
  doit survivre à la suppression de l'entité référencée (snapshot PDF, obligation légale).
  → découplage volontaire.
- **Analytics haut-débit / éphémère** : `cart_snapshots`, `visitor_sessions`,
  `visitor_events`, `live_visitor_pings`, `attribution_touchpoints`, `affiliate_clicks`,
  `customer_activity_log`. FK = coût d'écriture + verrous inutiles.
- **Polymorphe documenté** : `order_pack_credits.pack_id` (pointe `upsell_drink_packs`
  OU `ticket_upsell_offers` OU un id sentinelle « crédit boisson gratuit » — commentaire
  explicite dans la migration source).
- **Refs Stripe externes** : tout `stripe_*` / `*_transfer_id` / `payment_intent_id` /
  `charge_id` (ids d'un système tiers, jamais des FK locales).
- **Legacy** : `event_collab_invitations.organizer_id` (référence l'ancienne table
  `organizers` supprimée ; **0 ligne** en base). Reco : soit `DROP COLUMN`, soit repointer
  vers `profiles(id)` si la feature revit. À décider produit.

### 5.4 `orders.venue_id` en `NO ACTION`

FK présente mais sans `ON DELETE`. Mitigé aujourd'hui par la fonction
`admin_delete_venue()` (SECURITY DEFINER) qui purge manuellement events + dépendances
avant de supprimer le venue. Fonctionnel ; on peut le laisser tel quel tant que la
suppression de club passe exclusivement par cette RPC.

---

## 6. Frontend-only (point 2 de l'audit) — RAS

Recherche exhaustive de données métier sans backend : **aucune contamination**.
Les seuls cas trouvés sont volontaires et documentés :
- **Plan démo** (`src/lib/demoPlan.ts`, `DemoSwitcher.tsx`) : override d'abonnement en
  `localStorage`, **strictement scopé `@womber.fr`**, pour les démos de vente. Aucun impact prod.
- **Bouton achat crédits SMS désactivé en dur** (`OwnerSmsCredits.tsx:321`,
  `disabled={… || true}`) : verrou produit assumé (l'edge function existe). À rouvrir
  quand la feature est prête — décision produit, pas un bug.
- `hypeForecast.ts` = calcul déterministe sur données réelles, pas de mock.

Fallbacks de chargement, templates UI, liste de pays : config légitime, rien à faire.

---

## 7. État d'exécution — ✅ FAIT le 2026-07-04

1. ✅ 3 migrations appliquées via `supabase db push` (A → B → C, ordre par timestamp).
2. ✅ `src/integrations/supabase/types.ts` régénéré (schéma à jour, colonne legacy retirée).
3. ✅ `npm run build` vert.
4. ✅ Tests d'isolation re-joués post-push : toutes les fuites du §3.1 à **0**
   (anon bloqué sur vip_consumption_facts par REVOKE ; guest_lists / notification_log /
   org_members / security_logs cross-tenant = 0).
5. ✅ Orphelins §5.1 nettoyés + conversion typage §5.2 (migration C).

**Reste (non bloquant) — QA manuelle recommandée** des flux touchés par le fix `guest_lists` :
page club publique, lien guest list privé (`get_guest_list_by_token`), onglet promoteur,
liens DJ, module co-event. Le back est vérifié ; reste à confirmer le rendu front réel.
