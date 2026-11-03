-- Lot 1 (CRM_NIGHT_CAMPAIGN_PLAN.md) : lancer un plan, deux mises en file, le suivi.
-- Rejoué sur la prod dans une transaction annulée (rehearse.mjs).
DO $$
DECLARE
  v_ev  uuid := 'ad86ac12-4019-4c39-a223-d556278c750a';
  v_own text := '0dfb2e2a-4cd7-4a2a-b01e-95d20d4ff41d';
  v_c   jsonb := jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'text', 'body', 'x')), 'subject', 'Test', 'name', 'Plan test');
  v_l   jsonb; v_e jsonb; v_g jsonb; v_out text := ''; x jsonb; v_cid uuid; t0 timestamptz;
BEGIN
  -- Identité d'expéditeur de test (annulée avec le reste).
  UPDATE public.crm_email_settings SET legal_name = 'WOH SAS (test)', postal_address = '12 rue de Test 75011 Paris'
   WHERE scope_key = public.crm_scope_key('woh', NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_own, true);
  t0 := clock_timestamp();
  v_l := public.crm_night_plan_launch('woh', NULL, v_ev, ARRAY['early', 'once_local', 'last_minute'],
           jsonb_build_object('early', v_c, 'once_local', v_c, 'last_minute', v_c));
  v_out := v_out || format(E'\nLAUNCH (%s ms) %s', round(extract(epoch FROM clock_timestamp() - t0) * 1000), v_l::text);
  IF NOT COALESCE((v_l->>'ok')::boolean, false) THEN RAISE EXCEPTION 'SMOKE_OK %', v_out; END IF;
  -- Le deuxième lancement est refusé.
  v_out := v_out || E'\nAGAIN ' || (public.crm_night_plan_launch('woh', NULL, v_ev, ARRAY['early'], jsonb_build_object('early', v_c))->>'error');
  -- Un client ne change pas l'audience d'un e-mail du plan.
  v_cid := (v_l->'campaigns'->0->>'id')::uuid;
  -- En tant que client : la garde ne vise que authenticated / anon.
  SET LOCAL ROLE authenticated;
  UPDATE public.email_campaigns SET audiences_json = '[]'::jsonb, subject = 'Test retouché' WHERE id = v_cid;
  BEGIN
    UPDATE public.email_campaigns SET night_plan_id = NULL WHERE id = v_cid;
    v_out := v_out || E'\nDETACH BY CLIENT: NOT REFUSED (bug)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_out := v_out || E'\nDETACH BY CLIENT: refused';
  END;
  RESET ROLE;
  v_out := v_out || E'\nAUD KEPT ' || (SELECT jsonb_array_length(audiences_json) || ' subject=' || subject FROM public.email_campaigns WHERE id = v_cid);
  -- Étape 2 : avant programmation, rien n'est programmé ; un e-mail relu par l'IA, un gardé tel quel.
  v_out := v_out || E'\nSETUP ' || (SELECT string_agg(status, ',') FROM public.email_campaigns WHERE night_plan_id = (v_l->>'plan_id')::uuid);
  UPDATE public.email_campaigns SET ai_updated_at = now(), ai_author = 'Claude' WHERE id = (v_l->'campaigns'->1->>'id')::uuid;
  v_out := v_out || E'\nREVIEW ' || public.crm_night_plan_review('woh', NULL, (v_l->>'plan_id')::uuid, v_cid, true)::text;
  v_g := public.crm_night_plan_get('woh', NULL, v_ev);
  v_out := v_out || E'\nREVIEWED ' || (SELECT string_agg((y->>'audience') || '=' || (y->>'reviewed') || '/' || COALESCE(y->>'edited_by', '-'), ' ') FROM jsonb_array_elements(v_g->'plan'->'campaigns') y);
  -- Étape 3 : programmer.
  v_out := v_out || E'\nSCHEDULE ' || public.crm_night_plan_schedule('woh', NULL, (v_l->>'plan_id')::uuid)::text;
  v_out := v_out || E'\nAFTER ' || (SELECT string_agg(night_plan_step || ':' || status || '@' || to_char(scheduled_at AT TIME ZONE 'Europe/Paris', 'DD HH24:MI'), ' ' ORDER BY scheduled_at) FROM public.email_campaigns WHERE night_plan_id = (v_l->>'plan_id')::uuid);
  -- Mises en file (service_role), dans l'ordre.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  FOR x IN SELECT * FROM jsonb_array_elements(v_l->'campaigns') LOOP
    t0 := clock_timestamp();
    v_e := public.enqueue_campaign_recipients((x->>'id')::uuid);
    v_out := v_out || format(E'\nENQ %s (%s ms) %s', x->>'audience', round(extract(epoch FROM clock_timestamp() - t0) * 1000), v_e::text);
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_own, 'role', 'authenticated')::text, true);
  t0 := clock_timestamp();
  v_g := public.crm_night_plan_get('woh', NULL, v_ev);
  v_out := v_out || format(E'\nGET (%s ms) contacted=%s control=%s', round(extract(epoch FROM clock_timestamp() - t0) * 1000), v_g->'plan'->'contacted', v_g->'plan'->'control');
  FOR x IN SELECT * FROM jsonb_array_elements(v_g->'plan'->'campaigns') LOOP
    v_out := v_out || format(E'\n  %s %s sent=%s pending=%s holdout=%s protected=%s', x->>'audience', x->>'status', x->>'sent', x->>'pending', x->>'holdout', x->>'protected');
  END LOOP;
  t0 := clock_timestamp();
  v_out := v_out || format(E'\nLIST (%s ms) live=%s todo=%s',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    jsonb_array_length(public.crm_night_plans_list('woh', NULL)->'live'), jsonb_array_length(public.crm_night_plans_list('woh', NULL)->'todo'));
  v_out := v_out || E'\nPAUSE ' || public.crm_night_plan_set_status('woh', NULL, (v_l->>'plan_id')::uuid, 'paused')::text;
  v_out := v_out || E'\nRESUME ' || public.crm_night_plan_set_status('woh', NULL, (v_l->>'plan_id')::uuid, 'active')::text;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_out := v_out || E'\nSWEEP ' || public.crm_night_plan_sweep()::text;
  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$$;
