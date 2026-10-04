-- ============================================================================
-- Yuno CRM — Admin CRM (super admin), lot 1 : les comptes, le cockpit, la fiche.
--
-- Tout est LU dans les tables réelles (abonnements, Yunits, synchros, envois,
-- inscriptions) ; rien n'est inventé. La démo (comptes @womber.fr, club démo) est
-- exclue par défaut et s'inclut par `p_include_demo`.
--
-- · _crm_admin_rows(démo)         une ligne par espace CRM (club / organisation) :
--                                 statut, MRR, santé /100 et ses quatre parts,
--                                 onboarding en 7 étapes, synchro, solde, achats.
-- · crm_admin_accounts(démo)      la liste (écran Clients).
-- · crm_admin_cockpit(démo, j)    chiffres, entonnoir réel des inscriptions, « à
--                                 faire aujourd'hui », derniers achats, à surveiller.
-- · crm_admin_account(espace)     la fiche : ligne + grand livre + synchros + envois
--                                 + notes + journal d'audit de CE compte.
-- · Gestes : crm_admin_grant_yunits, crm_admin_extend_trial, crm_admin_freeze,
--   crm_admin_note_save. Chaque geste écrit une ligne `admin_audit_log` ; un motif
--   est obligatoire pour tout ce qui coûte ou coupe.
-- · Gel d'envoi (`crm_settings.sending_frozen_at`) : refusé par un trigger sur les
--   campagnes email / SMS ; une recette automatique est mise en pause (jamais une
--   exception : elle ferait tomber la collecte des autres comptes).
--
-- Santé /100 (une seule définition, ici) :
--   onboarding 40 (étapes faites / 7) + activité 30 (envois sur 30 j : 0 → 0,
--   1 → 12, 2 → 21, 3 et plus → 30) + présence 15 (dernière connexion : ≤ 3 j →
--   15, ≤ 7 j → 11, ≤ 14 j → 6, ≤ 30 j → 2) + synchro 15 (billetterie saine →
--   15, connectée mais en retard ou en erreur → 5, absente → 0). Résilié = 0.
-- ============================================================================

-- ── Gel d'envoi + notes admin ───────────────────────────────────────────────
ALTER TABLE public.crm_settings
  ADD COLUMN IF NOT EXISTS sending_frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS sending_frozen_reason text,
  ADD COLUMN IF NOT EXISTS sending_frozen_by uuid;

