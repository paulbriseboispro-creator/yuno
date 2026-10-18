-- Smoke de la répétition des migrations 20261013100000 → 120000 (lots 0 et 1),
-- sur le compte démo CRM (crm@womber.fr) SEULEMENT. Joué par rehearse.mjs dans
-- la même transaction que les migrations ; l'exception finale annule tout.
DO $smoke$
DECLARE
  v_org   uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_key   text;
  v_ev    uuid;
  v_t     timestamptz;
  v_out   jsonb := '{}'::jsonb;
  v_r     jsonb;
  v_aud   text;
  v_cid   uuid;
  -- Démo seulement : jamais un autre compte.
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'demo account missing'; END IF;
  v_key := 'org:' || v_org;
  SELECT e.event_id INTO v_ev FROM public.external_events e
   WHERE e.organizer_user_id = v_org AND e.start_at > now() ORDER BY e.start_at LIMIT 1;

  -- 1. Calculs de nuit (service).
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_t := clock_timestamp();
  v_r := public.crm_analysis_compute(NULL, v_org, true, 0);
  v_out := v_out || jsonb_build_object('analysis_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
                                       'analysis_people', v_r->'people', 'engine', v_r->'engine');
  v_t := clock_timestamp();
  v_r := public.crm_score_compute(NULL, v_org);
  v_out := v_out || jsonb_build_object('score_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
                                       'score', v_r - 'scope');
  -- 2e nuit : départ à chaud depuis le modèle qu'on vient d'écrire.
  v_t := clock_timestamp();
  v_r := public.crm_score_compute(NULL, v_org);
  v_out := v_out || jsonb_build_object('score_warm_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
                                       'score_warm_auc', v_r->'auc');
  v_out := v_out || jsonb_build_object(
    'journal_nights', (SELECT count(*) FROM public.crm_prediction_nights WHERE scope_key = v_key),
    'journal_people', (SELECT count(*) FROM public.crm_prediction_people WHERE scope_key = v_key),
    'journal_people_d7', (SELECT count(*) FROM public.crm_prediction_people WHERE scope_key = v_key AND horizon = 'd7'));

  -- 2. Lectures d'écran, en tant que titulaire du compte démo.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_t := clock_timestamp();
  v_r := public.crm_automations(NULL, v_org, '30d');
  v_out := v_out || jsonb_build_object('automations_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
  IF v_ev IS NOT NULL THEN
    v_t := clock_timestamp();
    v_r := public.crm_night_targets(NULL, v_org, v_ev);
    v_out := v_out || jsonb_build_object('targets_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
                                         'targets_score', v_r->'score');
  END IF;
  v_out := v_out || jsonb_build_object('holdout_settings', public.crm_holdout_settings(NULL, v_org),
                                       'holdout_sends_before', jsonb_array_length(public.crm_holdout_overview(NULL, v_org)->'sends'),
                                       'projection_gate', public._crm_projection_gate(v_key));

  -- 3. Un envoi « Qui cibler » mis en file (la plus grande audience).
  IF v_ev IS NOT NULL THEN
    SELECT a INTO v_aud FROM unnest(ARRAY['likely', 'concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a
     ORDER BY (SELECT count(*) FROM public._crm_night_target_set(v_key, v_ev, a)) DESC LIMIT 1;
    INSERT INTO public.email_campaigns (organizer_user_id, name, subject, status, event_id, audiences_json, product, blocks_version)
    VALUES (v_org, 'Répétition · témoin', 'Répétition', 'draft', v_ev,
            jsonb_build_array(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', 'all',
              'f', jsonb_build_object('ntgt', jsonb_build_object('e', v_ev, 'a', v_aud))))), 'crm', 2)
    RETURNING id INTO v_cid;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_r := public.enqueue_campaign_recipients(v_cid);
    v_out := v_out || jsonb_build_object('holdout_audience', v_aud, 'holdout_enqueue', v_r,
      'holdout_rows', (SELECT jsonb_object_agg(z.k, z.n) FROM (
         SELECT r.status || COALESCE(':' || r.error_message, '') AS k, count(*) AS n
           FROM public.email_campaign_recipients r WHERE r.campaign_id = v_cid GROUP BY 1) z));
  END IF;

  -- 4. Règlement « 70 jours plus tard » : les lignes par personne partent.
  -- Le règlement d'abord, les comptes ensuite : une même expression lirait
  -- l'instantané d'avant le règlement.
  v_out := v_out || jsonb_build_object('settled', public._crm_score_settle(v_key, NULL, v_org, now() + interval '70 days'));
  v_out := v_out || jsonb_build_object(
    'results', (SELECT count(*) FROM public.crm_prediction_results WHERE scope_key = v_key),
    'people_left', (SELECT count(*) FROM public.crm_prediction_people WHERE scope_key = v_key),
    'cron', (SELECT jsonb_agg(jobname ORDER BY jobname) FROM cron.job WHERE jobname LIKE 'crm-%'));

  RAISE EXCEPTION 'SMOKE_OK %', v_out::text;
END
$smoke$;
