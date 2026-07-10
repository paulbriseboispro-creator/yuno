# Yuno — Stratégie IA

Dernière revue : 2026-07-10. Source de vérité de la doctrine IA du produit.
Audit réalisé sur l'ensemble du repo (frontend, 106 edge functions, 388+ migrations, 192 tables).

---

## 1. Résumé exécutif

Yuno se présente comme un produit technologique, mais **l'IA n'y vit aujourd'hui qu'à trois
endroits** : l'assistant client (`/assistant`), le copilote owner (« Yuno Pro ») et une fonction
de traduction — cette dernière étant cassée en prod jusqu'au fix de juillet 2026. Tout ce qui
porte un nom « intelligent » ailleurs (Hype Forecast, segmentation RFM, recommandations,
push automatiques) est de l'heuristique déterministe, sans apprentissage.

Le paradoxe : **le modèle de données de Yuno est exceptionnellement prêt pour l'IA** —
clickstream complet, présence physique scannée à la porte, cycle de vie des commandes
horodaté à la seconde, consommation VIP item-level, attribution multi-touch, RFM déjà
calculée. Peu de SaaS nightlife ont cette granularité. Ce qui manque, c'est le volume
(pré-lancement) et la couche d'exploitation.

La stratégie : **des quick wins LLM zero-shot maintenant** (aucun entraînement requis,
coût < 5 $/mois à 1 000 utilisateurs actifs), **la fondation embeddings/pgvector tout de
suite** (réutilisable partout), et **le ML supervisé seulement quand le volume existera**.

Trois quick wins retenus (détail §4) :

| # | Quick win | Persona | Douleur adressée |
|---|-----------|---------|------------------|
| QW1 | Génération IA de campagnes marketing trilingues (push/email/SMS) | Owner / Orga | Rédaction manuelle ×3 langues, chaque campagne |
| QW2 | Night Report narratif (« 5 enseignements + 3 actions ») | Owner | Des chiffres post-soirée sans interprétation |
| QW3 | Rail « Pour toi » dans Explore (embeddings pgvector) | Client B2C | Découverte non personnalisée, Taste Quiz abandonné |

---

## 2. État des lieux

### 2.1 Les trois usages LLM réels

| Usage | Fichier | Modèle | Architecture | Limites |
|---|---|---|---|---|
| Assistant client | `supabase/functions/yuno-assistant/index.ts` | gpt-4o-mini | RAG « prompt-stuffing » : 10 requêtes Supabase parallèles injectées dans le system prompt, streaming SSE | Aucun tool, lecture seule, knowledge base figée dans le code |
| Copilote owner | `supabase/functions/owner-assistant/index.ts` | gpt-4o-mini | Agentique : 26 tools (18 lecture, 7 écriture avec confirmation), boucle 3 tours max, audit log `owner_ai_audit_log` | Recherche d'aide par mots-clés (pas d'embeddings), pas proactif |
| Traduction | `supabase/functions/translate-text/index.ts` | gpt-4o-mini (depuis le fix 2026-07-10) | Traduction de descriptions d'events (EventDetails) | Était cassée en prod : slug Gemini posté sur l'endpoint OpenAI, erreur avalée en silence |

Toute l'IA passe par une seule clé `OPENAI_API_KEY` (secret Supabase). Aucune autre
dépendance IA — ni côté front (`package.json` : zéro lib ML), ni côté back.

### 2.2 L'intelligence déterministe existante (à ne pas confondre avec de l'IA)

- **`src/lib/hypeForecast.ts`** — prévision de remplissage : courbe S empirical-Bayes
  (shrinkage vers un prior par `sales_timing`), Demand Pressure Index (trafic, funnel,
  engagement, favoris, accélération), probabilité de sold-out logistique. Interfaces
  propres (`DemandSignals`, `HistoricalEvent`) : c'est le candidat n° 1 à une bascule ML
  quand l'historique existera.