CREATE TABLE IF NOT EXISTS public.crm_admin_notes (
  scope_key text PRIMARY KEY,
  body text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_admin_notes FROM PUBLIC, anon, authenticated;

-- ── Porte super admin ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_admin_gate()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN RETURN; END IF;
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_admin_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_gate() TO service_role;

-- ── Les lignes de compte ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_admin_rows(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
     WHERE v.product = 'crm' AND v.decommissioned_at IS NULL
    UNION ALL
    SELECT 'org:' || o.user_id, 'org', NULL, o.user_id,
           COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text, o.user_id,
           o.created_at, COALESCE(o.bde_verified, false)
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id
     WHERE o.product = 'crm'
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
$$;
REVOKE ALL ON FUNCTION public._crm_admin_rows(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_rows(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_accounts(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'accounts', public._crm_admin_rows(p_include_demo));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_accounts(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_accounts(boolean) TO authenticated, service_role;

-- ── Le cockpit ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_cockpit(p_include_demo boolean DEFAULT false, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END;
  v_start timestamptz := now() - v_days * interval '1 day';
  v_pstart timestamptz := now() - 2 * v_days * interval '1 day';
  cfg jsonb := public.crm_pricing_config();
  v_rows jsonb;
  v_signups jsonb;
  v_funnel jsonb;
  v_recent jsonb;
  v_buys jsonb;
  v_series jsonb;
  v_kpi jsonb;
  v_started integer; v_pstarted integer; v_created integer; v_pcreated integer;
  v_demo_u uuid[];
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);

  SELECT COALESCE(array_agg(id), '{}') INTO v_demo_u FROM public.profiles WHERE public.is_demo_email(email);

  -- Inscriptions : une ligne par parcours (pro_signups), produit CRM.
  DROP TABLE IF EXISTS _cs;
  CREATE TEMP TABLE _cs ON COMMIT DROP AS
    SELECT p.* FROM public.pro_signups p
     WHERE p.product = 'crm'
       AND (p_include_demo OR (p.user_id IS NULL OR NOT (p.user_id = ANY(v_demo_u)))
             AND (p.email IS NULL OR NOT public.is_demo_email(p.email)));

  SELECT count(*) FILTER (WHERE created_at >= v_start), count(*) FILTER (WHERE created_at >= v_pstart AND created_at < v_start),
         count(*) FILTER (WHERE account_created_at >= v_start), count(*) FILTER (WHERE account_created_at >= v_pstart AND account_created_at < v_start)
    INTO v_started, v_pstarted, v_created, v_pcreated FROM _cs;

  -- Entonnoir réel : les parcours commencés dans la période, jusqu'à l'abonnement.
  WITH co AS (
    SELECT c.user_id FROM _cs c WHERE c.created_at >= v_start
  ), acc AS (
    SELECT r FROM jsonb_array_elements(v_rows) r
     WHERE (r->>'organizer_user_id') IN (SELECT user_id::text FROM co WHERE user_id IS NOT NULL)
        OR (r->>'venue_id') IN (SELECT venue_id FROM _cs WHERE created_at >= v_start AND venue_id IS NOT NULL)
  )
  SELECT jsonb_build_array(
      jsonb_build_object('k', 'started', 'n', v_started),
      jsonb_build_object('k', 'account', 'n', (SELECT count(*) FROM _cs WHERE created_at >= v_start AND account_created_at IS NOT NULL)),
      jsonb_build_object('k', 'console', 'n', (SELECT count(*) FROM _cs WHERE created_at >= v_start AND console_opened_at IS NOT NULL)),
      jsonb_build_object('k', 'connected', 'n', (SELECT count(*) FROM acc WHERE (r->>'sync') <> 'none')),
      jsonb_build_object('k', 'sent', 'n', (SELECT count(*) FROM acc WHERE (r->>'sends30')::int > 0 OR r->>'last_send_at' IS NOT NULL)),
      jsonb_build_object('k', 'paid', 'n', (SELECT count(*) FROM acc WHERE (r->>'state') IN ('paid', 'late'))))
    INTO v_funnel;

  -- Derniers parcours d'inscription (e-mail masqué).
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'at') DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object(
             'at', c.updated_at,
             'who', CASE WHEN c.email IS NULL OR c.email = '' THEN NULL
                         ELSE left(split_part(c.email, '@', 1), 2) || '•••@' || split_part(c.email, '@', 2) END,
             'org', c.org_name, 'city', c.city, 'kind', c.kind,
             'last_step', c.last_step, 'steps', COALESCE(c.steps, '{}'::jsonb),
             'source', COALESCE(NULLIF(c.source, ''), NULLIF(c.utm_source, '')), 'device', c.device,
             'live', c.account_created_at IS NULL AND c.updated_at > now() - interval '1 hour',
             'account', c.account_created_at IS NOT NULL) AS x
      FROM _cs c ORDER BY c.updated_at DESC LIMIT 5) q;

  -- Derniers achats de Yunits.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'at') DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object(
             'at', l.created_at, 'id', l.scope_key, 'yunits', l.amount,
             'eur', round(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                               THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                               ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END, 2),
             'name', (SELECT r->>'name' FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = l.scope_key LIMIT 1)) AS x
      FROM public.crm_yunit_lots l
      LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
     WHERE l.kind = 'purchase'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = l.scope_key)
     ORDER BY l.created_at DESC LIMIT 5) q;

  -- Abonnements actifs aujourd'hui, par date de souscription (pas d'historique de résiliations).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', d, 'paying', (
           SELECT count(*) FROM jsonb_array_elements(v_rows) r
            WHERE (r->>'state') IN ('paid', 'late') AND (r->>'sub_created')::timestamptz < d + interval '1 day'),
         'mrr', (SELECT COALESCE(sum((r->>'mrr')::numeric), 0) FROM jsonb_array_elements(v_rows) r
            WHERE (r->>'state') IN ('paid', 'late') AND (r->>'sub_created')::timestamptz < d + interval '1 day')) ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series((now() - (v_days - 1) * interval '1 day')::date, now()::date, interval '1 day') d;

  v_kpi := jsonb_build_object(
    'started', v_started, 'pstarted', v_pstarted, 'created', v_created, 'pcreated', v_pcreated,
    'paying', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE (r->>'state') = 'paid'),
    'late', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE (r->>'state') = 'late'),
    'trial', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE (r->>'state') = 'trial'),
    'mrr', (SELECT COALESCE(sum((r->>'mrr')::numeric), 0) FROM jsonb_array_elements(v_rows) r),
    'buys', (SELECT count(*) FROM public.crm_yunit_lots l WHERE l.kind = 'purchase' AND l.created_at >= v_start
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = l.scope_key)),
    'buys_eur', (SELECT COALESCE(round(sum(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                               THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                               ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END), 2), 0)
               FROM public.crm_yunit_lots l
               LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
              WHERE l.kind = 'purchase' AND l.created_at >= v_start
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = l.scope_key)),
    'live_signups', (SELECT count(*) FROM _cs WHERE account_created_at IS NULL AND updated_at > now() - interval '1 hour'));

  RETURN jsonb_build_object('at', now(), 'days', v_days, 'kpi', v_kpi, 'funnel', v_funnel, 'series', v_series,
                            'recent_signups', v_recent, 'recent_buys', v_buys, 'accounts', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_cockpit(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_cockpit(boolean, integer) TO authenticated, service_role;

-- ── La fiche d'un compte ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_account(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_conn uuid;
  v_parts record;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT r INTO v_row FROM jsonb_array_elements(public._crm_admin_rows(true)) r WHERE r->>'id' = p_scope_key LIMIT 1;
  IF v_row IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  SELECT id INTO v_conn FROM public.ticketing_connections c
   WHERE (v_parts.venue_id IS NOT NULL AND c.venue_id = v_parts.venue_id)
      OR (v_parts.organizer_user_id IS NOT NULL AND c.organizer_user_id = v_parts.organizer_user_id)
   ORDER BY c.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'account', v_row,
    'moves', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', m.at, 'delta', m.delta, 'kind', m.kind, 'lot_kind', m.lot_kind,
                         'channel', m.channel, 'label', m.label) ORDER BY m.at DESC)
                         FROM (SELECT * FROM public.crm_yunit_moves WHERE scope_key = p_scope_key ORDER BY at DESC LIMIT 40) m), '[]'::jsonb),
    'runs', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', r.started_at, 'trigger', r.trigger, 'status', r.status,
                         'requests', r.requests, 'tickets', r.tickets_upserted, 'error', r.error) ORDER BY r.started_at DESC)
                        FROM (SELECT * FROM public.ticketing_sync_runs WHERE connection_id = v_conn ORDER BY started_at DESC LIMIT 20) r), '[]'::jsonb),
    'sends', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
                         SELECT jsonb_build_object('at', COALESCE(c.sent_at, c.send_started_at, c.created_at), 'name', c.name, 'status', c.status,
                                'recipients', c.total_recipients, 'bounced', c.bounced_count, 'complained', c.complained_count, 'channel', 'email') AS x
                           FROM public.email_campaigns c
                          WHERE c.automation_id IS NULL
                            AND ((v_parts.venue_id IS NOT NULL AND c.venue_id = v_parts.venue_id)
                              OR (v_parts.organizer_user_id IS NOT NULL AND c.organizer_user_id = v_parts.organizer_user_id))
                          ORDER BY COALESCE(c.sent_at, c.send_started_at, c.created_at) DESC LIMIT 10) q), '[]'::jsonb),
    'note', COALESCE((SELECT body FROM public.crm_admin_notes WHERE scope_key = p_scope_key), ''),
    'audit', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'meta', a.metadata) ORDER BY a.created_at DESC)
                         FROM (SELECT * FROM public.admin_audit_log WHERE entity_type = 'crm_account' AND entity_id = p_scope_key
                               ORDER BY created_at DESC LIMIT 30) a), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_account(text) TO authenticated, service_role;

