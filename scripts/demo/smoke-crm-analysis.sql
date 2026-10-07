-- ============================================================================
-- Smoke de l'analyse client (migrations 20261010100000 → 150000), ANNULÉ.
-- Trois comptes construits à la main sur trois comptes démo (@womber.fr),
-- dans un bloc qui finit par RAISE EXCEPTION : rien n'est écrit.
--   • organizer@womber.fr : les clients suivent leur tête d'affiche → line-up
--     « supported » attendu ;
--   • bde@womber.fr       : choix au hasard → line-up « not_supported » ;
--   • crm@womber.fr       : 25 clients, 8 soirées → tout « untested ».
-- Puis la matrice de rôles des RPC nouvelles (inconnu, sans `sub`, autre
-- compte, titulaire, super admin si un est trouvé).
-- À lancer SEUL sur la prod, après un coup d'œil à pg_stat_activity :
--   supabase db query --linked -f scripts/demo/smoke-crm-analysis.sql
-- Le résultat est dans le message d'erreur (« SMOKE_OK {...} »).
-- ============================================================================

DO $smoke$
DECLARE
  v_users uuid[];
  v_modes text[] := ARRAY['artist', 'random', 'artist'];
  v_people int[] := ARRAY[500, 500, 25];
  v_nights int[] := ARRAY[45, 45, 8];
  v_out jsonb := '{}'::jsonb;
  v_m jsonb := '[]'::jsonb;
  v_super uuid;
  k int; i int; j int; v_cur int; v_next int; v_fav int; v_oid int := 0;
  v_conn uuid;
  v_start timestamptz;
  v_ev record;
  v_cands int[];
  r record; v text;
