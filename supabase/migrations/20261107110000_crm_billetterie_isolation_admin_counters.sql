-- Yuno CRM ⇄ Billetterie : les compteurs du super admin ne comptent plus les soirées miroir.
--
-- `events_total` du Cockpit, le fil d'activité (une ligne « soirée créée » par miroir : ~300 le
-- jour de la première synchro d'un compte), les nouvelles soirées d'admin_platform_analytics,
-- l'étape « 1re soirée / en ligne » du funnel d'inscription des pros (published_at Shotgun) et
-- le total / à venir / récent d'une fiche club mélangeaient soirées Yuno et soirées Shotgun.
-- Les soirées Yuno gardent exactement les mêmes chiffres. admin_platform_analytics était
-- exécutable par anon (elle garde is_super_admin()) : elle passe à authenticated + service_role,
-- comme ses sœurs.

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('admin_cockpit', 'ae1752e654f865bcdcffbd0d37b19a1a'),
    ('admin_activity_feed', 'b7576f3ef3bf0147733cff84de2e140c'),
    ('admin_platform_analytics', '7c5cb2df66ec785fb64abe9f4dd86b10'),
    ('admin_pro_signups', '73e8e259423966fcf8287967c30183b5'),
    ('admin_venue_overview', '9e257bcc110b5b86de694e4f0279b3ec')
  ) AS v(name, md5) LOOP
    IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'public.% a changé depuis l''audit du 19/10 : régénérer la migration depuis pg_get_functiondef', r.name;
    END IF;
  END LOOP;
