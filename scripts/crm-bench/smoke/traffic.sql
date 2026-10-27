-- Trafic CRM (crm_ana_clicks + ajouts de crm_ana_traffic__core), répété sur la
-- prod et annulé : le titulaire du compte démo CRM puis Amoris.
DO $$
DECLARE
  v_out text := '';
  t0 timestamptz; r jsonb; v_ev uuid; who record;
BEGIN
  FOR who IN SELECT * FROM (VALUES ('6a958c46-680d-4c6a-aec0-15301af47e1f'::uuid, 'demo'), ('06ce47f8-66a5-42d5-a7bf-56253619ff96'::uuid, 'amoris')) x(id, lbl) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    t0 := clock_timestamp();
    r := public.crm_ana_clicks(NULL, who.id, '30d');
    v_out := v_out || format(E'\n%s 30d %s ms : clicks=%s people=%s orders=%s rev=%s visits=%s signups=%s ig=%s/%s cnb=%s links=%s keep=%s fam=%s',
      who.lbl, round(extract(epoch FROM clock_timestamp() - t0) * 1000), r->'totals'->>'clicks', r->'totals'->>'people', r->'totals'->>'orders',
      r->'totals'->>'revenue', r->'totals'->>'visits', r->'totals'->>'signups', r->'totals'->>'ig_in', r->'totals'->>'ig_known',
      r->>'click_no_buy', jsonb_array_length(r->'links'), r->'keep', (SELECT string_agg((f->>'k') || ':' || (f->>'clicks') || '/' || (f->>'orders'), ' ') FROM jsonb_array_elements(r->'families') f));
    t0 := clock_timestamp();
    r := public.crm_ana_clicks(NULL, who.id, '12m');
    v_out := v_out || format(E'\n%s 12m %s ms : clicks=%s people=%s orders=%s platform=%s',
      who.lbl, round(extract(epoch FROM clock_timestamp() - t0) * 1000), r->'totals'->>'clicks', r->'totals'->>'people', r->'totals'->>'orders', r->'platform');
    SELECT e.id INTO v_ev FROM public.events e WHERE e.organizer_user_id = who.id AND e.external_source IS NOT NULL
       AND e.cancelled_at IS NULL ORDER BY (SELECT count(*) FROM public.tracked_links l WHERE l.event_id = e.id) DESC, e.start_at DESC LIMIT 1;
    t0 := clock_timestamp();
    r := public.crm_ana_clicks(NULL, who.id, '30d', v_ev);
    v_out := v_out || format(E'\n%s soirée %s (vs %s) %s ms : clicks=%s people=%s orders=%s prev_orders=%s curve.span=%s links=%s pages=%s',
      who.lbl, r->'meta'->'event'->>'title', r->'meta'->'prev_event'->>'title', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
      r->'totals'->>'clicks', r->'totals'->>'people', r->'totals'->>'orders', r->'totals'->>'prev_orders', r->'curve'->>'span',
      jsonb_array_length(r->'links'), jsonb_array_length(r->'pages'));
    t0 := clock_timestamp();
    r := public.crm_ana_traffic(NULL, who.id, '30d');
    v_out := v_out || format(E'\n%s traffic 30d %s ms : links=%s messages=%s mix=%s first_msg=%s',
      who.lbl, round(extract(epoch FROM clock_timestamp() - t0) * 1000), jsonb_array_length(r->'links'),
      jsonb_array_length(r->'messages'), jsonb_array_length(r->'night_mix'), r->'messages'->0);
  END LOOP;
  -- Le bouton /j/ : combien de pages en ligne ont reçu leur lien /go/.
  v_out := v_out || format(E'\npages live avec go_link : %s / %s ; clics in_app rattrapés : %s',
    (SELECT count(*) FROM public.crm_signup_pages WHERE status = 'live' AND go_link_id IS NOT NULL),
    (SELECT count(*) FROM public.crm_signup_pages WHERE status = 'live' AND event_id IS NOT NULL),
    (SELECT count(*) FROM public.tracked_link_clicks WHERE in_app IS NOT NULL));
  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END $$;
