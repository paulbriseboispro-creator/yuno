-- Répétition annulée de 20261119100000_crm_customer_basis_unified.sql, sur les vraies
-- données de 3 AM (base fermée, puis ouverte le temps de la transaction) :
--   node scripts/crm-bench/rehearse.mjs smoke/customer-unified.sql 20261119100000_crm_customer_basis_unified.sql
-- Rien n'est envoyé ni gardé (SMOKE_OK annule tout).
DO $$
DECLARE
  v_org uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_key text := public.crm_scope_key(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5'::uuid);
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid();
  out text := ''; v jsonb; w jsonb; e text; t0 timestamptz; n int; v_venue text;

  -- En titulaire de 3 AM.
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org::text, true);

  -- 1. Base FERMÉE (état réel) : rien ne change, « Accepté » seul.
  v := public.crm_clients_overview(NULL, v_org);
  w := public.crm_audience_count(NULL, v_org, '{}'::jsonb, NULL);
  out := out || E'\nfermée : joignables=' || (v->>'reachable') || ' injoignables=' || (v->>'unreachable')
             || ' | e-mail=' || (w->>'email') || ' / ' || (w->>'total');
  n := (public.crm_audience_count(NULL, v_org, '{"f":{"rc":["none"]}}'::jsonb, NULL)->>'total')::int;
  out := out || ' | filtre « injoignable »=' || n;

  -- 2. Base OUVERTE le temps de la transaction (comme une signature).
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.crm_customer_basis_settings SET sending_ready = true, ramp_start = 100000 WHERE id = 1;
  INSERT INTO public.crm_customer_basis (scope_key, organizer_user_id, status, beta_allowed, declared_at, declaration_version, expires_at, ramp_cap)
  VALUES (v_key, v_org, 'active', true, now(), (SELECT declaration_version FROM public.crm_customer_basis_settings), now() + interval '1 year', 100000)
  ON CONFLICT (scope_key) DO UPDATE SET status = 'active', declared_at = now(), declaration_version = EXCLUDED.declaration_version, expires_at = EXCLUDED.expires_at;
  PERFORM public._crm_customer_contacts_refresh(NULL, v_org);
  INSERT INTO public.crm_email_settings (scope_key, organizer_user_id, sender_name, legal_name, postal_address)
  VALUES (v_key, v_org, 'Smoke 3AM', 'Smoke SAS', '12 rue de la Répétition 75011 Paris')
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, legal_name = EXCLUDED.legal_name, postal_address = EXCLUDED.postal_address;
  INSERT INTO public.legal_acceptances (user_id, doc_type, doc_version, context)
  SELECT v_org, d, '9999-12-31', '{"smoke":true}'::jsonb FROM unnest(ARRAY['terms_crm', 'dpa']) d;
  out := out || E'\ncomptes de la base : ' || public._crm_customer_basis_counts(NULL, v_org)::text;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  t0 := clock_timestamp();
  v := public.crm_clients_overview(NULL, v_org);
  out := out || E'\nouverte : joignables=' || (v->>'reachable') || ' injoignables=' || (v->>'unreachable')
             || ' (' || (extract(epoch FROM clock_timestamp() - t0) * 1000)::int || ' ms)';
  w := public.crm_audience_count(NULL, v_org, '{}'::jsonb, NULL);
  n := (public.crm_audience_count(NULL, v_org, '{"f":{"rc":["none"]}}'::jsonb, NULL)->>'total')::int;
  out := out || ' | e-mail=' || (w->>'email') || ' / ' || (w->>'total') || ' | filtre « injoignable »=' || n;
  IF n <> (v->>'unreachable')::int THEN RAISE EXCEPTION 'injoignables : carte % ≠ filtre %', v->>'unreachable', n; END IF;
  BEGIN
    v := public.crm_clients_list(NULL, v_org, '{}'::jsonb, NULL, NULL, 400, 0);
    out := out || E'\nliste : ' || COALESCE((SELECT jsonb_object_agg(k, c)::text FROM (
      SELECT COALESCE(x->>'email_basis', '∅') || '/' || (x->>'email_ok') k, count(*) c
        FROM jsonb_array_elements(COALESCE(v->'rows', v->'items', '[]'::jsonb)) x GROUP BY 1) z), '{}') || ' clés=' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(v) k);
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nliste : ' || e;
  END;
  v := public.crm_home(NULL, v_org, NULL);
  out := out || E'\naccueil joignables : ' || COALESCE((v #> '{kpis,reach}')::text, (v #> '{reach}')::text, 'clé ?');
  PERFORM public.crm_segments_overview(NULL, v_org, NULL);
  PERFORM public.crm_segments_brief(NULL, v_org);
  PERFORM public.crm_email_send_options(NULL, v_org);
  out := out || ' | segments, options : ok';

  -- 3. Choix automatique de la base légale (programmer une campagne).
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version)
  VALUES (c1, v_org, 'crm', 'promotional', 'draft', 'smoke propre', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2),
         (c2, v_org, 'crm', 'promotional', 'draft', 'smoke lien tiers', 'smoke', '[{"kind":"crm","def":{}}]',
          '[{"id":"b1","type":"cta","label":"Go","url":"https://dice.fm/event/x"}]', 2),
         (c3, v_org, 'crm', 'promotional', 'draft', 'smoke renvoi', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2);
  UPDATE public.email_campaigns SET resend_enabled = true WHERE id = c3;
  out := out || E'\naperçu propre ' || public.crm_email_audience_unified(c1)::text
             || E'\naperçu lien tiers ' || (public.crm_email_audience_unified(c2) - 'issues')::text
             || E'\naperçu renvoi ' || public.crm_email_audience_unified(c3)::text;
  BEGIN
    UPDATE public.email_campaigns SET status = 'scheduled', scheduled_at = now() + interval '3 days' WHERE id IN (c1, c2, c3);
    out := out || E'\nprogrammées : ' || (SELECT string_agg(name || '=' || legal_basis, ', ' ORDER BY name) FROM public.email_campaigns WHERE id IN (c1, c2, c3));
    SELECT count(*) INTO n FROM public.resolve_campaign_audience(c1);
    out := out || ' | audience propre=' || n;
    SELECT count(*) INTO n FROM public.resolve_campaign_audience(c2);
    out := out || ' | audience lien tiers=' || n;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nprogrammation refusée : ' || e;
  END;

  -- 3 bis. « Envoyer maintenant » : un brouillon mis en file directement.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version)
  VALUES (c4, v_org, 'crm', 'promotional', 'draft', 'smoke maintenant', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2);
  BEGIN
    v := public.enqueue_campaign_recipients(c4);
    out := out || E'\nmaintenant : base=' || (SELECT legal_basis || '/' || status FROM public.email_campaigns WHERE id = c4) || ' file=' || (v - 'by_basis')::text
      || ' lignes=' || COALESCE((SELECT jsonb_object_agg(k, n2)::text FROM (SELECT coalesce(legal_basis, '∅') || '/' || status k, count(*) n2
           FROM public.email_campaign_recipients WHERE campaign_id = c4 GROUP BY 1) z), '{}');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT;
    out := out || E'\nmaintenant refusé : ' || e || ' / base=' || (SELECT legal_basis FROM public.email_campaigns WHERE id = c4);
  END;
  DELETE FROM public.email_campaign_recipients WHERE campaign_id = c4;
  DELETE FROM public.email_campaigns WHERE id = c4;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);

  -- 4. Base refermée : une campagne programmée repasse à l'accord seul.
  UPDATE public.crm_customer_basis SET status = 'off' WHERE scope_key = v_key;
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version)
  VALUES (c4, v_org, 'crm', 'promotional', 'draft', 'smoke fermée', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2);
  BEGIN
    UPDATE public.email_campaigns SET status = 'scheduled', scheduled_at = now() + interval '3 days' WHERE id = c4;
    UPDATE public.email_campaigns SET name = 'smoke propre (reprogrammée)' WHERE id = c1;
    out := out || E'\nbase fermée : ' || (SELECT string_agg(name || '=' || legal_basis, ', ' ORDER BY name) FROM public.email_campaigns WHERE id IN (c1, c4));
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nbase fermée refusée : ' || e;
  END;
  v := public.crm_clients_overview(NULL, v_org);
  out := out || ' | joignables=' || (v->>'reachable');

  -- 5. Billetterie : la colonne existe (fausse), le filtre « canal » tourne.
  v_venue := (SELECT x FROM unnest(public.demo_venue_ids()) x LIMIT 1);
  PERFORM public._tix_people_build(v_venue, NULL, NULL);
  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s', public._tix_filter_sql('{"f":{"rc":["mail"]}}'::jsonb, 'p')) INTO n;
  out := out || E'\nbilletterie démo : rc=mail ' || n || ', email_cust vrais ' || (SELECT count(*) FROM _cp WHERE email_cust);

  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
