# Yuno — Refonte des abonnements (profil Owner)

> Document de stratégie pricing. Rédigé le 2026-06-23, **décidé après revue CEO le 2026-06-23.**
> Statut : **décisions verrouillées, non implémenté.** Plan d'impl en §6, séquencement en §10.

---

## 1. La stratégie en une phrase

> **Yuno gagne 2× : abonnement (MRR) + commission sur chaque vente. Donc on ne paywalle JAMAIS ce qui génère du GMV (vendre, connecter) — on monétise la CROISSANCE.**

C'est un hybride SaaS + marketplace (comme Shopify, Square, Toast). Conséquence contre-intuitive : chaque billet, bouteille, conso ou booking vendu rapporte une commission. Verrouiller ces features derrière un paywall, c'est **bloquer son propre volume de transactions** et créer de la friction à l'inscription.

### Le wedge payant : Opère / Grandis / Scale

Le risque central d'un modèle où « vendre est gratuit » : pourquoi un club paierait-il, si Core suffit pour encaisser ? Réponse — la ligne payante n'est PAS le droit de vendre, c'est **l'outillage de croissance** :

- **Core (gratuit) = OPÈRE.** Le club fait tourner sa soirée sans payer.
- **Essential = première marche.** « Je suis une vraie business » : branding Yuno retiré, staff illimité, premières armes marketing (email promo, CRM léger).
- **Pro = GRANDIS (complet).** Analytics profondes, exports, VIP complet, orchestration DJ/orga. Le tier le plus haut disponible au lancement.
- **Elite = SCALE.** Prédictif, loyalty, leaderboard, groupe multi-établissement, API. **Pas dispo encore — tout est à construire.**

**Narratif anti « Yuno se paie deux fois » :** la commission paie le rail de paiement (Stripe + protection), l'abonnement paie le moteur de croissance. La feature gatée doit être une feature **dont l'absence coûte de l'argent au club** (sans promo + CRM, les clients ne reviennent pas), pas du confort.

---

## 2. La grille (3 paliers actifs + Elite « Bientôt » + Collab caché)

> Prix actuels dans le code (`src/lib/planFeatures.ts`) : Essential **39€** / Pro **69€** / Elite **99€**.
> Cette refonte est AUSSI un repricing (+26% / +43% / +101%), assumé : pré-revenu, c'est le bon moment.

| | **Core** (0€) | **Essential** (~49€) | **Pro** ⭐ (~99€) | **Elite** (~199€) |
|---|---|---|---|---|
| **Statut** | ✅ actif | ✅ actif | ✅ actif | 🔜 **Bientôt** (non achetable) |
| **Promesse** | Opère + connecte | Vraie business | Grandis (complet) | Scale + groupe |
| Billetterie | ✅ | ✅ | ✅ | ✅ |
| Boissons (orders, menu) | ✅ *(descendu)* | ✅ | ✅ | ✅ |
| VIP basique | ✅ *(descendu)* | ✅ | ✅ | ✅ |
| Urgence (scarcity) | ✅ *(descendu)* | ✅ | ✅ | ✅ |
| Connexion DJ/orga (`*_connect`) | ✅ *(descendu)* | ✅ | ✅ | ✅ |
| Staff / branding | ≤5 + branding Yuno | **illimité + branding retiré** | illimité + branding retiré | ✅ |
| Email | info | + **promo** | ✅ | ✅ |
| CRM clients (`clients_basic`) | — | ✅ | ✅ | ✅ |
| Promoteurs | basic | **full** | ✅ | ✅ |
| Analytics | tickets + basic | ✅ | + **advanced + exports CSV** | ✅ |
| VIP complet (tables full + service) | — | — | ✅ | ✅ |
| Orchestration DJ/orga (`*_orchestrate`) | — | — | rosters, analytics booking, payouts | ✅ |
| Live night, upsells | — | — | ✅ | ✅ |
| Loyalty + hype + prédictif + leaderboard | — | — | — | 🔜 **Bientôt** |
| Multi-établissement + API | — | — | — | 🔜 **Bientôt** |
| **Take rate** | ~4% | ~3,5% | ~3% | ~2,5% |

