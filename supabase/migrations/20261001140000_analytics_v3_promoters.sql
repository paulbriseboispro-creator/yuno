-- Analytics v3 — onglet Promoteurs (phase 1).
--
-- Un promoteur = clics sur SES liens, commandes attribuées (promoter_conversions),
-- billets, ventes attribuées (valeur faciale hors frais Yuno, jamais « CA »),
-- conversion, présence de SES clients, part de nouveaux clients apportés,
-- commission due / payée. Les deux colonnes de qualité (présence, nouveaux)
-- empêchent de « vendre des billets qui ne viennent pas ».

CREATE OR REPLACE FUNCTION public.get_analytics_promoters(
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
  v_rows  jsonb;
  v_tot   jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_ids := public._an3_subject_ids(g.scope_ids, g.tz, p_event_id, p_from, p_to);
  IF p_event_id IS NOT NULL AND cardinality(v_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- Fenêtre des clics : la période, ou pour une soirée les 60 jours avant sa fin.
  IF p_event_id IS NOT NULL THEN
    SELECT e.start_at - interval '60 days', coalesce(e.end_at, e.start_at + interval '8 hours') INTO v_from, v_to
      FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_to := coalesce(p_to, v_now); v_from := coalesce(p_from, v_to - interval '30 days');
  END IF;

  WITH firsts AS MATERIALIZED (
    SELECT DISTINCT p.email, p.first_event FROM public._an3_people(g.scope_ids, g.scope_venue) p
  ),
  ev AS (
    SELECT e.id, coalesce(e.end_at, e.start_at + interval '8 hours') AS end_ts
      FROM public.events e WHERE e.id = ANY(v_ids)
  ),
  conv AS (
    SELECT pc.promoter_id, pc.id, pc.event_id, pc.status, coalesce(pc.amount, 0) AS amount, coalesce(pc.commission, 0) AS commission,
           CASE WHEN pc.ticket_id IS NOT NULL THEN greatest(coalesce(t.quantity, 1), 1) ELSE 0 END AS tickets,
           CASE WHEN pc.ticket_id IS NOT NULL THEN 'tickets' WHEN pc.table_reservation_id IS NOT NULL THEN 'tables'
                WHEN pc.guest_list_entry_id IS NOT NULL THEN 'guest_list' WHEN pc.order_id IS NOT NULL THEN 'drinks' ELSE 'other' END AS pillar,
           lower(trim(coalesce(t.user_email, r.user_email, gl.email))) AS email,
           CASE WHEN pc.ticket_id IS NOT NULL THEN (coalesce(t.entry_scanned, false) OR coalesce(t.used, false) OR t.status = 'used')
                WHEN pc.table_reservation_id IS NOT NULL THEN (coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
                WHEN pc.guest_list_entry_id IS NOT NULL THEN coalesce(gl.entry_scanned, false)
                ELSE NULL END AS scanned,
           ev.end_ts <= v_now AS finished
      FROM public.promoter_conversions pc
      JOIN ev ON ev.id = pc.event_id
      LEFT JOIN public.tickets t ON t.id = pc.ticket_id
      LEFT JOIN public.table_reservations r ON r.id = pc.table_reservation_id
      LEFT JOIN public.guest_list_entries gl ON gl.id = pc.guest_list_entry_id
     WHERE pc.status IS DISTINCT FROM 'cancelled'
  ),
  -- Une soirée « scannée » = au moins une entrée à la porte : sans scan, absent ne veut pas dire pas venu.
  scanned_events AS (
    SELECT n.event_id FROM public._an3_nights(v_ids, g.scope_venue, g.money) n WHERE n.end_ts <= v_now AND n.entries > 0
  ),
  clicks AS (
    SELECT tl.promoter_id, count(*)::int AS clicks, count(DISTINCT coalesce(nullif(c.visitor_id, ''), c.ip_hash, c.id::text))::int AS visitors
      FROM public.tracked_link_clicks c JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
     WHERE tl.promoter_id IS NOT NULL
       AND (tl.event_id = ANY(v_ids) OR (tl.event_id IS NULL AND c.clicked_at BETWEEN v_from AND v_to))
       AND ((g.scope_venue IS NOT NULL AND (tl.venue_id = g.scope_venue OR tl.event_id = ANY(v_ids)))
            OR (g.scope_org IS NOT NULL AND (tl.organizer_user_id = g.scope_org OR tl.event_id = ANY(v_ids))))
     GROUP BY tl.promoter_id
  ),
  per AS (
    SELECT pr.id, trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) AS name, pr.promo_code, pr.is_active, pr.agency_id,
           coalesce(cl.clicks, 0) AS clicks, coalesce(cl.visitors, 0) AS visitors,
           count(cv.id)::int AS orders,
           coalesce(sum(cv.tickets), 0)::int AS tickets,
           count(cv.id) FILTER (WHERE cv.pillar = 'tables')::int AS tables,
           count(cv.id) FILTER (WHERE cv.pillar = 'guest_list')::int AS guest_list,
           round(sum(cv.amount), 2) AS attributed,
           round(sum(cv.commission) FILTER (WHERE cv.status IN ('pending', 'approved', 'disputed')), 2) AS commission_due,
           round(sum(cv.commission) FILTER (WHERE cv.status = 'paid'), 2) AS commission_paid,
           count(cv.id) FILTER (WHERE cv.scanned IS NOT NULL AND cv.event_id IN (SELECT event_id FROM scanned_events))::int AS judged,
           count(cv.id) FILTER (WHERE cv.scanned AND cv.event_id IN (SELECT event_id FROM scanned_events))::int AS present,
           count(DISTINCT cv.email) FILTER (WHERE cv.email IS NOT NULL)::int AS people,
           count(DISTINCT cv.email) FILTER (WHERE cv.email IS NOT NULL AND f.first_event = cv.event_id)::int AS new_people
      FROM public.promoters pr
      LEFT JOIN conv cv ON cv.promoter_id = pr.id
      LEFT JOIN firsts f ON f.email = cv.email
      LEFT JOIN clicks cl ON cl.promoter_id = pr.id
     WHERE ((g.scope_venue IS NOT NULL AND pr.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND pr.organizer_user_id = g.scope_org)
            OR cv.id IS NOT NULL)
     GROUP BY pr.id, pr.first_name, pr.last_name, pr.promo_code, pr.is_active, pr.agency_id, cl.clicks, cl.visitors
  )
  SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', per.id, 'name', nullif(per.name, ''), 'promo_code', per.promo_code, 'active', per.is_active, 'agency_id', per.agency_id,
      'clicks', per.clicks, 'visitors', per.visitors, 'orders', per.orders, 'tickets', per.tickets, 'tables', per.tables, 'guest_list', per.guest_list,
      'attributed', CASE WHEN g.money THEN per.attributed END,
      'conversion', CASE WHEN per.clicks >= 10 THEN round(100.0 * per.orders / per.clicks, 1) END,
      'attendance', CASE WHEN per.judged >= 5 THEN round(100.0 * per.present / per.judged, 1) END,
      'judged', per.judged, 'present', per.present,
      'new_share', CASE WHEN per.people >= 5 THEN round(100.0 * per.new_people / per.people, 1) END,
      'people', per.people, 'new_people', per.new_people,
      'commission_due', CASE WHEN g.money THEN per.commission_due END,
      'commission_paid', CASE WHEN g.money THEN per.commission_paid END
    ) ORDER BY coalesce(per.attributed, 0) DESC, per.orders DESC, per.clicks DESC)
      FROM per WHERE per.orders > 0 OR per.clicks > 0), '[]'::jsonb),
    jsonb_build_object(
      'promoters', (SELECT count(*) FROM per WHERE per.orders > 0 OR per.clicks > 0),
      'clicks', (SELECT coalesce(sum(clicks), 0) FROM per),
      'orders', (SELECT coalesce(sum(orders), 0) FROM per),
      'tickets', (SELECT coalesce(sum(tickets), 0) FROM per),
      'attributed', CASE WHEN g.money THEN (SELECT round(coalesce(sum(attributed), 0), 2) FROM per) END,
      'commission_due', CASE WHEN g.money THEN (SELECT round(coalesce(sum(commission_due), 0), 2) FROM per) END,
      'present', (SELECT coalesce(sum(present), 0) FROM per), 'judged', (SELECT coalesce(sum(judged), 0) FROM per))
    INTO v_rows, v_tot;

  RETURN jsonb_build_object('ok', true, 'money', g.money, 'nights', cardinality(v_ids), 'from', v_from, 'to', v_to,
                            'promoters', v_rows, 'totals', v_tot);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_promoters(text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_promoters(text, uuid, uuid, timestamptz, timestamptz) TO authenticated;
