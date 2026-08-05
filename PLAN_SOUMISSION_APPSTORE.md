# Plan de soumission App Store — Yuno (app client iOS)

**Date :** 2026-08-04
**App :** `eu.yunoapp.app` — coquille Capacitor B2C, backend Supabase, paiements Stripe externes.
**État du code :** tous les bloquants de l'audit sont corrigés, committés sur `feat/analytics-pillar-first`. Build de prod vert (typecheck 0 erreur). Edge functions déployées et vérifiées en prod.

---

## 0. Déjà fait (par cette session)

- ✅ Manifests `PrivacyInfo.xcprivacy` (App + widget) créés et câblés dans Xcode → plus de rejet ITMS-91053.
- ✅ `NSPhotoLibraryAddUsageDescription` ajouté ; iPhone verrouillé en portrait.
- ✅ Bug paiement boissons corrigé (webhook délègue + idempotence).
- ✅ **`delete-account` déployée en prod** (elle ne l'était PAS — c'était un bloquant Apple 5.1.1(v) latent).
- ✅ 15 fonctions edge durcies déployées + vérifiées (send-test-email fermé : 401/403, send-post-visit gardé : 401, CORS natif OK sur les 5 fonctions de paiement).
- ✅ Bug VIP corrigé (email de confirmation de table accepte `reservationId` ET `reservation_id`).

---

## 1. Avant de builder — config externe (à vérifier)

1. **Sign in with Apple** : dans le dashboard Supabase → Authentication → Providers → Apple, confirmer que le provider est **activé** avec le bon Services ID / Team ID / Key, et que `eu.yunoapp.app` est autorisé. **C'est la dépendance qui fait rejeter si le tap échoue devant le reviewer.** (Rappel : le secret OAuth Apple expire à 6 mois — déjà suivi dans tes échéances admin.)
2. **Secrets Supabase** présents : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `APNS_*`. (Optionnel : poser `RESEND_WEBHOOK_SECRET` pour fermer le fail-open du tracking d'emails.)
3. **Working tree propre** : d'autres sessions ont du travail non committé dans l'arbre. Avant de builder le bundle iOS, assure-toi que `dist/` sera construit depuis l'état voulu (`git status`, committer ou écarter ce qui ne doit pas partir).

## 2. Construire et archiver le binaire iOS

```bash
# 1. Bundle web de prod (le binaire iOS embarque dist/)
npm run build

# 2. Synchroniser le bundle + la config native dans le projet iOS
npx cap sync ios
```

3. Ouvrir `ios/App/App.xcodeproj` dans Xcode.
4. **Vérifier** (une fois) : cible App → Build Phases → Copy Bundle Resources contient bien `PrivacyInfo.xcprivacy` ; idem cible YunoWidgets. (Je les ai câblés dans le `.pbxproj`, mais un contrôle visuel évite les surprises.)
5. **Build number** : `CURRENT_PROJECT_VERSION = 1`, `MARKETING_VERSION = 1.0`. Si tu as déjà uploadé un build 1, incrémente `CURRENT_PROJECT_VERSION`.
6. Sélectionner **Any iOS Device (arm64)**.
7. **Product → Archive**.
8. Dans l'Organizer : **Distribute App → App Store Connect → Upload** (signature automatique). Xcode bascule `aps-environment` en `production` à l'export — vérifie-le dans le récap avant l'upload.

## 3. Tests sur un vrai device (AVANT de soumettre)

Installe le build (TestFlight interne ou build device) et vérifie de bout en bout :

1. **Sign in with Apple** : « Continuer avec Apple » → compte créé/connecté.
2. **Suppression de compte** : Réglages → Supprimer mon compte → le flux va au bout (fonction maintenant déployée).
3. **Achat billet** : payer un billet en Apple Pay, revenir dans l'app, le QR s'affiche dans Mes Commandes.
4. **Achat boisson (le cas corrigé)** : payer une boisson, **fermer Safari avant la redirection**, rouvrir la commande → le QR de retrait doit finir par apparaître (le webhook le génère désormais).
5. **Navigation sans compte** : parcourir Explore / une soirée sans être connecté.

## 4. Métadonnées App Store Connect

1. **Classification d'âge : 17+** (le nouveau système peut afficher 18+) — répondre « fréquent/intense » aux références à l'alcool. Un rating 4+ = rejet métadonnées.
2. **Compte de démo** (App Review Information) : un email + mot de passe (PAS Apple/Google), idéalement avec des billets/commandes existants.
3. **Notes pour le reviewer** — copier-coller :
   > Yuno sells access to physical nightlife services (event tickets, VIP table reservations, in-venue drink orders) consumed in person at partner venues. Per Guideline 3.1.3(e), these are physical goods/services and are paid via Stripe outside the app; no digital content is sold, so IAP does not apply.
   > Test account: <email> / <mot de passe>.
   > Pro/organizer dashboards are intentionally redirected to the web (this is a consumer app). Account deletion is in Settings → Delete my account.
4. **Étiquettes de confidentialité** (App Privacy) : Email, Nom, Téléphone, Localisation approximative, Achats (+ Photos si upload de docs mineurs). **Data Not Used to Track You** (aucun SDK de tracking cross-app).
5. **Export compliance** : `ITSAppUsesNonExemptEncryption = false` est déjà dans l'Info.plist → pas de questionnaire de chiffrement.
6. **Captures d'écran** (6,7" + 6,9" iPhone requis), **description / mots-clés / sous-titre** (EN/FR/ES), **URL de support**, **URL de politique de confidentialité** (tu as `/legal/privacy`).

## 5. Soumettre

Sélectionner le build uploadé → remplir les infos de version → **Submit for Review**.

## 6. Après approbation / mise en ligne

- **Déployer le web** pour que `yunoapp.eu` colle au binaire : `npm run build` puis `npx wrangler deploy` (l'OTA Capgo poussera aussi le bundle web sans review Apple).
- **Merger `feat/analytics-pillar-first` → main**.

---

## Points connus non bloquants (suivi post-lancement)

- **Contrastes** de la page d'achat billets (texte gris sous le seuil AA) — passe design dédiée si tu vises AA strict.
- **`confirm()` natifs** (désactivation 2FA, suppression commande, décliner invitation) : dialogues système iOS, fonctionnels — à convertir en AlertDialog pour la finition, non bloquant.
- **`send-order-confirmation`** : même motif « défaut FR pour invité » que les autres emails (pas encore basculé en EN).
- **Imports edge non pinnés** (`supabase-js@2`) : build non reproductible à froid — hygiène.
