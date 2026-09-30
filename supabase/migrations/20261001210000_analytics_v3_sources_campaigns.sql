-- Analytics v3, phase 2 — onglets Sources et Campagnes.
--
--   get_analytics_sources   : tunnel (page club → page soirée → billet choisi →
--                             checkout → payé → scanné), tableau par source
--                             (visites, acheteurs, conversion, CA, CA par
--                             visiteur), « ce que Yuno t'a apporté ».
--   get_analytics_campaigns : par campagne email et push — envoyés, délivrés,
--                             clics, commandes et CA attribués à 3 et 7 jours
--                             après le clic (ouvertures = partiel).
--
-- Vocabulaire commun des sources (ventes ET visites) : promoter · email ·
-- instagram · tiktok · facebook · whatsapp · meta_ads · partner · link ·
-- promo_code · marketplace · social · search · referral · direct.

-- La source d'une visite (visitor_sessions), dans le vocabulaire commun.
CREATE OR REPLACE FUNCTION public.attribution_from_session(p_referrer_category text, p_referrer_domain text, p_utm_source text, p_utm_medium text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_utm_medium, '')) = 'paid_social' OR lower(coalesce(p_utm_source, '')) IN ('meta', 'meta_ads', 'facebook_ads') THEN 'meta_ads'
    WHEN lower(coalesce(p_utm_medium, '')) IN ('party_link', 'coorg') THEN 'partner'
    WHEN lower(coalesce(p_utm_source, '')) IN ('newsletter', 'email', 'mail') OR lower(coalesce(p_utm_medium, '')) IN ('email', 'newsletter') OR p_referrer_category = 'email' THEN 'email'
    WHEN lower(coalesce(p_utm_source, '')) IN ('instagram', 'tiktok', 'facebook', 'whatsapp') THEN lower(p_utm_source)
    WHEN nullif(p_utm_source, '') IS NOT NULL THEN 'link'
    WHEN p_referrer_category = 'internal' THEN 'marketplace'
    WHEN p_referrer_category = 'paid_social' THEN 'meta_ads'
    WHEN p_referrer_category = 'social' THEN CASE
      WHEN p_referrer_domain ILIKE '%instagram%' THEN 'instagram'
      WHEN p_referrer_domain ILIKE '%tiktok%' THEN 'tiktok'
      WHEN p_referrer_domain ILIKE '%facebook%' OR p_referrer_domain ILIKE 'fb.%' THEN 'facebook'
      WHEN p_referrer_domain ILIKE '%whatsapp%' THEN 'whatsapp'
      ELSE 'social' END
    WHEN p_referrer_category IN ('search', 'referral') THEN p_referrer_category
    ELSE 'direct' END
$$;

