# Audit pré-lancement — Yuno (2026-07-02)

Senior engineer, revue exhaustive. Périmètre couvert : sécurité edge functions (94),
RLS/Postgres (DB **live**, pas seulement les migrations), sécurité frontend + guards,
bugs fonctionnels dashboards, performance, typage.

> **Note de cadrage.** Le brief décrivait une app **Next.js** (`app/api/admin/*`,
> `requireAdminAuth()`, `next/image`, `proxy.ts`, `middleware.ts`, `lib/types/database.ts`,
> migrations 005-007). La réalité du repo est une **SPA Vite + React + TypeScript** avec
> **100 % du backend sur Supabase** (94 edge functions Deno, 523 migrations, RLS). Chaque
> axe a donc été audité sur son équivalent réel : edge functions au lieu de routes API,
> guards `App.tsx` + RLS au lieu de middleware, `src/integrations/supabase/types.ts` au lieu
> de `lib/types/database.ts`. Il n'y a **ni `proxy.ts` ni `middleware.ts`** (normal pour une
> SPA statique) — aucun doublon à craindre ; le seul « middleware » est `worker/index.ts`
> (Worker OG crawler-gated) + le SPA-fallback de `wrangler.jsonc`, tous deux sains.

## Verdict

**NE PAS lancer en l'état.** 16 findings Critiques, dont **5 fuites de données live
exploitables *maintenant* sans authentification** via l'API PostgREST anonyme, et **8 trous
d'auth sur les edge functions** (détournement de paiements, contournement d'auth total,
escalade vers le rôle owner). Cause racine principale côté DB : une **migration de
durcissement fantôme** (`20260422061744`, enregistrée appliquée mais jamais exécutée — même
pattern que le lot « 12 mai »).

**Tous les Critiques ont été corrigés dans le code** (voir statut par finding). **Rien n'est
déployé** : les edge functions et la migration nécessitent `supabase functions deploy` /
`supabase db push` de ta part (cap 402 + action sortante = ton appel). Checklist de
déploiement en fin de document.

| Sévérité | Nombre | Corrigés (code) | Restant à traiter |
|----------|--------|-----------------|-------------------|
| Critique | 16 | 16 | déploiement + QA |
| Majeur | ~20 | 0 | à planifier (liste ci-dessous) |
| Mineur | ~25 | 0 | backlog |

---

## CRITIQUE (16) — tous corrigés dans le code, à déployer

### Sécurité DB / RLS (5) — **fuites LIVE, priorité absolue**

Cause racine : **migration fantôme `20260422061744`** — enregistrée comme appliquée dans
`schema_migrations`, mais aucun de ses effets n'existe en base (vérifié empiriquement
`SET ROLE anon`). → **Fix : nouvelle migration [supabase/migrations/20260703130000_rls_hardening_reapply.sql](supabase/migrations/20260703130000_rls_hardening_reapply.sql)** qui réapplique idempotemment le lot + 2 trous plus récents.

1. **`org_members` — `USING(true)` public** → anon lit `member_email`, **`invitation_token`**,
   **`scanner_pin_hash`** de toutes les invitations d'équipe → **prise de contrôle de compte
   d'équipe**. Confirmé live (2 lignes lues en anon). *Fix : DROP de la policy publique.*
2. **`vip_consumption_facts` — vue SECURITY DEFINER exposée à `anon`** → CA bottle-service
   **de tous les clubs** scrapable par un concurrent + `user_id` staff. Confirmé live (6 lignes
   en anon ET authenticated). *Fix : `security_invoker=on` + `REVOKE anon`.*
3. **`notification_log` — `ALL USING(true) TO public`** → anon lit/écrit/efface l'historique
   de notifs de tous les users. *Fix : DROP (policy service_role correcte déjà présente).*
4. **`event_recap_sent` — `ALL USING(true) TO public`** (PII : email destinataire).
   *Fix : recréer `TO service_role`.*
5. **`storage.objects` (profile-photos) — pas de check d'ownership** → tout user connecté
   modifie/supprime la photo de profil de n'importe qui. *Fix : `foldername[1] = auth.uid()`.*

La migration corrige aussi `dj_lineup_notifications` (même bug `TO public`, Majeur) et re-scope
`security_logs` par venue (Majeur cross-tenant).

