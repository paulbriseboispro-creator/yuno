-- Temps des lectures d'écran du compte démo CRM, SEULES (aucun calcul avant),
-- trois passages chacune : avec et sans les migrations, pour comparer.
DO $smoke$
DECLARE
  v_org uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_ev  uuid;
  v_t   timestamptz;
  v_out jsonb := '{}'::jsonb;
  i     integer;
  v_r   jsonb;
BEGIN
  SELECT e.event_id INTO v_ev FROM public.external_events e
   WHERE e.organizer_user_id = v_org AND e.start_at > now() ORDER BY e.start_at LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  FOR i IN 1..3 LOOP
    v_t := clock_timestamp();
    v_r := public.crm_automations(NULL, v_org, '30d');
    v_out := v_out || jsonb_build_object('automations_' || i, round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_t := clock_timestamp();
    v_r := public.crm_night_targets(NULL, v_org, v_ev);
    v_out := v_out || jsonb_build_object('targets_' || i, round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', v_out::text;
END
$smoke$;
