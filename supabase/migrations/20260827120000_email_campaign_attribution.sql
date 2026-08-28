-- ─────────────────────────────────────────────────────────────────────────────
-- Attribution revenu email→vente — miroir de get_audience_push_attribution
-- (20260728170600), même modèle, même formule net (fees.ts) :
--   net = (total − frais service/assurance/gestion) − remboursement − (total×0.015 + 0.25)
--
-- Différences assumées avec le miroir push :
--   • Supporté pour venue ET organizer (les campagnes email existent pour les deux).
--   • Le clic vient de email_campaign_events (webhook Resend) et porte un
--     recipient_email, pas un user_id → les ventes sont matchées par
--     lower(user_email). Bonus : les achats en guest checkout (sans compte)
--     sont attribuables, ce que le push ne peut pas faire.
--   • Fenêtre identique : 1er clic par (campagne, email), achat sous 72 h.
--   • Revenu PAR campagne = influence (une vente peut créditer 2 campagnes) ;
--     total_90d dédupliqué par sale_key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
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

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id)
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id)
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- ventes du sujet avec NET (fees.ts), matchées par email, clé de vente pour dédup
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, lower(t.user_email) AS em, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
    UNION ALL
    SELECT 'table:' || r.id::text, lower(r.user_email), r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, lower(o.user_email), o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25))
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.em, s.net
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2) AS revenue,
           count(DISTINCT em)           AS buyers
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', campaign_id, 'revenue', revenue, 'buyers', buyers))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_campaign_attribution(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_email_campaign_attribution(text, text) TO authenticated;
