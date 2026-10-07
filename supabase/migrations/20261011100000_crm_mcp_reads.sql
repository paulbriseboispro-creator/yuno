-- ============================================================================
-- Yuno CRM — le MCP lit la Console CRM (2026-10-07, suite de l'analyse client).
--
-- Sur un compte au produit `crm`, six outils rendaient le vide (ils lisaient les
-- tables de la billetterie Yuno) : get_sales_overview (vue fixe sans période),
-- get_sales_trends, get_purchase_behavior, get_audience_overview,
-- get_customer_segments, get_web_traffic, plus le RFM de get_recommendations et
-- list_customers_by_segment. Ils lisent désormais les RPC de la Console CRM
-- (crm_ana_sales, crm_ana_traffic, crm_ana_community, crm_clients_overview,
-- crm_segments_overview, crm_clients_list, crm_analysis_overview), toutes déjà
-- gardées par crm_scope_allowed et _crm_money_gate, avec la période demandée
-- (_mcp_crm_period : 24h, 48h, 7d, 30d, 90d ou 12m).
--
-- Ces RPC créent des tables temporaires : la transaction de mcp_call ne peut
-- pas être en lecture seule pour elles. _mcp_needs_temp prend le produit de
-- l'espace et n'ouvre l'écriture TEMPORAIRE qu'aux comptes CRM ; mcp_call est
-- repris de la base liée (pg_get_functiondef) et ne change que cet appel.
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._mcp_crm_period(p_args jsonb, p_default_days integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer;
BEGIN
  CASE p_args->>'period'
    WHEN 'last' THEN RETURN '30d';
    WHEN 'last4' THEN RETURN '90d';
    WHEN 'month' THEN RETURN '30d';
    WHEN 'year' THEN RETURN '12m';
    WHEN 'all' THEN RETURN '12m';
    ELSE NULL;
  END CASE;
  SELECT w.w_days INTO v_days FROM public._mcp_window(p_args, p_default_days) w;
  v_days := coalesce(v_days, p_default_days);
  RETURN CASE WHEN v_days <= 1 THEN '24h' WHEN v_days <= 2 THEN '48h' WHEN v_days <= 7 THEN '7d'
              WHEN v_days <= 30 THEN '30d' WHEN v_days <= 90 THEN '90d' ELSE '12m' END;
END;
$function$;

REVOKE ALL ON FUNCTION public._mcp_crm_period(jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Tables temporaires : les outils ci-dessus, sur un compte CRM seulement.
CREATE OR REPLACE FUNCTION public._mcp_needs_temp(p_tool text, p_product text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public._mcp_needs_temp(p_tool)
      OR (p_product = 'crm' AND p_tool IN ('get_sales_overview', 'get_sales_trends', 'get_purchase_behavior',
            'get_audience_overview', 'get_customer_segments', 'get_web_traffic', 'get_recommendations',
            'list_customers_by_segment', 'get_event_targets'))
$function$;

REVOKE ALL ON FUNCTION public._mcp_needs_temp(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- Compte Yuno CRM : ses soirées sont des soirées MIROIR, qu'analytics_scope_gate
  -- écarte depuis le 07/10 (la Billetterie ne doit pas les compter). Sans elles,
  -- l'IA d'un compte CRM voyait « 0 soirée » et ne trouvait aucun rapport.
  IF v_crm THEN
    gate.scope_ids := public._mcp_email_scope_events(v_venue, v_org);
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
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'totals', v->'totals', 'fill', v->'fill', 'tariffs', v->'tariffs', 'from_yuno_messages', v->'msg',
        'events', v->'events', 'events_other', v->'events_other',
        'account', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: sales reported by the connected ticketing over the period (24h, 48h, 7d, 30d, 90d or 12m ending today), compared with the period just before.');
    END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'series', v->'series', 'yuno_sends_on_the_series', v->'sends', 'pace_vs_reference_nights', v->'goal',
        'note', 'series[i] = tickets and revenue of slot i of the window (window.mode: hour, day or month from window.start), prev_* = same slot of the previous period.');
      BEGIN v_out := v_out || jsonb_build_object('traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('traffic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
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
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'purchases_by_weekday_and_hour', v->'heat', 'ticket_tiers', v->'tariffs', 'totals', v->'totals',
        'note', 'purchases_by_weekday_and_hour: cells[weekday][slot], weekday 0 = Monday, 8 two-hour slots starting at 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00, 00:00 (local time), outside = purchases outside these slots; n = tickets, amount = revenue. '
             || 'buying_habits: tested hypotheses on how customers buy (see get_customer_analysis), never a certainty.');
      BEGIN
        v2 := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('buying_habits', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'status', f->>'status',
                   'availability', f->>'availability', 'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v2->'families', '[]'::jsonb)) f
           WHERE f->>'family' IN ('launch', 'early', 'last_minute', 'door', 'group', 'table')));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('buying_habits', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
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
    IF v_crm THEN
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing');
      BEGIN v_out := v_out || jsonb_build_object('clients', public.crm_clients_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('clients', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, public._mcp_crm_period(p_args, 365), NULL, 'all');
        v_out := v_out || jsonb_build_object('community', v - 'top' - 'spark' - 'series',
          'note', 'community: lifecycle (hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night), '
               || 'hist = people by number of nights, reach = reachable by email / SMS, wake = people to bring back, cohort = return of each recent night''s buyers.');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v2 := public.crm_artists_analysis(v_venue, v_org, 10);
        v_out := v_out || jsonb_build_object('artists', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                   'return_rate', x->'return_rate', 'resident', x->'resident'))), '[]'::jsonb)
                   FROM jsonb_array_elements(coalesce(v2->'artists', '[]'::jsonb)) x));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('artists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('community', public.get_community_overview(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('tastes', public.get_community_tastes(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('tastes', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('cohorts', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_web_traffic' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 30);
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'note', 'Yuno CRM account: where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages). Page visits on the ticketing site are not reported by Shotgun.');
    END IF;
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
    IF v_crm THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
               'template', s.template, 'definition', s.definition) ORDER BY s.updated_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.crm_segments cs
               WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                  OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org AND cs.venue_id IS NULL)
               ORDER BY cs.updated_at DESC LIMIT 40) s;
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'saved_segments', v);
      BEGIN
        v2 := public.crm_segments_overview(v_venue, v_org, public._mcp_crm_period(p_args, 90));
        v_out := v_out || jsonb_build_object('lifecycle_segments', v2->'segments', 'rules', v2->'rules', 'messages_totals', v2->'totals',
          'note', 'lifecycle keys: hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night (rules: regulars = N nights over M months).');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('lifecycle_segments', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
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
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, '90d', NULL, 'all');
        v_out := v_out || jsonb_build_object('people_to_bring_back', v->'wake', 'reachable', v->'reach', 'lifecycle', v->'lifecycle');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('people_to_bring_back', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('supported_hypotheses', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'variant', nullif(f->>'variant', ''),
                   'gain', f->'gain', 'direction', f->'direction'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f
           WHERE f->>'status' = 'supported' AND f->>'availability' IN ('ok', 'reduced')),
          'return_delay_days', v->'state'->'stats'->'median_days');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('supported_hypotheses', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
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
    IF NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN
      v_out := v_out || jsonb_build_object('automations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30), '[]'::jsonb)) a));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Analyse client (« ce qui fait venir », 20261010150000) ────────────────
  -- Agrégats seulement (niveau analytics) : statut de chaque famille
  -- d'hypothèses testée sur le compte, hypothèses des nouveaux venus, venus
  -- une fois, délai de retour, couverture, artistes. Aucune identité.
  -- « Qui cibler » (20261011110000) : audiences sans place d'une soirée à venir.
  WHEN 'get_event_targets' THEN
    IF NOT v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_outside_crm'); END IF;
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL AND nullif(coalesce(p_args->>'event_id', p_args->>'event'), '') IS NULL THEN
      SELECT e.id INTO v_event FROM public.events e
       WHERE e.id = ANY (gate.scope_ids) AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND coalesce(e.end_at, e.start_at + interval '6 hours') > now()
       ORDER BY e.start_at LIMIT 1;
    END IF;
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v := public.crm_night_targets(v_venue, v_org, v_event);
    RETURN v || jsonb_build_object('note',
      'Audiences are people WITHOUT a ticket for this event; one person can be in several. status = what the account data says about the hypothesis family '
      || '(supported, not_supported, untested, inconclusive), never a certainty about a person. send_at = suggested moment.');

  WHEN 'get_customer_analysis' THEN
    BEGIN
      v := public.crm_analysis_overview(v_venue, v_org);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'error', 'analysis_unavailable', 'detail', public._mcp_unavailable(SQLSTATE, SQLERRM));
    END;
    IF v->'state' IS NULL OR jsonb_typeof(v->'state') = 'null' THEN
      RETURN jsonb_build_object('ok', true, 'computed', false,
        'note', 'No customer analysis yet: it needs a connected ticketing (Shotgun) and runs the night after the first import.');
    END IF;
    BEGIN
      v2 := public.crm_artists_analysis(v_venue, v_org, 15);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'computed', true,
      'computed_at', v->'state'->'full_at', 'rules_version', v->'rules_version', 'min_sample', v->'min_sample',
      'families', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'family', f->>'family', 'variant', nullif(f->>'variant', ''), 'kind', f->>'kind',
                     'availability', f->>'availability', 'status', f->>'status',
                     'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain', 'z', f->'z',
                     'direction', f->'direction', 'return_rate_group', f->'detail'->'r1', 'return_rate_others', f->'detail'->'r0',
                     'confirmed_since', CASE WHEN f->>'status' = 'supported' THEN f->'since' END,
                     'seen_on_other_accounts', f->'prior'))), '[]'::jsonb)
                     FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f),
      'newcomers_12_months', v->'newcomers',
      'came_once', v->'once',
      'return_delay_days', jsonb_build_object('median', v->'state'->'stats'->'median_days', 'p25', v->'state'->'stats'->'p25_days',
                                              'p75', v->'state'->'stats'->'p75_days', 'returners', v->'state'->'stats'->'returners'),
      'newcomers_returned_6_months', jsonb_build_object('eligible', v->'state'->'stats'->'eligible', 'returned', v->'state'->'stats'->'returned'),
      'coverage', v->'state'->'coverage',
      'artists', CASE WHEN jsonb_typeof(v2) = 'object' AND v2 ? 'artists' THEN jsonb_build_object(
                   'baseline_return_rate', v2->'baseline'->'rate',
                   'top', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                             'newcomers_returned_6_months', x->'new_returned', 'newcomers_eligible', x->'new_eligible',
                             'return_rate', x->'return_rate', 'seen_twice_or_more', x->'fans', 'resident', x->'resident'))), '[]'::jsonb)
                             FROM jsonb_array_elements(v2->'artists') x)) ELSE v2 END);

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    -- Filtre de l'analyse client : clients qui portent une hypothèse (moyenne ou
    -- forte), ou « de passage » / habitant à proximité. Liste Clients du CRM.
    IF nullif(p_args->>'hypothesis', '') IS NOT NULL OR nullif(p_args->>'passing', '') IS NOT NULL THEN
      v := public.crm_clients_list(v_venue, v_org,
             jsonb_build_object('seg', 'all', 'f', jsonb_strip_nulls(jsonb_build_object(
               'hyp', CASE WHEN p_args->>'hypothesis' ~ '^[a-z_]{2,24}$' THEN jsonb_build_array(p_args->>'hypothesis') END,
               'pass', CASE WHEN p_args->>'passing' = 'true' THEN 'yes' WHEN p_args->>'passing' = 'false' THEN 'no' END))),
             CASE WHEN p_args->>'sort' = 'name' THEN 'name' WHEN p_args->>'sort' = 'events' THEN 'n'
                  WHEN p_args->>'sort' = 'spent' THEN 'sp' ELSE 'last' END, 1, v_limit, v_offset);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit,
                                'filter', jsonb_strip_nulls(jsonb_build_object('hypothesis', p_args->>'hypothesis', 'passing', p_args->'passing')),
                                'customers', v2);
    END IF;
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
    IF v_crm THEN
      v_ref := CASE WHEN v_topic IN ('champions', 'loyal') THEN 'hab' WHEN v_topic = 'promising' THEN 'occ'
                    WHEN v_topic = 'new' THEN 'nou' WHEN v_topic IN ('at_risk', 'dormant', 'lost', 'churn_risk') THEN 'end' END;
      v := public.crm_clients_list(v_venue, v_org, jsonb_build_object('seg', coalesce(v_ref, 'all'), 'f', '{}'::jsonb),
             'sp', 1, v_limit, 0);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'lifecycle', v_ref, 'total', v->'total', 'customers', v2,
        'note', 'Yuno CRM account: segment mapped to the CRM lifecycle (champions/loyal = regulars, promising = occasional, new = new, at_risk/dormant/lost/churn_risk = lapsed).');
    END IF;
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
    -- La base de contacts filtrée par l'adresse (350 ms), pas contact_rows()
    -- entier (jusqu'à 20 s sur un compte CRM : la fiche ne répondait jamais).
    v2 := public.list_contact_base(v_venue, v_org, v_ref, NULL, NULL, NULL, NULL, 'recent', 10, 0);
    SELECT x - 'id' - 'list_import_id' INTO v
      FROM jsonb_array_elements(coalesce(v2->'rows', '[]'::jsonb)) x
     WHERE lower(x->>'email') = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    BEGIN v2 := public.get_customer_automation_emails(v_venue, v_org, v_ref);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    -- Analyse client : ses hypothèses (des FAITS + le statut de leur famille
    -- sur le compte), jamais une affirmation de motif.
    BEGIN
      v3 := public.crm_client_analysis(v_venue, v_org, v_ref);
      v3 := CASE WHEN coalesce((v3->>'profile')::boolean, false) THEN jsonb_build_object(
              'excluded_from_profiling', v3->'excluded', 'nights', v3->'nights', 'distance_km', v3->'dist_km',
              'passing_through', v3->'passing',
              'hypotheses', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                               'family', h->>'f', 'strength', h->>'s', 'evidence_key', h->>'k', 'evidence', h->'p',
                               'family_status_on_account', h->>'status', 'family_availability', h->>'availability',
                               'direction', h->>'direction'))), '[]'::jsonb)
                               FROM jsonb_array_elements(coalesce(v3->'hyps', '[]'::jsonb)) h),
              'first_night', jsonb_strip_nulls(jsonb_build_object(
                'title', v3->'first'->>'title', 'date', v3->'first'->>'start_at', 'days_before', v3->'first'->'lead_days',
                'source', v3->'first'->>'src', 'order_size', v3->'first'->'order_size',
                'with_existing_customer', v3->'first'->'with_returning', 'invitation', v3->'first'->'invitation')))
            ELSE jsonb_build_object('excluded_from_profiling', v3->'excluded', 'hypotheses', '[]'::jsonb,
                                    'note', 'No analysis profile: no Shotgun ticket for this contact, or excluded at their request.') END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'customer', v, 'automation_emails', v2, 'analysis', v3);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public._mcp_tool(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- mcp_call : repris de la base liée, seul l'appel à _mcp_needs_temp change.
CREATE OR REPLACE FUNCTION public.mcp_call(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  s        record;
  v_args   jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space  text;
  v_call   bigint;
  v_res    jsonb;
  v_min    integer;
  v_day    integer;
  v_cust   integer;
  v_has_space boolean;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;

  IF p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Espace : celui demandé, sinon celui où la personne a le plus de droits
  -- (propriétaire / fondateur, puis admin, puis manager), Yuno Suite avant
  -- Yuno CRM, club avant organisation, puis par nom. `a.spaces` est trié par
  -- clé : son premier élément n'avait aucun sens pour la personne.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  -- Une IA passe parfois le NOM de l'espace (« Organisateur Démo ») au lieu de
  -- sa clé : on le reconnaît plutôt que de répondre « espace hors connexion ».
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space)
     LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Débits : 60 appels / minute, 3 000 / jour, 100 lectures de fiches / jour.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE public._mcp_customer_tool(tool) AND status = 'ok')
    INTO v_min, v_day, v_cust
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';

  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed',
      'spaces', to_jsonb(a.spaces));
  END IF;

  IF v_min >= 60 OR v_day >= 3000 OR (public._mcp_customer_tool(p_tool) AND v_cust >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF public._mcp_customer_tool(p_tool) AND NOT (a.level = 'customers' AND s.customers) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'customers_level_required');
    RETURN jsonb_build_object('ok', false, 'error', 'customers_level_required');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space,
          CASE WHEN length((v_args - 'space')::text) <= 2000 THEN v_args - 'space' ELSE jsonb_build_object('truncated', true) END)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    -- La personne, et elle seule : auth.uid(), auth.role(), auth.jwt() la
    -- désignent pour toutes les RPC appelées ensuite. Les deux formes de claims
    -- sont posées (la forme « claim.x » est lue en priorité par auth.uid()).
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    IF NOT public._mcp_needs_temp(p_tool, s.product) THEN
      PERFORM set_config('transaction_read_only', 'on', true);
    END IF;

    IF p_tool IN ('get_email_design_kit', 'list_email_audiences', 'get_email_draft', 'list_email_images') THEN
      v_res := public._mcp_email_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSIF p_tool IN ('get_signup_page_kit', 'get_signup_page') THEN
      v_res := public._mcp_signup_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSE
      v_res := public._mcp_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.level);
    END IF;
    v_res := public._mcp_redact(v_res, NOT public._mcp_customer_tool(p_tool));
  EXCEPTION WHEN others THEN
    -- Sous-transaction annulée : claims et lecture seule tombent avec elle, on
    -- peut noter l'échec.
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error', 'internal', 'call_id', v_call,
      'message', CASE WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid argument' ELSE 'query failed' END);
  END;

  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, true), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;
