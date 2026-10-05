-- ============================================================================
-- Démo Yuno CRM : tout ce que les autres semis ne couvrent pas, pour que
-- CHAQUE écran de la Console de crm@womber.fr montre un compte vivant :
--   1. réglages d'envoi (expéditeur, adresse postale, heures calmes)
--   2. pages d'inscription (visites, inscrits, confirmés, dont ce matin)
--   3. imports de fichiers (historique « Derniers ajouts »)
--   4. segments à moi + leur historique de taille
--   5. Yunits : abonnement, recharge, dépenses réelles de chaque envoi,
--      expirations des mois passés
--   6. équipe, Instagram (brouillons : l'App Review Meta n'est pas accordée),
--      NPS déjà répondu (pas de fenêtre qui surgit pendant un call)
--   7. engagement de la base recalculé
-- Rejouable : n'efface que ce qu'il a semé (marqueur « crm-extras »).
-- À lancer APRÈS les autres semis (refresh-crm-demo.sh le fait).
-- Aucun envoi réel : rien ici n'appelle un moteur d'envoi.
-- ============================================================================

DO $seed$
DECLARE
  v_uid uuid;
  v_scope text;
  v_first text[] := ARRAY['Léa','Hugo','Inès','Lucas','Chloé','Nathan','Manon','Théo','Camille','Louis','Sarah','Jules','Emma','Adam','Lina','Noah','Zoé','Rayan','Jade','Maël','Alice','Sacha','Nina','Enzo','Lou','Yanis','Maya','Tom','Eva','Malo'];
  v_last text[] := ARRAY['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Mercier','Dupont','Lambert','Bonnet','Francois','Martinez','Legrand'];
  v_cities text[] := ARRAY['Paris','Paris','Paris','Paris','Montreuil','Saint-Denis','Boulogne-Billancourt','Vincennes','Pantin','Lyon','Lille'];
  v_srcs text[] := ARRAY['instagram-bio','instagram-story','instagram-bio','flyer-qr','tiktok-bio','direct','instagram-story','whatsapp'];
  r record;
  p record;
  v_page uuid;
  v_cli uuid;
  v_eli uuid;
  v_i integer;
  v_n integer;
  v_at timestamptz;
  v_email text;
  v_fn text;
  v_ln text;
  v_conf boolean;
  v_ev uuid;
  v_ticket_emails text[];
  v_lot_m uuid;
  v_lot_p uuid;
  v_left_m integer;
  v_left_p integer;
  v_cost integer;
  v_month timestamptz;
  v_mlot jsonb := '{}'::jsonb;
  m record;
  lt record;
  v_used integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM setseed(0.37);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  IF NOT public.is_demo_email('crm@womber.fr') THEN RAISE EXCEPTION 'périmètre démo introuvable'; END IF;
  v_scope := 'org:' || v_uid::text;
  SELECT array_agg(DISTINCT lower(buyer_email)) INTO v_ticket_emails
    FROM (SELECT buyer_email FROM public.external_tickets WHERE organizer_user_id = v_uid LIMIT 400) q;

  -- ── 1. Réglages d'envoi ────────────────────────────────────────────────
  INSERT INTO public.crm_email_settings (scope_key, organizer_user_id, sender_name, reply_to, postal_address, quiet_hours, waves, notify_done, test_emails, updated_by)
  VALUES (v_scope, v_uid, 'Nuits Démo', 'contact@nuitsdemo.example', '12 rue de la Nuit, 75011 Paris', true, true, true, ARRAY['crm@womber.fr'], v_uid)
  ON CONFLICT (scope_key) DO UPDATE SET sender_name = EXCLUDED.sender_name, reply_to = EXCLUDED.reply_to,
    postal_address = EXCLUDED.postal_address, quiet_hours = true, waves = true, notify_done = true,
    test_emails = EXCLUDED.test_emails, updated_at = now();
  INSERT INTO public.crm_settings (scope_key, organizer_user_id, regular_min_nights, regular_window_months, lapse_months, night_end_hour, retention_months, business_type, updated_by)
  VALUES (v_scope, v_uid, 3, 6, 3, 6, 36, 'organizer', v_uid)
  ON CONFLICT (scope_key) DO NOTHING;

  -- ── 2. Pages d'inscription ─────────────────────────────────────────────
  -- Nettoyage de ce qu'on a semé (la page « Minimal Room #20 » reste : elle est
  -- à nous aussi, on lui ajoute juste du monde).
  DELETE FROM public.crm_signup_entries WHERE answers->>'seed' = 'crm-extras'
     AND page_id IN (SELECT id FROM public.crm_signup_pages WHERE organizer_user_id = v_uid);
  DELETE FROM public.imported_contacts WHERE organizer_user_id = v_uid AND extra->>'seed' = 'crm-extras';
  DELETE FROM public.newsletter_subscriptions WHERE organizer_user_id = v_uid AND source IN ('signup_page_seed', 'import_seed');
  DELETE FROM public.crm_signup_visits WHERE page_id IN (SELECT id FROM public.crm_signup_pages WHERE organizer_user_id = v_uid);
  DELETE FROM public.crm_signup_pages WHERE organizer_user_id = v_uid AND slug IN ('house-nation-21', 'la-liste-nuits-demo', 'bass-culture-19');
  DELETE FROM public.contact_list_imports WHERE organizer_user_id = v_uid AND filename LIKE 'seed:crm-extras:%';
  DELETE FROM public.email_list_imports WHERE organizer_user_id = v_uid AND filename LIKE 'seed:crm-extras:%';

  SELECT id INTO v_ev FROM public.events WHERE organizer_user_id = v_uid AND title = 'Minimal Room #20' ORDER BY start_at LIMIT 1;
  UPDATE public.crm_signup_pages SET event_id = COALESCE(event_id, v_ev), published_at = LEAST(published_at, now() - interval '19 days'),
         created_at = LEAST(created_at, now() - interval '20 days')
   WHERE organizer_user_id = v_uid AND slug = 'minimal-room-20';

  -- Trois pages de plus : une soirée en vente, la communauté, une soirée passée (fermée).
  FOR p IN SELECT * FROM (VALUES
    ('house-nation-21', 'House Nation #21', 'House Nation #21 — la prévente arrive. Laisse ton contact, tu es prévenu avant tout le monde.', 'prevente', 'night', 'live', 'House Nation #21', 'sale', 12, 96, 118, 520),
    ('la-liste-nuits-demo', 'La liste Nuits Démo', 'Rejoins la liste : line-ups, préventes et soirées surprises, avant tout le monde.', 'communaute', 'community', 'live', NULL, 'never', 48, 118, 150, 1260),
    ('bass-culture-19', 'Bass Culture #19', 'La prévente est passée, la soirée aussi. Prochaine date : rejoins la liste.', 'prevente', 'night', 'closed', 'Bass Culture #19', 'sale', 40, 90, 112, 410)
  ) AS x(slug, title, tagline, kind, occasion, status, ev_title, closes, started_days_ago, confirmed, signed, visits)
  LOOP
    INSERT INTO public.email_list_imports (organizer_user_id, filename, consent_source, consent_details, attested_by, attested_at, created_at, list_name,
                                           submitted_count, inserted_count)
    VALUES (v_uid, 'seed:crm-extras:email:' || p.slug, 'website_form',
            'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée et adresse confirmée par lien', v_uid,
            now() - make_interval(days => p.started_days_ago), now() - make_interval(days => p.started_days_ago), 'Page · ' || p.title, p.signed, p.confirmed)
    RETURNING id INTO v_eli;
    INSERT INTO public.contact_list_imports (organizer_user_id, email_import_id, list_name, filename, consent_source, consent_details, channels,
                                             row_count, email_count, phone_count, both_count, attested_by, attested_at, created_at)
    VALUES (v_uid, v_eli, 'Page · ' || p.title, 'seed:crm-extras:page:' || p.slug, 'website_form',
            'Page d’inscription Yuno /j/' || p.slug || ' : case d’accord cochée (adresse confirmée par lien, téléphone saisi par le fan)',
            '{"email": true, "sms": false}'::jsonb, p.confirmed, p.confirmed, 0, 0, v_uid,
            now() - make_interval(days => p.started_days_ago), now() - make_interval(days => p.started_days_ago))
    RETURNING id INTO v_cli;
    INSERT INTO public.crm_signup_pages (organizer_user_id, slug, status, occasion, event_id, title, tagline, button_label, thanks_message,
           design, fields, countdown, closes_mode, relance, kind, lang, contact_import_id, email_import_id, published_at, created_by, created_at, updated_at, show_count)
    VALUES (v_uid, p.slug, p.status, p.occasion,
            (SELECT id FROM public.events WHERE organizer_user_id = v_uid AND title = p.ev_title ORDER BY start_at LIMIT 1),
            p.title, p.tagline, 'Je m’inscris', 'Merci ! Confirme ton adresse par e-mail : tu es sur la liste.',
            '{"tpl":"brutal","pal":"p0","acc":"","bg":"","font":"","migrated":true}'::jsonb,
            '{"contact":"both","extra":{"insta":{"on":true,"req":false}},"questions":[{"label":"Ton style de musique ?","multi":true,"options":["Techno","House","Disco","Autre"]}]}'::jsonb,
            p.status = 'live' AND p.kind = 'prevente', p.closes, '{}'::jsonb, p.kind, 'fr', v_cli, v_eli,
            now() - make_interval(days => p.started_days_ago), v_uid,
            now() - make_interval(days => p.started_days_ago + 1), now() - interval '2 hours', true);
  END LOOP;

  -- Visites, inscrits, confirmés : par page, étalés depuis la publication, plus denses
  -- les derniers jours (une page vit quand on l'annonce).
  FOR p IN
    SELECT sp.id, sp.slug, sp.contact_import_id AS cli, sp.email_import_id AS eli, sp.published_at,
           CASE sp.slug WHEN 'minimal-room-20' THEN 840 WHEN 'house-nation-21' THEN 520 WHEN 'la-liste-nuits-demo' THEN 1260 ELSE 410 END AS visits,
           CASE sp.slug WHEN 'minimal-room-20' THEN 214 WHEN 'house-nation-21' THEN 118 WHEN 'la-liste-nuits-demo' THEN 150 ELSE 112 END AS signed,
           CASE sp.slug WHEN 'minimal-room-20' THEN 171 WHEN 'house-nation-21' THEN 96 WHEN 'la-liste-nuits-demo' THEN 118 ELSE 90 END AS confirmed,
           sp.status
      FROM public.crm_signup_pages sp
     WHERE sp.organizer_user_id = v_uid AND sp.slug IN ('minimal-room-20', 'house-nation-21', 'la-liste-nuits-demo', 'bass-culture-19')
  LOOP
    -- visites (une par personne et par jour)
    INSERT INTO public.crm_signup_visits (page_id, day, visitor_hash, src, at)
    SELECT p.id, (t.at AT TIME ZONE 'Europe/Paris')::date, md5(p.slug || 'v' || g), v_srcs[1 + (g % array_length(v_srcs, 1))], t.at
      FROM generate_series(1, p.visits) g
      CROSS JOIN LATERAL (SELECT LEAST(now() - make_interval(mins => 5 + (g * 7) % 120),
               p.published_at + (CASE WHEN p.status = 'closed' THEN interval '30 days' ELSE now() - p.published_at END)
                 * power(random(), 0.55)) AS at) t
    ON CONFLICT DO NOTHING;

    -- inscrits : les premiers confirment (la plupart), les derniers attendent le lien
    FOR v_i IN 1..p.signed LOOP
      v_fn := v_first[1 + floor(random() * 30)::int];
      v_ln := v_last[1 + floor(random() * 30)::int];
      v_email := translate(lower(v_fn || '.' || v_ln || '.' || p.slug || '.' || v_i), 'éèêëàâäîïôöùûüçœ', 'eeeeaaaiioouuuco') || '@example.com';
      -- Un inscrit sur sept est déjà client (acheteur Shotgun).
      IF v_i % 7 = 0 AND v_ticket_emails IS NOT NULL THEN
        v_email := v_ticket_emails[1 + (v_i * 13) % array_length(v_ticket_emails, 1)];
      END IF;
      v_at := LEAST(now() - make_interval(mins => 3 + floor(random() * 60)::int),
                    p.published_at + (CASE WHEN p.status = 'closed' THEN interval '30 days' ELSE now() - p.published_at END) * power(random(), 0.6));
      -- Six confirmations d'aujourd'hui sur la page de la prochaine soirée, trois sur la liste générale.
      IF (p.slug = 'minimal-room-20' AND v_i <= 6) OR (p.slug = 'la-liste-nuits-demo' AND v_i <= 3) THEN
        v_at := now() - make_interval(mins => 20 + v_i * 47);
      END IF;
      v_conf := v_i <= p.confirmed OR (p.slug IN ('minimal-room-20') AND v_i <= 6);
      IF v_i > p.confirmed AND v_i > 6 THEN v_conf := false; END IF;
      INSERT INTO public.crm_signup_entries (page_id, first_name, last_name, email, answers, src, lang, consent_text, visitor_hash,
             confirm_sent_at, confirmed_at, subscribed, created_at, city, was_known, instagram)
      VALUES (p.id, v_fn, v_ln, v_email,
              jsonb_build_object('seed', 'crm-extras', 'q0', CASE v_i % 4 WHEN 0 THEN 'Techno' WHEN 1 THEN 'House' WHEN 2 THEN 'Techno' ELSE 'Disco' END),
              v_srcs[1 + (v_i % array_length(v_srcs, 1))], 'fr',
              'J’accepte de recevoir les e-mails de Nuits Démo.', md5(p.slug || 'e' || v_i),
              v_at + interval '1 minute', CASE WHEN v_conf THEN v_at + make_interval(mins => 2 + (v_i % 40)) END, v_conf, v_at,
              v_cities[1 + (v_i % array_length(v_cities, 1))], v_i % 7 = 0,
              CASE WHEN v_i % 3 = 0 THEN '@' || lower(v_fn) || v_i END)
      ON CONFLICT (page_id, lower(email)) DO NOTHING;
      IF v_conf THEN
        INSERT INTO public.imported_contacts (list_import_id, organizer_user_id, email, first_name, last_name, city, newsletter_opt_in, added_at, extra)
        VALUES (p.cli, v_uid, v_email, v_fn, v_ln, v_cities[1 + (v_i % array_length(v_cities, 1))], true,
                v_at + make_interval(mins => 2 + (v_i % 40)), jsonb_build_object('seed', 'crm-extras', 'signup_page', p.id))
        ON CONFLICT DO NOTHING;
        INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name)
        VALUES (v_uid, v_email, true, 'signup_page_seed', p.eli, 'website_form', v_at, v_fn)
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  -- ── 3. Imports de fichiers (historique « Derniers ajouts ») ────────────
  FOR r IN SELECT * FROM (VALUES
    ('Guest list Instagram · été 2026', 'guestlist-ete-2026.csv', 163, 142, 14, 5, 2, 41, 'file'),
    ('Ancienne billetterie · base 2025', 'export-billetterie-2025.xlsx', 232, 201, 25, 4, 2, 23, 'file'),
    ('Ajout manuel · invités VIP', NULL, 4, 4, 0, 0, 0, 9, 'manual')
  ) AS x(name, fname, total, new_n, exist_n, dup_n, bad_n, days_ago, kind)
  LOOP
    v_at := now() - make_interval(days => r.days_ago, hours => 3);
    INSERT INTO public.email_list_imports (organizer_user_id, filename, consent_source, consent_details, attested_by, attested_at, created_at, list_name,
                                           submitted_count, inserted_count, duplicate_count, invalid_count)
    VALUES (v_uid, 'seed:crm-extras:email:' || r.name, CASE WHEN r.kind = 'manual' THEN 'in_person' ELSE 'website_form' END,
            'Fichier collecté lors de soirées passées, accord e-mail recueilli à l’inscription', v_uid, v_at, v_at, r.name,
            r.total, r.new_n, r.dup_n, r.bad_n)
    RETURNING id INTO v_eli;
    INSERT INTO public.contact_list_imports (organizer_user_id, email_import_id, list_name, filename, consent_source, consent_details, channels,
                                             row_count, email_count, phone_count, both_count, attested_by, attested_at, created_at)
    VALUES (v_uid, v_eli, r.name, 'seed:crm-extras:file:' || r.name, CASE WHEN r.kind = 'manual' THEN 'in_person' ELSE 'website_form' END,
            'Fichier collecté lors de soirées passées, accord e-mail recueilli à l’inscription', '{"email": true, "sms": false}'::jsonb,
            r.total, r.total - r.bad_n, 0, 0, v_uid, v_at, v_at)
    RETURNING id INTO v_cli;
    INSERT INTO public.crm_imports (list_import_id, scope_key, organizer_user_id, kind, title, consent, mode, new_count, existing_count, file_dup_count, bad_count,
                                    status, created_by, created_at, finished_at)
    VALUES (v_cli, v_scope, v_uid, r.kind, r.name, 'yes', 'complete', r.new_n, r.exist_n, r.dup_n, r.bad_n, 'done', v_uid, v_at, v_at + interval '40 seconds')
    ON CONFLICT DO NOTHING;
    FOR v_i IN 1..r.new_n LOOP
      v_fn := v_first[1 + floor(random() * 30)::int];
      v_ln := v_last[1 + floor(random() * 30)::int];
      v_email := translate(lower(v_fn || '.' || v_ln || '.imp' || r.days_ago || '.' || v_i), 'éèêëàâäîïôöùûüçœ', 'eeeeaaaiioouuuco') || '@example.com';
      INSERT INTO public.imported_contacts (list_import_id, organizer_user_id, email, first_name, last_name, city, newsletter_opt_in, added_at, extra)
      VALUES (v_cli, v_uid, v_email, v_fn, v_ln, v_cities[1 + (v_i % array_length(v_cities, 1))], true, v_at, jsonb_build_object('seed', 'crm-extras'))
      ON CONFLICT DO NOTHING;
      IF v_i % 10 < 8 THEN
        INSERT INTO public.newsletter_subscriptions (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at, first_name)
        VALUES (v_uid, v_email, true, 'import_seed', v_eli, 'website_form', v_at, v_fn)
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  -- ── 4. Segments à moi ──────────────────────────────────────────────────
  DELETE FROM public.crm_segments WHERE scope_key = v_scope;
  INSERT INTO public.crm_segments (scope_key, organizer_user_id, name, description, template, definition, created_by, created_at, updated_at)
  VALUES
    (v_scope, v_uid, 'Gros dépensiers', 'Plus de 200 € dépensés chez vous.', 'vip', '{"seg":"all","f":{"sp":"200+"}}', v_uid, now() - interval '52 days', now() - interval '52 days'),
    (v_scope, v_uid, 'Habitués qui s’éloignent', 'Venus souvent, rien depuis plus de 60 jours.', 'loin', '{"seg":"hab","f":{"last_gt_days":60}}', v_uid, now() - interval '47 days', now() - interval '47 days'),
    (v_scope, v_uid, 'Une seule soirée', 'Venus une fois, plus de nouvelles depuis 30 jours.', 'once', '{"seg":"all","f":{"nb":"1","last_gt_days":30}}', v_uid, now() - interval '40 days', now() - interval '40 days'),
    (v_scope, v_uid, 'Clients du dernier mois', 'Un achat ou une venue ces 30 derniers jours.', 'recent', '{"seg":"all","f":{"last":"0-30"}}', v_uid, now() - interval '33 days', now() - interval '33 days'),
    (v_scope, v_uid, 'Cliquent sans acheter', 'Ont cliqué un e-mail sans acheter sous 7 jours.', 'clicked_no_buy', '{"seg":"all","f":{"msg":"clicked_no_buy"}}', v_uid, now() - interval '26 days', now() - interval '26 days'),
    (v_scope, v_uid, 'Joignables par SMS', 'Clients dont on a le numéro et l’accord.', 'sms', '{"seg":"all","f":{"rc":["sms"]}}', v_uid, now() - interval '19 days', now() - interval '19 days');

  -- ── 5. Yunits ──────────────────────────────────────────────────────────
  -- Grand livre refait de zéro : trois mois inclus déjà expirés, le mois en cours,
  -- une recharge au curseur (25 000 + 10 % offerts) et chaque envoi débité.
  DELETE FROM public.crm_yunit_moves WHERE scope_key = v_scope;
  DELETE FROM public.crm_yunit_lots WHERE scope_key = v_scope;
  FOR m IN SELECT g FROM generate_series(3, 0, -1) g LOOP
    v_month := date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' - make_interval(months => m.g);
    IF m.g = 0 THEN
      -- Le mois en cours est celui du MOTEUR (crm_yunits_ensure_allowance, la même
      -- clé que le balayage horaire) : un lot posé à la main s'ajouterait au sien.
      PERFORM public.crm_yunits_ensure_allowance(v_scope);
      SELECT id INTO v_lot_m FROM public.crm_yunit_lots
       WHERE scope_key = v_scope AND kind = 'monthly' AND source_ref LIKE 'monthly:%' ORDER BY created_at DESC LIMIT 1;
      UPDATE public.crm_yunit_lots SET created_at = v_month WHERE id = v_lot_m;
      UPDATE public.crm_yunit_moves SET at = v_month + interval '5 minutes' WHERE scope_key = v_scope AND ref_id = v_lot_m::text AND kind = 'credit';
    ELSE
      INSERT INTO public.crm_yunit_lots (scope_key, organizer_user_id, kind, amount, remaining, expires_at, source_ref, label, created_at)
      VALUES (v_scope, v_uid, 'monthly', 10000, 10000, v_month + interval '1 month', 'seed-monthly-' || m.g, 'Inclus dans l’abonnement', v_month)
      RETURNING id INTO v_lot_m;
      INSERT INTO public.crm_yunit_moves (scope_key, organizer_user_id, at, delta, kind, lot_kind, ref_type, ref_id, label, meta)
      VALUES (v_scope, v_uid, v_month + interval '5 minutes', 10000, 'credit', 'monthly', 'lot', v_lot_m::text, 'Inclus dans l’abonnement',
              jsonb_build_object('expires_at', v_month + interval '1 month'));
    END IF;
    v_mlot := v_mlot || jsonb_build_object(m.g::text, v_lot_m::text);
  END LOOP;

  -- Une recharge au curseur : 25 000 Yunits (+10 % offerts) il y a 17 jours.
  FOR r IN SELECT * FROM (VALUES (17, 25000, 27500, 50.00 * 1.2)) AS x(days_ago, base, total, ttc) LOOP
    INSERT INTO public.crm_yunit_lots (scope_key, organizer_user_id, kind, amount, remaining, expires_at, source_ref, label, created_at)
    VALUES (v_scope, v_uid, 'purchase', r.total, r.total, now() - make_interval(days => r.days_ago) + interval '1 year', 'seed-purchase-' || r.days_ago, 'Recharge',
            now() - make_interval(days => r.days_ago))
    RETURNING id INTO v_lot_p;
    INSERT INTO public.crm_yunit_moves (scope_key, organizer_user_id, at, delta, kind, lot_kind, ref_type, ref_id, label, meta)
    VALUES (v_scope, v_uid, now() - make_interval(days => r.days_ago), r.total, 'credit', 'purchase', 'lot', v_lot_p::text, 'Recharge',
            jsonb_build_object('base', r.base, 'amount_total', round(r.ttc * 100), 'session_id', 'demo'));
  END LOOP;

  -- Dépenses : un débit par e-mail parti (les SMS, affichés « Bientôt » en production,
  -- ne débitent rien), daté de l'envoi, pris sur le lot du mois
  -- (qui s'éteint le premier), puis sur la recharge.
  FOR r IN
    SELECT * FROM (
      SELECT c.sent_at AS at, 'email' AS channel, 'email_campaign' AS ref_type, c.id::text AS ref_id, c.name,
             (SELECT count(*) FROM public.email_campaign_recipients x WHERE x.campaign_id = c.id AND x.status = 'sent')::int AS cost
        FROM public.email_campaigns c
       WHERE c.organizer_user_id = v_uid AND c.venue_id IS NULL AND c.status = 'sent' AND c.sent_at IS NOT NULL
    ) q WHERE q.cost > 0 ORDER BY q.at
  LOOP
    v_cost := r.cost;
    -- mois de l'envoi → lot mensuel correspondant (0 = ce mois-ci)
    SELECT g INTO v_i FROM generate_series(0, 3) g
     WHERE r.at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' - make_interval(months => g)
     ORDER BY g LIMIT 1;
    IF v_i IS NULL THEN CONTINUE; END IF;
    v_lot_m := (v_mlot->>(v_i::text))::uuid;
    SELECT remaining INTO v_left_m FROM public.crm_yunit_lots WHERE id = v_lot_m;
    v_used := LEAST(v_left_m, v_cost);
    UPDATE public.crm_yunit_lots SET remaining = remaining - v_used WHERE id = v_lot_m;
    v_left_m := v_cost - v_used;
    -- Le reste se prend sur la recharge la plus ancienne déjà arrivée.
    FOR lt IN SELECT id, remaining FROM public.crm_yunit_lots
              WHERE scope_key = v_scope AND kind IN ('purchase', 'grant') AND created_at <= r.at AND remaining > 0 ORDER BY expires_at LOOP
      EXIT WHEN v_left_m <= 0;
      v_used := LEAST(lt.remaining, v_left_m);
      UPDATE public.crm_yunit_lots SET remaining = remaining - v_used WHERE id = lt.id;
      v_left_m := v_left_m - v_used;
    END LOOP;
    v_cost := v_cost - v_left_m;
    IF v_cost <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.crm_yunit_moves (scope_key, organizer_user_id, at, delta, kind, channel, ref_type, ref_id, label)
    VALUES (v_scope, v_uid, r.at, -v_cost, 'debit', r.channel, r.ref_type, r.ref_id, r.name);
  END LOOP;

  -- Ce qui n'a pas servi dans les mois passés s'est éteint (lignes « expirés »).
  FOR r IN SELECT l.id, l.remaining, l.expires_at FROM public.crm_yunit_lots l
            WHERE l.scope_key = v_scope AND l.kind = 'monthly' AND l.expires_at <= now() AND l.remaining > 0 LOOP
    INSERT INTO public.crm_yunit_moves (scope_key, organizer_user_id, at, delta, kind, lot_kind, ref_type, ref_id, label)
    VALUES (v_scope, v_uid, r.expires_at, -r.remaining, 'expire', 'monthly', 'lot', r.id::text, 'Yunits du mois expirés');
  END LOOP;

  -- ── 6. Équipe, Instagram, NPS ──────────────────────────────────────────
  -- Brouillons laissés par un essai à la main : un compte démo repart propre.
  DELETE FROM public.email_campaigns
   WHERE organizer_user_id = v_uid AND venue_id IS NULL AND status = 'draft' AND theme_json->>'seed' IS NULL;
  DELETE FROM public.sms_campaigns
   WHERE organizer_id = v_uid AND venue_id IS NULL AND status = 'draft' AND segment_filters->>'seed' IS NULL;
  DELETE FROM public.org_members WHERE organizer_user_id = v_uid AND invitation_status = 'pending' AND member_email LIKE '%@nuitsdemo.example';
  INSERT INTO public.org_members (organizer_user_id, member_email, role, invited_by, invitation_status, expires_at, can_view_finance, can_export, created_at)
  VALUES (v_uid, 'camille@nuitsdemo.example', 'editor', v_uid, 'pending', now() + interval '5 days', false, true, now() - interval '2 days'),
         (v_uid, 'manager@nuitsdemo.example', 'admin', v_uid, 'pending', now() + interval '6 days', true, true, now() - interval '1 day');

  DELETE FROM public.crm_instagram_rules WHERE organizer_user_id = v_uid;
  INSERT INTO public.crm_instagram_rules (organizer_user_id, name, trigger, keyword, also_dm, also_story, dm_text, button_label, public_reply, reply_variants,
                                          destination, event_id, enabled, created_by, created_at, updated_at, post_types)
  VALUES
    (v_uid, 'Line-up Minimal Room #20', 'next_post', 'lineup', true, true,
     'Salut ! Voilà ta place pour Minimal Room #20, prévente en cours :', 'Prendre ma place', true,
     ARRAY['Envoyé en DM 🔥', 'C’est dans tes messages !', 'Je t’écris tout de suite'], 'tickets', v_ev, false, v_uid, now() - interval '3 days', now() - interval '3 days',
     ARRAY['reel','carousel','photo']),
    (v_uid, 'Liste d’attente House Nation #21', 'next_post', 'liste', true, false,
     'Merci ! Rejoins la liste pour être prévenu en premier :', 'Rejoindre la liste', true,
     ARRAY['Check tes DM ✉️'], 'signup_page', NULL, false, v_uid, now() - interval '2 days', now() - interval '2 days',
     ARRAY['reel','photo']);

  INSERT INTO public.crm_nps_responses (scope_key, user_id, quarter, score, comment, created_at)
  VALUES (v_scope, v_uid, extract(year FROM now())::int || '-Q' || extract(quarter FROM now())::int, 9,
          'Les rappels aux habitués nous ont fait gagner des soirées complètes.', now() - interval '12 days')
  ON CONFLICT DO NOTHING;

  -- ── 7. La base recalcule son engagement ───────────────────────────────
  PERFORM public._contact_base_cache_build(public.contact_base_scope_key(NULL, v_uid), NULL, v_uid, true);
  PERFORM public._crm_people_build(NULL, v_uid, NULL);
  PERFORM public.refresh_contact_engagement(NULL, v_uid);

  -- Destinataires des envois programmés (accueil : « prévu pour N contacts »).
  UPDATE public.email_campaigns c
     SET recipients_count = (SELECT count(*) FROM _cp WHERE email_ok AND lifecycle = 'hab')::int,
         total_recipients = (SELECT count(*) FROM _cp WHERE email_ok AND lifecycle = 'hab')::int
   WHERE c.organizer_user_id = v_uid AND c.status = 'scheduled' AND c.theme_json->>'seed' = 'crm-nights';
  -- Taille des segments sur 120 jours : l'écran Segments lit un instantané par
  -- nuit (crm_segment_counts). Sans historique, chaque segment annoncerait
  -- « +652 sur 30 jours ». On appelle d'abord la vue (elle écrit l'instantané du
  -- jour), puis on reconstitue les jours d'avant à partir de la taille actuelle.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM public.crm_segments_overview(NULL, v_uid, '30d');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  DELETE FROM public.crm_segment_counts WHERE scope_key = v_scope AND day < (now() AT TIME ZONE 'Europe/Paris')::date;
  INSERT INTO public.crm_segment_counts (scope_key, seg_key, day, n, reachable, computed_at)
  SELECT c.scope_key, c.seg_key, c.day - g,
         GREATEST(0, round(c.n * (1 - k.slope * g / 120.0 + 0.012 * sin(g / 4.0 + k.ph)))::int),
         GREATEST(0, round(c.reachable * (1 - k.slope * g / 120.0 + 0.012 * sin(g / 4.0 + k.ph)))::int),
         now()
    FROM public.crm_segment_counts c
    CROSS JOIN LATERAL (SELECT CASE c.seg_key WHEN 'hab' THEN 0.27 WHEN 'occ' THEN 0.10 WHEN 'end' THEN 0.40 WHEN 'nou' THEN 0.05 WHEN 'none' THEN 0.22
                                 ELSE ((abs(hashtext(c.seg_key)) % 36) + 4) / 100.0 END AS slope,
                               (abs(hashtext(c.seg_key)) % 6) AS ph) k
    CROSS JOIN generate_series(1, 120) g
   WHERE c.scope_key = v_scope AND c.day = (now() AT TIME ZONE 'Europe/Paris')::date
  ON CONFLICT DO NOTHING;

  -- Notifications : seules celles des deux derniers jours restent « non lues »
  -- (une cloche qui affiche 19 pastilles donne l'impression d'un compte négligé).
  DELETE FROM public.crm_notification_states WHERE scope_key = v_scope AND user_id = v_uid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM public.crm_notifications_mark(NULL, v_uid,
    COALESCE((SELECT array_agg(n->>'id') FROM jsonb_array_elements(public.get_crm_notifications(NULL, v_uid)) n
               WHERE (n->>'at')::timestamptz < now() - interval '40 hours' AND NOT (n->>'need')::boolean), ARRAY[]::text[]),
    'read', NULL);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  RAISE NOTICE 'extras démo CRM posés';
END
$seed$;
