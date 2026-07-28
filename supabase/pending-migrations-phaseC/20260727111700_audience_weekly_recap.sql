-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C / item C5 — récap hebdo poussé au pro (« +142 abonnés, 2 push, 2 400€ »).
--
-- Trois pièces SQL : (1) la donnée par sujet sur 7 jours, (2) un journal de dédup
-- (une fois par semaine et par sujet), (3) le seed de la clé AUTO_PUSH au registre.
-- L'ENVOI est fait côté edge (dispatchAudienceWeeklyRecaps + sendAutoPush, audience
-- 'pro'), drainé par process-scheduled-campaigns — conventions auto-push respectées.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Données du récap (7 derniers jours). Venue only (revenu). followers = net réel
--    du journal ; pushes = campagnes envoyées ; revenue = CA Net (fees.ts). Fonction
--    INTERNE (comme audience_members) : appelée par le dispatcher en service_role,
--    donc PAS de garde can_read_audience (auth.uid() NULL en cron). REVOKE de tous les
--    rôles clients, GRANT au seul service_role.
CREATE OR REPLACE FUNCTION public.audience_weekly_recap_data(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  WITH flow AS (
    SELECT
      count(*) FILTER (WHERE action = 'follow')   AS gained,
      count(*) FILTER (WHERE action = 'unfollow') AS lost
    FROM public.audience_follow_events
    WHERE subject_type = p_subject_type AND subject_id = p_subject_id
      AND created_at >= v_from
  ),
  scoped_events AS (
    SELECT id FROM public.events
     WHERE p_subject_type = 'venue' AND (venue_id = p_subject_id OR partner_venue_id = p_subject_id)
  ),
  rev AS (
    SELECT COALESCE(sum(net), 0) AS net FROM (
      SELECT (t.total_price - coalesce(t.service_fee,0) - coalesce(t.insurance_fee,0)
                - coalesce(t.refund_amount,0) - (t.total_price*0.015 + 0.25)) AS net
        FROM public.tickets t
       WHERE p_subject_type = 'venue' AND t.event_id IN (SELECT id FROM scoped_events)
         AND t.status = 'paid' AND t.created_at >= v_from
      UNION ALL
      SELECT (r.total_price - coalesce(r.service_fee,0) - coalesce(r.management_fee,0)
                - coalesce(r.refund_amount,0) - (r.total_price*0.015 + 0.25))
        FROM public.table_reservations r
       WHERE p_subject_type = 'venue' AND r.event_id IN (SELECT id FROM scoped_events)
         AND r.status = 'paid' AND r.created_at >= v_from
      UNION ALL
      SELECT (o.total - coalesce(o.service_fee,0) - coalesce(o.refund_amount,0) - (o.total*0.015 + 0.25))
        FROM public.orders o
       WHERE p_subject_type = 'venue' AND o.venue_id = p_subject_id
         AND o.status IN ('paid','served') AND o.created_at >= v_from
    ) s
  ),
  pushes AS (
    SELECT count(*) AS n FROM public.push_campaigns
     WHERE p_subject_type = 'venue' AND venue_id = p_subject_id
       AND created_at >= v_from AND status = 'sent'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'followers_net', (SELECT gained - lost FROM flow),
    'followers_gained', (SELECT gained FROM flow),
    'pushes', (SELECT n FROM pushes),
    'revenue_net', round((SELECT net FROM rev)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.audience_weekly_recap_data(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audience_weekly_recap_data(text, text) TO service_role;

-- 2. Journal de dédup : une ligne par sujet et par semaine (lundi). RLS interne.
CREATE TABLE IF NOT EXISTS public.audience_recap_log (
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  week_start   date NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id, week_start)
);
ALTER TABLE public.audience_recap_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audience_recap_log FROM anon, authenticated;

-- 3. Registre auto-push : la clé du récap (catégorie engagement, désactivable par le super admin).
INSERT INTO public.platform_notification_settings (notification_key, category)
VALUES ('audience_weekly_recap', 'engagement')
ON CONFLICT (notification_key) DO NOTHING;
