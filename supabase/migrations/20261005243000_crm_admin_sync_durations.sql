-- Admin CRM › Plateforme : durée médiane (p50) et p95 d'une synchro, et clôture
-- des passes abandonnées.
--
-- Constat (05/10) : ticketing_sync_runs est VIDE en base (aucune connexion réelle
-- n'a encore synchronisé) ; l'edge clôt déjà chaque passe (finishRun écrit
-- finished_at sur tous ses chemins de sortie). Le seul trou réel : une instance
-- tuée en cours de route (délai edge, redéploiement) laisse une ligne 'running'
-- pour toujours. Ce correctif la marque 'abandoned' SANS inventer de fin
-- (finished_at reste NULL) ; la durée ne se calcule que sur une passe terminée.

ALTER TABLE public.ticketing_sync_runs DROP CONSTRAINT IF EXISTS ticketing_sync_runs_status_check;
ALTER TABLE public.ticketing_sync_runs ADD CONSTRAINT ticketing_sync_runs_status_check
  CHECK (status IN ('running', 'ok', 'partial', 'error', 'rate_limited', 'abandoned'));

CREATE OR REPLACE FUNCTION public.crm_close_stale_sync_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.ticketing_sync_runs
     SET status = 'abandoned', error = COALESCE(error, 'abandoned_no_finish')
   WHERE status = 'running' AND finished_at IS NULL AND started_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_close_stale_sync_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_close_stale_sync_runs() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-close-stale-sync-runs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('crm-close-stale-sync-runs', '11 * * * *', $$SELECT public.crm_close_stale_sync_runs();$$);

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
  v_hours jsonb; v_dur jsonb; v_imports jsonb; v_quota jsonb; v_bounce jsonb; v_supp jsonb; v_cron jsonb; v_last_err jsonb; v_frozen jsonb; v_win jsonb;
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

  -- Durée d'une passe terminée (30 jours). Une passe sans fin connue n'entre pas
  -- dans le calcul : on ne devine jamais une durée.
  SELECT jsonb_build_object('n', count(*),
           'p50', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.finished_at - r.started_at)),
           'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM r.finished_at - r.started_at)),
           'open', (SELECT count(*) FROM public.ticketing_sync_runs o JOIN public.ticketing_connections oc ON oc.id = o.connection_id
                     WHERE o.finished_at IS NULL AND o.status <> 'running' AND public.crm_scope_key(oc.venue_id, oc.organizer_user_id) = ANY(v_ids)))
    INTO v_dur
    FROM public.ticketing_sync_runs r JOIN public.ticketing_connections c ON c.id = r.connection_id
   WHERE r.finished_at IS NOT NULL AND r.status IN ('ok', 'partial') AND r.started_at >= now() - interval '30 days'
     AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = ANY(v_ids);

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
    'shotgun', jsonb_build_object('conns', v_conns, 'runs24', v_runs, 'errors24', v_err, 'req24', v_req, 'hours', v_hours, 'window', v_win, 'errors', v_last_err, 'duration', v_dur),
    'imports', v_imports, 'quota', v_quota, 'bounce', v_bounce, 'suppression', v_supp, 'frozen', v_frozen, 'cron', v_cron);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_platform(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_platform(boolean) TO authenticated, service_role;
