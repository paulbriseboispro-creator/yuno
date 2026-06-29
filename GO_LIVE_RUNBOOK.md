# Runbook go-live — pilote billetterie Yuno

But : mettre Yuno en production pour un pilote **billetterie** avec 1er partenaire (club ou BDE), en toute sécurité (argent réel). Séquence à dérouler dans l'ordre.

> Statut code au 2026-06-29 : tous les correctifs techniques sont faits (déclaration sur l'honneur enforced+enregistrée, config.toml réconcilié, garde-fous Stripe vérifiés sur les 3 checkouts). Il reste **du déploiement + de la vérification live + l'onboarding**, dont une partie ne dépend que de toi (secrets, Stripe partenaire, push front).

---

## 0. Prérequis À CONFIRMER avant tout (sinon checkout cassé en silence)

- [ ] **Secrets Supabase en mode LIVE** : `supabase secrets list` doit montrer
  `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET` (whsec_… du endpoint live),
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (noreply@yunoapp.eu). Une clé manquante/test = 500 silencieux.
- [ ] **Variables Cloudflare** (dashboard Workers) en LIVE : `VITE_STRIPE_PUBLISHABLE_KEY` (pk_live_…),
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_BASE_URL=https://yunoapp.eu`, `VITE_MAPBOX_TOKEN`.
- [ ] **Webhook Stripe live** pointant sur `…/functions/v1/stripe-webhook`, événements
  `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`.
- [ ] **CORS** : les edge functions n'autorisent que `https://yunoapp.eu` → la prod DOIT servir depuis ce domaine exact (déjà le cas).

## 1. Déploiement (front + backend ENSEMBLE)

L'ordre compte : le garde-fou âge backend rejette tout checkout boisson/VIP qui n'envoie pas la déclaration. Le **front** (qui l'envoie) doit donc partir **avant ou en même temps** que le redéploiement de `create-checkout` / `create-table-checkout`.

1. **Front (Cloudflare)** :
   ```bash
   npm run build        # build vert vérifié
   git push origin main # déclenche Cloudflare Workers Build → déploie le front
   # (ou déploiement manuel : npx wrangler deploy)
   ```
2. **Migration** (déjà poussée le 2026-06-29 : colonnes age_declared_* live).
3. **Edge functions avec le garde-fou âge** (APRÈS le front) :
   ```bash
   supabase functions deploy create-checkout
   supabase functions deploy create-table-checkout
   ```
4. **Edge functions réconciliées (verify_jwt)** — déployées indépendamment (faites le 2026-06-29 pour onboarding/confirmation ; rejouer si besoin).

## 2. Onboarding du partenaire pilote

1. **Créer le compte club** (super admin) → invitation owner (`invite-owner`) → le partenaire accepte le lien (`accept-owner-invitation`, désormais `verify_jwt=false` donc le lien public marche).
2. **Stripe Connect du club** : le partenaire complète l'onboarding Stripe → vérifier `venues.stripe_charges_enabled = true` (sinon les 3 checkouts refusent proprement « compte pas encore activé »).
3. **Staff** (videur/scan) : `invite-staff` → `accept-staff-invitation` → PIN (`set-own-pin`).
4. **Créer l'événement + la billetterie** (rounds, prix). Publier.

## 3. Test end-to-end EN PROD = le vrai go/no-go

À faire avec une vraie carte (montant minimal), AVANT la soirée :

- [ ] Acheter 1 billet (compte + une fois en **invité**) → paiement Stripe live OK.
- [ ] **Recevoir l'email + le QR** (valide `send-ticket-confirmation`, désormais `verify_jwt=false`).
- [ ] Scanner le QR au **Bouncer** → entrée marquée, anti-rescan (re-scan refusé).
- [ ] **Rembourser** le billet test (`owner-refund` / `staff-cancel`) → vérifier le remboursement Stripe.
- [ ] Vérifier l'arrivée des fonds sur le compte Connect du club (statement = nom du club).

Si l'un échoue → NE PAS ouvrir au public. Corriger d'abord.

## 4. Garde-fous le soir du pilote (P1 non bloquants, mitigés à la main)

- **Toi sur place** + **wifi dédié** au scan (le scan d'entrée est online-only — P1 connu).
- **Liste papier** de secours (export billets vendus) en cas de coupure réseau.
- Limiter à 1 poste de scan (le double-scan simultané n'a qu'un verrou optimiste — P1).
- Garder un œil sur les logs : `supabase functions logs stripe-webhook` / `create-ticket-checkout` pendant le rush (pas encore de Sentry — P2).

## 5. Après le 1er partenaire (avant d'élargir)

- File offline + resync sur Bouncer/Barman (P1).
- Idempotency anti-double-scan côté serveur (P1).
- Flow refund/annulation VIP (P1).
- Tests automatisés sur les chemins d'argent (P1).
- Observabilité (Sentry) + décrément de stock boissons (P2).

---

### Ce qui est volontairement HORS pilote billetterie
- **Commande de boissons (alcool)** : chemin le plus dur (alcool + offline + POS + fiabilité). Le garde-fou âge est prêt mais ce pilier se teste après.
- **Garde-fou âge sur le billet d'entrée** : non requis pour un billet d'entrée pur (le videur contrôle la pièce à la porte). À ajouter si tu vends des billets « avec conso » (helper `_shared/age-declaration.ts` déjà prêt, ~20 min).
