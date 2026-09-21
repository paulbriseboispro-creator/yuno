# Collab à barème sur le CA de la soirée + décompte de fin de soirée

Date : 2026-09-21. Première soirée visée : Amoris × Goya Social Club (jeudi).

## Le problème

Le contrat collab Yuno partage **chaque vente, au moment de la vente, à un
pourcentage fixe par pilier** (billets / tables / boissons). Le deal Goya rémunère
l'organisateur **une fois, après la soirée, à un taux qui dépend du total de la
nuit**, et ce total inclut du chiffre que Yuno ne voit pas (bar en caisse, billets
vendus à la porte, consommations des tables au-delà de la formule).

```
< 3 500 €        0 %
3 500 – 5 500    7 %
5 500 – 7 500   11 %
7 500 – 10 000  15 %
10 000 – 12 500 20 %
> 12 500        24 %
```

Aucun pourcentage figé au checkout ne peut exprimer ça : quand un billet se vend,
personne ne connaît encore le palier.

## La réponse : un deuxième MODE de rémunération dans le même contrat

`revenue_split_rules.remuneration = { mode: 'tiered_total', tiers: [{from, pct}],
tiers_mode: 'flat' | 'marginal' }`. Les trois blocs pilier restent présents à
`0 / 100` (club) : tout le code existant (bannière, panneau Argent, garde des
piliers, boissons 100 % club) continue de lire une forme valide. `flat` = le taux
du palier atteint s'applique à TOUT le total (lecture littérale des termes Goya) ;
`marginal` = chaque tranche à son taux (barème progressif, sans effet de seuil).

### Pendant la vente : les fonds sont RETENUS par Yuno

C'est la réponse à « et si le club vide son Stripe avant de virer ». Les billets et
les tables d'une soirée à barème partent en charge **sur la plateforme**
(`splitMode = 'separate'`, `on_behalf_of` = le club, vendeur de record), et leur
transfert est **retenu sans date** (`transfers_release_at = NULL`). Le cron
`release-held-co-event-transfers` ne libère que les lignes datées, donc rien ne
part tant que le décompte n'est pas accepté. Les boissons via Yuno restent en
charge directe sur le club (licence alcool, 100 % club dans tous les cas).

### Après la soirée : le décompte, en double vérification

1. **Le club déclare** (`declare_collab_night_closing`) : CA bar en caisse hors
   Yuno, billets vendus à la porte (nombre + montant), consommations des tables
   au-delà des formules, autre (libellé libre), note, référence du ticket Z. Il
   peut redéclarer tant que rien n'est accepté.
2. **L'organisateur accepte ou conteste** (`accept_…` / `dispute_…`). Yuno
   affiche aux deux la même grille : chiffres Yuno (billets, tables, boissons via
   Yuno, formules `src/utils/fees.ts`), chiffres déclarés, total, palier, dû.
3. **À l'acceptation, Yuno fige et répartit** :
   - `dû = barème(total)` ;
   - `retenu = Σ` des jambes retenues (net des frais Stripe) sur les ventes non
     remboursées ;
   - `en ligne = min(dû, retenu)` si l'organisateur a un compte Stripe actif ; ce
     montant est réparti au prorata sur chaque ligne `revenue_distributions`
     (jambe secondaire → organisateur, jambe primaire → club pour le reste),
     `transfers_release_at = now()`, et le cron de libération est appelé
     immédiatement. Les virements Stripe partent des fonds RETENUS : le club ne
     peut pas les avoir dépensés ;
   - `SEPA = dû − en ligne` (le bar a fait grossir le dû au-delà du retenu) : un
     lot `collab_table_settlements` de `kind = 'night_closing'` est créé, et le
     cycle existant s'applique (le club vire avec la référence, l'organisateur
     seul confirme la réception, litige + relance automatique).
   Sans compte Stripe organisateur, tout le dû passe en SEPA et le retenu est
   libéré au club : l'écran le dit en clair AVANT la soirée.

Aucune libération automatique sans accord : sans décompte accepté, les fonds
restent sur la plateforme. Un litige durable se tranche par le super admin.

## Fichiers

- SQL : `supabase/migrations/20260921120000_collab_night_closing.sql`
- Edge : `_shared/payment-split.ts` (`isTieredCollab`, branche retenue),
  `stripe-webhook` (release_at NULL en mode barème). Redéployer
  `create-ticket-checkout`, `create-table-checkout`, `create-checkout`,
  `stripe-webhook`.
- Front : `src/lib/splitRules.ts` (types, `tierFor`), `src/lib/collabNightClosing.ts`
  (client RPC), `components/collab/TieredRemunerationEditor.tsx`,
  `components/collab/CollabNightClosingCard.tsx`, bannière, avenant, panneau
  Argent, contrat v2026-09-21 (PDF + dialogue).
- Tests : `src/lib/__tests__/collabTiers.test.ts`, smoke SQL dans un bloc DO annulé.
