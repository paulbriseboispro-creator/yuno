-- Répétition annulée de 20261123100000_email_event_templates.sql sur 3 AM (Act III) :
--   node scripts/crm-bench/rehearse.mjs smoke/event-templates.sql 20261123100000_email_event_templates.sql
-- Modèles, recette, registre, campagne et clics fictifs ; rien n'est envoyé ni gardé (SMOKE_OK annule tout).
DO $$
DECLARE
  v_org uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_key text := public.crm_scope_key(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5'::uuid);
  v_ev uuid := 'fb2009cb-2666-496f-af3e-4389cd406bad';      -- Act III
  v_ev2 uuid := 'e6cf80b4-2567-44b4-bdb9-8223977ff312';     -- Act II
  v_foreign uuid;
  v_base uuid := gen_random_uuid(); v_e uuid := gen_random_uuid(); v_e2 uuid := gen_random_uuid();
  v_auto uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  v_url text; v_em text; out text := ''; v jsonb; e text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT external_ticket_url INTO v_url FROM public.events WHERE id = v_ev;
  INSERT INTO public.crm_email_settings (scope_key, organizer_user_id, sender_name, legal_name, postal_address)
  VALUES (v_key, v_org, 'Smoke 3AM', 'Smoke SAS', '12 rue de la Répétition 75011 Paris')
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, legal_name = EXCLUDED.legal_name, postal_address = EXCLUDED.postal_address;
  INSERT INTO public.legal_acceptances (user_id, doc_type, doc_version, context)
  SELECT v_org, d, '9999-12-31', '{"smoke":true}'::jsonb FROM unnest(ARRAY['terms_crm', 'dpa']) d;

  -- 1. Modèles : base (bibliothèque), propre à l'Act III, propre à l'Act II.
  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, blocks_json, blocks_version, product)
  VALUES (v_base, v_org, 'smoke base', 'Objet de base', '[]', 2, 'crm');
  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, blocks_json, blocks_version, product, for_event_id, expires_at)
  VALUES (v_e, v_org, 'smoke act III', 'Ne sois pas celui qui n''a jamais su', '[]', 2, 'crm', v_ev, '2099-01-01');
  INSERT INTO public.email_campaign_templates (id, organizer_user_id, name, subject, blocks_json, blocks_version, product, for_event_id)
  VALUES (v_e2, v_org, 'smoke act II', 'Act II', '[]', 2, 'crm', v_ev2);
  out := out || 'expire act III=' || (SELECT to_char(expires_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') FROM public.email_campaign_templates WHERE id = v_e)
    || ' (client a posé 2099 → recalculé)';

  BEGIN
    UPDATE public.email_campaign_templates SET for_event_id = v_ev2 WHERE id = v_e;
    out := out || E'\nchanger la soirée : ACCEPTÉ (anormal)';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nchanger la soirée : refusé (' || e || ')';
  END;
  SELECT id INTO v_foreign FROM public.events WHERE external_source IS NULL ORDER BY created_at DESC LIMIT 1;
  BEGIN
    INSERT INTO public.email_campaign_templates (organizer_user_id, name, blocks_json, blocks_version, product, for_event_id)
    VALUES (v_org, 'smoke hors portée', '[]', 2, 'crm', v_foreign);
    out := out || E'\nsoirée hors portée : ACCEPTÉE (anormal)';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nsoirée hors portée : refusée (' || e || ')';
  END;

  -- 2. Recette « A cliqué sans acheter » de base + modèle propre de l'Act III.
  INSERT INTO public.email_automations (id, organizer_user_id, kind, enabled, enabled_at, delay_hours, template_id, product)
  VALUES (v_auto, v_org, 'click_no_buy', true, now(), 24, v_base, 'crm');
  BEGIN
    UPDATE public.email_automations SET template_id = v_e WHERE id = v_auto;
    out := out || E'\nmodèle de soirée en base : ACCEPTÉ (anormal)';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nmodèle de soirée en base : refusé (' || e || ')';
  END;
  BEGIN
    PERFORM public.email_automation_event_template_set(v_auto, v_ev, v_base);
    out := out || E'\nlien vers un modèle de base : ACCEPTÉ (anormal)';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nlien vers un modèle de base : refusé (' || e || ')';
  END;
  BEGIN
    PERFORM public.email_automation_event_template_set(v_auto, v_ev, v_e2);
    out := out || E'\nlien vers le modèle d''une autre soirée : ACCEPTÉ (anormal)';
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS e = MESSAGE_TEXT; out := out || E'\nlien vers le modèle d''une autre soirée : refusé (' || e || ')';
  END;
  v := public.email_automation_event_template_set(v_auto, v_ev, v_e);
  out := out || E'\nlien act III : ' || v::text;

  -- Registre : deux personnes dues pour l'Act III, une pour l'Act II.
  INSERT INTO public.email_automation_sends (automation_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id, email, status, due_at)
  VALUES (v_auto, v_org, 'click_no_buy', 'smoke-a', v_ev, v_ev, 'smoke-evtpl-1@example.com', 'queued', now()),
         (v_auto, v_org, 'click_no_buy', 'smoke-a', v_ev, v_ev, 'smoke-evtpl-2@example.com', 'queued', now()),
         (v_auto, v_org, 'click_no_buy', 'smoke-b', v_ev2, v_ev2, 'smoke-evtpl-3@example.com', 'queued', now());
  v := public.collect_email_automations();
  out := out || E'\nrecettes : budget_hit=' || COALESCE(v->>'budget_hit', '?') || E'\n  enfants : '
    || COALESCE((SELECT string_agg(coalesce(ev.title, '∅') || ' → modèle ' || coalesce(t.name, c.source_template_id::text, '∅')
                                   || ' / propre=' || (c.source_template_event_id IS NOT NULL)::text
                                   || ' / objet « ' || c.subject || ' » / ' || c.total_recipients || ' pers. / ' || c.status, E'\n            ' ORDER BY ev.title)
                   FROM public.email_campaigns c LEFT JOIN public.events ev ON ev.id = c.event_id
                   LEFT JOIN public.email_campaign_templates t ON t.id = c.source_template_id
                  WHERE c.automation_id = v_auto), '∅');

  -- Retirer le lien : la personne suivante de l'Act III part avec le modèle de base,
  -- dans une NOUVELLE campagne enfant ; celle du modèle propre ne bouge pas.
  v := public.email_automation_event_template_set(v_auto, v_ev, NULL);
  INSERT INTO public.email_automation_sends (automation_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id, email, status, due_at)
  VALUES (v_auto, v_org, 'click_no_buy', 'smoke-c', v_ev, v_ev, 'smoke-evtpl-4@example.com', 'queued', now());
  v := public.collect_email_automations();
  out := out || E'\napres retrait : '
    || (SELECT string_agg(coalesce(t.name, '∅') || '=' || c.total_recipients, ', ' ORDER BY t.name)
          FROM public.email_campaigns c LEFT JOIN public.email_campaign_templates t ON t.id = c.source_template_id
         WHERE c.automation_id = v_auto AND c.event_id = v_ev);

  -- 3. Relance après clic d'une campagne : modèle propre de l'Act III (c1), modèle de l'Act II sur l'Act III (c2).
  SELECT lower(s.email) INTO v_em FROM public.newsletter_subscriptions s
   WHERE s.organizer_user_id = v_org AND s.venue_id IS NULL AND s.product = 'crm' AND s.opted_in AND s.opted_out_at IS NULL
     AND NOT public.is_email_suppressed(s.email)
     AND NOT EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = v_ev AND lower(xt.buyer_email) = lower(s.email))
   LIMIT 1;
  INSERT INTO public.email_campaigns (id, organizer_user_id, product, type, status, name, subject, audiences_json, blocks_json, blocks_version,
                                      event_id, followup_enabled, followup_delay_hours, followup_template_id)
  VALUES (c1, v_org, 'crm', 'promotional', 'draft', 'smoke act III c1', 'smoke', '[]', '[]', 2, v_ev, true, 6, v_e),
         (c2, v_org, 'crm', 'promotional', 'draft', 'smoke act III c2', 'smoke', '[]', '[]', 2, v_ev, true, 6, v_e2);
  UPDATE public.email_campaigns SET status = 'sent', sent_at = now() - interval '1 day' WHERE id IN (c1, c2);
  INSERT INTO public.email_campaign_recipients (campaign_id, email, status, sent_at)
  SELECT c, v_em, 'sent', now() - interval '1 day' FROM unnest(ARRAY[c1, c2]) c;
  INSERT INTO public.email_campaign_events (campaign_id, recipient_email, event_type, metadata, created_at)
  SELECT c, v_em, 'clicked', jsonb_build_object('click', jsonb_build_object('link', v_url)), now() - interval '10 hours' FROM unnest(ARRAY[c1, c2]) c;
  v := public.collect_campaign_followups();
  out := out || E'\nrelance c1 : '
    || COALESCE((SELECT 'modèle ' || t.name || ' / propre=' || (c.source_template_event_id IS NOT NULL)::text || ' / objet « ' || c.subject || ' » / ' || c.total_recipients || ' pers.'
                   FROM public.email_campaigns c JOIN public.email_campaign_templates t ON t.id = c.source_template_id
                  WHERE c.parent_campaign_id = c1), 'aucune')
    || E'\nrelance c2 (modèle d''une autre soirée) : '
    || COALESCE((SELECT c.id::text FROM public.email_campaigns c WHERE c.parent_campaign_id = c2), 'aucune');

  -- 4. Lecture de la Console.
  v := public.email_event_templates(NULL, v_org, 'crm');
  out := out || E'\nlecture : ' || (SELECT string_agg((x->>'name') || ' expired=' || (x->>'expired') || ' recettes=' || jsonb_array_length(x->'automations')
                                                       || ' campagnes=' || jsonb_array_length(x->'campaigns') || ' envoyés=' || (x->>'sent'), ' | ')
                                         FROM jsonb_array_elements(v) x WHERE x->>'name' LIKE 'smoke%');

  -- 5. Purge : rien d'actuel ne part.
  out := out || E'\npurge : ' || public.purge_expired_event_templates() || ' modèle(s) supprimé(s)';
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
