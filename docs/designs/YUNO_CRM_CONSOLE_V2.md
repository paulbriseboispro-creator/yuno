# Yuno CRM — la nouvelle Console (/crm), transposition du design de Paul

> Démarré le 2026-10-04. Source visuelle : projet Claude Design
> « Design system Yuno créé » (`b5dfca8f-6ecd-477f-9dc8-fb55f08dc8d6`), son
> dossier « Audit et passage au dev » et le `CLAUDE.md` du projet (Yuno CRM ne
> parle jamais de billetterie ni de porte ; aucune donnée Instagram mesurée).
> Branche `crm/redesign` (worktree `~/Desktop/yuno-crm.nosync`).

## Décisions d'architecture

- **Un module à part** : `src/crm/` (styles, ui, shell, pages, data, lib) et
  des routes `/crm/*` (`src/crm/routes.tsx`, appelé dans `App.tsx`). La Suite
  (`/owner`, `/organizer-app`) ne change pas ; un compte au produit `crm` y
  est renvoyé vers `/crm`.
- **Design system scopé** sous `.yc` (`src/crm/styles/crm.css`) : les noms du
  prototype (`--ink`, `--paper`, `--red-500`…) sont gardés tels quels pour que
  chaque écran se transpose ligne à ligne. Ils ne fuient pas : la Suite garde
  ses propres `--ink` / `--paper` (triplets RGB du thème pro). Aucun composant
  de la Suite n'est monté dans `.yc`. Fenêtres et toasts passent par le portail
  `#yc-portal` (un bloc en cours d'animation porte un `transform`).
- **États de survol** : le prototype écrit `style-hover` / `style-active` ;
  le composant `Hv` reprend la même grammaire (`hover={{…}}`, `active={{…}}`).
- **Portée** : `get_my_crm_spaces()` liste les espaces CRM ouvrables (même
  porte que `crm_scope_allowed`) ; `useCrmScope()` rend `{ space, rpc, qk }`.
  Toutes les RPC CRM prennent `(p_venue_id, p_organizer_user_id)`.
- **Textes** : section i18n `crm` (`src/i18n/locales/crm/modules/*`, triplets
  `[EN, FR, ES]`, comme le super admin). Vouvoiement en français, « usted » en
  espagnol. `useCrmT()` → `t`, `tp` (pluriels `.one/.other`), formats.
- **Monnaie** : les **Yunits** (nom choisi par Paul dans le design). 1 e-mail
  = 1, SMS = 40, DM Instagram = 10 (bientôt), WhatsApp = 100 (bientôt). Grille
  en base (`crm_pricing`, réglée par le super admin), jamais en dur au front.
- **Instagram et Pages d'inscription : « bientôt »** (demande de Paul du
  04/10) — écrans d'attente, rien de mesuré ni d'envoyé.

## Écrans

| Écran (design) | Route | Données | État |
|---|---|---|---|
| Dashboard Accueil | `/crm` | `crm_home` | ✅ |
| AppSidebar / AppTopBar / NotifBell | coquille | `get_crm_shell`, `crm_search`, `get_crm_wallet`, `get_crm_notifications` | ✅ (notifications : RPC à écrire) |
| Analyses (Ventes, Trafic, Communauté) | `/crm/analytics/*` | à écrire | ⏳ |
| Parcours client | `/crm/journey` | à écrire | ⏳ |
| Emails (vue, campagnes, modèles, analyse, réglages, résultats) | `/crm/emails/*` | `email_campaigns` + RPC | ⏳ |
| Email Studio, Email Envoi | `/crm/emails/studio/:id`, `/send/:id` | Email Studio v2 existant | ⏳ |
| SMS (vue, campagnes, modèles, analyse, réglages, résultats, composeur, envoi) | `/crm/sms/*` | `sms_campaigns` | ⏳ |
| Automatisations | `/crm/automations` | `email_automations` | ⏳ |
| Instagram (bientôt) | `/crm/instagram` | — | ⏳ |
| Soirées | `/crm/nights`, `/crm/nights/past`, `/crm/nights/:id` | `get_crm_nights`, `get_crm_night_report` | ⏳ |
| Pages d'inscription (bientôt) | `/crm/signup-pages` | — | ⏳ |
| Clients, Segments, Imports | `/crm/clients`, `/segments`, `/imports` | base vivante, `contact_segments`, `import_contact_list` | ⏳ |
| Connecteurs | `/crm/connectors` | actions `ticketing_*` | ⏳ |
| Réglages | `/crm/settings` | `crm_settings` | ⏳ |
| Compte (profil, équipe, facturation, notifications, aide) | `/crm/account/*` | — | ⏳ |
| Notifications | `/crm/notifications` | — | ⏳ |
| Recharger (Yunits) | `/crm/yunits` | portefeuille + Stripe | ⏳ |
| Tarifs (public) | `/crm/tarifs` | `crm_pricing_config` | ⏳ |
| Pages d'erreur | — | — | ⏳ |
| Admin CRM (11 écrans) | `/crm-admin/*` | à écrire | ⏳ |

## Migrations

| Fichier | Contenu | En base |
|---|---|---|
| `20261004100000_crm_console_spaces_settings` | espaces, `crm_settings` | ✅ 04/10 |
| `20261004110000_crm_yunits_wallet` | portefeuille de Yunits | ✅ 04/10 |
| `20261004120000_crm_console_shell` | `get_crm_shell`, `crm_search` | ✅ 04/10 |
| `20261004130000_crm_home` | `_crm_tickets`, `crm_home` | ✅ 04/10 |

## Vérification

`node scratchpad/crmshot.mjs /crm out.png desktop --full` (pilote `scripts/demo/drive.mjs`,
compte `crm@womber.fr`, serveur `yuno-crm-dev` sur 8081).