**Elite (199€)** reste défini mais **non achetable** au lancement : ses features (loyalty, prédictif, multi-établissement, API) sont entièrement à construire. Il s'active en Phase 4. Multi-établissement + API s'affichent en « Bientôt » dans le tier.

**Collab (0€)** : auto-accordé au club qui accepte un partenariat orga. **Gelé en liste statique** (voir §6, fix bloquant) — il ne doit plus dériver de Pro.

### Réaffectation des features

- **Core (OPÈRE) :** events, entry_qr, guest_list, analytics_tickets, `orders_qr`, `menu`, `staff_pin` (cap ≤5), `invoices_refunds`, `analytics_basic`, `vip_tables_basic`, `scarcity_tools`, `djs_connect`, `organizations_connect`, `promoters_basic`, email info. **Caps : staff ≤5, branding Yuno.**
- **Essential (+) :** caps levés (**staff illimité, branding retiré**), `email_campaigns_promotional`, `clients_basic`, `promoters` (full).
- **Pro (+) :** `analytics_advanced`, `exports_csv`, `vip_tables` (full), `vip_service`, `djs_orchestrate`, `organizations_orchestrate`, `live_night`, `offers_upsell`.
- **Elite (Bientôt) :** `loyalty_crm`, `hype_analysis`, `personalization_advanced`, `client_leaderboard`, multi-établissement, API.

---

## 3. Le modèle de commission + le toggle d'absorption

- **Le « 1,5% » souvent cité = le frais de traitement Stripe, PAS la commission Yuno.**
- **Vraie commission Yuno :** **4% billets/tables** (min 0,99€) + **3% boissons**. Dupliquée dans 4 fichiers (3 checkouts + `_shared/payment-split.ts`). À centraliser dans `getCommissionRate(plan, itemType)`.
- ⚠️ **Doc-rot à nettoyer :** `create-ticket-checkout/index.ts:526` commente « Yuno commission (7% of total) » alors que le taux réel est 4%.

### Toggle d'absorption des frais — DÉCIDÉ (Option C, per-merchant, club ET orga)

Chaque club et chaque orga choisit son modèle de frais (colonne `absorb_yuno_fees`, défaut `false`) :

- **Frais client (défaut, = actuel)** : `clientTotal = prix article + commission Yuno`. Le club/orga absorbe Stripe sur son net.
- **Absorb (opt-in)** : le club/orga **absorbe la commission Yuno** (déduite de son net) ; le fêtard ne paie au checkout que les frais Stripe. Affiche un badge demande « zéro frais Yuno ici » (arme marketing côté fan).
- **Co-event** : le réglage du **CLUB** gouverne la charge (vendeur de record, voir §9 décision 2), pas celui de l'orga.

C'est ce qui **rend le take rate dégressif réel** : en mode absorb, un take rate plus bas = plus d'argent gardé par le club, donc le pitch §5 devient vrai. En mode frais client, baisser le take rate ne fait que baisser le prix du fêtard (levier de conversion, pas de marge).

> ⚠️ Les taux (4% → 2,5%) et les prix (49/99/199) sont des **hypothèses à valider** contre les concurrents (DICE, Shotgun, Xceed, Fatsoma facturent 0€ d'abo + take rate fan — d'où l'importance que le payant soit l'outillage, pas le droit de vendre). La *structure* est défendue sans réserve.

---

## 4. Le changement à plus fort levier : dé-gater DJs + orgas

Aujourd'hui `djs` et `organizations` sont à Pro. Ce ne sont pas des features de club : ce sont **les points de jonction des deux marketplaces** (booking DJ + collab orga). Les paywaller **échoue les DJs et orgas de l'autre côté**, qui ne peuvent atteindre aucun club non-Pro.

### La correction

