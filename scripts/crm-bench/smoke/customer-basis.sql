-- Lot 1 « Vos acheteurs » : migration appliquée puis tout annulé (SMOKE_OK).
-- Mesure, par espace CRM qui a des billets Shotgun : comptes et temps du calcul.
DO $$
DECLARE r record; t0 timestamptz; v jsonb; out text := ''; v_ms int; v_tr int;
BEGIN
  FOR r IN SELECT DISTINCT venue_id, organizer_user_id FROM public.external_tickets LOOP
    t0 := clock_timestamp();
    v := public._crm_customer_basis_counts(r.venue_id, r.organizer_user_id);
    v_ms := (extract(epoch FROM clock_timestamp() - t0) * 1000)::int;
    t0 := clock_timestamp();
    PERFORM public._crm_customer_contacts_refresh(r.venue_id, r.organizer_user_id);
    v_tr := (extract(epoch FROM clock_timestamp() - t0) * 1000)::int;
    out := out || E'\n' || left(coalesce(r.venue_id, r.organizer_user_id::text), 8) || ' counts ' || v_ms || ' ms, refresh ' || v_tr || ' ms : ' || v::text;
  END LOOP;
  -- Une campagne existante n'a pas bougé de base légale.
  out := out || E'\ncampagnes non consent : ' || (SELECT count(*) FROM public.email_campaigns WHERE legal_basis <> 'consent');
  out := out || E'\ncron : ' || (SELECT count(*) FROM cron.job WHERE jobname = 'crm-customer-basis-nightly');
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
