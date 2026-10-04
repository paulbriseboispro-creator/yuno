# Un compte, deux produits : Yuno Billetterie ⇄ Yuno CRM

Décision de Paul (2026-10-04) : les deux produits restent deux plateformes, mais
un même compte (club ou organisation) peut avoir les deux. Même connexion, même
base de contacts, deux Consoles. Migration `20261006100000_account_products_cohabitation.sql`.

## Le modèle

- `venues.product` / `organizer_profiles.product` = le produit **principal**,
  celui de l'inscription (inchangé).
- `extra_products text[]` (mêmes tables) = les produits **ajoutés**. Écrit
  seulement par `_account_add_product` (SECURITY DEFINER, interne) ; le trigger
  `guard_account_product` refuse toute écriture client sur `product` comme sur
  `extra_products`.
- Le CRM ajouté est **payant à part** : son ajout crée l'essai de 14 jours
  (`crm_start_trial`, déclenché aussi sur `extra_products`), puis l'abonnement
  CRM. La Billetterie ajoutée est sans abonnement.
- Journal : `account_product_events` (ajouts, invitations). Invitations :
  `account_product_invites` (jeton haché sha256, 14 jours). RLS sans policy,
  tout passe par les RPC.

## Les trois portes (ne pas les confondre)

| Fonction | Question | Utilisée par |
|---|---|---|
| `crm_scope_has_crm(scope)` | Le CRM est-il ouvert sur ce compte (principal ou ajouté) ? | `get_my_crm_spaces`, `crm_user_in_scope`, `get_crm_limits`, `can_manage_email_assets`, Yunits (`crm_yunits_ensure_allowance`), balayages |
| `crm_scope_is_crm(scope)` | Compte CRM **pur** (CRM principal, sans Billetterie ajoutée) ? | règles au niveau du compte entier : `email_sender_monthly_free`, `crm_scope_paused`, `crm_scope_limits`, `crm_retention_sweep` (qui EFFACE des contacts) |
| `crm_campaign_is_crm(campaign)` | Cette campagne email est-elle une campagne CRM ? | `enqueue_campaign_recipients` (Yunits + refus en pause), `_crm_yunits_debit_child_recipients`, `mark_campaign_recipients_failed` |

Un compte qui a les deux produits suit les règles de la Billetterie au niveau du
compte (15 000 emails offerts, jamais de pause ni d'effacement côté Billetterie) ;
seules ses campagnes CRM débitent des Yunits et s'arrêtent si le CRM est en pause.
Une campagne est CRM si : compte CRM pur ; sinon `email_campaigns.product = 'crm'`
(posé par la Console CRM, `src/crm/data/emailActions.ts`), ou une audience
`kind: 'crm'`, ou sa campagne mère l'est. Rien ne change pour un compte pur.

Limites connues : les automatisations (`email_automations`) sont communes aux deux
Consoles et suivent le produit principal ; les SMS CRM restent fermés côté moteur.

## Les trois chemins pour ouvrir l'autre produit

1. **Funnel Yuno CRM (landing)** : un client qui se connecte avec Google / Apple
   et qui a déjà un compte voit l'étape « Vous avez déjà un compte Yuno » →
   `open_product_on_my_account('crm', …, p_signup_key)` → Console `/crm`. Par
   email + mot de passe, « adresse déjà utilisée » mène à
   `yunoapp.eu/auth?redirect=/open/crm`.
2. **Page `/open/crm` et `/open/suite`** (`src/pages/OpenProduct.tsx`, DA Yuno
   CRM) : sans jeton, le titulaire choisit un de ses comptes
   (`get_my_product_accounts`) ; avec `?token=`, il accepte l'invitation
   (`get_product_invite`, `accept_product_invite`). Seul le **titulaire** (club
   possédé, organisation fondée) ouvre un produit ; jamais en accès assisté ni
   sur un compte démo.
3. **Super admin** : `/admin/organizers` (colonne « Produits ») et la fiche d'un
   club (`/admin/venues/:id`) → bouton « Produits » (`AccountProductsButton`) :
   « Inviter par email » (edge `admin-account-recovery`, action
   `invite-product`, email `_shared/product-invite-email.ts` au style Yuno CRM)
   ou « Ouvrir directement » (`admin_add_account_product`). Chaque ajout émet
   l'alerte `admin_account_product_added` (`/admin/alerts`).

## Passer d'une Console à l'autre

- Billetterie → CRM : lien « Ouvrir Yuno CRM » au pied des barres latérales
  club et organisateur (`OpenCrmSidebarLink`), qui pose `yuno.crm.space`.
- CRM → Billetterie : lien « Yuno Billetterie » au pied de la barre de la
  Console CRM quand l'espace a `products` contenant `suite`.
- `useAccountProductFor` ne replie la Console de la Suite en mode CRM que pour
  un compte CRM pur.

## Reste à faire

- L'admin CRM (`src/crm/admin`, `crm_admin_*`, `_crm_admin_rows`) filtre encore
  sur `product = 'crm'` : les comptes Billetterie avec CRM ajouté n'y
  apparaissent pas. Remplacer par `crm_scope_has_crm`.
- Mode d'emploi (`ohelp.*`) et assistants IA : article sur l'ouverture du
  second produit.
