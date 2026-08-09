# Stripe — remise en LIVE (Yuno)

Checklist de bascule **sandbox → live** avant la publication App Store. À dérouler **dans l'ordre**. Argent réel : ne pas ouvrir au public tant que le test end-to-end (§6) n'est pas vert.

> Rappel clé : le mode test/live de Yuno est porté **à 100 % par les clés** — aucun flag de code à basculer. `const TEST_MODE = false` dans les checkouts est un mode *simulate* (bypass Stripe), à laisser sur `false`.

---

## 1. Basculer les clés (les 2 côtés)

Les secrets Supabase prennent effet **immédiatement, sans redéploiement**. La clé publishable Cloudflare est **bakée au build** → il faut un redéploiement front (§4).

### Secrets Supabase (backend)
- [ ] `STRIPE_SECRET_KEY` → **`sk_live_…`**
- [ ] `STRIPE_WEBHOOK_SECRET` → le **`whsec_…` de l'endpoint LIVE** (pas celui du webhook test créé le 2026-08-05)
- [ ] Confirmer : `supabase secrets list` (aucune clé manquante ni `sk_test_`)
- [ ] Vérifier au passage : `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`noreply@yunoapp.eu`), `OPENAI_API_KEY`

### Variables Cloudflare (dashboard Workers → front)
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` → **`pk_live_…`**
- [ ] Confirmer les autres : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE_URL=https://yunoapp.eu`, `VITE_MAPBOX_TOKEN`

> `STRIPE_PRICE_*` (abonnements club) = hors périmètre tant que `SUBSCRIPTIONS_ENABLED=false`. Ne rien changer.

---

## 2. Nettoyer les comptes Connect de TEST (l'étape qu'on oublie)

Le test du 2026-08-05 a créé de **vrais comptes Connect test** en base. En live, les checkouts viseraient ces comptes → **« No such destination account »**. Il faut les **NULL-er** avant la première vente.

Comptes test à effacer (créés le 2026-08-05) :