- **Connexion gratuite** (découvrir, booker, être booké, accepter une collab) → Core, via les nouvelles clés `djs_connect` / `organizations_connect`.
- **Orchestration payante** (roster multiple, analytics booking, payouts auto) → Pro, via `djs_orchestrate` / `organizations_orchestrate`.
- **Séquestre / contrat sécurisé DJ** = add-on par booking facturé — voir §9 décision 4.
- **Miroir du Collab pour les DJs** : booking confirmé → débloque la gestion DJ pour cet engagement.
- Qualité gérée par la **vérification** (verified/rising/resident), **pas par un paywall**.

> **Fix d'impl obligatoire :** splitter les feature-keys `djs` et `organizations` en `_connect` / `_orchestrate`. Sans ce split, « connexion en Core / orchestration en Pro » n'est pas exprimable dans `planFeatures.ts`.

---

## 5. Mécaniques GTM

- **Reverse trial** : nouveau club = Pro pendant 14 j → retombe en Core s'il ne paie pas (il ressent la perte des features de croissance). Infra trial déjà présente (`STANDARD_TRIAL_DAYS = 14`).
- **Pitch chiffré** par upgrade — VALABLE seulement en mode absorb (§3) : *« sur 30 k€/mois, ton take baisse de X → tu gardes Y de plus → le plan se rembourse tout seul ».*
- **Annuel = 10× mensuel** (2 mois offerts ; `ANNUAL_BILLED_MONTHS = 10`).
- **Early adopters 3 mois gratuits** (`EARLY_ADOPTER_FREE_DAYS = 90`, ×15) — basculent au **nouveau** prix à la fin de leur fenêtre.
- **Multi-établissement / API = features Elite** (Phase 4), pas un 5ᵉ palier.

---

## 6. Ce qu'il y a à modifier

| # | Fichier / zone | Change | Phase |
|---|---|---|---|
| 0 | `src/lib/planFeatures.ts` | **Geler `COLLAB_FEATURES` en liste statique explicite AVANT de toucher Pro** (fix bloquant — sinon re-bucket Pro inflate le tier gratuit Collab) | **1** |
| 1 | `src/lib/planFeatures.ts` | re-bucket selon §2 + split `djs`/`organizations` → `_connect`/`_orchestrate` + reprix 49/99/199 + Elite statut « Bientôt » | **1** |
| 2 | Stripe + secrets Supabase + `club-subscription` | créer 4 prix (essential/pro × mensuel/annuel), MAJ `PRICE_TO_PLAN`, garder les anciens IDs pour grandfathering | **1** |
| 3 | `src/pages/OwnerBilling.tsx` | 3 cartes actives + 4e carte Elite en état « Bientôt » + badge recommandé Pro + take rate | **1** |
| 4 | **Caps Core** : `invite-staff` (staff ≤5) + branding Yuno conditionnel (checkout/email) | donne ses dents à Essential dès le lancement | **1** |
| 5 | `src/components/PlanGuard.tsx` | messages d'upgrade (dents backend en Phase 3) | **1/3** |
| 6 | i18n `src/i18n/data.ts` | EN/FR/ES des noms / taglines / copy (Opère/Grandis/Scale) | **1** |
| 7 | **Helper commission centralisé** + 3 checkouts + `_shared/payment-split.ts` | `getCommissionRate(plan, itemType)`, faire descendre le plan dans `SplitInput`, corriger le doc-rot « 7% » | **2** |
| 8 | **Toggle absorption** : colonne `absorb_yuno_fees` (venues + orga), 3 checkouts, payment-split, compta, badge fan | nouveau (§3) | **2** |
| 9 | **Séquestre add-on** : pricing par booking (% du montant sécurisé, §9.4), réutilise `dj_booking_contracts` | repositionnement | **2** |
| 10 | ~10 edge functions | `assertPlanFeature(venueId, feature)` (gating backend profond : exports, VIP full, orchestration) | **3** |
| 11 | onboarding + `useSubscriptionPlan.tsx` | reverse trial (Pro 14 j → Core) | **3** |

### Ce qui ne bouge PAS

