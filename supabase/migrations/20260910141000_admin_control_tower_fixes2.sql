-- ─── Tour de contrôle : corrections après premier passage en prod ───────────
-- • admin_ai_usage : le p95 de latence sortait un « aggregate function calls
--   cannot be nested » (percentile dans un jsonb agrégé) → CTE dédié.
-- • admin_release_health : l'historique pg_cron (80 000+ lignes, aucun index,
--   table dont postgres n'est pas propriétaire) était balayé 74 fois par appel
--   → un seul balayage matérialisé des 7 derniers jours.
-- • admin_cockpit ne lit plus cet historique du tout (3 s par balayage) : la
--   santé des crons est chargée à part par la page.
-- • Purge de l'historique pg_cron à 30 jours (cron « cron-history-purge »),
--   pour que le balayage reste court.

CREATE OR REPLACE FUNCTION public.admin_ai_usage(
  p_from timestamptz,
  p_to timestamptz,
  p_include_demo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH ev AS (
    SELECT e.*
    FROM public.ai_usage_events e
    WHERE e.created_at >= p_from AND e.created_at <= p_to
      AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
  ),
  prev AS (
    SELECT count(*) AS n, COALESCE(sum(cost_usd), 0) AS cost_usd, COALESCE(sum(total_tokens), 0) AS tokens
    FROM public.ai_usage_events e
    WHERE e.created_at >= p_from - (p_to - p_from) AND e.created_at < p_from
      AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  ),
  lat AS (
    SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95 FROM ev WHERE latency_ms IS NOT NULL
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'events', count(*),
        'chats', count(*) FILTER (WHERE assistant IN ('client', 'owner', 'agency')),
        'users', count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
        'prompt_tokens', COALESCE(sum(prompt_tokens), 0),
        'completion_tokens', COALESCE(sum(completion_tokens), 0),
        'tokens', COALESCE(sum(total_tokens), 0),
        'cost_usd', round(COALESCE(sum(cost_usd), 0), 4),
        'errors', count(*) FILTER (WHERE status <> 'ok'),
        'error_rate', CASE WHEN count(*) > 0
          THEN round(count(*) FILTER (WHERE status <> 'ok')::numeric / count(*) * 100, 1) ELSE 0 END,
        'avg_latency_ms', round(COALESCE(avg(latency_ms), 0)),
        'p95_latency_ms', COALESCE((SELECT round(p95) FROM lat), 0),
        'avg_turns', round(COALESCE(avg(turn_count) FILTER (WHERE assistant IN ('client', 'owner', 'agency')), 0), 1),
        'tool_events', count(*) FILTER (WHERE tool_calls IS NOT NULL AND cardinality(tool_calls) > 0),
        'prev_events', (SELECT n FROM prev),
        'prev_cost_usd', round((SELECT cost_usd FROM prev), 4),
        'prev_tokens', (SELECT tokens FROM prev)
      ) FROM ev
    ),
    'by_assistant', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'assistant', assistant, 'n', n, 'users', users, 'tokens', tokens,
        'cost_usd', round(cost_usd, 4), 'errors', errors, 'avg_latency_ms', avg_latency_ms,
        'avg_turns', avg_turns
      ) ORDER BY n DESC)
      FROM (
        SELECT assistant, count(*) AS n,
          count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS users,
          COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd,
          count(*) FILTER (WHERE status <> 'ok') AS errors,
          round(COALESCE(avg(latency_ms), 0)) AS avg_latency_ms,
          round(COALESCE(avg(turn_count), 0), 1) AS avg_turns
        FROM ev GROUP BY assistant
      ) s
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(x.d, 'YYYY-MM-DD'), 'n', x.n, 'client', x.client, 'owner', x.owner, 'agency', x.agency,
        'other', x.other, 'tokens', x.tokens, 'cost_usd', round(x.cost_usd, 4), 'errors', x.errors
      ) ORDER BY x.d)
      FROM (
        SELECT days.d,
          count(ev.id) AS n,
          count(ev.id) FILTER (WHERE ev.assistant IN ('client', 'client_search')) AS client,
          count(ev.id) FILTER (WHERE ev.assistant LIKE 'owner%') AS owner,
          count(ev.id) FILTER (WHERE ev.assistant = 'agency') AS agency,
          count(ev.id) FILTER (WHERE ev.assistant IN ('translate', 'embeddings')) AS other,
          COALESCE(sum(ev.total_tokens), 0) AS tokens,
          COALESCE(sum(ev.cost_usd), 0) AS cost_usd,
          count(ev.id) FILTER (WHERE ev.status <> 'ok') AS errors
        FROM days LEFT JOIN ev ON date(ev.created_at) = days.d
        GROUP BY days.d
      ) x
    ), '[]'::jsonb),
    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('h', h, 'n', n) ORDER BY h)
      FROM (
        SELECT extract(hour FROM created_at AT TIME ZONE 'Europe/Paris')::int AS h, count(*) AS n
        FROM ev WHERE assistant IN ('client', 'owner', 'agency') GROUP BY 1
      ) s
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('model', model, 'n', n, 'tokens', tokens, 'cost_usd', round(cost_usd, 4)) ORDER BY cost_usd DESC)
      FROM (SELECT model, count(*) AS n, COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd FROM ev GROUP BY model) s
    ), '[]'::jsonb),
    'by_language', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('language', COALESCE(language, '?'), 'n', n) ORDER BY n DESC)
      FROM (SELECT language, count(*) AS n FROM ev WHERE assistant IN ('client', 'owner', 'agency') GROUP BY language) s
    ), '[]'::jsonb),
    'top_users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.user_id, 'email', s.user_email,
        'name', COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.display_name),
        'n', s.n, 'tokens', s.tokens, 'cost_usd', round(s.cost_usd, 4),
        'assistants', s.assistants, 'last_at', s.last_at
      ) ORDER BY s.n DESC)
      FROM (
        SELECT user_id, max(user_email) AS user_email, count(*) AS n,
          COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd,
          array_agg(DISTINCT assistant) AS assistants, max(created_at) AS last_at
        FROM ev WHERE user_id IS NOT NULL
        GROUP BY user_id ORDER BY count(*) DESC LIMIT 12
      ) s LEFT JOIN public.profiles p ON p.id = s.user_id
    ), '[]'::jsonb),
    'top_tools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tool', tool, 'n', n, 'assistant', assistant) ORDER BY n DESC)
      FROM (
        SELECT u.tool, ev.assistant, count(*) AS n
        FROM ev, unnest(ev.tool_calls) AS u(tool)
        GROUP BY u.tool, ev.assistant ORDER BY count(*) DESC LIMIT 20
      ) s
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'assistant', assistant, 'model', model,
        'email', user_email, 'status', status, 'error', error,
        'tokens', total_tokens, 'cost_usd', round(cost_usd, 5), 'latency_ms', latency_ms,
        'turns', turn_count, 'tools', tool_calls, 'language', language,
        'prompt', prompt_preview, 'venue_id', venue_id
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM ev WHERE assistant IN ('client', 'owner', 'agency', 'client_search') ORDER BY created_at DESC LIMIT 60) r
    ), '[]'::jsonb),
    'recent_errors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'assistant', assistant, 'status', status, 'error', error, 'email', user_email
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM ev WHERE status <> 'ok' ORDER BY created_at DESC LIMIT 20) r
    ), '[]'::jsonb),
    'legacy_tool_audit', jsonb_build_object(
      'owner', (SELECT count(*) FROM public.owner_ai_audit_log a WHERE a.created_at >= p_from AND a.created_at <= p_to),
      'agency', (SELECT count(*) FROM public.agency_ai_audit_log a WHERE a.created_at >= p_from AND a.created_at <= p_to)
    )
  ) INTO v;

  RETURN v;
