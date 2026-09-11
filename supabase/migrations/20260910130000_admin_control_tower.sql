-- ─── Tour de contrôle super admin ───────────────────────────────────────────
-- Six lectures, toutes gatées par is_super_admin(), toutes démo-exclues par
-- défaut via la porte unique (is_demo_email / demo_venue_ids / demo_event_ids),
-- évaluée UNE fois par requête dans un CTE MATERIALIZED (jamais dans un
-- prédicat, cf. section « Tracking super admin » de CLAUDE.md).
--
--   admin_cockpit(p_include_demo)              page d'accueil /admin
--   admin_activity_feed(limit, before, demo)   journal « ce qui s'est passé »
--   admin_product_insights(from, to, demo)     ce que les clients regardent / aiment
--   admin_release_health()                     OTA, crashs, crons, base, réglages
--   admin_directory_counts()                   compteurs de l'annuaire, démo exclue
--   admin_venue_overview(venue_id)             fiche club, chiffres justes

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Cockpit
-- ═══════════════════════════════════════════════════════════════════════════
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
      'crons_failed_24h', (SELECT count(*) FROM cron.job_run_details r WHERE r.start_time >= now() - interval '24 hours' AND r.status <> 'succeeded'),
      'crons_total', (SELECT count(*) FROM cron.job j WHERE j.active),
      'crons_last_run', (SELECT max(r.start_time) FROM cron.job_run_details r),
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

