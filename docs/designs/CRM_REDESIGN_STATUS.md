# Yuno CRM — où on en est (05/10/2026, branche `crm/redesign`, PR #13)

## Ce qui est fait

| Zone | État | Preuve |
|---|---|---|
| Console `/crm` : Accueil, Analyses (Ventes, Trafic, Communauté), Parcours client, Soirées, Clients, Segments, Imports, E-mails (7 écrans + Studio + Envoi), Automatisations, SMS (8 écrans), Connecteurs, Yunits, Réglages, Compte (profil, équipe, facturation, notifications, aide), Tarifs publique | Construit, branché sur les vraies données, comparé au design (ordinateur + téléphone) | `src/crm/pages/*`, migrations `20261004…` → `20261005…` |
| Prix 24 / 34 / 288 € HT, Yunits | Base, script Stripe, code et tests alignés. Stripe live déjà à ces montants. Seuil des 50 comptes payants validé | migration `…230000` |
| Pages d'erreur + délai de 30 s + erreurs de chargement | Fait (404, 401, 403, 500, 503, hors ligne, délai) | `src/crm/errors/*` |
| Admin CRM `/admin/crm` (super admin) | 10 écrans sur 11 + fiche d'un compte + gestes audités + gel d'envoi | `src/crm/admin/*`, migrations `…240000` → `…242000` |
| SMS | **Affiché ouvert** (décision de Paul). L'envoi réel est fermé : moteur non branché, garde serveur `crm_sms_not_open` | `CRM_SMS_DISPLAY_LIVE`, `CRM_SMS_ENGINE_READY=false` |
| Aide | FAQ, article d'abonnement (3 langues), base de l'assistant à jour | commit « Aide CRM… » |
| Inscription (landing) | Faite dans le dépôt `yuno-landing-crm` (Google, Apple, lien de confirmation) | dépôt landing |

Vérifications faites : `tsc` 0 erreur, `eslint` 0 erreur (30 avertissements d'export de fichiers), **945 tests**, build de production, `supabase db lint --linked` propre, smokes SQL en transaction annulée. *Correction d'honnêteté : j'avais annoncé « tsc passe » avant que deux erreurs de type de l'Admin soient corrigées ; elles l'étaient avant le push.*

## Ce qui reste à construire

**SMS** : traité par Paul dans une session à part (moteur d'envoi, fournisseur, numéro). Hors du prompt de fin de build.

**Priorité 1 — finir l'Admin CRM (écrans présents mais incomplets)**
- Durée médiane d'une synchro : `ticketing_sync_runs` a `started_at` / `finished_at` mais aucune ligne n'est finie en base à ce jour → vérifier que le connecteur écrit `finished_at`, puis l'afficher.
- « Activité en direct » du Pilotage, onglet « E-mails du cycle de vie » de Réglages, tiroir de la liste Clients, « Comptes cibles » de Vente, écran de connexion admin, lien « Voir sa Console » depuis une fiche.
- Mesure de la landing (visites, profondeur de lecture, clics), NPS + demandes de fonctionnalités, registre d'incidents (CNIL 72 h) : **décidé oui** (pas de test A/B) ; dans le prompt de fin de build.

**Priorité 2 — réglages qui n'agissent encore sur rien**
- `trial_extensions` (prolongations gratuites) : stocké, jamais lu → le brancher à « Prolonger l'essai » ou le retirer.
- `price_switch_at` (50) : affiché dans Argent / Réglages, mais le passage à 34 € se fait en activant les prix Stripe publics à la main → soit un bouton « Activer le prix public » (écrit chez Stripe, accord explicite), soit le laisser manuel et le dire.
- Coûts réels d'envoi par défaut = ceux du design (à vérifier avec les factures fournisseurs).

**Priorité 3 — écrans du design volontairement « Bientôt »**
- Pages d'inscription (builder + page publique fan, 3 fichiers de design) et Instagram : aujourd'hui des pages « Bientôt » avec liste d'attente. Pages d'inscription est une vraie fonctionnalité (consentements) à planifier à part ; Instagram attend l'App Review Meta.

## À faire par Paul (pas par un agent)
1. Déployer les edge : `send-campaign`, `process-scheduled-campaigns`, `affiliate-ticket-sync`, `invite-org-member`, `club-subscription`, `stripe-webhook`, **`owner-assistant`**.
2. Enregistrer Stripe Tax FR ; renommer les produits « packs » (encore « néons ») chez Stripe.
3. Fusionner la PR #13 une fois le build Cloudflare vert et la revue faite (voir `CRM_REVIEW_PLAN.md`).
4. SMS : ouvrir l'envoi dans ta session dédiée (fournisseur, numéro).

## Risques connus
- L'Admin CRM n'a jamais été vu avec une vraie session super admin (aucun compte démo ne l'est) : à ouvrir une fois par Paul.
- Un seul vrai compte CRM en base (la démo) : les écrans Admin sont donc vides sans l'interrupteur « démo incluse ».
- Beaucoup de textes ont été écrits d'un trait : relecture FR/EN/ES à faire sur les écrans que tu montreras à un client.