- **`src/lib/hypePostEvent.ts`** — Night Report chiffré : no-show, heure de pointe réelle,
  attach rate bar, new vs returning, score de nuit 0-10. 40+ métriques, zéro narration.
- **RFM SQL** — deux systèmes : venue (`get_venue_customer_segments` + seuils côté client)
  et plateforme (`admin_segmentation_*` : RFM 5×5, 7 segments, tiers). Déterministe.
- **`send-next-event-recommendation`** — reco par règles : +3 même venue, +2 même genre.
- **Push automations** (`_shared/push-automations.ts`) — 4 déclencheurs à fenêtres fixes
  (rappel jour J, live, merci, presque complet ≥ 85 %), textes statiques trilingues.

Ces heuristiques sont saines et doivent **rester le socle** : l'IA les complète (narration,
contenu, personnalisation), elle ne les remplace pas tant qu'il n'y a pas de volume pour
prouver qu'un modèle appris fait mieux.

### 2.3 Actifs data exploitables

Le gisement, par ordre de valeur IA :

1. **Comportemental (★★★★★)** — `visitor_sessions` (UTM, funnel booléen, scroll,
   durée, `visitor_id` persistant), `visitor_events` (clickstream brut),
   `live_visitor_pings` (présence temps réel), `attribution_touchpoints` (multi-touch),
   `cart_snapshots` (abandon), `customer_activity_log` (event-stream unifié),
   `tracked_link_clicks`, `push_campaign_events`, `email_campaign_events`.
2. **Transactionnel (★★★★★ structurellement)** — `orders` (cycle queue→preparing→
   ready→served horodaté), `tickets` (`entry_scanned_at` = présence physique réelle,
   donc no-show mesurable), `table_reservations` (check-in→finished = durée d'occupation),
   `vip_consumptions` (item-level, horodaté, staff, table).
3. **Segmentation (★★★★)** — RFM déjà calculée (feature engineering quasi fait),
   `client_scores`, `venue_customers`.
4. **Événementiel (★★★★)** — `events` (genres multi-valués, géo, capacité),
   `ticket_rounds` (courbes de vente par palier), `venue_hype_baseline` (prior cold-start).
5. **Marketplace (★★★★)** — `djs` (géoloc + genres + audience), chaînes de conversion
   promoteur/affilié/agence attribuées et monétisées.
6. **Démographique (★★★)** — âge/genre/ville épars (déclaratif) ; les RPC
   (`event_audience_demographics`) gèrent honnêtement la couverture. Reporting agrégé
   oui, ML démographique fin non.

### 2.4 Angles morts

- **Pas d'identité client canonique cross-venue** : résolution ad hoc `user_id` → email
  dans chaque RPC ; les achats invités fragmentent l'identité. Préalable (avec le
  consentement RGPD) à tout profil 360° et cross-sell inter-clubs.
- **Pas de feedback qualitatif** : aucun NPS, rating ou avis → pas de corpus de
  satisfaction, pas de boucle de vérité terrain pour les recommandations.
- **Pas de COGS/marge** sur les items → l'optimisation possible porte sur le CA, pas la marge.
- **Pas de consentement « AI profiling »** : opt-ins marketing existants mais aucun flag
  dédié personnalisation/profilage. QW3 introduit le premier opt-out.
- **Pas de feature store historisé** : les RPC recalculent à chaud ; aucun snapshot daté
  (RFM du jour J, forecast vs réalisé) pour entraîner ou évaluer des modèles a posteriori.
- **Volume pré-lancement quasi nul** : le schéma est prêt, les tables sont vides.

---

## 3. Principes d'architecture IA (doctrine)

1. **Cap 402 → « fonction pliée »**. Le cap edge functions Supabase est atteint : déployer
   une nouvelle fonction renvoie 402. Toute capacité IA backend vit donc **dans une
   fonction existante** (discriminant `action` dans le body, ou module `_shared/` appelé
   par un cron existant). Pattern éprouvé : le dispatcher push auto plié dans
   `process-scheduled-campaigns`.
