# Phase C — migrations en attente de ship (le moat)

Migrations SQL de la Phase C (chevauchement co-organisateurs, benchmarks ville, capture
de source, cohortes, récap hebdo), **codées + committées** mais **PAS POUSSÉES** (même
discipline qu'A/B : tout au ship/merge). Dossier hors `supabase/migrations/` → `db push`
l'ignore. Peut shipper indépendamment d'A/B ; si tout part ensemble, fusionner les listes
et re-timestamper dans l'ordre.

## Migrations

| Fichier (staging) | Objet | Item | Régression front live si poussé seul ? |
|---|---|---|---|
| `…111300_audience_benchmarks.sql` | RPC `get_audience_benchmarks` (percentiles médiane-ville, venue) | C2 | Non (nouveau RPC ; front dégrade sans benchmark) |
| `…111400_collab_audience_overlap.sql` | RPC `get_collab_audience_overlap` (Jaccard co-organisateurs, gardé is_event_collab_participant) | C1 | Non (nouveau RPC ; carte masquée sans lui) |
| `…111500_audience_cohorts.sql` | RPC `get_audience_cohorts` (rétention hebdo depuis ledger_start) | C4 | Non (nouveau RPC ; carte masquée sans lui) |
| `…111600_audience_follow_source.sql` | triggers follow lisant `yuno.follow_source` + RPC `follow_subject`/`follow_organizer` + reporting `get_audience_sources` | C3 | ⚠️ voir note C3 |
| `…111700_audience_weekly_recap.sql` | `audience_weekly_recap_data` (service_role) + table dedup `audience_recap_log` + seed clé AUTO_PUSH | C5 | Non (nouveau flux) |

### Edge à déployer (C5) — cap 402 OK (fonction existante)
- `supabase functions deploy process-scheduled-campaigns` — tire le nouveau dispatcher
  `_shared/audience-weekly-recap.ts` (récap hebdo owner, audience 'pro') + la clé AUTO_PUSH
  `audience_weekly_recap` d'`auto-push.ts`. Auto-gate lundi 9h–12h UTC + dedup semaine, envoi
  via `sendAutoPush` (platforms ios_pro). Sans ce deploy, le récap ne part pas.

## Procédure de ship

1. Re-timestamper APRÈS le dernier remote (`supabase migration list --linked`), ordre croissant.
2. `ls supabase/migrations | sed -E 's/_.*//' | sort | uniq -d` doit être vide.
3. `mv` dans `supabase/migrations/`, supprimer ce dossier de staging.
4. `supabase migration list --linked` → seules mes migrations en « local sans remote ».
5. `supabase db push`.
6. `supabase gen types typescript --linked > src/integrations/supabase/types.ts` (stderr redirigé) → retire les casts `as any`.
7. **DoD IA** : `supabase functions deploy owner-assistant` si HELP_ARTICLES changé. C5 ajoute une
   edge/cron : voir ses notes propres.
8. Merge + `wrangler deploy` du front.

## Notes
- Nouveaux RPC pas dans types.ts → appels castés (useAudienceData caste déjà tout).
- C1 overlap : garde `is_event_collab_participant(event_id, auth.uid())` + `audience_members(A)∩(B)`.
  Surface sur le dashboard de collab-event (pas l'AudienceDashboard). Percentiles/comptes only.
- C3 source : `set_config('yuno.follow_source',…,true)` est transaction-locale → passe par les RPC
  `follow_subject` (club/dj) / `follow_organizer` (SECURITY INVOKER → RLS préservée). Les triggers
  de follow lisent le GUC (fallback 'trigger'), le garde `skip_follow_ledger` est intact.
  ⚠️ **Ordre de ship C3** : la migration peut partir AVANT le front (backward-compatible — les
  triggers gardent 'trigger' sans GUC ; le front actuel continue en insert direct). Mais le front
  qui APPELLE `follow_subject`/`follow_organizer` ne doit être live qu'APRÈS le push de la migration
  (sinon RPC introuvable → un follow échoue). En pratique : push migration puis merge front.
  **Surfaces instrumentées** : `dj_page`, `organizer_page`, `event_page`. Les autres (page club
  VenuePage, cartes Explore, post-achat OrderConfirmation, affiliés) partent en 'trigger' → il
  suffit d'ajouter `source="…"` au `&lt;FavoriteButton&gt;` ou 3e arg à `toggleFavorite`, et de router
  les inserts directs `organizer_profile_followers` restants vers `follow_organizer`. Incrémental.
