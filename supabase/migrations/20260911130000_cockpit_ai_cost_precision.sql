-- Le coût IA du cockpit était arrondi à 2 décimales : tant que la facture reste
-- sous le centime — c'est-à-dire au lancement — la tuile affichait « 0,00 $ »
-- alors que /admin/ai montrait un montant. Quatre décimales rendent le premier
-- centime visible, et la tuile cesse de contredire la page.

CREATE OR REPLACE FUNCTION public.admin_cockpit(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'ai_cost_30d_usd', (SELECT round(COALESCE(sum(cost_usd), 0), 4) FROM ai)
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
END $function$
;
