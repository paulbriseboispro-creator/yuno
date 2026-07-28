# Phase B — migrations en attente de ship (la couche argent)

Migrations SQL de la Phase B (LTV, entonnoir, attribution push→vente, câblage DJ),
**codées + committées** sur `feat/analytics-pillar-first` mais **PAS POUSSÉES** (même
discipline que Phase A : tout au ship/merge). Dossier hors `supabase/migrations/` →
`supabase db push` l'ignore. Peut shipper indépendamment de la Phase A, mais si les deux
partent ensemble, fusionner les deux listes de migrations et re-timestamper l'ensemble
dans l'ordre.

## Migrations

| Fichier (staging) | Objet | Item | Régression front live si poussé seul ? |
|---|---|---|---|
| `…111000_audience_segments_repeat_buyers.sql` | `get_audience_segments` + `repeat_buyers` (5e étape entonnoir, venue) | B1 | Non (champ additif ; le front dégrade en 4 étapes sans lui) |
| `…111100_audience_push_attribution.sql` | nouveau RPC `get_audience_push_attribution` (revenu net attribué clic→achat 72h, venue) | B3 | Non (nouveau RPC ; le front dégrade sans revenu attribué) |
| _(à venir)_ | DROP `dj_audience_analytics` | B4 | ⚠️ seulement APRÈS déploiement du front DJAnalytics migré |

## Procédure de ship

1. Re-timestamper APRÈS le dernier remote (`supabase migration list --linked`), ordre croissant.
2. `ls supabase/migrations | sed -E 's/_.*//' | sort | uniq -d` doit être vide (pas de collision).
3. `mv` dans `supabase/migrations/`, supprimer ce dossier de staging.
4. `supabase migration list --linked` → seules mes migrations en « local sans remote ».
5. `supabase db push`.
6. `supabase gen types typescript --linked > src/integrations/supabase/types.ts` (rediriger stderr) :
   les nouveaux champs (`repeat_buyers`) et le drop de `dj_audience_analytics` retirent les casts `as any`.
7. Merge + `wrangler deploy` du front.

## Notes
- Les nouveaux champs RPC ne sont pas dans types.ts → appels castés (useAudienceData caste déjà tout).
- B4 (drop `dj_audience_analytics`) : ne DROP qu'après que le front DJAnalytics migré soit live,
  sinon l'ancien front casse (RPC introuvable).
