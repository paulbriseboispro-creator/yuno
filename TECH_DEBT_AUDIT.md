# Audit de dette technique — Yuno

**Date** : 2026-06-17 · **Rôle** : Staff Engineer / Software Architect / Technical Auditor
**Périmètre** : intégralité du codebase `yuno-bar-buddy` (frontend `src`, backend `supabase`, dépendances, architecture).
**Note** : ce document est un **rapport d'analyse en lecture seule**. Aucune modification de code applicatif n'a été faite pour le produire. Les suppressions et refactors décrits en §5 sont des étapes ultérieures à valider une par une.

---

## Context

Yuno est une app SaaS multi-tenant nightlife (billets + tables VIP + boissons + guestlists + promoteurs/affiliés, dashboards owner/organisateur/admin). Le produit a traversé une migration Lovable → Supabase et de multiples refontes (onboarding owner, système promoteur owner-scoped vs ancien affiliate, refonte boissons, éditeur email unifié, super admin…). Chaque itération a laissé des sédiments : code mort, scripts SQL one-off, doublons, et de la dette structurelle accumulée.

Objectif : cartographier **tout ce qui ralentit le dev, augmente le risque de bug, ou n'a plus de raison d'exister**, et produire un plan de nettoyage phasé avant le lancement.

### Échelle mesurée (faits)

| Métrique | Valeur |
|---|---|
| Lignes de code (`src`, ts/tsx) | **~210 600** |
| Fichiers ts/tsx (`src`) | 672 |
| Composants | 408 (dont **101 en vrac à la racine** `components/`, 52 shadcn `ui/`) |
| Pages | 166 |
| Hooks | 54 |
| Contexts | 7 · Stores zustand | 1 |
| Edge functions Supabase | **94** |
| Migrations SQL | **403** |
| Plus gros fichier de logique | `OwnerTicketing.tsx` = **3 151 lignes** |

### Méthodologie & fiabilité

