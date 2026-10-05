# Yuno CRM — où on en est (05/10/2026 soir, branche `crm/redesign`, PR #13)

## Ce qui est fait

| Zone | État | Preuve |
|---|---|---|
| Console `/crm` : Accueil, Analyses (Ventes, Trafic, Communauté), Parcours client, Soirées, Clients, Segments, Imports, E-mails (7 écrans + Studio + Envoi), Automatisations, SMS (8 écrans), Connecteurs, Yunits, Réglages, Compte (profil, équipe, facturation, notifications, aide), Tarifs publique | Construit, branché sur les vraies données, comparé au design (ordinateur + téléphone) | `src/crm/pages/*`, migrations `20261004…` → `20261005…` |
| Prix 24 / 34 / 288 € HT, Yunits | Base, script Stripe, code et tests alignés. Stripe live déjà à ces montants. Seuil des 50 comptes payants validé | migration `…230000` |
| Pages d'erreur + délai de 30 s + erreurs de chargement | Fait (404, 401, 403, 500, 503, hors ligne, délai) | `src/crm/errors/*` |
| Admin CRM `/admin/crm` (super admin) | Complet : 11 écrans + connexion `/admin/crm/login`, Activité en direct, tiroir Clients, Comptes cibles, « Voir sa Console » (accès assisté consenti), e-mails du cycle de vie (tous éteints), durée des synchros, prix public / seuil des 50, mesure de la landing, NPS + demandes, registre d'incidents | `src/crm/admin/*`, migrations `…240000` → `…252000` |
| Pages d'inscription | Construit : `/crm/signup-pages` (éditeur + aperçu, liens / QR, chiffres, export) et page publique `/j/<slug>` sur crm.yunoapp.eu, double confirmation par e-mail, preuve de consentement | `src/crm/pages/signup/*`, `src/crm/signup/*`, migrations `…253000`, `…254000` |
| Instagram | Écran complet, réponses en brouillon (réels, carrousels, photos), chiffres lus dans un journal encore vide ; activation fermée (`CRM_INSTAGRAM_LIVE = false` + garde serveur) jusqu'à l'App Review Meta | `src/crm/pages/instagram/*`, migrations `…255000`, `…256000` |
| SMS | **Affiché ouvert** (décision de Paul). L'envoi réel est fermé : moteur non branché, garde serveur `crm_sms_not_open` | `CRM_SMS_DISPLAY_LIVE`, `CRM_SMS_ENGINE_READY=false` |
| Aide | FAQ, article d'abonnement (3 langues), base de l'assistant à jour | commit « Aide CRM… » |
| Inscription (landing) | Faite dans le dépôt `yuno-landing-crm` (Google, Apple, lien de confirmation) | dépôt landing |

Vérifications faites (05/10, après fusion de `origin/main`) : `tsc` 0 erreur, `eslint` 0 erreur (avertissements d'export seulement), **971 tests**, build de production, `supabase db lint --linked` sans alerte sur les fonctions de ce chantier, smokes SQL en transaction annulée pour chaque migration.

## Ce qui reste à construire

**SMS** : traité par Paul dans une session à part (moteur d'envoi, fournisseur, numéro).

**Instagram** : brancher le moteur (lecture des commentaires, envoi des messages privés, écriture de `crm_instagram_events`) une fois l'App Review Meta accordée, puis passer `CRM_INSTAGRAM_LIVE` et `crm_instagram_open()` à vrai ENSEMBLE.

**Pages d'inscription, version 2** : dix mises en page (une seule réglable aujourd'hui), téléversement d'une affiche (aujourd'hui celle de la soirée), choix d'un post Instagram déjà publié.

## À faire par Paul (pas par un agent)
1. Déployer les edge : `send-campaign`, `process-scheduled-campaigns` (e-mails du cycle de vie + confirmation des fans), `affiliate-ticket-sync`, `invite-org-member`, `club-subscription` (seuil des 50 + `crm_price_status`), `stripe-webhook`, `owner-assistant`. Poser le secret `CRM_BASE_URL` n'est pas nécessaire (défaut `https://crm.yunoapp.eu`).
1b. Allumer les e-mails du cycle de vie un par un (Admin › Réglages), quand tu veux.
1c. Pousser la branche landing `crm/landing-measure` (mesure de la page CRM + relais de `/j`) : non poussée, ton accord.
2. Enregistrer Stripe Tax FR ; renommer les produits « packs » (encore « néons ») chez Stripe.
3. Fusionner la PR #13 une fois le build Cloudflare vert et la revue faite (voir `CRM_REVIEW_PLAN.md`).
4. SMS : ouvrir l'envoi dans ta session dédiée (fournisseur, numéro).

## Risques connus
- L'Admin CRM n'a jamais été vu avec une vraie session super admin (aucun compte démo ne l'est) : à ouvrir une fois par Paul.
- Un seul vrai compte CRM en base (la démo) : les écrans Admin sont donc vides sans l'interrupteur « démo incluse ».
- Beaucoup de textes ont été écrits d'un trait : relecture FR/EN/ES à faire sur les écrans que tu montreras à un client.
