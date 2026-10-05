-- ============================================================================
-- Démo Yuno CRM — la guest list Shotgun (crm@womber.fr).
-- À rejouer APRÈS seed-crm-demo.sql (qui recrée la connexion 'demo-crm' et
-- ses billets) ; rejouable seul : efface puis recrée SES lignes (external_id
-- « …-gl-… »). Ce que Shotgun rend d'une guest list (docs/designs/
-- CRM_GUEST_LIST_ANALYTICS.md) :
--   • invitations (raw.deal_channel = 'invitation') : promoteurs, artistes &
--     équipe, presse & partenaires ;
--   • « Guest list gratuite (avant 1h) » : un tarif à 0 € en libre-service.
-- Viviers : des habitués de la guest list qui ne paient jamais, des visages
-- nouveaux (qui achètent ensuite : « devenus clients »), des clients payants
-- invités, une équipe fixe. Les soirées passées sont scannées (arrivées avant
-- 1 h pour la liste gratuite), les soirées à venir se remplissent jusqu'à
-- maintenant. Aucune donnée réelle : @example.com, noms tirés de listes.
--   supabase db query --linked -f scripts/demo/seed-crm-guestlist.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_conn uuid;
  v_ev record;
  v_k integer;
  v_h integer;
  v_list record;
  v_n integer;
  v_i integer;
  v_idx integer;
  v_r double precision;
  v_email text;
  v_t timestamptz;
  v_scan timestamptz;
  v_rate double precision;
  v_up boolean;
  v_share double precision;
  v_free_added integer;
  v_removed integer;
  v_first text[] := ARRAY['Léa','Hugo','Inès','Lucas','Chloé','Nathan','Manon','Théo','Camille','Louis','Sarah','Jules','Emma','Adam','Lina','Noah','Zoé','Rayan','Jade','Maël','Alice','Sacha','Nina','Enzo','Lou','Yanis','Maya','Tom','Eva','Malo'];
  v_last text[] := ARRAY['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez','Legrand'];
  v_cities text[] := ARRAY['Paris','Paris','Paris','Paris','Paris','Montreuil','Saint-Denis','Boulogne-Billancourt','Vincennes','Pantin','Lyon','Lille'];
  v_free_deal constant text := 'Guest list gratuite (avant 1h)';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM setseed(0.27);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  SELECT id INTO v_conn FROM public.ticketing_connections
   WHERE organizer_user_id = v_uid AND provider = 'shotgun' AND external_org_id = 'demo-crm';
  IF v_conn IS NULL THEN RAISE EXCEPTION 'connexion démo absente : jouer seed-crm-demo.sql d''abord'; END IF;

  -- Rejouable : rend aux soirées à venir les places de la liste gratuite, puis efface.
  FOR v_ev IN SELECT x.id, x.left_tickets, x.start_at,
                     (SELECT count(*) FROM public.external_tickets t
                       WHERE t.connection_id = v_conn AND t.external_event_id = x.external_id
                         AND t.external_id LIKE '%-gl-f-%' AND t.status = 'valid') AS n
                FROM public.external_events x WHERE x.connection_id = v_conn LOOP
    IF v_ev.left_tickets IS NOT NULL AND v_ev.n > 0 THEN
      UPDATE public.external_events SET left_tickets = v_ev.left_tickets + v_ev.n WHERE id = v_ev.id;
    END IF;
  END LOOP;
  DELETE FROM public.external_tickets WHERE connection_id = v_conn AND external_id LIKE '%-gl-%';
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  FOR v_ev IN
    SELECT x.*
      FROM public.external_events x
     WHERE x.connection_id = v_conn AND x.event_id IS NOT NULL
       -- Seulement les soirées qui vendent (pas les dates annoncées sans billet).
       AND EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.connection_id = v_conn AND t.external_event_id = x.external_id)
     ORDER BY x.start_at
  LOOP
    v_k := CASE WHEN v_ev.external_id LIKE 'demo-old-%' THEN -12 - substring(v_ev.external_id FROM 10)::int
                WHEN v_ev.external_id ~ '^demo-[0-9]+$' THEN substring(v_ev.external_id FROM 6)::int - 20
                ELSE 0 END;
    v_h := abs(hashtext('gl' || v_ev.external_id));
    v_up := v_ev.start_at > now();
    -- Part déjà inscrite d'une soirée à venir (J+3 bien remplie, J+17 à peine).
    v_share := CASE WHEN NOT v_up THEN 1
                    WHEN v_ev.start_at < now() + interval '5 days' THEN 0.72
                    WHEN v_ev.start_at < now() + interval '12 days' THEN 0.3
                    ELSE 0.08 END;

    -- Le tarif gratuit apparaît dans la fiche Shotgun de la soirée.
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_ev.deals) = 'array' THEN v_ev.deals ELSE '[]'::jsonb END) d
                    WHERE d->>'name' = v_free_deal) THEN
      UPDATE public.external_events
         SET deals = COALESCE(CASE WHEN jsonb_typeof(deals) = 'array' THEN deals END, '[]'::jsonb)
                     || jsonb_build_array(jsonb_build_object('name', v_free_deal, 'price', 0, 'quantity', 80,
                                                             'visibility', 'public', 'sales_channel', 'online'))
       WHERE id = v_ev.id;
    END IF;

    v_free_added := 0;
    FOR v_list IN
      SELECT * FROM (VALUES
        -- code, nom, canal, taille de base, venue (taux de scan), vivier
        ('f', v_free_deal, 'online', 30 + (v_h % 20) + GREATEST(0, v_k + 12), 0.50 + ((v_h / 7) % 15) / 100.0, 'free'),
        ('p', 'Invitations promoteurs', 'invitation', 16 + (v_h / 3) % 14, 0.58 + ((v_h / 11) % 14) / 100.0, 'promo'),
        ('a', 'Artistes & équipe', 'invitation', 6 + (v_h / 5) % 6, 0.86, 'crew'),
        ('m', 'Presse & partenaires', 'invitation', CASE WHEN (v_h / 13) % 3 = 0 THEN 3 + (v_h / 17) % 5 ELSE 0 END, 0.5, 'press')
      ) AS l(code, name, channel, n, rate, pool)
    LOOP
      v_n := floor(v_list.n * CASE WHEN v_list.pool IN ('crew', 'press') AND v_up AND v_share < 0.5 THEN 0 ELSE v_share END)::int;
      v_rate := LEAST(0.97, v_list.rate);
      FOR v_i IN 1..v_n LOOP
        v_r := random();
        v_idx := CASE v_list.pool
          WHEN 'crew' THEN 3500 + floor(random() * 40)::int
          WHEN 'press' THEN 3600 + floor(random() * 60)::int
          WHEN 'free' THEN CASE WHEN v_r < 0.62 THEN 3000 + floor(power(random(), 1.5) * 450)::int
                                WHEN v_r < 0.82 THEN 1200 + floor(random() * 700)::int
                                ELSE floor(power(random(), 1.6) * 1200)::int END
          ELSE CASE WHEN v_r < 0.55 THEN 3000 + floor(power(random(), 1.3) * 450)::int
                    WHEN v_r < 0.75 THEN 1200 + floor(random() * 700)::int
                    ELSE floor(power(random(), 1.6) * 1200)::int END
        END;
        v_email := translate(lower(v_first[1 + (v_idx % 30)] || '.' || v_last[1 + ((v_idx / 30) % 30)] || '.' || v_idx),
                             'éèêëàâäîïôöùûüçœ', 'eeeeaaaiioouuuco') || '@example.com';
        -- Une personne ne figure qu'une fois sur la soirée (ni deux listes, ni liste + billet payé).
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.external_tickets t
                               WHERE t.connection_id = v_conn AND t.external_event_id = v_ev.external_id
                                 AND t.buyer_email = v_email);

        -- Inscription : la liste gratuite se remplit en accélérant vers la soirée,
        -- les invitations partent dans la semaine qui précède.
        IF v_list.pool = 'free' THEN
          v_t := v_ev.start_at - interval '12 days' * power(random(), 2.2);
          v_t := LEAST(v_t, v_ev.start_at + interval '30 minutes');
        ELSE
          v_t := v_ev.start_at - interval '7 days' + interval '6 days 20 hours' * random();
        END IF;
        IF v_up THEN
          v_t := now() - (now() - LEAST(v_ev.start_at - interval '12 days', now() - interval '4 days')) * power(random(), 1.8);
          v_t := LEAST(v_t, now() - make_interval(mins => 4 + floor(random() * 30)::int));
        END IF;

        -- Venue : seulement les soirées passées, à l'heure de la liste.
        v_scan := NULL;
        IF NOT v_up AND random() < v_rate THEN
          v_scan := v_ev.start_at + CASE v_list.pool
            WHEN 'free' THEN make_interval(mins => floor(power(random(), 1.4) * 118)::int)
            WHEN 'crew' THEN make_interval(mins => floor(random() * 100)::int - 30)
            WHEN 'press' THEN make_interval(mins => 40 + floor(random() * 150)::int)
            ELSE make_interval(mins => 25 + floor(power(random(), 0.9) * 215)::int) END;
        END IF;

        INSERT INTO public.external_tickets (connection_id, organizer_user_id, provider, external_id, external_order_id, external_event_id,
               event_id, deal_id, deal_name, status, raw_status, quantity, price, fees, currency,
               buyer_email, buyer_first_name, buyer_last_name, newsletter_optin, age, gender, city, country_code,
               purchased_at, scanned_at, source_updated_at, utm, raw)
        VALUES (v_conn, v_uid, 'shotgun', v_ev.external_id || '-gl-' || v_list.code || '-' || v_i,
               v_ev.external_id || '-glo-' || v_list.code || '-' || v_i, v_ev.external_id,
               v_ev.event_id, md5(v_list.name), v_list.name,
               CASE WHEN v_list.pool = 'free' AND random() < 0.03 THEN 'cancelled' ELSE 'valid' END,
               'valid', 1, 0, 0, 'EUR',
               v_email, v_first[1 + (v_idx % 30)], v_last[1 + ((v_idx / 30) % 30)],
               (abs(hashtext('glopt' || v_idx)) % 100) < 48,
               CASE WHEN (abs(hashtext('age' || v_idx)) % 10) < 7 THEN 19 + abs(hashtext('a' || v_idx)) % 16 END,
               CASE WHEN (abs(hashtext('g' || v_idx)) % 10) < 7
                    THEN CASE WHEN abs(hashtext('gg' || v_idx)) % 100 < CASE WHEN v_idx >= 3000 THEN 58 ELSE 50 END THEN 'female' ELSE 'male' END END,
               CASE WHEN (abs(hashtext('c' || v_idx)) % 10) < 8 THEN v_cities[1 + abs(hashtext('cc' || v_idx)) % array_length(v_cities, 1)] END,
               'FR', v_t, v_scan, now(),
               CASE WHEN v_list.pool = 'free' THEN
                 CASE WHEN random() < 0.45 THEN '{"utm_source":"instagram","utm_medium":"app"}'::jsonb
                      WHEN random() < 0.4 THEN '{"utm_source":"shotgun","utm_medium":"app"}'::jsonb END END,
               jsonb_build_object('deal_channel', v_list.channel, 'deal_title', v_list.name, 'deal_price', 0,
                                  'deal_visibilities', CASE WHEN v_list.channel = 'invitation' THEN '["private"]'::jsonb ELSE '["public"]'::jsonb END,
                                  'payment_method', NULL));
        IF v_list.pool = 'free' THEN v_free_added := v_free_added + 1; END IF;
      END LOOP;
    END LOOP;

    -- Shotgun : demandes encore à valider sur la prochaine soirée.
    IF v_up AND v_ev.start_at < now() + interval '5 days' THEN
      FOR v_i IN 1..6 LOOP
        v_idx := 3000 + floor(random() * 450)::int;
        v_email := translate(lower(v_first[1 + (v_idx % 30)] || '.' || v_last[1 + ((v_idx / 30) % 30)] || '.' || v_idx),
                             'éèêëàâäîïôöùûüçœ', 'eeeeaaaiioouuuco') || '@example.com';
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.external_tickets t
                               WHERE t.connection_id = v_conn AND t.external_event_id = v_ev.external_id AND t.buyer_email = v_email);
        INSERT INTO public.external_tickets (connection_id, organizer_user_id, provider, external_id, external_order_id, external_event_id,
               event_id, deal_id, deal_name, status, raw_status, quantity, price, fees, currency,
               buyer_email, buyer_first_name, buyer_last_name, country_code, purchased_at, source_updated_at, raw)
        VALUES (v_conn, v_uid, 'shotgun', v_ev.external_id || '-gl-w-' || v_i, v_ev.external_id || '-glo-w-' || v_i, v_ev.external_id,
               v_ev.event_id, md5(v_free_deal), v_free_deal, 'other', 'pending_approval', 1, 0, 0, 'EUR',
               v_email, v_first[1 + (v_idx % 30)], v_last[1 + ((v_idx / 30) % 30)], 'FR',
               now() - make_interval(hours => 1 + floor(random() * 30)::int), now(),
               jsonb_build_object('deal_channel', 'online', 'deal_title', v_free_deal, 'deal_price', 0, 'deal_visibilities', '["public"]'::jsonb));
      END LOOP;
    END IF;

    -- La liste gratuite prend des places sur la jauge d'une soirée à venir.
    IF v_ev.left_tickets IS NOT NULL AND v_free_added > 0 THEN
      UPDATE public.external_events SET left_tickets = GREATEST(0, left_tickets - v_free_added) WHERE id = v_ev.id;
    END IF;
  END LOOP;

  -- Comme une vraie synchro : accords newsletter rapportés par Shotgun → registre.
  PERFORM public.ticketing_after_sync(v_conn);
  PERFORM public.ticketing_refresh_stats(v_conn);
  PERFORM public.refresh_contact_engagement(NULL, v_uid);
  RAISE NOTICE 'guest list démo : % lignes effacées, % invitations, % inscriptions gratuites, % venus',
    v_removed,
    (SELECT count(*) FROM public.external_tickets WHERE connection_id = v_conn AND external_id LIKE '%-gl-%' AND raw->>'deal_channel' = 'invitation'),
    (SELECT count(*) FROM public.external_tickets WHERE connection_id = v_conn AND external_id LIKE '%-gl-f-%'),
    (SELECT count(*) FROM public.external_tickets WHERE connection_id = v_conn AND external_id LIKE '%-gl-%' AND scanned_at IS NOT NULL);
END
$seed$;