CREATE OR REPLACE FUNCTION public.get_analytics_sources(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g        record;
  v_ids    uuid[];
  v_now    timestamptz := now();
  v_from   timestamptz;
  v_to     timestamptz;
  v_funnel jsonb;
  v_rows   jsonb;
  v_yuno   jsonb;
  v_totals jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Fenêtre des visites : la période, ou pour une soirée de sa publication (ou 60 j avant) à sa fin.
  IF p_event_id IS NOT NULL THEN
    SELECT coalesce(e.published_at, e.start_at - interval '60 days'), coalesce(e.end_at, e.start_at + interval '8 hours')
      INTO v_from, v_to FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  -- ── Tunnel ────────────────────────────────────────────────────────────────
  WITH club_views AS (
    SELECT count(DISTINCT s.session_id)::int AS n
      FROM public.visitor_sessions s
     WHERE s.visited_at BETWEEN v_from AND v_to
       AND s.entry_page_type IN ('venue_page', 'organizer_profile')
       AND ((g.scope_venue IS NOT NULL AND s.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND s.organizer_user_id = g.scope_org))
  ),
  -- Les étapes du tunnel se comptent en SESSIONS du tunnel (même espace d'ids que
  -- les étapes suivantes) ; sans tunnel, on retombe sur les visites de la page.
  ev_views AS (
    SELECT greatest(
      (SELECT count(DISTINCT f.session_id) FROM public.event_funnel_events f WHERE f.event_id = ANY(v_ids) AND f.step = 'viewed'),
      (SELECT count(DISTINCT s.session_id) FROM public.visitor_sessions s WHERE s.event_id = ANY(v_ids)))::int AS n
  ),
  steps AS (
    SELECT f.step, count(DISTINCT f.session_id)::int AS n
      FROM public.event_funnel_events f WHERE f.event_id = ANY(v_ids) AND f.step IN ('selected', 'checkout', 'payment', 'purchased')
     GROUP BY f.step
  ),
  -- Payé et scanné se comptent en COMMANDES (billets, tables), comme les étapes d'avant.
  paid AS (
    SELECT (SELECT count(*) FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used'))
         + (SELECT count(*) FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')) AS n
  ),
  scanned AS (
    SELECT (SELECT count(*) FROM public.tickets t WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
              AND (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used'))
         + (SELECT count(*) FROM public.table_reservations r WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
              AND (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)) AS n
  )
  SELECT jsonb_build_array(
    jsonb_build_object('step', 'club_page', 'n', (SELECT n FROM club_views)),
    jsonb_build_object('step', 'event_page', 'n', (SELECT n FROM ev_views)),
    jsonb_build_object('step', 'selected', 'n', coalesce((SELECT n FROM steps WHERE step = 'selected'), 0)),
    jsonb_build_object('step', 'checkout', 'n', coalesce((SELECT n FROM steps WHERE step = 'checkout'), 0)),
    jsonb_build_object('step', 'paid', 'n', (SELECT n FROM paid)),
    jsonb_build_object('step', 'scanned', 'n', (SELECT n FROM scanned)))
    INTO v_funnel;

  -- ── Par source : visites ET ventes nommées pareil ────────────────────────
  WITH visits AS (
    SELECT public.attribution_from_session(s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium) AS source,
           count(DISTINCT s.session_id)::int AS sessions,
           count(DISTINCT coalesce(nullif(s.visitor_id, ''), s.session_id))::int AS visitors
      FROM public.visitor_sessions s
     WHERE s.event_id = ANY(v_ids)
     GROUP BY 1
  ),
  sales AS (
    SELECT coalesce(x.source, 'direct') AS source, count(*)::int AS orders, count(DISTINCT x.email)::int AS buyers,
           round(sum(x.amount), 2) AS revenue, sum(x.units)::int AS tickets
      FROM (
        SELECT t.attribution_source AS source, lower(trim(t.user_email)) AS email, greatest(coalesce(t.quantity, 1), 1) AS units,
               CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                    THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                       - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount
          FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used')
        UNION ALL
        SELECT r.attribution_source, lower(trim(r.user_email)), 0,
               CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                    THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                       - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END
          FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed')
      ) x
     GROUP BY 1
  ),
  gl AS (
    SELECT coalesce(x.attribution_source, 'direct') AS source, count(*)::int AS signups
      FROM public.guest_list_entries x JOIN public.guest_lists l ON l.id = x.guest_list_id
     WHERE l.event_id = ANY(v_ids) AND x.status IS DISTINCT FROM 'cancelled'
     GROUP BY 1
  ),
  all_sources AS (
    SELECT source FROM visits UNION SELECT source FROM sales UNION SELECT source FROM gl
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'source', a.source,
        'sessions', coalesce(v.sessions, 0), 'visitors', coalesce(v.visitors, 0),
        'orders', coalesce(s.orders, 0), 'buyers', coalesce(s.buyers, 0), 'tickets', coalesce(s.tickets, 0), 'signups', coalesce(gl.signups, 0),
        'revenue', CASE WHEN g.money THEN coalesce(s.revenue, 0) END,
        'conversion', CASE WHEN coalesce(v.visitors, 0) >= 10 THEN round(100.0 * coalesce(s.buyers, 0) / v.visitors, 1) END,
        'revenue_per_visitor', CASE WHEN g.money AND coalesce(v.visitors, 0) >= 10 THEN round(coalesce(s.revenue, 0) / v.visitors, 2) END
      ) ORDER BY coalesce(s.revenue, 0) DESC, coalesce(s.orders, 0) DESC, coalesce(v.sessions, 0) DESC)
      FROM all_sources a LEFT JOIN visits v ON v.source = a.source LEFT JOIN sales s ON s.source = a.source LEFT JOIN gl ON gl.source = a.source), '[]'::jsonb),
    jsonb_build_object(
      'sessions', (SELECT coalesce(sum(sessions), 0) FROM visits), 'visitors', (SELECT coalesce(sum(visitors), 0) FROM visits),
      'orders', (SELECT coalesce(sum(orders), 0) FROM sales), 'buyers', (SELECT coalesce(sum(buyers), 0) FROM sales),
      'revenue', CASE WHEN g.money THEN (SELECT round(coalesce(sum(revenue), 0), 2) FROM sales) END,
      'signups', (SELECT coalesce(sum(signups), 0) FROM gl))
    INTO v_rows, v_totals;

  -- ── Ce que Yuno t'a apporté : ventes venues de la marketplace, et nouveaux clients parmi elles ──
  WITH mk AS (
    SELECT lower(trim(t.user_email)) AS email, coalesce(t.paid_at, t.created_at) AS at_ts, t.event_id,
           CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                THEN greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                   - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) ELSE 0 END AS amount
      FROM public.tickets t JOIN public.events e ON e.id = t.event_id
     WHERE t.event_id = ANY(v_ids) AND t.status IN ('paid', 'used') AND t.attribution_source = 'marketplace'
    UNION ALL
    SELECT lower(trim(r.user_email)), coalesce(r.paid_at, r.created_at), r.event_id,
           CASE WHEN g.money AND (g.scope_venue IS NULL OR e.venue_id = g.scope_venue)
                THEN greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                   - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)) ELSE 0 END
      FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
     WHERE r.event_id = ANY(v_ids) AND r.status IN ('paid', 'confirmed') AND r.attribution_source = 'marketplace'
  ),
  firsts AS (
    SELECT DISTINCT p.email, p.first_event FROM public._an3_people(g.scope_ids, g.scope_venue) p WHERE p.email IN (SELECT email FROM mk)
  )
  SELECT jsonb_build_object(
    'orders', count(*), 'buyers', count(DISTINCT mk.email),
    'revenue', CASE WHEN g.money THEN round(coalesce(sum(mk.amount), 0), 2) END,
    'new_customers', count(DISTINCT mk.email) FILTER (WHERE f.first_event = mk.event_id),
    'visits', (SELECT coalesce(sum(1), 0) FROM public.visitor_sessions s WHERE s.event_id = ANY(v_ids) AND public.attribution_from_session(s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium) = 'marketplace'))
    INTO v_yuno
    FROM mk LEFT JOIN firsts f ON f.email = mk.email;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'nights', cardinality(v_ids), 'from', v_from, 'to', v_to,
    'funnel', v_funnel, 'sources', v_rows, 'totals', v_totals, 'yuno', v_yuno);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_sources(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_sources(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;

-- ── Campagnes ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_analytics_campaigns(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g       record;
  v_ids   uuid[];
  v_now   timestamptz := now();
  v_from  timestamptz;
  v_to    timestamptz;
  v_email jsonb;
  v_push  jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT coalesce(e.published_at, e.start_at - interval '60 days'), coalesce(e.end_at, e.start_at + interval '8 hours') INTO v_from, v_to FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  -- Les ventes de la portée (sujet) : une ligne par vente payée, avec email et user.
  WITH sales AS MATERIALIZED (
    SELECT p.email, p.user_id, p.at_ts, p.amount, p.event_id
      FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND (p_event_id IS NULL OR p.event_id = p_event_id)
       AND p.at_ts BETWEEN v_from AND v_to + interval '7 days'
  ),
  camps AS (
    SELECT c.id, c.name, c.subject, c.sent_at, c.event_id, coalesce(c.recipients_count, c.total_recipients, 0) AS sent,
           coalesce(c.delivered_count, 0) AS delivered, coalesce(c.opens_count, 0) AS opens, coalesce(c.clicks_count, 0) AS clicks,
           coalesce(c.clickers_count, 0) AS clickers, c.automation_id IS NOT NULL AS automated
      FROM public.email_campaigns c
     WHERE c.sent_at IS NOT NULL AND c.status IN ('sent', 'completed', 'done', 'sending', 'paused')
       AND coalesce(c.type, 'promotional') = 'promotional'
       AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND ((p_event_id IS NOT NULL AND (c.event_id = p_event_id OR c.automation_trigger_event_id = p_event_id))
            OR (p_event_id IS NULL AND c.sent_at BETWEEN v_from AND v_to))
  ),
  clicks AS (
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS first_click
      FROM public.email_campaign_events ev JOIN camps c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' GROUP BY 1, 2
  ),
  attributed AS (
    SELECT k.campaign_id,
           count(DISTINCT s.email) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days') AS buyers_3d,
           count(*) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days') AS orders_3d,
           round(sum(s.amount) FILTER (WHERE s.at_ts <= k.first_click + interval '3 days'), 2) AS revenue_3d,
           count(DISTINCT s.email) AS buyers_7d, count(*) AS orders_7d, round(sum(s.amount), 2) AS revenue_7d
      FROM clicks k JOIN sales s ON s.email = k.email AND s.at_ts > k.first_click AND s.at_ts <= k.first_click + interval '7 days'
     GROUP BY k.campaign_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'subject', c.subject, 'sent_at', c.sent_at, 'event_id', c.event_id, 'automated', c.automated,
    'sent', c.sent, 'delivered', c.delivered, 'opens', c.opens, 'clicks', c.clicks, 'clickers', c.clickers,
    'click_rate', CASE WHEN c.delivered >= 20 THEN round(100.0 * c.clickers / c.delivered, 1) END,
    'open_rate_partial', CASE WHEN c.delivered >= 20 THEN round(100.0 * least(c.opens, c.delivered) / c.delivered, 1) END,
    'orders_3d', coalesce(a.orders_3d, 0), 'buyers_3d', coalesce(a.buyers_3d, 0), 'revenue_3d', CASE WHEN g.money THEN coalesce(a.revenue_3d, 0) END,
    'orders_7d', coalesce(a.orders_7d, 0), 'buyers_7d', coalesce(a.buyers_7d, 0), 'revenue_7d', CASE WHEN g.money THEN coalesce(a.revenue_7d, 0) END
  ) ORDER BY c.sent_at DESC), '[]'::jsonb)
    INTO v_email FROM camps c LEFT JOIN attributed a ON a.campaign_id = c.id;

  WITH sales AS MATERIALIZED (
    SELECT p.email, p.user_id, p.at_ts, p.amount FROM public._an3_people(g.scope_ids, g.scope_venue) p
     WHERE p.pillar IN ('tickets', 'tables') AND p.user_id IS NOT NULL AND (p_event_id IS NULL OR p.event_id = p_event_id)
       AND p.at_ts BETWEEN v_from AND v_to + interval '7 days'
  ),
  pc AS (
    SELECT c.id, c.title, coalesce(c.scheduled_at, c.created_at) AS sent_at, c.event_id, c.source, coalesce(c.targeted_count, 0) AS targeted,
           coalesce(c.sent_count, 0) AS sent
      FROM public.push_campaigns c
     WHERE c.status IN ('sent', 'completed', 'done')
       AND ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND ((p_event_id IS NOT NULL AND c.event_id = p_event_id) OR (p_event_id IS NULL AND coalesce(c.scheduled_at, c.created_at) BETWEEN v_from AND v_to))
  ),
  taps AS (
    SELECT ev.campaign_id, ev.user_id, min(ev.created_at) AS first_tap
      FROM public.push_campaign_events ev JOIN pc ON pc.id = ev.campaign_id
     WHERE ev.event_type IN ('clicked', 'opened') AND ev.user_id IS NOT NULL GROUP BY 1, 2
  ),
  attributed AS (
    SELECT t.campaign_id,
           count(*) FILTER (WHERE s.at_ts <= t.first_tap + interval '3 days') AS orders_3d,
           round(sum(s.amount) FILTER (WHERE s.at_ts <= t.first_tap + interval '3 days'), 2) AS revenue_3d,
           count(*) AS orders_7d, round(sum(s.amount), 2) AS revenue_7d
      FROM taps t JOIN sales s ON s.user_id = t.user_id AND s.at_ts > t.first_tap AND s.at_ts <= t.first_tap + interval '7 days'
     GROUP BY t.campaign_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'title', pc.title, 'sent_at', pc.sent_at, 'event_id', pc.event_id, 'automated', pc.source = 'auto',
    'targeted', pc.targeted, 'sent', pc.sent, 'taps', coalesce((SELECT count(*) FROM taps t WHERE t.campaign_id = pc.id), 0),
    'orders_3d', coalesce(a.orders_3d, 0), 'revenue_3d', CASE WHEN g.money THEN coalesce(a.revenue_3d, 0) END,
    'orders_7d', coalesce(a.orders_7d, 0), 'revenue_7d', CASE WHEN g.money THEN coalesce(a.revenue_7d, 0) END
  ) ORDER BY pc.sent_at DESC), '[]'::jsonb)
    INTO v_push FROM pc LEFT JOIN attributed a ON a.campaign_id = pc.id;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'from', v_from, 'to', v_to, 'email', v_email, 'push', v_push);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_campaigns(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_campaigns(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;