END $$;


CREATE OR REPLACE FUNCTION public.admin_cockpit(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_7d timestamptz := now() - interval '7 days';
  v_14d timestamptz := now() - interval '14 days';
  v_30d timestamptz := now() - interval '30 days';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  real_profiles AS (
    SELECT p.id, p.email, p.created_at
    FROM public.profiles p
    WHERE (p_include_demo OR NOT public.is_demo_email(p.email))
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  ),
  pro_ids AS (
    SELECT DISTINCT ur.user_id FROM public.user_roles ur
    WHERE ur.role::text IN ('owner','manager','organizer','promoter','affiliate','agency','dj','barman','bouncer','vip_host','cloakroom','admin')
  ),
  act AS (
    -- Une ligne par fait client : billet payé, table payée, commande payée,
    -- inscription guest list. Même définition qu'_admin_customer_activity.
    SELECT t.created_at, 'tickets'::text AS kind, t.total_price::numeric AS amount,
      COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric AS yuno, t.event_id
    FROM public.tickets t CROSS JOIN d
    WHERE t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')
      AND NOT COALESCE(t.event_id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
    UNION ALL
    SELECT tr.created_at, 'tables', tr.total_price::numeric,
      COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric, tr.event_id
    FROM public.table_reservations tr CROSS JOIN d
    WHERE tr.status IN ('paid', 'confirmed')
      AND NOT COALESCE(tr.event_id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
    UNION ALL
    SELECT o.created_at, 'drinks', o.total::numeric, COALESCE(o.service_fee, 0)::numeric, o.event_id
    FROM public.orders o CROSS JOIN d
    WHERE o.status IN ('paid', 'served')
      AND NOT COALESCE(o.venue_id = ANY (d.dv), false)
      AND (p_include_demo OR NOT public.is_demo_email(o.user_email))
    UNION ALL
    SELECT ge.created_at, 'guestlist', 0, 0, gl.event_id
    FROM public.guest_list_entries ge
    JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
    CROSS JOIN d
    WHERE ge.status IS DISTINCT FROM 'cancelled'
      AND NOT COALESCE(gl.event_id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(ge.email))
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', v_30d), date_trunc('day', now()), interval '1 day') gs(d)
  ),
  ai AS (
    SELECT e.created_at, e.assistant, e.cost_usd
    FROM public.ai_usage_events e
    WHERE e.created_at >= v_30d
      AND e.assistant IN ('client', 'owner', 'agency')
      AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
  ),
  sess AS (
    SELECT s.started_at, s.is_native, s.pageview_count FROM public.platform_sessions s WHERE s.started_at >= v_30d
  ),
  dev AS (
    SELECT od.app_id, od.first_seen, od.last_seen, od.version_name, od.platform FROM public.ota_devices od
  ),
  leads AS (
    SELECT l.created_at, 'links'::text AS src FROM public.links_pro_leads l
    UNION ALL SELECT c.created_at, 'contact' FROM public.pro_contact_leads c
  ),

  pulse AS (
    SELECT
      jsonb_build_object(
        'signups', (SELECT count(*) FROM real_profiles WHERE created_at >= v_today),
        'sessions', (SELECT count(*) FROM sess WHERE started_at >= v_today),
        'installs', (SELECT count(*) FROM dev WHERE first_seen >= v_today),
        'activity', (SELECT count(*) FROM act WHERE created_at >= v_today),
        'guestlist', (SELECT count(*) FROM act WHERE created_at >= v_today AND kind = 'guestlist'),
        'paid', (SELECT count(*) FROM act WHERE created_at >= v_today AND kind <> 'guestlist'),
        'gmv', (SELECT round(COALESCE(sum(amount), 0), 2) FROM act WHERE created_at >= v_today),
        'ai_chats', (SELECT count(*) FROM ai WHERE created_at >= v_today),
        'leads', (SELECT count(*) FROM leads WHERE created_at >= v_today),
        'waitlist', (SELECT count(*) FROM public.launch_waitlist w WHERE w.created_at >= v_today)
      ) AS today,
      jsonb_build_object(
        'signups', (SELECT count(*) FROM real_profiles WHERE created_at >= v_7d),
        'sessions', (SELECT count(*) FROM sess WHERE started_at >= v_7d),
        'installs', (SELECT count(*) FROM dev WHERE first_seen >= v_7d),
        'activity', (SELECT count(*) FROM act WHERE created_at >= v_7d),
        'guestlist', (SELECT count(*) FROM act WHERE created_at >= v_7d AND kind = 'guestlist'),
        'paid', (SELECT count(*) FROM act WHERE created_at >= v_7d AND kind <> 'guestlist'),
        'gmv', (SELECT round(COALESCE(sum(amount), 0), 2) FROM act WHERE created_at >= v_7d),
        'ai_chats', (SELECT count(*) FROM ai WHERE created_at >= v_7d),
        'leads', (SELECT count(*) FROM leads WHERE created_at >= v_7d),
        'waitlist', (SELECT count(*) FROM public.launch_waitlist w WHERE w.created_at >= v_7d)
      ) AS week,
      jsonb_build_object(
        'signups', (SELECT count(*) FROM real_profiles WHERE created_at >= v_14d AND created_at < v_7d),
        'sessions', (SELECT count(*) FROM sess WHERE started_at >= v_14d AND started_at < v_7d),
        'installs', (SELECT count(*) FROM dev WHERE first_seen >= v_14d AND first_seen < v_7d),
        'activity', (SELECT count(*) FROM act WHERE created_at >= v_14d AND created_at < v_7d),
        'guestlist', (SELECT count(*) FROM act WHERE created_at >= v_14d AND created_at < v_7d AND kind = 'guestlist'),
        'paid', (SELECT count(*) FROM act WHERE created_at >= v_14d AND created_at < v_7d AND kind <> 'guestlist'),
        'gmv', (SELECT round(COALESCE(sum(amount), 0), 2) FROM act WHERE created_at >= v_14d AND created_at < v_7d),
        'ai_chats', (SELECT count(*) FROM ai WHERE created_at >= v_14d AND created_at < v_7d),
        'leads', (SELECT count(*) FROM leads WHERE created_at >= v_14d AND created_at < v_7d),
        'waitlist', (SELECT count(*) FROM public.launch_waitlist w WHERE w.created_at >= v_14d AND w.created_at < v_7d)
      ) AS prev_week
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'include_demo', p_include_demo,
    'today', (SELECT today FROM pulse),
    'week', (SELECT week FROM pulse),
    'prev_week', (SELECT prev_week FROM pulse),
    'since_launch', jsonb_build_object(
      'accounts', (SELECT count(*) FROM real_profiles),
      'accounts_pro', (SELECT count(*) FROM real_profiles rp WHERE rp.id IN (SELECT user_id FROM pro_ids)),
      'accounts_client', (SELECT count(*) FROM real_profiles rp WHERE rp.id NOT IN (SELECT user_id FROM pro_ids)),
      'first_signup_at', (SELECT min(created_at) FROM real_profiles),
      'installs_client', (SELECT count(*) FROM dev WHERE app_id = 'eu.yunoapp.app'),
      'installs_pro', (SELECT count(*) FROM dev WHERE app_id = 'eu.yunoapp.pro'),
      'active_devices_7d', (SELECT count(*) FROM dev WHERE last_seen >= v_7d),
      'push_subscriptions', (SELECT count(DISTINCT ps.user_id) FROM public.push_subscriptions ps
         JOIN real_profiles rp ON rp.id = ps.user_id),
      'customers', (SELECT count(DISTINCT lower(em)) FROM public._admin_customer_activity()),
      'venues', (SELECT count(*) FROM public.venues v CROSS JOIN d
         WHERE v.decommissioned_at IS NULL AND NOT COALESCE(v.id = ANY (d.dv), false)),
      'organizers', (SELECT count(*) FROM public.organizer_profiles op
         JOIN real_profiles rp ON rp.id = op.user_id WHERE NOT COALESCE(op.is_showcase_shadow, false)),
      'agencies', (SELECT count(*) FROM public.agencies a JOIN real_profiles rp ON rp.id = a.owner_user_id),
      'events_total', (SELECT count(*) FROM public.events e CROSS JOIN d WHERE NOT COALESCE(e.id = ANY (d.de), false)),
      'events_upcoming', (SELECT count(*) FROM public.events e CROSS JOIN d
         WHERE NOT COALESCE(e.id = ANY (d.de), false) AND e.end_at >= now() AND e.cancelled_at IS NULL AND e.is_active),
      'gmv', (SELECT round(COALESCE(sum(amount), 0), 2) FROM act),
      'yuno_revenue', (SELECT round(COALESCE(sum(yuno), 0), 2) FROM act),
      'tickets', (SELECT count(*) FROM act WHERE kind = 'tickets'),
      'tables', (SELECT count(*) FROM act WHERE kind = 'tables'),
      'drinks', (SELECT count(*) FROM act WHERE kind = 'drinks'),
      'guestlist', (SELECT count(*) FROM act WHERE kind = 'guestlist'),
      'waitlist', (SELECT count(*) FROM public.launch_waitlist),
      'leads', (SELECT count(*) FROM leads),
      'ai_chats_30d', (SELECT count(*) FROM ai),
      'ai_cost_30d_usd', (SELECT round(COALESCE(sum(cost_usd), 0), 2) FROM ai)
    ),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(days.d, 'YYYY-MM-DD'),
        'signups', (SELECT count(*) FROM real_profiles rp WHERE date(rp.created_at) = days.d),
        'sessions', (SELECT count(*) FROM sess s WHERE date(s.started_at) = days.d),
        'installs', (SELECT count(*) FROM dev WHERE date(dev.first_seen) = days.d),
        'activity', (SELECT count(*) FROM act a WHERE date(a.created_at) = days.d),
        'guestlist', (SELECT count(*) FROM act a WHERE date(a.created_at) = days.d AND a.kind = 'guestlist'),
        'paid', (SELECT count(*) FROM act a WHERE date(a.created_at) = days.d AND a.kind <> 'guestlist'),
        'ai', (SELECT count(*) FROM ai WHERE date(ai.created_at) = days.d)
      ) ORDER BY days.d)
      FROM days
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'unread_alerts', (SELECT count(*) FROM public.admin_notifications n WHERE n.read_at IS NULL AND n.scope = 'platform'),
      'urgent_alerts', (SELECT count(*) FROM public.admin_notifications n WHERE n.read_at IS NULL AND n.scope = 'platform' AND n.priority IN ('urgent', 'high')),
      'deadlines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('key', key, 'label', label, 'provider', provider, 'due_at', due_at, 'severity', severity,
          'days_left', (due_at - CURRENT_DATE)) ORDER BY due_at)
        FROM public.admin_credential_deadlines cd
        WHERE cd.is_active AND cd.due_at IS NOT NULL AND cd.due_at <= CURRENT_DATE + 45
      ), '[]'::jsonb),
      'undated_deadlines', (SELECT count(*) FROM public.admin_credential_deadlines cd WHERE cd.is_active AND cd.due_at IS NULL),
      -- L'historique pg_cron (56 Mo, sans index, pas indexable par postgres)
      -- coûte 3 s par balayage : il vit dans admin_release_health(), chargé à
      -- part par le front, jamais dans le cockpit.
      'crons_total', (SELECT count(*) FROM cron.job j WHERE j.active),
      'app_crashes_7d', (SELECT count(*) FROM public.ota_stats s WHERE s.created_at >= v_7d AND s.action IN ('app_crash', 'webview_javascript_error', 'update_fail')),
      'ota_download_fail_7d', (SELECT count(*) FROM public.ota_stats s WHERE s.created_at >= v_7d AND s.action = 'download_fail'),
      'ai_errors_24h', (SELECT count(*) FROM public.ai_usage_events e WHERE e.created_at >= now() - interval '24 hours' AND e.status <> 'ok'),
      'maintenance_mode', COALESCE((SELECT maintenance_mode FROM public.app_settings WHERE id = 'global'), false),
      'payments_disabled', COALESCE((SELECT payments_disabled FROM public.app_settings WHERE id = 'global'), false),
      'open_feedback', (SELECT count(*) FROM public.feedback_issues f WHERE f.status IN ('open', 'in_progress')),
      'security_failures_24h', (SELECT count(*) FROM public.security_logs s WHERE s.created_at >= now() - interval '24 hours' AND s.success = false),
      'pending_support', (SELECT count(*) FROM public.admin_support_grants g WHERE g.status = 'pending'),
      'pending_claims', (SELECT count(*) FROM public.showcase_claim_requests c WHERE c.status = 'pending'),
      'uncontacted_leads', (SELECT count(*) FROM public.links_pro_leads l WHERE l.contacted_at IS NULL),
      'pending_moderation', (SELECT count(*) FROM public.events e CROSS JOIN d WHERE e.discovery_status::text = 'pending' AND NOT COALESCE(e.id = ANY (d.de), false)),
      'email_quota', public.get_email_quota_status(NULL, NULL)
    ),
    'ota', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'app_id', a.app_id,
        'latest', a.latest,
        'devices', a.devices,
        'on_latest', a.on_latest,
        'adoption_pct', CASE WHEN a.devices > 0 THEN round(a.on_latest::numeric / a.devices * 100) ELSE 0 END,
        'active_7d', a.active_7d
      ) ORDER BY a.app_id)
      FROM (
        SELECT c.app_id,
          (SELECT b.version FROM public.ota_bundles b WHERE b.app_id = c.app_id AND b.channel = 'production' AND b.active ORDER BY b.created_at DESC LIMIT 1) AS latest,
          (SELECT count(*) FROM dev WHERE dev.app_id = c.app_id) AS devices,
          (SELECT count(*) FROM dev WHERE dev.app_id = c.app_id AND dev.version_name = (SELECT b.version FROM public.ota_bundles b WHERE b.app_id = c.app_id AND b.channel = 'production' AND b.active ORDER BY b.created_at DESC LIMIT 1)) AS on_latest,
          (SELECT count(*) FROM dev WHERE dev.app_id = c.app_id AND dev.last_seen >= v_7d) AS active_7d
        FROM (SELECT DISTINCT app_id FROM public.ota_channels) c
      ) a
    ), '[]'::jsonb),
    'upcoming_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
        'venue_name', COALESCE(v.name, e.location_name), 'city', COALESCE(v.city, e.location_city),
        'organizer', op.display_name, 'is_live', (e.start_at <= now() AND e.end_at >= now()),
        'ticketing', e.ticketing_enabled, 'tables', e.tables_enabled,
        'tickets_sold', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
        'tables_booked', (SELECT count(*) FROM public.table_reservations tr WHERE tr.event_id = e.id AND tr.status IN ('paid', 'confirmed')),
        'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.status IS DISTINCT FROM 'cancelled'),
        'views_7d', (SELECT count(*) FROM public.platform_page_views pv WHERE pv.occurred_at >= v_7d AND (pv.path LIKE '/event/' || e.id::text || '%' OR (e.slug IS NOT NULL AND pv.path LIKE '%/' || e.slug)))
      ) ORDER BY e.start_at)
      FROM (
        SELECT e.* FROM public.events e CROSS JOIN d
        WHERE NOT COALESCE(e.id = ANY (d.de), false)
          AND e.end_at >= now() AND e.cancelled_at IS NULL AND e.is_active
        ORDER BY e.start_at LIMIT 8
      ) e
      LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
      LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
    ), '[]'::jsonb),
    'recent_signups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rp.id, 'email', rp.email, 'at', rp.created_at,
        'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'city', p.city, 'is_pro', (rp.id IN (SELECT user_id FROM pro_ids)),
        'has_app', EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = rp.id)
      ) ORDER BY rp.created_at DESC)
      FROM (SELECT * FROM real_profiles ORDER BY created_at DESC LIMIT 8) rp
      JOIN public.profiles p ON p.id = rp.id
    ), '[]'::jsonb),
    'top_pages_7d', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('group', page_group, 'views', n) ORDER BY n DESC)
      FROM (SELECT page_group, count(*) AS n FROM public.platform_page_views WHERE occurred_at >= v_7d GROUP BY page_group) s
    ), '[]'::jsonb),
    'sessions_split_7d', jsonb_build_object(
      'native', (SELECT count(*) FROM sess WHERE started_at >= v_7d AND is_native),
      'web', (SELECT count(*) FROM sess WHERE started_at >= v_7d AND NOT is_native)
    )
  ) INTO v;

  RETURN v;
