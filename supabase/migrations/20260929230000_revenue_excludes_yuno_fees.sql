-- Un revenu affiché = net des frais Yuno.
--
-- Règle : tout chiffre présenté à un club, un organisateur, une agence ou un
-- promoteur comme CA, revenu ou gain est le « CA club » de src/utils/fees.ts —
-- billets total_price − service_fee − insurance_fee ; tables total_price −
-- service_fee − (fee_absorbed ? management_fee : 0) ; boissons total −
-- service_fee ; remboursement déduit (plafonné à la part du club).
--
-- Les RPC ci-dessous sommaient encore le BRUT payé par le client (frais de
-- service, assurance comprise) : liens suivis (club, orga, promoteur, DJ),
-- audience DJ, rapport SMS, ventes attribuées aux pubs Meta, « CA généré » de
-- l'analyse guest list. Et la vue d'entrepôt des tables retirait les frais de
-- gestion même quand le client les avait payés en plus.
--
-- Généré depuis l'état LIVE (pg_get_functiondef) : seules les expressions de
-- montant (et les statuts, alignés sur ceux de la compta : billets paid/used,
-- tables paid/confirmed, commandes paid/served) changent.

-- get_tracked_link_stats : CA club par lien (frais Yuno exclus, remboursement déduit),
-- statuts de la compta (billets paid/used, tables paid/confirmed).
CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(p_owner_kind text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_promoter_id uuid DEFAULT NULL::uuid, p_dj_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_target_kind text DEFAULT NULL::text, p_guest_list_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, code text, label text, target_kind text, event_id uuid, is_active boolean, created_at timestamp with time zone, clicks integer, conversions bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_owner_kind = 'venue' THEN
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'organizer' THEN
    IF p_organizer_user_id IS NULL OR p_organizer_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'promoter' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'dj' THEN
    IF NOT EXISTS (SELECT 1 FROM public.djs d WHERE d.id = p_dj_id AND d.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid owner_kind';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT tl.* FROM public.tracked_links tl
    WHERE tl.owner_kind = p_owner_kind
      AND ( (p_owner_kind = 'venue'     AND tl.venue_id = p_venue_id)
         OR (p_owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id)
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id)
         OR (p_owner_kind = 'dj'        AND tl.dj_id = p_dj_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
      AND (p_target_kind IS NULL OR tl.target_kind = p_target_kind)
      AND (p_guest_list_id IS NULL OR tl.guest_list_id = p_guest_list_id)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT t.tracked_link_id, (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amt
        FROM public.tickets t WHERE t.tracked_link_id IS NOT NULL AND t.status IN ('paid','used')
      UNION ALL
      SELECT r.tracked_link_id, (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amt
        FROM public.table_reservations r WHERE r.tracked_link_id IS NOT NULL AND r.status IN ('paid','confirmed')
      UNION ALL
      SELECT o.tracked_link_id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amt
        FROM public.orders o WHERE o.tracked_link_id IS NOT NULL AND o.status IN ('paid','served')
      UNION ALL
      -- Une inscription guest list est gratuite : elle compte comme conversion,
      -- jamais comme chiffre d'affaires.
      SELECT tracked_link_id, 0::numeric   AS amt FROM public.guest_list_entries WHERE tracked_link_id IS NOT NULL AND status <> 'cancelled'
    ) all_conv
    GROUP BY tracked_link_id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0), coalesce(conv.rev, 0)
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  ORDER BY l.created_at DESC;
END; $function$;

-- get_dj_audience : CA club par lien (frais Yuno exclus, remboursement déduit),
-- statuts de la compta (billets paid/used, tables paid/confirmed).
CREATE OR REPLACE FUNCTION public.get_dj_audience()
 RETURNS TABLE(event_id uuid, event_title text, start_at timestamp with time zone, poster_url text, location_name text, link_code text, clicks integer, conversions bigint, revenue numeric, gl_id uuid, gl_share_token text, gl_quota integer, gl_signups bigint, gl_scanned bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- The RETURNS TABLE output names (event_id, gl_id, ...) are also visible as
-- plpgsql variables in the body, so unqualified column refs are ambiguous.
-- use_column makes any ambiguity resolve to the column, not the OUT variable.
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  r record;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Garantir un lien tracke par (event, fiche) — idempotent (belt-and-suspenders
  -- au cas ou un trigger aurait manque un line-up).
  FOR r IN
    SELECT DISTINCT x.event_id, x.dj_id FROM (
      SELECT ed.event_id, ed.dj_id
      FROM public.event_djs ed
      JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_uid
      JOIN public.events e ON e.id = ed.event_id
      WHERE e.is_active = true AND e.end_at >= now()
      UNION
      SELECT ds.event_id, ds.dj_id
      FROM public.dj_sets ds
      JOIN public.djs d    ON d.id = ds.dj_id AND d.user_id = v_uid
      JOIN public.events e ON e.id = ds.event_id
      WHERE ds.event_id IS NOT NULL AND e.is_active = true AND e.end_at >= now()
    ) x
  LOOP
    PERFORM public.seed_dj_event_tracked_link(r.event_id, r.dj_id);
  END LOOP;

  RETURN QUERY
  WITH dj_ids AS (
    SELECT id FROM public.djs WHERE user_id = v_uid
  ),
  ev AS (
    SELECT DISTINCT e.id AS event_id
    FROM public.events e
    WHERE e.is_active = true AND e.end_at >= now()
      AND (
        EXISTS (SELECT 1 FROM public.event_djs ed JOIN dj_ids di ON di.id = ed.dj_id WHERE ed.event_id = e.id)
        OR EXISTS (SELECT 1 FROM public.dj_sets ds  JOIN dj_ids di ON di.id = ds.dj_id WHERE ds.event_id = e.id)
      )
  ),
  -- un seul lien DJ par event parmi les fiches du caller (le plus recent)
  link AS (
    SELECT DISTINCT ON (tl.event_id)
           tl.event_id, tl.id AS link_id, tl.code, tl.clicks_count
    FROM public.tracked_links tl
    JOIN dj_ids di ON di.id = tl.dj_id
    WHERE tl.owner_kind = 'dj' AND tl.event_id IN (SELECT ev.event_id FROM ev)
    ORDER BY tl.event_id, tl.created_at DESC
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT t.tracked_link_id, (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amt
        FROM public.tickets t WHERE t.tracked_link_id IS NOT NULL AND t.status IN ('paid','used')
      UNION ALL
      SELECT r.tracked_link_id, (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amt
        FROM public.table_reservations r WHERE r.tracked_link_id IS NOT NULL AND r.status IN ('paid','confirmed')
      UNION ALL
      SELECT o.tracked_link_id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amt
        FROM public.orders o WHERE o.tracked_link_id IS NOT NULL AND o.status IN ('paid','served')
    ) all_conv
    GROUP BY tracked_link_id
  ),
  -- la guest list DJ pour cet event parmi les fiches du caller
  gl AS (
    SELECT DISTINCT ON (g.event_id)
           g.event_id, g.id AS gl_id, g.share_token, g.quota
    FROM public.guest_lists g
    JOIN dj_ids di ON di.id = g.dj_id
    WHERE g.dj_id IS NOT NULL AND g.is_active = true AND g.event_id IN (SELECT ev.event_id FROM ev)
    ORDER BY g.event_id, g.created_at DESC
  ),
  gle AS (
    SELECT e.guest_list_id,
           count(*) FILTER (WHERE e.status <> 'cancelled')::bigint AS signups,
           count(*) FILTER (WHERE e.entry_scanned)::bigint         AS scanned
    FROM public.guest_list_entries e
    WHERE e.guest_list_id IN (SELECT gl.gl_id FROM gl)
    GROUP BY e.guest_list_id
  )
  SELECT
    e.id, e.title, e.start_at, e.poster_url,
    COALESCE(v.name, e.location_name) AS location_name,
    link.code, COALESCE(link.clicks_count, 0),
    COALESCE(conv.c, 0), COALESCE(conv.rev, 0),
    gl.gl_id, gl.share_token, gl.quota,
    COALESCE(gle.signups, 0), COALESCE(gle.scanned, 0)
  FROM ev
  JOIN public.events e ON e.id = ev.event_id
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN link ON link.event_id = ev.event_id
  LEFT JOIN conv ON conv.tracked_link_id = link.link_id
  LEFT JOIN gl   ON gl.event_id = ev.event_id
  LEFT JOIN gle  ON gle.guest_list_id = gl.gl_id
  ORDER BY e.start_at ASC NULLS LAST;
END; $function$;

-- get_sms_campaign_report : ventes attribuées en CA club.
CREATE OR REPLACE FUNCTION public.get_sms_campaign_report(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.sms_campaigns%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.sms_scope_allowed(c.venue_id, c.organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH r AS (
    SELECT * FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id
  ),
  counts AS (
    SELECT
      count(*)                                                    AS total,
      count(*) FILTER (WHERE status = 'pending')                  AS pending,
      count(*) FILTER (WHERE status = 'sending')                  AS sending,
      count(*) FILTER (WHERE status IN ('sent','delivered','undelivered')) AS sent,
      count(*) FILTER (WHERE status = 'delivered')                AS delivered,
      count(*) FILTER (WHERE status = 'undelivered')              AS undelivered,
      count(*) FILTER (WHERE status = 'failed')                   AS failed,
      count(*) FILTER (WHERE status = 'skipped')                  AS skipped,
      COALESCE(sum(credits) FILTER (WHERE status IN ('sent','delivered','undelivered','failed')), 0) AS credits
    FROM r
  ),
  clicks AS (
    SELECT count(*) AS n, count(DISTINCT COALESCE(visitor_id, ip_hash, id::text)) AS uniq
      FROM public.tracked_link_clicks tc
     WHERE c.tracked_link_id IS NOT NULL
       AND tc.tracked_link_id = c.tracked_link_id
       AND tc.clicked_at >= COALESCE(c.send_started_at, c.created_at)
  ),
  sales AS (
    SELECT
      (SELECT count(*) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets,
      (SELECT COALESCE(sum((greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)))), 0) FROM public.tickets t
        WHERE c.tracked_link_id IS NOT NULL AND t.tracked_link_id = c.tracked_link_id
          AND t.status = 'paid' AND t.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tickets_revenue,
      (SELECT count(*) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables,
      (SELECT COALESCE(sum((greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(tr.refund_amount, 0), 0), greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0)))), 0) FROM public.table_reservations tr
        WHERE c.tracked_link_id IS NOT NULL AND tr.tracked_link_id = c.tracked_link_id
          AND tr.status = 'paid' AND tr.created_at >= COALESCE(c.send_started_at, c.created_at)) AS tables_revenue
  ),
  timeline AS (
    SELECT date_trunc('hour', delivered_at) AS h, count(*) AS n
      FROM r WHERE delivered_at IS NOT NULL
     GROUP BY 1 ORDER BY 1
     LIMIT 72
  )
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'status', c.status::text, 'paused_reason', c.paused_reason,
    'error_message', c.error_message, 'body_template', c.body_template, 'sender_name', c.sender_name,
    'segment_filters', c.segment_filters, 'event_id', c.event_id,
    'scheduled_at', c.scheduled_at, 'send_started_at', c.send_started_at, 'sent_at', c.sent_at,
    'created_at', c.created_at, 'quiet_hours', c.quiet_hours,
    'segments_per_message', c.segments_per_message,
    'credits_consumed', c.credits_consumed, 'credits_refunded', c.credits_refunded,
    'tracked_link_code', (SELECT code FROM public.tracked_links WHERE tracked_links.id = c.tracked_link_id),
    'counts', (SELECT to_jsonb(counts) FROM counts),
    'clicks', (SELECT to_jsonb(clicks) FROM clicks),
    'sales',  (SELECT to_jsonb(sales) FROM sales),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('hour', h, 'delivered', n)) FROM timeline), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;

-- get_my_meta_ads : ventes attribuées au lien meta_ads en CA club (les chiffres
-- Meta, `insights`, restent ceux de Meta).
CREATE OR REPLACE FUNCTION public.get_my_meta_ads(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conn public.meta_connections%ROWTYPE;
  v_out  jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_my_meta_ads: at most one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.meta_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conn FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   LIMIT 1;

  v_out := jsonb_build_object(
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id, 'mode', v_conn.mode, 'status', v_conn.status, 'pixel_id', v_conn.pixel_id,
      'ad_account_id', v_conn.ad_account_id, 'page_id', v_conn.page_id, 'ig_user_id', v_conn.ig_user_id,
      'token_kind', v_conn.token_kind, 'assets', v_conn.assets, 'last_health', v_conn.last_health,
      'ads_ready', (v_conn.status = 'active' AND v_conn.ad_account_id IS NOT NULL AND v_conn.page_id IS NOT NULL)
    ) END,
    'audiences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'ref', a.ref, 'name', a.name, 'meta_audience_id', a.meta_audience_id,
        'lookalike_ratio', a.lookalike_ratio, 'lookalike_country', a.lookalike_country,
        'size_uploaded', a.size_uploaded, 'status', a.status, 'last_sync_at', a.last_sync_at, 'last_error', a.last_error,
        'created_at', a.created_at) ORDER BY a.created_at)
        FROM public.meta_audiences a WHERE a.connection_id = v_conn.id), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'effective_status', c.effective_status, 'objective', c.objective,
        'event_id', c.event_id, 'event_title', e.title, 'event_start_at', e.start_at, 'event_poster_url', e.poster_url,
        'budget_type', c.budget_type, 'budget_cents', c.budget_cents, 'currency', c.currency,
        'start_at', c.start_at, 'end_at', c.end_at, 'targeting', c.targeting, 'creative', c.creative, 'placements', c.placements,
        'creatives', c.creatives, 'meta_ads', c.meta_ads, 'ad_insights', c.ad_insights,
        'delivery', c.delivery, 'insight_breakdowns', c.insight_breakdowns,
        'meta_campaign_id', c.meta_campaign_id, 'meta_ad_id', c.meta_ad_id, 'review_feedback', c.review_feedback,
        'last_error', c.last_error, 'last_synced_at', c.last_synced_at, 'created_at', c.created_at,
        'tracked_code', tl.code,
        'insights', (SELECT jsonb_build_object(
            'spend_cents', COALESCE(sum(i.spend_cents), 0), 'impressions', COALESCE(sum(i.impressions), 0),
            'reach', COALESCE(max(i.reach), 0), 'clicks', COALESCE(sum(i.clicks), 0), 'link_clicks', COALESCE(sum(i.link_clicks), 0),
            'purchases', COALESCE(sum(i.purchases), 0), 'purchase_value_cents', COALESCE(sum(i.purchase_value_cents), 0),
            'leads', COALESCE(sum(i.leads), 0),
            'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'spend_cents', d.spend_cents, 'clicks', d.link_clicks, 'purchases', d.purchases) ORDER BY d.day)
                               FROM public.meta_insights_daily d WHERE d.campaign_id = c.id), '[]'::jsonb))
          FROM public.meta_insights_daily i WHERE i.campaign_id = c.id),
        'attributed', jsonb_build_object(
          'tickets', (SELECT count(*) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tickets_revenue_cents', (SELECT COALESCE(round(sum((greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)))) * 100), 0) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tables', (SELECT count(*) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'tables_revenue_cents', (SELECT COALESCE(round(sum((greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(tr.refund_amount, 0), 0), greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0)))) * 100), 0) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'orders', (SELECT count(*) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'orders_revenue_cents', (SELECT COALESCE(round(sum((greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))) * 100), 0) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'guest_list', (SELECT count(*) FROM public.guest_list_entries g WHERE g.tracked_link_id = c.tracked_link_id AND g.status <> 'cancelled'),
          'clicks', COALESCE(tl.clicks_count, 0)
        )) ORDER BY c.created_at DESC)
        FROM public.meta_campaigns c
        LEFT JOIN public.events e ON e.id = c.event_id
        LEFT JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
       WHERE c.connection_id = v_conn.id), '[]'::jsonb),
    'leads', jsonb_build_object(
      'total', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id),
      'last_30d', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.received_at >= now() - interval '30 days'),
      'pending', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.processed_at IS NULL),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.leadgen_id, 'name', r.contact_name, 'email', r.contact_email, 'received_at', r.received_at, 'processed', r.processed_at IS NOT NULL, 'error', r.error) ORDER BY r.received_at DESC)
                            FROM (SELECT * FROM public.meta_leads l WHERE l.connection_id = v_conn.id ORDER BY l.received_at DESC LIMIT 20) r), '[]'::jsonb)
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'poster_url', e.poster_url, 'city', e.location_city,
          'venue_name', COALESCE((SELECT v.name FROM public.venues v WHERE v.id = e.venue_id), e.location_name),
          'price_from', (SELECT min(tr.price) FROM public.ticket_rounds tr WHERE tr.event_id = e.id AND tr.is_active AND tr.price > 0),
          'lineup', COALESCE((
            SELECT array_to_json(array_remove(array_agg(x.n ORDER BY x.o), NULL))::jsonb FROM (
              SELECT COALESCE(NULLIF(d.stage_name, ''), NULLIF(d.first_name || ' ' || d.last_name, ' ')) AS n, 0 AS o FROM public.event_djs ed JOIN public.djs d ON d.id = ed.dj_id WHERE ed.event_id = e.id
              UNION ALL
              SELECT g.name, 1 + g.position FROM public.event_guest_artists g WHERE g.event_id = e.id
            ) x), '[]'::jsonb)
        ) ORDER BY e.start_at)
        FROM public.events e
       WHERE e.end_at >= now()
         AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id OR e.id in (select public.cohost_event_ids_venue(p_venue_id))))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id OR e.id in (select public.cohost_event_ids_org(p_organizer_user_id)))))), '[]'::jsonb),
    'segments', jsonb_build_object(
      'venue', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vs.id, 'name', vs.name) ORDER BY vs.name) FROM public.venue_segments vs WHERE p_venue_id IS NOT NULL AND vs.venue_id = p_venue_id), '[]'::jsonb),
      'contact', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name) ORDER BY cs.name) FROM public.contact_segments cs WHERE cs.venue_id IS NOT DISTINCT FROM p_venue_id AND cs.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb)
    ),
    'home', jsonb_build_object(
      'city', COALESCE((SELECT v.city FROM public.venues v WHERE v.id = p_venue_id), (SELECT op.city FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id)),
      'latitude', (SELECT v.latitude FROM public.venues v WHERE v.id = p_venue_id),
      'longitude', (SELECT v.longitude FROM public.venues v WHERE v.id = p_venue_id)
    )
  );
  RETURN v_out;