- **Remboursements** (`cancel-ticket`, `staff-cancel`, `owner-refund`) lisent le `service_fee` déjà stocké → le taux est figé à l'achat, un taux par palier ne les casse pas.
- **Analytics** (`src/utils/fees.ts`) lit aussi le `service_fee` stocké → rien à toucher.

---

## 7. Effort

| Phase | Build (CC) | Élapsé réaliste¹ | Équipe humaine |
|---|---|---|---|
| **1** Geler Collab + re-bucket + split keys + reprice + UI + caps Core + de-gating | ~4-5 h | ~1 jour | 4-5 jours |
| **2** Commission centralisée + toggle absorption + séquestre add-on | ~5-6 h | ~1-1,5 jour | ~1,5 semaine |
| **3** Gating backend profond + reverse trial | ~3 h | ~½-1 jour | 3-4 jours |
| **Total 1→3** | **~1,5-2 j build** | **~3 jours** | **~3 semaines** |
| 4 (Elite : loyalty / prédictif / multi-établissement / API) | différé | — | semaines |

¹ Pas de tests dans le projet : tout se vérifie à la main / comptes démo / Stripe test mode. Le money path (commission, toggle absorption) est le plus à risque — checklist Stripe test-mode obligatoire + mini test pur de `getCommissionRate`.

---

## 8. Pourquoi faire ça maintenant

1. **Pré-revenu = migration ≈ 0.** Grandfathering trivial (abonnés existants gardés à leur prix jusqu'au churn). Repricer maintenant coûte ~5× moins cher qu'après le lancement.
2. **La Phase 1 force déjà la création des prix Stripe en attente** — pas de travail en double.
3. **Le dé-gating DJ/orga débloque deux marketplaces d'un coup**, au meilleur moment (cold-start).

---

## 9. Décisions — TRANCHÉES (revue CEO 2026-06-23)

1. **Modèle de frais : C (hybride), per-merchant.** Toggle d'absorption (§3), opt-in club + orga. Phase 1 reste en frais-client par défaut (zéro risque paiement) ; le toggle arrive en Phase 2.
2. **Co-event : le taux du CLUB.** Vendeur de record / titulaire licence alcool / déjà `on_behalf_of=club`. Son réglage d'absorption gouverne aussi.
3. **Frontière connexion vs orchestration :** connexion = découvrir + 1 booking/collab actif (Core) ; orchestration = rosters multiples, analytics booking, payouts auto (Pro). Via le split de feature-keys.
4. **Séquestre DJ : add-on par booking**, ni Pro ni Elite. La garantie de paiement est le produit, facturée directement, dispo dès Core/Pro.
   - **Tarif (DÉCIDÉ) : 4% du montant sécurisé, min 2€, plafonné à ~250€**, payé par le club (acheteur du booking) en plus du cachet ; le DJ touche 100% garanti. Couvre le coût Stripe Connect (~2%) + le risque de garantie de paiement que Yuno porte, tout en gardant un gros booking headliner raisonnable. Cohérent avec le 4% billets/tables (`YUNO_TICKET_TABLE_RATE`).
5. **Prix + take rate :** hike assumé (pré-revenu). Validation comp = argumentaire de vente post-hoc. Les comps nightlife (DICE, Shotgun) prennent 0€ d'abo + take rate fan → le MRR Yuno se justifie par l'outillage de croissance, pas par le droit de vendre.

---

## 10. Séquencement recommandé

1. **Phase 1 maintenant** (gros impact, zéro risque paiement) : geler Collab → re-bucket + split keys + reprice → UI + Elite « Bientôt » → caps Core (donne ses dents à Essential) → crée les prix Stripe en attente.
2. **Phase 2** (sa propre PR, Stripe test mode) : commission centralisée → toggle absorption club+orga → séquestre add-on.
3. **Phase 3** : gating backend profond + reverse trial.
4. **Phase 4 différée** : construire Elite (loyalty / prédictif / multi-établissement / API), puis l'activer.