END $$;


CREATE OR REPLACE FUNCTION public.admin_release_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
  v_7d timestamptz := now() - interval '7 days';
  v_30d timestamptz := now() - interval '30 days';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH cron_recent AS MATERIALIZED (
    SELECT r.jobid, r.status, r.start_time, r.end_time, r.return_message
    FROM cron.job_run_details r WHERE r.start_time >= v_7d
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'apps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'app_id', a.app_id,
        'name', CASE WHEN a.app_id = 'eu.yunoapp.pro' THEN 'Yuno Pro' ELSE 'Yuno' END,
        'channels', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('channel', b.channel, 'version', b.version, 'native_version', b.native_version,
            'published_at', b.created_at, 'size_mb', round(b.size_bytes / 1048576.0, 1), 'notes', b.notes) ORDER BY b.channel)
          FROM (
            SELECT DISTINCT ON (channel) * FROM public.ota_bundles b WHERE b.app_id = a.app_id AND b.active ORDER BY channel, created_at DESC
          ) b
        ), '[]'::jsonb),
        'devices', (SELECT count(*) FROM public.ota_devices od WHERE od.app_id = a.app_id),
        'active_7d', (SELECT count(*) FROM public.ota_devices od WHERE od.app_id = a.app_id AND od.last_seen >= v_7d),
        'active_30d', (SELECT count(*) FROM public.ota_devices od WHERE od.app_id = a.app_id AND od.last_seen >= v_30d),
        'new_7d', (SELECT count(*) FROM public.ota_devices od WHERE od.app_id = a.app_id AND od.first_seen >= v_7d),
        'by_version', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('version', version_name, 'n', n, 'active_7d', a7) ORDER BY n DESC)
          FROM (SELECT od.version_name, count(*) AS n, count(*) FILTER (WHERE od.last_seen >= v_7d) AS a7 FROM public.ota_devices od WHERE od.app_id = a.app_id GROUP BY od.version_name ORDER BY count(*) DESC LIMIT 10) x
        ), '[]'::jsonb),
        'by_native', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('version', native_version, 'n', n) ORDER BY n DESC)
          FROM (SELECT od.native_version, count(*) AS n FROM public.ota_devices od WHERE od.app_id = a.app_id GROUP BY od.native_version) x
        ), '[]'::jsonb),
        'by_platform', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('platform', platform, 'n', n) ORDER BY n DESC)
          FROM (SELECT COALESCE(od.platform, '?') AS platform, count(*) AS n FROM public.ota_devices od WHERE od.app_id = a.app_id GROUP BY 1) x
        ), '[]'::jsonb),
        'events_7d', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('action', action, 'n', n) ORDER BY n DESC)
          FROM (SELECT s.action, count(*) AS n FROM public.ota_stats s WHERE s.app_id = a.app_id AND s.created_at >= v_7d GROUP BY s.action) x
        ), '[]'::jsonb),
        'crashes_7d', (SELECT count(*) FROM public.ota_stats s WHERE s.app_id = a.app_id AND s.created_at >= v_7d AND s.action IN ('app_crash', 'webview_javascript_error', 'update_fail')),
        'download_fail_7d', (SELECT count(*) FROM public.ota_stats s WHERE s.app_id = a.app_id AND s.created_at >= v_7d AND s.action = 'download_fail')
      ) ORDER BY a.app_id)
      FROM (SELECT DISTINCT app_id FROM public.ota_channels) a
    ), '[]'::jsonb),
    'recent_bundles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('app_id', b.app_id, 'channel', b.channel, 'version', b.version, 'native_version', b.native_version,
        'active', b.active, 'at', b.created_at, 'size_mb', round(b.size_bytes / 1048576.0, 1), 'notes', b.notes) ORDER BY b.created_at DESC)
      FROM (SELECT * FROM public.ota_bundles ORDER BY created_at DESC LIMIT 12) b
    ), '[]'::jsonb),
    'crash_log', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', s.created_at, 'app_id', s.app_id, 'action', s.action, 'version', s.version_name, 'platform', s.platform,
        'detail', left(COALESCE(s.payload::text, ''), 300)) ORDER BY s.created_at DESC)
      FROM (SELECT * FROM public.ota_stats s WHERE s.action IN ('app_crash', 'webview_javascript_error', 'update_fail', 'download_fail', 'webview_resource_error') ORDER BY s.created_at DESC LIMIT 25) s
    ), '[]'::jsonb),
    'crons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'target', CASE WHEN j.command ~ '/functions/v1/' THEN substring(j.command FROM '/functions/v1/([a-zA-Z0-9_-]+)') ELSE substring(j.command FROM 'public\.([a-zA-Z0-9_]+)\(') END,
        'kind', CASE WHEN j.command ~ '/functions/v1/' THEN 'edge' ELSE 'sql' END,
        'last_status', lr.status, 'last_start', lr.start_time,
        'last_ms', CASE WHEN lr.end_time IS NOT NULL THEN round(extract(epoch FROM (lr.end_time - lr.start_time)) * 1000) END,
        'last_message', left(lr.return_message, 160),
        'runs_24h', (SELECT count(*) FROM cron_recent r WHERE r.jobid = j.jobid AND r.start_time >= now() - interval '24 hours'),
        'fails_7d', (SELECT count(*) FROM cron_recent r WHERE r.jobid = j.jobid AND r.status <> 'succeeded')
      ) ORDER BY j.jobname)
      FROM cron.job j
      LEFT JOIN LATERAL (SELECT r.status, r.start_time, r.end_time, r.return_message FROM cron_recent r WHERE r.jobid = j.jobid ORDER BY r.start_time DESC LIMIT 1) lr ON true
    ), '[]'::jsonb),
    'cron_failures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', j.jobname, 'at', r.start_time, 'status', r.status, 'message', left(r.return_message, 300)) ORDER BY r.start_time DESC)
      FROM (SELECT * FROM cron_recent r WHERE r.status <> 'succeeded' ORDER BY r.start_time DESC LIMIT 15) r
      JOIN cron.job j ON j.jobid = r.jobid
    ), '[]'::jsonb),
    'security', jsonb_build_object(
      'by_action_7d', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', action, 'n', n, 'failed', f) ORDER BY n DESC)
        FROM (SELECT s.action, count(*) AS n, count(*) FILTER (WHERE s.success = false) AS f FROM public.security_logs s WHERE s.created_at >= v_7d GROUP BY s.action) x), '[]'::jsonb),
      'failures_24h', (SELECT count(*) FROM public.security_logs s WHERE s.created_at >= now() - interval '24 hours' AND s.success = false),
      'mfa_enabled_users', (SELECT count(*) FROM public.profiles p WHERE p.mfa_enabled),
      'suspended_users', (SELECT count(*) FROM public.profiles p WHERE p.is_suspended),
      'active_support_sessions', (SELECT count(*) FROM public.admin_support_sessions s WHERE s.status = 'active'),
      'recent_admin_actions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id) ORDER BY a.created_at DESC)
        FROM (SELECT * FROM public.admin_audit_log ORDER BY created_at DESC LIMIT 8) a
      ), '[]'::jsonb)
    ),
    'database', jsonb_build_object(
      'size_mb', round(pg_database_size(current_database()) / 1048576.0),
      'migrations', (SELECT count(*) FROM supabase_migrations.schema_migrations),
      'latest_migration', (SELECT max(version) FROM supabase_migrations.schema_migrations),
      'tables', (SELECT count(*) FROM pg_stat_user_tables WHERE schemaname = 'public'),
      'largest', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup, 'mb', mb) ORDER BY mb DESC)
        FROM (SELECT relname, n_live_tup, round(pg_total_relation_size(relid) / 1048576.0, 1) AS mb FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 10) x
      ), '[]'::jsonb),
      'dead_tuples_top', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('table', relname, 'dead', n_dead_tup) ORDER BY n_dead_tup DESC)
        FROM (SELECT relname, n_dead_tup FROM pg_stat_user_tables WHERE schemaname = 'public' AND n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 5) x
      ), '[]'::jsonb)
    ),
    'settings', jsonb_build_object(
      'maintenance_mode', COALESCE((SELECT maintenance_mode FROM public.app_settings WHERE id = 'global'), false),
      'maintenance_message', (SELECT maintenance_message FROM public.app_settings WHERE id = 'global'),
      'payments_disabled', COALESCE((SELECT payments_disabled FROM public.app_settings WHERE id = 'global'), false),
      'settings_updated_at', (SELECT updated_at FROM public.app_settings WHERE id = 'global'),
      'push_keys_disabled', (SELECT count(*) FROM public.platform_notification_settings s WHERE NOT s.enabled),
      'push_keys_total', (SELECT count(*) FROM public.platform_notification_settings),
      'demo_live', COALESCE((SELECT public.demo_is_live()), false)
    ),
    'email', jsonb_build_object(
      'quota', public.get_email_quota_status(NULL, NULL),
      'sender', (SELECT jsonb_build_object('trust_level', s.trust_level, 'lifetime_sent', s.lifetime_sent, 'daily_cap', s.daily_cap_override, 'restricted_reason', s.restricted_reason)
        FROM public.email_sender_state s WHERE s.scope_key = 'yuno'),
      'transactional_month', (SELECT COALESCE(sum(sent), 0) FROM public.email_send_quota_month q WHERE q.scope_key = 'transactional' AND q.month = date_trunc('month', now())::date),
      'suppressions_30d', (SELECT count(*) FROM public.email_suppressions es WHERE es.created_at >= v_30d)
    ),
    'push', jsonb_build_object(
      'subscriptions', (SELECT count(*) FROM public.push_subscriptions),
      'by_platform', COALESCE((SELECT jsonb_agg(jsonb_build_object('platform', platform, 'n', n)) FROM (SELECT COALESCE(platform, 'web') AS platform, count(*) AS n FROM public.push_subscriptions GROUP BY 1) x), '[]'::jsonb),
      'auto_failed_7d', (SELECT count(*) FROM public.auto_push_events e WHERE e.created_at >= v_7d AND e.event_type = 'failed'),
      'auto_sent_7d', (SELECT count(*) FROM public.auto_push_events e WHERE e.created_at >= v_7d AND e.event_type = 'sent'),
      'queue_pending', (SELECT count(*) FROM public.promoter_push_queue q WHERE q.sent_at IS NULL)
    ),
    'ai', jsonb_build_object(
      'events_24h', (SELECT count(*) FROM public.ai_usage_events e WHERE e.created_at >= now() - interval '24 hours'),
      'errors_24h', (SELECT count(*) FROM public.ai_usage_events e WHERE e.created_at >= now() - interval '24 hours' AND e.status <> 'ok'),
      'cost_30d_usd', (SELECT round(COALESCE(sum(cost_usd), 0), 2) FROM public.ai_usage_events e WHERE e.created_at >= v_30d),
      'p95_latency_ms_7d', COALESCE((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM public.ai_usage_events e WHERE e.created_at >= v_7d AND e.latency_ms IS NOT NULL), 0)
    )
  ) INTO v;

  RETURN v;
END $$;


-- ─── Historique pg_cron : purge à 30 jours ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-history-purge';
    PERFORM cron.schedule('cron-history-purge', '50 3 * * *',
      $cron$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '30 days'; $cron$);
  END IF;
END $$;