2. **Pré-lancement → zero-shot uniquement**. LLM + embeddings + heuristiques calibrées.
   Aucun ML supervisé, aucun fine-tuning avant d'avoir au moins une saison de données
   réelles (critères de passage en §7).
3. **OpenAI only, une constante de modèle par usage**. `OPENAI_MODEL` (chat),
   `CONTENT_MODEL` (génération), `REPORT_MODEL` (analyse), `EMBEDDING_MODEL`. Changer de
   modèle = changer une constante. Pas de multi-provider tant que le volume ne le justifie pas.
4. **Structured Outputs partout**. Toute génération destinée à l'UI passe par
   `response_format: json_schema` — jamais de parsing de texte libre.
5. **Trilingue by design**. Le contenu généré sort en EN/FR/ES (QW1) ou dans la langue
   demandée avec cache par langue (QW2). Toute clé UI dans `src/i18n/locales/{en,fr,es}.ts`.
6. **L'IA propose, l'humain dispose**. Aucune écriture métier directe par un LLM sans
   confirmation explicite (règle déjà en place dans owner-assistant, `WRITE_TOOLS`).
   Le contenu généré atterrit dans les formulaires existants, l'owner reste l'éditeur final.
7. **Audit systématique**. Toute génération loggée dans `owner_ai_audit_log`.
8. **Anti-injection** : le contexte injecté dans les prompts est requêté côté serveur
   (service-role, scopé `venue_id`) — jamais fourni par le client.
9. **Coûts plafonnés** : `max_tokens` borné partout, cache quand le résultat est
   redemandable (QW2), batch quand c'est du volume (QW3).
10. **Sync connaissance obligatoire** (règle CLAUDE.md) : chaque feature visible met à
    jour `CLIENT_KNOWLEDGE_BASE`, `HELP_ARTICLES`, `ohelp.*` ×3 langues et
    `ownerHelpContent.ts` dans le même chantier.

---

## 4. Quick wins (en cours d'implémentation)

### QW1 — Génération IA de contenu marketing trilingue

La douleur la plus concentrée du produit : l'owner rédige chaque push, email et SMS à la
main, dans 3 langues, à partir de 7 templates figés.

- **Backend** : action `generate_marketing_content` pliée dans `owner-assistant`
  (auth + venue déjà résolus). Contexte serveur : event, prix du round actif, taille du
  segment, remplissage. Sortie structurée : 3 variantes × 3 langues, contraintes par
  canal (push ≤ 40/120 car., SMS ≤ 160, email subject ≤ 60 + preheader ≤ 90).
