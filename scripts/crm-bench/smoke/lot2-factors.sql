-- Les deux facteurs du lot 2 sur le compte démo CRM (crm@womber.fr) : la
-- validation avec, sans, et chacun seul. Joué par rehearse.mjs avec la
-- migration 20261014100000 ; tout est annulé.
DO $smoke$
DECLARE
  v_org uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_key text;
  v_out jsonb := '[]'::jsonb;
  v_off jsonb;
  m     jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'demo account missing'; END IF;
  v_key := 'org:' || v_org;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR v_off IN SELECT x FROM jsonb_array_elements('[[], ["series_done"], ["artist_recent"], ["artist_recent", "series_done"]]'::jsonb) x LOOP
    UPDATE public.crm_analysis_rules SET config = jsonb_set(config, '{score,off}', v_off);
    DELETE FROM public.crm_score_model WHERE scope_key = v_key;
    PERFORM public.crm_score_compute(NULL, v_org);
    SELECT metrics INTO m FROM public.crm_score_model WHERE scope_key = v_key;
    v_out := v_out || jsonb_build_array(jsonb_build_object('off', v_off,
      'auc', m->'valid'->'auc', 'actifs', m->'valid'->'active'->'auc', 'naif_actifs', m->'baseline'->'active'->'auc',
      'logloss', m->'valid'->'logloss', 'll_actifs', m->'valid'->'active'->'logloss', 'ece', m->'valid'->'ece'));
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', v_out::text;
END
$smoke$;
