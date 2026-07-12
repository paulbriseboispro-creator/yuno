# Système de vente boissons — zéro friction, plein d'intention

> Conçu le 2026-07-12. Remplace la stratégie « détour club » (l'event renvoyait vers la
> page club pour exposer la carte) devenue obsolète depuis le Mode Live : au scan
> d'entrée, l'app bascule d'elle-même en mode consommation.

## Le principe

Un client n'achète pas une boisson parce qu'il a *vu* la carte — il achète quand
l'intention est au maximum. Le système place l'offre boissons sur les 5 moments
d'intention, sans jamais bloquer le chemin billet :

| Moment | Surface | Mécanique |
|---|---|---|
| 1. Découverte | Page soirée (`EventDetails`) | Navigation **directe** vers la soirée (plus de détour club) + teaser « boissons dans l'app, zéro file » |
| 2. Achat billet | Checkout (existant, inchangé) | Offres upsell in-checkout (`TicketUpsellSelector`) |
| 3. Post-achat ★ | **Nouvelle page `/order/upsell`** | Boissons au **prix presale** (si activé par le club, sinon prix normal), achat optionnel, puis billet |
| 4. Rappel | Email confirmation billet + push AUTO `drinks_preorder` (J, 14h–17h) | Éducation : « commande à l'avance / dans l'app le soir même » |
| 5. Soir J | Mode Live (existant) | Commande 1-tap, retrait QR au bar, bouteilles solo |

Le défi éducation (« les users ne savent pas qu'on peut acheter des boissons avec
Yuno ») est traité par répétition douce : teaser avant l'achat, page dédiée après
l'achat, email, push le jour J, puis le Mode Live fait la démonstration in situ.

## La page upsell post-checkout (`/order/upsell`)

- Affichée juste après le paiement billet réussi (acheteur connecté), **avant** la
  confirmation. Skippable en un tap (« Voir mon billet »).
- Entrées : `?ticket=<id>` (post-checkout, retour natif inclus, billets gratuits inclus)
  ou `?event=<id>` (deep-link du push jour J — résout le billet payé de l'utilisateur).
- Contenu : boissons actives du club, **presale d'abord** (badge + prix barré),
  steppers de quantité, total collant, paiement via `create-checkout` (infra
  existante : validation prix serveur, split Stripe, kill-switch, mode démo).
- L'achat crée une commande boissons classique liée à la soirée (`orders.event_id`)
  → QR de retrait le soir J dans le Mode Live / Mes commandes. Zéro nouveau backend.
- Age gate : composant `AgeGate` existant (déclaration de majorité honor-system),
  exigé si la sélection contient de l'alcool.
- Éligibilité (sinon redirection instantanée vers la confirmation) :
  `venues.menu_enabled` ∧ `venues.post_checkout_upsell_enabled` ∧ carte non vide.
- Les invités (guest checkout) gardent l'écran incitation-compte : pas d'upsell.

## Prix presale

Mécanique **existante** réutilisée telle quelle : `drinks.presale_price` +
`drinks.presale_active` (gérés par boisson dans `/owner/menu`, activation en masse
disponible). `create-checkout` applique déjà la précédence presale → promo → prix.
La page upsell affiche le prix barré et le libellé « prix presale jusqu'au début de
la soirée ». Aucune nouvelle table de pricing.

## Ce que le club contrôle

| Réglage | Où | Défaut |
|---|---|---|
| Vente boissons (master) | `/owner/menu` — `menu_enabled` | existant |
| **Upsell post-achat** | `/owner/menu` — `post_checkout_upsell_enabled` (nouveau) | **ON** (opt-out) |
| Prix presale par boisson | `/owner/menu` — `presale_price`/`presale_active` | existant |
| Push jour J « commande tes boissons » | `/owner/push` — automatisation `drinks_preorder` (nouvelle, 5e) | OFF (opt-in, comme les 4 autres) |

## Mesure

- `orders.purchase_source` (nouvelle colonne, texte libre) : `post_checkout_upsell`
  posé par la page upsell via `create-checkout`. Permet de mesurer le taux
  d'attache boissons/billet par canal. (Dashboards owner : chantier ultérieur.)
- Push : tracking existant `?pc=` + `push_campaign_events`.

## Architecture (fichiers touchés)

- **Navigation directe** : nouveau `src/lib/eventNavigation.ts` (`goToEvent`),
  remplace le bloc 3-way copié-collé dans `EventCard`, `ExploreListRow`,
  `ExploreRankCard`, `ExploreRailCard`, `ExploreEventCarousel`, `AllEventsPage`.
  Recherche/favoris/suggestions allaient déjà en direct — le comportement devient homogène.
- **Page** : `src/pages/PostCheckoutUpsell.tsx` + route `/order/upsell` (App.tsx).
- **Câblage** : `VerifyTicketPayment` (connecté + retour natif → upsell),
  `TicketCheckout` (billet gratuit → upsell), `OrderConfirmation` (carte rappel
  boissons si rien acheté), `EventDetails` (teaser).
- **Migration** `20260712*_drinks_upsell_system.sql` : `venues.post_checkout_upsell_enabled`,
  `orders.purchase_source`, CHECK + fenêtre `drinks_preorder` dans
  `get_due_push_automations()` (`[start−9h, start−6h)`, gated `menu_enabled`).
- **Push** : `_shared/push-automations.ts` (5e entrée, deep-link `/order/upsell?event=`),
  `src/lib/pushTemplates.ts` + i18n `pushTpl.drinksPreorder.*`.
- **Email** : section boissons optionnelle dans `buildTicketConfirmation`
  (`_shared/email-templates.ts`), alimentée par `send-ticket-confirmation`.
- **Edge à redéployer** (fonctions existantes, pas de risque 402) :
  `create-checkout` (purchase_source), `send-ticket-confirmation`,
  `process-scheduled-campaigns` (module partagé push), `yuno-assistant`,
  `owner-assistant` (connaissance + tool toggle).
- **Docs vivantes** : `ownerHelpContent.ts` (+ article), `CLIENT_KNOWLEDGE_BASE`,
  `HELP_ARTICLES` (+ tool `toggle_post_checkout_upsell`).

## Runbook déploiement (dans l'ordre)

1. `supabase db push` (⚠️ vérifier les migrations d'autres chantiers en attente).
2. `supabase functions deploy create-checkout send-ticket-confirmation process-scheduled-campaigns yuno-assistant owner-assistant`.
3. Front : push → build Cloudflare Workers.
4. QA : achat billet démo (@womber.fr) → page upsell → achat boisson presale → QR
   dans Mes commandes ; vérifier le skip ; vérifier club avec `menu_enabled=false`
   (redirection directe confirmation).
