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
| _(à venir)_ | `follow_subject` RPC + triggers ledger lisant `yuno.follow_source` + reporting | C3 | Voir notes C3 (routage des surfaces) |
| _(à venir)_ | RPC cohortes de rétention | C4 | Non (nouveau RPC) |
| _(à venir)_ | file récap hebdo + clé AUTO_PUSH `pro` + cron | C5 | Non (nouveau flux) |

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
- C3 source : `set_config('yuno.follow_source',…,true)` est transaction-locale → passe par une RPC
  `follow_subject` (set GUC + insert même transaction). Router `toggleFavorite` + les 3 sites
  d'insert `organizer_profile_followers` dessus.
