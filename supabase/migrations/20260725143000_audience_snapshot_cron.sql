-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 0 : capture (4/4) — snapshot quotidien + cron.
--
-- run_audience_snapshot(p_date) écrit UNE ligne par sujet ayant des abonnés OU de
-- l'activité ce jour-là :
--   • followers_total  = STOCK vivant (autoritaire ; s'auto-corrige contre toute
--                        dérive du journal).
--   • gained / lost    = FLUX du jour depuis audience_follow_events.
--   • reachable_count  = abonnés distincts avec un token push CLIENT actif
--                        (push_subscriptions.platform = 'ios' ; l'app Pro = 'ios_pro',
--                        le web est déprécié). C'est la métrique « combien peuvent
--                        vraiment recevoir une notif ».
--
-- Grain DJ = personne (djs.user_id). Volume : ~1 ligne/sujet/jour, borné, écrit
-- une fois par nuit. Le stock prime sur le flux au bord de minuit UTC (quelques
-- heures de décalage sont sans effet sur une courbe de croissance).
--
-- Sécurité : SECURITY DEFINER (écrit dans une table RLS interne). Aucune session
-- utilisateur ne doit l'appeler → REVOKE de tous les rôles clients ; seul le cron
-- (postgres, propriétaire) l'exécute.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_audience_snapshot(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows int;
BEGIN
  WITH stock AS (
    SELECT 'venue'::text AS subject_type, f.venue_id AS subject_id, count(*)::int AS total
      FROM public.favorites f
     WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL
     GROUP BY f.venue_id
    UNION ALL
    SELECT 'dj', d.user_id::text, count(DISTINCT f.user_id)::int
      FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
     WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
     GROUP BY d.user_id
    UNION ALL
    SELECT 'organizer', opf.organizer_user_id::text, count(*)::int
      FROM public.organizer_profile_followers opf
     GROUP BY opf.organizer_user_id
  ),
  flow AS (
    SELECT subject_type, subject_id,
           count(*) FILTER (WHERE action = 'follow')::int   AS gained,
           count(*) FILTER (WHERE action = 'unfollow')::int AS lost
      FROM public.audience_follow_events
     WHERE created_at >= p_date::timestamptz
       AND created_at <  (p_date + 1)::timestamptz
     GROUP BY subject_type, subject_id
  ),
  reach AS (
    SELECT subject_type, subject_id, count(DISTINCT follower)::int AS reachable
    FROM (
      SELECT 'venue'::text AS subject_type, f.venue_id AS subject_id, f.user_id AS follower
        FROM public.favorites f
        JOIN public.push_subscriptions ps ON ps.user_id = f.user_id AND ps.platform = 'ios'
       WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL
      UNION ALL
      SELECT 'dj', d.user_id::text, f.user_id
        FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
        JOIN public.push_subscriptions ps ON ps.user_id = f.user_id AND ps.platform = 'ios'
       WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
      UNION ALL
      SELECT 'organizer', opf.organizer_user_id::text, opf.user_id
        FROM public.organizer_profile_followers opf
        JOIN public.push_subscriptions ps ON ps.user_id = opf.user_id AND ps.platform = 'ios'
    ) r
    GROUP BY subject_type, subject_id
  )
  INSERT INTO public.audience_daily_snapshots
    (subject_type, subject_id, snapshot_date,
     followers_total, follows_gained, follows_lost, net_change, reachable_count)
  SELECT COALESCE(st.subject_type, fl.subject_type),
         COALESCE(st.subject_id,   fl.subject_id),
         p_date,
         COALESCE(st.total,  0),
         COALESCE(fl.gained, 0),
         COALESCE(fl.lost,   0),
         COALESCE(fl.gained, 0) - COALESCE(fl.lost, 0),
         COALESCE(rc.reachable, 0)
    FROM stock st
    FULL JOIN flow fl
      ON fl.subject_type = st.subject_type AND fl.subject_id = st.subject_id
    LEFT JOIN reach rc
      ON rc.subject_type = COALESCE(st.subject_type, fl.subject_type)
     AND rc.subject_id   = COALESCE(st.subject_id,   fl.subject_id)
  ON CONFLICT (subject_type, subject_id, snapshot_date) DO UPDATE SET
    followers_total = EXCLUDED.followers_total,
    follows_gained  = EXCLUDED.follows_gained,
    follows_lost    = EXCLUDED.follows_lost,
    net_change      = EXCLUDED.net_change,
    reachable_count = EXCLUDED.reachable_count;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('date', p_date, 'rows', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_audience_snapshot(date) FROM public, anon, authenticated;

-- ── Cron quotidien : 23:55 UTC, enregistre le jour qui s'achève ───────────────
-- cron.schedule upsert par nom → ré-exécutable sans dupliquer le job.
SELECT cron.schedule(
  'audience-daily-snapshot',
  '55 23 * * *',
  $$SELECT public.run_audience_snapshot();$$
);

-- ── Premier point de série (jour du déploiement) ──────────────────────────────
SELECT public.run_audience_snapshot();
