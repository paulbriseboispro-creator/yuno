-- Add gender column to profiles and improve DJ audience analytics coverage.
--
-- Previously gender was derived exclusively from guest_list_entries (partial coverage).
-- Now profiles.gender is the primary source; guest_list_entries remains the fallback for
-- users who signed a guest list before their profile had a gender field.
--
-- The GuestListSignup frontend now upserts profiles.gender client-side after a successful
-- signup when the user is authenticated (no edge function needed, no cap-402 risk).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'non_binary', 'other'));

-- Update the analytics RPC to prefer profiles.gender over the guest_list_entries fallback.
-- The coverage counter (gender_known) now reflects the combined source.
CREATE OR REPLACE FUNCTION public.dj_audience_analytics(p_dj_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  effective uuid := coalesce(p_dj_user_id, auth.uid());
  result jsonb;
BEGIN
  IF effective IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF effective <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.dj_team_members
    WHERE member_user_id = auth.uid() AND dj_user_id = effective AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH dj_ids AS (
    SELECT id FROM public.djs WHERE user_id = effective
  ),
  subs AS (
    SELECT DISTINCT ON (f.user_id)
      f.user_id, f.created_at, f.notify_all_locations
    FROM public.favorites f
    WHERE f.favorite_type = 'dj'
      AND f.dj_id IN (SELECT id FROM dj_ids)
    ORDER BY f.user_id, f.created_at ASC
  ),
  enriched AS (
    SELECT
      s.user_id,
      s.created_at,
      s.notify_all_locations,
      p.email,
      p.birth_date,
      nullif(trim(p.city), '') AS city,
      p.preferred_language,
      p.party_persona,
      tp.music_style,
      -- profiles.gender is primary; guest_list_entries.gender is the fallback for
      -- users who attended events before setting their profile gender.
      COALESCE(p.gender, g.gender) AS gender
    FROM subs s
    LEFT JOIN public.profiles p ON p.id = s.user_id
    LEFT JOIN public.user_taste_profiles tp ON tp.user_id = s.user_id
    LEFT JOIN LATERAL (
      SELECT gle.gender
      FROM public.guest_list_entries gle
      WHERE gle.gender IS NOT NULL
        AND (gle.user_id = s.user_id
          OR (p.email IS NOT NULL AND lower(gle.email) = lower(p.email)))
      ORDER BY gle.created_at DESC
      LIMIT 1
    ) g ON true
  )
  SELECT jsonb_build_object(
    'ok', true,
    'total', (SELECT count(*) FROM subs),
    'notify_all', (SELECT count(*) FROM enriched WHERE notify_all_locations),
    'age_known', (SELECT count(*) FROM enriched WHERE birth_date IS NOT NULL),
    'gender_known', (SELECT count(*) FROM enriched WHERE gender IS NOT NULL),
    'recent_30d', (SELECT count(*) FROM enriched WHERE created_at >= now() - interval '30 days'),
    'growth', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', m, 'count', c) ORDER BY m)
      FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, count(*) c
        FROM enriched GROUP BY 1
      ) gm
    ), '[]'::jsonb),
    'age_buckets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) ORDER BY ord)
      FROM (
        SELECT bucket, ord, count(*) c
        FROM (
          SELECT
            CASE
              WHEN age < 18 THEN '<18'
              WHEN age BETWEEN 18 AND 24 THEN '18-24'
              WHEN age BETWEEN 25 AND 34 THEN '25-34'
              WHEN age BETWEEN 35 AND 44 THEN '35-44'
              ELSE '45+'
            END AS bucket,
            CASE
              WHEN age < 18 THEN 0 WHEN age BETWEEN 18 AND 24 THEN 1
              WHEN age BETWEEN 25 AND 34 THEN 2 WHEN age BETWEEN 35 AND 44 THEN 3 ELSE 4
            END AS ord
          FROM (
            SELECT date_part('year', age(birth_date))::int AS age
            FROM enriched WHERE birth_date IS NOT NULL
          ) a
        ) b GROUP BY bucket, ord
      ) ab
    ), '[]'::jsonb),
    'gender', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', gender, 'count', c) ORDER BY c DESC)
      FROM (SELECT gender, count(*) c FROM enriched WHERE gender IS NOT NULL GROUP BY gender) gg
    ), '[]'::jsonb),
    'cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city, 'count', c) ORDER BY c DESC)
      FROM (
        SELECT city, count(*) c FROM enriched WHERE city IS NOT NULL
        GROUP BY city ORDER BY c DESC LIMIT 8
      ) cc
    ), '[]'::jsonb),
    'languages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lang', preferred_language, 'count', c) ORDER BY c DESC)
      FROM (
        SELECT preferred_language, count(*) c FROM enriched
        WHERE preferred_language IS NOT NULL GROUP BY preferred_language
      ) ll
    ), '[]'::jsonb),
    'personas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('persona', party_persona, 'count', c) ORDER BY c DESC)
      FROM (
        SELECT party_persona, count(*) c FROM enriched
        WHERE party_persona IS NOT NULL GROUP BY party_persona ORDER BY c DESC LIMIT 6
      ) pp
    ), '[]'::jsonb),
    'music', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('style', music_style, 'count', c) ORDER BY c DESC)
      FROM (
        SELECT music_style, count(*) c FROM enriched
        WHERE music_style IS NOT NULL GROUP BY music_style ORDER BY c DESC LIMIT 6
      ) ms
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dj_audience_analytics(uuid) TO authenticated;