REVOKE ALL ON FUNCTION public.admin_cockpit(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cockpit(boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Journal d'activité (ce qui s'est passé, toutes sources, démo exclue)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_activity_feed(
  p_limit integer DEFAULT 60,
  p_before timestamptz DEFAULT NULL,
  p_include_demo boolean DEFAULT false,
  p_kinds text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
  v_before timestamptz := COALESCE(p_before, now() + interval '1 minute');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  feed AS (
    -- Inscriptions
    SELECT p.created_at AS at, 'signup'::text AS kind,
      COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) AS title,
      COALESCE(p.city, '') AS subtitle, 'user'::text AS ref_type, p.id::text AS ref_id, NULL::numeric AS amount, p.email AS actor
    FROM public.profiles p
    WHERE p.created_at < v_before AND (p_include_demo OR NOT public.is_demo_email(p.email))
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
    UNION ALL
    -- Soirées créées
    SELECT e.created_at, 'event_created', e.title,
      COALESCE(v.name, e.location_name, e.location_city, ''), 'event', e.id::text, NULL, COALESCE(op.display_name, v.name)
    FROM public.events e CROSS JOIN d
    LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
    LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
    WHERE e.created_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
    UNION ALL
    -- Soirées publiées
    SELECT e.published_at, 'event_published', e.title,
      COALESCE(v.name, e.location_name, e.location_city, ''), 'event', e.id::text, NULL, COALESCE(op.display_name, v.name)
    FROM public.events e CROSS JOIN d
    LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
    LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
    WHERE e.published_at IS NOT NULL AND e.published_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
      AND e.published_at > e.created_at + interval '1 minute'
    UNION ALL
    -- Guest list
    SELECT ge.created_at, 'guestlist', COALESCE(ge.full_name, ge.email, ''), e.title, 'event', e.id::text, NULL, ge.email
    FROM public.guest_list_entries ge
    JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
    JOIN public.events e ON e.id = gl.event_id
    CROSS JOIN d
    WHERE ge.created_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(ge.email))
    UNION ALL
    -- Billets
    SELECT t.created_at, 'ticket', COALESCE(t.full_name, t.user_email, ''), e.title, 'event', e.id::text, t.total_price::numeric, t.user_email
    FROM public.tickets t JOIN public.events e ON e.id = t.event_id CROSS JOIN d
    WHERE t.paid_at IS NOT NULL AND t.created_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
    UNION ALL
    -- Tables
    SELECT tr.created_at, 'table', COALESCE(tr.full_name, tr.user_email, ''), e.title, 'event', e.id::text, tr.total_price::numeric, tr.user_email
    FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id CROSS JOIN d
    WHERE tr.status IN ('paid', 'confirmed') AND tr.created_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
      AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
    UNION ALL
    -- Commandes de boissons
    SELECT o.created_at, 'order', COALESCE(o.user_email, ''), v.name, 'venue', v.id, o.total::numeric, o.user_email
    FROM public.orders o JOIN public.venues v ON v.id = o.venue_id CROSS JOIN d
    WHERE o.status IN ('paid', 'served') AND o.created_at < v_before AND NOT COALESCE(v.id = ANY (d.dv), false)
      AND (p_include_demo OR NOT public.is_demo_email(o.user_email))
    UNION ALL
    -- Conversations IA
    SELECT a.created_at, 'ai_' || a.assistant, COALESCE(a.prompt_preview, ''), COALESCE(a.user_email, ''), 'ai', a.id::text, a.cost_usd, a.user_email
    FROM public.ai_usage_events a
    WHERE a.assistant IN ('client', 'owner', 'agency') AND a.created_at < v_before
      AND (p_include_demo OR NOT public.is_demo_email(a.user_email))
    UNION ALL
    -- Leads pro
    SELECT l.created_at, 'lead', COALESCE(l.org_name, l.name, ''), concat_ws(' · ', l.org_type, l.city), 'lead', l.id::text, NULL, l.email
    FROM public.links_pro_leads l WHERE l.created_at < v_before
    UNION ALL
    SELECT c.created_at, 'lead', COALESCE(c.club_name, c.name, ''), COALESCE(c.city, ''), 'lead', c.id::text, NULL, c.email
    FROM public.pro_contact_leads c WHERE c.created_at < v_before
    UNION ALL
    -- Liste d'attente
    SELECT w.created_at, 'waitlist', COALESCE(w.first_name, w.email), COALESCE(w.city, ''), 'waitlist', w.id::text, NULL, w.email
    FROM public.launch_waitlist w WHERE w.created_at < v_before
    UNION ALL
    -- Nouveaux organisateurs
    SELECT op.created_at, 'organizer', op.display_name, COALESCE(op.city, ''), 'organizer', op.user_id::text, NULL, p.email
    FROM public.organizer_profiles op JOIN public.profiles p ON p.id = op.user_id
    WHERE op.created_at < v_before AND NOT COALESCE(op.is_showcase_shadow, false)
      AND (p_include_demo OR NOT public.is_demo_email(p.email))
    UNION ALL
    -- Nouveaux clubs
    SELECT v.created_at, 'venue', v.name, COALESCE(v.city, ''), 'venue', v.id, NULL, NULL
    FROM public.venues v CROSS JOIN d
    WHERE v.created_at < v_before AND NOT COALESCE(v.id = ANY (d.dv), false)
    UNION ALL
    -- Nouvelles agences
    SELECT a.created_at, 'agency', a.name, COALESCE(a.city, ''), 'agency', a.id::text, NULL, p.email
    FROM public.agencies a JOIN public.profiles p ON p.id = a.owner_user_id
    WHERE a.created_at < v_before AND (p_include_demo OR NOT public.is_demo_email(p.email))
    UNION ALL
    -- Installations d'app
    SELECT od.first_seen, 'install', CASE WHEN od.app_id = 'eu.yunoapp.pro' THEN 'Yuno Pro' ELSE 'Yuno' END,
      concat_ws(' · ', od.platform, od.native_version), 'device', od.device_id, NULL, NULL
    FROM public.ota_devices od WHERE od.first_seen < v_before
    UNION ALL
    -- Retours / bugs
    SELECT f.created_at, 'feedback', f.title, concat_ws(' · ', f.category, f.priority), 'feedback', f.id::text, NULL, p.email
    FROM public.feedback_issues f LEFT JOIN public.profiles p ON p.id = f.reported_by
    WHERE f.created_at < v_before
    UNION ALL
    -- Accès assisté
    SELECT g.created_at, 'support', COALESCE(p.email, ''), g.status, 'user', g.target_user_id::text, NULL, p.email
    FROM public.admin_support_grants g LEFT JOIN public.profiles p ON p.id = g.target_user_id
    WHERE g.created_at < v_before
    UNION ALL
    -- Abonnés (follows)
    SELECT fe.created_at, CASE WHEN fe.action = 'unfollow' THEN 'unfollow' ELSE 'follow' END,
      COALESCE(v.name, op.display_name, dj.stage_name, fe.subject_id), fe.subject_type, fe.subject_type, fe.subject_id, NULL, p.email
    FROM public.audience_follow_events fe
    LEFT JOIN public.profiles p ON p.id = fe.follower_user_id
    LEFT JOIN public.venues v ON fe.subject_type = 'venue' AND v.id = fe.subject_id
    LEFT JOIN public.organizer_profiles op ON fe.subject_type = 'organizer' AND op.user_id::text = fe.subject_id
    LEFT JOIN public.djs dj ON fe.subject_type = 'dj' AND dj.id::text = fe.subject_id
    WHERE fe.created_at < v_before AND (p_include_demo OR NOT public.is_demo_email(p.email))
    UNION ALL
    -- Alertes plateforme urgentes
    SELECT n.created_at, 'alert', n.title, COALESCE(n.message, ''), 'alert', n.id::text, NULL, NULL
    FROM public.admin_notifications n
    WHERE n.scope = 'platform' AND n.priority IN ('urgent', 'high') AND n.created_at < v_before
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'at', f.at, 'kind', f.kind, 'title', f.title, 'subtitle', f.subtitle,
    'ref_type', f.ref_type, 'ref_id', f.ref_id, 'amount', f.amount, 'actor', f.actor
  ) ORDER BY f.at DESC), '[]'::jsonb)
  INTO v
  FROM (
    SELECT * FROM feed f
    WHERE f.at IS NOT NULL AND (p_kinds IS NULL OR f.kind = ANY (p_kinds))
    ORDER BY f.at DESC LIMIT v_limit
  ) f;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_activity_feed(integer, timestamptz, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_feed(integer, timestamptz, boolean, text[]) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Insights produit — ce que les clients regardent, aiment, demandent
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_product_insights(
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

  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  real_profiles AS (
    SELECT p.* FROM public.profiles p
    WHERE (p_include_demo OR NOT public.is_demo_email(p.email))
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  ),
  pv AS (
    SELECT pv.path, pv.page_group, pv.duration_seconds, pv.occurred_at, pv.session_id
    FROM public.platform_page_views pv
    WHERE pv.occurred_at >= p_from AND pv.occurred_at <= p_to
  ),
  ev_views AS (
    -- Une vue de page soirée → la soirée : /event/<uuid>, /events/<venue>/<slug>,
    -- /club/<venue>/event/<slug>. Les soirées partenaires (/affiliate-event/<slug>)
    -- restent des chemins bruts.
    SELECT e.id, e.title, e.start_at, COALESCE(vn.name, e.location_name) AS venue_name,
      count(*) AS views, count(DISTINCT pv.session_id) AS sessions, round(avg(pv.duration_seconds)) AS avg_seconds
    FROM pv
    JOIN public.events e ON (
      pv.path LIKE '/event/' || e.id::text || '%'
      OR (e.slug IS NOT NULL AND (pv.path ~ ('^/events/[^/]+/' || e.slug || '$') OR pv.path ~ ('^/club/[^/]+/event/' || e.slug || '$')))
    )
    CROSS JOIN d
    LEFT JOIN public.venues vn ON vn.id = COALESCE(e.venue_id, e.partner_venue_id)
    WHERE pv.page_group = 'event' AND NOT COALESCE(e.id = ANY (d.de), false)
    GROUP BY e.id, e.title, e.start_at, vn.name
  ),
  fav AS (
    SELECT f.* FROM public.favorites f JOIN real_profiles rp ON rp.id = f.user_id
  )
  SELECT jsonb_build_object(
    'page_groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('group', page_group, 'views', n, 'sessions', s, 'avg_seconds', avg_s) ORDER BY n DESC)
      FROM (SELECT page_group, count(*) AS n, count(DISTINCT session_id) AS s, round(avg(duration_seconds)) AS avg_s FROM pv GROUP BY page_group) x
    ), '[]'::jsonb),
    'top_events_viewed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'start_at', start_at, 'venue_name', venue_name,
        'views', views, 'sessions', sessions, 'avg_seconds', avg_seconds,
        'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = ev_views.id AND ge.created_at >= p_from AND ge.created_at <= p_to),
        'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = ev_views.id AND t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to)
      ) ORDER BY views DESC)
      FROM (SELECT * FROM ev_views ORDER BY views DESC LIMIT 12) ev_views
    ), '[]'::jsonb),
    'top_paths', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('path', path, 'group', page_group, 'views', n, 'avg_seconds', avg_s) ORDER BY n DESC)
      FROM (SELECT path, page_group, count(*) AS n, round(avg(duration_seconds)) AS avg_s FROM pv
            WHERE page_group IN ('venue', 'browse', 'explore', 'dj', 'promo-link', 'other') GROUP BY path, page_group ORDER BY count(*) DESC LIMIT 15) x
    ), '[]'::jsonb),
    'favorites', jsonb_build_object(
      'by_type', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('type', favorite_type, 'period', n_period, 'total', n_total) ORDER BY n_total DESC)
        FROM (SELECT favorite_type, count(*) FILTER (WHERE created_at >= p_from AND created_at <= p_to) AS n_period, count(*) AS n_total FROM fav GROUP BY favorite_type) x
      ), '[]'::jsonb),
      'top_events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT event_id, count(*) AS n FROM fav WHERE event_id IS NOT NULL GROUP BY event_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.events e ON e.id = x.event_id CROSS JOIN d WHERE NOT COALESCE(e.id = ANY (d.de), false)
      ), '[]'::jsonb),
      'top_venues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', vn.id, 'name', vn.name, 'city', vn.city, 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT venue_id, count(*) AS n FROM fav WHERE venue_id IS NOT NULL GROUP BY venue_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.venues vn ON vn.id = x.venue_id CROSS JOIN d WHERE NOT COALESCE(vn.id = ANY (d.dv), false)
      ), '[]'::jsonb),
      'top_djs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', dj.id, 'name', COALESCE(dj.stage_name, dj.first_name), 'n', x.n) ORDER BY x.n DESC)
        FROM (SELECT dj_id, count(*) AS n FROM fav WHERE dj_id IS NOT NULL GROUP BY dj_id ORDER BY count(*) DESC LIMIT 8) x
        JOIN public.djs dj ON dj.id = x.dj_id
      ), '[]'::jsonb)
    ),
    'follows', jsonb_build_object(
      'by_subject', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('subject', subject_type, 'follows', f, 'unfollows', u) ORDER BY f DESC)
        FROM (SELECT fe.subject_type, count(*) FILTER (WHERE fe.action = 'follow') AS f, count(*) FILTER (WHERE fe.action = 'unfollow') AS u
              FROM public.audience_follow_events fe JOIN real_profiles rp ON rp.id = fe.follower_user_id
              WHERE fe.created_at >= p_from AND fe.created_at <= p_to GROUP BY fe.subject_type) x
      ), '[]'::jsonb)
    ),
    'taste', jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id),
      'genres', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('k', g, 'n', n) ORDER BY n DESC)
        FROM (SELECT g, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id, unnest(COALESCE(tp.genres, ARRAY[tp.music_style])) AS g WHERE g IS NOT NULL GROUP BY g ORDER BY count(*) DESC LIMIT 12) x
      ), '[]'::jsonb),
      'night_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.night_type AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.night_type IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'budget', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.budget AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.budget IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'frequency', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.frequency AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.frequency IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'drink', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.drink_preference AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.drink_preference IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'booking', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT tp.booking_pref AS k, count(*) AS n FROM public.user_taste_profiles tp JOIN real_profiles rp ON rp.id = tp.user_id WHERE tp.booking_pref IS NOT NULL GROUP BY 1) x), '[]'::jsonb)
    ),
    'audience', jsonb_build_object(
      'cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT initcap(lower(trim(city))) AS k, count(*) AS n FROM real_profiles WHERE NULLIF(trim(city), '') IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 12) x), '[]'::jsonb),
      'languages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(preferred_language, '?') AS k, count(*) AS n FROM real_profiles GROUP BY 1) x), '[]'::jsonb),
      'genders', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(gender, '?') AS k, count(*) AS n FROM real_profiles GROUP BY 1) x), '[]'::jsonb),
      'ages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY k) FROM (
        SELECT CASE
          WHEN age < 18 THEN '<18' WHEN age < 21 THEN '18-20' WHEN age < 25 THEN '21-24'
          WHEN age < 30 THEN '25-29' WHEN age < 35 THEN '30-34' ELSE '35+' END AS k, count(*) AS n
        FROM (SELECT date_part('year', age(birth_date))::int AS age FROM real_profiles WHERE birth_date IS NOT NULL) a GROUP BY 1) x), '[]'::jsonb),
      'personas', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT party_persona AS k, count(*) AS n FROM real_profiles WHERE party_persona IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'session_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(country, '?') AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1 ORDER BY count(*) DESC LIMIT 10) x), '[]'::jsonb),
      'session_languages', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(language, '?') AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1 ORDER BY count(*) DESC LIMIT 8) x), '[]'::jsonb),
      'session_devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT COALESCE(device, '?') || CASE WHEN is_native THEN ' · app' ELSE '' END AS k, count(*) AS n FROM public.platform_sessions WHERE started_at >= p_from AND started_at <= p_to GROUP BY 1) x), '[]'::jsonb)
    ),
    'entry', jsonb_build_object(
      'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id CROSS JOIN d
        WHERE ge.created_at >= p_from AND ge.created_at <= p_to AND NOT COALESCE(gl.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(ge.email))),
      'guestlist_scanned', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id CROSS JOIN d
        WHERE ge.entry_scanned AND ge.created_at >= p_from AND ge.created_at <= p_to AND NOT COALESCE(gl.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(ge.email))),
      'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t CROSS JOIN d
        WHERE t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))),
      'tickets_scanned', (SELECT count(*) FROM public.tickets t CROSS JOIN d
        WHERE t.paid_at IS NOT NULL AND t.entry_scanned AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))),
      'tables', (SELECT count(*) FROM public.table_reservations tr CROSS JOIN d
        WHERE tr.status IN ('paid', 'confirmed') AND tr.created_at >= p_from AND tr.created_at <= p_to AND NOT COALESCE(tr.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))),
      'wallet_passes', (SELECT count(*) FROM public.wallet_passes wp WHERE wp.created_at >= p_from AND wp.created_at <= p_to AND NOT wp.voided),
      'wallet_by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT pass_type AS k, count(*) AS n FROM public.wallet_passes WHERE created_at >= p_from AND created_at <= p_to GROUP BY 1) x), '[]'::jsonb),
      'guest_checkout_share', (
        SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE is_guest)::numeric / count(*) * 100) ELSE NULL END
        FROM (
          SELECT t.is_guest FROM public.tickets t CROSS JOIN d WHERE t.paid_at IS NOT NULL AND t.created_at >= p_from AND t.created_at <= p_to AND NOT COALESCE(t.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
          UNION ALL
          SELECT tr.is_guest FROM public.table_reservations tr CROSS JOIN d WHERE tr.status IN ('paid', 'confirmed') AND tr.created_at >= p_from AND tr.created_at <= p_to AND NOT COALESCE(tr.event_id = ANY (d.de), false) AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
        ) g
      ),
      'abandoned_carts', (SELECT count(*) FROM public.cart_snapshots cs JOIN real_profiles rp ON rp.id = cs.user_id WHERE cs.created_at >= p_from AND cs.created_at <= p_to AND NOT COALESCE(cs.converted, false))
    ),
    'notifications', jsonb_build_object(
      'push_users', (SELECT count(DISTINCT ps.user_id) FROM public.push_subscriptions ps JOIN real_profiles rp ON rp.id = ps.user_id),
      'push_by_platform', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n)) FROM (SELECT COALESCE(ps.platform, 'web') AS k, count(DISTINCT ps.user_id) AS n FROM public.push_subscriptions ps JOIN real_profiles rp ON rp.id = ps.user_id GROUP BY 1) x), '[]'::jsonb),
      'auto_push', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('key', notification_key, 'sent', sent, 'clicked', clicked, 'failed', failed,
          'ctr', CASE WHEN sent > 0 THEN round(clicked::numeric / sent * 100, 1) ELSE 0 END) ORDER BY sent DESC)
        FROM (
          SELECT ae.notification_key,
            count(*) FILTER (WHERE ae.event_type = 'sent') AS sent,
            count(*) FILTER (WHERE ae.event_type = 'clicked') AS clicked,
            count(*) FILTER (WHERE ae.event_type = 'failed') AS failed
          FROM public.auto_push_events ae JOIN real_profiles rp ON rp.id = ae.user_id
          WHERE ae.created_at >= p_from AND ae.created_at <= p_to GROUP BY ae.notification_key ORDER BY count(*) DESC LIMIT 12
        ) x
      ), '[]'::jsonb),
      'discovery_sent', (SELECT count(*) FROM public.discovery_selections ds JOIN real_profiles rp ON rp.id = ds.user_id WHERE ds.created_at >= p_from AND ds.created_at <= p_to),
      'discovery_opened', (SELECT count(*) FROM public.discovery_selections ds JOIN real_profiles rp ON rp.id = ds.user_id WHERE ds.created_at >= p_from AND ds.created_at <= p_to AND ds.opened_at IS NOT NULL),
      'discovery_opt_out', (SELECT count(*) FROM real_profiles WHERE COALESCE(discovery_opt_out, false)),
      'newsletter_opt_in', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE ns.opted_in AND ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND (p_include_demo OR NOT public.is_demo_email(ns.email))),
      'newsletter_opt_out_period', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE NOT ns.opted_in AND ns.updated_at >= p_from AND ns.updated_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(ns.email)))
    ),
    'feedback', jsonb_build_object(
      'open', (SELECT count(*) FROM public.feedback_issues f WHERE f.status IN ('open', 'in_progress')),
      'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC) FROM (SELECT category AS k, count(*) AS n FROM public.feedback_issues WHERE created_at >= p_from AND created_at <= p_to GROUP BY 1) x), '[]'::jsonb),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'category', f.category, 'priority', f.priority, 'status', f.status, 'at', f.created_at, 'reporter', p.email, 'venue', vn.name) ORDER BY f.created_at DESC)
        FROM (SELECT * FROM public.feedback_issues ORDER BY created_at DESC LIMIT 8) f
        LEFT JOIN public.profiles p ON p.id = f.reported_by LEFT JOIN public.venues vn ON vn.id = f.venue_id
      ), '[]'::jsonb),
      'incidents', (SELECT count(*) FROM public.customer_incidents ci WHERE ci.created_at >= p_from AND ci.created_at <= p_to),
      'email_complaints', (SELECT count(*) FROM public.email_suppressions es WHERE es.created_at >= p_from AND es.created_at <= p_to)
    ),
    'ai_questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'q', a.prompt_preview, 'lang', a.language, 'turns', a.turn_count, 'status', a.status) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.ai_usage_events e WHERE e.assistant = 'client' AND e.prompt_preview IS NOT NULL
            AND e.created_at >= p_from AND e.created_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
            ORDER BY e.created_at DESC LIMIT 30) a
    ), '[]'::jsonb),
    'pro_questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'q', a.prompt_preview, 'assistant', a.assistant, 'tools', a.tool_calls, 'status', a.status) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.ai_usage_events e WHERE e.assistant IN ('owner', 'agency') AND e.prompt_preview IS NOT NULL
            AND e.created_at >= p_from AND e.created_at <= p_to AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
            ORDER BY e.created_at DESC LIMIT 20) a
    ), '[]'::jsonb),
    'links_interest', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('target', target, 'n', n) ORDER BY n DESC)
      FROM (SELECT le.target, count(*) AS n FROM public.links_events le WHERE le.kind = 'click' AND le.occurred_at >= p_from AND le.occurred_at <= p_to GROUP BY le.target ORDER BY count(*) DESC LIMIT 10) x
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_product_insights(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_product_insights(timestamptz, timestamptz, boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Santé technique — OTA, crashs, crons, base, réglages
-- ═══════════════════════════════════════════════════════════════════════════
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
        'runs_24h', (SELECT count(*) FROM cron.job_run_details r WHERE r.jobid = j.jobid AND r.start_time >= now() - interval '24 hours'),
        'fails_7d', (SELECT count(*) FROM cron.job_run_details r WHERE r.jobid = j.jobid AND r.start_time >= v_7d AND r.status <> 'succeeded')
      ) ORDER BY j.jobname)
      FROM cron.job j
      LEFT JOIN LATERAL (SELECT r.status, r.start_time, r.end_time, r.return_message FROM cron.job_run_details r WHERE r.jobid = j.jobid ORDER BY r.start_time DESC LIMIT 1) lr ON true
    ), '[]'::jsonb),
    'cron_failures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', j.jobname, 'at', r.start_time, 'status', r.status, 'message', left(r.return_message, 300)) ORDER BY r.start_time DESC)
      FROM (SELECT * FROM cron.job_run_details r WHERE r.status <> 'succeeded' ORDER BY r.start_time DESC LIMIT 15) r
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