- **Frontend** : `AIContentGenerator.tsx` (bouton « Générer avec l'IA ») branché sur
  OwnerPush, CampaignBuilder et OwnerSmsCampaigns — le résultat remplit les formulaires
  existants.
- **Modèle** : `CONTENT_MODEL = gpt-5-mini` (reasoning minimal). Coût ≈ 1,50 $/mois
  à 1 000 users actifs.

### QW2 — Night Report narratif IA

`hypePostEvent` produit 40+ métriques ; personne ne les interprète pour l'owner.

- **Flux** : le front envoie les stats déjà calculées (`computeNightStats`) à
  `owner-assistant`, action `generate_night_report`. Pas de recalcul serveur.
- **Cache** : table `event_ai_reports` (unique par event × langue, invalidation par
  `stats_hash`) → un rapport regénéré seulement si les chiffres changent.
- **Sortie** : headline + 5 enseignements (avec métrique et sentiment) + 3 actions.
  Consigne d'honnêteté : si les données sont maigres, le dire au lieu d'inventer.
- **Modèle** : `REPORT_MODEL = gpt-5-mini` (reasoning medium). Coût ≈ 2-3 $/mois.

### QW3 — « Pour toi » dans Explore (fondation pgvector)

Le B2C visible + la fondation vectorielle réutilisable ensuite (DJ matching, recherche
sémantique, upsell Live Mode).

- **Migration** : `CREATE EXTENSION vector`, table `event_embeddings`
  (`vector(1536)`, HNSW cosine, RLS deny-all), RPC `get_for_you_events` SECURITY DEFINER
  (vecteur de goût = moyenne des embeddings des events achetés/favoris/venues suivies,
  fenêtre 12 mois), colonne `profiles.personalization_opt_out`.
- **Génération** : module `_shared/event-embeddings.ts` appelé best-effort par le cron
  5 min existant de `process-scheduled-campaigns` (batch 50, invalidation par
  `content_hash`). `EMBEDDING_MODEL = text-embedding-3-small`. Coût < 0,10 $/mois.
- **Frontend** : rail « Pour toi » dans Explore (affiché si connecté et ≥ 3 résultats —
  cold-start propre), toggle opt-out dans le profil.

---

## 5. Portefeuille d'opportunités moyen / long terme

Impact et effort sur 3 étoiles. « Dép. » = dépendances.

| Opportunité | Impact | Effort | Dép. | Notes |
|---|---|---|---|---|
| **Next-best-action owner** — le copilote devient proactif : « ton event J-7 est à 12 % → 3 actions », carte dashboard quotidienne | ★★★ | ★★ | QW1 + QW2 | Réutilise génération de contenu + narration ; c'est le chaînon qui transforme les quick wins en « conseiller » |
| **Weekly digest owner narratif** | ★★ | ★ | QW2 | Replier le Night Report dans un email hebdo (fonction `weekly-digest` existante) |
| **Envoi campagnes multi-langue par destinataire** | ★★ | ★ | QW1 | `push_campaigns`/`sms_campaigns` sont mono-langue ; les automations localisent déjà par `preferred_language` — généraliser (`title_i18n`/`body_i18n`) |
| **DJ matching sémantique** | ★★ | ★ | QW3 | Embeddings profils DJs × events (géo + genre + audience) ; marketplace peu peuplée en pré-lancement, timing à surveiller |
| **Recherche sémantique Explore** | ★★ | ★ | QW3 | Query → embedding → events ; remplace les filtres bruts pour la longue traîne |
| **Upsell Live Mode contextuel** | ★★ | ★★ | QW3 + volume `vip_consumptions` | Reco boissons in-venue temps réel ; aujourd'hui LAST_CALL et upsell sont statiques |
| **Concierge client transactionnel** | ★★★ | ★★★ | Garde-fous paiement + consentement | Tools pour yuno-assistant (chercher, mettre en favori, deep-link checkout) ; JAMAIS d'exécution d'achat par le LLM |
| **Pricing copilot** (rounds + seuils scarcity suggérés) | ★★★ | ★★★ | ≥ 1 saison d'historique + COGS | Le plus demandé et le plus risqué : sans historique, un LLM qui conseille des prix hallucine. Ne pas lancer avant les critères §7 |
| **Détection d'anomalies ops** (no-show anormal, chute d'attach rate, fraude scan) | ★★ | ★★ | Historisation | Statistique simple d'abord (z-scores sur snapshots), ML ensuite |
| **Forecast ML** (remplacer les magic numbers de hypeForecast) | ★★ | ★★ | Historisation forecast vs réalisé | L'interface `DemandSignals` est prête ; il faut d'abord logger les prédictions pour les évaluer |
| **ENABLER : feature store / historisation** | ★★★ | ★★ | — | Snapshots quotidiens (RFM daté, forecast vs réalisé, agrégats venue/user). Sans ça, aucun ML évaluable |
| **ENABLER : identité client canonique cross-venue** | ★★★ | ★★★ | Consentement RGPD | Table « person » unifiée ; préalable au profil 360° et au cross-sell inter-clubs |
| **ENABLER : consentement « AI profiling » RGPD** | obligatoire | ★ | — | Avant tout profilage cross-venue. L'opt-out QW3 est le premier pas ; le consentement explicite viendra avec l'identité canonique |

