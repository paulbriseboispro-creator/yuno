-- Attribution et récaps en CA CLUB, comme partout ailleurs.
--
-- L'attribution email (rapport de campagne, Studio, automatisations), push
-- (page Audience) et les récaps hebdo retiraient en plus les frais Stripe
-- (1,5 % + 0,25 €, y compris sur une vente gratuite : −0,25 €) et soustrayaient
-- le remboursement sans plafond. L'historique Push, le Rapport de soirée, les
-- liens suivis et les codes promo montrent, eux, le CA club : la même vente
-- valait deux montants selon l'écran. Désormais un revenu affiché est le CA
-- club de src/utils/fees.ts ; le « net » (Stripe déduit) ne vit que là où il
-- est écrit « net » (Analytics › Ventes).
--
-- Généré depuis l'état LIVE (pg_get_functiondef) : seules les expressions de
-- montant changent. Les clés de sortie gardent leur nom (`net`, `revenue_net`)
-- pour les bundles et fonctions edge déjà en ligne.

-- get_email_campaign_attribution : CA club (frais Yuno exclus, remboursement plafonné), sans Stripe.
CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
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
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$function$;

-- get_audience_push_attribution : CA club (frais Yuno exclus, remboursement plafonné), sans Stripe.
CREATE OR REPLACE FUNCTION public.get_audience_push_attribution(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'table:' || r.id::text, r.user_id, r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'order:' || o.id::text, o.user_id, o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))
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
$function$;

-- audience_weekly_recap_data : CA club (frais Yuno exclus, remboursement plafonné), sans Stripe.
CREATE OR REPLACE FUNCTION public.audience_weekly_recap_data(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      SELECT (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net
        FROM public.tickets t
       WHERE p_subject_type = 'venue' AND t.event_id IN (SELECT id FROM scoped_events)
         AND t.status = 'paid' AND t.created_at >= v_from
      UNION ALL
      SELECT (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
        FROM public.table_reservations r
       WHERE p_subject_type = 'venue' AND r.event_id IN (SELECT id FROM scoped_events)
         AND r.status = 'paid' AND r.created_at >= v_from
      UNION ALL
      SELECT (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))
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
$function$;

-- email_automation_weekly_digest : CA club (frais Yuno exclus, remboursement plafonné), sans Stripe.
CREATE OR REPLACE FUNCTION public.email_automation_weekly_digest(p_subject_type text, p_subject_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  IF p_subject_type NOT IN ('venue', 'organizer') OR p_subject_id IS NULL THEN
    RETURN jsonb_build_object('emails', 0, 'sales', 0, 'revenue', 0);
  END IF;

  WITH children AS (
    SELECT c.id FROM public.email_campaigns c
     WHERE c.automation_id IS NOT NULL
       AND CASE WHEN p_subject_type = 'venue' THEN c.venue_id = p_subject_id
                ELSE c.organizer_user_id::text = p_subject_id END
  ),
  sent AS (
    SELECT count(*) AS n FROM public.email_campaign_recipients r
     WHERE r.campaign_id IN (SELECT id FROM children) AND r.status = 'sent' AND r.sent_at >= v_from
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id OR e.id in (select public.cohost_event_ids_venue(p_subject_id)))
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id OR e.id in (select public.cohost_event_ids_subject(p_subject_id)))
           END
  ),
  clicks AS (
    SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS click_at
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id IN (SELECT id FROM children)
       AND ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
       AND ev.created_at >= v_from - interval '72 hours'
     GROUP BY lower(ev.recipient_email)
  ),
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, lower(t.user_email) AS em, t.created_at,
           (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= v_from
    UNION ALL
    SELECT 'table:' || r.id::text, lower(r.user_email), r.created_at,
           (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= v_from
    UNION ALL
    SELECT 'order:' || o.id::text, lower(o.user_email), o.created_at,
           (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL AND o.created_at >= v_from
       AND CASE WHEN p_subject_type = 'venue' THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events) END
  ),
  attributed AS (
    SELECT DISTINCT s.sale_key, s.net
      FROM clicks c JOIN sales s ON s.em = c.em
       AND s.created_at >= c.click_at AND s.created_at < c.click_at + interval '72 hours'
  )
  SELECT jsonb_build_object(
    'emails', (SELECT n FROM sent),
    'sales', (SELECT count(*) FROM attributed),
    'revenue', round(COALESCE((SELECT sum(net) FROM attributed), 0)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$function$;