END;
$function$;

-- get_guest_list_analytics : « CA généré » par les invités (bar, VIP) et le
-- repère « billet payant » en CA club — frais Yuno exclus, remboursement déduit.
CREATE OR REPLACE FUNCTION public.get_guest_list_analytics(p_venue_id text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tz text DEFAULT 'Europe/Paris'::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.is_venue_owner(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with lists as (
    select
      gl.id,
      gl.event_id,
      gl.quota,
      gl.is_active,
      coalesce(gl.holder_type, 'venue')            as holder_type,
      coalesce(nullif(gl.holder_label, ''), '—')   as holder_label,
      gl.promoter_id,
      gl.dj_id,
      gl.entry_kind,
      gl.includes_drink,
      coalesce(
        gl.promoter_id::text,
        gl.dj_id::text,
        gl.organizer_user_id::text,
        nullif(gl.holder_label, ''),
        coalesce(gl.holder_type, 'venue')
      ) as holder_key,
      e.title      as event_title,
      e.start_at,
      e.end_at,
      -- La porte est ouverte : la présence devient mesurable.
      (e.start_at <= now()) as night_started,
      -- La soirée est fermée : le no-show est figé, plus personne n'arrivera.
      ((coalesce(e.end_at, e.start_at + interval '8 hours') + interval '2 hours') <= now()) as night_over
    from public.guest_lists gl
    join public.events e on e.id = gl.event_id
    where (
          (p_venue_id is not null and coalesce(gl.venue_id, e.venue_id, e.partner_venue_id) = p_venue_id)
       or (p_organizer_user_id is not null and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))
      )
      and (p_event_id is null or gl.event_id = p_event_id)
      -- Une liste est dans la période si sa soirée y tombe OU si elle a reçu
      -- une inscription pendant la période : les inscrits d'une soirée à venir
      -- comptent le jour où ils s'inscrivent, pas le jour de la soirée.
      and (
        ((p_from is null or e.start_at >= p_from) and (p_to is null or e.start_at <= p_to))
        or exists (
          select 1 from public.guest_list_entries x
          where x.guest_list_id = gl.id
            and x.status <> 'cancelled'
            and (p_from is null or x.created_at >= p_from)
            and (p_to   is null or x.created_at <= p_to)
        )
      )
  ),
  -- Un invité = une ligne. Identité normalisée pour le rattachement à la dépense.
  guests as (
    select
      ge.id            as entry_id,
      ge.user_id,
      lower(trim(ge.email))                              as email_norm,
      nullif(regexp_replace(coalesce(ge.phone, ''), '\D', '', 'g'), '') as phone_norm,
      ge.entry_scanned,
      ge.entry_scanned_at,
      ge.created_at,
      coalesce(nullif(ge.entry_type, ''), 'normal')      as entry_type,
      lower(coalesce(nullif(ge.gender, ''), 'unknown'))  as gender,
      l.id             as list_id,
      l.quota          as list_quota,
      l.event_id,
      l.event_title,
      l.start_at,
      l.end_at,
      l.night_started,
      l.night_over,
      l.holder_type,
      l.holder_label,
      l.holder_key,
      l.promoter_id,
      l.dj_id
    from public.guest_list_entries ge
    join lists l on l.id = ge.guest_list_id
    where ge.status <> 'cancelled'
  ),
  arrived as (
    select * from guests where entry_scanned
  ),
  -- Le no-show n'existe que sur une soirée fermée. Une soirée à venir ou en
  -- cours n'en produit aucun : ses inscrits sont « en attente ».
  no_shows as (
    select * from guests where night_over and not entry_scanned
  ),
  -- ── Dépense bar rattachée aux invités entrés ──────────────────────────────
  guest_orders as (
    select distinct on (o.id)
      o.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount
    from arrived g
    join public.orders o
      on o.venue_id = p_venue_id
     and o.status in ('paid', 'served')
     and (
          o.event_id = g.event_id
          or (o.event_id is null
              and o.created_at >= g.start_at - interval '6 hours'
              and o.created_at <= g.end_at   + interval '6 hours')
         )
     and (
          (g.user_id is not null and o.user_id = g.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(o.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by o.id, g.entry_id
  ),
  -- ── Dépense VIP (table réservée par un invité guest list) ─────────────────
  guest_tables as (
    select distinct on (r.id)
      r.id,
      g.entry_id,
      g.event_id,
      g.entry_type,
      g.gender,
      g.list_id,
      g.holder_key,
      (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) as amount
    from arrived g
    join public.table_reservations r
      on r.event_id = g.event_id
     and r.status in ('paid', 'confirmed')
     and (
          (g.user_id is not null and r.user_id = g.user_id)
          or lower(trim(coalesce(r.user_email, ''))) = g.email_norm
          or (g.phone_norm is not null
              and nullif(regexp_replace(coalesce(r.phone, r.guest_phone, ''), '\D', '', 'g'), '') = g.phone_norm)
         )
    order by r.id, g.entry_id
  ),
  -- Conso servie en table pour ces mêmes invités (bouteilles, deux sauts via la résa)
  guest_vip_items as (
    select vc.id, vc.quantity, vc.total_price, vc.item_type
    from public.vip_consumptions vc
    join guest_tables gt on gt.id = vc.table_reservation_id
  ),
  -- Dépense agrégée par invité, séparée bar / VIP pour le détail par propriétaire
  spend_per_guest as (
    select
      entry_id,
      sum(bar)         as bar,
      sum(vip)         as vip,
      sum(bar + vip)   as amount
    from (
      select entry_id, amount as bar, 0::numeric as vip from guest_orders
      union all
      select entry_id, 0::numeric, amount from guest_tables
    ) s
    group by entry_id
  ),
  -- ── Benchmark : détenteurs de billets payants entrés aux mêmes soirées ────
  paid_entrants as (
    select distinct on (tk.id)
      tk.id,
      tk.user_id,
      lower(trim(coalesce(tk.user_email, ''))) as email_norm,
      tk.event_id
    from public.tickets tk
    join (select distinct event_id from lists) l on l.event_id = tk.event_id
    where tk.status = 'paid'
      and coalesce(tk.entry_scanned, false)
      and coalesce(tk.total_price, 0) > 0
    order by tk.id
  ),
  paid_orders as (
    select distinct on (o.id) o.id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) as amount
    from paid_entrants p
    join public.orders o
      on o.venue_id = p_venue_id
     and o.event_id = p.event_id
     and o.status in ('paid', 'served')
     and (
          (p.user_id is not null and o.user_id = p.user_id)
          or lower(trim(coalesce(o.user_email, ''))) = p.email_norm
         )
    order by o.id
  ),
  -- ── Agrégats par propriétaire de liste ───────────────────────────────────
  holder_list_agg as (
    select
      holder_key,
      min(holder_type)  as holder_type,
      min(holder_label) as holder_label,
      count(*)          as lists_n,
      count(distinct event_id) as events_n,
      coalesce(sum(quota) filter (where quota is not null), 0) as quota_total,
      count(*) filter (where quota is not null) as capped_lists
    from lists
    group by holder_key
  ),
  holder_guest_agg as (
    select
      g.holder_key,
      count(*)                                       as signups,
      count(*) filter (where g.entry_scanned)        as arrived,
      count(*) filter (where not g.night_started)    as upcoming,
      count(*) filter (where g.night_started)        as started,
      count(*) filter (where g.night_over)           as settled,
      count(*) filter (where g.night_over and not g.entry_scanned) as no_show,
      count(*) filter (where g.list_quota is not null) as capped_signups,
      coalesce(sum(sp.bar), 0)                       as bar_revenue,
      coalesce(sum(sp.vip), 0)                       as vip_revenue,
      coalesce(sum(sp.amount), 0)                    as revenue,
      count(*) filter (where coalesce(sp.amount, 0) > 0) as spenders
    from guests g
    left join spend_per_guest sp on sp.entry_id = g.entry_id
    group by g.holder_key
  ),
  holder_order_agg as (
    select holder_key, count(*) as bar_orders from guest_orders group by holder_key
  ),
  holder_table_agg as (
    select holder_key, count(*) as vip_reservations from guest_tables group by holder_key
  )
  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'lists',           (select count(*) from lists),
      'active_lists',    (select count(*) from lists where is_active),
      'events',          (select count(distinct event_id) from lists),
      'upcoming_events', (select count(distinct event_id) from lists where not night_started),
      'settled_events',  (select count(distinct event_id) from lists where night_over),
      'signups',         (select count(*) from guests),
      'arrived',         (select count(*) from arrived),
      -- Inscrits en attente : leur soirée n'a pas encore ouvert ses portes.
      'upcoming',        (select count(*) from guests where not night_started),
      -- Inscrits dont la porte est ouverte (soirée en cours ou terminée).
      'started',         (select count(*) from guests where night_started),
      -- Inscrits dont la soirée est fermée : la seule base du no-show.
      'settled',         (select count(*) from guests where night_over),
      'no_show',         (select count(*) from no_shows),
      'no_show_rate',    coalesce((select round((select count(*) from no_shows)::numeric * 100
                                    / nullif(count(*), 0), 1) from guests where night_over), 0),
      'show_rate',       coalesce((select round((count(*) filter (where entry_scanned))::numeric * 100
                                    / nullif(count(*), 0), 1) from guests where night_started), 0),
      -- Rappel : quota NULL = illimité → exclu du calcul de remplissage
      'quota_total',     coalesce((select sum(quota) from lists where quota is not null), 0),
      'capped_lists',    (select count(*) from lists where quota is not null),
      'unlimited_lists', (select count(*) from lists where quota is null),
      'fill_rate',       coalesce((
        select round(count(g.entry_id)::numeric * 100 / nullif(sum_q.q, 0), 1)
        from guests g
        join lists l on l.id = g.list_id and l.quota is not null
        cross join (select sum(quota)::numeric q from lists where quota is not null) sum_q
        group by sum_q.q), 0)
    ),
    'spend', jsonb_build_object(
      'bar_revenue',       coalesce((select sum(amount) from guest_orders), 0),
      'vip_revenue',       coalesce((select sum(amount) from guest_tables), 0),
      'total_revenue',     coalesce((select sum(amount) from spend_per_guest), 0),
      'bar_orders',        (select count(*) from guest_orders),
      'vip_reservations',  (select count(*) from guest_tables),
      'bottles',           coalesce((select sum(quantity) from guest_vip_items where item_type = 'bottle'), 0),
      'guests_with_spend', (select count(*) from spend_per_guest where amount > 0),
      'conversion_rate',   coalesce((
        select round((select count(*) from spend_per_guest where amount > 0)::numeric * 100
               / nullif((select count(*) from arrived), 0), 1)), 0),
      -- La métrique qui justifie la guest list : ce que rapporte un invité entré
      'avg_per_arrived',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'avg_per_spender',   coalesce((
        select round(avg(amount)::numeric, 2) from spend_per_guest where amount > 0), 0),
      -- Ce que « coûte » un no-show : place bloquée, zéro consommation. Sur
      -- soirées fermées uniquement — une place encore à venir n'est pas perdue.
      'lost_value',        coalesce((
        select round(
          coalesce((select sum(amount) from spend_per_guest), 0)
          / nullif((select count(*) from arrived), 0)
          * (select count(*) from no_shows), 2)), 0)
    ),
    'benchmark', jsonb_build_object(
      'guest_avg',   coalesce((
        select round(coalesce((select sum(amount) from spend_per_guest), 0)
               / nullif((select count(*) from arrived), 0), 2)), 0),
      'ticket_avg',  coalesce((
        select round(coalesce((select sum(amount) from paid_orders), 0)
               / nullif((select count(*) from paid_entrants), 0), 2)), 0),
      'ticket_entrants', (select count(*) from paid_entrants),
      'ticket_bar_revenue', coalesce((select sum(amount) from paid_orders), 0)
    ),
    'arrivals_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', arrivals) order by hour)
      from (
        select extract(hour from (entry_scanned_at at time zone p_tz))::int as hour,
               count(*) as arrivals
        from arrived
        where entry_scanned_at is not null
        group by 1
      ) ah), '[]'::jsonb),
    'peak_hour', (
      select extract(hour from (entry_scanned_at at time zone p_tz))::int
      from arrived where entry_scanned_at is not null
      group by 1 order by count(*) desc, 1 limit 1),
    -- Délai d'inscription avant la soirée : mesure l'anticipation réelle du
    -- public. Soirées ouvertes uniquement — la présence d'une soirée à venir
    -- n'est pas encore une donnée.
    'signup_lead', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'signups', n, 'arrived', a) order by ord)
      from (
        select
          case
            when start_at - created_at >= interval '7 days'  then '7d+'
            when start_at - created_at >= interval '3 days'  then '3-7d'
            when start_at - created_at >= interval '1 day'   then '1-3d'
            when start_at - created_at >= interval '6 hours' then '6-24h'
            else '<6h'
          end as bucket,
          case
            when start_at - created_at >= interval '7 days'  then 1
            when start_at - created_at >= interval '3 days'  then 2
            when start_at - created_at >= interval '1 day'   then 3
            when start_at - created_at >= interval '6 hours' then 4
            else 5
          end as ord,
          count(*) as n,
          count(*) filter (where entry_scanned) as a
        from guests
        where night_started
        group by 1, 2
      ) sl), '[]'::jsonb),
    'by_entry_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_type', entry_type, 'signups', n, 'arrived', a, 'upcoming', upc,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.entry_type,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          count(*) filter (where not g.night_started) as upc,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.entry_type
      ) bt), '[]'::jsonb),
    'by_gender', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gender', gender, 'signups', n, 'arrived', a, 'upcoming', upc,
        'no_show_rate', nsr, 'revenue', rev, 'avg_per_arrived', apa) order by n desc)
      from (
        select
          g.gender,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          count(*) filter (where not g.night_started) as upc,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.gender
      ) bg), '[]'::jsonb),
    -- Détail complet par propriétaire de liste (alimente le menu déroulant)
    'by_holder', coalesce((
      select jsonb_agg(jsonb_build_object(
        'holder_key',      holder_key,
        'holder_type',     holder_type,
        'holder_label',    holder_label,
        'lists',           lists_n,
        'events',          events_n,
        'signups',         signups,
        'arrived',         arrived_n,
        'upcoming',        upcoming_n,
        'settled',         settled_n,
        'no_show',         no_show_n,
        'no_show_rate',    no_show_rate,
        'show_rate',       show_rate,
        'quota_total',     quota_total,
        'capped_lists',    capped_lists,
        'fill_rate',       fill_rate,
        'revenue',         revenue,
        'bar_revenue',     bar_revenue,
        'vip_revenue',     vip_revenue,
        'bar_orders',      bar_orders,
        'vip_reservations', vip_reservations,
        'spenders',        spenders,
        'conversion_rate', conversion_rate,
        'avg_per_arrived', avg_per_arrived,
        'avg_per_spender', avg_per_spender,
        'peak_hour',       peak_hour,
        'arrivals_by_hour', arrivals_by_hour,
        'by_entry_type',   by_entry_type,
        'top_event',       top_event
      ) order by revenue desc, signups desc)
      from (
        select
          hla.holder_key,
          hla.holder_type,
          hla.holder_label,
          hla.lists_n,
          hla.events_n,
          hla.quota_total,
          hla.capped_lists,
          coalesce(hga.signups, 0)      as signups,
          coalesce(hga.arrived, 0)      as arrived_n,
          coalesce(hga.upcoming, 0)     as upcoming_n,
          coalesce(hga.settled, 0)      as settled_n,
          coalesce(hga.no_show, 0)      as no_show_n,
          coalesce(hga.revenue, 0)      as revenue,
          coalesce(hga.bar_revenue, 0)  as bar_revenue,
          coalesce(hga.vip_revenue, 0)  as vip_revenue,
          coalesce(hga.spenders, 0)     as spenders,
          coalesce(hoa.bar_orders, 0)   as bar_orders,
          coalesce(hta.vip_reservations, 0) as vip_reservations,
          -- No-show : soirées fermées de ce propriétaire uniquement.
          round(coalesce(hga.no_show, 0)::numeric * 100
                / nullif(hga.settled, 0), 1) as no_show_rate,
          -- Présence : soirées dont la porte a ouvert.
          round(coalesce(hga.arrived, 0)::numeric * 100
                / nullif(hga.started, 0), 1) as show_rate,
          -- Remplissage : uniquement les listes plafonnées de ce propriétaire
          round(coalesce(hga.capped_signups, 0)::numeric * 100
                / nullif(hla.quota_total, 0), 1) as fill_rate,
          round(coalesce(hga.spenders, 0)::numeric * 100
                / nullif(hga.arrived, 0), 1) as conversion_rate,
          round(coalesce(hga.revenue, 0) / nullif(hga.arrived, 0), 2)  as avg_per_arrived,
          round(coalesce(hga.revenue, 0) / nullif(hga.spenders, 0), 2) as avg_per_spender,
          (select extract(hour from (g3.entry_scanned_at at time zone p_tz))::int
             from guests g3
            where g3.holder_key = hla.holder_key
              and g3.entry_scanned and g3.entry_scanned_at is not null
            group by 1 order by count(*) desc, 1 limit 1) as peak_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object('hour', hour, 'arrivals', n) order by hour)
            from (
              select extract(hour from (g4.entry_scanned_at at time zone p_tz))::int as hour,
                     count(*) as n
              from guests g4
              where g4.holder_key = hla.holder_key
                and g4.entry_scanned and g4.entry_scanned_at is not null
              group by 1
            ) ha), '[]'::jsonb) as arrivals_by_hour,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'entry_type', et, 'signups', n, 'arrived', a, 'revenue', rev) order by n desc)
            from (
              select g5.entry_type as et,
                     count(*) as n,
                     count(*) filter (where g5.entry_scanned) as a,
                     coalesce(sum(sp5.amount), 0) as rev
              from guests g5
              left join spend_per_guest sp5 on sp5.entry_id = g5.entry_id
              where g5.holder_key = hla.holder_key
              group by g5.entry_type
            ) et), '[]'::jsonb) as by_entry_type,
          (select jsonb_build_object(
             'event_id', ev.event_id, 'title', ev.title, 'start_at', ev.start_at,
             'signups', ev.n, 'arrived', ev.a, 'revenue', ev.rev)
             from (
               select g6.event_id,
                      min(g6.event_title) as title,
                      min(g6.start_at)    as start_at,
                      count(*) as n,
                      count(*) filter (where g6.entry_scanned) as a,
                      coalesce(sum(sp6.amount), 0) as rev
               from guests g6
               left join spend_per_guest sp6 on sp6.entry_id = g6.entry_id
               where g6.holder_key = hla.holder_key
               group by g6.event_id
               order by coalesce(sum(sp6.amount), 0) desc, count(*) desc
               limit 1
             ) ev) as top_event
        from holder_list_agg hla
        left join holder_guest_agg hga on hga.holder_key = hla.holder_key
        left join holder_order_agg hoa on hoa.holder_key = hla.holder_key
        left join holder_table_agg hta on hta.holder_key = hla.holder_key
        order by coalesce(hga.revenue, 0) desc, coalesce(hga.signups, 0) desc
        limit 30
      ) bh), '[]'::jsonb),
    'by_event', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', event_id, 'title', title, 'start_at', start_at,
        'signups', n, 'arrived', a, 'no_show_rate', nsr,
        'night_started', started, 'night_over', over_,
        'revenue', rev, 'avg_per_arrived', apa) order by start_at desc)
      from (
        select
          g.event_id,
          max(g.event_title) as title,
          max(g.start_at) as start_at,
          bool_or(g.night_started) as started,
          bool_or(g.night_over)    as over_,
          count(*) as n,
          count(*) filter (where g.entry_scanned) as a,
          round((count(*) filter (where g.night_over and not g.entry_scanned))::numeric * 100
                / nullif(count(*) filter (where g.night_over), 0), 1) as nsr,
          coalesce(sum(sp.amount), 0) as rev,
          round(coalesce(sum(sp.amount), 0) / nullif(count(*) filter (where g.entry_scanned), 0), 2) as apa
        from guests g
        left join spend_per_guest sp on sp.entry_id = g.entry_id
        group by g.event_id
        order by max(g.start_at) desc
        limit 20
      ) be), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

