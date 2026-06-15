# Démo Yuno — club "Womber" + comptes liés

Données fictives pour des **dashboards vivants** pendant les appels de vente (clubs, orga…).
Tout est rattaché au compte **existant `owner@womber.fr`** et à des comptes liés créés pour la démo.

## Fichiers

| Fichier | Rôle |
|---|---|
| `seed-demo-womber.sql` | Crée les comptes + remplit tous les dashboards. **Idempotent** (rejouable). |
| `seed-demo-womber-teardown.sql` | Efface les données démo. Option B = supprime aussi les comptes liés. |

## Comment lancer (2 min)

1. Ouvre **Supabase Dashboard > SQL Editor** (projet `fulawxvdlwtdlpkycixe`).
2. Colle tout `seed-demo-womber.sql` → **Run**.
3. À la fin, un tableau récap montre ce qui a été semé (events, billets, commandes…).

> Le script crée lui-même les 6 comptes liés. **Si la création échoue** (selon la version
> GoTrue), crée-les à la main dans **Auth > Add user** (coche *Auto Confirm User*, même mot de
> passe `YunoDemo2026!`) puis relance le script — il détecte les comptes existants et ne les
> recrée pas. Comptes à créer : `organizer@`, `promoter@`, `affiliate@`, `bouncer@`,
> `barman@`, `cloakroom@` (tous `@womber.fr`).

## Identifiants démo

| Compte | Rôle | Mot de passe | PIN |
|---|---|---|---|
| `owner@womber.fr` | Club "Womber" (ton compte existant) | *ton mot de passe / MFA* | — |
| `organizer@womber.fr` | Organisateur / BDE | `YunoDemo2026!` | — |
| `promoter@womber.fr` | Promoteur du club | `YunoDemo2026!` | — |
| `affiliate@womber.fr` | Agence affiliée | `YunoDemo2026!` | — |
| `bouncer@womber.fr` | Videur (porte) | `YunoDemo2026!` | `1234` |
| `barman@womber.fr` | Barman | `YunoDemo2026!` | `1234` |
| `cloakroom@womber.fr` | Vestiaire | `YunoDemo2026!` | `1234` |

Le staff se connecte par email+mdp puis saisit le **PIN 1234** une fois (session 24 h).

## Ce que chaque dashboard montre

- **Owner (club)** : ~10 soirées (passées + à venir), **billets vendus** par palier, **commandes bar**
  (mix boissons/shots/soft), **tables VIP** réservées, **CRM clients** (segments RFM, 2 bannis),
  funnel de conversion (visiteurs → panier → checkout), revenu net jour par jour.
- **Organisateur / BDE** : 4 événements (Welcome Party, Gala, Boat Party…), billets vendus,
  acheteurs uniques, revenu — Stripe débloqué (pas de mur d'onboarding).
- **Promoteur** : clics, conversions (billets + tables), commissions (dues/payées), payouts.
- **Affilié** : 2 clubs partenaires, 6 events (1 sans lien billet = warning), clics + vues sur 60 j.
- **Staff** : la porte (bouncer) voit des guest lists avec entrées à scanner.

## À savoir (important)

- **Ça écrit sur la PROD.** Le club est **masqué du public** (`is_hidden=true`) et les events
  ne sont **pas découvrables** — invisibles dans l'Explore des vrais utilisateurs.
- **Le MFA de `owner@womber.fr` n'est pas touché** : tu te connectes avec ton propre
  authentificateur (bypass 24 h après la 1re vérif).
- Les ventes démo sont marquées `purchase_source='demo_seed'` / emails `@demo.womber.fr` /
  `events.access_code='DEMO_SEED'` → nettoyage chirurgical, ne touche pas à d'éventuelles
  vraies données.
- **Le dashboard admin agrège tous les clubs** : le revenu démo de Womber apparaîtra dans les
  totaux plateforme. Normal (c'est ta donnée), à garder en tête. Lance le teardown quand la
  campagne de démos est finie.
- Aucune transaction Stripe réelle : les ventes sont `status='paid'` directement (faux argent).

## Tout supprimer

Colle `seed-demo-womber-teardown.sql` dans le SQL Editor. Par défaut il garde les comptes
(re-seed rapide). Décommente le bloc **OPTION B** en bas pour supprimer aussi les 6 comptes liés.
