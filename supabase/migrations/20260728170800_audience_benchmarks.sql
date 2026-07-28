-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C / item C2 — benchmarks médiane-ville.
--
-- « Ta portée 62% vs médiane 47% de ta ville. » Positionne un club face à ses pairs
-- de la MÊME ville, en percentiles seulement — jamais l'identité ni les chiffres d'un
-- autre club (anti-fuite concurrentielle). Source : dernier snapshot par venue
-- (audience_daily_snapshots, rempli quotidiennement pour chaque venue ayant ≥1 abonné).
--
-- Deux métriques : nombre d'abonnés et taux de portée (reachable/total). Le sujet est
-- inclus dans l'échantillon. Renvoie `sample` (nb de venues comparés) : le front
-- n'affiche le benchmark qu'à partir d'un échantillon suffisant (secret statistique).
-- Venue only (un DJ/organisateur n'a pas de « ville » d'ancrage comparable).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_audience_benchmarks(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_city text;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type <> 'venue' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  SELECT city INTO v_city FROM public.venues WHERE id = p_subject_id;
  IF v_city IS NULL OR btrim(v_city) = '' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false, 'reason', 'no_city');
  END IF;

  WITH latest AS (   -- dernier snapshot par venue de la ville (≥1 abonné)
    SELECT DISTINCT ON (s.subject_id) s.subject_id, s.followers_total, s.reachable_count
      FROM public.audience_daily_snapshots s
      JOIN public.venues v ON v.id = s.subject_id
     WHERE s.subject_type = 'venue'
       AND lower(btrim(v.city)) = lower(btrim(v_city))
       AND s.followers_total > 0
     ORDER BY s.subject_id, s.snapshot_date DESC
  ),
  metrics AS (
    SELECT subject_id,
           followers_total AS followers,
           CASE WHEN followers_total > 0
                THEN round(100.0 * reachable_count / followers_total, 1) ELSE 0 END AS reach
      FROM latest
  ),
  me AS (SELECT followers, reach FROM metrics WHERE subject_id = p_subject_id)
  SELECT jsonb_build_object(
    'ok', true, 'supported', true, 'city', v_city,
    'sample', (SELECT count(*) FROM metrics),
    'followers', jsonb_build_object(
      'you',    (SELECT followers FROM me),
      'median', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY followers)::numeric, 0) FROM metrics),
      'percentile', CASE WHEN (SELECT count(*) FROM metrics) > 0 AND EXISTS (SELECT 1 FROM me)
        THEN (SELECT round(100.0 * count(*) FILTER (WHERE followers <= (SELECT followers FROM me)) / count(*), 0) FROM metrics)
        ELSE NULL END
    ),
    'reach', jsonb_build_object(
      'you',    (SELECT reach FROM me),
      'median', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY reach)::numeric, 1) FROM metrics),
      'percentile', CASE WHEN (SELECT count(*) FROM metrics) > 0 AND EXISTS (SELECT 1 FROM me)
        THEN (SELECT round(100.0 * count(*) FILTER (WHERE reach <= (SELECT reach FROM me)) / count(*), 0) FROM metrics)
        ELSE NULL END
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_benchmarks(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_benchmarks(text, text) TO authenticated;
