-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 3 : efficacité des notifications.
--
-- get_audience_notifications(subject) :
--   • reach       : abonnés joignables / total (token push client actif).
--   • best_send   : créneau modal (jour + heure) et engagement moyen de l'audience
--                   (user_send_profiles, le moteur adaptatif du Taste Engine).
--   • push_30d    : sur les abonnés, envois vs clics des 30 derniers jours (tous
--                   pushes confondus) → un signal d'engagement de l'audience.
--   • campaigns   : venue only — CTR par campagne récente (push_campaign_events,
--                   attribuable par user, donc PRÉCIS, contrairement au 30 j global).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_audience_notifications(p_subject_type text, p_subject_id text)
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
    SELECT user_id FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  reach AS (
    SELECT
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.push_subscriptions ps
         WHERE ps.user_id = m.user_id AND ps.platform = 'ios')) AS reachable,
      count(*) AS total
    FROM m
  ),
  send AS (
    SELECT
      mode() WITHIN GROUP (ORDER BY usp.preferred_dow)  AS dow,
      mode() WITHIN GROUP (ORDER BY usp.preferred_hour) AS hour,
      round(avg(usp.engagement_score)::numeric, 2)      AS eng
    FROM m JOIN public.user_send_profiles usp ON usp.user_id = m.user_id
  ),
  pushes AS (
    SELECT
      count(*) FILTER (WHERE e.event_type = 'sent')    AS sent,
      count(*) FILTER (WHERE e.event_type = 'clicked') AS clicked
    FROM (
      SELECT ape.user_id, ape.event_type, ape.created_at FROM public.auto_push_events ape
      UNION ALL
      SELECT pce.user_id, pce.event_type, pce.created_at FROM public.push_campaign_events pce
    ) e
    JOIN m ON m.user_id = e.user_id
    WHERE e.created_at >= now() - interval '30 days'
  ),
  camps AS (
    SELECT jsonb_agg(row_to_json(cc)::jsonb ORDER BY cc.created_at DESC) AS list
    FROM (
      SELECT
        pc.id, coalesce(pc.title, '') AS title, pc.created_at,
        pc.targeted_count AS targeted, pc.sent_count AS sent,
        (SELECT count(*) FROM public.push_campaign_events x
          WHERE x.campaign_id = pc.id AND x.event_type = 'clicked') AS clicked,
        CASE WHEN pc.sent_count > 0
             THEN round(100.0 * (SELECT count(*) FROM public.push_campaign_events x
                                   WHERE x.campaign_id = pc.id AND x.event_type = 'clicked')
                        / pc.sent_count, 1)
             ELSE 0 END AS ctr
      FROM public.push_campaigns pc
      WHERE p_subject_type = 'venue' AND pc.venue_id = p_subject_id
        AND pc.created_at >= now() - interval '90 days'
      ORDER BY pc.created_at DESC
      LIMIT 10
    ) cc
  )
  SELECT jsonb_build_object(
    'ok', true,
    'reach', jsonb_build_object(
      'reachable', (SELECT reachable FROM reach),
      'total',     (SELECT total FROM reach)
    ),
    'best_send', jsonb_build_object(
      'dow',        (SELECT dow FROM send),
      'hour',       (SELECT hour FROM send),
      'engagement', (SELECT eng FROM send)
    ),
    'push_30d', jsonb_build_object(
      'sent',    (SELECT sent FROM pushes),
      'clicked', (SELECT clicked FROM pushes),
      'ctr', CASE WHEN (SELECT sent FROM pushes) > 0
                  THEN round(100.0 * (SELECT clicked FROM pushes) / (SELECT sent FROM pushes), 1)
                  ELSE 0 END
    ),
    'campaigns', COALESCE((SELECT list FROM camps), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_notifications(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_notifications(text, text) TO authenticated;
