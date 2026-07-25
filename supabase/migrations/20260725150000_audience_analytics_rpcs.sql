-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 1 : colonne vertébrale (RPC).
--
-- Trois briques, réutilisées par toutes les phases suivantes :
--   • can_read_audience  — garde d'ownership DRY (helpers plateforme existants).
--   • audience_members   — l'ensemble des abonnés d'un sujet, grain PERSONNE pour
--                          les DJs, dédupliqué (une ligne par abonné, plus ancienne
--                          date). La colonne vertébrale que segments/notifs/revenu
--                          réutilisent au lieu de redupliquer la résolution.
--   • get_audience_analytics / get_audience_growth — KPI + démographie + courbe.
--
-- On COMPOSE l'existant (même forme de sortie que dj_audience_analytics). Tables
-- audience_* internes (RLS sans policy) → ces RPC SECURITY DEFINER sont la seule
-- porte de lecture pro, strictement bornée au sujet possédé.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Garde d'ownership réutilisable ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Réutilise les helpers d'ownership de la plateforme (mêmes que
  -- event_audience_demographics) : owner + managers/team + super admin.
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_subject_type = 'dj' THEN
      p_subject_id::uuid = auth.uid()
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.dj_team_members
         WHERE member_user_id = auth.uid()
           AND dj_user_id = p_subject_id::uuid
           AND status = 'active'
      )
    WHEN p_subject_type = 'venue' THEN
      public.is_venue_owner(auth.uid(), p_subject_id) OR public.is_super_admin()
    WHEN p_subject_type = 'organizer' THEN
      public.can_manage_organizer(p_subject_id::uuid)
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_audience(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_read_audience(text, text) TO authenticated;

-- ── L'ensemble des abonnés d'un sujet (grain personne pour DJ) ────────────────
-- NON accordé à authenticated : renverrait des user_id d'abonnés de n'importe quel
-- sujet (fuite). Seules les RPC DEFINER (propriétaire postgres) l'appellent, après
-- leur propre garde can_read_audience.
CREATE OR REPLACE FUNCTION public.audience_members(p_subject_type text, p_subject_id text)
RETURNS TABLE(user_id uuid, first_followed timestamptz, notify_all boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.user_id) m.user_id, m.first_followed, m.notify_all
  FROM (
    SELECT f.user_id, f.created_at AS first_followed, false AS notify_all
      FROM public.favorites f
     WHERE p_subject_type = 'venue' AND f.favorite_type = 'club' AND f.venue_id = p_subject_id
    UNION ALL
    SELECT f.user_id, f.created_at, f.notify_all_locations
      FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
     WHERE p_subject_type = 'dj' AND f.favorite_type = 'dj'
       AND d.user_id = CASE WHEN p_subject_type = 'dj' THEN nullif(p_subject_id, '')::uuid END
    UNION ALL
    SELECT opf.user_id, opf.created_at, false
      FROM public.organizer_profile_followers opf
     WHERE p_subject_type = 'organizer'
       AND opf.organizer_user_id = CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END
  ) m
  ORDER BY m.user_id, m.first_followed ASC;
$$;

REVOKE ALL ON FUNCTION public.audience_members(text, text) FROM public, anon, authenticated;

-- ── Démographie + KPI agrégés d'une audience ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_audience_analytics(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  WITH subs AS (
    SELECT user_id, first_followed AS created_at, notify_all
      FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  enriched AS (
    SELECT
      s.user_id, s.created_at, s.notify_all,
      p.birth_date,
      nullif(trim(p.city), '') AS city,
      p.preferred_language, p.party_persona,
      tp.music_style, g.gender,
      EXISTS (
        SELECT 1 FROM public.push_subscriptions ps
         WHERE ps.user_id = s.user_id AND ps.platform = 'ios'
      ) AS reachable
    FROM subs s
    LEFT JOIN public.profiles p             ON p.id = s.user_id
    LEFT JOIN public.user_taste_profiles tp ON tp.user_id = s.user_id
    LEFT JOIN LATERAL (
      SELECT gle.gender
        FROM public.guest_list_entries gle
       WHERE gle.gender IS NOT NULL
         AND (gle.user_id = s.user_id OR (p.email IS NOT NULL AND lower(gle.email) = lower(p.email)))
       ORDER BY gle.created_at DESC LIMIT 1
    ) g ON true
  )
  SELECT jsonb_build_object(
    'ok', true,
    'total',        (SELECT count(*) FROM subs),
    'reachable',    (SELECT count(*) FROM enriched WHERE reachable),
    'notify_all',   (SELECT count(*) FROM enriched WHERE notify_all),
    'age_known',    (SELECT count(*) FROM enriched WHERE birth_date IS NOT NULL),
    'gender_known', (SELECT count(*) FROM enriched WHERE gender IS NOT NULL),
    'recent_30d',   (SELECT count(*) FROM enriched WHERE created_at >= now() - interval '30 days'),
    'growth', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', m, 'count', c) ORDER BY m)
      FROM (SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, count(*) c
              FROM enriched GROUP BY 1) gm
    ), '[]'::jsonb),
    'age_buckets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) ORDER BY ord)
      FROM (
        SELECT bucket, ord, count(*) c FROM (
          SELECT
            CASE WHEN age < 18 THEN '<18' WHEN age BETWEEN 18 AND 24 THEN '18-24'
                 WHEN age BETWEEN 25 AND 34 THEN '25-34' WHEN age BETWEEN 35 AND 44 THEN '35-44'
                 ELSE '45+' END AS bucket,
            CASE WHEN age < 18 THEN 0 WHEN age BETWEEN 18 AND 24 THEN 1
                 WHEN age BETWEEN 25 AND 34 THEN 2 WHEN age BETWEEN 35 AND 44 THEN 3 ELSE 4 END AS ord
          FROM (SELECT date_part('year', age(birth_date))::int AS age
                  FROM enriched WHERE birth_date IS NOT NULL) a
        ) b GROUP BY bucket, ord
      ) ab
    ), '[]'::jsonb),
    'gender', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', gender, 'count', c) ORDER BY c DESC)
      FROM (SELECT gender, count(*) c FROM enriched WHERE gender IS NOT NULL GROUP BY gender) gg
    ), '[]'::jsonb),
    'cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city, 'count', c) ORDER BY c DESC)
      FROM (SELECT city, count(*) c FROM enriched WHERE city IS NOT NULL
             GROUP BY city ORDER BY c DESC LIMIT 8) cc
    ), '[]'::jsonb),
    'languages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lang', preferred_language, 'count', c) ORDER BY c DESC)
      FROM (SELECT preferred_language, count(*) c FROM enriched
             WHERE preferred_language IS NOT NULL GROUP BY preferred_language) ll
    ), '[]'::jsonb),
    'personas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('persona', party_persona, 'count', c) ORDER BY c DESC)
      FROM (SELECT party_persona, count(*) c FROM enriched
             WHERE party_persona IS NOT NULL GROUP BY party_persona ORDER BY c DESC LIMIT 6) pp
    ), '[]'::jsonb),
    'music', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('style', music_style, 'count', c) ORDER BY c DESC)
      FROM (SELECT music_style, count(*) c FROM enriched
             WHERE music_style IS NOT NULL GROUP BY music_style ORDER BY c DESC LIMIT 6) ms
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_analytics(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_analytics(text, text) TO authenticated;

-- ── Courbe d'évolution (depuis les snapshots) ─────────────────────────────────
-- `ledger_start` = 1er événement réel (source='trigger') : avant = brut (churn passé
-- perdu), après = net fiable. Le front étiquette la discontinuité (correctif 1.3).
CREATE OR REPLACE FUNCTION public.get_audience_growth(
  p_subject_type text,
  p_subject_id   text,
  p_from         date DEFAULT (CURRENT_DATE - 90),
  p_to           date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'date', snapshot_date, 'total', followers_total,
               'gained', follows_gained, 'lost', follows_lost,
               'net', net_change, 'reachable', reachable_count) ORDER BY snapshot_date)
        FROM public.audience_daily_snapshots
       WHERE subject_type = p_subject_type AND subject_id = p_subject_id
         AND snapshot_date BETWEEN p_from AND p_to
    ), '[]'::jsonb),
    'ledger_start', (
      SELECT min(created_at)::date FROM public.audience_follow_events
       WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND source = 'trigger'
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_growth(text, text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_growth(text, text, date, date) TO authenticated;
