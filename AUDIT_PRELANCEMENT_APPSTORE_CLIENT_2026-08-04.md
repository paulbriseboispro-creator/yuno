# Audit pré-lancement App Store — App CLIENT (B2C) Yuno

**Date :** 2026-08-04
**Périmètre :** app client uniquement (billets, tables VIP, boissons, compte, découverte, auth). Partie pro **non touchée**.
**Méthode :** 7 audits parallèles en lecture seule (aucun fichier modifié) — paiements, sécurité backend, frontend, i18n, accessibilité, préparation App Store iOS, edge functions. + 2 sous-balayages frontend + 1 audit emails.

---

## Verdict global : **NO-GO aujourd'hui, GO atteignable en ~2-3 jours**

Le socle est solide et bien construit. Aucun problème structurel. Ce qui bloque la soumission tient en une liste courte et mécanique : **2 fichiers iOS à ajouter, 1 bug de paiement à corriger, 2 tests device de preuve, et la préparation d'App Store Connect.**

| Axe | Verdict | Bloquants |
|---|---|---|
| Sécurité backend | ✅ GO | 0 |
| Paiements | 🔴 NO-GO | 1 (flux boissons) |
| App Store iOS | 🔴 NO-GO | 2 fichiers + 2 tests + config Connect |
| Frontend | 🟠 2 corrections | 0 bloquant, 2 élevés |
| i18n | 🟠 retouches | 0 bloquant, clés brutes visibles |
| Accessibilité | 🟢 risque App Store faible | parcours VoiceOver dégradé |
| Edge functions | 🟢 socle sain | 0 bloquant de câblage |

**Fil rouge à retenir : le pilier BOISSONS est le maillon faible**, touché des deux côtés — bug de paiement bloquant (token QR jamais généré si retour interrompu) **et** solde affiché à 0 sur erreur réseau. Les billets et les tables sont prêts.

---

## 🔴 BLOQUANTS — à corriger avant soumission

### B1. Boisson payée mais NON servable (paiement)
`supabase/functions/stripe-webhook/index.ts:386-393` · `create-checkout/index.ts:484-501` · `verify-payment/index.ts:99-116` · `src/pages/OrderQR.tsx:108`
Le token de retrait (QR scanné par le barman) n'est minté que par `verify-payment`, c.-à-d. la page de retour après paiement. Si le client paie en Apple Pay dans SafariVC et **ferme avant la redirection**, le webhook passe la commande en `paid` mais **ne mint jamais le token** — contrairement aux billets/tables dont le webhook délègue à leur `verify-*` pour ce cas exact. Résultat : boisson payée, aucun QR, aucun email, aucun crédit, aucun point fidélité.
**Fix :** faire déléguer la branche `orderId` du webhook à `verify-payment` (POST Bearer service-role), comme les billets/tables. ~30 min.

### B2. `PrivacyInfo.xcprivacy` absent (App Store)
Absent des targets App **et** YunoWidgets. Le widget utilise `UserDefaults(suiteName:)` (`ios/App/YunoWidgets/NextEventWidget.swift:44`) = API « à raison requise » → **rejet ITMS-91053 dès l'upload**. Les plugins Capgo ne shippent aucun manifest.
**Fix :** créer le manifest dans les 2 targets (raisons UserDefaults CA92.1/1C8F.1, données collectées, `NSPrivacyTracking: false`).

### B3. `NSPhotoLibraryAddUsageDescription` absent (App Store)
`src/lib/share.ts:45-60` partage des fichiers image via la share sheet native. Si le reviewer tape « Enregistrer l'image » → **crash immédiat** (kill privacy iOS) → rejet 2.1.
**Fix :** ajouter la clé dans `ios/App/App/Info.plist` avec un texte spécifique.

### B4. Test device : Sign in with Apple de bout en bout (App Store)
Le code est bon (entitlement présent, bouton Apple avant Google, nonce géré). Mais dépend du provider Apple **actif dans le dashboard Supabase** avec `eu.yunoapp.app`. Un tap qui échoue devant le reviewer = rejet 4.8/2.1. **Rappel : le secret OAuth Apple expire à 6 mois** (déjà suivi dans tes échéances admin).