BEGIN
  SELECT array_agg(id ORDER BY ord) INTO v_users
    FROM (SELECT u.id, array_position(ARRAY['organizer@womber.fr', 'bde@womber.fr', 'crm@womber.fr'], lower(u.email)) AS ord
            FROM auth.users u WHERE lower(u.email) IN ('organizer@womber.fr', 'bde@womber.fr', 'crm@womber.fr')) z;
  IF cardinality(v_users) <> 3 THEN RAISE EXCEPTION 'comptes démo absents'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM setseed(0.42);

  FOR k IN 1..3 LOOP
    DELETE FROM public.ticketing_connections WHERE organizer_user_id = v_users[k];
    INSERT INTO public.ticketing_connections (organizer_user_id, provider, external_org_id, status, initial_import_done_at, next_sync_at)
    VALUES (v_users[k], 'shotgun', 'smoke-' || k, 'active', now() - interval '400 days', now() + interval '1 year')
    RETURNING id INTO v_conn;
    FOR i IN 1..v_nights[k] LOOP
      v_start := date_trunc('day', now()) - make_interval(days => (v_nights[k] - i) * 7 + 3) + interval '23 hours';
      INSERT INTO public.external_events (connection_id, organizer_user_id, provider, external_id, name, start_at, end_at, timezone,
        genres, artists, launched_at, published_at, type_of_place, latitude, longitude, country_code)
      VALUES (v_conn, v_users[k], 'shotgun', 'sm' || i, CASE WHEN i % 2 = 0 THEN 'Smoke Noire #' || i ELSE 'Smoke Club #' || i END,
        v_start, v_start + interval '6 hours', 'Europe/Paris',
        ARRAY[CASE WHEN i % 3 = 0 THEN 'Techno' WHEN i % 3 = 1 THEN 'House' ELSE 'Disco' END],
        jsonb_build_array(jsonb_build_object('id', (100 + 1 + (i % 12))::text, 'name', 'Smoke Artist ' || (1 + (i % 12))))
          || CASE WHEN random() < 0.6 THEN '[{"id":"999","name":"Smoke Resident"}]'::jsonb ELSE '[]'::jsonb END,
        v_start - interval '21 days', v_start - interval '22 days', CASE WHEN i % 4 = 0 THEN 'outdoor' ELSE 'club' END,
        48.8566, 2.3522, 'FR');
    END LOOP;
    FOR i IN 1..v_people[k] LOOP
      v_fav := 1 + floor(random() * 12)::int;
      v_cur := 1 + floor(random() * (v_nights[k] * 0.7))::int;
      FOR j IN 1..12 LOOP
        SELECT * INTO v_ev FROM public.external_events WHERE connection_id = v_conn AND external_id = 'sm' || v_cur;
        v_oid := v_oid + 1;
        INSERT INTO public.external_tickets (connection_id, organizer_user_id, provider, external_id, external_order_id, external_event_id,
          status, price, buyer_email, purchased_at, scanned_at, zip_code, country_code, utm, raw)
        VALUES (v_conn, v_users[k], 'shotgun', 'st' || v_oid, 'so' || v_oid, v_ev.external_id, 'valid', 15,
          'smoke' || k || '-' || i || '@example.com', v_ev.start_at - make_interval(hours => (1 + floor(random() * 400))::int),
          v_ev.start_at + interval '1 hour', '75011', 'FR', '{"utm_source":"shotgun","utm_medium":"app"}'::jsonb, '{"deal_channel":"online"}'::jsonb);
        EXIT WHEN random() > 0.55;
        SELECT array_agg(n ORDER BY n) INTO v_cands FROM generate_series(v_cur + 1, LEAST(v_cur + 10, v_nights[k])) n;
        EXIT WHEN v_cands IS NULL;
        IF v_modes[k] = 'artist' AND random() < 0.8 THEN
          SELECT n INTO v_next FROM unnest(v_cands) n WHERE 1 + (n % 12) = v_fav ORDER BY n LIMIT 1;
          IF v_next IS NULL THEN v_next := v_cands[1 + floor(random() * array_length(v_cands, 1))::int]; END IF;
        ELSE
          v_next := v_cands[1 + floor(random() * array_length(v_cands, 1))::int];
        END IF;
        v_cur := v_next;
      END LOOP;
    END LOOP;
    PERFORM public.crm_analysis_compute(NULL, v_users[k], true, 0);
    v_out := v_out || jsonb_build_object('account_' || k, (
      SELECT jsonb_object_agg(family, status || ' g' || COALESCE(gain::text, '-') || ' n' || n)
        FROM public.crm_family_status WHERE scope_key = 'org:' || v_users[k]::text AND family IN ('artist', 'genre', 'series', 'early')));
  END LOOP;

  -- Attendus (le smoke échoue s'ils ne tiennent pas).
  IF NOT (v_out->'account_1'->>'artist' LIKE 'supported%') THEN RAISE EXCEPTION 'SMOKE_FAIL compte 1 : %', v_out; END IF;
  IF NOT (v_out->'account_2'->>'artist' LIKE 'not_supported%') THEN RAISE EXCEPTION 'SMOKE_FAIL compte 2 : %', v_out; END IF;
  IF NOT (v_out->'account_3'->>'artist' LIKE 'untested%') THEN RAISE EXCEPTION 'SMOKE_FAIL compte 3 : %', v_out; END IF;

  -- Matrice de rôles (lectures, écritures, admin).
  SELECT ur.user_id INTO v_super FROM public.user_roles ur WHERE ur.role::text IN ('super_admin', 'admin') LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
      ('anon', '{"role":"anon"}'),
      ('no_sub', '{"role":"authenticated"}'),
      ('other_account', json_build_object('role', 'authenticated', 'sub', v_users[2])::text),
      ('holder', json_build_object('role', 'authenticated', 'sub', v_users[1])::text),
      ('super_admin', CASE WHEN v_super IS NOT NULL THEN json_build_object('role', 'authenticated', 'sub', v_super)::text END)) x(who, claims)
     WHERE claims IS NOT NULL
  LOOP
    PERFORM set_config('request.jwt.claims', r.claims, true);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(r.claims::jsonb->>'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', r.claims::jsonb->>'role', true);
    BEGIN v := CASE WHEN public.crm_analysis_overview(NULL, v_users[1]) IS NOT NULL THEN 'ok' END; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'overview', 'res', v);
    BEGIN v := CASE WHEN public.crm_client_analysis(NULL, v_users[1], 'smoke1-1@example.com') IS NOT NULL THEN 'ok' END; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'client', 'res', v);
    BEGIN v := CASE WHEN public.crm_signal_coverage(NULL, v_users[1]) IS NOT NULL THEN 'ok' END; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'coverage', 'res', v);
    BEGIN v := CASE WHEN public.crm_admin_analysis('org:' || v_users[1]::text) IS NOT NULL THEN 'ok' END; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'admin', 'res', v);
    BEGIN v := (public.crm_profile_optout(NULL, v_users[1], 'smoke1-2@example.com', true))->>'excluded'; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'optout', 'res', v);
    BEGIN v := (public.crm_learning_contrib_set(NULL, v_users[1], false))->>'learning_contrib'; EXCEPTION WHEN others THEN v := SQLERRM; END;
    v_m := v_m || jsonb_build_object('who', r.who, 'fn', 'contrib_set', 'res', v);
  END LOOP;

  RAISE EXCEPTION 'SMOKE_OK %', jsonb_pretty(jsonb_build_object(
    'statuses', v_out, 'roles', v_m,
    'anon_can_execute', (SELECT jsonb_object_agg(p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'))
                           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                          WHERE n.nspname = 'public' AND (p.proname LIKE 'crm_analysis%' OR p.proname LIKE '_crm_an%'
                             OR p.proname IN ('crm_client_analysis', 'crm_night_analysis', 'crm_artists_analysis', 'crm_signal_coverage',
                                              '_crm_signal_coverage', 'crm_profile_optout', 'crm_learning_contrib_set', 'crm_learning_contrib_get',
                                              'crm_admin_analysis', 'crm_admin_learning_overview', 'crm_admin_rules_approve', 'crm_admin_learning_set',
                                              'crm_learning_publish', 'crm_learning_propose', '_crm_analysis_mark_sync')))));
END
$smoke$;