END $guard$;

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
      'events_total', (SELECT count(*) FROM public.events e CROSS JOIN d WHERE NOT COALESCE(e.id = ANY (d.de), false) AND e.external_source IS NULL),
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
END $function$;
REVOKE ALL ON FUNCTION public.admin_cockpit(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cockpit(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_activity_feed(p_limit integer DEFAULT 60, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_include_demo boolean DEFAULT false, p_kinds text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.events e CROSS JOIN d LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id) LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id WHERE e.external_source IS NULL AND e.created_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
    UNION ALL
    -- Soirées publiées
    SELECT e.published_at, 'event_published', e.title,
      COALESCE(v.name, e.location_name, e.location_city, ''), 'event', e.id::text, NULL, COALESCE(op.display_name, v.name)
    FROM public.events e CROSS JOIN d LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id) LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id WHERE e.external_source IS NULL AND e.published_at IS NOT NULL AND e.published_at < v_before AND NOT COALESCE(e.id = ANY (d.de), false)
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
END $function$;
REVOKE ALL ON FUNCTION public.admin_activity_feed(integer, timestamp with time zone, boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_feed(integer, timestamp with time zone, boolean, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_platform_analytics(p_from timestamp with time zone, p_to timestamp with time zone, p_venue_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$



DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH d AS MATERIALIZED (
    -- Une seule évaluation de la porte démo pour toute la requête : dans un
    -- WHERE, ces fonctions STABLE sont rappelées par ligne (32 s mesurées).
    SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de
  ),
  tx AS (
    -- Une ligne par transaction payée dans la période, avec décomposition fees.
    SELECT o.created_at, 'drinks'::text AS kind, o.venue_id, o.event_id,
      o.total::numeric AS charged,
      (o.total::numeric - COALESCE(o.service_fee, 0)::numeric) AS club_gross,
      COALESCE(o.service_fee, 0)::numeric AS yuno_fee,
      COALESCE(o.refund_amount, 0)::numeric AS refunded,
      (o.refunded_at IS NOT NULL) AS has_refund,
      1 AS qty
    FROM orders o
    CROSS JOIN d
    WHERE o.status IN ('paid', 'served', 'refunded')
      AND o.created_at >= p_from AND o.created_at <= p_to
      AND (p_venue_id IS NULL OR o.venue_id = p_venue_id)
      AND (o.status <> 'refunded' OR o.refunded_at IS NOT NULL)
      AND NOT COALESCE(o.venue_id = ANY (d.dv), false)
      AND NOT public.is_demo_email(o.user_email)
    UNION ALL
    SELECT t.created_at, 'tickets', COALESCE(e.venue_id, e.partner_venue_id), t.event_id,
      t.total_price::numeric,
      (t.total_price::numeric - COALESCE(t.service_fee, 0)::numeric - COALESCE(t.insurance_fee, 0)::numeric),
      COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric,
      COALESCE(t.refund_amount, 0)::numeric,
      (t.refunded_at IS NOT NULL),
      COALESCE(t.quantity, 1)
    FROM tickets t CROSS JOIN d LEFT JOIN events e ON e.id = t.event_id
    WHERE t.paid_at IS NOT NULL
      AND t.created_at >= p_from AND t.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(t.event_id = ANY (d.de), false)
      AND NOT public.is_demo_email(t.user_email)
    UNION ALL
    SELECT tr.created_at, 'tables', COALESCE(e.venue_id, e.partner_venue_id), tr.event_id,
      tr.total_price::numeric,
      (tr.total_price::numeric - COALESCE(tr.service_fee, 0)::numeric - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END)::numeric),
      COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric,
      COALESCE(tr.refund_amount, 0)::numeric,
      (tr.refunded_at IS NOT NULL),
      1
    FROM table_reservations tr CROSS JOIN d LEFT JOIN events e ON e.id = tr.event_id
    WHERE tr.paid_at IS NOT NULL
      AND tr.created_at >= p_from AND tr.created_at <= p_to
      AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
      AND NOT COALESCE(tr.event_id = ANY (d.de), false)
      AND NOT public.is_demo_email(tr.user_email)
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  ),
  by_day AS (
    SELECT days.d,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'drinks'), 0) AS drinks,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tickets'), 0) AS tickets,
      COALESCE(sum(tx.club_gross) FILTER (WHERE tx.kind = 'tables'), 0) AS tables,
      COALESCE(sum(tx.yuno_fee), 0) AS yuno,
      COALESCE(sum(tx.refunded), 0) AS refunds,
      count(tx.*) FILTER (WHERE tx.kind = 'drinks') AS drink_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tickets') AS ticket_n,
      count(tx.*) FILTER (WHERE tx.kind = 'tables') AS table_n
    FROM days LEFT JOIN tx ON date(tx.created_at) = days.d
    GROUP BY days.d ORDER BY days.d
  ),
  new_users AS (
    -- Tous les nouveaux comptes (profile_type ne distingue que club/organizer,
    -- il n'existe pas de valeur 'customer' — un client = un profil sans rôle pro).
    SELECT days.d, count(p.id) AS n
    FROM days LEFT JOIN profiles p
      ON date(p.created_at) = days.d
     AND NOT public.is_demo_email(p.email)
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
    GROUP BY days.d ORDER BY days.d
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'gmv', round(COALESCE(sum(charged), 0), 2),
        'club_revenue', round(COALESCE(sum(club_gross), 0), 2),
        'yuno_revenue', round(COALESCE(sum(yuno_fee), 0), 2),
        'refunds_total', round(COALESCE(sum(refunded), 0), 2),
        'refunds_count', count(*) FILTER (WHERE has_refund),
        'tx_count', count(*),
        'tickets_qty', COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0),
        'ticket_sales', count(*) FILTER (WHERE kind = 'tickets'),
        'tables_booked', count(*) FILTER (WHERE kind = 'tables'),
        'drink_orders', count(*) FILTER (WHERE kind = 'drinks'),
        'avg_order', CASE WHEN count(*) > 0 THEN round(sum(charged) / count(*), 2) ELSE 0 END,
        'take_rate', CASE WHEN COALESCE(sum(charged), 0) > 0
          THEN round(sum(yuno_fee) / sum(charged) * 100, 2) ELSE 0 END
      ) FROM tx
    ),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'd', to_char(d, 'YYYY-MM-DD'),
      'drinks', round(drinks, 2), 'tickets', round(tickets, 2), 'tables', round(tables, 2),
      'total', round(drinks + tickets + tables, 2),
      'yuno', round(yuno, 2), 'refunds', round(refunds, 2),
      'drink_n', drink_n, 'ticket_n', ticket_n, 'table_n', table_n
    )) FROM by_day), '[]'::jsonb),
    'top_venues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.venue_id, 'name', COALESCE(v.name, s.venue_id), 'city', v.city,
        'revenue', round(s.revenue, 2), 'yuno', round(s.yuno, 2), 'tx', s.tx
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT venue_id, sum(club_gross) AS revenue, sum(yuno_fee) AS yuno, count(*) AS tx
        FROM tx WHERE venue_id IS NOT NULL
        GROUP BY venue_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s LEFT JOIN venues v ON v.id = s.venue_id
    ), '[]'::jsonb),
    'top_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.event_id, 'title', COALESCE(e.title, s.event_id::text),
        'venue_name', COALESCE(v.name, e.venue_id), 'start_at', e.start_at,
        'revenue', round(s.revenue, 2), 'tickets', s.tickets, 'tables', s.tables
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT event_id, sum(club_gross) AS revenue,
          COALESCE(sum(qty) FILTER (WHERE kind = 'tickets'), 0) AS tickets,
          count(*) FILTER (WHERE kind = 'tables') AS tables
        FROM tx WHERE event_id IS NOT NULL
        GROUP BY event_id ORDER BY sum(club_gross) DESC LIMIT 10
      ) s
      LEFT JOIN events e ON e.id = s.event_id
      LEFT JOIN venues v ON v.id = e.venue_id
    ), '[]'::jsonb),
    'top_organizers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.organizer_user_id,
        'name', COALESCE(op.display_name, 'Organizer'),
        'revenue', round(s.revenue, 2), 'events_count', s.events_count
      ) ORDER BY s.revenue DESC)
      FROM (
        SELECT e.organizer_user_id, sum(t.club_gross) AS revenue, count(DISTINCT t.event_id) AS events_count
        FROM tx t JOIN events e ON e.id = t.event_id
        WHERE e.organizer_user_id IS NOT NULL
        GROUP BY e.organizer_user_id ORDER BY sum(t.club_gross) DESC LIMIT 8
      ) s
      LEFT JOIN organizer_profiles op ON op.user_id::text = s.organizer_user_id::text
    ), '[]'::jsonb),
    'growth', jsonb_build_object(
      'new_users_by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(d, 'YYYY-MM-DD'), 'n', n
      )) FROM new_users), '[]'::jsonb),
      'new_users', (SELECT count(*) FROM profiles p
        WHERE p.created_at >= p_from AND p.created_at <= p_to
          AND NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'total_users', (SELECT count(*) FROM profiles p
        WHERE NOT public.is_demo_email(p.email)
          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)),
      'new_venues', (SELECT count(*) FROM venues v
        WHERE v.created_at >= p_from AND v.created_at <= p_to
          AND NOT EXISTS (SELECT 1 FROM d WHERE v.id = ANY (d.dv))),
      'new_events', (SELECT count(*) FROM events e WHERE e.external_source IS NULL AND e.created_at >= p_from AND e.created_at <= p_to
          AND (p_venue_id IS NULL OR e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id)
          AND NOT EXISTS (SELECT 1 FROM d WHERE e.id = ANY (d.de)))
    ),
    'venue_cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', s.city, 'revenue', round(s.revenue, 2), 'tx', s.tx)
        ORDER BY s.revenue DESC)
      FROM (
        SELECT v.city, sum(t.club_gross) AS revenue, count(*) AS tx
        FROM tx t JOIN venues v ON v.id = t.venue_id
        WHERE v.city IS NOT NULL
        GROUP BY v.city ORDER BY sum(t.club_gross) DESC LIMIT 10
      ) s
    ), '[]'::jsonb),
    'subscriptions', (
      SELECT count(*) FROM venue_subscriptions vs WHERE vs.status IN ('active', 'trialing')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_platform_analytics(timestamp with time zone, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_analytics(timestamp with time zone, timestamp with time zone, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_pro_signups(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)));
  v      jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH RECURSIVE
  -- Tous les parcours (toute l'histoire), démo exclue. `mail` = l'adresse du
  -- parcours, sinon celle du compte ouvert (un parcours sans e-mail peut porter
  -- un compte : crm@womber.fr, 02/10).
  s AS MATERIALIZED (
    SELECT ps.*,
           coalesce(nullif(trim(ps.email), ''), u.email) AS mail,
           public._pro_signup_furthest_step(ps.steps) AS fs,
           (ps.offer_invite_id IS NOT NULL
             OR coalesce(ps.source, '') IN ('demo_preview', 'crm_invite')) AS invited,
           nullif(regexp_replace(coalesce(ps.phone, ''), '\D', '', 'g'), '') AS phone_digits
      FROM public.pro_signups ps
      LEFT JOIN auth.users u ON u.id = ps.user_id
     WHERE p_include_demo
        OR coalesce(nullif(trim(ps.email), ''), u.email) IS NULL
        OR NOT public.is_demo_email(coalesce(nullif(trim(ps.email), ''), u.email))
  ),
  -- Ce qui relie deux parcours. Un numéro fait d'un seul chiffre répété
  -- (« 0000000000 ») ne relie personne.
  k AS (
    SELECT s.id, x.key
      FROM s
     CROSS JOIN LATERAL (VALUES
       (CASE WHEN s.mail IS NOT NULL THEN 'e:' || lower(s.mail) END),
       (CASE WHEN length(s.phone_digits) >= 8 AND s.phone_digits !~ '^(\d)\1+$'
             THEN 'p:' || right(s.phone_digits, 9) END),
       (CASE WHEN s.visitor_hash IS NOT NULL THEN 'v:' || s.visitor_hash END)
     ) AS x(key)
     WHERE x.key IS NOT NULL
  ),
  edge AS (
    SELECT DISTINCT a.id AS a, b.id AS b FROM k a JOIN k b ON b.key = a.key
  ),
  -- Composantes connexes : chaque parcours atteint tous ceux de sa personne.
  reach(a, b) AS (
    SELECT edge.a, edge.b FROM edge
    UNION
    SELECT reach.a, edge.b FROM reach JOIN edge ON edge.a = reach.b
  ),
  pkmap AS (
    SELECT reach.a AS id, min(reach.b::text) AS pk FROM reach GROUP BY reach.a
  ),
  g AS MATERIALIZED (
    SELECT s.*, coalesce(pkmap.pk, s.id::text) AS pk
      FROM s LEFT JOIN pkmap ON pkmap.id = s.id
  ),
  prog AS (
    SELECT g.id,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.venue_id = g.venue_id AND e.external_source IS NULL)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.organizer_user_id = g.user_id AND e.external_source IS NULL)
             ELSE 0
           END AS events,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               coalesce((SELECT vn.stripe_charges_enabled OR vn.stripe_onboarding_complete
                           FROM public.venues vn WHERE vn.id = g.venue_id), false)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               coalesce((SELECT pr.stripe_connect_account_id IS NOT NULL
                           FROM public.profiles pr WHERE pr.id = g.user_id), false)
             ELSE false
           END AS payments,
           CASE
             WHEN g.kind = 'club' AND g.venue_id IS NOT NULL THEN
               coalesce((SELECT NOT vn.is_hidden FROM public.venues vn WHERE vn.id = g.venue_id), false)
             WHEN g.kind = 'organizer' AND g.user_id IS NOT NULL THEN
               EXISTS (SELECT 1 FROM public.events e WHERE e.organizer_user_id = g.user_id AND e.external_source IS NULL AND e.published_at IS NOT NULL)
             ELSE false
           END AS live
      FROM g
     WHERE g.user_id IS NOT NULL
  ),
  j AS MATERIALIZED (
    SELECT g.*,
           array_position(ARRAY['console','created','lead','account','structure','role','opened'], g.fs) AS fs_rank,
           (g.account_created_at IS NOT NULL AND g.user_id IS NULL) AS acc_deleted,
           (length(coalesce(g.phone_digits, '')) >= 8) AS has_phone,
           -- Ouverture anonyme : le formulaire s'est affiché, rien n'a été
           -- choisi ni laissé, personne n'a invité.
           (g.fs = 'opened' AND g.kind IS NULL AND g.mail IS NULL
             AND length(coalesce(g.phone_digits, '')) < 8
             AND g.user_id IS NULL AND g.account_created_at IS NULL AND NOT g.invited) AS anon_open
      FROM g
  ),
  -- Robots (20261104230000). Un parcours est un robot quand son navigateur
  -- s'annonçait robot, piloté ou de test à l'écriture (`robot`), ou quand
  -- c'est une ouverture anonyme arrivée à moins de 3 minutes d'une autre
  -- ouverture anonyme venue d'un AUTRE appareil (les rafales de navigateurs
  -- automatisés derrière des proxys des 04, 10 et 19/10).
  jr AS MATERIALIZED (
    SELECT j.id,
           (j.robot IS NOT NULL
             OR (j.anon_open AND j.visitor_hash IS NOT NULL AND EXISTS (
                   SELECT 1 FROM j o
                    WHERE o.anon_open AND o.id <> j.id
                      AND o.visitor_hash IS NOT NULL AND o.visitor_hash <> j.visitor_hash
                      AND o.created_at BETWEEN j.created_at - interval '3 minutes'
                                           AND j.created_at + interval '3 minutes'))) AS robot
      FROM j
  ),
  -- Le compte vivant d'une personne : le plus récent.
  main AS (
    SELECT DISTINCT ON (j.pk)
           j.pk, j.kind, j.user_id, j.venue_id, j.account_created_at, j.console_opened_at,
           coalesce(p.events, 0) AS events, coalesce(p.payments, false) AS payments, coalesce(p.live, false) AS live
      FROM j LEFT JOIN prog p ON p.id = j.id
     WHERE j.user_id IS NOT NULL
     ORDER BY j.pk, j.account_created_at DESC NULLS LAST, j.created_at DESC
  ),
  ppl AS MATERIALIZED (
    SELECT j.pk,
           bool_or(j.created_at >= v_from OR j.account_created_at >= v_from) AS in_period,
           min(j.created_at)                                          AS first_at,
           max(greatest(j.created_at, j.updated_at, coalesce(j.account_created_at, j.created_at))) AS last_at,
           min(j.created_at) FILTER (WHERE j.kind IS NOT NULL)        AS role_at,
           min(j.account_created_at)                                  AS account_at,
           bool_or(j.kind IS NOT NULL)                                AS has_role,
           bool_or(j.steps ? 'structure' OR j.steps ? 'lead')         AS has_structure,
           bool_or(j.mail IS NOT NULL)                               AS has_email,
           bool_or(j.mail IS NOT NULL OR j.has_phone)                AS reachable,
           bool_or(j.account_created_at IS NOT NULL)                  AS has_created,
           bool_or(j.console_opened_at IS NOT NULL)                   AS has_console,
           bool_or(j.user_id IS NOT NULL)                             AS has_account,
           count(*) FILTER (WHERE j.acc_deleted)                      AS deleted_n,
           bool_or(j.fs = 'lead')                                     AS has_lead,
           bool_or(j.invited)                                         AS invited,
           (array_agg(j.fs ORDER BY j.fs_rank NULLS LAST))[1]          AS furthest,
           max(j.contacted_at)                                        AS contacted_at,
           (array_agg(j.admin_notes ORDER BY j.created_at DESC)
              FILTER (WHERE j.admin_notes IS NOT NULL))[1]            AS admin_notes,
           array_agg(j.id ORDER BY j.created_at)                      AS ids,
           array_agg(DISTINCT lower(j.mail)) FILTER (WHERE j.mail IS NOT NULL) AS emails,
           -- Identité : celle du compte d'abord, sinon la plus récente.
           (array_agg(j.first_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.first_name), '') IS NOT NULL))[1] AS first_name,
           (array_agg(j.last_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.last_name), '') IS NOT NULL))[1]  AS last_name,
           (array_agg(j.mail ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE j.mail IS NOT NULL))[1]                       AS email,
           (array_agg(j.org_name ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.org_name), '') IS NOT NULL))[1]  AS org_name,
           (array_agg(j.kind ORDER BY (j.user_id IS NOT NULL) DESC, (j.kind IN ('club', 'organizer')) DESC, j.created_at DESC)
              FILTER (WHERE j.kind IS NOT NULL))[1]                        AS kind,
           (array_agg(j.product ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE j.product IS NOT NULL))[1]                     AS product,
           (array_agg(j.city ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE nullif(trim(j.city), '') IS NOT NULL))[1]      AS city,
           (array_agg(coalesce(j.country, j.geo_country) ORDER BY (j.user_id IS NOT NULL) DESC, j.created_at DESC)
              FILTER (WHERE coalesce(j.country, j.geo_country) IS NOT NULL))[1] AS country,
           (array_agg(j.size_band ORDER BY j.created_at DESC) FILTER (WHERE j.size_band IS NOT NULL))[1]       AS size_band,
           (array_agg(j.frequency ORDER BY j.created_at DESC) FILTER (WHERE j.frequency IS NOT NULL))[1]       AS frequency,
           (array_agg(j.current_tool ORDER BY j.created_at DESC) FILTER (WHERE j.current_tool IS NOT NULL))[1] AS current_tool,
           (array_agg(j.next_night ORDER BY j.created_at DESC) FILTER (WHERE j.next_night IS NOT NULL))[1]     AS next_night,
           (array_agg(j.lang ORDER BY j.created_at DESC) FILTER (WHERE j.lang IS NOT NULL))[1]                 AS lang,
           -- Comment elle est arrivée : son premier parcours.
           (array_agg(jsonb_build_object('source', j.source, 'utm_source', j.utm_source,
                                         'referrer_host', j.referrer_host) ORDER BY j.created_at))[1] AS origin,
           (array_agg(j.offer_invite_id ORDER BY j.created_at)
              FILTER (WHERE j.offer_invite_id IS NOT NULL))[1]             AS offer_invite_id,
           (array_agg(j.source ORDER BY j.created_at)
              FILTER (WHERE j.source IN ('demo_preview', 'crm_invite')))[1] AS invite_source,
           -- Une personne n'est un robot que si TOUS ses parcours en sont et
           -- qu'elle n'a laissé ni e-mail ni téléphone, ni ouvert de compte,
           -- ni reçu d'invitation : un vrai contact compte toujours.
           (bool_and(jr.robot)
             AND NOT bool_or(j.mail IS NOT NULL OR j.has_phone)
             AND NOT bool_or(j.user_id IS NOT NULL OR j.account_created_at IS NOT NULL)
             AND NOT bool_or(j.invited))                              AS is_robot
      FROM j JOIN jr ON jr.id = j.id
     GROUP BY j.pk
  ),
  pop AS MATERIALIZED (
    SELECT ppl.*,
           m.kind AS account_kind, m.user_id, m.venue_id, m.account_created_at AS main_account_at,
           m.console_opened_at, coalesce(m.events, 0) AS events,
           coalesce(m.payments, false) AS payments, coalesce(m.live, false) AS live,
           CASE WHEN ppl.has_account      THEN 'account'
                WHEN ppl.deleted_n > 0    THEN 'deleted'
                WHEN ppl.has_lead         THEN 'request'
                WHEN ppl.invited          THEN 'invited'
                ELSE 'blocked' END AS outcome
      FROM ppl
      LEFT JOIN main m ON m.pk = ppl.pk
     WHERE ppl.in_period AND NOT ppl.is_robot
  ),
  funnel AS (
    SELECT
      count(*)                                                        AS opened,
      count(*) FILTER (WHERE pop.has_role)                            AS role,
      count(*) FILTER (WHERE pop.has_structure)                       AS structure,
      count(*) FILTER (WHERE pop.has_email)                           AS email,
      count(*) FILTER (WHERE pop.has_created)                         AS created,
      count(*) FILTER (WHERE pop.has_console)                         AS console,
      count(*) FILTER (WHERE pop.events > 0)                          AS first_event,
      count(*) FILTER (WHERE pop.payments)                            AS payments,
      count(*) FILTER (WHERE pop.live)                                AS live,
      count(*) FILTER (WHERE pop.has_account)                         AS accounts,
      count(*) FILTER (WHERE pop.has_account AND pop.account_kind = 'club')      AS clubs,
      count(*) FILTER (WHERE pop.has_account AND pop.account_kind = 'organizer') AS organizers,
      count(*) FILTER (WHERE pop.has_account AND pop.invited)         AS invited_accounts,
      count(*) FILTER (WHERE pop.outcome = 'deleted')                 AS deleted,
      count(*) FILTER (WHERE pop.reachable AND pop.outcome IN ('blocked', 'request', 'invited')) AS leads,
      count(*) FILTER (WHERE pop.reachable AND pop.outcome IN ('blocked', 'request')
                              AND pop.contacted_at IS NULL)           AS to_contact,
      (SELECT count(*) FROM ppl WHERE ppl.in_period AND ppl.is_robot) AS robots
    FROM pop
  ),
  days AS (
    SELECT d::date AS d
      FROM generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') d
  ),
  by_day AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'd', days.d,
             'started', (SELECT count(*) FROM pop WHERE pop.role_at::date = days.d),
             'created', (SELECT count(*) FROM pop WHERE pop.account_at::date = days.d)
           ) ORDER BY days.d), '[]'::jsonb) AS j
      FROM days
  ),
  -- Par provenance du premier parcours ; l'écran la nomme (sourceLabel).
  by_source AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('origin', origin, 'started', started, 'created', created)
                              ORDER BY started DESC), '[]'::jsonb) AS j
      FROM (
        SELECT pop.origin,
               count(*) FILTER (WHERE pop.has_role)    AS started,
               count(*) FILTER (WHERE pop.has_created) AS created
          FROM pop GROUP BY pop.origin
      ) x
     WHERE started > 0
  ),
  people AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'key', p.pk,
             'ids', to_jsonb(p.ids),
             'outcome', p.outcome,
             'furthest_step', p.furthest,
             'first_at', p.first_at, 'last_at', p.last_at,
             'first_name', p.first_name, 'last_name', p.last_name,
             'email', p.email, 'emails', to_jsonb(coalesce(p.emails, '{}'::text[])),
             'phones', (SELECT coalesce(jsonb_agg(x.phone ORDER BY x.at DESC), '[]'::jsonb)
                          FROM (SELECT j.phone, max(j.created_at) AS at
                                  FROM j WHERE j.pk = p.pk AND j.has_phone
                                 GROUP BY j.phone) x),
             'org_name', p.org_name, 'kind', coalesce(p.account_kind, p.kind), 'product', p.product,
             'city', p.city, 'country', p.country, 'lang', p.lang,
             'size_band', p.size_band, 'frequency', p.frequency,
             'current_tool', p.current_tool, 'next_night', p.next_night,
             'origin', p.origin,
             'invited', p.invited,
             'invite', CASE WHEN p.invited THEN jsonb_build_object(
                         'source', p.invite_source, 'offer', oi.offer, 'kind', oi.kind) END,
             'contacted_at', p.contacted_at, 'admin_notes', p.admin_notes,
             'account', CASE WHEN p.has_account THEN jsonb_build_object(
                          'user_id', p.user_id, 'venue_id', p.venue_id,
                          'created_at', p.main_account_at, 'console_opened_at', p.console_opened_at,
                          'events', p.events, 'payments', p.payments, 'live', p.live) END,
             'deleted_accounts', p.deleted_n,
             -- A redonné ses coordonnées après l'ouverture de son compte : il
             -- n'arrive sans doute pas à se connecter (Poupée, 19/10).
             'retries_after_account', CASE WHEN p.has_account THEN
                 (SELECT count(*) FROM j
                   WHERE j.pk = p.pk AND j.mail IS NOT NULL AND j.account_created_at IS NULL
                     AND j.created_at > p.main_account_at) ELSE 0 END,
             'journeys', (SELECT jsonb_agg(jsonb_build_object(
                             'id', j.id, 'at', j.created_at, 'updated_at', j.updated_at,
                             'kind', j.kind, 'product', j.product, 'org_name', j.org_name,
                             'source', j.source, 'utm_source', j.utm_source, 'referrer_host', j.referrer_host,
                             'device', j.device, 'step', j.fs, 'has_email', j.mail IS NOT NULL,
                             'account_created_at', j.account_created_at,
                             'account', j.user_id IS NOT NULL, 'deleted', j.acc_deleted, 'invited', j.invited
                           ) ORDER BY j.created_at DESC)
                            FROM j WHERE j.pk = p.pk),
             'alerts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                           'kind', a.kind, 'status', a.status, 'at', a.created_at, 'sent_at', a.sent_at,
                           'cockpit', a.cockpit ? 'prospect_id',
                           'push', CASE WHEN coalesce(a.cockpit -> 'push' ->> 'sent', '') ~ '^\d+$'
                                        THEN (a.cockpit -> 'push' ->> 'sent')::int > 0 ELSE false END,
                           'telegram', a.telegram_sent_at IS NOT NULL,
                           'email', a.email_sent_at IS NOT NULL
                         ) ORDER BY a.created_at DESC), '[]'::jsonb)
                          FROM public.pro_signup_alerts a
                         WHERE a.signup_id = ANY (p.ids)
                            OR lower(a.email) = ANY (coalesce(p.emails, '{}'::text[])))
           ) ORDER BY p.last_at DESC), '[]'::jsonb) AS j
      FROM (SELECT * FROM pop WHERE pop.reachable OR pop.has_account
             ORDER BY pop.last_at DESC LIMIT 300) p
      LEFT JOIN public.crm_offer_invites oi ON oi.id = p.offer_invite_id
  )
  SELECT jsonb_build_object(
    'funnel', (SELECT to_jsonb(funnel) FROM funnel),
    'by_day', (SELECT j FROM by_day),
    'by_source', (SELECT j FROM by_source),
    'people', (SELECT j FROM people),
    'from', v_from
  ) INTO v;

  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.admin_pro_signups(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pro_signups(integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_venue_overview(p_venue_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'tables', (SELECT jsonb_build_object('n', count(*), 'gross', round(COALESCE(sum(tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END)), 0), 2), 'yuno', round(COALESCE(sum(COALESCE(tr.service_fee, 0) + COALESCE(tr.management_fee, 0)), 0), 2))
        FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')),
      'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
        WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND ge.status IS DISTINCT FROM 'cancelled'),
      'last_sale_at', (SELECT max(x.at) FROM (
        SELECT max(o.created_at) AS at FROM public.orders o WHERE o.venue_id = p_venue_id AND o.status IN ('paid', 'served')
        UNION ALL SELECT max(t.created_at) FROM public.tickets t JOIN public.events e ON e.id = t.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND t.paid_at IS NOT NULL
        UNION ALL SELECT max(tr.created_at) FROM public.table_reservations tr JOIN public.events e ON e.id = tr.event_id WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND tr.status IN ('paid', 'confirmed')) x)
    ),
    'events', jsonb_build_object(
      'total', (SELECT count(*) FROM public.events e WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND e.external_source IS NULL),
      'upcoming', (SELECT count(*) FROM public.events e WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND e.external_source IS NULL AND e.end_at >= now() AND e.cancelled_at IS NULL),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'is_active', e.is_active, 'ticketing', e.ticketing_enabled, 'tables', e.tables_enabled,
          'cancelled', e.cancelled_at IS NOT NULL, 'organizer', op.display_name,
          'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
          'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id)) ORDER BY e.start_at DESC)
        FROM (SELECT * FROM public.events e WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id) AND e.external_source IS NULL ORDER BY e.start_at DESC LIMIT 15) e
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
    'email_campaigns', (SELECT count(*) FROM public.email_campaigns c WHERE c.venue_id = p_venue_id AND NOT COALESCE(public.crm_campaign_is_crm(c.id), false)),
    'newsletter', (SELECT count(*) FROM public.newsletter_subscriptions ns WHERE ns.venue_id = p_venue_id AND ns.opted_in AND ns.product IS NULL),
    'support_grant', (SELECT jsonb_build_object('status', g.status, 'created_at', g.created_at) FROM public.admin_support_grants g JOIN public.venues vn ON vn.owner_id = g.target_user_id
      WHERE vn.id = p_venue_id AND g.status IN ('pending', 'active', 'approved') ORDER BY g.created_at DESC LIMIT 1)
  ) INTO v;
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.admin_venue_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_venue_overview(text) TO authenticated, service_role;
