-- ============================================================================
-- Yuno CRM — Admin CRM, lot 2 : Argent, Plateforme, Légal, Réglages.
--
-- Tout vient des tables réelles. Ce que la base ne sait pas (historique d'une
-- résiliation exacte, coût réel d'un envoi) est dit tel quel dans la réponse :
--   · une résiliation est datée par `crm_subscriptions.updated_at` (approximation
--     assumée : le webhook y écrit au moment de la résiliation) ;
--   · le coût réel d'un envoi est un RÉGLAGE (`crm_pricing.config.costs`, € par
--     message), modifiable depuis Réglages, jamais une valeur codée en front.
--
-- · crm_admin_money(démo)      MRR par mois, abonnements actifs, achats de
--                              Yunits (semaines, packs, acheteurs), marge par compte.
-- · crm_admin_platform(démo)   quota Shotgun partagé, synchros 24 h, imports,
--                              quota e-mail, bounces et plaintes par compte,
--                              liste de suppression, comptes gelés, tâches planifiées.
-- · crm_admin_legal(démo)      acceptations CGV / CGU / DPA par compte, consentement
--                              des contacts, attestations d'import, accès assisté,
--                              demandes de suppression, purge des comptes résiliés.
-- · crm_admin_pricing_get()    la grille + son historique.
-- · crm_admin_pricing_set(config, motif)  modifie la grille (validée), écrit
--                              l'historique et le journal d'audit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_pricing_history (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  by_user uuid,
  reason text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL
);
ALTER TABLE public.crm_pricing_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_pricing_history FROM PUBLIC, anon, authenticated;

-- Réglages ajoutés à la grille : seuil du passage au prix public, coûts réels, tarifs par pays.
UPDATE public.crm_pricing
   SET config = config
     || jsonb_build_object('price_switch_at', COALESCE(config->'price_switch_at', to_jsonb(50)),
                           'trial_extensions', COALESCE(config->'trial_extensions', to_jsonb(0)),
                           'costs', COALESCE(config->'costs', jsonb_build_object('email', 0.0004, 'sms', 0.045, 'whatsapp', 0.042, 'instagram', 0)))
 WHERE id;

