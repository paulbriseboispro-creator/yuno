# Audit Super Admin Yuno — Cartographie, gap analysis & roadmap

> Audit réalisé le 2026-06-16. Cadre : Yuno passe en production, le compte Super Admin
> (rôle `admin` dans `user_roles`) devient le poste de pilotage unique. Le panneau actuel
> a été bâti par itérations (héritage Lovable → Supabase) sans avoir été pensé comme un
> poste d'exploitation. On ne valide pas l'existant a priori : on part des besoins réels
> d'un opérateur live, on compare au code vérifié, on prioritise.
>
> **Cadrage validé :** opérateur **solo** au lancement (RBAC intra-admin → P2/P3, priorité
> aux outils d'exploitation). Implémentation des P0 enchaînée après cet audit.

---

## Contrainte technique structurante

Le **cap de fonctions edge Supabase est atteint** — `supabase functions deploy` renvoie
**402** tant que le spend cap n'est pas relevé. Or les actions P0 les plus critiques
(rembourser via Stripe, reset MFA, payout) exigent un secret serveur (`sk_` Stripe,
`service_role`) → elles **doivent** vivre dans une edge function, pas dans le front
(anon key). **Lever le spend cap Supabase est donc un pré-requis P0.** Les edge functions
sont par ailleurs **CORS-lock `yunoapp.eu`** → l'admin doit être servi depuis ce domaine
(déjà le cas en prod).

---

## 1. Cartographie des besoins Super Admin

| # | Bloc | Capacités indispensables en prod |
|---|------|----------------------------------|
| A | **Comptes & accès** | Rechercher tout compte ; voir rôles + état ; **suspendre / réactiver / supprimer** un compte ; **recovery pro** (reset MFA, reset mot de passe, force logout) ; tracer qui a changé quoi |
| B | **Organisateurs / clubs (tenants)** | Onboarding & invitation ; **état Stripe Connect** (charges/payouts enabled) ; conformité (SIRET/TVA, docs mineurs) ; historique ; intervenir en cas de blocage |
| C | **Utilisateurs (clients)** | Recherche, consultation, **blocage plateforme**, support, historique commandes |
| D | **Événements** | Liste plateforme ; **modération** (approuver/rejeter/dépublier) ; **annulation + remboursement de masse** ; kill-switch contenu non conforme |
| E | **Paiements / finance** | **Rembourser une transaction** (drink/billet/table) ; commissions & take rate ; **superviser les payouts Stripe Connect** ; litiges/chargebacks ; recouvrement abonnements |
| F | **Support & ops** | File d'incidents ; logs d'action ; **prise en main** (impersonation scoped) ; escalade |
| G | **Modération & sécurité** | Abus/fraude/faux comptes ; bans ; **audit trail** ; garde-fous anti-erreur (confirm, soft-delete) |
| H | **Analytics / pilotage** | KPIs (GMV, take, MRR, churn) ; croissance ; perf organisateurs ; taux d'incident/remboursement |
| I | **Configuration globale** | Maintenance mode ; **feature flags** ; taux de frais/commission ; version CGV ; messages globaux |

---

## 2. Existant (inventaire vérifié dans le code)

Gate d'accès unique : `AdminLayout.tsx` → `supabase.rpc('is_super_admin')` →
`user_roles.role = 'admin'`. **Pas de MFA imposé sur la route admin, pas d'allowlist IP,
pas de timeout admin.**

16 routes admin. État réel (✅ fonctionnel / 👁 lecture seule / ⚠ partiel) :

| Écran | Fichier | État réel |
|-------|---------|-----------|
| Dashboard | `AdminDashboard.tsx` | ✅ KPIs plateforme + perf par club + maintenance toggle |
| Directory (6 onglets) | `AdminDirectory.tsx` + `directory/*` | ⚠ listes ok ; boutons d'action (Contact/Edit/Delete) à vérifier — possiblement non câblés |
| User detail | `AdminUserDetail.tsx` | ⚠ gestion de rôles ✅ (add/remove tout rôle, **y compris `admin`**), resync owner ✅, toggle promoteur ✅ ; ban/activité lecture seule |
| Venue detail | `AdminVenueDetail.tsx` | ⚠ vue + édition venue |
| Venues | `AdminVenues.tsx` | ✅ créer / éditer / **supprimer (cascade dure)** / cacher / inviter owner |
| Analytics | `AdminAnalytics.tsx` | ✅ graphiques multi-séries |
| Accounting | `AdminAccounting.tsx` | ⚠ revenus + **ledger commissions (bookkeeping seul)** — « marquer payé » = label, aucun payout Stripe |
| Feedback | `AdminFeedback.tsx` | ✅ tracker d'issues interne |
| Drinks | `AdminDrinkCatalog.tsx` | ✅ catalogue global + validation des demandes |
| Emails | `AdminEmailTemplates.tsx` | ✅ éditeur de templates |
| Waitlist | `AdminWaitlist.tsx` | ✅ liste + export |
| Push | `AdminPushNotifications.tsx` | ✅ envoi de campagnes par segment |
| **Orders** | `AdminOrders.tsx` | 👁 **LECTURE SEULE** — aucun remboursement, aucun détail, aucun changement de statut |
| **Subscriptions** | `AdminSubscriptions.tsx` | 👁 **LECTURE SEULE** — pas d'annulation, pas de comp, pas de changement de plan |
| Organizers | `AdminPlatformInvitations.tsx` | ✅ invitations organisateurs (edge `invite-platform-user`) |
| Affiliates | `AdminAffiliates.tsx` | ✅ gestion affiliés + invitations |

**Backend admin :** 158 policies RLS `FOR ALL USING (is_super_admin())` (CRUD plateforme
complet) ; **1 seule RPC admin** (`admin_delete_venue`, cascade **dure** sans soft-delete) ;
**1 edge function admin-gated** (`invite-platform-user`). La plupart des mutations admin
partent **directement du front (anon key + RLS)** — y compris l'attribution de rôles.
**Aucun journal d'action admin.**

---

## 3. Gap analysis

Gravité : 🔴 critique · 🟠 important · 🟡 modéré. Type : C=création F=correction
R=refactor S=suppression UX/SEC/OPS.

| Besoin | Existant | Écart | Grav. | Prio | Type |
|--------|----------|-------|-------|------|------|
| Rembourser une transaction | Orders 👁 | **Aucun remboursement possible** | 🔴 | **P0** | C/OPS |
| Annuler un event + rembourser en masse | aucun | inexistant | 🔴 | **P0** | C/OPS |
| Kill-switch contenu (dépublier event/venue) | venue `is_hidden` ; event aucun | pas de dépublication event ; pas de vue events | 🔴 | **P0** | C/OPS |
| Recovery pro (reset MFA/mdp/force logout) | aucun | owner bloqué = revenu bloqué, 0 outil | 🔴 | **P0** | C/OPS |
| Suspendre / réactiver un compte plateforme | ban venue-scoped lecture seule | pas de suspension plateforme | 🔴 | **P0** | C/SEC |
| Lever le cap edge Supabase | bloqué 402 | empêche tout nouvel edge fn P0 | 🔴 | **P0** | OPS |
| Journal d'audit admin | aucun | traçabilité nulle | 🟠 | **P1** | C/SEC |
| Superviser payouts Stripe Connect | `revenue_distributions` sans écran | argent bloqué en silence | 🟠 | **P1** | C/OPS |
| Gérer un abonnement | Subscriptions 👁 | 0 action | 🟠 | **P1** | C/OPS |
| File modération events (`discovery_status`) | champ sans UI | pending non filtrable | 🟠 | **P1** | C/OPS |
| File incidents / fraude | `customer_incidents` sans UI | pas de traitement abus | 🟠 | **P1** | C/OPS |
| Soft-delete + confirm venue delete | cascade dure | perte irréversible | 🟠 | **P1** | R/SEC |
| MFA obligatoire admin | non imposé | compte le + puissant non protégé | 🟠 | **P1** | SEC |
| Confirm sur attribution rôle `admin` | confirm au retrait seul | escalade privilège sans frein ni log | 🟠 | **P1** | F/SEC |
| Feature flags / config (frais, CGV) | maintenance seul | tout figé dans le code | 🟡 | **P2** | C/OPS |
| Impersonation scoped (support) | aucune | support à l'aveugle | 🟡 | **P2** | C/OPS |
| Litiges / chargebacks | suivi Stripe seul | pas de vue litiges | 🟡 | **P2** | C/OPS |
| Workflow conformité (SIRET/TVA, mineurs) | données sans UI revue | pas de revue go-live | 🟡 | **P2** | C/OPS |
| RBAC intra-admin | rôle `admin` unique | n/a tant que solo | 🟡 | **P3** | C/SEC |

---

## 4. Problèmes critiques

1. **Aucune intervention sur l'argent.** Orders/Subscriptions sont des tableaux morts.
   Event annulé, double paiement, client mécontent → **zéro remboursement** depuis
   l'admin → chargebacks forcés (exposition légale + coût).
2. **Aucune capacité de recovery pro.** Owner verrouillé en MFA/mot de passe le soir d'un
   event → ne peut pas vendre, **aucun bouton admin** pour débloquer.
3. **Pas de kill-switch contenu live.** Impossible de dépublier vite un event non conforme
   sur une marketplace publique (`discovery_status` inexploité, pas d'écran events).
4. **Attribution de rôle `admin` depuis l'UI, sans confirm ni log** — mutation front
   (anon key) reposant uniquement sur RLS → escalade de privilège silencieuse si compte
   compromis.
5. **`admin_delete_venue` = cascade dure irréversible**, sans soft-delete ni double
   confirmation.
6. **Aucun audit trail** : suppressions, changements de rôle, statuts commission,
   maintenance → rien n'est journalisé.
7. **Comptabilité trompeuse** : « marquer payé » dans Accounting n'est qu'un label, aucun
   lien vers un vrai payout Stripe.

---

## 5. À supprimer / désactiver / refactorer

- **Boutons d'action non câblés** des onglets Directory → vérifier puis supprimer ceux qui
  ne font rien (faux sentiment de contrôle).
- **Instructions SQL manuelles dans l'UI** (AdminUserDetail référence un script
  `migration-kit/...` à l'opérateur) → remplacer par une vraie action admin.
- **`demo_set_live` gardé par `email NOT LIKE '%@womber.fr'`** → check faible, restreindre
  à un rôle `demo` dédié.
- **Bypass email legacy** dans les vieilles migrations → déjà neutralisé ; vérifier en prod
  qu'aucune policy live ne référence un email en dur.
- **Écrans 👁 lecture seule trompeurs** (Orders, Subscriptions) → ne pas supprimer mais
  ajouter de vraies actions.

---

## 6. Roadmap

### Immédiat (P0 — bloquant lancement)

0. **Lever le spend cap edge Supabase** (action ops) + activer MFA sur le compte admin.
1. **Remboursement admin** : réutiliser le flux de refund club existant, l'ouvrir au rôle
   admin (ou wrapper `admin-refund`) ; UI Orders → drawer détail → bouton Rembourser.
2. **Annulation event + remboursement de masse** : rembourser tous les billets/tables
   payés + event `cancelled` + notifier.
3. **Recovery pro** : edge fn `admin-account-recovery` (reset MFA, reset mot de passe,
   force logout) ; UI dans User detail.
4. **Kill-switch contenu + suspension compte** : page `/admin/events` (filtre
   `discovery_status` + dépublier) ; champ `suspended` sur `profiles` + bouton Suspendre.

> Tout ce qui touche argent/auth = edge function (service_role + `sk_`), jamais le front.
> Les toggles d'état de ligne (is_hidden, suspended) peuvent rester front+RLS mais doivent
> être journalisés.

### Court terme (P1)
Journal d'audit admin (`admin_audit_log`) · confirm + garde-fou rôle `admin` · soft-delete
venue · supervision payouts Stripe Connect · gestion abonnement · file modération events +
incidents · MFA obligatoire admin.

### Moyen terme (P2)
Feature flags & config (frais, CGV, messages) · impersonation scoped · litiges/chargebacks ·
workflow conformité · nettoyage boutons morts + instructions SQL.

### Long terme (P3)
RBAC intra-admin · SSO + allowlist IP + timeout session admin · détection fraude/abus.

---

## 7. Recommandation finale

**Verdict : partiellement prêt mais incomplet — inexploitable en l'état pour gérer du
live, mais la base est saine et ne nécessite PAS une reconstruction.**

- ✅ **Socle solide** : auth role-based propre (plus de bypass email en dur), 158 policies
  RLS cohérentes, observabilité (Dashboard/Analytics/Directory) déjà bonne, invitations
  fonctionnelles, maintenance mode opérationnel.
- ❌ **Trou d'exploitation béant** : le panneau **observe** mais n'**agit** pas là où ça
  compte. Impossible de rembourser, annuler un event, débloquer un pro, couper un contenu,
  suspendre un compte. Un opérateur live serait à l'aveugle au premier incident.
- ⚠ **Risques** : escalade de privilège non tracée, delete cascade irréversible, zéro
  audit. Sérieux mais localisés et corrigeables (P1), pas structurels.

Conclusion : ni « à jeter » ni « prêt ». Il faut **ajouter la couche d'action
opérationnelle (P0)** sur une fondation correcte, puis durcir (P1). Le P0 est un « lac »
atteignable (l'essentiel réutilise des flux existants : refund club, MFA, RLS), pas un
« océan ».

---

## Annexe — État d'implémentation P0 (2026-06-16)

Stratégie consciente du cap edge : les RPC SECURITY DEFINER se déploient via
`supabase db push` (migrations) → **non bloquées par le 402**. Seules les fonctions
edge (Stripe/Auth admin) attendent le relèvement du cap.

**✅ Livré et actif en base (migrations poussées en prod) :**
- Table `admin_audit_log` + RLS lecture super admin + helpers `log_admin_action`
  (interne) et `admin_log_action` (front, self-gated).
- Suspension de compte : colonnes `profiles.is_suspended/suspended_at/suspended_by/
  suspension_reason` + RPC `admin_set_user_suspended` (garde-fou : pas d'auto-suspension,
  pas de suspension d'un admin) + `is_account_suspended`.
- Reset MFA : RPC `admin_reset_user_mfa` (recovery pro — le cas critique).
- Modération events : colonnes `events.status/cancelled_at/cancellation_reason` + RPC
  `admin_set_event_published` (dépublier/republier) et `admin_cancel_event`.

**✅ Livré côté code front (à activer par un déploiement Cloudflare du frontend) :**
- Page `/admin/events` (modération : filtres, dépublier, annuler).
- Page `/admin/audit` (journal d'audit, filtrable, actions destructrices surlignées).
- `AdminUserDetail` : boutons **Reset MFA** + **Suspendre/Réactiver**, confirmation
  explicite à l'attribution du rôle admin, journalisation des grant/revoke de rôle.
- Gate de suspension dans `RequireRole` + page `/account-suspended` (optimiste : ne
  verrouille jamais sur une lecture lente/échouée).
- `AdminOrders` : bouton **Rembourser** par ligne + modale (montant + raison).

**✅ Fonctions edge DÉPLOYÉES en prod (le cap ne bloque pas actuellement) :**
- `owner-refund` (mis à jour) : ouvert au rôle admin (court-circuit des contrôles de
  propriété par item) + journalisation `refund_issued`. La modale `AdminOrders` est
  fonctionnelle dès le déploiement frontend.
- `admin-account-recovery` (nouvelle) : action `reset-password` (lien GoTrue +
  email Resend brandé, multilingue) + journalisation `password_reset_sent`. Câblée au
  bouton « Réinitialiser le mot de passe » de `AdminUserDetail`.
- Note cap : contrairement à l'historique (402), les déploys edge fonctionnent
  aujourd'hui — 1 mise à jour + 1 création passées sans erreur. La fonction superseded
  locale `db-cleanup` (remplacée par les `cleanup-*` granulaires planifiées en cron)
  n'était même pas déployée.

**⏳ Reste à faire (P0 résiduel) :**
- Déconnexion forcée de session (invalidation immédiate) — la suspension coupe déjà
  l'accès à la navigation suivante ; le kill de session immédiat est un complément P1.
- Remboursement de masse à l'annulation d'un event : boucler `owner-refund` sur tous les
  billets/tables payés (UI à ajouter dans `/admin/events`).

**Pré-requis ops restants (action Paul) :** activer MFA sur le compte admin ; déployer le
frontend (Cloudflare) pour exposer les nouvelles pages ; vérifier le secret cron / les
variables `RESEND_API_KEY` et `APP_BASE_URL` côté edge (déjà en place pour les autres
fonctions).

**Notes qualité :** l'i18n admin est volontairement en français en dur sur les pages
admin-ops (cohérent avec `AdminUserDetail` existant ; opérateur solo FR) → harmonisation
i18n = P2. Le dépôt n'est pas « lint-clean » sur `no-explicit-any` (usage pervasif
préexistant dans tout le code admin) ; le nouveau code suit la même convention.
