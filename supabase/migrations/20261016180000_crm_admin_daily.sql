-- ============================================================================
-- Yuno CRM — les agents de Yuno (lot A5, 2026-10-16), pour le super admin.
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md § 7 (décisions 5 à 8 du 08/10).
--
-- Sans IA (décision 6), des agrégats seulement, la démo exclue sauf demande :
--   • crm_admin_daily : le bilan du jour de la plateforme (Admin CRM ›
--     Plateforme › Bilan du jour) — synchros en erreur, délivrabilité sur 7
--     jours, essais qui finissent dans 3 jours, comptes qui n'ont rien envoyé
--     depuis 14 jours, prévisions d'acheteurs écartées, et les AUDITS DE
--     PROSPECTS PRÊTS (compte en essai, premier import fait, analyse calculée,
--     soirée dans les 3 semaines) : Paul relit leur plan de soirée
--     (crm_night_plan, ouvert au super admin par crm_scope_allowed) avant
--     l'appel de 15 minutes ;
--   • crm_admin_daily_notify : une alerte par jour (`admin_crm_daily`,
--     emit_admin_notification avec dedup_key), seulement s'il y a quelque
--     chose, par le cron `crm-admin-daily` (7 h 20 UTC). La dérive du score a
--     déjà son alerte (admin_crm_score_drift) : elle n'est pas répétée.
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._crm_admin_daily_core(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb := public._crm_admin_rows(p_include_demo);
  v_sync jsonb; v_deliv jsonb; v_trials jsonb; v_silent jsonb; v_forecast jsonb; v_audits jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cad (id text PRIMARY KEY, name text, state text, venue_id text, org uuid,
                                        sync text, sync_error text, trial_ends_at timestamptz) ON COMMIT DROP;
  TRUNCATE _cad;
  INSERT INTO _cad
  SELECT r->>'id', r->>'name', r->>'state', r->>'venue_id', NULLIF(r->>'organizer_user_id', '')::uuid,
         r->>'sync', r->>'sync_error', NULLIF(r->>'trial_ends_at', '')::timestamptz
    FROM jsonb_array_elements(v_rows) r
  ON CONFLICT DO NOTHING;

  -- Synchros en erreur.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'error', a.sync_error) ORDER BY a.name), '[]'::jsonb)
    INTO v_sync FROM _cad a WHERE a.sync = 'error';

  -- Délivrabilité des 7 derniers jours (200 e-mails au moins pour juger).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'sent', x.sent, 'bounced', x.bounced, 'complained', x.complained)
           ORDER BY x.bounced::numeric / x.sent DESC), '[]'::jsonb)
    INTO v_deliv
    FROM (SELECT a.id, a.name, sum(COALESCE(c.recipients_count, c.total_recipients, 0))::int AS sent,
                 sum(COALESCE(c.bounced_count, 0))::int AS bounced, sum(COALESCE(c.complained_count, 0))::int AS complained
            FROM _cad a
            JOIN public.email_campaigns c ON c.venue_id IS NOT DISTINCT FROM a.venue_id
                                         AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org)
           WHERE c.sent_at > now() - interval '7 days' AND c.status IN ('sent', 'sending')
           GROUP BY a.id, a.name) x
   WHERE x.sent >= 200 AND (x.bounced > 0.03 * x.sent OR x.complained > 0.001 * x.sent);

  -- Essais qui finissent dans les 3 jours.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'trial_ends_at', a.trial_ends_at) ORDER BY a.trial_ends_at), '[]'::jsonb)
    INTO v_trials FROM _cad a
   WHERE a.state = 'trial' AND a.trial_ends_at > now() AND a.trial_ends_at <= now() + interval '3 days';

  -- Comptes (essai ou payants) qui n'ont rien envoyé depuis 14 jours.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'state', a.state, 'last_send_at', l.at) ORDER BY l.at NULLS FIRST, a.name), '[]'::jsonb)
    INTO v_silent
    FROM _cad a
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        (SELECT max(c.sent_at) FROM public.email_campaigns c
          WHERE c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org) AND c.sent_at IS NOT NULL),
        (SELECT max(c.sent_at) FROM public.sms_campaigns c
          WHERE c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_id = a.org) AND c.sent_at IS NOT NULL),
        (SELECT max(st.done_at) FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
          WHERE s.scope_key = a.id AND st.status = 'sent'),
        (SELECT max(l.created_at) FROM public.email_automation_sends l
          WHERE l.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR l.organizer_user_id = a.org) AND l.status = 'queued')) AS at) l
   WHERE a.state IN ('trial', 'paid') AND (l.at IS NULL OR l.at < now() - interval '14 days');

  -- Prévisions d'acheteurs écartées de plus de 15 % (soirées réglées cette semaine).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'title', r.title, 'start_at', r.start_at,
           'err_pct', round(100 * (r.metrics->'projection'->>'err')::numeric)) ORDER BY r.start_at DESC), '[]'::jsonb)
    INTO v_forecast
    FROM _cad a JOIN public.crm_prediction_results r ON r.scope_key = a.id
   WHERE r.horizon = 'd7' AND r.settled_at > now() - interval '7 days'
     AND (r.metrics->'projection'->>'err')::numeric > 0.15;

  -- Audits de prospects prêts : essai, premier import fait, analyse calculée,
  -- une soirée dans les 3 semaines (son plan de soirée se lit dans l'Admin).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'trial_ends_at', a.trial_ends_at,
           'event_id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at), '[]'::jsonb)
    INTO v_audits
    FROM _cad a
    JOIN public.crm_analysis_state an ON an.scope_key = a.id AND an.computed_at IS NOT NULL
    CROSS JOIN LATERAL (SELECT ev.id, ev.title, ev.start_at FROM public.events ev
                         WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
                           AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
                           AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id) OR (a.venue_id IS NULL AND ev.organizer_user_id = a.org))
                         ORDER BY ev.start_at LIMIT 1) e
   WHERE a.state = 'trial'
     AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.initial_import_done_at IS NOT NULL
                    AND c.venue_id IS NOT DISTINCT FROM a.venue_id AND (a.venue_id IS NOT NULL OR c.organizer_user_id = a.org));

  RETURN jsonb_build_object('at', now(),
    'sync_errors', v_sync, 'deliverability', v_deliv, 'trials_ending', v_trials, 'silent', v_silent,
    'forecast', v_forecast, 'audits', v_audits,
    'counts', jsonb_build_object('sync_errors', jsonb_array_length(v_sync), 'deliverability', jsonb_array_length(v_deliv),
                                 'trials_ending', jsonb_array_length(v_trials), 'silent', jsonb_array_length(v_silent),
                                 'forecast', jsonb_array_length(v_forecast), 'audits', jsonb_array_length(v_audits)));
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_admin_daily_core(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_daily_core(boolean) TO service_role;

-- L'écran (super admin).
CREATE OR REPLACE FUNCTION public.crm_admin_daily(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN public._crm_admin_daily_core(p_include_demo);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_daily(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_daily(boolean) TO authenticated, service_role;

-- L'alerte du jour (cron) : une seule, seulement s'il y a quelque chose.
CREATE OR REPLACE FUNCTION public.crm_admin_daily_notify()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d jsonb;
  c jsonb;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  d := public._crm_admin_daily_core(false);
  c := d->'counts';
  IF (c->>'sync_errors')::int > 0 THEN v_parts := array_append(v_parts, format('%s synchro(s) en erreur', c->>'sync_errors')); END IF;
  IF (c->>'deliverability')::int > 0 THEN v_parts := array_append(v_parts, format('%s alerte(s) de délivrabilité', c->>'deliverability')); END IF;
  IF (c->>'trials_ending')::int > 0 THEN v_parts := array_append(v_parts, format('%s essai(s) finissent dans 3 jours', c->>'trials_ending')); END IF;
  IF (c->>'audits')::int > 0 THEN v_parts := array_append(v_parts, format('%s audit(s) de prospect prêt(s)', c->>'audits')); END IF;
  IF (c->>'forecast')::int > 0 THEN v_parts := array_append(v_parts, format('%s prévision(s) écartée(s)', c->>'forecast')); END IF;
  IF (c->>'silent')::int > 0 THEN v_parts := array_append(v_parts, format('%s compte(s) sans envoi depuis 14 jours', c->>'silent')); END IF;
  IF cardinality(v_parts) = 0 THEN RETURN jsonb_build_object('sent', false); END IF;
  BEGIN
    PERFORM public.emit_admin_notification(
      'admin_crm_daily', 'Yuno CRM : le bilan du jour', array_to_string(v_parts, ' · ') || '.',
      CASE WHEN (c->>'sync_errors')::int > 0 OR (c->>'deliverability')::int > 0 THEN 'high' ELSE 'normal' END,
      'crm_daily', to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'), c,
      'crm_daily:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'), NULL);
  EXCEPTION WHEN others THEN NULL;  -- une alerte ne fait jamais échouer le balayage
  END;
  RETURN jsonb_build_object('sent', true, 'counts', c);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_daily_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_admin_daily_notify() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-admin-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-admin-daily');
  PERFORM cron.schedule('crm-admin-daily', '20 7 * * *', $job$SELECT public.crm_admin_daily_notify()$job$);
END $$;

NOTIFY pgrst, 'reload schema';
