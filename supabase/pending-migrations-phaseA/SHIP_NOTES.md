# Phase A — migrations + deploys en attente de ship

Ces 4 migrations et 2 deploys edge sont **codés et committés sur `feat/analytics-pillar-first`**
mais **PAS ENCORE POUSSÉS EN PROD** (décision : tout partir au ship/merge, front + backend
ensemble). Ce dossier n'est **pas** `supabase/migrations/` → `supabase db push` l'ignore, donc
aucune autre session ne peut appliquer ces migrations par erreur.

## Migrations (dans l'ordre)

| Fichier (staging) | Objet | Item | Régression front live si poussé seul ? |
|---|---|---|---|
| `…110400_hype_favorite_stats_rpc.sql` | RPC `get_hype_favorite_stats` (total + récent) | 1b | Non (additif) |
| `…110500_dj_public_profile_followed_fiche.sql` | `get_dj_public_profile` + `followed_dj_id` | 6 | Non (champ additif) |
| `…110600_owner_new_favorite_notification.sql` | trigger `trg_notify_owner_new_favorite` + `emit_staff_notification` + `dedup_key` | 3 | Non — **commence à marcher dès le push** |
| `…110700_organizer_followers_lock_rls.sql` | verrou RLS `organizer_profile_followers` + `get_organizer_follower_count` | 4 | **OUI** — les counts directs du front passent à 0 |

⚠️ **Item 4 (110700) doit partir AVEC le déploiement du nouveau front** (merge + `wrangler deploy`),
sinon les compteurs d'abonnés organisateur affichent 0 en prod dans l'intervalle. Les autres
sont sûres à tout moment.

## Deploys edge (bundlent le working tree — contient du WIP type-only d'autres sessions)

- Item 2 (pagination push >1000) : `supabase functions deploy process-scheduled-campaigns send-push-campaign`
- Item 5 (dj_lineup notifié sur sentUserIds) : `supabase functions deploy send-push-notification`

(Fonctions existantes → pas de 402.)

## Procédure de ship

1. **Re-timestamper** les 4 fichiers APRÈS le dernier timestamp appliqué en remote
   (les 110xxx sont désormais < au dernier remote ; `supabase migration list --linked` puis
   renommer en `<AAAAMMJJHHMMSS>` croissants — ex. 130400+ selon l'état du moment).
   Les commentaires de code / messages de commit citent les noms 110xxx de staging : purement
   informatif, pas besoin de les corriger.
2. **Vérifier l'absence de collision** : `ls supabase/migrations | sed -E 's/_.*//' | sort | uniq -d`
   doit être vide.
3. `mv` les 4 fichiers re-timestampés dans `supabase/migrations/`, supprimer ce dossier de staging.
4. **Re-vérifier le pending** : `supabase migration list --linked` → seules mes 4 migrations
   doivent être « local sans remote ». Si d'autres apparaissent (WIP d'autres sessions), NE PAS
   pousser sans accord.
5. `supabase db push` (applique les 4).
6. `supabase functions deploy process-scheduled-campaigns send-push-campaign send-push-notification`.
7. Merge + `wrangler deploy` du front (ou l'inverse pour l'item 4 : front d'abord / en même temps).
8. Vérifier : un vrai follow club → cloche owner ; page DJ (suivi via autre fiche) → bon état ;
   compteur orga non nul ; hype score favoris non-nul côté owner.

## DoD (règle CLAUDE.md)

Phase A = correctness/perf/sécurité (bugs), pas de nouvelle feature pro visible → **pas de
`ohelp.*` ni `HELP_ARTICLES` à mettre à jour**. La feature Audience elle-même (déjà déployée
en Phase 0) garde sa doc existante.