3 agents d'exploration (frontend / backend-DB / architecture) + **passe de vérification manuelle** (grep ciblés) pour valider chaque affirmation actionnable. Résultat clé : la liste de code mort de l'agent était **précise à ~97 %** (34/36 candidats confirmés à 0 référence) **mais** a produit 1 faux positif critique — `RoleIntroGate` (5 références, BIEN utilisé, c'est une feature neuve non encore committée). **Leçon appliquée au plan : aucune suppression en masse ; chaque fichier est re-vérifié par grep juste avant suppression.** Deux chiffres de l'agent étaient gonflés et ont été corrigés (`toLocaleString` : 89 réels vs 934 annoncés ; couleurs hex inline : **1 839** réelles, pire qu'annoncé).

⚠️ Le code mort listé ici est un **échantillon à fort signal** (noms suspects + zones de pivots), pas un balayage exhaustif. Le total réel est probablement supérieur. → Recommandation outillée en §5.

---

## 1. Cartographie de la dette technique

| Zone | Type de dette | Gravité | Effort | Risque suppression |
|---|---|---|---|---|
| `components/*` (≈41 fichiers morts) | Code mort post-pivots | 🟠 Moyen | Faible | 🟢 Faible (vérifié) |
| Pages orphelines (AcceptOrgMember, PromoterPublicRedirect) | Code mort | 🟡 Bas | Très faible | 🟢 Faible |
| `supabase/*.sql` racine + `migration-kit/` | Scripts one-off périmés | 🟡 Bas | Très faible | 🟢 Faible |
| `html5-qrcode` (dép.) + `ui/use-toast.ts` (doublon) | Dépendance/fichier inutiles | 🟡 Bas | Très faible | 🟢 Faible |
| God-pages (≈20 fichiers > 1000 LOC) | Modules surdimensionnés | 🔴 Élevé | Élevé | 🟠 Modéré |
| **Absence de couche data** (793 appels Supabase dispersés) | Couplage / violation d'architecture | 🔴 Élevé | Très élevé | 🔴 Critique |
| React Query installé mais court-circuité (33 appels/5 fichiers) | Incohérence d'état | 🔴 Élevé | Élevé | 🟠 Modéré |
| 1 839 couleurs hex inline | Tokens design non centralisés | 🟠 Moyen | Moyen | 🟢 Faible |
| `formater.ts` / `timezone.ts` sous-utilisés | Duplication de logique | 🟡 Bas | Faible | 🟢 Faible |
| Checks de rôle/auth dispersés (route + inline + hooks + contexts) | Responsabilité mal séparée | 🟠 Moyen | Élevé | 🟠 Modéré |
| 403 migrations (dump Lovable + reconciliation) | Dette d'historique | 🟡 Bas | Moyen | 🔴 Critique |
| Tables candidates inutilisées (8-9) | Schéma mort (à confirmer DB) | 🟡 Bas | Faible | 🔴 Critique |
| `analytics-export`, `db-cleanup`, `get-mapbox-token` (edge fn) | Fonctions suspectes | 🟡 Bas | Faible | 🟠 Modéré |

### Points sains (à créditer — ce n'est PAS un projet pourri)

- **`utils/fees.ts`** : calcul revenu/frais Stripe **bien centralisé** et utilisé de façon cohérente. Référence à suivre.
- **Très peu de marqueurs de dette** : 1 seul `TODO`, **0** `FIXME`, **0** `HACK`, 3 `XXX`, ~11 mentions « legacy ». Signe d'une base non jonchée de rustines.
- **Conventions homogènes** : hooks en `useX`, composants en PascalCase, organisation par feature (`owner/`, `organizer-app/`, `affiliate-app/`, `promoter/`, `admin/`).
- **TypeScript partout** + types Supabase générés.
- **Intégrité serveur solide** (triggers/RPC VIP atomiques, guards capacité).
- Migrations en évolution **contrôlée** (~12-15/semaine post-reconciliation), pas de churn sauvage.
- Libs majeures mono-source et bien utilisées : `framer-motion` (213 imports), `recharts` (22).
- Seulement 17 fichiers avec `console.log` résiduel.

---

## 2. Inventaire du legacy (vestiges d'anciennes versions de Yuno)

| Élément | Origine | Encore utile ? | Action |
|---|---|---|---|
| `migration-kit/10_FIX_EMAIL_NEWSLETTER_CRON_COMPAT.sql` (35 Ko) + `11_MODE_EMPLOI…md` | Correctif cron email one-off | Non (exécuté) | 📦 Archiver |
| `migration-kit/12_DIAGNOSTIC_OWNER_PROMOTER_SYNC.sql` | Diagnostic ponctuel | Non | 📦 Archiver |
| `migration-kit/13_FIX_OWNER_ORGANIZER_LINKS.sql` | Correctif liens one-off | Non | 📦 Archiver |
| `supabase/madrid_to_affiliate_migration.sql` | Migration data Yuno Madrid → affiliate | Non (one-time) | 🗑️ Supprimer |
| `supabase/transfer_madrid_recurring_to_milo.sql` | Transfert 51 events récurrents → Milo | Non (one-time) | 🗑️ Supprimer |
| `supabase/make-collab-sales-yuno.sql` | Seed démo (transactions collab) | Non (démo périmée) | 🗑️ Supprimer |
| `supabase/make-invoices-yuno.sql` | Seed démo (factures) | Non | 🗑️ Supprimer |
| `supabase/make-recurring-yuno.sql` | Seed démo (récurrence) | Non | 🗑️ Supprimer |
| `supabase/seed-demo-womber.sql` + `-teardown.sql` + `SEED_DEMO_WOMBER.md` | Seed démo « Womber » pour appels de vente | **OUI** (réf. CLAUDE.md) | ✅ Conserver |
| `supabase/DEFERRED_drop_event_banner.sql` | Drop colonnes `image_url`/banner différé (bloqué par cap 402) | Oui (en attente) | ⏳ Conserver puis promouvoir en migration une fois le cap résolu |
| Dump initial `…remix_migration_from_pg_dump.sql` (~7000 lignes) + ~70 migrations de reconciliation | Migration Lovable → Supabase | Oui (rejouées) | ✅ Conserver (squash optionnel — §5 Phase 4) |
| `components/onboarding/RoleIntroGate.tsx` | Gate d'intro de rôle | **OUI (5 refs, feature neuve)** — l'agent l'avait classé mort à tort | ✅ Conserver |
| Edge fn famille invitation (8) + email (11) | Multi-tenant par rôle | Oui (légitime, pas de doublon) | ✅ Conserver |

**Note legacy schéma** : commentaires « venue-scoped legacy column » dans `organizer-app/OrgEventTablesPanel.tsx` et chemins « legacy » dans `Bouncer.tsx`/`Barman.tsx` (fallback QR `qr_code` ancien format). À nettoyer lors du refactor de ces pages (Phase 3/4), pas en suppression sèche.

---

## 3. Inventaire du code mort (vérifié — 0 référence d'import)

> **≈43 fichiers** confirmés par grep (référence d'import excluant le fichier lui-même = 0). Échantillon à fort signal, pas exhaustif.

**Composants morts (39)** — racine `components/` sauf indication :
`AgeVerificationDialog`, `AnimatedPrice`, `CGVCheckbox`, `ConfettiEffect`, `EventTicketCard`, `PushNotificationPrompt`, `RoleSwitch`, `StripeConnectSection`, `TableMapViewer`, `TicketVisualCard`, `VenueFooter`, `app-shell`, `app-breadcrumbs`, `latest-change`, `dashboard` ·
`analytics/AnalyticsGlobalEventToggle`, `analytics/PredictiveInsights` ·
`orders/BarSelector`, `orders/VenueGroupedOrders` ·
`crm/CampaignDialog` · `campaigns/SortableBlock` ·
`explore/ClubCarousel`, `explore/ClubSpotlight`, `explore/ExploreHeroCard`, `explore/MapOverlay` ·
`upsell/CreditPaymentSheet`, `upsell/TicketPackSelector`, `owner/upsell/OwnerUpsellPacks` ·
`barman/DrinkCounter` · `loyalty/PointsEarnedToast` ·
`vip-host/MinimumSpendAlert`, `vip-host/VipAlerts` ·
`organizer/OrgAnalytics`, `organizer-app/OrgAccessCodeManager`, `organizer-app/OrgEventShareModal` ·
`owner/PromoterRewardConfig` · `profile/ProfileSettings`, `profile/StatsSection`.

**Doublons morts (2)** :
- `components/dashboard-skeleton.tsx` (0 ref) — duplicate exact de `DashboardSkeleton.tsx` (actif, ~40 imports).
- `components/ui/use-toast.ts` (0 ref) — duplicate de `hooks/use-toast.ts` (39 imports, le vrai).

**Pages orphelines (2)** :
- `pages/AcceptOrgMember.tsx` — non importée nulle part (probablement remplacée par `AcceptPlatformInvitation`).
- `pages/PromoterPublicRedirect.tsx` — importée mais **aucune route** ; simple ré-export 8 lignes de `PromoterHub`.

**Dépendance inutilisée (1)** : `html5-qrcode` — **0 import** (génération via `qrcode`, scan via `@yudiel/react-qr-scanner`). Retirable de `package.json`.

**Edge functions suspectes (à valider)** :
- `analytics-export` — seul appelant = `PredictiveInsights` (mort) ; pas dans `config.toml`. → quasi-certainement mort.
- `db-cleanup` — pas dans `config.toml`, aucun point d'entrée. → à valider (cron manuel ?).
- `get-mapbox-token` — configurée mais jamais invoquée (token statique utilisé à la place). → à valider.

**À NE PAS supprimer (faux positifs / WIP)** :
- `RoleIntroGate.tsx` — utilisé (5 refs), feature neuve non committée.
- `pages/OwnerPartnerships.tsx` — fonctionnelle (250+ lignes) mais sans route → **décision produit** : feature dépriorisée à archiver, OU re-câbler. Ne pas supprimer sans validation.
- `pages/OwnerEmailCampaign.tsx` — commentée dans `App.tsx` (« feature in development »). Garder jusqu'à décision sur l'éditeur email.

---

## 4. Inventaire des duplications

| Duplication | Détail | Verdict |
|---|---|---|
| `dashboard-skeleton.tsx` vs `DashboardSkeleton.tsx` | Même export | 🗑️ Supprimer le lowercase |
| `ui/use-toast.ts` vs `hooks/use-toast.ts` | Même hook | 🗑️ Supprimer le `ui/` |
| **793 appels `supabase.from()/.rpc()` dispersés** | Mêmes requêtes (venues, events, profiles, orders) ré-implémentées page par page | 🔴 Couche data manquante (Phase 4) |
| **1 839 couleurs hex inline** | `#E8192C` & co. recopiés au lieu de tokens Tailwind/CSS vars | 🟠 Centraliser (Phase 2) |
| 89 `toLocaleString()` bruts | `formater.ts` existe (1 seul import) mais ignoré | 🟡 Harmoniser (Phase 2) |
| Formatage date/TZ inline (~50 endroits) | `lib/timezone.ts` existe mais court-circuité par `date-fns(-tz)` direct | 🟡 Harmoniser (Phase 2) |
| Checks rôle/auth | Route guards + checks inline + hooks + contexts qui se chevauchent (`OwnerVenueContext` vs `ManagerVenueContext`) | 🟠 Unifier (Phase 3) |
| **Faux doublons (NE PAS toucher)** : famille edge fn invitation (8) & email (11), `verify-*`/`create-*` checkout (3+3), maps (`mapbox-gl` interactif vs `react-simple-maps`+`world-atlas` choroplèthe), PDF (`jspdf` crée vs `pdf-lib` modifie) | Complexité métier légitime, pas de la duplication | ✅ Conserver |

---

## 5. Plan de nettoyage (phasé)

### Outillage recommandé d'abord (rend le nettoyage exhaustif et reproductible)
Avant la Phase 1, faire tourner (en lecture seule) un détecteur dédié pour obtenir la liste **complète** (pas juste l'échantillon) :
- **`npx knip`** — fichiers, exports et dépendances inutilisés (le meilleur pour ce stack Vite+TS).
- `npx depcheck` — dépendances `package.json` non importées.
- `npx ts-prune` — exports morts.
Croiser leur sortie avec la liste §3. Knip devient le filet de sécurité « 0 référence » avant chaque suppression.

### Phase 1 — Suppressions sûres (risque 🟢 faible · ~½ journée CC)
1. Supprimer les ~43 fichiers morts du §3 — **re-grep individuel avant chaque `rm`** (leçon RoleIntroGate).
2. Retirer `html5-qrcode` de `package.json` + lockfile.
3. Supprimer `migration-kit/` (4 fichiers) + les 5 scripts SQL one-off racine (`madrid_*`, `transfer_madrid_*`, `make-collab-sales`, `make-invoices`, `make-recurring`). Conserver `seed-demo-womber*` + `DEFERRED_*`.
4. Valider puis supprimer `analytics-export` (+ son composant mort déjà retiré en 1) ; vérifier `db-cleanup` / `get-mapbox-token` avant retrait.
5. Décision produit sur `OwnerPartnerships` / `OwnerEmailCampaign` (archiver ou re-câbler).
- **Vérif** : `npm run build` + `npm run lint` + `tsc` verts ; diff = suppressions uniquement ; smoke-test des flux clés (checkout, scan bouncer, dashboards) via `/browse`.

### Phase 2 — Refactors faible risque (🟢→🟡 · ~1-2 jours CC)
1. Centraliser les tokens couleur : extraire les hex récurrents vers `tailwind.config.ts` / CSS vars, remplacer progressivement les 1 839 inline (commencer par les pages dashboard).
2. Imposer `formater.ts` (devise/%) et `lib/timezone.ts` (dates) ; remplacer les `toLocaleString`/`date-fns` inline.
3. Purger les `console.log` résiduels (17 fichiers).
4. Auditer les 52 composants shadcn `ui/` via knip + leurs deps `@radix-ui` associées (retirer primitives + paquets non utilisés).

### Phase 3 — Refactor risque moyen (🟡→🟠 · ~3-5 jours CC)
1. **Démanteler les god-pages** une par une, par extraction de sous-composants + hooks (cible : page ≤ 500 LOC, composant ≤ 300 LOC). Ordre par ROI : `OwnerTicketing` (3151), `Bouncer` (1913), `MyOrders` (1876), `Barman` (1504), `Cart` (1182), `OwnerEvents` (1394). Chaque page = un PR isolé, re-QA après.
2. Unifier les checks rôle/auth : un système de permissions unique, fusionner `OwnerVenueContext`/`ManagerVenueContext` si chevauchement confirmé.
3. Nettoyer les chemins « legacy » fallback (`Bouncer`/`Barman` QR ancien format, colonne venue-scoped) au passage.

### Phase 4 — Refactor structurel (🟠→🔴 · planifier après lancement)
1. **Introduire une couche data** : `src/data/queries.ts` (+ hooks `useQuery`/`useMutation`) ; migrer les 793 appels Supabase dispersés vers React Query (déjà installé et configuré, juste court-circuité). Bénéfices : cache, dédup, invalidation, retry, testabilité. Migration incrémentale par domaine (venues → events → orders → analytics).
2. Réduire les 54 hooks à état manuel vers React Query (supprimer le boilerplate `useState` loading/error répété).
3. **Tables/colonnes mortes** (`analytics_daily_rollup`, `attribution_touchpoints`, `feedback_issues`, `customer_incidents`, `event_notes`, `email_campaign_events`, `chatbot_training`, `app_settings_public`) : 🔴 **vérification DB obligatoire** (`SELECT COUNT(*)` + check cron qui les peuple) avant tout `DROP`. Ne jamais dropper sur la seule absence de référence frontend.
4. (Optionnel) Squash du dump Lovable + reconciliation en une migration baseline pour accélérer les setups d'environnement neufs. Risque élevé sur prod — réserver aux nouveaux environnements.

---

## 6. Quick Wins (meilleur ratio impact / effort)

| # | Action | Effort | Impact |
|---|---|---|---|
| 1 | `npx knip` → liste exhaustive du mort | 10 min | 🔼🔼🔼 débloque tout le reste |
| 2 | Supprimer les ~43 fichiers morts vérifiés | ½ j | 🔼🔼 lisibilité (101 fichiers en vrac → moins) |
| 3 | Retirer `html5-qrcode` | 2 min | 🔼 bundle |
| 4 | Supprimer doublons `dashboard-skeleton` + `ui/use-toast` | 5 min | 🔼 clarté |
| 5 | Nettoyer `migration-kit/` + 5 SQL one-off | 15 min | 🔼 hygiène repo |
| 6 | Purger 17 `console.log` | 15 min | 🔼 propreté prod |
| 7 | Tokens couleur des pages dashboard | ½ j | 🔼🔼 cohérence visuelle |

---

## 7. Dette technique globale (score /10, 10 = sain)

| Dimension | Score | Justification courte |
|---|---|---|
| **Architecture** | **5** | Bonne ossature (feature-folders, naming), mais aucune couche data, React Query court-circuité, état éclaté sur 4 mécanismes. |
| **Maintenabilité** | **5** | God-pages (jusqu'à 3151 LOC) + 793 requêtes dispersées = un changement de schéma touche des dizaines de fichiers. Atténué par très peu de rustines. |
| **Lisibilité** | **6** | Conventions homogènes, dossiers clairs ; plombée par fichiers géants + 1 839 couleurs inline. |
| **Complexité** | **5** | Complexité accidentelle (54 hooks réinventent fetch/état) au-dessus d'une complexité métier réelle et justifiée. |
| **Scalabilité** | **5** | Modèle multi-tenant scalable ; mais pas de cache requêtes + requêtes dispersées = risque perf à la montée en données ; god-pages freinent l'équipe. |
| **Qualité globale du code** | **6** | Au niveau micro : typé, cohérent, peu de hacks, intégrité serveur solide. La dette est **structurelle et héritée des pivots**, pas du code sale ligne à ligne. |
| **GLOBAL** | **≈ 5,5 / 10** | Sain en surface, endetté en profondeur. |

---

## 8. Verdict final

**🟧 Le projet est globalement sain mais nécessite un nettoyage — avec une réserve structurelle nette.**

La **dette de surface** (≈43 fichiers morts, scripts SQL one-off, dépendance inutile, doublons) est faible, sûre, et nettoyable en une demi-journée : c'est typiquement « globalement sain, un coup de balai ». Le projet est **fonctionnel, en prod, riche, typé, avec de bons réflexes** (fees centralisés, intégrité serveur, très peu de rustines).

**Mais** la **dette structurelle** — god-pages jusqu'à 3 151 lignes, 793 appels Supabase sans couche data, React Query installé puis ignoré, état éclaté sur 4 mécanismes, 1 839 couleurs inline — est, elle, au niveau « **dette technique importante** ». Elle ne **bloque pas** le lancement. Elle **taxera** chaque feature post-lancement : modifier une god-page ou un changement de schéma reste lent et risqué.

**Recommandation directe** : lance après les Phases 1-2 (sûres, rapides, vrai gain de lisibilité). **N'empile pas de nouvelles features lourdes sur les god-pages + l'absence de couche data sans planifier les Phases 3-4** juste après le lancement. Tu n'as pas besoin d'un désendettement sérieux *avant* d'avancer — tu as besoin de ne pas creuser le trou structurel pendant que tu accélères.

---

## Annexe — Reproductibilité & prochaines étapes

Chaque chiffre clé est reproductible depuis `yuno-bar-buddy/` :

```bash
# Fichier mort (exemple) : 0 = mort
grep -rIl "from .*/AnimatedPrice" src | grep -v "/AnimatedPrice.tsx" | wc -l

# React Query court-circuité : 33 vs 793
grep -rIE "useQuery\(|useMutation\(|useInfiniteQuery\(" src --include='*.ts' --include='*.tsx' | wc -l
grep -rIE "supabase\.from\(|\.rpc\(" src --include='*.ts' --include='*.tsx' | wc -l

# html5-qrcode inutilisé : 0
grep -rI "html5-qrcode" src | wc -l

# Couleurs hex inline : 1839
grep -rIoE "#[0-9A-Fa-f]{6}" src --include='*.tsx' | wc -l

# Plus gros fichiers de logique
find src -type f \( -name '*.ts' -o -name '*.tsx' \) -exec wc -l {} + | sort -rn | head -20
```

**Prochaine étape** : exécuter `npx knip` pour la liste exhaustive du code mort, puis lancer la Phase 1 (suppressions sûres) par commits atomiques, avec re-grep avant chaque suppression et build/lint/tsc verts en sortie.
