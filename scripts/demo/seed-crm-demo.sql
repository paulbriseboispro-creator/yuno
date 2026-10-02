-- ============================================================================
-- Démo Yuno CRM : crm@womber.fr (organisateur, produit « crm »).
-- Rejouable : efface puis recrée SA connexion fictive (external_org_id
-- 'demo-crm'), ses soirées et ses billets. Aucune donnée réelle : acheteurs
-- @example.com, noms tirés de listes. La connexion n'a PAS de jeton : elle
-- n'est jamais réclamée par le cron (claim exige vault_secret_id).
-- Prérequis : node scripts/demo/create-crm-account.mjs
--   supabase db query --linked -f scripts/demo/seed-crm-demo.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_conn uuid;
  v_ev record;
  v_i integer;
  v_n integer;
  v_buyer integer;
  v_d integer;
  v_deal record;
  v_first text[] := ARRAY['Léa','Hugo','Inès','Lucas','Chloé','Nathan','Manon','Théo','Camille','Louis','Sarah','Jules','Emma','Adam','Lina','Noah','Zoé','Rayan','Jade','Maël','Alice','Sacha','Nina','Enzo','Lou','Yanis','Maya','Tom','Eva','Malo'];
  v_last text[] := ARRAY['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez','Legrand'];
  v_cities text[] := ARRAY['Paris','Paris','Paris','Paris','Paris','Montreuil','Saint-Denis','Boulogne-Billancourt','Vincennes','Pantin','Lyon','Lille'];
  v_titles text[] := ARRAY['Warehouse Session','Nuit Sonore','Afro House Club','Techno Bunker','Disco Fever','Open Air Closing','Rooftop Sunset','Deep Night','Bass Culture','Minimal Room','House Nation'];
  v_genres text[] := ARRAY['techno','house','afro_house','disco','techno','house','house','deep_house','drum_and_bass','minimal','house'];
  v_start timestamptz;
  v_covers text[] := ARRAY[
    'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/1781542670364-poster.jpg',
    'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/recurring-1784538118470-poster.jpg',
    'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/recurring-1784536410680-poster.jpg',
    'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/event-images/events/recurring-1784535694547-poster.jpg'];
  v_k integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM setseed(0.42);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;

  -- Identité : organisateur en produit CRM.
  UPDATE public.profiles SET profile_type = 'organizer', first_name = 'Démo', last_name = 'CRM',
         organization_name = 'Nuits Démo', city = 'Paris'
   WHERE id = v_uid;
  INSERT INTO public.organizer_profiles (user_id, display_name, city, product)
  VALUES (v_uid, 'Nuits Démo', 'Paris', 'crm')
  ON CONFLICT (user_id) DO UPDATE SET product = 'crm', display_name = 'Nuits Démo';
  INSERT INTO public.user_roles (user_id, role, email) VALUES (v_uid, 'organizer'::public.app_role, 'crm@womber.fr')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- On repart de zéro (le trigger efface aussi les soirées miroir).
  DELETE FROM public.ticketing_connections WHERE organizer_user_id = v_uid;
  DELETE FROM public.newsletter_subscriptions WHERE organizer_user_id = v_uid AND source = 'connector:shotgun';

  INSERT INTO public.ticketing_connections (organizer_user_id, provider, external_org_id, external_org_name, status,
         initial_import_done_at, last_ok_at, events_synced_at, next_sync_at, created_by)
  VALUES (v_uid, 'shotgun', 'demo-crm', 'Nuits Démo', 'active', now() - interval '20 days', now() - interval '12 minutes',
          now() - interval '12 minutes', now() + interval '1 year', v_uid)
  RETURNING id INTO v_conn;

  -- 10 soirées passées (un samedi sur deux) + 3 à venir.
  FOR v_k IN -10..2 LOOP
    v_start := (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '5 days 23 hours' + (v_k * 2 + CASE WHEN v_k >= 0 THEN 1 ELSE 0 END) * interval '7 days') AT TIME ZONE 'Europe/Paris';
    INSERT INTO public.external_events (connection_id, organizer_user_id, provider, external_id, name, slug, url,
           start_at, end_at, timezone, cover_url, street, city, zip_code, country_code, genres, artists, deals,
           left_tickets, published_at, launched_at, external_role, type_of_place)
    VALUES (v_conn, v_uid, 'shotgun', 'demo-' || (v_k + 20), v_titles[1 + ((v_k + 20) % array_length(v_titles, 1))] || ' #' || (v_k + 20),
           'demo-night-' || (v_k + 20), 'https://shotgun.live/events/demo-night-' || (v_k + 20),
           v_start, v_start + interval '6 hours', 'Europe/Paris',
           v_covers[1 + ((v_k + 20) % 4)],
           '12 rue de la Nuit', 'Paris', '75011', 'FR',
           ARRAY[v_genres[1 + ((v_k + 20) % array_length(v_genres, 1))]],
           jsonb_build_array(jsonb_build_object('name', 'DJ ' || v_first[1 + ((v_k + 25) % 30)]), jsonb_build_object('name', v_last[1 + ((v_k + 27) % 30)] || ' b2b ' || v_last[1 + ((v_k + 31) % 30)])),
           '[{"name":"Early bird","price":12,"visibility":"public","sales_channel":"online"},{"name":"Regular","price":16,"visibility":"public","sales_channel":"online"},{"name":"Late","price":20,"visibility":"public","sales_channel":"online"},{"name":"Table VIP (6 pers.)","price":180,"visibility":"public","sales_channel":"online"}]'::jsonb,
           CASE WHEN v_k >= 0 THEN 400 END,
           v_start - interval '30 days', v_start - interval '24 days', 'organizer', 'club');
  END LOOP;

  -- Billets : un vivier de 900 acheteurs, les habitués achètent plus souvent.
  FOR v_ev IN SELECT * FROM public.external_events WHERE connection_id = v_conn ORDER BY start_at LOOP
    v_n := CASE WHEN v_ev.start_at > now() THEN 40 + floor(random() * 90)::int ELSE 140 + floor(random() * 140)::int END;
    FOR v_i IN 1..v_n LOOP
      v_buyer := floor(power(random(), 1.7) * 900)::int;
      -- Les achats se pressent à l'approche de la soirée (J-21 → J-0).
      v_d := floor(power(random(), 2.2) * 22)::int;
      IF v_ev.start_at > now() THEN
        v_d := v_d + GREATEST(0, (v_ev.start_at::date - now()::date));
      END IF;
      SELECT * INTO v_deal FROM (VALUES ('Early bird', 12), ('Regular', 16), ('Late', 20), ('Table VIP (6 pers.)', 180)) AS d(name, price)
       ORDER BY CASE WHEN v_d > 14 THEN (d.price = 12)::int WHEN v_d > 4 THEN (d.price = 16)::int ELSE (d.price = 20)::int END DESC,
                (d.price = 180 AND random() < 0.03)::int DESC, random()
       LIMIT 1;
      INSERT INTO public.external_tickets (connection_id, organizer_user_id, provider, external_id, external_order_id, external_event_id,
             deal_id, deal_name, status, raw_status, quantity, price, fees, currency,
             buyer_email, buyer_first_name, buyer_last_name, buyer_phone, newsletter_optin, age, gender, city, zip_code, country_code,
             purchased_at, scanned_at, source_updated_at, utm)
      VALUES (v_conn, v_uid, 'shotgun', v_ev.external_id || '-' || v_i, v_ev.external_id || '-o' || v_i, v_ev.external_id,
             md5(v_deal.name), v_deal.name,
             CASE WHEN random() < 0.03 THEN 'refunded' ELSE 'valid' END, 'valid', 1, v_deal.price, round((v_deal.price * 0.08)::numeric, 2), 'EUR',
             lower(v_first[1 + (v_buyer % 30)] || '.' || v_last[1 + ((v_buyer / 30) % 30)] || '.' || v_buyer) || '@example.com',
             v_first[1 + (v_buyer % 30)], v_last[1 + ((v_buyer / 30) % 30)], NULL,
             (abs(hashtext('optin' || v_buyer)) % 100) < 55,
             CASE WHEN (abs(hashtext('age' || v_buyer)) % 10) < 7 THEN 19 + abs(hashtext('a' || v_buyer)) % 18 END,
             CASE WHEN (abs(hashtext('g' || v_buyer)) % 10) < 7 THEN CASE WHEN abs(hashtext('gg' || v_buyer)) % 2 = 0 THEN 'female' ELSE 'male' END END,
             CASE WHEN (abs(hashtext('c' || v_buyer)) % 10) < 8 THEN v_cities[1 + abs(hashtext('cc' || v_buyer)) % array_length(v_cities, 1)] END,
             NULL, 'FR',
             LEAST(v_ev.start_at - make_interval(days => v_d) - make_interval(hours => floor(random() * 12)::int), now() - make_interval(mins => 5 + floor(random() * 2000)::int)),
             CASE WHEN v_ev.start_at < now() AND random() < 0.84 THEN v_ev.start_at + make_interval(mins => floor(random() * 240)::int) END,
             now(),
             CASE WHEN random() < 0.33 THEN '{"utm_source":"instagram","utm_medium":"social"}'::jsonb
                  WHEN random() < 0.18 THEN '{"utm_source":"yuno","utm_medium":"email"}'::jsonb
                  WHEN random() < 0.12 THEN '{"utm_source":"tiktok","utm_medium":"social"}'::jsonb END);
    END LOOP;
    IF v_ev.start_at > now() THEN
      UPDATE public.external_events SET left_tickets = GREATEST(0, 400 - v_n) WHERE id = v_ev.id;
    END IF;
  END LOOP;

  PERFORM public.ticketing_after_sync(v_conn);
  PERFORM public.ticketing_refresh_stats(v_conn);
  -- Offre : Pro accordé pour un an (sans Stripe). Sans ça l'essai de 14 jours
  -- finirait en Gratuit et le balayage horaire éteindrait les automatisations.
  INSERT INTO public.crm_subscriptions (scope_key, organizer_user_id, plan, status, current_period_end)
  VALUES ('org:' || v_uid::text, v_uid, 'pro', 'active', now() + interval '1 year')
  ON CONFLICT (scope_key) DO UPDATE SET plan = 'pro', status = 'active', trial_ends_at = NULL,
    stripe_subscription_id = NULL, current_period_end = now() + interval '1 year', updated_at = now();
  PERFORM public.crm_sync_scope('org:' || v_uid::text);
  -- Engagement de la base (sinon Clients affiche « cliquez sur Actualiser »).
  PERFORM public.refresh_contact_engagement(NULL, v_uid);
  RAISE NOTICE 'démo CRM : %', (SELECT stats FROM public.ticketing_connections WHERE id = v_conn);
END
$seed$;
