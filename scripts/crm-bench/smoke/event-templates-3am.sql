-- Répétition annulée de 20261123100000_email_event_templates.sql avec le VRAI design de relance de
-- l'Act III de 3 AM (brouillon de test bdf509ab… chez Amoris), posé comme modèle propre à la soirée :
--   cd scripts/crm-bench && node rehearse.mjs smoke/event-templates-3am.sql 20261123100000_email_event_templates.sql
-- Base « Vos clients » ouverte, campagne, clics, recette fictifs ; rien n'est envoyé ni gardé (SMOKE_OK annule tout).
DO $$
DECLARE
  v_org uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_key text := public.crm_scope_key(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5'::uuid);
  v_ev uuid := 'fb2009cb-2666-496f-af3e-4389cd406bad';
  v_url text; v_tpl uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); v_base uuid := gen_random_uuid(); v_auto uuid := gen_random_uuid();
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

  -- Le modèle PROPRE à l'Act III = copie du design de relance dessiné avec Paul (brouillon de test chez Amoris).
  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, preheader, blocks_json, blocks_version, theme_json, social_links_json, logo_url, product, for_event_id)
  SELECT v_tpl, v_org, 'Relance Act III (modèle de la soirée)', c.subject, c.preheader, c.blocks_json, 2, c.theme_json, c.social_links_json, c.logo_url, 'crm', v_ev
    FROM public.email_campaigns c WHERE c.id = 'bdf509ab-38f7-457a-91d1-bd32d4f80de1';
  out := out || E'\nmodèle act III : ' || (SELECT jsonb_array_length(blocks_json) || ' sections, expire ' || to_char(expires_at AT TIME ZONE 'Europe/Paris', 'DD/MM HH24:MI')
                                             || ', contrôle clients=' || public._crm_customer_content_issues(blocks_json, v_ev, NULL, v_org)::text
                                             FROM public.email_campaign_templates WHERE id = v_tpl);
  -- Le modèle de BASE de la recette « A cliqué sans acheter » (général, toutes soirées).
  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, blocks_json, blocks_version, product)
  VALUES (v_base, v_org, 'Relance de base', 'Toujours partant ?', '[]', 2, 'crm');
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
      || E'\n  modèle servi : ' || COALESCE((SELECT t.name || ' / soirée du modèle=' || COALESCE(c.source_template_event_id::text, 'base') || ' / ' || jsonb_array_length(c.blocks_json) || ' sections / objet « ' || c.subject || ' »'
                                          FROM public.email_campaigns c JOIN public.email_campaign_templates t ON t.id = c.source_template_id WHERE c.id = v_child), '∅')
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
  -- La recette « A cliqué sans acheter » : base pour toutes les soirées, modèle propre pour l'Act III.
  INSERT INTO public.email_automations (id, organizer_user_id, kind, enabled, enabled_at, delay_hours, template_id, product)
  VALUES (v_auto, v_org, 'click_no_buy', true, now(), 24, v_base, 'crm');
  PERFORM public.email_automation_event_template_set(v_auto, v_ev, v_tpl);
  INSERT INTO public.email_automation_sends (automation_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id, email, status, due_at)
  VALUES (v_auto, v_org, 'click_no_buy', 'smoke-a', v_ev, v_ev, 'smoke-3am-1@example.com', 'queued', now()),
         (v_auto, v_org, 'click_no_buy', 'smoke-b', 'e6cf80b4-2567-44b4-bdb9-8223977ff312', 'e6cf80b4-2567-44b4-bdb9-8223977ff312', 'smoke-3am-2@example.com', 'queued', now());
  v := public.collect_email_automations();
  out := out || E'\nrecette : ' || COALESCE((SELECT string_agg(left(ev.title, 40) || ' → ' || t.name || ' (' || jsonb_array_length(c.blocks_json) || ' sections, « ' || c.subject || ' », ' || c.status || ')', ' | ' ORDER BY ev.title)
                                              FROM public.email_campaigns c JOIN public.events ev ON ev.id = c.event_id
                                              JOIN public.email_campaign_templates t ON t.id = c.source_template_id WHERE c.automation_id = v_auto), '∅');
  -- Le modèle de base n'a pas bougé, et le modèle de soirée n'est dans aucune bibliothèque.
  out := out || E'\nbase intacte : ' || (SELECT (template_id = v_base)::text FROM public.email_automations WHERE id = v_auto)
    || ' / bibliothèque 3AM sans modèle de soirée : ' || NOT EXISTS (SELECT 1 FROM public.email_campaign_templates WHERE organizer_user_id = v_org AND product = 'crm' AND for_event_id IS NULL AND id = v_tpl);
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
