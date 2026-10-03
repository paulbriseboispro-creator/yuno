-- Serveur MCP : revue avant soumission aux annuaires (2026-10-03).
--
-- Joué de bout en bout en production avec le compte de relecture
-- review@womber.fr (manager du club démo, admin d'équipe de deux organisations) :
-- la moitié des outils échouaient pour un rôle d'équipe.
--
-- 1. La base s'aligne sur la Console Organisateur : un ADMIN d'équipe a la
--    capacité `marketing` (capabilitiesFor), donc les pages Campagnes,
--    Automatisations et Base de contacts — mais les fonctions de lecture
--    refusaient tout autre que le fondateur, et ces écrans tombaient. Les
--    gardes de lecture email (`_email_scope_guard`, `get_email_lists_health`,
--    `get_email_quota_status`) et la porte des contacts (`contact_scope_allowed`)
--    acceptent désormais l'admin d'équipe. Jamais l'éditeur ni le scanneur.
--    Côté club, rien ne change : la Console Manager n'a pas de pages email.
-- 2. `_mcp_user_spaces` ne propose plus les fiches clients à un éditeur
--    d'équipe : la base ne les lui ouvre pas.
-- 3. `_mcp_tool` : un outil qui assemble plusieurs analyses rend ce qu'il peut
--    et dit pourquoi une partie manque (`_mcp_unavailable`), au lieu d'échouer
--    en bloc parce qu'une seule brique est réservée au propriétaire. Le statut
--    de billetterie d'un compte CRM est lu sans indice de jeton ni erreur brute.

CREATE OR REPLACE FUNCTION public._email_scope_guard(p_venue_id text, p_organizer_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_lists_health(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_lists_health: une seule portée à la fois';
  END IF;
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH imports AS (
    SELECT i.id, i.filename, i.list_name, i.created_at
      FROM public.email_list_imports i
     WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND i.superseded_by IS NULL
     ORDER BY i.created_at DESC
     LIMIT 50
  ),
  subs AS (
    SELECT s.import_id,
           count(*) AS total,
           count(*) FILTER (WHERE s.opted_in AND s.opted_out_at IS NULL AND NOT public.is_email_suppressed(s.email)) AS active,
           count(*) FILTER (WHERE public.is_email_suppressed(s.email)) AS dead,
           count(*) FILTER (WHERE NOT public.is_email_suppressed(s.email) AND (NOT s.opted_in OR s.opted_out_at IS NOT NULL)) AS unsubscribed
      FROM public.newsletter_subscriptions s
     WHERE s.import_id IN (SELECT id FROM imports)
     GROUP BY s.import_id
  ),
  purged AS (
    SELECT o.import_id, count(*) AS n
      FROM public.email_opt_outs o
     WHERE o.import_id IN (SELECT id FROM imports)
     GROUP BY o.import_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'import_id', i.id,
           'filename', i.filename,
           'list_name', i.list_name,
           'created_at', i.created_at,
           'total', COALESCE(s.total, 0),
           'active', COALESCE(s.active, 0),
           'unsubscribed', COALESCE(s.unsubscribed, 0),
           'dead', COALESCE(s.dead, 0),
           'purged', COALESCE(p.n, 0)
         ) ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM imports i
    LEFT JOIN subs s ON s.import_id = i.id
    LEFT JOIN purged p ON p.import_id = i.id;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_email_quota_status(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_used integer;
  v_free integer;
  v_credits integer;
  v_pool_used integer;
  v_pool_cap integer;
  v_day_used integer;
  v_day_cap integer;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_quota_status: une seule portée à la fois';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'venue:' || p_venue_id;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin') OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'org:' || p_organizer_user_id::text;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'yuno';
  END IF;

  SELECT COALESCE(sent, 0) INTO v_used
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = v_month;
  v_used := COALESCE(v_used, 0);

  v_free := public.email_sender_monthly_free(v_scope);

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;
  v_credits := COALESCE(v_credits, 0);

  SELECT COALESCE(sent, 0) INTO v_pool_used
    FROM public.email_send_quota_month WHERE scope_key = 'platform' AND month = v_month;
  v_pool_cap := public.email_sender_monthly_free('platform');

  SELECT COALESCE(sent, 0) INTO v_day_used
    FROM public.email_send_quota WHERE scope_key = v_scope AND day = CURRENT_DATE;
  v_day_cap := public.email_sender_daily_cap(v_scope);

  RETURN jsonb_build_object(
    'used', v_used,
    'free', v_free,
    'credits', v_credits,
    'remaining', GREATEST(0, v_free - v_used) + v_credits,
    'resets_on', (v_month + interval '1 month')::date,
    'day_used', COALESCE(v_day_used, 0),
    'day_cap', COALESCE(v_day_cap, 0),
    'pool_used', COALESCE(v_pool_used, 0),
    'pool_cap', COALESCE(v_pool_cap, 0)
  );
END;
$function$;

-- Porte des contacts : celle des SMS (propriétaire, manager du club,
-- fondateur), plus l'admin d'équipe d'une organisation.
CREATE OR REPLACE FUNCTION public.contact_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.sms_scope_allowed(p_venue_id, p_organizer_user_id)
      OR (auth.uid() IS NOT NULL AND p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL
          AND public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin'));
$function$;

-- Une brique d'analyse refusée ou en panne, dite en une phrase à l'IA.
CREATE OR REPLACE FUNCTION public._mcp_unavailable(p_state text, p_msg text)
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object('unavailable',
    CASE WHEN p_state = '42501' OR p_msg ILIKE ANY (ARRAY['%unauthorized%', '%forbidden%', '%not allowed%'])
         THEN 'Not shown: in the Yuno Console this detail is reserved to the club owner or the organization founder, and this person''s role does not include it.'
         ELSE 'Not available right now: this part could not be computed.' END)
$$;
REVOKE ALL ON FUNCTION public._mcp_unavailable(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._mcp_user_spaces(p_uid uuid)
RETURNS TABLE (space_key text, kind text, space_id text, name text, product text,
               timezone text, role text, money boolean, customers boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'owner', true, true
    FROM public.venues v
   WHERE v.owner_id = p_uid AND v.decommissioned_at IS NULL
  UNION ALL
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'manager',
         coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false),
         coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false)
    FROM public.manager_permissions mp
    JOIN public.venues v ON v.id = mp.venue_id
   WHERE mp.user_id = p_uid AND v.decommissioned_at IS NULL
     AND v.owner_id IS DISTINCT FROM p_uid
     AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)
          OR coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false))
  UNION ALL
  SELECT 'org:' || op.user_id, 'organizer', op.user_id::text, coalesce(nullif(op.display_name, ''), 'Organisation'),
         coalesce(op.product, 'suite'), 'Europe/Paris', 'founder', true, true
    FROM public.organizer_profiles op
   WHERE op.user_id = p_uid
  UNION ALL
  SELECT 'org:' || m.organizer_user_id, 'organizer', m.organizer_user_id::text,
         coalesce(nullif(op.display_name, ''), 'Organisation'), coalesce(op.product, 'suite'), 'Europe/Paris', m.role,
         public.org_member_has_permission(p_uid, m.organizer_user_id, 'view_finance'), m.role = 'admin'
    FROM public.org_members m
    JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
   WHERE m.member_user_id = p_uid AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor')
     AND m.organizer_user_id <> p_uid
$$;

CREATE OR REPLACE FUNCTION public._mcp_tool(
  p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_crm    boolean := p_product = 'crm';
  gate     record;
  w        record;
  v_event  uuid;
  v_ref    text;
  v_limit  integer;
  v_offset integer;
  v        jsonb;
  v2       jsonb;
  v3       jsonb;
  v_when   text;
  v_search text;
  v_topic  text;
  v_ids    uuid[];
  v_out    jsonb;
  r        record;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;

  CASE p_tool

  -- ── Contexte ──────────────────────────────────────────────────────────────
  WHEN 'get_account_overview' THEN
    SELECT jsonb_build_object(
      'past_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') < now()),
      'upcoming_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') >= now()),
      'first_event_at', min(e.start_at), 'last_event_at', max(e.start_at) FILTER (WHERE e.start_at < now()))
      INTO v
      FROM public.events e
     WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
       AND (e.is_active OR e.external_source IS NOT NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at), '[]'::jsonb)
      INTO v2
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
             ORDER BY e.start_at LIMIT 5) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at DESC), '[]'::jsonb)
      INTO v3
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
             ORDER BY e.start_at DESC LIMIT 5) x;
    v_out := jsonb_build_object(
      'ok', true, 'now', now(), 'timezone', coalesce(gate.tz, p_tz),
      'today_local', to_char(now() AT TIME ZONE coalesce(gate.tz, p_tz), 'YYYY-MM-DD (Dy)'),
      'currency', 'EUR', 'product', p_product, 'can_see_money', gate.money,
      'access_level', p_level, 'events', v, 'next_events', v2, 'last_events', v3);
    IF v_crm THEN
      -- Statut de la billetterie connectée, lu ici (la RPC de la Console est
      -- réservée au fondateur et rend l'indice du jeton et l'erreur brute).
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'provider', tc.provider, 'account', tc.external_org_name, 'status', tc.status,
               'last_sync_ok_at', tc.last_ok_at, 'first_import_done', tc.initial_import_done_at IS NOT NULL,
               'has_sync_error', tc.last_error_at IS NOT NULL AND (tc.last_ok_at IS NULL OR tc.last_error_at > tc.last_ok_at)))
             ORDER BY tc.created_at), '[]'::jsonb)
        INTO v
        FROM public.ticketing_connections tc
       WHERE (v_venue IS NOT NULL AND tc.venue_id = v_venue) OR (v_org IS NOT NULL AND tc.organizer_user_id = v_org);
      v_out := v_out || jsonb_build_object('ticketing', v);
    END IF;
    RETURN v_out;

  -- ── Soirées ───────────────────────────────────────────────────────────────
  WHEN 'list_events' THEN
    v_when := coalesce(nullif(p_args->>'when', ''), 'all');
    v_search := nullif(btrim(coalesce(p_args->>'search', '')), '');
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 20), 60));
    IF v_crm THEN
      v := public.get_crm_nights(v_venue, v_org, 200, 0);
      SELECT coalesce(jsonb_agg(n ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                                           (n->>'start_at')::timestamptz DESC), '[]'::jsonb)
        INTO v2
        FROM (SELECT n FROM jsonb_array_elements(v->'nights') n
               WHERE (v_when = 'all' OR (v_when = 'upcoming') = coalesce((n->>'upcoming')::boolean, false))
                 AND (v_search IS NULL OR lower(n->>'title') LIKE '%' || lower(v_search) || '%')
               ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                        (n->>'start_at')::timestamptz DESC
               LIMIT v_limit) q;
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'total', v->'total', 'events', v2);
    END IF;
    v := public.get_analytics_event_rail(v_venue, v_org, 400);
    SELECT coalesce(jsonb_agg(q.e), '[]'::jsonb) INTO v2
      FROM (SELECT e FROM jsonb_array_elements(v->'events') e
             WHERE (v_when = 'all' OR (v_when = 'upcoming' AND e->>'phase' <> 'after')
                    OR (v_when = 'past' AND e->>'phase' = 'after'))
               AND (v_search IS NULL OR lower(e->>'title') LIKE '%' || lower(v_search) || '%')
               AND (nullif(p_args->>'from', '') IS NULL OR (e->>'startAt')::timestamptz >= (p_args->>'from')::date)
               AND (nullif(p_args->>'to', '') IS NULL OR (e->>'startAt')::timestamptz < (p_args->>'to')::date + 1)
             ORDER BY CASE WHEN v_when = 'upcoming' THEN (e->>'startAt')::timestamptz END ASC,
                      (e->>'startAt')::timestamptz DESC
             LIMIT v_limit) q;
    v_out := jsonb_build_object('ok', true, 'money', v->'money', 'events', v2);
    IF v_when IN ('upcoming', 'all') THEN
      -- Jauges et ventes du jour des prochaines soirées (même source que
      -- « Vos prochaines soirées » de l'accueil).
      v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
    END IF;
    RETURN v_out;

  WHEN 'get_event_report' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'event_id', v_event, 'report', public.get_crm_night_report(v_event));
    END IF;
    RETURN public.get_event_report(v_event);

  WHEN 'get_event_details' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v_topic := coalesce(nullif(p_args->>'topic', ''), 'ticket_types');
    CASE v_topic
      WHEN 'ticket_types' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', tr.name, 'price', tr.price, 'capacity', tr.max_tickets, 'sold', tr.tickets_sold,
                 'fill_pct', CASE WHEN coalesce(tr.max_tickets, 0) > 0 THEN round(100.0 * tr.tickets_sold / tr.max_tickets, 1) END,
                 'open', tr.is_active, 'sold_out_by_hand', tr.manually_sold_out, 'hidden', tr.hidden,
                 'type', tr.ticket_type, 'group_size', CASE WHEN tr.is_group THEN tr.group_size END,
                 'sale_starts_at', tr.sale_starts_at, 'sale_ends_at', tr.sale_ends_at,
                 'entry_deadline', tr.entry_deadline, 'includes_free_drink', tr.includes_drink)
               ORDER BY tr.position, tr.price), '[]'::jsonb)
          INTO v
          FROM public.ticket_rounds tr WHERE tr.event_id = v_event;
        SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'selling_mode', e.ticket_selling_mode,
                 'ticketing_enabled', e.ticketing_enabled, 'tables_enabled', e.tables_enabled,
                 'guest_list_parts', (SELECT count(*) FROM public.guest_lists gl WHERE gl.event_id = e.id),
                 'tickets_sold_out', e.tickets_sold_out,
                 'tables_sold_out', e.tables_sold_out, 'guest_list_sold_out', e.guest_list_sold_out,
                 'entry_target', e.entry_target)
          INTO v2 FROM public.events e WHERE e.id = v_event;
        RETURN jsonb_build_object('ok', true, 'event', v2, 'ticket_types', v);
      WHEN 'tables' THEN
        RETURN public.get_vip_table_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'guest_list' THEN
        RETURN public.get_guest_list_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'traffic' THEN
        RETURN public.get_event_traffic(v_event);
      WHEN 'pacing' THEN
        RETURN public.get_analytics_pacing(v_event, 'previous', greatest(7, least(coalesce(nullif(p_args->>'days', '')::integer, 30), 90)));
      WHEN 'door' THEN
        RETURN public.get_analytics_door(v_venue, v_org, v_event, NULL, NULL);
      WHEN 'partners' THEN
        RETURN public.get_collab_party_breakdown(v_event);
      WHEN 'promoters' THEN
        RETURN public.get_analytics_promoters(v_venue, v_org, v_event, NULL, NULL);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'unknown topic');
    END CASE;

  WHEN 'compare_events' THEN
    v_ids := '{}';
    IF jsonb_typeof(p_args->'events') = 'array' THEN
      FOR v_ref IN SELECT x FROM jsonb_array_elements_text(p_args->'events') x LIMIT 6 LOOP
        v_event := public._mcp_resolve_event(v_ref, gate.scope_ids);
        IF v_event IS NOT NULL AND NOT v_event = ANY (v_ids) THEN v_ids := v_ids || v_event; END IF;
      END LOOP;
    END IF;
    IF cardinality(v_ids) = 0 THEN
      SELECT coalesce(array_agg(x.id ORDER BY x.start_at DESC), '{}') INTO v_ids
        FROM (SELECT e.id, e.start_at FROM public.events e
               WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
                 AND (e.is_active OR e.external_source IS NOT NULL)
                 AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
               ORDER BY e.start_at DESC
               LIMIT greatest(2, least(coalesce(nullif(p_args->>'last', '')::integer, 4), 6))) x;
    END IF;
    v := '[]'::jsonb;
    FOREACH v_event IN ARRAY v_ids LOOP
      IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
        v2 := public.get_crm_night_report(v_event);
        v := v || jsonb_build_array(jsonb_build_object('event_id', v_event, 'source', 'ticketing',
                 'report', v2 - 'curve' - 'buyers_list'));
      ELSE
        v2 := public.get_event_report(v_event);
        v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'event', v2->'event', 'totals', v2->'totals', 'audience', v2->'audience',
                 'channels', v2->'channels', 'visit_sources', v2->'visitSources',
                 'takeaways', v2->'takeaways', 'money', v2->'money')));
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'events', v);

  -- ── Ventes ────────────────────────────────────────────────────────────────
  WHEN 'get_sales_overview' THEN
    IF v_crm THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'overview', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: this is the ticketing overview of the account; it does not change with the period. Use compare_events or list_events for one period.');
    END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'overview', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: the D-N curve and the sales drivers come from Yuno ticketing; this is the ticketing overview instead (UTM sources per event are in get_event_report).');
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    BEGIN v_out := v_out || jsonb_build_object('curve', public.get_sales_period_curve(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('curve', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('drivers', public.get_sales_period_drivers(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('drivers', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('audience', public.get_sales_period_audience(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('audience', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_purchase_behavior' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 180);
    RETURN public.get_purchase_behavior(v_venue, v_org, w.w_from, w.w_to);

  WHEN 'get_promoters_performance' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN public.get_analytics_promoters(v_venue, v_org, NULL, w.w_from, w.w_to);

  WHEN 'get_live_now' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    RETURN public.get_live_view(v_venue, v_org);

  -- ── Public et trafic ──────────────────────────────────────────────────────
  WHEN 'get_audience_overview' THEN
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('community', public.get_community_overview(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('tastes', public.get_community_tastes(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('tastes', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('cohorts', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_web_traffic' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 30);
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('page', public.get_page_traffic(v_venue, v_org, least(w.w_days, 365)));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('page', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('sources', public.get_analytics_sources(v_venue, v_org, NULL, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sources', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'count_contacts' THEN
    IF jsonb_typeof(p_args->'conditions') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'conditions[] required');
    END IF;
    RETURN jsonb_build_object('ok', true, 'definition', jsonb_build_object('conditions', p_args->'conditions'),
      'result', public.count_contact_segment_def(v_venue, v_org, jsonb_build_object('conditions', p_args->'conditions')));

  WHEN 'get_customer_segments' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
             'definition', s.definition, 'origin', s.origin) ORDER BY s.updated_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM public.contact_segments cs
             WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org)
             ORDER BY cs.updated_at DESC LIMIT 30) s;
    v_out := jsonb_build_object('ok', true, 'saved_segments', v);
    BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('imported_lists', public.get_email_lists_health(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('imported_lists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('basket_threshold', public.suggest_basket_threshold(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('basket_threshold', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Marketing ─────────────────────────────────────────────────────────────
  WHEN 'get_marketing_performance' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_topic := coalesce(nullif(p_args->>'channel', ''), 'all');
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    IF v_topic IN ('all', 'email') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', c.id, 'name', c.name, 'subject', c.subject, 'type', c.type, 'status', c.status,
               'sent_at', c.sent_at, 'event_id', c.event_id,
               'recipients', coalesce(c.total_recipients, c.recipients_count), 'delivered', c.delivered_count,
               'opens', c.opens_count, 'clicks', c.clicks_count, 'clickers', c.clickers_count,
               'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complaints', c.complained_count,
               'protected_by_yuno_rules', c.policy_skipped_count, 'ab_test', c.ab_enabled, 'ab_winner', c.ab_winner,
               'open_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * c.opens_count / c.delivered_count, 1) END,
               'click_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * coalesce(c.clickers_count, c.clicks_count) / c.delivered_count, 1) END))
             ORDER BY c.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.email_campaigns c
               WHERE ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL))
                 AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                 AND c.sent_at >= w.w_from AND c.sent_at < w.w_to
               ORDER BY c.sent_at DESC LIMIT 20) c;
      v_out := v_out || jsonb_build_object('email_campaigns', v);
      BEGIN
        v_out := v_out || jsonb_build_object('email_revenue_attribution', public.get_email_campaign_attribution(
            CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_revenue_attribution', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('best_send_time', public.get_email_send_time_insights(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('best_send_time', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'automations') THEN
      BEGIN v_out := v_out || jsonb_build_object('email_automations', public.get_email_automation_stats(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'push') AND NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('push_campaigns', public.get_push_campaigns(v_venue, v_org, 'all', NULL, 15, 0));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_campaigns', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('push_automatic', public.get_push_center(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_automatic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'sms') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status, 'sent_at', s.sent_at, 'event_id', s.event_id,
               'recipients', s.total_recipients, 'sent', s.sent_count, 'delivered', s.delivered_count,
               'failed', s.failed_count, 'credits_used', s.credits_consumed)) ORDER BY s.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.sms_campaigns s
               WHERE ((v_venue IS NOT NULL AND s.venue_id = v_venue) OR (v_org IS NOT NULL AND s.organizer_id = v_org))
                 AND s.sent_at >= w.w_from AND s.sent_at < w.w_to
               ORDER BY s.sent_at DESC LIMIT 15) s;
      v_out := v_out || jsonb_build_object('sms_campaigns', v);
    END IF;
    RETURN v_out;

  WHEN 'get_campaign_report' THEN
    SELECT * INTO r FROM public.email_campaigns c
     WHERE c.id::text = coalesce(p_args->>'campaign_id', '')
       AND ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
    BEGIN
      SELECT x INTO v FROM jsonb_array_elements(public.get_email_campaign_attribution(
          CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text))->'campaigns') x
       WHERE x->>'campaign_id' = r.id::text OR x->>'id' = r.id::text LIMIT 1;
    EXCEPTION WHEN others THEN v := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v2 := CASE WHEN r.ab_enabled THEN public.get_campaign_ab_stats(r.id) END;
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v3 := CASE WHEN r.resend_enabled THEN public.get_campaign_resend_stats(r.id) END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v_out := CASE WHEN r.followup_enabled THEN public.get_campaign_followup_stats(r.id) END;
    EXCEPTION WHEN others THEN v_out := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'name', r.name, 'subject', r.subject, 'subject_b', r.subject_b, 'preheader', r.preheader,
        'status', r.status, 'sent_at', r.sent_at, 'event_id', r.event_id,
        'recipients', coalesce(r.total_recipients, r.recipients_count), 'delivered', r.delivered_count,
        'opens', r.opens_count, 'clicks', r.clicks_count, 'clickers', r.clickers_count,
        'unsubscribes', r.unsubscribes_count, 'bounced', r.bounced_count, 'complaints', r.complained_count,
        'failed', r.failed_count, 'suppressed', r.suppressed_count,
        'protected_by_yuno_rules', r.policy_skipped_count, 'paused_reason', r.paused_reason,
        'audiences', r.audiences_json, 'exclusions', r.exclusions_json, 'resend_enabled', r.resend_enabled,
        'followup_enabled', r.followup_enabled)),
      'revenue_attribution', v,
      'ab_test', v2,
      'resend_to_non_openers', v3,
      'click_followup', v_out);

  -- ── Conseils ──────────────────────────────────────────────────────────────
  WHEN 'get_recommendations' THEN
    v_out := jsonb_build_object('ok', true, 'product', p_product);
    IF v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('overview', public.get_crm_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('overview', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    ELSE
      BEGIN
        v := public.get_sales_takeaways(v_venue, v_org, 'last4');
        v_out := v_out || jsonb_build_object(
          'sales_takeaways', v->'takeaways',
          'sales_last4_vs_previous4', jsonb_build_object('current', v->'current', 'previous', v->'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sales_takeaways', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('upcoming_pipeline', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v_out := v_out || jsonb_build_object('signals_30d',
          public.get_analytics_insights(v_venue, v_org, NULL, now() - interval '30 days', now(), 'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('signals_30d', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN
      v_out := v_out || jsonb_build_object('automations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30), '[]'::jsonb)) a));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    v := public.list_contact_base(v_venue, v_org,
           nullif(btrim(coalesce(p_args->>'search', '')), ''),
           CASE WHEN p_args->>'segment_id' ~* '^[0-9a-f-]{36}$' THEN (p_args->>'segment_id')::uuid END,
           CASE WHEN p_args->>'status' IN ('active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable') THEN p_args->>'status' END,
           CASE WHEN p_args->>'origin' IN ('import', 'yuno', 'both') THEN p_args->>'origin' END,
           NULL,
           CASE WHEN p_args->>'sort' IN ('recent', 'engaged', 'spent', 'events', 'name') THEN p_args->>'sort' ELSE 'spent' END,
           v_limit, v_offset);
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
             'phone', CASE WHEN coalesce((p_args->>'include_phone')::boolean, false) THEN x->>'phone_e164' END,
             'city', x->>'city', 'age', x->'age', 'gender', x->>'gender', 'status', x->>'status',
             'origin', x->>'origin', 'total_spent', x->'total_spent', 'events', x->'event_count',
             'tables', x->'table_count', 'tickets', x->'ticket_count', 'guest_lists', x->'guest_list_count',
             'last_seen_at', x->>'last_seen_at', 'emails_received', x->'emails_sent', 'opens', x->'opens',
             'clicks', x->'clicks', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
      INTO v2
      FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
    RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit, 'customers', v2);

  WHEN 'list_customers_by_segment' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_topic := nullif(p_args->>'segment', '');
    IF v_venue IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_venue_customer_segments(v_venue) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_organizer_customer_segments(v_org) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    END IF;
    RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'customers', v);

  WHEN 'get_customer_profile' THEN
    v_ref := lower(btrim(coalesce(p_args->>'email', '')));
    IF v_ref !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'email required');
    END IF;
    SELECT to_jsonb(cr) - 'id' - 'list_import_id' - 'venue_id' - 'organizer_user_id' - 'user_id' - 'extra' - 'postal_code'
      INTO v
      FROM public.contact_rows(v_venue, v_org) cr WHERE lower(cr.email) = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    BEGIN v2 := public.get_customer_automation_emails(v_venue, v_org, v_ref);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'customer', v, 'automation_emails', v2);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$$;
