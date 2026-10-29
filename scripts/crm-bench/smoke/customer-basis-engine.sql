-- Lot 2 « Vos clients » : une campagne de 3 AM, sur ses vraies données, mise en file
-- puis réclamée — et tout est annulé (SMOKE_OK).
DO $$
DECLARE
  v_org uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_cmp uuid := gen_random_uuid();
  v_cmp2 uuid := gen_random_uuid();
  t0 timestamptz; out text := ''; v jsonb; n int; n2 int; e text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.crm_customer_basis_settings SET sending_ready = true, ramp_start = 100000;
  INSERT INTO public.crm_customer_basis (scope_key, organizer_user_id, status, beta_allowed, declared_at, declaration_version, expires_at, ramp_cap)
  VALUES (public.crm_scope_key(NULL, v_org), v_org, 'active', true, now(), (SELECT declaration_version FROM public.crm_customer_basis_settings), now() + interval '1 year', 100000);
  t0 := clock_timestamp();
  v := public._crm_customer_contacts_refresh(NULL, v_org);
  out := out || E'\nrefresh ' || (extract(epoch FROM clock_timestamp() - t0) * 1000)::int || ' ms ' || v::text;
  out := out || E'\ncounts ' || public._crm_customer_basis_counts(NULL, v_org)::text;

  -- Identité d'expéditeur fictive (annulée avec le reste) : 3 AM ne l'a pas encore remplie.
  INSERT INTO public.crm_email_settings (scope_key, organizer_user_id, sender_name, legal_name, postal_address)
  VALUES (public.crm_scope_key(NULL, v_org), v_org, 'Smoke 3AM', 'Smoke SAS', '12 rue de la Répétition 75011 Paris')
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, legal_name = EXCLUDED.legal_name, postal_address = EXCLUDED.postal_address;
  INSERT INTO public.legal_acceptances (user_id, doc_type, doc_version, context)
  SELECT v_org, d, '9999-12-31', '{"smoke":true}'::jsonb FROM unnest(ARRAY['terms_crm', 'dpa']) d;

  -- La même audience (toute la base) en campagne à l'accord, puis « Vos clients ».
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version)
  VALUES (v_cmp2, v_org, 'crm', 'promotional', 'draft', 'smoke accord', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2),
         (v_cmp, v_org, 'crm', 'promotional', 'draft', 'smoke clients', 'smoke', '[{"kind":"crm","def":{}}]', '[]', 2);
  UPDATE public.email_campaigns SET legal_basis = 'customer' WHERE id = v_cmp;
  t0 := clock_timestamp();
  SELECT count(*) INTO n2 FROM public.resolve_campaign_audience(v_cmp2);
  SELECT count(*) INTO n FROM public.resolve_campaign_audience(v_cmp);
  out := out || E'\naudience accord ' || n2 || ' / « Vos clients » ' || n || ' (' || (extract(epoch FROM clock_timestamp() - t0) * 1000)::int || ' ms)';
  out := out || E'\naperçu ' || public.crm_customer_audience_preview(v_cmp)::text;

  t0 := clock_timestamp();
  BEGIN
    v := public.enqueue_campaign_recipients(v_cmp);
    out := out || E'\nfile ' || (extract(epoch FROM clock_timestamp() - t0) * 1000)::int || ' ms ' || v::text;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS e = MESSAGE_TEXT;
    out := out || E'\nfile refusée : ' || e;
  END;
  out := out || E'\nlignes ' || COALESCE((SELECT jsonb_object_agg(k, c) FROM (
    SELECT coalesce(legal_basis, '∅') || '/' || status || coalesce('/' || error_message, '') k, count(*) c
      FROM public.email_campaign_recipients WHERE campaign_id = v_cmp GROUP BY 1) z)::text, '{}');
  SELECT count(DISTINCT legal_basis) INTO n FROM public.claim_campaign_recipients(v_cmp, 100) x
    JOIN public.email_campaign_recipients r ON r.campaign_id = v_cmp AND r.email = x.email;
  out := out || E'\n1er lot : ' || n || ' base(s) légale(s)';
  -- Non-régression : la campagne à l'accord se met en file comme avant, sans base légale posée.
  v := public.enqueue_campaign_recipients(v_cmp2);
  out := out || E'\nfile accord ' || v::text || ' / lignes marquées : '
      || (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = v_cmp2 AND legal_basis IS NOT NULL);
  SELECT count(*) INTO n FROM public.claim_campaign_recipients(v_cmp2, 100);
  out := out || E'\n1er lot accord : ' || n || ' lignes';
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