> ⚠️ **Après déploiement, auditer `schema_migrations` pour d'autres migrations fantômes**
> (comparer l'objet *live* au SQL, pas le simple enregistrement de version). C'est le 3e
> épisode de ce pattern (12 mai, 22 avril).

### Sécurité edge functions (8) — cap 402 : à redéployer (fonctions existantes → OK)

| # | Fonction | Trou | Fix appliqué |
|---|----------|------|--------------|
| C1 | [stripe-connect](supabase/functions/stripe-connect/index.ts) | IDOR sur `body.venueId` (service_role) → login-link Stripe d'un club tiers (solde/RIB) + création/écrasement du compte connecté = **détournement des paiements** | `assertOwnsBodyVenue()` sur onboard/dashboard/refresh |
| C2 | [staff-cancel](supabase/functions/staff-cancel/index.ts) | Fallback `staffId` du body = **auth bypass total** (impersonation de n'importe quel staff/admin via UUID) → refunds/bans arbitraires | Fallback supprimé, JWT obligatoire |
| C3 | [sms-twilio-status-webhook](supabase/functions/sms-twilio-status-webhook/index.ts) | Signature `X-Twilio-Signature` **jamais vérifiée** → forge `MessageStatus=failed` = **refund SMS frauduleux** | HMAC-SHA1 vérifié, fail-closed |
| C4 | [invite-staff](supabase/functions/invite-staff/index.ts), [invite-promoter](supabase/functions/invite-promoter/index.ts), [invite-dj](supabase/functions/invite-dj/index.ts) | `has_role(owner)` **global** au lieu de par-venue → owner du club A s'invite manager/promoteur (commission arbitraire) dans le club B | `is_venue_owner(user, venue_id)` |
| C5 | [invite-club-collab](supabase/functions/invite-club-collab/index.ts) → [accept-club-collab-invitation](supabase/functions/accept-club-collab-invitation/index.ts) | Accept ne matche **jamais** `user.email == club_email` → tout token accordé = **venue + rôle owner auto-provisionnés** pour n'importe qui | Email-match + check `profile_type=organizer` côté invite |
| C6 | [accept-staff-invitation](supabase/functions/accept-staff-invitation/index.ts) | Backdoor super-admin hardcodée `owner@womber.fr` (compte démo partagé) → liens owner pour tout `venue_id` | Backdoor email supprimée |
| C7 | [notify-event-waitlist](supabase/functions/notify-event-waitlist/index.ts) | Non authentifié → blast email/push de toute la liste + ouverture prématurée de prévente avec un simple `eventId` | Gate owner/organizer (ou service_role) sur le chemin blast |
| C8 | [send-push-notification](supabase/functions/send-push-notification/index.ts) | Chemin par défaut **sans auth** → **relais push de phishing** vers n'importe quel user | Gate service_role OU rôle staff/owner (préserve Barman/ClickCollect) |

### Bugs fonctionnels (3)

- **FC1 — Activation billetterie en silent-noop** ([OwnerTicketing.tsx](src/pages/OwnerTicketing.tsx)) :
  `UPDATE events {ticketing_enabled:true}` jeté ; si RLS bloque (0 ligne, pas d'erreur),
  l'owner voit « billetterie activée » mais **les billets ne sont jamais mis en vente**.
  *Fix : vérif erreur + nombre de lignes sur les writes du wizard de publication.*
- **FC2 — 14 clés i18n affichées brutes** sur les tunnels d'achat (ex.
  `tables.reservationSuccess` après une résa de table payée, `tickets.discount`, titre
  `auth.forgotPassword`). `t()` retourne la clé si absente, donc le pattern `t('x') || 'secours'`
  est **mort par construction**. *Non corrigé (voir Majeur) — liste des 14 clés dans le rapport
  bugs.*
- **FC3 — Route 404** ([SuggestedEvents.tsx:156](src/components/profile/SuggestedEvents.tsx#L156)) :
  `navigate('/events/:id')` alors que la route publique est `/event/:id` → chaque événement
  suggéré du profil menait à NotFound. *Fix appliqué.*

---

## MAJEUR (~20) — non corrigés, à planifier avant/juste après lancement

**Sécurité frontend**
- **XSS stocké via URLs `javascript:`** ([DJPublicPage.tsx:402](src/pages/DJPublicPage.tsx#L402),
  AffiliateLinktree/PromoterLinktree, AffiliateEventPage) : champs sociaux DB éditables par des
  rôles self-serve, rendus `href={url!}` sur pages publiques. Exploitable car CSP `unsafe-inline`.
  *Fix : helper `safeHref()` allowlist `http/https/mailto/tel`.*
- **Bypass gate UI** ([RequireRole.tsx:33](src/components/RequireRole.tsx#L33)) :
  `sessionStorage.staffSession` forgeable accorde l'accès avant le check rôle serveur.
- **CSP `script-src 'unsafe-inline'`** ([public/_headers:6](public/_headers)) : rend le XSS
  ci-dessus exploitable. *Fix : hash/nonce.*

**Bugs fonctionnels — motif « `await supabase` jeté + toast succès inconditionnel »** (classe
entière ; supabase-js ne throw jamais). Confirmés sur chemins revenu/permissions :
suppression promoteur (OwnerPromoterDetail/Teams/Templates), compta DJ (OwnerDJDetail),
Click&Collect (ClickCollect), règlement agence (AgencyFinance), presets billetterie dupliqués,
retrait de rôle staff (OwnerStaff), line-up DJ effacée à l'édition (OwnerEvents), catalogue
boissons admin, fidélité owner, toggle VIP. + **FC2** (14 clés i18n). *Fix transverse recommandé :
helper `mustAffect(query, n)` (throw si erreur ou 0 ligne) + règle eslint interdisant
`await supabase.` en statement.*

**Edge functions (Majeurs)** : `club-subscription` (IDOR venueId), `send-campaign` (flag
`scheduled` contourne auth), `verify-pin` (pas de lockout, brute-force), `resend-webhook`
(signature fail-open), `geocode-address` (non-auth, abus coût Mapbox), `send-order-confirmation`
(montants du body), `accept-platform-invitation` (pas de filtre profile_type), `redeem-loyalty-reward`
(double-dépense non atomique), `notify-split-proposal` (spam inter-tenant), `invite-*-collab`
(origin du body dans le lien email = phishing), `send-sms-campaign` (campaign non liée au venue).

**Performance**
- **`i18n/data.ts` (2,2 Mo) dans le chemin critique du first load** → 613 Ko gz, 68 % du
  first load public. *Fix : split par langue + `import()` dynamique.*
- **Precache PWA = 36 Mo** à la 1re visite (globIgnores manquants sur mapbox/jspdf/i18n/pages pro).
- **`.select('*')` sans limit** sur dashboards (useAnalyticsData, OwnerDashboard, AdminOrders/Venues).
- **Uploads sans `compressImage`** (~20 chemins, dont posters d'events publics).
- **jspdf/html2canvas chargés au rendu** (pas au clic) ; **0 `React.memo`** + FavoritesContext
  value non mémoïsée → re-render global sur chaque toggle favori.
- **`loading="lazy"` absent** sur les grilles Explore/DJ.

**Typage**
- **Drift `types.ts` vs migrations** : ~7 tables/vues, 16 colonnes, 15 RPC agency/VIP absentes
  → 22 appels `(supabase as any).rpc(...)` non typés. *Fix : régénérer après `db push`.*

---

## MINEUR (~25, backlog)

iframes `srcDoc` sans `sandbox` (email-editor), mot de passe démo hardcodé dans le bundle,
`minor_ticket_docs` INSERT anon libre, `agencies` contacts lisibles par tout authentifié,
`affiliate_*` UPDATE anon, `djs_public` sans `security_invoker`, 2 fonctions SECURITY DEFINER
sans `search_path`, ~1 300 `any`, FR hardcodé sur surfaces trilingues (MyOrders, SetupPin,
admin), `strict:false`/`strictNullChecks` désactivés, etc. Détails dans les rapports d'agents.

---

## Points sains confirmés (à créditer)

- **Aucun secret hardcodé** (edge fns via `Deno.env`, front sans `sk_`/`whsec_`/JWT). `.env.local`
  non tracké.
- **Aucune injection SQL** (query builder + RPC paramétrées).
- **Checkout recalcule tous les prix serveur** ; `verify-*-payment` vérifient `paid` chez Stripe
  avec idempotence atomique ; `stripe-webhook` vérifie sa signature.
- **Guards de routes** adossés à la table serveur `user_roles` (pas un state client) ; admin
  gaté serveur via `is_super_admin`.
- **RLS activé sur toutes les tables `public`** ; vues « limited » correctement `security_invoker`.
- **46/46 channels realtime avec cleanup** ; 120 pages 100 % lazy ; build 3 s.
- **owner-refund / mfa / delete-account / crons** correctement gatés.

---

## Checklist de déploiement (à faire par Paul)

1. **DB (priorité 1 — fuites live)** : `supabase db push` → applique
   `20260703130000_rls_hardening_reapply.sql`. Vérifier ensuite en anon que
   `org_members` et `vip_consumption_facts` renvoient 0 ligne.
2. **Edge functions** : redéployer les 11 fonctions modifiées
   (`supabase functions deploy stripe-connect staff-cancel sms-twilio-status-webhook
   invite-staff invite-promoter invite-dj invite-club-collab accept-club-collab-invitation
   accept-staff-invitation notify-event-waitlist send-push-notification`). Ce sont des MAJ de
   fonctions existantes → **pas de 402**.
3. **Secret Twilio** : s'assurer que `TWILIO_AUTH_TOKEN` est dans les secrets Supabase
   (sinon le webhook C3 renvoie 403, fail-closed). Si l'URL de callback configurée côté Twilio
   diffère de l'URL vue par la fonction, poser `TWILIO_STATUS_CALLBACK_URL`.
4. **Front** : `npm run build` + déployer (Cloudflare) — inclut FC1 (OwnerTicketing) et FC3 (route).
5. **QA post-deploy** : tester le flux owner Stripe Connect (onboard/dashboard), une annulation
   barman, une invitation staff/promoteur/collab, l'activation billetterie, un push staff
   Barman/ClickCollect. Ces flux légitimes doivent continuer à marcher (les fixes ajoutent des
   checks d'ownership, pas de restriction des chemins nominaux).
6. **Types** : régénérer `types.ts` après le push (stderr redirigé, cf. gotcha CLAUDE.md) et
   purger les `(supabase as any).rpc`.

**Non déployé par l'agent** : rien. Le code est modifié, la revue/déploiement restent à ta main.
