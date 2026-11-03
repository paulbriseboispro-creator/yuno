-- Répétition annulée de 20261119120000_crm_followup_customer.sql sur 3 AM (Act III) :
--   node scripts/crm-bench/rehearse.mjs smoke/followup-customer.sql 20261119120000_crm_followup_customer.sql
-- Campagne, clics et relance fictifs ; rien n'est envoyé ni gardé (SMOKE_OK annule tout).
DO $$
DECLARE
  v_org uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_key text := public.crm_scope_key(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5'::uuid);
  v_ev uuid := 'fb2009cb-2666-496f-af3e-4389cd406bad';
  v_url text; v_tpl uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  out text := ''; v jsonb; e text; v_child uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT external_ticket_url INTO v_url FROM public.events WHERE id = v_ev;
  UPDATE public.crm_customer_basis_settings SET sending_ready = true WHERE id = 1;
  INSERT INTO public.crm_customer_basis (scope_key, organizer_user_id, status, beta_allowed, declared_at, declaration_version, expires_at, ramp_cap)
  VALUES (v_key, v_org, 'active', true, now(), (SELECT declaration_version FROM public.crm_customer_basis_settings), now() + interval '1 year', 100000)
  ON CONFLICT (scope_key) DO UPDATE SET status = 'active', declared_at = now(), declaration_version = EXCLUDED.declaration_version, expires_at = EXCLUDED.expires_at, ramp_cap = 100000;
  PERFORM public._crm_customer_contacts_refresh(NULL, v_org);
  INSERT INTO public.crm_email_settings (scope_key, organizer_user_id, sender_name, legal_name, postal_address)
  VALUES (v_key, v_org, 'Smoke 3AM', 'Smoke SAS', '12 rue de la Répétition 75011 Paris')
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, legal_name = EXCLUDED.legal_name, postal_address = EXCLUDED.postal_address;
  INSERT INTO public.legal_acceptances (user_id, doc_type, doc_version, context)
  SELECT v_org, d, '9999-12-31', '{"smoke":true}'::jsonb FROM unnest(ARRAY['terms_crm', 'dpa']) d;

  out := out || 'export colonnes=' || jsonb_array_length((SELECT x FROM (SELECT public.crm_clients_export__core(NULL, v_org, '{}'::jsonb, ARRAY['x@x.x']) x) z)->'columns');

  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, blocks_json, blocks_version, product)
  VALUES (v_tpl, v_org, 'smoke relance', 'Toujours partant ?', '[]', 2, 'crm');
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version,
                                      event_id, followup_enabled, followup_delay_hours, followup_template_id)
  VALUES (c1, v_org, 'crm', 'promotional', 'draft', 'smoke act III', 'smoke', '[{"kind":"crm","def":{"f":{"gl":"any"}}}]', '[]', 2,
          v_ev, true, 6, v_tpl);
  BEGIN
    v := public.enqueue_campaign_recipients(c1);
    out := out || E'\nmère : base=' || (SELECT legal_basis FROM public.email_campaigns WHERE id = c1) || ' file=' || (v->>'queued')
      || ' ' || (SELECT jsonb_object_agg(k, n)::text FROM (SELECT coalesce(legal_basis, '∅') k, count(*) n FROM public.email_campaign_recipients WHERE campaign_id = c1 GROUP BY 1) z);
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nmère refusée : ' || e; RAISE EXCEPTION 'SMOKE_OK %', out;
  END;

  -- Simulation : la mère est partie hier ; 3 clients et 2 personnes à l'accord ont cliqué vers Shotgun il y a 10 h,
  -- 1 client a cliqué il y a 2 h (pas encore dû), 1 client a cliqué un lien Yuno sans rapport.
  UPDATE public.email_campaign_recipients SET status = 'sent', sent_at = now() - interval '1 day' WHERE campaign_id = c1;
  UPDATE public.email_campaigns SET status = 'sent', sent_at = now() - interval '1 day' WHERE id = c1;
  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata, created_at)
  SELECT c1, r.email, 'clicked', jsonb_build_object('click', jsonb_build_object('link', v_url || '?utm_source=yuno-m-x&ids=1861292')), now() - x.ago
    FROM (SELECT email, legal_basis, row_number() OVER (PARTITION BY legal_basis ORDER BY email) rn FROM public.email_campaign_recipients WHERE campaign_id = c1) r
    JOIN (VALUES ('customer', 1, interval '10 hours'), ('customer', 2, interval '10 hours'), ('customer', 3, interval '10 hours'),
                 ('consent', 1, interval '10 hours'), ('consent', 2, interval '10 hours'), ('customer', 4, interval '2 hours')) x(lb, rn, ago)
      ON x.lb = r.legal_basis AND x.rn = r.rn;
  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata, created_at)
  SELECT c1, r.email, 'clicked', '{"click":{"link":"https://www.instagram.com/3am"}}', now() - interval '10 hours'
    FROM public.email_campaign_recipients r WHERE r.campaign_id = c1 AND r.legal_basis = 'customer' ORDER BY r.email OFFSET 4 LIMIT 1;

  BEGIN
    v := public.collect_campaign_followups();
    v_child := (SELECT followup_campaign_id FROM public.email_campaigns WHERE id = c1);
    out := out || E'\nrelance : ' || (v - 'children')::text
      || E'\n  registre ' || COALESCE((SELECT jsonb_object_agg(k, n)::text FROM (SELECT status || coalesce('/' || skip_reason, '') k, count(*) n FROM public.email_campaign_followups WHERE parent_campaign_id = c1 GROUP BY 1) z), '{}')
      || E'\n  enfant base=' || COALESCE((SELECT legal_basis || '/' || status || '/' || child_kind FROM public.email_campaigns WHERE id = v_child), '∅')
      || ' lignes=' || COALESCE((SELECT jsonb_object_agg(k, n)::text FROM (SELECT coalesce(legal_basis, '∅') || '/' || status k, count(*) n FROM public.email_campaign_recipients WHERE campaign_id = v_child GROUP BY 1) z), '{}')
      || ' jetons clients ok=' || (SELECT count(*) FROM public.email_campaign_recipients r JOIN public.crm_customer_contacts cc ON cc.unsubscribe_token = r.unsubscribe_token WHERE r.campaign_id = v_child AND r.legal_basis = 'customer');
    -- Un lot réclamé ne mêle jamais deux bases.
    out := out || E'\n  1er lot : ' || (SELECT count(DISTINCT r.legal_basis) FROM public.claim_campaign_recipients(v_child, 50) x JOIN public.email_campaign_recipients r ON r.campaign_id = v_child AND lower(r.email) = lower(x.email)) || ' base(s)';
    -- Repasser ne relance personne deux fois.
    v := public.collect_campaign_followups();
    out := out || E'\n  2e passage : ' || (v - 'children')::text;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nrelance refusée : ' || e;
  END;

  -- Une relance « Vos clients » se refuse encore avec le renvoi aux non-ouvreurs.
  BEGIN
    UPDATE public.email_campaigns SET resend_enabled = true WHERE id = c1;
    out := out || E'\nrenvoi sur mère partie : accepté (base figée=' || (SELECT legal_basis FROM public.email_campaigns WHERE id = c1) || ')';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nrenvoi refusé : ' || e;
  END;
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
