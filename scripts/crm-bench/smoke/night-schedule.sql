-- Lot 0 (CRM_NIGHT_CAMPAIGN_PLAN.md) : le calendrier de « Qui cibler » selon
-- les jours restants. Déplace une soirée WOH DANS la transaction annulée.
DO $$
DECLARE
  v_ev  uuid := 'ad86ac12-4019-4c39-a223-d556278c750a';
  v_out text := '';
  v_t   jsonb;
  v_p   jsonb;
  v_d   interval;
  a     jsonb;
  s     jsonb;
  t0    timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '0dfb2e2a-4cd7-4a2a-b01e-95d20d4ff41d', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '0dfb2e2a-4cd7-4a2a-b01e-95d20d4ff41d', true);
  FOREACH v_d IN ARRAY ARRAY[NULL, interval '1 day 5 hours', interval '2 days 5 hours', interval '3 days 5 hours',
                             interval '4 days 5 hours', interval '6 days 5 hours', interval '9 days 5 hours', interval '15 days 5 hours']::interval[] LOOP
    IF v_d IS NOT NULL THEN
      UPDATE public.events SET start_at = now() + v_d, end_at = now() + v_d + interval '6 hours' WHERE id = v_ev;
    END IF;
    t0 := clock_timestamp();
    v_t := public.crm_night_targets('woh', NULL, v_ev);
    v_out := v_out || format(E'\n[%s] J=%s (%s ms)', COALESCE(v_d::text, 'réel'), v_t->>'days_left',
                             round(extract(epoch FROM clock_timestamp() - t0) * 1000));
    FOR a IN SELECT * FROM jsonb_array_elements(v_t->'audiences') LOOP
      v_out := v_out || format(E'\n   %s n=%s rk=%s %s %s', a->>'key', a->>'n', COALESCE(a->>'order', '-'), a->>'moment',
                               to_char((a->>'send_at')::timestamptz AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI'));
    END LOOP;
    v_p := public.crm_night_plan('woh', NULL, v_ev);
    FOR s IN SELECT * FROM jsonb_array_elements(v_p->'steps') LOOP
      v_out := v_out || format(E'\n   ÉTAPE %s %s pers=%s canal=%s', s->>'moment',
                               to_char((s->>'send_at')::timestamptz AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI'), s->>'people', s->>'channel');
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$$;
