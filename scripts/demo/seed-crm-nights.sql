-- ============================================================================
-- Démo Yuno CRM : l'écran Soirées de crm@womber.fr.
--
-- Complète seed-crm-demo.sql (et seed-crm-messages.sql) sans toucher aux
-- billets : les acheteurs, les clients et les envois restent ceux des semis
-- précédents.
--   1. Un stock par tarif et des places restantes, comme Shotgun les donne :
--      chaque soirée a une capacité, quelques soirées passées sont complètes.
--   2. Deux soirées à venir dont les ventes ne sont pas encore ouvertes.
--   3. Les envois reliés à leur soirée (event_id), plus un brouillon et un
--      envoi planifié sur les prochaines soirées. Rien ne part : un compte
--      démo n'envoie jamais (send-campaign rend demo_no_send).
-- Rejouable. Prérequis : seed-crm-demo.sql, seed-crm-messages.sql
--   supabase db query --linked -f scripts/demo/seed-crm-nights.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_conn uuid;
  v_ev record;
  v_early integer;
  v_reg integer;
  v_late integer;
  v_sold integer;
  v_slack integer;
  v_q jsonb;
  v_first timestamptz;
  v_start timestamptz;
  v_slacks integer[] := ARRAY[0, 35, 80, 0, 120, 55, 20, 95, 60, 0, 140, 45];
  v_i integer := 0;
  v_mirror uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  IF NOT public.is_demo_email('crm@womber.fr') THEN RAISE EXCEPTION 'périmètre démo introuvable'; END IF;
  SELECT id INTO v_conn FROM public.ticketing_connections
   WHERE organizer_user_id = v_uid AND external_org_id = 'demo-crm';
  IF v_conn IS NULL THEN RAISE EXCEPTION 'connexion démo absente : lancer seed-crm-demo.sql'; END IF;

  -- 2. Deux soirées à venir, ventes pas encore ouvertes (recréées à chaque passage).
  DELETE FROM public.external_events WHERE connection_id = v_conn AND external_id IN ('demo-soon-1', 'demo-soon-2');
  DELETE FROM public.events WHERE organizer_user_id = v_uid AND external_source IS NOT NULL
     AND id NOT IN (SELECT event_id FROM public.external_events WHERE connection_id = v_conn AND event_id IS NOT NULL);
  v_start := ((date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month' - interval '1 day')::date + time '23:00') AT TIME ZONE 'Europe/Paris';
  IF v_start < now() + interval '10 days' THEN v_start := v_start + interval '1 month'; END IF;
  INSERT INTO public.external_events (connection_id, organizer_user_id, provider, external_id, name, slug, url,
         start_at, end_at, timezone, cover_url, street, city, zip_code, country_code, genres, artists, deals,
         left_tickets, published_at, launched_at, external_role, type_of_place)
  VALUES
    (v_conn, v_uid, 'shotgun', 'demo-soon-1', 'Halloween Rave', 'demo-halloween-rave', 'https://shotgun.live/events/demo-halloween-rave',
     v_start, v_start + interval '7 hours', 'Europe/Paris',
     'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/recurring-1784536410680-poster.jpg',
     '12 rue de la Nuit', 'Paris', '75011', 'FR', ARRAY['techno'],
     '[{"name":"DJ Maya"},{"name":"Ghoul Collective"}]'::jsonb,
     '[{"name":"Early bird","price":15,"quantity":150},{"name":"Prévente","price":22,"quantity":350},{"name":"Tarif normal","price":30,"quantity":300}]'::jsonb,
     800, now() - interval '2 days', (current_date + 3 + time '12:00') AT TIME ZONE 'Europe/Paris', 'organizer', 'club'),
    (v_conn, v_uid, 'shotgun', 'demo-soon-2', 'Réveillon ' || extract(year FROM now())::int, 'demo-reveillon', 'https://shotgun.live/events/demo-reveillon',
     (make_date(extract(year FROM now())::int, 12, 31) + time '22:00') AT TIME ZONE 'Europe/Paris',
     (make_date(extract(year FROM now())::int, 12, 31) + time '22:00') AT TIME ZONE 'Europe/Paris' + interval '10 hours', 'Europe/Paris',
     'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/1781542670364-poster.jpg',
     '12 rue de la Nuit', 'Paris', '75011', 'FR', ARRAY['house'], '[]'::jsonb,
     '[{"name":"Early bird","price":25,"quantity":300},{"name":"Prévente","price":35,"quantity":700},{"name":"Tarif normal","price":45,"quantity":500}]'::jsonb,
     1500, now() - interval '1 day', (make_date(extract(year FROM now())::int, 11, 1) + time '12:00') AT TIME ZONE 'Europe/Paris', 'organizer', 'club');

  -- 1. Stocks par tarif et places restantes.
  FOR v_ev IN
    SELECT ee.* FROM public.external_events ee
     WHERE ee.connection_id = v_conn AND ee.external_id NOT IN ('demo-soon-1', 'demo-soon-2')
     ORDER BY ee.start_at
  LOOP
    v_i := v_i + 1;
    SELECT COALESCE(sum(1) FILTER (WHERE deal_name = 'Early bird'), 0), COALESCE(sum(1) FILTER (WHERE deal_name = 'Regular'), 0),
           COALESCE(sum(1) FILTER (WHERE deal_name = 'Late'), 0), count(*), min(COALESCE(purchased_at, first_seen_at))
      INTO v_early, v_reg, v_late, v_sold, v_first
      FROM public.external_tickets
     WHERE connection_id = v_conn AND external_event_id = v_ev.external_id AND status IN ('valid', 'transferred');
    IF v_ev.start_at > now() THEN
      v_q := jsonb_build_array(
        jsonb_build_object('name', 'Early bird', 'price', 14, 'quantity', CASE WHEN v_reg > 0 THEN v_early ELSE GREATEST(v_early + 30, 120) END),
        jsonb_build_object('name', 'Regular', 'price', 18, 'quantity', 160),
        jsonb_build_object('name', 'Late', 'price', 22, 'quantity', 130));
      UPDATE public.external_events SET deals = v_q,
             left_tickets = (CASE WHEN v_reg > 0 THEN v_early ELSE GREATEST(v_early + 30, 120) END) + 160 + 130 - v_sold,
             launched_at = LEAST(launched_at, v_first - interval '2 hours')
       WHERE id = v_ev.id;
    ELSE
      v_slack := v_slacks[1 + (v_i % array_length(v_slacks, 1))];
      v_q := jsonb_build_array(
        jsonb_build_object('name', 'Early bird', 'price', 14, 'quantity', v_early),
        jsonb_build_object('name', 'Regular', 'price', 18, 'quantity', v_reg),
        jsonb_build_object('name', 'Late', 'price', 22, 'quantity', v_late + v_slack));
      UPDATE public.external_events SET deals = v_q, left_tickets = v_slack,
             launched_at = LEAST(launched_at, v_first - interval '2 hours')
       WHERE id = v_ev.id;
    END IF;
  END LOOP;

  PERFORM public.ticketing_after_sync(v_conn);
  PERFORM public.ticketing_refresh_stats(v_conn);

  -- 3. Envois reliés à leur soirée (le nom de l'envoi contient son titre).
  UPDATE public.email_campaigns c SET event_id = e.id
    FROM public.events e
   WHERE c.organizer_user_id = v_uid AND c.venue_id IS NULL AND c.theme_json->>'seed' = 'crm-messages'
     AND e.organizer_user_id = v_uid AND e.external_source IS NOT NULL
     AND c.name LIKE '%' || e.title || '%';

  DELETE FROM public.email_campaigns
   WHERE organizer_user_id = v_uid AND venue_id IS NULL AND theme_json->>'seed' = 'crm-nights';

  -- Brouillon « line-up » sur la 2e soirée à venir (à finir : tâche « Terminer »).
  SELECT e.id INTO v_mirror FROM public.events e
    JOIN public.external_events x ON x.event_id = e.id
   WHERE e.organizer_user_id = v_uid AND e.external_source IS NOT NULL AND e.start_at > now()
     AND (x.launched_at IS NULL OR x.launched_at <= now())
   ORDER BY e.start_at OFFSET 1 LIMIT 1;
  IF v_mirror IS NOT NULL THEN
    INSERT INTO public.email_campaigns (organizer_user_id, venue_id, name, subject, type, status, event_id, created_by,
           blocks_version, audiences_json, theme_json, created_at, updated_at)
    SELECT v_uid, NULL, 'Le line-up — ' || e.title, 'Le line-up de ' || e.title || ' est tombé', 'promotional', 'draft', e.id, v_uid,
           2, '[{"kind":"crm","def":{"seg":"hab","f":{}}}]'::jsonb, '{"seed":"crm-nights","kind":"lineup"}'::jsonb, now() - interval '5 hours', now() - interval '5 hours'
      FROM public.events e WHERE e.id = v_mirror;
  END IF;

  -- Dernier rappel de la prochaine soirée, programmé demain 9 h : tâche « Valider ».
  SELECT e.id INTO v_mirror FROM public.events e
    JOIN public.external_events x ON x.event_id = e.id
   WHERE e.organizer_user_id = v_uid AND e.external_source IS NOT NULL AND e.start_at > now()
     AND (x.launched_at IS NULL OR x.launched_at <= now())
   ORDER BY e.start_at LIMIT 1;
  IF v_mirror IS NOT NULL THEN
    INSERT INTO public.email_campaigns (organizer_user_id, venue_id, name, subject, type, status, scheduled_at, event_id, created_by,
           blocks_version, audiences_json, theme_json, created_at, updated_at)
    SELECT v_uid, NULL, 'Dernier rappel · ' || e.title, 'Plus que 2 jours — ' || e.title, 'promotional', 'scheduled',
           (((now() AT TIME ZONE 'Europe/Paris')::date + 1) + time '09:00') AT TIME ZONE 'Europe/Paris', e.id, v_uid,
           2, '[{"kind":"crm","def":{"seg":"hab","f":{}}}]'::jsonb, '{"seed":"crm-nights","kind":"lastcall"}'::jsonb, now() - interval '1 day', now() - interval '1 day'
      FROM public.events e WHERE e.id = v_mirror;
  END IF;

  -- Rappel J-3 de la 2e soirée, programmé (visible au calendrier des envois).
  SELECT e.id INTO v_mirror FROM public.events e
    JOIN public.external_events x ON x.event_id = e.id
   WHERE e.organizer_user_id = v_uid AND e.external_source IS NOT NULL AND e.start_at > now() + interval '8 days'
     AND (x.launched_at IS NULL OR x.launched_at <= now())
   ORDER BY e.start_at LIMIT 1;
  IF v_mirror IS NOT NULL THEN
    INSERT INTO public.email_campaigns (organizer_user_id, venue_id, name, subject, type, status, scheduled_at, event_id, created_by,
           blocks_version, audiences_json, theme_json, created_at, updated_at)
    SELECT v_uid, NULL, 'Rappel J-3 ' || e.title, 'Plus que 3 jours — ' || e.title, 'promotional', 'scheduled',
           ((e.start_at AT TIME ZONE 'Europe/Paris')::date - 3 + time '09:00') AT TIME ZONE 'Europe/Paris', e.id, v_uid,
           2, '[{"kind":"crm","def":{"seg":"hab","f":{}}}]'::jsonb, '{"seed":"crm-nights","kind":"lastcall"}'::jsonb, now() - interval '1 day', now() - interval '1 day'
      FROM public.events e WHERE e.id = v_mirror;
  END IF;

  RAISE NOTICE 'démo Soirées : % soirées, % envois reliés', (SELECT count(*) FROM public.external_events WHERE connection_id = v_conn),
    (SELECT count(*) FROM public.email_campaigns WHERE organizer_user_id = v_uid AND event_id IS NOT NULL);
END
$seed$;
