-- ============================================================================
-- Démo Yuno CRM : la suite SMS de crm@womber.fr.
--
-- 1. Un numéro FICTIF (plage de fiction ARCEP +33 6 39 98 xx xx, un par
--    acheteur, déterministe) sur ~70 % des billets Shotgun semés, puis un
--    accord SMS (registre venue_sms_contacts, source « ticketing ») pour ~80 %
--    d'entre eux.
-- 2. Six SMS partis (août → octobre), comme le moteur les aurait laissés :
--    destinataires remis / en échec, clics sur le lien suivi de la soirée
--    (visiteurs anonymes, la plupart dans l'heure), quelques STOP. Les achats
--    ne sont PAS semés : ce sont les vrais billets de la démo, rattachés par
--    la règle des 7 jours.
-- 3. Trois brouillons (prêt avec une date, date à choisir, audience à
--    choisir).
-- 4. L'identité de l'annonceur (raison sociale + SIRET de démonstration).
-- Rien ne part : aucun appel au moteur d'envoi, aucun Yunit débité.
--
-- Rejouable : efface les SMS marqués segment_filters.seed = 'crm-sms' de CE
-- compte, ses accords SMS (source 'ticketing' semés ici) et ses clics semés.
-- Prérequis : seed-crm-demo.sql (à relancer AVANT celui-ci : il recrée les
-- billets sans numéro).
--   supabase db query --linked -f scripts/demo/seed-crm-sms.sql
-- ============================================================================

BEGIN;

DO $seed$
DECLARE
  v_uid uuid;
  v_c record;
  v_cid uuid;
  v_link uuid;
  v_sent timestamptz;
  v_body text;
  v_parts integer;
  v_rate numeric;
  v_n integer;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  IF NOT public.is_demo_email('crm@womber.fr') OR NOT public.is_demo_marketing_scope(NULL, v_uid) THEN
    RAISE EXCEPTION 'périmètre démo introuvable';
  END IF;

  -- ---------------------------------------------------------------- Ménage
  DELETE FROM public.tracked_link_clicks k
   USING public.tracked_links tl
   WHERE k.tracked_link_id = tl.id AND tl.organizer_user_id = v_uid AND lower(tl.label) = 'sms'
     AND k.visitor_id LIKE 'seed-sms-%';
  DELETE FROM public.sms_campaigns WHERE organizer_id = v_uid AND venue_id IS NULL AND segment_filters->>'seed' = 'crm-sms';
  DELETE FROM public.venue_sms_contacts WHERE organizer_user_id = v_uid AND venue_id IS NULL AND consent_source = 'ticketing';

  -- ------------------------------------------------- Numéros et accords SMS
  WITH buyers AS (
    SELECT lower(t.buyer_email) AS email, row_number() OVER (ORDER BY lower(t.buyer_email)) AS rk
      FROM public.external_tickets t
     WHERE t.organizer_user_id = v_uid AND t.buyer_email IS NOT NULL
     GROUP BY lower(t.buyer_email)
  )
  UPDATE public.external_tickets t
     SET buyer_phone = CASE WHEN abs(hashtext(b.email || 'ph')) % 10 < 7
                            THEN '+3363998' || lpad(b.rk::text, 4, '0') END
    FROM buyers b
   WHERE t.organizer_user_id = v_uid AND lower(t.buyer_email) = b.email AND b.rk < 10000;

  INSERT INTO public.venue_sms_contacts (organizer_user_id, phone_e164, full_name, email, sms_consent_at, consent_source, source_event_id)
  SELECT DISTINCT ON (t.buyer_phone) v_uid, t.buyer_phone,
         btrim(COALESCE(t.buyer_first_name, '') || ' ' || COALESCE(t.buyer_last_name, '')),
         lower(t.buyer_email),
         min(COALESCE(t.purchased_at, t.first_seen_at)) OVER (PARTITION BY t.buyer_phone),
         'ticketing', t.event_id
    FROM public.external_tickets t
   WHERE t.organizer_user_id = v_uid AND t.buyer_phone IS NOT NULL
     AND abs(hashtext(lower(t.buyer_email) || 'ok')) % 10 < 8
   ORDER BY t.buyer_phone, COALESCE(t.purchased_at, t.first_seen_at)
  ON CONFLICT DO NOTHING;

  -- La base de contacts (cache) relit les numéros.
  PERFORM public._contact_base_cache_build(public.contact_base_scope_key(NULL, v_uid), NULL, v_uid, true);
  PERFORM public._crm_people_build(NULL, v_uid, NULL);

  -- ---------------------------------------------------------- SMS partis
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR v_c IN
    SELECT q.* FROM (
    SELECT x.name, x.segs, x.ev, x.body, x.rate, x.tpl, e.id AS event_id,
           ((e.start_at AT TIME ZONE 'Europe/Paris')::date - x.j + make_time(x.hh, 0, 0)) AS at
      FROM (VALUES
        (9, 10, 'Soirée d''été — nouveaux', '["nou"]'::jsonb, 'Open Air Closing #16',
         'Nouveau chez nous, {{prénom}} ? Votre première soirée d''été : {{soirée}}, samedi. Places : {{lien}}', 0.18, 'bienvenue'),
        (1, 17, 'Last call Rooftop Sunset', '["hab","occ"]', 'Rooftop Sunset #17',
         'Demain : {{soirée}}, {{prénom}}. Dernières places : {{lien}}', 0.24, 'lastcall'),
        (1, 18, 'Demain : Deep Night', '["hab"]', 'Deep Night #18',
         'C''est demain, {{prénom}} : {{soirée}}. Portes à 23 h. Vos places : {{lien}}', 0.28, 'rappel'),
        (6, 11, 'On vous a manqué — endormis', '["end"]', 'Bass Culture #19',
         '{{prénom}}, ca fait un moment ! On vous attend pour {{soirée}} : {{lien}}', 0.07, 'retrouvailles'),
        (12, 10, 'Prévente Bass Culture — habitués', '["hab"]', 'Bass Culture #19',
         '{{prénom}}, la prévente de {{soirée}} est ouverte, en avant-première pour vous : {{lien}}', 0.34, 'avantpremiere'),
        (7, 10, 'Prévente Minimal Room #20', '["hab","occ"]', 'Minimal Room #20',
         'La prévente de {{soirée}} est ouverte, {{prénom}}. Les places partent vite : {{lien}}', 0.26, 'avantpremiere')
      ) AS x(j, hh, name, segs, ev, body, rate, tpl)
      JOIN public.events e ON e.organizer_user_id = v_uid AND e.title = x.ev
    ) q
     WHERE (q.at AT TIME ZONE 'Europe/Paris') < now() - interval '1 hour'
     ORDER BY q.at
  LOOP
    v_sent := v_c.at AT TIME ZONE 'Europe/Paris';
    SELECT l.id INTO v_link FROM public.ensure_sms_tracked_link(v_c.event_id) l;
    -- Le texte qui part : prénom d'exemple pour compter les SMS (1 ou 2).
    v_body := replace(replace(replace(v_c.body, '{{prénom}}', 'Camille'), '{{soirée}}', 'Minimal Room #20'),
                      '{{lien}}', 'https://yunoapp.eu/l/XXXXXXXX');
    v_parts := CASE WHEN char_length('NUITSDEMO : ' || v_body || E'\nSTOP pour ne plus recevoir') > 160 THEN 2 ELSE 1 END;

    INSERT INTO public.sms_campaigns (organizer_id, venue_id, created_by, name, body_template, segment_filters, status,
                                      event_id, sender_name, quiet_hours, sent_at, send_started_at, created_at,
                                      segments_per_message, tracked_link_id)
    VALUES (v_uid, NULL, v_uid, v_c.name, v_c.body,
            jsonb_build_object('type', 'crm', 'seed', 'crm-sms', 'exclude_buyers', false, 'tpl', v_c.tpl,
              'audiences', (SELECT jsonb_agg(jsonb_build_object('kind', 'crm', 'def', jsonb_build_object('seg', s),
                                     'label', CASE s WHEN 'hab' THEN 'Habitués' WHEN 'occ' THEN 'Occasionnels'
                                                     WHEN 'nou' THEN 'Nouveaux' ELSE 'Endormis' END))
                              FROM jsonb_array_elements_text(v_c.segs) s)),
            'sent', v_c.event_id, 'NUITSDEMO', true, v_sent, v_sent, v_sent - interval '2 days', v_parts, v_link)
    RETURNING id INTO v_cid;

    -- Destinataires : joignables du groupe à la date, sans STOP antérieur.
    INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, phone_e164, full_name, lang, status, attempts, credits, sent_at, delivered_at, created_at)
    SELECT v_cid, vc.id, vc.phone_e164, vc.full_name, 'fr',
           CASE WHEN abs(hashtext(vc.phone_e164 || v_cid::text)) % 100 < 3 THEN 'undelivered' ELSE 'delivered' END,
           1, v_parts,
           v_sent + make_interval(secs => abs(hashtext(vc.phone_e164 || 's' || v_cid::text)) % 300),
           CASE WHEN abs(hashtext(vc.phone_e164 || v_cid::text)) % 100 < 3 THEN NULL
                ELSE v_sent + make_interval(secs => 20 + abs(hashtext(vc.phone_e164 || 's' || v_cid::text)) % 300) END,
           v_sent - interval '5 minutes'
      FROM _cp p
      JOIN public.venue_sms_contacts vc ON vc.organizer_user_id = v_uid AND vc.venue_id IS NULL AND vc.phone_e164 = p.phone
     WHERE p.lifecycle IN (SELECT jsonb_array_elements_text(v_c.segs))
       AND vc.sms_consent_at <= v_sent
       AND (vc.unsubscribed_at IS NULL OR vc.unsubscribed_at > v_sent)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.sms_campaigns c
       SET total_recipients = v_n, estimated_recipients = v_n, sent_count = v_n,
           delivered_count = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = v_cid AND r.status = 'delivered'),
           undelivered_count = (SELECT count(*) FROM public.sms_campaign_recipients r WHERE r.campaign_id = v_cid AND r.status = 'undelivered'),
           credits_consumed = v_n * v_parts
     WHERE c.id = v_cid;

    -- Clics sur le lien de la soirée : la plupart dans l'heure.
    INSERT INTO public.tracked_link_clicks (tracked_link_id, clicked_at, visitor_id, device_type)
    SELECT v_link,
           v_sent + make_interval(mins => CASE
             WHEN g.h < 31 THEN g.h % 5
             WHEN g.h < 53 THEN 5 + g.h % 10
             WHEN g.h < 67 THEN 15 + g.h % 15
             WHEN g.h < 78 THEN 30 + g.h % 30
             WHEN g.h < 88 THEN 60 + (g.h * 7) % 120
             WHEN g.h < 95 THEN 180 + (g.h * 37) % 1260
             ELSE 1440 + (g.h * 131) % 4000 END),
           'seed-sms-' || v_cid || '-' || g.i, 'mobile'
      FROM (SELECT i, abs(hashtext(v_cid::text || i)) % 100 AS h
              FROM generate_series(1, GREATEST(1, round(v_n * 0.97 * v_c.rate)::int)) i) g;

    -- Quelques STOP dans les heures qui suivent (plus chez les endormis).
    UPDATE public.venue_sms_contacts vc
       SET unsubscribed = true,
           unsubscribed_at = v_sent + make_interval(mins => 3 + abs(hashtext(vc.phone_e164 || 'stop')) % 600)
      FROM public.sms_campaign_recipients r
     WHERE r.campaign_id = v_cid AND r.status = 'delivered' AND r.phone_e164 = vc.phone_e164
       AND vc.organizer_user_id = v_uid AND vc.venue_id IS NULL AND NOT vc.unsubscribed
       AND abs(hashtext(vc.phone_e164 || v_cid::text || 'stop')) % 1000 < CASE WHEN v_c.segs ? 'end' THEN 15 ELSE 4 END;
  END LOOP;

  -- ------------------------------------------------- Réglages d'envoi
  INSERT INTO public.crm_sms_settings (scope_key, sender_name, quiet_from, quiet_to, no_sunday, weekly_cap, test_phone, updated_by)
  VALUES (public.crm_scope_key(NULL, v_uid), 'NUITSDEMO', 20, 8, true, 2, '+33639989999', v_uid)
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, quiet_from = EXCLUDED.quiet_from,
    quiet_to = EXCLUDED.quiet_to, no_sunday = EXCLUDED.no_sunday, weekly_cap = EXCLUDED.weekly_cap,
    test_phone = EXCLUDED.test_phone, updated_at = now();

  -- --------------------------------------------- Identité de l'annonceur
  -- Exigée avant tout envoi (charte AF2M, get_sms_sender_readiness) : sans
  -- elle, l'étape « Vérifier » de la démo afficherait un point bloquant. SIRET
  -- de démonstration (14 zéros), jamais celui d'une vraie structure ; la démo
  -- n'envoie de toute façon rien (demo_no_send).
  UPDATE public.organizer_profiles
     SET legal_name = COALESCE(NULLIF(btrim(legal_name), ''), 'Nuits Démo SAS'),
         siret = COALESCE(NULLIF(btrim(siret), ''), '00000000000000')
   WHERE user_id = v_uid;

  -- ------------------------------------------------------------ Brouillons
  INSERT INTO public.sms_campaigns (organizer_id, venue_id, created_by, name, body_template, segment_filters, status,
                                    event_id, sender_name, quiet_hours, scheduled_at, created_at, updated_at,
                                    estimated_recipients, segments_per_message)
  SELECT v_uid, NULL, v_uid, d.name, d.body,
         jsonb_build_object('type', 'crm', 'seed', 'crm-sms', 'exclude_buyers', d.ex, 'tpl', d.tpl,
                            'audiences', d.aud),
         'draft', e.id, 'NUITSDEMO', true, d.at, now() - d.ago, now() - d.ago, 0, 1
    FROM (VALUES
      ('Dernières places — Minimal Room #20', 'Dernières places pour {{soirée}} ce soir, {{prénom}}. On vous en garde une : {{lien}}',
       '[{"kind":"crm","def":{"seg":"occ"},"label":"Occasionnels"}]'::jsonb, true,
       (((SELECT (min(start_at) AT TIME ZONE 'Europe/Paris')::date FROM public.events WHERE organizer_user_id = v_uid AND title = 'Minimal Room #20') + time '18:00') AT TIME ZONE 'Europe/Paris'), interval '1 hour', 'Minimal Room #20', 'lastcall'),
      ('Halloween Rave — avant-première', '{{prénom}}, Halloween Rave le 31 octobre. Les places partent vite : {{lien}}',
       '[{"kind":"crm","def":{"seg":"hab"},"label":"Habitués"}]'::jsonb, false, NULL::timestamptz, interval '1 day', 'Halloween Rave', 'avantpremiere'),
      ('On vous a manqué', '{{prénom}}, ca fait un moment ! On vous attend ce week-end : {{lien}}',
       '[]'::jsonb, false, NULL::timestamptz, interval '5 days', 'House Nation #21', 'retrouvailles')
    ) AS d(name, body, aud, ex, at, ago, ev, tpl)
    JOIN public.events e ON e.organizer_user_id = v_uid AND e.title = d.ev;
END
$seed$;

COMMIT;