-- analytics_wh.table_reservations : même CA tables que fees.ts (tableRevenue).
CREATE OR REPLACE VIEW analytics_wh.table_reservations AS
 WITH d AS MATERIALIZED (
         SELECT public.demo_event_ids() AS de
        )
 SELECT r.id AS reservation_id,
    r.event_id,
    r.pack_id,
    r.zone_id,
    r.created_at,
    r.paid_at,
    r.status,
    COALESCE(r.guest_count, 1) AS guest_count,
    r.total_price,
    r.deposit,
    COALESCE(r.service_fee, (0)::numeric) AS service_fee,
    COALESCE(r.management_fee, (0)::numeric) AS management_fee,
    COALESCE(r.refund_amount, (0)::numeric) AS refund_amount,
    r.refunded_at,
    ((COALESCE(r.total_price, (0)::numeric) - COALESCE(r.service_fee, (0)::numeric)) - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, (0)::numeric) ELSE (0)::numeric END) AS club_revenue,
    COALESCE(r.payment_mode, 'online'::text) AS payment_mode,
    (COALESCE(r.entry_scanned, false) OR (r.checked_in_at IS NOT NULL)) AS entry_scanned,
    COALESCE(r.entry_scanned_at, r.checked_in_at) AS entry_scanned_at,
    r.purchase_source,
    (r.promo_code_id IS NOT NULL) AS has_promo_code,
    (r.tracked_link_id IS NOT NULL) AS has_tracked_link,
    COALESCE(r.is_guest, false) AS guest_checkout,
    analytics_wh_private.opaque_key(COALESCE((r.user_id)::text, r.user_email)) AS buyer_key
   FROM (public.table_reservations r
     CROSS JOIN d)
  WHERE ((NOT (r.event_id = ANY (d.de))) AND (NOT COALESCE(public.is_demo_email(r.user_email), false)));
