-- Capture (annulée) des réponses réelles du compte démo CRM, pour le banc d'écran.
DO $$
DECLARE r jsonb := '{}'::jsonb; v_ev uuid; v_org uuid := '6a958c46-680d-4c6a-aec0-15301af47e1f';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  SELECT e.id INTO v_ev FROM public.events e WHERE e.organizer_user_id = v_org AND e.external_source IS NOT NULL
     AND e.cancelled_at IS NULL ORDER BY (SELECT count(*) FROM public.tracked_links l WHERE l.event_id = e.id) DESC, e.start_at DESC LIMIT 1;
  r := jsonb_build_object(
    'ev', v_ev,
    'clicks_30d', public.crm_ana_clicks(NULL, v_org, '30d'),
    'clicks_90d', public.crm_ana_clicks(NULL, v_org, '90d'),
    'clicks_ev', public.crm_ana_clicks(NULL, v_org, '30d', v_ev),
    'traffic_30d', public.crm_ana_traffic(NULL, v_org, '30d'),
    'traffic_ev', public.crm_ana_traffic(NULL, v_org, '30d', v_ev));
  RAISE EXCEPTION 'SMOKE_OK %', r::text;
END $$;