-- ── Gestes (audités) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_admin_audit(p_action text, p_scope text, p_meta jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), p_action, 'crm_account', p_scope, COALESCE(p_meta, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._crm_admin_audit(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_audit(text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_note_save(p_scope_key text, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  INSERT INTO public.crm_admin_notes (scope_key, body, updated_by, updated_at)
  VALUES (p_scope_key, left(COALESCE(p_body, ''), 4000), auth.uid(), now())
  ON CONFLICT (scope_key) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_note_save(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_note_save(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_grant_yunits(p_scope_key text, p_amount integer, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN RAISE EXCEPTION 'bad_amount' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_subscriptions WHERE scope_key = p_scope_key) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_res := public.crm_yunits_credit(p_scope_key, 'grant', p_amount, now() + interval '12 months',
             'admin:' || gen_random_uuid()::text, 'Geste commercial', jsonb_build_object('reason', left(trim(p_reason), 300)));
  PERFORM public._crm_admin_audit('crm_grant_yunits', p_scope_key, jsonb_build_object('amount', p_amount, 'reason', left(trim(p_reason), 300)));
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_grant_yunits(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_grant_yunits(text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_extend_trial(p_scope_key text, p_days integer, p_reason text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end timestamptz;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN RAISE EXCEPTION 'bad_days' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_subscriptions
     SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + p_days * interval '1 day', status = 'trialing', updated_at = now()
   WHERE scope_key = p_scope_key AND stripe_subscription_id IS NULL AND status IN ('trialing', 'none', 'canceled', 'incomplete')
   RETURNING trial_ends_at INTO v_end;
  IF v_end IS NULL THEN RAISE EXCEPTION 'not_extendable' USING ERRCODE = '22023'; END IF;
  PERFORM public._crm_admin_audit('crm_extend_trial', p_scope_key, jsonb_build_object('days', p_days, 'reason', left(trim(p_reason), 300), 'ends_at', v_end));
  RETURN v_end;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_extend_trial(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_extend_trial(text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_freeze(p_scope_key text, p_frozen boolean, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts record;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope_key);
  IF v_parts.venue_id IS NULL AND v_parts.organizer_user_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.crm_settings (scope_key, venue_id, organizer_user_id, sending_frozen_at, sending_frozen_reason, sending_frozen_by)
  VALUES (p_scope_key, v_parts.venue_id, v_parts.organizer_user_id,
          CASE WHEN p_frozen THEN now() END, CASE WHEN p_frozen THEN left(trim(p_reason), 300) END, CASE WHEN p_frozen THEN auth.uid() END)
  ON CONFLICT (scope_key) DO UPDATE
     SET sending_frozen_at = EXCLUDED.sending_frozen_at, sending_frozen_reason = EXCLUDED.sending_frozen_reason,
         sending_frozen_by = EXCLUDED.sending_frozen_by, updated_at = now();
  PERFORM public._crm_admin_audit(CASE WHEN p_frozen THEN 'crm_freeze_sending' ELSE 'crm_unfreeze_sending' END, p_scope_key,
                                  jsonb_build_object('reason', left(trim(p_reason), 300)));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_freeze(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_freeze(text, boolean, text) TO authenticated, service_role;

-- ── Le gel refuse l'envoi (trigger, jamais d'exception pour une recette) ───
CREATE OR REPLACE FUNCTION public.guard_crm_send_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_org uuid;
BEGIN
  IF NEW.status NOT IN ('sending', 'scheduled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'sms_campaigns' THEN
    v_org := NEW.organizer_id;
  ELSE
    v_org := NEW.organizer_user_id;
  END IF;
  v_scope := public.crm_scope_key(NEW.venue_id, v_org);
  IF v_scope IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.crm_settings s WHERE s.scope_key = v_scope AND s.sending_frozen_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'email_campaigns' AND NEW.automation_id IS NOT NULL THEN
    NEW.status := 'paused';
    NEW.paused_reason := 'frozen';
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'crm_send_frozen' USING ERRCODE = 'P0001';
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_crm_send_frozen ON public.email_campaigns;
CREATE TRIGGER trg_guard_crm_send_frozen BEFORE INSERT OR UPDATE OF status ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_send_frozen();
DROP TRIGGER IF EXISTS trg_guard_crm_send_frozen ON public.sms_campaigns;
CREATE TRIGGER trg_guard_crm_send_frozen BEFORE INSERT OR UPDATE OF status ON public.sms_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_send_frozen();