---

## 6. Modèles & coûts

| Usage | Modèle | Prix (in/out par M tokens) | Coût mensuel estimé @1 000 MAU | @10 000 MAU |
|---|---|---|---|---|
| Génération contenu (QW1) | gpt-5-mini, reasoning minimal | 0,25 $ / 2 $ | ≈ 1,50 $ | ≈ 15 $ |
| Night Report (QW2) | gpt-5-mini, reasoning medium | 0,25 $ / 2 $ | ≈ 2-3 $ | ≈ 20-30 $ |
| Embeddings events (QW3) | text-embedding-3-small | 0,02 $ | < 0,10 $ | < 1 $ |
| Traduction (existant) | gpt-4o-mini | 0,15 $ / 0,60 $ | négligeable | faible |
| Assistants chat (existant) | gpt-4o-mini | 0,15 $ / 0,60 $ | poste dominant actuel | à mesurer |

**Total quick wins : < 5 $/mois à 1 000 users actifs.** Le poste dominant reste les deux
assistants existants — leur migration éventuelle vers gpt-5-mini s'évaluera après mesure
de latence réelle (le prompt-stuffing du yuno-assistant est volumineux en entrée).

Décisions : rester mono-provider OpenAI (simplicité fondateur solo), une constante par
usage pour pouvoir changer de modèle en un commit, caps `max_tokens` systématiques.

---

## 7. Roadmap

**Maintenant (ce chantier)** — P0 fix translate-text · QW1 contenu marketing · QW2 Night
Report · QW3 For You + fondation pgvector · sync des knowledge bases.

**Ensuite (dès que les quick wins tournent)** — Next-best-action owner · weekly digest
narratif · envoi multi-langue par destinataire · recherche sémantique Explore ·
DJ matching (si la marketplace se peuple).

**Plus tard (gated par les critères ci-dessous)** — Pricing copilot · concierge
transactionnel · détection d'anomalies · forecast ML · identité canonique + consentement
AI profiling · feature store.

**Critères de passage au ML supervisé** (tous requis) :
1. ≥ 1 saison complète de données réelles (6 mois d'events payants multi-venues) ;
2. Historisation en place (snapshots datés, prédictions loggées vs réalisé) ;
3. Un baseline heuristique mesuré à battre (le forecast actuel, la reco par règles) ;
4. Le consentement RGPD adéquat pour les données utilisées.

---

## 8. Registre des risques

| Risque | Mitigation |
|---|---|
| Hallucinations (chiffres inventés dans les rapports, prix faux dans les campagnes) | Contexte 100 % requêté serveur ; Structured Outputs ; consigne d'honnêteté sur données maigres ; l'owner valide tout avant envoi |
| Injection de prompt via contenu user (titres d'events, instructions libres) | Le contexte data est serveur-side ; l'instruction libre de l'owner est bornée et n'ouvre aucun tool d'écriture |
| RGPD / profilage | Opt-out personnalisation dès QW3 ; pas de profilage cross-venue avant consentement explicite ; agrégats sans PII dans les prompts |
| Coûts runaway | `max_tokens` partout, cache QW2, batch QW3, génération à la demande (pas d'auto-génération), audit log pour monitorer le volume |
| Dépendance OpenAI (panne, dépréciation de modèle) | Constantes de modèle centralisées ; dégradation gracieuse (les features IA sont additives, jamais bloquantes pour un flux métier) |
| Cap 402 edge functions | Doctrine « fonction pliée » (§3.1) — aucune nouvelle fonction requise par ce plan |
| Qualité perçue en pré-lancement (reco vides, rapports maigres) | Seuils d'affichage (For You masqué < 3 résultats), consignes d'honnêteté, les heuristiques existantes restent le fallback |
