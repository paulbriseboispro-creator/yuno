-- Admin CRM : un compte Billetterie qui a AJOUTÉ le CRM (extra_products,
-- migration 20261006100000) est un compte CRM pour l'Admin : il apparaît dans la
-- ligne de compte unique (_crm_admin_rows), donc dans Clients, Pilotage, Argent,
-- Plateforme, Légal, Vente ; le revenu CRM le compte (crm_scope_has_crm) ; et il
-- sort des comptes cibles (il a déjà le CRM).


CREATE OR REPLACE FUNCTION public._crm_admin_rows(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_pricing_config();
  v_demo_v text[] := public.demo_venue_ids();
  v_out jsonb;
BEGIN
  WITH sc AS MATERIALIZED (
    SELECT 'venue:' || v.id AS scope_key, 'venue'::text AS kind, v.id AS venue_id, NULL::uuid AS org_id,
           v.name::text AS name, v.city::text AS city, v.owner_id AS owner_id, v.created_at,
           false AS association
      FROM public.venues v
     WHERE (v.product = 'crm' OR 'crm' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AND v.decommissioned_at IS NULL
    UNION ALL
    SELECT 'org:' || o.user_id, 'org', NULL, o.user_id,
           COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text, o.user_id,
           o.created_at, COALESCE(o.bde_verified, false)
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id
     WHERE (o.product = 'crm' OR 'crm' = ANY(COALESCE(o.extra_products, '{}'::text[])))
  ), base AS MATERIALIZED (
    SELECT sc.*, pr.email AS owner_email, NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '') AS owner_name,
           pr.phone AS owner_phone, u.last_sign_in_at,
           (public.is_demo_email(pr.email) OR (sc.venue_id IS NOT NULL AND sc.venue_id = ANY(v_demo_v))) AS is_demo
      FROM sc
      LEFT JOIN public.profiles pr ON pr.id = sc.owner_id
      LEFT JOIN auth.users u ON u.id = sc.owner_id
  ), rows AS (
    SELECT b.*,
           s.status AS sub_status, s.billing_interval, COALESCE(s.founder, false) AS founder, s.trial_ends_at,
           s.current_period_end, COALESCE(s.cancel_at_period_end, false) AS cancel_at_end,
           s.stripe_subscription_id, s.created_at AS sub_created,
           st.business_type, st.sending_frozen_at, st.sending_frozen_reason, st.deletion_requested_at,
           cn.provider AS conn_provider, cn.status AS conn_status, cn.last_ok_at, cn.last_error_at, cn.last_error,
           cn.initial_import_done_at, cn.fail_count, (cn.id IS NOT NULL) AS has_conn,
           public.crm_yunits_balance(b.scope_key) AS balance,
           ct.n AS contacts, ct.reach,
           se.sends30, se.last_send_at,
           pu.n AS buys, pu.eur AS buys_eur, pu.last_at AS last_buy_at,
           ob.imports, ob.send_settings, ob.recipes, ob.team,
           ps.source AS signup_source, ps.utm_source, ps.created_at AS signup_at
      FROM base b
      LEFT JOIN public.crm_subscriptions s ON s.scope_key = b.scope_key
      LEFT JOIN public.crm_settings st ON st.scope_key = b.scope_key
      LEFT JOIN LATERAL (
        SELECT c.* FROM public.ticketing_connections c
         WHERE (b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id)
         ORDER BY c.created_at LIMIT 1) cn ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, count(*) FILTER (WHERE r.subscribed AND r.email IS NOT NULL AND NOT COALESCE(r.bounced, false))::int AS reach
          FROM public.contact_rows(b.venue_id, b.org_id) r) ct ON true
      LEFT JOIN LATERAL (
        SELECT (SELECT count(*) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id)))::int
             + (SELECT count(*) FROM public.sms_campaigns c
                 WHERE c.status IN ('sent', 'sending') AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_id = b.org_id)))::int AS sends30,
               (SELECT max(COALESCE(c.sent_at, c.send_started_at)) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id))) AS last_send_at) se ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n,
               COALESCE(sum(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                                 THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                                 ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END), 0) AS eur,
               max(l.created_at) AS last_at
          FROM public.crm_yunit_lots l
          LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
         WHERE l.scope_key = b.scope_key AND l.kind = 'purchase') pu ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM public.crm_imports i WHERE i.scope_key = b.scope_key AND i.status <> 'undone' AND i.undone_at IS NULL) AS imports,
               EXISTS (SELECT 1 FROM public.crm_email_settings e WHERE e.scope_key = b.scope_key
                          AND COALESCE(e.sender_name, '') <> '' AND COALESCE(e.postal_address, '') <> '') AS send_settings,
               (SELECT count(*) FROM public.email_automations a WHERE a.enabled
                   AND ((b.venue_id IS NOT NULL AND a.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND a.organizer_user_id = b.org_id)))::int AS recipes,
               CASE WHEN b.org_id IS NOT NULL
                    THEN (SELECT count(*) FROM public.org_members m WHERE m.organizer_user_id = b.org_id AND m.invitation_status = 'accepted')::int
                    ELSE (SELECT count(*) FROM public.manager_permissions mp WHERE mp.venue_id = b.venue_id)::int END AS team) ob ON true
      LEFT JOIN LATERAL (
        SELECT p.source, p.utm_source, p.created_at FROM public.pro_signups p
         WHERE p.user_id = b.owner_id AND p.product = 'crm' ORDER BY p.created_at DESC LIMIT 1) ps ON true
     WHERE p_include_demo OR NOT b.is_demo
  ), calc AS (
    SELECT r.*,
           CASE
             WHEN r.sub_status IS NULL THEN 'paused'
             WHEN r.sub_status = 'trialing' AND r.trial_ends_at IS NOT NULL AND r.trial_ends_at > now() THEN 'trial'
             WHEN r.sub_status = 'active' AND (r.stripe_subscription_id IS NOT NULL OR r.current_period_end IS NULL OR r.current_period_end >= now()) THEN 'paid'
             WHEN r.sub_status = 'past_due' THEN 'late'
             WHEN r.sub_status IN ('canceled', 'cancelled', 'incomplete_expired') THEN 'churned'
             ELSE 'paused' END AS state,
           (r.has_conn AND r.last_ok_at IS NOT NULL AND r.last_ok_at > now() - interval '24 hours'
              AND (r.last_error_at IS NULL OR r.last_error_at < r.last_ok_at)) AS sync_ok
      FROM rows r
  ), scored AS (
    SELECT c.*,
           (c.has_conn)::int + (c.initial_import_done_at IS NOT NULL)::int + c.imports::int + c.send_settings::int
             + (c.sends30 > 0 OR c.last_send_at IS NOT NULL)::int + (c.recipes > 0)::int + (c.team > 0)::int AS ob_done,
           CASE WHEN c.sends30 >= 3 THEN 30 WHEN c.sends30 = 2 THEN 21 WHEN c.sends30 = 1 THEN 12 ELSE 0 END AS h_activity,
           CASE WHEN c.last_sign_in_at IS NULL THEN 0
                WHEN c.last_sign_in_at > now() - interval '3 days' THEN 15
                WHEN c.last_sign_in_at > now() - interval '7 days' THEN 11
                WHEN c.last_sign_in_at > now() - interval '14 days' THEN 6
                WHEN c.last_sign_in_at > now() - interval '30 days' THEN 2 ELSE 0 END AS h_presence,
           CASE WHEN c.sync_ok THEN 15 WHEN c.has_conn THEN 5 ELSE 0 END AS h_sync
      FROM calc c
  ), fin AS (
    SELECT s.*, round(40.0 * s.ob_done / 7)::int AS h_onboarding,
           CASE WHEN s.state = 'churned' THEN 0
                ELSE LEAST(100, round(40.0 * s.ob_done / 7)::int + s.h_activity + s.h_presence + s.h_sync) END AS health
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', f.scope_key, 'kind', f.kind, 'venue_id', f.venue_id, 'organizer_user_id', f.org_id,
      'name', f.name, 'city', f.city,
      'type', CASE WHEN f.business_type IN ('club', 'organizer', 'association') THEN f.business_type
                   WHEN f.association THEN 'association' WHEN f.kind = 'venue' THEN 'club' ELSE 'organizer' END,
      'contact', f.owner_name, 'email', f.owner_email, 'phone', f.owner_phone,
      'state', f.state, 'sub_status', f.sub_status, 'interval', f.billing_interval, 'founder', f.founder,
      'trial_ends_at', f.trial_ends_at,
      'trial_left', CASE WHEN f.state = 'trial' THEN GREATEST(0, ceil(extract(epoch FROM f.trial_ends_at - now()) / 86400))::int END,
      'period_end', f.current_period_end, 'cancel_at_end', f.cancel_at_end,
      'paid', f.stripe_subscription_id IS NOT NULL, 'granted', f.state = 'paid' AND f.stripe_subscription_id IS NULL,
      'signup_at', COALESCE(f.signup_at, f.created_at), 'sub_created', f.sub_created,
      'mrr', CASE WHEN f.state IN ('paid', 'late') AND f.stripe_subscription_id IS NOT NULL
                  THEN CASE WHEN f.billing_interval = 'year' THEN round((cfg->>'price_year')::numeric / 12, 2)
                            WHEN f.founder THEN (cfg->>'price_month')::numeric
                            ELSE (cfg->>'price_month_next')::numeric END
                  ELSE 0 END,
      'provider', f.conn_provider, 'conn_status', f.conn_status,
      'sync', CASE WHEN NOT f.has_conn THEN 'none' WHEN f.sync_ok THEN 'ok' ELSE 'error' END,
      'sync_at', f.last_ok_at, 'sync_error', f.last_error, 'sync_error_at', f.last_error_at,
      'contacts', f.contacts, 'reach', f.reach,
      'sends30', f.sends30, 'last_send_at', f.last_send_at,
      'balance', f.balance, 'buys', f.buys, 'buys_eur', round(f.buys_eur, 2), 'last_buy_at', f.last_buy_at,
      'last_login', f.last_sign_in_at,
      'source', COALESCE(NULLIF(f.signup_source, ''), NULLIF(f.utm_source, '')),
      'ob', jsonb_build_array(f.has_conn, f.initial_import_done_at IS NOT NULL, f.imports, f.send_settings,
                              (f.sends30 > 0 OR f.last_send_at IS NOT NULL), f.recipes > 0, f.team > 0),
      'recipes', f.recipes, 'team', f.team,
      'health', f.health,
      'h', jsonb_build_array(f.h_onboarding, f.h_activity, f.h_presence, f.h_sync),
      'frozen_at', f.sending_frozen_at, 'frozen_reason', f.sending_frozen_reason,
      'deletion_requested_at', f.deletion_requested_at,
      'is_demo', f.is_demo
    ) ORDER BY f.health, f.name), '[]'::jsonb)
    INTO v_out
    FROM fin f;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_crm_revenue(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  rows AS (
    SELECT s.*, public.crm_effective_plan(s.scope_key) AS eff,
           -- Prix mensuel HT équivalent (annuel = dix mois, ramené au mois).
           CASE WHEN s.stripe_subscription_id IS NULL OR s.status NOT IN ('active', 'past_due') THEN 0
                ELSE (CASE WHEN s.founder THEN (CASE s.plan WHEN 'essential' THEN 35 WHEN 'pro' THEN 89 WHEN 'business' THEN 175 ELSE 0 END)
                           ELSE (CASE s.plan WHEN 'essential' THEN 49 WHEN 'pro' THEN 129 WHEN 'business' THEN 249 ELSE 0 END) END)
                     * (CASE WHEN s.billing_interval = 'year' THEN 10.0 / 12 ELSE 1 END)
           END AS mrr
      FROM public.crm_subscriptions s CROSS JOIN d
     WHERE public.crm_scope_has_crm(s.scope_key)
       AND (p_include_demo OR NOT (
             (s.venue_id IS NOT NULL AND s.venue_id = ANY(d.dv))
          OR (s.organizer_user_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM auth.users u WHERE u.id = s.organizer_user_id AND public.is_demo_email(u.email)))))
  )
  SELECT jsonb_build_object(
    'accounts', count(*),
    'mrr', round(COALESCE(sum(mrr), 0)::numeric, 2),
    'paying', count(*) FILTER (WHERE mrr > 0),
    'trialing', count(*) FILTER (WHERE status = 'trialing' AND trial_ends_at > now()),
    'past_due', count(*) FILTER (WHERE status = 'past_due'),
    'founders', count(*) FILTER (WHERE founder AND mrr > 0),
    'by_plan', COALESCE((SELECT jsonb_object_agg(eff, c) FROM (SELECT eff, count(*) c FROM rows GROUP BY eff) x), '{}'::jsonb)
  ) INTO v FROM rows;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_admin_target_rows(p_include_demo boolean)
 RETURNS TABLE(key text, name text, city text, city_n text, kind text, email text, phone text, contact text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv)
  SELECT 'venue:' || v.id, v.name::text, v.city::text, trim(public._crm_norm(v.city)), 'club',
         pr.email, pr.phone, NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
    FROM public.venues v CROSS JOIN d
    LEFT JOIN public.profiles pr ON pr.id = v.owner_id
   WHERE COALESCE(v.product, 'suite') <> 'crm' AND NOT ('crm' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AND v.decommissioned_at IS NULL
     AND COALESCE(trim(v.city), '') <> ''
     AND (p_include_demo OR (NOT (v.id = ANY(d.dv)) AND NOT COALESCE(public.is_demo_email(pr.email), false)))
  UNION ALL
  SELECT 'org:' || o.user_id, COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text,
         trim(public._crm_norm(o.city)), CASE WHEN COALESCE(o.bde_verified, false) THEN 'association' ELSE 'organizer' END,
         p.email, p.phone, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')
    FROM public.organizer_profiles o
    JOIN public.profiles p ON p.id = o.user_id
   WHERE COALESCE(o.product, 'suite') <> 'crm' AND NOT ('crm' = ANY(COALESCE(o.extra_products, '{}'::text[]))) AND COALESCE(trim(o.city), '') <> ''
     AND (p_include_demo OR NOT COALESCE(public.is_demo_email(p.email), false));
$function$;

REVOKE ALL ON FUNCTION public._crm_admin_rows(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_rows(boolean) TO service_role;
REVOKE ALL ON FUNCTION public._crm_admin_target_rows(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_target_rows(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.admin_crm_revenue(p_include_demo boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crm_revenue(p_include_demo boolean) TO authenticated, service_role;
