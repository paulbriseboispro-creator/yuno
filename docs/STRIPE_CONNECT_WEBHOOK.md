# Stripe — brancher le webhook « Comptes connectés »

À faire UNE fois, avant la première vente réelle d'un organisateur ou d'un club.
Durée : 5 minutes. Rédigé le 2026-09-29, avec le passage des comptes connectés
en Accounts v2 (voir `CLAUDE.md` § « Stripe Connect »).

## Pourquoi c'est indispensable

Quand un organisateur vend seul (ou un club vend ses boissons), la vente est une
**charge directe** : elle naît sur le compte Stripe DU PRO, pas sur celui de
Yuno. Stripe n'envoie alors les événements de cette vente qu'à un endpoint qui
écoute les **comptes connectés**. Le seul endpoint branché aujourd'hui écoute le
compte Yuno (plateforme) : il ne voit rien de ces ventes.

Sans ce second endpoint :

- un acheteur qui ferme l'onglet avant de revenir sur Yuno (fréquent avec
  Apple Pay) paie mais **ne reçoit ni billet ni QR** : `verify-ticket-payment`
  ne tourne que sur le retour navigateur, et le filet `checkout.session.completed`
  du webhook n'arrive jamais ;
- les remboursements et litiges faits depuis le tableau de bord Stripe du pro ne
  sont pas vus par Yuno ;
- le statut « paiements prêts » d'un pro ne se met à jour que quand il rouvre sa
  Console (les checkouts le revérifient chez Stripe, mais c'est un filet).

La fonction `stripe-webhook` sait déjà lire ce second endpoint : elle essaie les
deux secrets de signature (`STRIPE_WEBHOOK_SECRET` puis
`STRIPE_WEBHOOK_SECRET_CONNECT`). Il ne manque que l'endpoint et son secret.

## 1. Côté Stripe (compte Yuno, mode LIVE)

1. Ouvrir <https://dashboard.stripe.com> sur le compte **Yuno**, interrupteur
   « Mode test » **désactivé** (on branche le live).
2. **Développeurs → Webhooks** (dans Workbench : onglet « Webhooks » ou
   « Destinations d'événements »), puis **« + Ajouter une destination »**.
3. **Événements provenant de : « Comptes connectés »** (selon la version de
   l'écran : « Connected accounts » / « Comptes connectés et v2 »). C'est LE
   choix qui compte — « Votre compte » existe déjà.
4. **Style de charge utile : « Snapshot »** (instantané) — pas « Thin » :
   `stripe-webhook` lit l'objet complet dans l'événement.
5. **Version de l'API** : laisser celle proposée par défaut.
6. **Événements** — cocher exactement ceux que `stripe-webhook` traite pour un
   compte connecté :
   - `account.updated`
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `charge.refunded`
   - `charge.dispute.created`
7. **Type de destination : « Endpoint de webhook »**, URL :
   ```
   https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook
   ```
   (la même URL que l'endpoint plateforme existant). Nom conseillé :
   « Yuno — comptes connectés ».
8. **Créer la destination**, l'ouvrir, puis **« Clé secrète de signature » →
   « Révéler »** et copier la valeur `whsec_…`. Elle est propre à CET endpoint
   (différente de celle de l'endpoint plateforme).

## 2. Côté Supabase

1. <https://supabase.com/dashboard/project/fulawxvdlwtdlpkycixe> → **Edge
   Functions → Secrets** (ou Project Settings → Edge Functions).
2. **Ajouter un secret** :
   - nom : `STRIPE_WEBHOOK_SECRET_CONNECT`
   - valeur : le `whsec_…` copié à l'étape 1.8
3. Enregistrer. Aucun redéploiement : les fonctions lisent les secrets à
   l'exécution.

Ne jamais coller ce secret dans le code, un commit ou une conversation.

## 3. Vérifier

- Dans Stripe, ouvrir la nouvelle destination : dès qu'un pro remplit son
  formulaire Stripe, des `account.updated` apparaissent avec un statut **200**.
- Un **400 « Invalid signature »** = le secret collé dans Supabase n'est pas
  celui de CETTE destination (étape 1.8), ou il a un espace en trop.
- Après un achat test, `checkout.session.completed` et `payment_intent.succeeded`
  doivent apparaître en 200 sur cette destination.
