-- Analytics v3, phase 3 — les digests par email (spec §4.9).
--
--   night_recap_email_data(event)     : le bilan du lendemain, chiffres de la nuit
--                                        (mêmes formules que l'écran : _an3_nights),
--                                        meilleur promoteur, nouveaux vs habitués,
--                                        soirée comparable, destinataire.
--   weekly_digest_email_data(scope)   : l'hebdo du lundi — 7 derniers jours vs les
--                                        7 d'avant, les soirées à venir, et UN segment
--                                        actionnable (les habitués qui décrochent).
--   weekly_digest_email_targets()     : qui reçoit l'hebdo (clubs et organisateurs
--                                        réels, jamais la démo).
-- Service-role seulement : appelées par process-scheduled-campaigns. Gatées par le
-- registre /admin/notifications (email_night_recap, email_weekly_digest).

CREATE OR REPLACE FUNCTION public.night_recap_email_data(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ev record; v_scope_ids uuid[]; v_venue text; v_org uuid; v_recipient uuid; v_email text;
  n record; v_ref record; v_ref_id uuid; v_new int; v_customers int; v_promo jsonb; v_demo boolean;
BEGIN
  SELECT e.id, e.title, e.start_at, e.venue_id, e.organizer_user_id, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz
    INTO v_ev FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = p_event_id;
  IF v_ev.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_demo := p_event_id = ANY(public.demo_event_ids());
  IF v_ev.venue_id IS NOT NULL THEN
    v_venue := v_ev.venue_id;
    SELECT v.owner_id INTO v_recipient FROM public.venues v WHERE v.id = v_venue;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE x.venue_id = v_venue OR x.partner_venue_id = v_venue;
  ELSE
    v_org := v_ev.organizer_user_id; v_recipient := v_org;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE x.organizer_user_id = v_org OR x.partner_organizer_id = v_org;
  END IF;
  IF v_recipient IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_recipient'); END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_recipient;

  SELECT * INTO n FROM public._an3_nights(ARRAY[p_event_id], v_venue, true);

  SELECT c.event_id INTO v_ref_id FROM public._an3_comparables(p_event_id, v_scope_ids, 1) c LIMIT 1;
  IF v_ref_id IS NOT NULL THEN SELECT * INTO v_ref FROM public._an3_nights(ARRAY[v_ref_id], v_venue, true); END IF;

  SELECT count(DISTINCT p.email), count(DISTINCT p.email) FILTER (WHERE p.first_event = p_event_id)
    INTO v_customers, v_new FROM public._an3_people(v_scope_ids, v_venue) p WHERE p.event_id = p_event_id;

  SELECT jsonb_build_object('name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), 'orders', x.orders, 'amount', x.amount)
    INTO v_promo
    FROM (SELECT pc.promoter_id, count(*) AS orders, round(sum(coalesce(pc.amount, 0)), 2) AS amount
            FROM public.promoter_conversions pc WHERE pc.event_id = p_event_id AND pc.status IS DISTINCT FROM 'cancelled'
           GROUP BY pc.promoter_id ORDER BY 3 DESC, 2 DESC LIMIT 1) x
    JOIN public.promoters pr ON pr.id = x.promoter_id;

  RETURN jsonb_build_object(
    'ok', true, 'demo', v_demo, 'event_id', p_event_id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'tz', v_ev.tz,
    'venue_id', v_venue, 'organizer_user_id', v_org, 'recipient', v_recipient, 'recipient_email', v_email,
    'entered', n.entries, 'expected', n.expected, 'tickets', n.tickets, 'tables', n.tables, 'gl', n.gl_registered,
    'revenue', round(n.revenue, 2), 'rev_tickets', round(n.rev_tickets, 2), 'rev_tables', round(n.rev_tables, 2), 'rev_bar', round(n.rev_bar, 2),
    'per_head', CASE WHEN n.entries > 0 THEN round(n.revenue / n.entries, 2) END,
    'no_show_pct', CASE WHEN n.expected > 0 AND n.entries > 0 THEN round(100.0 * (n.expected - n.entries) / n.expected) END,
    'customers', v_customers, 'new_customers', v_new,
    'promoter', v_promo,
    'ref', CASE WHEN v_ref_id IS NULL THEN NULL ELSE jsonb_build_object('title', v_ref.title, 'start_at', v_ref.start_at, 'entered', v_ref.entries, 'revenue', round(v_ref.revenue, 2), 'tickets', v_ref.tickets) END);
END;
$$;
REVOKE ALL ON FUNCTION public.night_recap_email_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.night_recap_email_data(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_digest_email_targets()
RETURNS TABLE (subject_type text, subject_id text, recipient uuid, recipient_email text, tz text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv)
  SELECT 'venue', v.id, v.owner_id, u.email, coalesce(v.timezone, 'Europe/Paris')
    FROM public.venues v CROSS JOIN d JOIN auth.users u ON u.id = v.owner_id
   WHERE v.owner_id IS NOT NULL AND v.decommissioned_at IS NULL AND NOT (v.id = ANY(d.dv))
     AND NOT public.is_demo_email(u.email)
     AND EXISTS (SELECT 1 FROM public.events e WHERE e.venue_id = v.id AND e.start_at >= now() - interval '60 days')
  UNION ALL
  SELECT 'organizer', o.user_id::text, o.user_id, u.email, 'Europe/Paris'
    FROM public.organizer_profiles o JOIN auth.users u ON u.id = o.user_id
   WHERE NOT public.is_demo_email(u.email)
     AND EXISTS (SELECT 1 FROM public.events e WHERE e.organizer_user_id = o.user_id AND e.start_at >= now() - interval '60 days')
$$;
REVOKE ALL ON FUNCTION public.weekly_digest_email_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_digest_email_targets() TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_digest_email_data(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope_ids uuid[]; v_tz text := 'Europe/Paris'; v_now timestamptz := now();
  v_cur uuid[]; v_prev uuid[]; v_cur_agg jsonb; v_prev_agg jsonb; v_upcoming jsonb; v_at_risk int; v_pillars int; v_name text;
BEGIN
  IF p_venue_id IS NOT NULL THEN
    SELECT coalesce(v.timezone, 'Europe/Paris'), v.name INTO v_tz, v_name FROM public.venues v WHERE v.id = p_venue_id;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id;
  ELSE
    SELECT o.display_name INTO v_name FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id;
  END IF;

  v_cur := public._an3_subject_ids(v_scope_ids, v_tz, NULL, v_now - interval '7 days', v_now);
  v_prev := public._an3_subject_ids(v_scope_ids, v_tz, NULL, v_now - interval '14 days', v_now - interval '7 days');
  -- Seules les soirées terminées comptent dans un bilan.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_cur FROM public.events e WHERE e.id = ANY(v_cur) AND coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now;
  SELECT coalesce(array_agg(e.id), '{}') INTO v_prev FROM public.events e WHERE e.id = ANY(v_prev) AND coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now;

  v_cur_agg := public._an3_aggregate(v_cur, p_venue_id, true, v_scope_ids);
  v_prev_agg := CASE WHEN cardinality(v_prev) > 0 THEN public._an3_aggregate(v_prev, p_venue_id, true, v_scope_ids) END;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.event_id, 'title', n.title, 'start_at', n.start_at, 'tickets', n.tickets, 'cap', n.cap, 'gl', n.gl_registered, 'tables', n.tables) ORDER BY n.start_at), '[]'::jsonb)
    INTO v_upcoming
    FROM public._an3_nights((SELECT coalesce(array_agg(e.id), '{}') FROM public.events e WHERE e.id = ANY(v_scope_ids) AND e.start_at BETWEEN v_now AND v_now + interval '7 days' AND e.cancelled_at IS NULL), p_venue_id, true) n;

  -- Le segment actionnable : les habitués qui décrochent (mêmes règles RFM que la page Clients).
  IF p_venue_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE r.rfm_segment = 'at_risk'), count(*) FILTER (WHERE r.rfm_segment IN ('champions', 'loyal'))
      INTO v_at_risk, v_pillars FROM public._venue_customer_rfm(p_venue_id) r;
  ELSE
    SELECT count(*) FILTER (WHERE r.rfm_segment = 'at_risk'), count(*) FILTER (WHERE r.rfm_segment IN ('champions', 'loyal'))
      INTO v_at_risk, v_pillars FROM public.get_organizer_customer_segments(p_organizer_user_id) r;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'name', v_name, 'tz', v_tz, 'venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
    'nights', (v_cur_agg ->> 'nights')::int, 'revenue', (v_cur_agg ->> 'revenue')::numeric, 'tickets', (v_cur_agg ->> 'tickets')::int,
    'entries', (v_cur_agg ->> 'entries')::int, 'expected', (v_cur_agg ->> 'expected')::int, 'customers', (v_cur_agg ->> 'customers')::int,
    'new_customers', (v_cur_agg ->> 'new_customers')::int,
    'prev', CASE WHEN v_prev_agg IS NULL THEN NULL ELSE jsonb_build_object('nights', (v_prev_agg ->> 'nights')::int, 'revenue', (v_prev_agg ->> 'revenue')::numeric, 'tickets', (v_prev_agg ->> 'tickets')::int, 'entries', (v_prev_agg ->> 'entries')::int) END,
    'upcoming', v_upcoming, 'at_risk', coalesce(v_at_risk, 0), 'pillars', coalesce(v_pillars, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.weekly_digest_email_data(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_digest_email_data(text, uuid) TO service_role;

-- Registre super admin (/admin/notifications) : deux emails, allumés, jamais pour la démo.
INSERT INTO public.platform_notification_settings (notification_key, enabled, category)
VALUES ('email_night_recap', true, 'marketing'), ('email_weekly_digest', true, 'marketing')
ON CONFLICT (notification_key) DO NOTHING;