REVOKE ALL ON FUNCTION public.admin_release_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_health() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Compteurs de l'annuaire (démo et profils orphelins exclus)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_directory_counts()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  real_profiles AS (
    SELECT p.id, p.email FROM public.profiles p
    WHERE NOT public.is_demo_email(p.email) AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  )
  SELECT jsonb_build_object(
    'venues', (SELECT count(*) FROM public.venues v CROSS JOIN d WHERE v.decommissioned_at IS NULL AND NOT COALESCE(v.id = ANY (d.dv), false)),
    'venues_demo', (SELECT COALESCE(cardinality(dv), 0) FROM d),
    'organizers', (SELECT count(*) FROM public.organizer_profiles op JOIN real_profiles rp ON rp.id = op.user_id WHERE NOT COALESCE(op.is_showcase_shadow, false)),
    'organizers_showcase', (SELECT count(*) FROM public.organizer_profiles op WHERE COALESCE(op.is_showcase_shadow, false)),
    'agencies', (SELECT count(*) FROM public.agencies a JOIN real_profiles rp ON rp.id = a.owner_user_id),
    'djs', (SELECT count(*) FROM public.djs dj LEFT JOIN public.profiles p ON p.id = dj.user_id WHERE p.id IS NULL OR NOT public.is_demo_email(p.email)),
    'promoters', (SELECT count(*) FROM public.promoters pr LEFT JOIN public.profiles p ON p.id = pr.user_id CROSS JOIN d
      WHERE (p.id IS NULL OR NOT public.is_demo_email(p.email)) AND NOT COALESCE(pr.venue_id = ANY (d.dv), false)),
    'staff', (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur JOIN real_profiles rp ON rp.id = ur.user_id
      WHERE ur.role::text IN ('barman', 'bouncer', 'vip_host', 'cloakroom', 'manager', 'dj')),
    'customers', (SELECT count(DISTINCT lower(em)) FROM public._admin_customer_activity()),
    'accounts', (SELECT count(*) FROM real_profiles),
    'signups_7d', (SELECT count(*) FROM public.profiles p JOIN real_profiles rp ON rp.id = p.id WHERE p.created_at >= now() - interval '7 days'),
    'pending_invitations', (SELECT count(*) FROM public.platform_invitations pi WHERE pi.status = 'pending' AND pi.expires_at > now())
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_directory_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_directory_counts() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Fiche club — chiffres justes (statuts réels, sans plafond PostgREST)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_venue_overview(p_venue_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'venue', (SELECT to_jsonb(x) FROM (
      SELECT vn.id, vn.name, vn.slug, vn.city, vn.address, vn.created_at, vn.is_hidden, vn.decommissioned_at, vn.purge_at,
        vn.stripe_account_id, vn.stripe_onboarding_complete, vn.stripe_charges_enabled, vn.stripe_payouts_enabled,
        vn.menu_enabled, vn.vip_placement_enabled, vn.live_mode_enabled, vn.timezone, vn.owner_id, vn.showcase_shadow_owner_id,
        vn.logo_url, vn.cover_url, vn.instagram_url, vn.whatsapp_number, vn.legal_name, vn.siret,
        (vn.id = ANY (public.demo_venue_ids())) AS is_demo
      FROM public.venues vn WHERE vn.id = p_venue_id) x),
    'owner', (SELECT jsonb_build_object('id', p.id, 'email', p.email, 'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'mfa_enabled', p.mfa_enabled, 'is_suspended', p.is_suspended, 'created_at', p.created_at)
      FROM public.venues vn JOIN public.profiles p ON p.id = vn.owner_id WHERE vn.id = p_venue_id),
    'onboarding', (SELECT jsonb_build_object('current_step', o.current_step, 'steps', o.steps, 'completed_at', o.completed_at)
      FROM public.venue_onboarding o WHERE o.venue_id = p_venue_id ORDER BY o.updated_at DESC LIMIT 1),
    'subscription', (SELECT jsonb_build_object('status', s.status, 'plan', s.subscription_plan, 'trial_end', s.trial_end, 'is_early_adopter', s.is_early_adopter, 'period_end', s.current_period_end)
      FROM public.venue_subscriptions s WHERE s.venue_id = p_venue_id ORDER BY s.updated_at DESC LIMIT 1),
    'revenue', jsonb_build_object(
      'drinks', (SELECT jsonb_build_object('n', count(*), 'gross', round(COALESCE(sum(o.total - COALESCE(o.service_fee, 0)), 0), 2), 'yuno', round(COALESCE(sum(o.service_fee), 0), 2))
        FROM public.orders o WHERE o.venue_id = p_venue_id AND o.status IN ('paid', 'served')),
      'tickets', (SELECT jsonb_build_object('n', COALESCE(sum(t.quantity), 0), 'gross', round(COALESCE(sum(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)), 0), 2), 'yuno', round(COALESCE(sum(COALESCE(t.service_fee, 0) + COALESCE(t.insurance_fee, 0)), 0), 2))
        FROM public.tickets t JOIN public.events e ON e.id = t.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
      'tables', (SELECT jsonb_build_object('n', count(*), 'gross', round(COALESCE(sum(tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0)), 0), 2), 'yuno', round(COALESCE(sum(COALESCE(tr.service_fee, 0) + COALESCE(tr.management_fee, 0)), 0), 2))
        FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')),
      'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
        WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND ge.status IS DISTINCT FROM 'cancelled'),
      'last_sale_at', (SELECT max(x.at) FROM (
        SELECT max(o.created_at) AS at FROM public.orders o WHERE o.venue_id = p_venue_id AND o.status IN ('paid', 'served')
        UNION ALL SELECT max(t.created_at) FROM public.tickets t JOIN public.events e ON e.id = t.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND t.paid_at IS NOT NULL
        UNION ALL SELECT max(tr.created_at) FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')) x)
    ),
    'events', jsonb_build_object(
      'total', (SELECT count(*) FROM public.events e WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id),
      'upcoming', (SELECT count(*) FROM public.events e WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND e.end_at >= now() AND e.cancelled_at IS NULL),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'is_active', e.is_active, 'ticketing', e.ticketing_enabled, 'tables', e.tables_enabled,
          'cancelled', e.cancelled_at IS NOT NULL, 'organizer', op.display_name,
          'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
          'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id)) ORDER BY e.start_at DESC)
        FROM (SELECT * FROM public.events e WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id ORDER BY e.start_at DESC LIMIT 15) e
        LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
      ), '[]'::jsonb)
    ),
    'staff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', COALESCE(p.staff_display_name, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')),
        'roles', (SELECT array_agg(ur.role::text ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id = p.id),
        'has_pin', p.employee_pin IS NOT NULL, 'since', p.staff_since) ORDER BY p.created_at)
      FROM public.profiles p WHERE p.venue_id = p_venue_id
    ), '[]'::jsonb),
    'promoters', (SELECT count(*) FROM public.promoters pr WHERE pr.venue_id = p_venue_id AND pr.is_active),
    'customers', (SELECT count(*) FROM public.venue_customers vc WHERE vc.venue_id = p_venue_id),
    'followers', (SELECT count(*) FROM public.favorites f WHERE f.venue_id = p_venue_id AND f.favorite_type = 'club'),
    'zones', (SELECT count(*) FROM public.table_zones z WHERE z.venue_id = p_venue_id),
    'drinks', (SELECT count(*) FROM public.drinks dr WHERE dr.venue_id = p_venue_id),
    'ai_chats_30d', (SELECT count(*) FROM public.ai_usage_events a WHERE a.venue_id = p_venue_id AND a.created_at >= now() - interval '30 days'),
    'email_campaigns', (SELECT count(*) FROM public.email_campaigns c WHERE c.venue_id = p_venue_id),
    'newsletter', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE ns.venue_id = p_venue_id AND ns.opted_in),
    'support_grant', (SELECT jsonb_build_object('status', g.status, 'created_at', g.created_at) FROM public.admin_support_grants g JOIN public.venues vn ON vn.owner_id = g.target_user_id
      WHERE vn.id = p_venue_id AND g.status IN ('pending', 'active', 'approved') ORDER BY g.created_at DESC LIMIT 1)
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_venue_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_venue_overview(text) TO authenticated, service_role;
