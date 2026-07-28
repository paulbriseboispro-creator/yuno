-- ─────────────────────────────────────────────────────────────────────────────
-- Phase B / item B1 — ré-acheteurs dans get_audience_segments (5e étape de l'entonnoir).
--
-- L'entonnoir follower→client a besoin d'une dernière marche : les abonnés qui ont
-- acheté PLUSIEURS fois (fidélité prouvée). On l'ajoute au RPC segments (venue only) :
-- ré-acheteur = abonné venue_customer avec >= 2 transactions cumulées
-- (ticket_count + order_count + table_count). Le reste du RPC est inchangé.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_audience_segments(p_subject_type text, p_subject_id text)
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

  WITH m AS (
    SELECT user_id, first_followed, notify_all
      FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  clickers AS (
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.auto_push_events
        WHERE event_type = 'clicked' AND created_at >= now() - interval '90 days'
      UNION
      SELECT user_id FROM public.push_campaign_events
        WHERE event_type = 'clicked' AND created_at >= now() - interval '90 days'
    ) c
  ),
  flags AS (
    SELECT m.user_id, m.first_followed, m.notify_all,
      EXISTS (SELECT 1 FROM public.push_subscriptions ps
               WHERE ps.user_id = m.user_id AND ps.platform = 'ios') AS reachable,
      EXISTS (SELECT 1 FROM clickers c WHERE c.user_id = m.user_id) AS engaged
    FROM m
  ),
  vc AS (   -- venue uniquement : abonnés qui ont acheté
    SELECT m.user_id, vcu.total_spent, vcu.last_visit_at,
           (coalesce(vcu.ticket_count, 0) + coalesce(vcu.order_count, 0) + coalesce(vcu.table_count, 0)) AS tx_count
      FROM m JOIN public.venue_customers vcu
        ON vcu.user_id = m.user_id AND vcu.venue_id = p_subject_id
     WHERE p_subject_type = 'venue'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'total', (SELECT count(*) FROM m),
    'engagement', jsonb_build_object(
      'engaged',     (SELECT count(*) FROM flags WHERE reachable AND engaged),
      'passive',     (SELECT count(*) FROM flags WHERE reachable AND NOT engaged),
      'unreachable', (SELECT count(*) FROM flags WHERE NOT reachable)
    ),
    'superfans', (SELECT count(*) FROM flags WHERE notify_all),
    'cohort', jsonb_build_object(
      'new_30d',     (SELECT count(*) FROM flags WHERE first_followed >= now() - interval '30 days'),
      'established',  (SELECT count(*) FROM flags WHERE first_followed <  now() - interval '30 days')
    ),
    'converted', CASE WHEN p_subject_type = 'venue' THEN (SELECT count(*) FROM vc) ELSE NULL END,
    'repeat_buyers', CASE WHEN p_subject_type = 'venue'
      THEN (SELECT count(*) FROM vc WHERE tx_count >= 2) ELSE NULL END,
    'spend_tiers', CASE WHEN p_subject_type = 'venue' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tier', tier, 'count', c, 'revenue', rev) ORDER BY ord)
      FROM (
        SELECT tier, ord, count(*) c, round(sum(total_spent)::numeric, 2) rev FROM (
          SELECT CASE WHEN total_spent >= 500 THEN 'gold'
                      WHEN total_spent >= 150 THEN 'silver' ELSE 'bronze' END AS tier,
                 CASE WHEN total_spent >= 500 THEN 0
                      WHEN total_spent >= 150 THEN 1 ELSE 2 END AS ord,
                 coalesce(total_spent, 0) AS total_spent
          FROM vc
        ) t GROUP BY tier, ord
      ) st
    ), '[]'::jsonb) ELSE NULL END,
    'recency', CASE WHEN p_subject_type = 'venue' THEN jsonb_build_object(
      'active',  (SELECT count(*) FROM vc WHERE last_visit_at >= now() - interval '30 days'),
      'at_risk', (SELECT count(*) FROM vc WHERE last_visit_at <  now() - interval '30 days'
                                            AND last_visit_at >= now() - interval '90 days'),
      'lapsed',  (SELECT count(*) FROM vc WHERE last_visit_at <  now() - interval '90 days')
    ) ELSE NULL END
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_segments(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_segments(text, text) TO authenticated;
