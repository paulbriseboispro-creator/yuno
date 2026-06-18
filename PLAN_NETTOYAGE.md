# Ce qui vaut le coup à corriger — Yuno

**Date** : 2026-06-18 · **Auteur** : Staff Engineer (revue post-session de nettoyage)
**But** : trier le reste de la dette en **« vaut le coup »** vs **« à ne pas faire »**, avec effort et valeur.
Complète `TECH_DEBT_AUDIT.md` (l'audit complet). Ici : la décision d'investissement.

---

## État de départ (déjà fait cette session)

| Axe | État |
|---|---|
| Code mort | purgé — 87 fichiers + 17 dépendances (~11 500 lignes) |
| TypeScript | **0 erreur réelle** (était 6-11) |
| Vrais bugs | 8 corrigés (échecs silencieux : IBAN, scan d'entrée, conso VIP, prix promo, profils, uploads) |
| God-page #1 | `OwnerTicketing` 3151 → 1653 lignes (16 composants), **QA navigateur OK** |
| Branche | `audit/tech-debt-2026-06` poussée, build vert |

Le bruit (`console.log`, couleurs inline) et l'architecture (god-pages, couche data) restent.

---

## ✅ Ce qui VAUT le coup (priorisé par ROI)

### 1. Couche data + React Query — **le plus haut levier**
**Problème** : 793 appels `supabase.from(...)` dispersés dans les pages/composants ; React Query est installé et configuré mais court-circuité (33 `useQuery` dans 5 fichiers seulement). Pas de cache, pas de dédup, pas d'invalidation, chaque hook réinvente loading/error.
**Pourquoi ça vaut le coup** : c'est la dette qui **ralentit chaque nouvelle feature** et rend un changement de schéma dangereux (il touche des dizaines de fichiers). C'est le #1 de l'audit.
**Quoi** : créer `src/data/queries.ts` + des hooks `useQuery`/`useMutation`, migrer **par domaine** (venues → events → orders → analytics). Bénéfice immédiat : cache, retry, testabilité, moins de boilerplate.
**Effort** : ~1-2 jours CC, incrémental et QA-vérifiable domaine par domaine.

### 2. Démanteler les god-pages restantes
**Problème** : 11 pages > 1000 lignes mélangent état + logique + UI inline.

| Lignes | Page | QA compte démo |
|---|---|---|
| 1913 | `Bouncer` | oui (staff) |
| 1694 | `MyOrders` | partiel (déjà entamée) |
| 1504 | `Barman` | oui (staff) |
| 1458 | `PromoterLinktree` | non |
| 1283 | `OwnerEvents` | oui (déjà entamée) |
| 1265 | `EventDetails` | oui (public) |
| 1247 | `AffiliateLinktree` | non |
| 1188 | `Cart` | partiel |
| 1146 | `Explore` | oui (public) |
| 1135 | `OwnerAnalytics` | oui |
| 1114 | `OwnerCustomers` | oui |

**Pourquoi** : maintenabilité — le code devient navigable et testable, comme `OwnerTicketing` l'a prouvé (3151 → 1653).
**Quoi** : extraction mécanique (dialogs → composants, sections → composants, dédup), pattern **verbatim + tsc + build + QA** déjà rodé. 1 PR par page.
**Effort** : ~30 min-1h CC par page → ~6-10h pour les 11.

### 3. Quick wins cosmétiques
- **`console.log` résiduels** (10 fichiers) → purge. **Effort : 15 min.**
- **Centraliser les tokens couleur** (1839 hex inline) → Tailwind/CSS vars, par page en commençant par les dashboards. **Effort : ~1 j + QA visuelle.** Valeur : cohérence, mais visuel → vérifier au navigateur.
- **Imposer `formater.ts` / `lib/timezone.ts`** (sous-utilisés) → remplacer les ~89 `toLocaleString`/`date-fns` inline. **Effort : ~0,5 j.**

---

## ❌ Ce qui NE vaut PAS le coup (acter, ne pas y revenir)

| Item | Pourquoi pas |
|---|---|
| **1596 `no-explicit-any`** (97% des « erreurs » lint) | Quasi tous **légitimes** (colonnes `Json` Supabase, données dynamiques). Les typer = effort énorme, valeur nulle. Chasser le lint à 0 est le **mauvais objectif**. |
| **~75 mutations « fire-and-forget »** (`*_clicks`, `*_pings`, tracking) | **Intentionnel**. Les « corriger » serait **régressif**. |
| **209 `react-hooks/exhaustive-deps` en masse** | Auto-fix **change le comportement** des effets → risque de bugs. Cas par cas seulement, si bug avéré. |

Forcer ces 3 catégories = des jours de travail pour, au mieux, zéro valeur, au pire des régressions.

---

## 🟡 Enjeu moyen (optionnel, vérifiable si besoin)
Échecs silencieux restants à enjeu moyen (les à-fort-enjeu sont déjà corrigés) :
- Toggles `is_active` : `OwnerUpsellCartRules`, `OwnerUpsellTicketOffers`.
- Deletes `table_packs` (`EventTablesSetupModule`, `OrgEventTablesPanel`).
- `email_campaigns` status (`CampaignBuilder`).

À fixer (vérifier `{ error }`) seulement si un bug est constaté.

---

## 🔵 Backend — besoin DB/déploiement (pas faisable en pur front)
- **3 edge functions suspectes** : `analytics-export`, `db-cleanup`, `get-mapbox-token` → vérifier + dé-déployer (attention cap 402).
- **Tables candidates mortes** (`analytics_daily_rollup`, `attribution_touchpoints`, `feedback_issues`, `customer_incidents`, `event_notes`, `email_campaign_events`…) → `SELECT COUNT(*)` + check cron **obligatoire** avant tout `DROP`.
- **`DEFERRED_drop_event_banner.sql`** → promouvoir en migration une fois le cap 402 levé.
- **`usePaymentsEnabled`** query `app_settings.payments_disabled` (colonne signalée inexistante) → vérifier en DB.

---

## 🟣 Décisions produit (à toi)
1. **Merger** `audit/tech-debt-2026-06` → `main` (28+ commits propres, tsc 0, bugs corrigés). PR prête.
2. **Feature email `crm/`** (9 fichiers : `crm/*` + `OwnerEmailCampaign.tsx`) en pause → **supprimer** (dernier bloc mort) **ou reprendre**.

---

## Plan recommandé (ordre)

1. **Tout de suite (gratuit)** : merger la base saine + trancher `crm/` + purger les `console.log` (15 min).
2. **Investissement qui paie** : **(a)** couche data React Query (#1, ~1-2 j) → **(b)** god-pages restantes (~6-10h), par incréments QA.
3. **Si temps** : tokens couleur + adoption `formater`/`timezone`.
4. **Jamais** : chasser les 1596 `any`, les fire-and-forget, l'`exhaustive-deps` en masse.

---

## Verdict

Le front est **sain sur les axes à forte valeur** (tsc 0, code mort purgé, déps propres, bugs à enjeu corrigés). Il ne « manque » rien de cassé.

Ce qui reste de **vraiment utile** = le **refactor structurel** (couche data + god-pages) : ~2-3 jours CC pour une base qui ne te ralentit plus en post-lancement. C'est le bon endroit où « boil the lake ». Le reste est cosmétique, intentionnel, ou ta décision produit.