-- ── Argent ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_money(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg jsonb := public.crm_pricing_config();
  v_rows jsonb;
  v_ids text[];
  v_vat numeric := COALESCE((cfg->>'vat_rate')::numeric, 20);
  v_months jsonb; v_weeks jsonb; v_packs jsonb; v_buys jsonb; v_buyers jsonb; v_subs jsonb; v_margin jsonb;
  v_lost90 integer; v_active_start integer; v_paying integer; v_mrr numeric; v_new3 numeric;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r;

  DROP TABLE IF EXISTS _ms;
  CREATE TEMP TABLE _ms ON COMMIT DROP AS
    SELECT cs.scope_key, cs.status, cs.billing_interval, COALESCE(cs.founder, false) AS founder, cs.created_at, cs.updated_at, cs.current_period_end,
           CASE WHEN cs.billing_interval = 'year' THEN round((cfg->>'price_year')::numeric / 12, 2)
                WHEN COALESCE(cs.founder, false) THEN (cfg->>'price_month')::numeric
                ELSE (cfg->>'price_month_next')::numeric END AS price,
           (cs.status IN ('canceled', 'incomplete')) AS gone
      FROM public.crm_subscriptions cs
     WHERE cs.scope_key = ANY(v_ids) AND cs.stripe_subscription_id IS NOT NULL;

  DROP TABLE IF EXISTS _mp;
  CREATE TEMP TABLE _mp ON COMMIT DROP AS
    SELECT l.id, l.scope_key, l.amount AS yunits, l.created_at AS at,
           round(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                      THEN (m.meta->>'amount_total')::numeric / 100 / (1 + v_vat / 100)
                      ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END, 2) AS eur
      FROM public.crm_yunit_lots l
      LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
     WHERE l.kind = 'purchase' AND l.scope_key = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'm', mth, 'new', COALESCE((SELECT sum(price) FROM _ms WHERE date_trunc('month', created_at) = mth), 0),
           'newN', (SELECT count(*) FROM _ms WHERE date_trunc('month', created_at) = mth),
           'lost', COALESCE((SELECT sum(price) FROM _ms WHERE gone AND date_trunc('month', updated_at) = mth), 0),
           'lostN', (SELECT count(*) FROM _ms WHERE gone AND date_trunc('month', updated_at) = mth),
           'mrr', COALESCE((SELECT sum(price) FROM _ms WHERE created_at < mth + interval '1 month' AND (NOT gone OR updated_at >= mth + interval '1 month')), 0)
         ) ORDER BY mth), '[]'::jsonb)
    INTO v_months
    FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') mth;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('w', w, 'eur', COALESCE((SELECT sum(eur) FROM _mp WHERE at >= w AND at < w + interval '7 days'), 0),
                                               'n', (SELECT count(*) FROM _mp WHERE at >= w AND at < w + interval '7 days')) ORDER BY w), '[]'::jsonb)
    INTO v_weeks
    FROM generate_series(date_trunc('week', now()) - interval '12 weeks', date_trunc('week', now()), interval '1 week') w;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('yunits', yunits, 'n', n, 'eur', eur) ORDER BY n DESC, yunits), '[]'::jsonb) INTO v_packs
    FROM (SELECT yunits, count(*) n, round(sum(eur), 2) eur FROM _mp GROUP BY yunits) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'id', scope_key, 'yunits', yunits, 'eur', eur,
                    'name', (SELECT r->>'name' FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = scope_key LIMIT 1)) ORDER BY at DESC), '[]'::jsonb)
    INTO v_buys FROM (SELECT * FROM _mp ORDER BY at DESC LIMIT 60) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', scope_key, 'n', n, 'eur', eur, 'yunits', yunits,
                    'name', (SELECT r->>'name' FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = scope_key LIMIT 1)) ORDER BY eur DESC), '[]'::jsonb)
    INTO v_buyers FROM (SELECT scope_key, count(*) n, round(sum(eur), 2) eur, sum(yunits) yunits FROM _mp GROUP BY scope_key ORDER BY sum(eur) DESC LIMIT 8) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.scope_key, 'interval', s.billing_interval, 'since', s.created_at, 'next', s.current_period_end,
                    'late', s.status = 'past_due', 'price', s.price,
                    'name', (SELECT r->>'name' FROM jsonb_array_elements(v_rows) r WHERE r->>'id' = s.scope_key LIMIT 1)) ORDER BY s.created_at), '[]'::jsonb)
    INTO v_subs FROM _ms s WHERE NOT s.gone;

  SELECT count(*) FILTER (WHERE gone AND updated_at >= now() - interval '90 days'),
         count(*) FILTER (WHERE created_at < now() - interval '90 days' AND (NOT gone OR updated_at >= now() - interval '90 days')),
         count(*) FILTER (WHERE NOT gone), COALESCE(sum(price) FILTER (WHERE NOT gone), 0),
         COALESCE(sum(price) FILTER (WHERE created_at >= now() - interval '90 days'), 0) / 3
    INTO v_lost90, v_active_start, v_paying, v_mrr, v_new3 FROM _ms;

  -- Marge par compte, 30 jours : revenu (abonnement + recharges) moins coût réel des envois.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'margin')::numeric), '[]'::jsonb) INTO v_margin FROM (
    SELECT jsonb_build_object(
             'id', r->>'id', 'name', r->>'name', 'state', r->>'state',
             'sub', COALESCE((SELECT s.price FROM _ms s WHERE s.scope_key = r->>'id' AND NOT s.gone), 0),
             'recharge', COALESCE((SELECT sum(eur) FROM _mp p WHERE p.scope_key = r->>'id' AND p.at >= now() - interval '30 days'), 0),
             'units', COALESCE((SELECT jsonb_object_agg(channel, u) FROM (
                         SELECT COALESCE(channel, 'email') AS channel, sum(-delta) AS u FROM public.crm_yunit_moves
                          WHERE scope_key = r->>'id' AND kind = 'debit' AND at >= now() - interval '30 days' GROUP BY 1) q), '{}'::jsonb)
           ) AS x
      FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned') w;
  -- coût et marge calculés ici, une fois, avec les coûts et tarifs de la grille.
  SELECT COALESCE(jsonb_agg(m || jsonb_build_object(
           'cost', c, 'revenue', (m->>'sub')::numeric + (m->>'recharge')::numeric,
           'margin', (m->>'sub')::numeric + (m->>'recharge')::numeric - c) ORDER BY ((m->>'sub')::numeric + (m->>'recharge')::numeric - c)), '[]'::jsonb)
    INTO v_margin
    FROM (SELECT m, round(COALESCE((SELECT sum(
                    (u.value::numeric / NULLIF(COALESCE((cfg->'rates'->>u.key)::numeric, 1), 0)) * COALESCE((cfg->'costs'->>u.key)::numeric, 0))
                  FROM jsonb_each_text(m->'units') u), 0), 2) AS c
            FROM jsonb_array_elements(v_margin) m) q;

  RETURN jsonb_build_object(
    'at', now(), 'cfg', cfg,
    'kpi', jsonb_build_object('mrr', v_mrr, 'paying', v_paying, 'lost90', v_lost90, 'active_start', v_active_start, 'new_per_month', round(v_new3, 2),
                              'late', (SELECT count(*) FROM _ms WHERE status = 'past_due')),
    'months', v_months, 'subs', v_subs, 'weeks', v_weeks, 'packs', v_packs, 'buys', v_buys, 'buyers', v_buyers, 'margin', v_margin);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_money(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_money(boolean) TO authenticated, service_role;

-- ── Plateforme ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_platform(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_ids text[];
  v_conns integer; v_runs integer; v_err integer; v_req integer;
  v_hours jsonb; v_imports jsonb; v_quota jsonb; v_bounce jsonb; v_supp jsonb; v_cron jsonb; v_last_err jsonb; v_frozen jsonb; v_win jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r;

  SELECT count(*) INTO v_conns FROM public.ticketing_connections c
   WHERE public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids);

  SELECT count(*), count(*) FILTER (WHERE r.status NOT IN ('ok', 'success')), COALESCE(sum(r.requests), 0)
    INTO v_runs, v_err, v_req
    FROM public.ticketing_sync_runs r
    JOIN public.ticketing_connections c ON c.id = r.connection_id
   WHERE r.started_at >= now() - interval '24 hours' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('h', h, 'req', COALESCE((SELECT sum(r.requests) FROM public.ticketing_sync_runs r
                    JOIN public.ticketing_connections c ON c.id = r.connection_id
                   WHERE r.started_at >= h AND r.started_at < h + interval '1 hour' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids)), 0),
                    'runs', (SELECT count(*) FROM public.ticketing_sync_runs r
                    JOIN public.ticketing_connections c ON c.id = r.connection_id
                   WHERE r.started_at >= h AND r.started_at < h + interval '1 hour' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids))) ORDER BY h), '[]'::jsonb)
    INTO v_hours
    FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') h;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_last_err FROM (
    SELECT jsonb_build_object('at', r.started_at, 'error', r.error,
             'name', (SELECT a->>'name' FROM jsonb_array_elements(v_rows) a WHERE a->>'id' = public.crm_scope_key(c.venue_id, c.organizer_user_id) LIMIT 1),
             'id', public.crm_scope_key(c.venue_id, c.organizer_user_id)) AS x
      FROM public.ticketing_sync_runs r JOIN public.ticketing_connections c ON c.id = r.connection_id
     WHERE r.status NOT IN ('ok', 'success') AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids)
     ORDER BY r.started_at DESC LIMIT 6) q;

  SELECT jsonb_build_object('used', COALESCE(used, 0), 'window_start', window_start) INTO v_win
    FROM public.ticketing_rate_window WHERE key = 'shotgun';

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_imports FROM (
    SELECT i.status, count(*) AS n FROM public.crm_imports i WHERE i.scope_key = ANY(v_ids) AND i.created_at >= now() - interval '30 days' GROUP BY i.status) q;

  BEGIN
    v_quota := public.get_email_quota_status();
  EXCEPTION WHEN OTHERS THEN
    v_quota := NULL;
  END;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent')::int DESC), '[]'::jsonb) INTO v_bounce FROM (
    SELECT jsonb_build_object('id', a->>'id', 'name', a->>'name',
             'sent', COALESCE((SELECT sum(c.total_recipients) FROM public.email_campaigns c
                       WHERE c.automation_id IS NULL AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                         AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = a->>'id'), 0),
             'bounced', COALESCE((SELECT sum(c.bounced_count) FROM public.email_campaigns c
                       WHERE c.automation_id IS NULL AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                         AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = a->>'id'), 0),
             'complained', COALESCE((SELECT sum(c.complained_count) FROM public.email_campaigns c
                       WHERE c.automation_id IS NULL AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                         AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = a->>'id'), 0)) AS x
      FROM jsonb_array_elements(v_rows) a) q WHERE (x->>'sent')::int > 0;

  SELECT jsonb_build_object('total', count(*), 'last30', count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
           'by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) n FROM public.email_suppressions GROUP BY reason) z), '{}'::jsonb))
    INTO v_supp FROM public.email_suppressions;

  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_frozen FROM jsonb_array_elements(v_rows) a WHERE a->>'frozen_at' IS NOT NULL;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active) ORDER BY j.jobname), '[]'::jsonb)
      INTO v_cron FROM cron.job j WHERE j.jobname ~ '^(ticketing|crm|email-automation)';
  EXCEPTION WHEN OTHERS THEN
    v_cron := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'at', now(),
    'shotgun', jsonb_build_object('conns', v_conns, 'runs24', v_runs, 'errors24', v_err, 'req24', v_req, 'hours', v_hours, 'window', v_win, 'errors', v_last_err),
    'imports', v_imports, 'quota', v_quota, 'bounce', v_bounce, 'suppression', v_supp, 'frozen', v_frozen, 'cron', v_cron);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_platform(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_platform(boolean) TO authenticated, service_role;

-- ── Légal ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_legal(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_ids text[];
  v_accept jsonb; v_imports jsonb; v_grants jsonb; v_purge jsonb; v_proof jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r;

  -- Qui a accepté quoi, quand, et d'où : la dernière acceptation de chaque document par le titulaire.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r->>'id', 'name', r->>'name', 'email', r->>'email',
           'docs', COALESCE((SELECT jsonb_object_agg(d.doc_type, jsonb_build_object('v', d.doc_version, 'at', d.accepted_at, 'ip', d.ip))
                              FROM (SELECT DISTINCT ON (la.doc_type) la.* FROM public.legal_acceptances la
                                     WHERE la.user_id = (CASE WHEN (r->>'kind') = 'org' THEN (r->>'organizer_user_id')::uuid
                                                              ELSE (SELECT v.owner_id FROM public.venues v WHERE v.id = r->>'venue_id') END)
                                     ORDER BY la.doc_type, la.accepted_at DESC) d), '{}'::jsonb)) ORDER BY r->>'name'), '[]'::jsonb)
    INTO v_accept FROM jsonb_array_elements(v_rows) r;

  -- Attestations d'import : qui a certifié l'origine des contacts, et quand.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_imports FROM (
    SELECT jsonb_build_object('at', i.created_at, 'title', i.title, 'consent', i.consent, 'new', i.new_count, 'status', i.status, 'undone', i.undone_at IS NOT NULL,
             'name', (SELECT a->>'name' FROM jsonb_array_elements(v_rows) a WHERE a->>'id' = i.scope_key LIMIT 1), 'id', i.scope_key) AS x
      FROM public.crm_imports i WHERE i.scope_key = ANY(v_ids) ORDER BY i.created_at DESC LIMIT 15) q;

  -- Accès assisté : sessions de support ouvertes sur ces comptes.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_grants FROM (
    SELECT jsonb_build_object('at', g.created_at, 'status', g.status, 'revoked', g.revoked_at IS NOT NULL, 'reason', g.reason,
             'name', (SELECT a->>'name' FROM jsonb_array_elements(v_rows) a
                       WHERE (a->>'organizer_user_id')::uuid = g.target_user_id
                          OR a->>'venue_id' IN (SELECT v.id FROM public.venues v WHERE v.owner_id = g.target_user_id) LIMIT 1)) AS x
      FROM public.admin_support_grants g
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) a
                    WHERE (a->>'organizer_user_id')::uuid = g.target_user_id
                       OR a->>'venue_id' IN (SELECT v.id FROM public.venues v WHERE v.owner_id = g.target_user_id))
     ORDER BY g.created_at DESC LIMIT 10) q;

  -- Droit à l'effacement : demandes de suppression d'espace, purge 90 jours après.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a->>'id', 'name', a->>'name', 'requested_at', a->>'deletion_requested_at',
                    'purge_at', (a->>'deletion_requested_at')::timestamptz + interval '90 days') ORDER BY a->>'deletion_requested_at'), '[]'::jsonb)
    INTO v_purge FROM jsonb_array_elements(v_rows) a WHERE a->>'deletion_requested_at' IS NOT NULL;

  -- Preuve de consentement : part des contacts joignables dont l'accord est tracé.
  SELECT jsonb_build_object(
           'reachable', COALESCE(sum((a->>'reach')::int), 0),
           'with_proof', COALESCE((SELECT count(DISTINCT lower(e.email)) FROM public.marketing_consent_events e
                                    WHERE e.channel = 'email' AND e.action IN ('opt_in', 'granted', 'subscribe')
                                      AND public.crm_scope_key(e.venue_id, e.organizer_user_id) = ANY(v_ids)), 0))
    INTO v_proof FROM jsonb_array_elements(v_rows) a;

  RETURN jsonb_build_object('at', now(), 'accept', v_accept, 'imports', v_imports, 'grants', v_grants, 'purge', v_purge, 'proof', v_proof);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_legal(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_legal(boolean) TO authenticated, service_role;

-- ── Réglages : la grille ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_pricing_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('cfg', public.crm_pricing_config(),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', h.at, 'reason', h.reason, 'before', h.before, 'after', h.after) ORDER BY h.at DESC)
                           FROM (SELECT * FROM public.crm_pricing_history ORDER BY at DESC LIMIT 30) h), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_pricing_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_pricing_get() TO authenticated, service_role;

-- Modifie la grille : seules les clés connues, bornées, jamais d'effet sur un prix Stripe déjà créé.
CREATE OR REPLACE FUNCTION public.crm_admin_pricing_set(p_patch jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb := public.crm_pricing_config();
  v_after jsonb;
  k text;
  v_num constant text[] := ARRAY['price_month', 'price_month_next', 'price_year', 'trial_days', 'trial_yunits', 'monthly_yunits', 'annual_bonus_yunits',
                                  'price_switch_at', 'trial_extensions', 'low_balance'];
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k = ANY(v_num) THEN
      IF jsonb_typeof(p_patch->k) <> 'number' OR (p_patch->>k)::numeric < 0 OR (p_patch->>k)::numeric > 1000000 THEN
        RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('rates', 'costs', 'channels_live', 'bonus_tiers', 'packs') THEN
      IF jsonb_typeof(p_patch->k) NOT IN ('object', 'array') THEN RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023'; END IF;
    ELSE
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_after := v_before || p_patch;
  IF (v_after->>'price_month')::numeric <= 0 OR (v_after->>'price_year')::numeric <= 0 THEN RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_pricing SET config = v_after, updated_by = auth.uid(), updated_at = now() WHERE id;
  INSERT INTO public.crm_pricing_history (by_user, reason, before, after) VALUES (auth.uid(), left(trim(p_reason), 300), v_before, v_after);
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_pricing_set', 'crm_pricing', 'config', jsonb_build_object('reason', left(trim(p_reason), 300), 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)));
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_pricing_set(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_pricing_set(jsonb, text) TO authenticated, service_role;