| Table | Colonne | Valeur test à effacer |
|---|---|---|
| `venues` | `stripe_account_id` | `acct_1U15YRFB4WXNnfLO` (club womber) |
| `profiles` | `stripe_connect_account_id` | `acct_1U15ZZFFJKQ67y86` (organizer@womber.fr) |
| `profiles` | `stripe_connect_account_id` | `acct_1U15Zd2VBO5mOUld` (bde@womber.fr) |
| `dj_stripe_accounts` | compte | `acct_1Tl7OMFNilg0aMU3` (DJ — mode d'origine inconnu, à vérifier) |

- [ ] `venues.stripe_account_id` → **NULL** + reset `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_onboarding_complete` (→ `false`)
- [ ] `profiles.stripe_connect_account_id` → **NULL** + reset status/flags associés — **sauf** les sentinelles `acct_demo_*`
- [ ] `dj_stripe_accounts` : NULL-er la ligne DJ test (si un flux DJ renvoie « No such account » en live, c'est elle)
- [ ] Restaurer si besoin les sentinelles démo (`acct_demo_*`) : rejouer le bloc `profiles` de `supabase/seed-demo-womber.sql`

> À faire via `supabase db query --linked` (SQL live) ou l'éditeur SQL Supabase. Un `UPDATE` ciblé par ID, jamais un balayage large.

---

## 3. Webhook Stripe LIVE

- [ ] En **mode Live** du dashboard Stripe, confirmer l'endpoint :
  `https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook`
- [ ] Événements écoutés (tous requis) :
  `account.updated`, `checkout.session.completed`,
  `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`,
  `customer.subscription.created` / `.updated` / `.deleted`, `invoice.payment_failed`
- [ ] Copier le **signing secret** de cet endpoint live → c'est le `STRIPE_WEBHOOK_SECRET` du §1

> Un secret de mauvais mode = signature invalide = transferts co-event, escrow DJ et **réversions de refund morts en silence**. C'est la panne la plus vicieuse : le paiement passe, mais la répartition ne se fait jamais.

---

## 4. Redéployer le front (pour embarquer `pk_live`)

- [ ] `npm run build` (build vert vérifié) — noter le hash du chunk FR (ex. `fr-XXXX.js`)
- [ ] `git push origin main` → **Cloudflare Workers Build** rebuild avec les `VITE_*` **du dashboard** (`pk_live`) et déploie

> ⚠️ **Ne JAMAIS `npx wrangler deploy` depuis la machine locale.** Ton `.env.local` porte encore une clé `pk_test` → le `dist/` local expédierait du **Stripe test en prod**. Le seul chemin correct est le push → Workers Build.

Vérifier que la prod a bien buildé depuis ton commit (sans accès au dashboard) :
- [ ] `curl -sI https://yunoapp.eu/assets/fr-<hash>.js` → **HTTP 200** (le hash du chunk FR est identique local/prod car il ne contient aucune var d'env)
- [ ] Alternative : `npx wrangler deployments list` (wrangler est authentifié)

---

## 5. Ré-onboarder les comptes réels en LIVE

Double destination : owner → `venues` (charge sur le compte du club), organizer/BDE → `profiles`.

- [ ] Chaque club / organisateur repasse l'**onboarding Stripe Connect** via les flux de l'app (`stripe-connect`), cette fois en live
- [ ] Vérifier `venues.stripe_charges_enabled = true` avant d'autoriser une vente (sinon les 3 checkouts refusent proprement « compte pas encore activé »)
- [ ] DJ concerné : ré-onboarder si un flux renvoie « No such account »

---

## 6. Test end-to-end EN PROD = le vrai go / no-go

Avec une **vraie carte**, montant minimal, **avant** toute ouverture publique :

- [ ] Acheter 1 billet (une fois connecté, une fois en **invité**) → paiement Stripe live OK
- [ ] Recevoir **email + QR** (`send-ticket-confirmation`)
- [ ] Réserver 1 table VIP (montant minimal) → OK
- [ ] Commander 1 boisson → OK (garde-fou âge : la déclaration doit passer)
- [ ] **Rembourser** le billet test (`owner-refund` / `staff-cancel`) → remboursement Stripe visible
- [ ] Vérifier l'arrivée des fonds sur le compte Connect du club (statement = **nom du club**)

Si l'un échoue → **NE PAS ouvrir au public.** Corriger d'abord.

---

## 7. Vérifier les frais réels sur la 1re vraie charge

Le mode test **ment sur les frais** (il affichait ~2,8 % + 0,25 €, un taux qui n'existe nulle part). Ne rien « corriger » sur la foi d'un montant test.

- [ ] Sur la 1re vraie charge (carte française standard), vérifier `balance_transaction.fee` ≈ **1,5 % + 0,25 €**
- [ ] Confirmer que c'est bien journalisé dans `revenue_distributions.stripe_fee_real_cents`
- [ ] Rappel modèle : en `direct`, le club est merchant of record et paie le vrai frais ; en `separate` (co-soirée), **Yuno absorbe** l'écart estimation/réel — c'est voulu

---

## 8. Garde-fous — comptes démo & soir de prod

- [ ] **Les comptes `@womber.fr` simulent en live** (le guard ne facture pas les `@womber.fr` quand la clé n'est pas `sk_test`) → parfait pour une démo / la revue Apple sans charge réelle. Vérifier que ça vaut aussi pour le checkout billet client (`payment-guard.ts`).
- [ ] Toi sur place + wifi dédié au scan (scan d'entrée online-only)
- [ ] Liste papier de secours (export des billets vendus)
- [ ] Surveiller les logs pendant le rush : `supabase functions logs stripe-webhook`

---

### Récap ultra-court

1. `sk_live` (Supabase) + `pk_live` (Cloudflare) + `whsec` **live**
2. **NULL-er** les 4 comptes Connect test
3. Webhook live confirmé (bons événements + bon secret)
4. `git push` (jamais `wrangler deploy` local)
5. Ré-onboarder les vrais comptes en live
6. Test end-to-end vraie carte → **go / no-go**
7. Vérifier le frais réel sur la 1re charge