### B5. Test device : suppression de compte fonctionnelle (App Store)
Le flux est codé (`src/pages/Settings.tsx:232` + fonction `delete-account` complète). Mais il faut **confirmer qu'elle est déployée en prod** (le cap 402 a déjà laissé des fonctions non déployées). Un bouton de suppression qui échoue = rejet 5.1.1(v).

### B6. Config App Store Connect
- **Compte de démo** (email/mot de passe, avec billets/commandes existants) + notes reviewer : biens physiques hors app (pas d'IAP), routes pro renvoyées vers le web, où trouver « Supprimer mon compte ».
- **Age rating 17+/18+** (alcool, nightlife) — un rating 4+ = rejet métadonnées.

---

## 🟠 ÉLEVÉ — à corriger avant lancement ou juste après

### Paiements
- **E-P1** — `verify-payment` (boissons) pas idempotent : un rechargement double points fidélité, stats, facture, email + push. Les billets/tables ont déjà le verrou atomique ; les boissons non. `verify-payment/index.ts:104-116`. **Fix :** `.eq('status','pending').select('id')` + effets de bord gardés.

### Frontend
- **E-F1** — Service worker précache **26,7 Mo**, dont ~14 Mo de captures du centre d'aide *owner* + chunks pro (jspdf, recharts). Un client en 4G télécharge tout. `vite.config.ts:79`. **Fix :** `globIgnores: ['help/**']` → gain ~15-18 Mo (une ligne).
- **E-F2** — Solde crédits boissons affiche « 0 crédit » sur erreur réseau/RLS. `src/hooks/useLoyalty.tsx:110-115` (+ 89-93, 139-159). Le pire endroit pour confondre erreur et zéro : de l'argent déjà payé, en pleine soirée. **Fix :** destructurer `error`, passer en `.maybeSingle()`, afficher « impossible de charger » + réessayer.

### i18n
- **E-I1** — Clés brutes affichées à l'écran (3 langues), via le pattern piège `t('x') || 'fallback'` qui ne marche jamais : `auth.forgotPassword` (`Auth.tsx:519`), `explore.week` (`Explore.tsx:533`), `tickets.discount` (`TicketCheckout.tsx:1086`), `tickets.presaleLoginRequired` (`TicketCheckout.tsx:934`).
- **E-I2** — Push « Commande prête 🎉 » hardcodé en français pour tous les clients (`Barman.tsx:895`, `ClickCollect.tsx:319`) + appel direct à `send-push-notification` alors que le canal trilingue `order_ready` existe (violation règle CLAUDE.md + doublon probable).
- **E-I3** — Tout achat invité déclenche un email de confirmation en **français** (défaut `fr` sans compte lié). Les 5 fonctions sont trilingues pour les comptes connectés.
- **E-I4** — Toasts du flux paiement MyOrders en FR pur (`MyOrders.tsx:1101-1139`).

### Edge functions
- **E-E1** (F2) — Email de changement d'adresse fabrique son lien depuis l'`origin` client → `capacitor://localhost/settings?...`, lien mort dans Mail depuis l'app iOS. `email-change/index.ts:157`, `mfa/index.ts:194`. **Fix serveur :** clamp sur `https://yunoapp.eu` si origin non-https.
- **E-E2** (F1) — `send-test-email` : relais d'email ouvert sans auth (`verify_jwt=false`) → spam via le compte Resend de Yuno. **Fix :** `verify_jwt=true` + contrôle super-admin.
- **E-E3** (F3) — `send-post-visit-notification` : publique sans aucun garde (pas d'`authorizeCronRequest` contrairement à tous les autres crons). **Fix :** 2 lignes.
- **E-E4** (F4) — `yuno-assistant` : coût OpenAI non borné (messages bruts, pas de `max_tokens`, pas de rate limit, injection `role:"system"` possible). Fuite de données faible (données publiques + stats du seul user authentifié). **Fix :** cap messages + `max_tokens` + rate limit + filtrer les rôles.

### Emails
- **E-M1** (F5) — Emails guest list : 100 % FR codé en dur (`_shared/guest-list-email.ts`) + `guest-list-manage` langue en dur + échec Resend **avalé** (jamais de check `res.ok`) + `email_sent_at` marqué même sur rejet → un invité anglophone reçoit du FR, ou rien, et le staff croit l'invitation partie (QR jamais livré, personne bloquée à la porte).

### Accessibilité (parcours VoiceOver du parcours critique)
- **E-A1** — Toutes les cartes de découverte sont des `div onClick` sans rôle ni clavier (~12 composants Explore/EventCard/pages club-DJ). Le pattern correct existe déjà dans `FavoritePosterCard.tsx:99-105` — à généraliser.
- **E-A2** — Sélection du billet : carte de tarif en `div onClick` (`TicketSelection.tsx:943`), steppers +/- sans `aria-label`.
- **E-A3** — QR billet : overlay custom non-Radix sans `role="dialog"` ni focus trap, flèches sans label, aucun code texte de secours (les boissons ont PIN + référence — bon pattern dans `OrderQR.tsx:223`).
- **E-A4** — Assistant : zéro `aria-live`, les réponses de l'IA ne sont jamais annoncées.
- **E-A5** — Auth : formulaire placeholder-only, pas d'`autoComplete` (remplissage iOS dégradé pour tous), case CGU invisible pour le lecteur d'écran.
- **E-A6** — Contrastes sous le seuil AA sur la page d'achat (heure limite, places restantes, « épuisé » en `white/25`-`white/45` sur fond noir).

---

## 🟡 MOYEN — première itération post-lancement

**Paiements**
- Les verify billet/table ne revérifient pas `amount_total` (défense en profondeur, non exploitable). `verify-ticket-payment:97`, `verify-table-payment:87`.
- Flux Tables utilise un CORS wildcard `*` au lieu de l'allowlist (`create-table-checkout`, `verify-table-payment`). Non exploitable (auth par header), mais incohérent.

**Frontend**
- Pas de retour vers la page demandée après login : `Auth.tsx` ignore le `state.from` que `RequireRole.tsx:92` lui passe.
- Prompt push iOS déclenché à froid au premier lancement (`OnboardingGate.tsx:79-84`) — un refus iOS est quasi définitif, coût d'opt-in réel. **Recoupe l'audit App Store.**
- Erreurs réseau rendues « introuvable » sur le claim guest list (`GuestListSignup.tsx:305`, `GuestListCheckout.tsx:116`) — même symptôme que le gotcha cache PWA, rend les vrais bugs indiscernables.
- 3 `confirm()` natifs sur écrans client (`Settings.tsx:215`, `MyOrders.tsx:1044` — avec la clé `owner.confirmDelete` sur un écran client, `ClubInvitation.tsx:114`).

**Edge functions / emails**
- `send-vip-confirmation` déclenchable avec le seul `reservationId` (ne vérifie ni email ni statut payé, contrairement à ses sœurs). `send-vip-confirmation:57-68`.
- Invités en FR par défaut sur 3 emails transactionnels + OTP `claim-guest-order:378`.
- Aucun timeout sur aucun fetch externe (Resend/OpenAI/APNs/Stripe) → un hang gèle l'invocation.
- Échec Resend → HTTP 400 post-paiement sans retry ; `owner-refund` avale l'échec.
- Relay push staff→client sans scope venue (`send-push-notification:948-1014`).
- `email-change` vérifie l'unicité sur la 1re page de `listUsers()` (50) → doublon possible au-delà.
- Pas d'email de confirmation d'inscription guest list (`create-guest-list-entry`) ni d'annulation (`cancel-ticket`).

**i18n**
- Pages `Unsubscribe.tsx` et `MFADisableConfirm.tsx` 100 % FR (atteintes depuis les emails).
- « Back » EN en dur sur l'auth, 6 toasts auth FR, aria-labels mélangés FR/EN.

**Sécurité (durcissement, non bloquant)**
- ~100 fonctions DEFINER héritées sans `SET search_path` (les récentes le posent ; risque réel faible car anon/authenticated n'ont pas `CREATE` sur `public`).
- Rôles `agency`/`organizer` auto-attribuables — **vérifié sain** (l'accès est gaté par la propriété, pas par le rôle) ; à confirmer comme intentionnel.

---

## 🔵 FAIBLE — hygiène

- Imports `supabase-js@2` non pinnés (4 versions coexistent) → build non reproductible.
- QR guest list/VIP via service tiers `api.qrserver.com` (le code de réservation transite chez un tiers ; send-ticket génère en local).
- ~140 lignes de code mort dans `send-ticket-confirmation` (templates jamais envoyés).
- `public/sw.js` legacy mort (écrasé au build).
- Rate-limit sur `unlock_event_sale` (F2) et dédup serveur sur `record_tracked_link_click` (F1).
- KB assistant : ajouter le partage d'addition (absent), remplacer « PWA installable » par « télécharge l'app iOS ».
- `sr-only "Close"` et quelques aria-labels hardcodés en anglais dans une app FR/ES.
- Différer/restreindre l'orientation paysage iPhone (écrans non conçus).
- Lint : 1 137 erreurs (99 % `no-explicit-any`, aucun bug) — à résorber pour que le lint redevienne un signal.

---

## Ce qui est déjà PRÊT (vérifié, à ne pas casser)

- **Sécurité backend** : RLS correcte sur toutes les tables client (tickets, orders, réservations, crédits, profils, tokens push, MFA en Vault), aucun secret exposé, webhook signé, prix serveur, gardes de règlement intactes (SECURITY INVOKER).
- **Paiements billets + tables** : signature webhook, prix 100 % recalculés serveur, Stripe Connect bien routé (l'argent ne part jamais au mauvais compte), remboursements proportionnels + hold-and-release, anti-oversell atomique, gating `end_at` dans les 3 checkouts.
- **Frontend** : typecheck 0 erreur, build OK, aucun guard cassé (un client n'entre dans aucune surface pro), ErrorBoundary par route avec purge SW sur chunk-errors, watchdogs au boot, règles métier respectées (`end_at +2h`, `getEventSalesStatus`, identité `useAuth` figée), MyOrders anonyme exemplaire.
- **i18n** : parité parfaite EN↔FR↔ES sur 11 895 clés (0 manquante, 0 vide), dates localisées, push automatiques trilingues, assistant multilingue.
- **App Store** : paiements Stripe conformes (biens physiques → pas d'IAP), OTA Capgo conforme (`notifyAppReady()` en place), AASA propre avec exclusions agenda, icône 1024 sans alpha, launch screen rouge cohérent, ATS non affaibli, `yuno://` déclaré, usage descriptions caméra/localisation/calendrier présentes.
- **Edge functions** : config.toml exhaustif, aucune fonction fantôme appelée par le front, Capacitor passe le CORS partout, crons uniformément protégés, endpoints publics « chauds » (guest list, claim invité) les mieux défendus.
- **Accessibilité** : zoom non bloqué, aucune image sans `alt`, `prefers-reduced-motion` respecté, dialogs Radix bien employés, BottomNav exemplaire, QR boissons avec code texte de secours.

---

## Vérifications opérationnelles à faire avant soumission (hors code)

1. `supabase functions list` — confirmer qu'aucune fonction du parcours client (notamment `delete-account`) ne manque en prod (cap 402).
2. **Supabase Security Advisor** + `supabase db lint --linked` — confirmer que l'état live correspond aux migrations auditées (l'audit est statique).
3. Vérifier `aps-environment = production` dans l'archive exportée.
4. Vérifier la table live `email_templates` (liens `lovable.app` résiduels éventuels — hors portée du code).
5. Remplir les labels de confidentialité App Store Connect (email, nom, localisation approx., achats, photos pour docs mineurs ; « no tracking »).

---

## Ordre de correction recommandé

**Sprint bloquant (avant soumission) :**
1. B1 — token boisson via webhook (+ E-P1 idempotence, même fichier)
2. B2 + B3 — 2 fichiers iOS (privacy manifest + clé photo)
3. B4 + B5 — 2 tests device (SIWA + delete-account)
4. B6 — compte démo + age rating + notes reviewer

**Sprint élevé (avant lancement pub ou J+1) :**
5. E-F1 (précache SW, 1 ligne) + E-F2 (solde crédits)
6. E-I1 à E-I4 (clés brutes + push + emails invités)
7. E-E1 à E-E4 (lien email natif, 2 fonctions ouvertes, coût assistant)
8. E-M1 (emails guest list) + E-A1 à E-A4 (accessibilité parcours critique)
