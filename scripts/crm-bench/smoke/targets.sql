-- « Qui cibler » sur le compte démo CRM : trois appels de suite, en tant que
-- titulaire, avec ou sans la migration 20261014130000 (rehearse.mjs, annulé).
DO $smoke$
DECLARE
  v_org uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_ev  uuid;
  v_t   timestamptz;
  v_ms  jsonb := '[]'::jsonb;
  v_r   jsonb;
BEGIN
  SELECT e.event_id INTO v_ev FROM public.external_events e
   WHERE e.organizer_user_id = v_org AND e.start_at > now() ORDER BY e.start_at LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  FOR i IN 1..3 LOOP
    v_t := clock_timestamp();
    v_r := public.crm_night_targets(NULL, v_org, v_ev);
    v_ms := v_ms || to_jsonb(round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('ms', v_ms, 'n', jsonb_array_length(v_r->'audiences'))::text;
END
$smoke$;
