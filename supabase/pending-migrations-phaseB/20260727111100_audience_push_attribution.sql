-- ─────────────────────────────────────────────────────────────────────────────
-- Phase B / item B3 — attribution revenu push→vente.
--
-- « Ton dernier push a rapporté X€ » : par campagne, le revenu NET des ventes du
-- venue réalisées par les CLIQUEURS de la campagne dans les 72h suivant leur 1er clic.
-- Le clic est déjà attribuable (push_campaign_events). Les cliqueurs sont des users
-- connectés → on attribue par user_id (les ventes portent user_id ; le guest-checkout
-- sans compte ne clique pas un push app).
--
-- Net répliqué à l'identique de get_audience_revenue (source de vérité, fees.ts) :
--   net = (total − frais service/assurance/gestion) − remboursement − (total×0.015 + 0.25)
--
-- Revenu PAR campagne = influence (une vente peut être créditée à 2 campagnes si le
-- user a cliqué les deux dans la fenêtre). total_90d dédup la vente (sale_key) pour ne
-- pas gonfler le cumul. Venue only (comme la liste de campagnes de notifications).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_audience_push_attribution(p_subject_type text, p_subject_id text)
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

  IF p_subject_type <> 'venue' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT id FROM public.events
     WHERE venue_id = p_subject_id OR partner_venue_id = p_subject_id
  ),
  -- 1er clic par (campagne, user) sur les campagnes du venue (90j)
  clicks AS (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS click_at
      FROM public.push_campaign_events pce
      JOIN public.push_campaigns pc ON pc.id = pce.campaign_id
     WHERE pce.event_type = 'clicked'
       AND pc.venue_id = p_subject_id
       AND pc.created_at >= now() - interval '90 days'
       AND pce.user_id IS NOT NULL
     GROUP BY pce.campaign_id, pce.user_id
  ),
  -- ventes du venue avec NET (fees.ts), clé de vente pour dédup
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, t.user_id, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'table:' || r.id::text, r.user_id, r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'order:' || o.id::text, o.user_id, o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25))
      FROM public.orders o
     WHERE o.venue_id = p_subject_id AND o.status IN ('paid', 'served') AND o.user_id IS NOT NULL
  ),
  -- vente attribuée si l'acheteur a cliqué la campagne et acheté dans les 72h
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.user_id, s.net
      FROM clicks c
      JOIN sales s
        ON s.user_id = c.user_id
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2) AS revenue,
           count(DISTINCT user_id)      AS buyers
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', campaign_id, 'revenue', revenue, 'buyers', buyers))
      FROM per_campaign
    ), '[]'::jsonb),
    -- cumul dédupliqué par vente (une vente ne compte qu'une fois même si 2 campagnes la revendiquent)
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_push_attribution(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_push_attribution(text, text) TO authenticated;
