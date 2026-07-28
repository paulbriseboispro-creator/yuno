-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C / item C4 — cohortes de rétention (depuis le journal append-only).
--
-- Par SEMAINE de premier abonnement : combien d'abonnés de cette cohorte suivent
-- ENCORE aujourd'hui (rétention %). Le journal append-only rend enfin ça possible.
--
-- ⚠️ Honnêteté : on ne garde que les cohortes dont le 1er follow est >= ledger_start
-- (le 1er event 'trigger', càd depuis l'activation du suivi). Avant, les unfollows
-- n'étaient pas journalisés et le backfill n'a gardé que les survivants → une cohorte
-- pré-journal afficherait ~100% par biais de survie. On préfère un graphe qui se
-- remplit chaque semaine à un graphe qui ment. Polymorphe (venue/dj/organizer).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_audience_cohorts(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       jsonb;
  v_ledger_start timestamptz;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  SELECT min(created_at) INTO v_ledger_start
    FROM public.audience_follow_events
   WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND source = 'trigger';

  WITH first_follow AS (
    SELECT follower_user_id AS user_id, min(created_at) AS first_at
      FROM public.audience_follow_events
     WHERE subject_type = p_subject_type AND subject_id = p_subject_id AND action = 'follow'
     GROUP BY follower_user_id
  ),
  fresh AS (   -- seulement les cohortes à churn réel (post-activation)
    SELECT user_id, first_at FROM first_follow
     WHERE v_ledger_start IS NOT NULL AND first_at >= v_ledger_start
  ),
  cur AS (SELECT user_id FROM public.audience_members(p_subject_type, p_subject_id)),
  cohorts AS (
    SELECT date_trunc('week', f.first_at)::date AS cohort_week,
           count(*)                                       AS size,
           count(*) FILTER (WHERE c.user_id IS NOT NULL)  AS retained
      FROM fresh f
      LEFT JOIN cur c ON c.user_id = f.user_id
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ok', true,
    'ledger_start', v_ledger_start::date,
    'cohorts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'week', cohort_week, 'size', size, 'retained', retained,
               'retention', CASE WHEN size > 0 THEN round(100.0 * retained / size, 0) ELSE 0 END)
             ORDER BY cohort_week)
      FROM cohorts
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_cohorts(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_cohorts(text, text) TO authenticated;
