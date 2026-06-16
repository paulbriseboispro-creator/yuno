-- ============================================================================
-- SEED DÉMO YUNO — club "Yuno" (owner@womber.fr) + orga "Yuno" + comptes liés
-- (promoteur, affilié, DJ, staff) avec GROS volumes fictifs, pour des dashboards
-- vivants et crédibles pendant les appels de vente.
--
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
-- Tourne sur la PROD. Idempotent : rejouable (teardown en tête puis re-seed).
--
-- IDENTIFIANTS (mdp commun YunoDemo2026!, PIN staff/DJ 123456) :
--   owner@womber.fr      -> club "Yuno"     (compte EXISTANT, on le remplit)
--   organizer@womber.fr  -> orga "Yuno"
--   promoter@womber.fr   -> promoteur (rattaché au club ET à l'orga)
--   dj@womber.fr         -> DJ (rattaché au club ET à l'orga)
--   affiliate@womber.fr  -> agence affiliée
--   bouncer@ / barman@ / cloakroom@womber.fr -> staff (club ET orga), PIN 123456
--
-- Le club est masqué du public (is_hidden) ; events non découvrables.
-- Si la création auth échoue sur ta version GoTrue : crée les 7 comptes à la
-- main (Auth > Add user > Auto Confirm, même mdp) puis relance.
-- ============================================================================

DROP TABLE IF EXISTS _ctx, _ev, _round, _aff_ev;

-- ----------------------------------------------------------------------------
-- ÉTAPE 1 — Identités, marque "Yuno", rattachements (staff/promoteur/DJ x2).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_pw         text := 'YunoDemo2026!';
  v_owner      uuid;
  v_venue      text;
  v_org        uuid;
  v_promo      uuid;
  v_aff        uuid;
  v_dj         uuid;
  v_promo_v    uuid;  -- promoters (scope club)
  v_promo_o    uuid;  -- promoters (scope orga)
  v_aff_id     uuid;  -- affiliates row
  v_dj_v       uuid;  -- djs (scope club)
  v_dj_o       uuid;  -- djs (scope orga)
  v_salt       text;
  v_pin        text;
  v_emails     text[] := ARRAY[
    'organizer@womber.fr','promoter@womber.fr','affiliate@womber.fr','dj@womber.fr',
    'bouncer@womber.fr','barman@womber.fr','cloakroom@womber.fr'];
  e            text;
  uid          uuid;
  rec          record;
BEGIN
  -- Owner (doit exister)
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner@womber.fr introuvable. Crée ce compte (Auth > Add user) puis relance.';
  END IF;

  -- Club "Yuno" : résoudre via owner_id / profiles.venue_id, sinon créer.
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN
    v_venue := 'yuno-demo';
    INSERT INTO venues (id, name, city, owner_id, is_hidden, menu_enabled, stripe_charges_enabled, created_at)
    VALUES (v_venue, 'Yuno', 'Paris', v_owner, true, true, true, now())
    ON CONFLICT (id) DO NOTHING;
  END IF;
  UPDATE venues SET owner_id = v_owner, name = 'Yuno', city = 'Paris',
                    is_hidden = true, menu_enabled = true, stripe_charges_enabled = true,
                    description = 'Le club Yuno — billets, tables VIP et commande au bar sans la queue.'
              WHERE id = v_venue;
  UPDATE profiles SET venue_id = v_venue WHERE id = v_owner;
  -- Rôle owner indispensable : OwnerRoute exige RequireRole('owner') (super admin ne suffit pas).
  INSERT INTO user_roles (user_id, role) SELECT v_owner, 'owner'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_owner AND role = 'owner');
  -- Mot de passe owner = mdp démo, pour le switch in-app illimité (any -> any).
  UPDATE auth.users SET encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')) WHERE id = v_owner;
  -- Abonnement Elite pour le club démo (ligne de cohérence ; l'affichage Elite est aussi
  -- forcé côté client pour les comptes @womber.fr, voir useSubscriptionPlan).
  IF EXISTS (SELECT 1 FROM venue_subscriptions WHERE venue_id = v_venue) THEN
    UPDATE venue_subscriptions SET subscription_plan = 'elite', status = 'active',
      plan_source = 'paid'::subscription_plan_source, current_period_start = now(),
      current_period_end = now() + interval '1 year', trial_end = NULL
    WHERE venue_id = v_venue;
  ELSE
    INSERT INTO venue_subscriptions (venue_id, subscription_plan, status, plan_source, current_period_start, current_period_end)
    VALUES (v_venue, 'elite', 'active', 'paid'::subscription_plan_source, now(), now() + interval '1 year');
  END IF;
  RAISE NOTICE 'Club Yuno : venue_id = %', v_venue;

  -- Créer les 7 comptes liés si absents.
  FOREACH e IN ARRAY v_emails LOOP
    SELECT id INTO uid FROM auth.users WHERE email = e;
    IF uid IS NULL THEN
      uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      VALUES (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
        extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('first_name', initcap(split_part(e, '@', 1)), 'last_name', 'Yuno'),
        now(), now(), '', '', '', '');
      INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), uid::text, uid,
              jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true),
              'email', now(), now(), now());
      RAISE NOTICE 'Compte créé : %', e;
    END IF;
  END LOOP;

  SELECT id INTO v_org   FROM auth.users WHERE email = 'organizer@womber.fr';
  SELECT id INTO v_promo FROM auth.users WHERE email = 'promoter@womber.fr';
  SELECT id INTO v_aff   FROM auth.users WHERE email = 'affiliate@womber.fr';
  SELECT id INTO v_dj    FROM auth.users WHERE email = 'dj@womber.fr';

  -- ORGANIZER "Yuno"
  INSERT INTO user_roles (user_id, role) SELECT v_org, 'organizer'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_org AND role = 'organizer');
  UPDATE profiles SET profile_type = 'organizer', onboarding_completed = true,
    organization_name = 'Yuno', preferred_language = 'fr',
    stripe_connect_account_id = 'acct_demo_yuno', stripe_connect_status = 'active',
    stripe_connect_charges_enabled = true, stripe_connect_payouts_enabled = true,
    stripe_connect_onboarded_at = now()
  WHERE id = v_org;
  IF NOT EXISTS (SELECT 1 FROM organizer_profiles WHERE user_id = v_org) THEN
    INSERT INTO organizer_profiles (user_id, display_name, bio, cover_url, is_public)
    VALUES (v_org, 'Yuno', 'Yuno Events — soirées, festivals et expériences nightlife.',
            'https://images.unsplash.com/photo-1492684223066-81342ee5ff30', true);
  ELSE
    UPDATE organizer_profiles SET display_name = 'Yuno' WHERE user_id = v_org;
  END IF;

  -- PROMOTEUR : rôle + 2 lignes promoters (club ET orga)
  INSERT INTO user_roles (user_id, role) SELECT v_promo, 'promoter'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_promo AND role = 'promoter');
  SELECT id INTO v_promo_v FROM promoters WHERE user_id = v_promo AND venue_id = v_venue;
  IF v_promo_v IS NULL THEN
    v_promo_v := gen_random_uuid();
    INSERT INTO promoters (id, user_id, venue_id, promo_code, first_name, last_name, is_active,
      ticket_commission_type, ticket_commission_value, table_commission_type, table_commission_value, can_scan_entries)
    VALUES (v_promo_v, v_promo, v_venue, 'YUNO-CLUB', 'Alex', 'Rivière', true, 'fixed', 3, 'percentage', 10, true);
  END IF;
  SELECT id INTO v_promo_o FROM promoters WHERE user_id = v_promo AND organizer_user_id = v_org;
  IF v_promo_o IS NULL THEN
    v_promo_o := gen_random_uuid();
    INSERT INTO promoters (id, user_id, organizer_user_id, promo_code, first_name, last_name, is_active,
      ticket_commission_type, ticket_commission_value, table_commission_type, table_commission_value, can_scan_entries)
    VALUES (v_promo_o, v_promo, v_org, 'YUNO-ORG', 'Alex', 'Rivière', true, 'fixed', 4, 'percentage', 10, true);
  END IF;

  -- AFFILIÉ
  INSERT INTO user_roles (user_id, role) SELECT v_aff, 'affiliate'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_aff AND role = 'affiliate');
  SELECT id INTO v_aff_id FROM affiliates WHERE user_id = v_aff;
  IF v_aff_id IS NULL THEN
    v_aff_id := gen_random_uuid();
    INSERT INTO affiliates (id, user_id, name, city, type, commission_rate, is_active, linktree_slug)
    VALUES (v_aff_id, v_aff, 'Yuno Network', 'Paris', 'city_agency', 10, true, 'yuno-network-demo');
  END IF;

  -- DJ : rôle + 2 lignes djs (club ET orga)
  INSERT INTO user_roles (user_id, role) SELECT v_dj, 'dj'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_dj AND role = 'dj');
  v_salt := gen_random_uuid()::text;
  UPDATE profiles SET employee_pin = v_salt || ':' || encode(extensions.digest('123456' || v_salt, 'sha256'), 'hex')
    WHERE id = v_dj;
  SELECT id INTO v_dj_v FROM djs WHERE user_id = v_dj AND venue_id = v_venue;
  IF v_dj_v IS NULL THEN
    v_dj_v := gen_random_uuid();
    INSERT INTO djs (id, user_id, venue_id, first_name, last_name, stage_name, music_genres, city, is_active, is_verified)
    VALUES (v_dj_v, v_dj, v_venue, 'Marco', 'Vinci', 'MARCO V', ARRAY['house','techno'], 'Paris', true, true);
  END IF;
  SELECT id INTO v_dj_o FROM djs WHERE user_id = v_dj AND organizer_user_id = v_org;
  IF v_dj_o IS NULL THEN
    v_dj_o := gen_random_uuid();
    INSERT INTO djs (id, user_id, organizer_user_id, first_name, last_name, stage_name, music_genres, city, is_active, is_verified)
    VALUES (v_dj_o, v_dj, v_org, 'Marco', 'Vinci', 'MARCO V', ARRAY['house','techno'], 'Paris', true, true);
  END IF;

  -- STAFF (videur/barman/vestiaire) : club (user_roles + venue_id + PIN) ET orga (org_staff)
  FOR rec IN SELECT * FROM (VALUES
      ('bouncer@womber.fr','bouncer'), ('barman@womber.fr','barman'), ('cloakroom@womber.fr','cloakroom')
    ) s(email, role)
  LOOP
    SELECT id INTO uid FROM auth.users WHERE email = rec.email;
    INSERT INTO user_roles (user_id, role) SELECT uid, rec.role::app_role
      WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = uid AND role = rec.role::app_role);
    v_salt := gen_random_uuid()::text;
    v_pin  := v_salt || ':' || encode(extensions.digest('123456' || v_salt, 'sha256'), 'hex');
    UPDATE profiles SET venue_id = v_venue, employee_pin = v_pin WHERE id = uid;
    -- rattachement orga
    IF NOT EXISTS (SELECT 1 FROM org_staff WHERE organizer_user_id = v_org AND user_id = uid) THEN
      INSERT INTO org_staff (organizer_user_id, user_id, email, display_name, role, invitation_status, pin_hash, pin_set_at)
      VALUES (v_org, uid, rec.email, initcap(rec.role), rec.role, 'accepted', v_pin, now());
    END IF;
  END LOOP;

  -- ORG : un membre d'équipe (admin) pour l'onglet Team
  IF NOT EXISTS (SELECT 1 FROM org_members WHERE organizer_user_id = v_org AND member_user_id = v_promo) THEN
    INSERT INTO org_members (organizer_user_id, member_email, member_user_id, role, invitation_status,
      invited_by, accepted_at, can_view_finance, can_refund, can_export, can_manage_team)
    VALUES (v_org, 'promoter@womber.fr', v_promo, 'admin', 'accepted', v_org, now(), true, true, true, false);
  END IF;

  CREATE TEMP TABLE _ctx (k text PRIMARY KEY, u uuid, t text);
  INSERT INTO _ctx (k, u, t) VALUES
    ('owner', v_owner, NULL), ('venue', NULL, v_venue), ('organizer', v_org, NULL),
    ('promoter', v_promo, NULL), ('promoter_v', v_promo_v, NULL), ('promoter_o', v_promo_o, NULL),
    ('affiliate', v_aff, NULL), ('affiliate_id', v_aff_id, NULL),
    ('dj', v_dj, NULL), ('dj_v', v_dj_v, NULL), ('dj_o', v_dj_o, NULL);
END $$;

-- ----------------------------------------------------------------------------
-- ÉTAPE 2 — TEARDOWN (enfants -> parents), scopé démo. owner + venue = UPDATE only.
-- ----------------------------------------------------------------------------
DELETE FROM promoter_conversions WHERE promoter_id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'));
DELETE FROM promoter_clicks      WHERE promoter_id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'));
DELETE FROM promoter_payouts     WHERE promoter_id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'));
DELETE FROM promoter_event_assignments WHERE promoter_id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'));
DELETE FROM promoter_announcements WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');
DELETE FROM promoter_teams       WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');
DELETE FROM commission_templates WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');

DELETE FROM guest_list_entries WHERE guest_list_id IN (
  SELECT id FROM guest_lists WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer'));
DELETE FROM guest_lists WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');

DELETE FROM event_djs WHERE dj_id IN (SELECT u FROM _ctx WHERE k IN ('dj_v','dj_o'));
DELETE FROM dj_sets   WHERE dj_id IN (SELECT u FROM _ctx WHERE k IN ('dj_v','dj_o'));

DELETE FROM tickets            WHERE purchase_source = 'demo_seed';
DELETE FROM table_reservations WHERE purchase_source = 'demo_seed';
DELETE FROM orders WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
  AND (order_number LIKE 'DEMO-%' OR user_email LIKE '%@demo.womber.fr');

DELETE FROM ticket_rounds WHERE event_id IN (
  SELECT id FROM events WHERE access_code = 'DEMO_SEED'
    AND (venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer')));

DELETE FROM visitor_sessions WHERE session_id LIKE 'demo-%';
DELETE FROM venue_customers  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') AND email LIKE '%@demo.womber.fr';

DELETE FROM table_packs WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM vip_tables  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM table_zones WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');

DELETE FROM events WHERE access_code = 'DEMO_SEED'
  AND (venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer'));

DELETE FROM upsell_drink_packs WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM favorites WHERE drink_id IN (SELECT id FROM drinks WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue'));
DELETE FROM drinks WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM loyalty_rewards  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM loyalty_settings WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM email_campaigns WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');
DELETE FROM sms_campaigns   WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_id = (SELECT u FROM _ctx WHERE k='organizer');
DELETE FROM venue_organizer_partnerships WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') AND organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');

DELETE FROM affiliate_visitor_sessions WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_clicks WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_events WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_venues WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');

-- ----------------------------------------------------------------------------
-- ÉTAPE 3 — Catalogue club : boissons, packs conso, zones + tables + table packs.
-- ----------------------------------------------------------------------------
-- Boissons du club démo : on seed depuis le VRAI catalogue admin (drink_catalog),
-- jamais des entrées inventées. Le menu démo reflète donc les boissons réelles de
-- la base. Prix par catégorie (le catalogue n'en porte pas) : drink 12 / shot 6 / soft 5.
-- (Suppose drink_catalog peuplé — c'est le cas en prod.)
INSERT INTO drinks (id, venue_id, name, price, img_url, collection, active, position)
SELECT
  'yuno-' || dc.id,
  (SELECT t FROM _ctx WHERE k='venue'),
  dc.name,
  CASE dc.category WHEN 'shot' THEN 6 WHEN 'soft' THEN 5 ELSE 12 END,
  COALESCE(dc.image_url, ''),
  dc.category,
  true,
  (row_number() OVER (ORDER BY CASE dc.category WHEN 'drink' THEN 0 WHEN 'shot' THEN 1 ELSE 2 END, dc.name))::int - 1
FROM drink_catalog dc;

INSERT INTO upsell_drink_packs (venue_id, name, description, drink_count, pack_price, original_price, allowed_collections, is_active)
SELECT (SELECT t FROM _ctx WHERE k='venue'), x.name, x.descr, x.cnt, x.pp, x.op, ARRAY['drink','shot'], true
FROM (VALUES
  ('Pack 5 conso', '5 boissons au choix, payées d''avance', 5, 50, 65),
  ('Pack 10 shots', '10 shots pour le groupe', 10, 50, 70)
) x(name, descr, cnt, pp, op);

INSERT INTO table_zones (id, venue_id, name, color, position, price)
SELECT gen_random_uuid(), (SELECT t FROM _ctx WHERE k='venue'), z.name, z.color, z.pos, z.price
FROM (VALUES ('Carré VIP','#d4af37',0,600), ('Mezzanine','#7c3aed',1,400), ('Dancefloor','#06b6d4',2,250)) z(name, color, pos, price);

INSERT INTO vip_tables (id, venue_id, zone_id, table_number, capacity, price, position_x, position_y)
SELECT gen_random_uuid(), tz.venue_id, tz.id, substr(tz.name, 1, 3) || '-' || g, (6 + floor(random()*8))::int, tz.price,
       (random()*800)::int, (random()*500)::int
FROM table_zones tz CROSS JOIN LATERAL generate_series(1, 6) g
WHERE tz.venue_id = (SELECT t FROM _ctx WHERE k='venue');

INSERT INTO table_packs (venue_id, zone_id, name, base_price, base_capacity, included_bottles_quota, deposit, minimum_spend, is_active, position)
SELECT tz.venue_id, tz.id, tz.name || ' — Bouteille', tz.price, (6 + floor(random()*4))::int, 1, round(tz.price*0.3,0), tz.price, true, tz.position
FROM table_zones tz WHERE tz.venue_id = (SELECT t FROM _ctx WHERE k='venue');

-- ----------------------------------------------------------------------------
-- ÉTAPE 4 — Events club + orga (90 j passés + à venir).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _ev AS
SELECT slug, id, kind, title, doff, ticketing, tables, genre,
       (((now()::date + doff)::timestamp + time '23:00') AT TIME ZONE 'Europe/Paris') AS start_ts
FROM (VALUES
  ('v1',  gen_random_uuid(), 'venue', 'Yuno Friday — House Sessions', -84, true, true,  'house'),
  ('v2',  gen_random_uuid(), 'venue', 'Yuno presents: Techno Warehouse', -70, true, true,  'techno'),
  ('v3',  gen_random_uuid(), 'venue', 'Yuno Hip-Hop All Stars', -56, true, true, 'hip-hop'),
  ('v4',  gen_random_uuid(), 'venue', 'Yuno Afro Vibes', -42, true, true,  'afro'),
  ('v5',  gen_random_uuid(), 'venue', 'Yuno Ladies Night', -28, true, true, 'open'),
  ('v6',  gen_random_uuid(), 'venue', 'Yuno House Marathon', -14, true, true,  'house'),
  ('v7',  gen_random_uuid(), 'venue', 'Yuno Saturday Fever', -5, true, true,  'disco'),
  ('v8',  gen_random_uuid(), 'venue', 'Yuno Reggaeton Party', 4, true, true,  'latino'),
  ('v9',  gen_random_uuid(), 'venue', 'Yuno Open Format', 12, true, true,  'open'),
  ('v10', gen_random_uuid(), 'venue', 'Yuno Techno Sunrise', 26, true, true, 'techno'),
  ('o1',  gen_random_uuid(), 'org',   'Yuno Festival — Day 1', -50, true, false, 'open'),
  ('o2',  gen_random_uuid(), 'org',   'Yuno Rooftop Sunset', -20, true, false, 'house'),
  ('o3',  gen_random_uuid(), 'org',   'Yuno Boat Party Seine', 7, true, false, 'house'),
  ('o4',  gen_random_uuid(), 'org',   'Yuno Summer Closing', 20, true, false, 'open')
) v(slug, id, kind, title, doff, ticketing, tables, genre);

INSERT INTO events (id, title, start_at, end_at, venue_id, organizer_user_id,
  music_genre, event_type, event_kind, event_mode, visibility, is_active, is_discoverable,
  ticketing_enabled, tables_enabled, access_code, location_name, location_city, image_url, poster_url, created_at)
SELECT e.id, e.title, e.start_ts, e.start_ts + interval '6 hours',
  CASE WHEN e.kind = 'venue' THEN (SELECT t FROM _ctx WHERE k='venue') END,
  CASE WHEN e.kind = 'org'   THEN (SELECT u FROM _ctx WHERE k='organizer') END,
  e.genre, 'club',
  (CASE WHEN e.kind = 'org' THEN 'organizer_event' ELSE 'club_event' END)::event_kind,
  (CASE WHEN e.kind = 'org' THEN 'solo_organizer' ELSE 'solo_venue' END)::event_mode,
  'private'::event_visibility, true, false, e.ticketing, e.tables, 'DEMO_SEED',
  CASE WHEN e.kind = 'org' THEN 'Yuno Open Air' END, 'Paris',
  'https://images.unsplash.com/photo-1566737236500-c8ac43014a67',
  'https://images.unsplash.com/photo-1566737236500-c8ac43014a67',
  e.start_ts - interval '30 days'
FROM _ev e;

CREATE TEMP TABLE _round AS
SELECT gen_random_uuid() AS id, e.id AS event_id, e.doff AS doff, e.start_ts AS start_ts, r.name, r.price, r.maxt, r.pos
FROM _ev e
CROSS JOIN (VALUES ('Early Bird', 18, 150, 0), ('Regular', 28, 300, 1), ('Last Tickets', 39, 200, 2)) r(name, price, maxt, pos)
WHERE e.ticketing;

INSERT INTO ticket_rounds (id, event_id, name, price, max_tickets, position, ticket_type, is_active, tickets_sold)
SELECT id, event_id, name, price, maxt, pos, 'standard', true, 0 FROM _round;

-- ----------------------------------------------------------------------------
-- ÉTAPE 5 — Billets payés (gros volumes). CA Club = sous-total.
-- ----------------------------------------------------------------------------
INSERT INTO tickets (event_id, ticket_round_id, user_id, user_email, full_name, is_guest,
  quantity, unit_price, total_price, service_fee, insurance_fee, status, ticket_type,
  qr_code, purchase_source, paid_at, created_at, used, entry_scanned, entry_scanned_at)
SELECT
  r.event_id, r.id, NULL,
  'buyer' || (1 + floor(random()*80))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  true, q.qty, r.price,
  round(r.price * q.qty + greatest(0.99, r.price * q.qty * 0.04), 2),
  round(greatest(0.99, r.price * q.qty * 0.04), 2), 0, 'paid', 'standard',
  'demo-tkt-' || gen_random_uuid()::text, 'demo_seed', ts.t, ts.t,
  sc.scanned, sc.scanned, CASE WHEN sc.scanned THEN r.start_ts + interval '1 hour' END
FROM _round r
CROSS JOIN LATERAL generate_series(1,
  (CASE WHEN r.doff < 0 THEN 20 + floor(random()*40)
        WHEN r.doff <= 21 THEN 10 + floor(random()*20)
        ELSE floor(random()*5) END)::int) gs
CROSS JOIN LATERAL (SELECT (1 + floor(random()*4))::int AS qty) q
CROSS JOIN LATERAL (SELECT (r.doff < 0 AND random() < 0.8) AS scanned) sc
CROSS JOIN LATERAL (SELECT least(now() - interval '1 hour',
    (r.start_ts - interval '30 days') + random() * (least(r.start_ts, now()) - (r.start_ts - interval '30 days'))) AS t) ts;

UPDATE ticket_rounds tr SET tickets_sold = COALESCE(
  (SELECT sum(t.quantity) FROM tickets t WHERE t.ticket_round_id = tr.id AND t.status = 'paid'), 0)
WHERE tr.id IN (SELECT id FROM _round);

-- ----------------------------------------------------------------------------
-- ÉTAPE 6 — Commandes bar (~1200, pondérées jours récents + heures de club 22h-05h
--           Paris). items jsonb double-forme. CA Club = sous-total.
-- ----------------------------------------------------------------------------
INSERT INTO orders (venue_id, event_id, user_id, user_email, items, total, service_fee, status, paid_at, created_at, order_number, is_guest)
SELECT (SELECT t FROM _ctx WHERE k='venue'), NULL, NULL,
  'buyer' || (1 + floor(random()*80))::int || '@demo.womber.fr',
  li.items, round(li.subtotal + round(li.subtotal * 0.05, 2), 2), round(li.subtotal * 0.05, 2),
  CASE WHEN random() < 0.85 THEN 'paid' ELSE 'served' END, ts.t, ts.t, 'DEMO-' || g, true
FROM generate_series(1, 1200) g
-- Jour pondéré récent (exposant>1 tire power(random()) vers 0 = jours proches), heure 22h-05h Paris.
CROSS JOIN LATERAL (SELECT least(now() - interval '20 minutes',
    ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris')
        - (power(random(), 1.8) * 75)::int * interval '1 day'
        + interval '22 hours' + random() * interval '7 hours') AT TIME ZONE 'Europe/Paris')) AS t) ts
CROSS JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('id', d.id, 'drinkId', d.id, 'name', d.name, 'price', d.price,
                  'unitPrice', d.price, 'qty', dq.q, 'quantity', dq.q, 'collection', d.collection)) AS items,
         sum(d.price * dq.q) AS subtotal
  FROM (SELECT id, name, price, collection FROM drinks WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
        ORDER BY random() LIMIT (1 + floor(random()*3))::int) d
  CROSS JOIN LATERAL (SELECT (1 + floor(random()*3))::int AS q) dq
) li
WHERE li.items IS NOT NULL;

-- ----------------------------------------------------------------------------
-- ÉTAPE 7 — Tables VIP payées (table distincte par event). CA Club = base.
-- ----------------------------------------------------------------------------
WITH ev AS (
  SELECT id AS event_id, doff, start_ts,
    (CASE WHEN doff < 0 THEN 4 + floor(random()*5) WHEN doff <= 21 THEN floor(random()*4) ELSE 0 END)::int AS cnt
  FROM _ev WHERE tables
),
ranked AS (
  SELECT e.event_id, e.doff, e.start_ts, e.cnt, vt.id AS table_id, vt.zone_id,
         row_number() OVER (PARTITION BY e.event_id ORDER BY random()) AS rn
  FROM ev e CROSS JOIN vip_tables vt WHERE vt.venue_id = (SELECT t FROM _ctx WHERE k='venue')
)
INSERT INTO table_reservations (event_id, table_id, zone_id, user_id, user_email, full_name,
  is_guest, guest_count, total_price, deposit, service_fee, management_fee, status,
  paid_at, created_at, purchase_source, entry_scanned, entry_scanned_at)
SELECT r.event_id, r.table_id, r.zone_id, NULL,
  'buyer' || (1 + floor(random()*80))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  true, (4 + floor(random()*8))::int, base.total, base.total, 0, base.mgmt, 'paid',
  ts.t, ts.t, 'demo_seed', sc.scanned, CASE WHEN sc.scanned THEN r.start_ts + interval '1 hour' END
FROM ranked r
CROSS JOIN LATERAL (SELECT (300 + floor(random()*600))::numeric AS b) bb
CROSS JOIN LATERAL (SELECT round(greatest(0.99, bb.b * 0.04), 2) AS mgmt, round(bb.b + greatest(0.99, bb.b * 0.04), 2) AS total) base
CROSS JOIN LATERAL (SELECT (r.doff < 0 AND random() < 0.75) AS scanned) sc
CROSS JOIN LATERAL (SELECT least(now() - interval '1 hour',
    (r.start_ts - interval '20 days') + random() * (least(r.start_ts, now()) - (r.start_ts - interval '20 days'))) AS t) ts
WHERE r.rn <= r.cnt;

-- ----------------------------------------------------------------------------
-- ÉTAPE 8 — Remboursements (onglet Refunds club + orga).
-- ----------------------------------------------------------------------------
UPDATE tickets SET status = 'refunded', refund_amount = round(total_price * 0.8, 2),
  refund_reason = 'Annulation client', refunded_at = created_at + interval '2 days'
WHERE id IN (SELECT id FROM tickets WHERE purchase_source = 'demo_seed' ORDER BY random() LIMIT 18);
UPDATE tickets SET status = 'refunded', refund_amount = round(total_price * 0.8, 2),
  refund_reason = 'Annulation client', refunded_at = created_at + interval '2 days'
WHERE id IN (SELECT id FROM tickets WHERE purchase_source = 'demo_seed'
  AND event_id IN (SELECT id FROM _ev WHERE kind='org') AND status='paid' ORDER BY random() LIMIT 3);
UPDATE orders SET status = 'refunded', refund_amount = round(total * 0.9, 2),
  refund_reason = 'Erreur de commande', refunded_at = created_at + interval '1 day'
WHERE id IN (SELECT id FROM orders WHERE order_number LIKE 'DEMO-%' AND status IN ('paid','served') ORDER BY random() LIMIT 12);
UPDATE table_reservations SET status = 'refunded', refund_amount = round(total_price * 0.7, 2),
  refund_reason = 'Annulation', refunded_at = created_at + interval '2 days'
WHERE id IN (SELECT id FROM table_reservations WHERE purchase_source = 'demo_seed' ORDER BY random() LIMIT 5);

-- ----------------------------------------------------------------------------
-- ÉTAPE 9 — Sessions visiteurs (~2000 : 1400 club + 600 orga), funnel. Pondérées
--           jours récents pour que la vue 7 j par défaut soit pleine.
-- ----------------------------------------------------------------------------
INSERT INTO visitor_sessions (session_id, venue_id, organizer_user_id, visited_at, created_at,
  added_to_cart, proceeded_to_checkout, completed_order, device_type, pages_viewed, duration_seconds)
SELECT 'demo-' || gen_random_uuid()::text,
  CASE WHEN src.is_org THEN NULL ELSE (SELECT t FROM _ctx WHERE k='venue') END,
  CASE WHEN src.is_org THEN (SELECT u FROM _ctx WHERE k='organizer') END,
  ts.t, ts.t, c.cart, ck.chk, cp.comp,
  (ARRAY['mobile','desktop','tablet'])[(1 + floor(random()*3))::int],
  (1 + floor(random()*8))::int, (30 + floor(random()*600))::int
FROM generate_series(1, 2000) g
CROSS JOIN LATERAL (SELECT g > 1400 AS is_org) src
CROSS JOIN LATERAL (SELECT now() - (power(random(), 1.8) * 60) * interval '1 day' AS t) ts
CROSS JOIN LATERAL (SELECT random() < 0.45 AS cart) c
CROSS JOIN LATERAL (SELECT c.cart AND random() < 0.6 AS chk) ck
CROSS JOIN LATERAL (SELECT ck.chk AND random() < 0.6 AS comp) cp;

-- ----------------------------------------------------------------------------
-- ÉTAPE 10 — CRM clients (emails alignés sur les ventes).
-- ----------------------------------------------------------------------------
INSERT INTO venue_customers (venue_id, user_id, email, first_name, last_name, phone,
  first_visit_at, last_visit_at, total_spent, ticket_count, order_count, table_count, is_banned, ban_reason)
SELECT (SELECT t FROM _ctx WHERE k='venue'), gen_random_uuid(), 'buyer' || g || '@demo.womber.fr',
  (ARRAY['Lucas','Emma','Hugo','Léa','Nathan','Chloé','Théo','Manon','Enzo','Camille'])[(1 + floor(random()*10))::int],
  (ARRAY['Martin','Bernard','Dubois','Moreau','Petit','Laurent','Garcia','Roux','Fontaine','Girard'])[(1 + floor(random()*10))::int],
  '+336' || lpad((floor(random()*100000000))::int::text, 8, '0'),
  now() - (60 + random()*120) * interval '1 day', now() - (random()*25) * interval '1 day',
  round((40 + random()*1500)::numeric, 2), (floor(random()*12))::int, (floor(random()*20))::int, (floor(random()*4))::int,
  (g <= 3), CASE WHEN g <= 3 THEN 'Comportement agressif à l''entrée' END
FROM generate_series(1, 80) g;

-- ----------------------------------------------------------------------------
-- ÉTAPE 11 — Promoteur (club + orga) : templates, équipes, annonces, clics,
-- conversions, payouts, assignations event.
-- ----------------------------------------------------------------------------
INSERT INTO commission_templates (name, venue_id, rules, is_default)
VALUES ('Standard Yuno', (SELECT t FROM _ctx WHERE k='venue'),
        '{"ticket":{"type":"fixed","value":3},"table":{"type":"percentage","value":10}}'::jsonb, true);
INSERT INTO commission_templates (name, organizer_user_id, rules, is_default)
VALUES ('Standard Orga', (SELECT u FROM _ctx WHERE k='organizer'),
        '{"ticket":{"type":"fixed","value":4},"table":{"type":"percentage","value":10}}'::jsonb, true);

INSERT INTO promoter_teams (name, venue_id, leader_promoter_id, override_type, override_value, max_sales)
VALUES ('Team Yuno Club', (SELECT t FROM _ctx WHERE k='venue'), (SELECT u FROM _ctx WHERE k='promoter_v'), 'fixed', 1, 500);
INSERT INTO promoter_teams (name, organizer_user_id, leader_promoter_id, override_type, override_value, max_sales)
VALUES ('Team Yuno Orga', (SELECT u FROM _ctx WHERE k='organizer'), (SELECT u FROM _ctx WHERE k='promoter_o'), 'fixed', 1, 800);

INSERT INTO promoter_announcements (title, content, venue_id)
VALUES ('Objectif du mois', 'Place 100 entrées ce mois-ci et débloque un bonus de 200€.', (SELECT t FROM _ctx WHERE k='venue'));
INSERT INTO promoter_announcements (title, content, organizer_user_id)
VALUES ('Festival Yuno', 'Le festival arrive : commissions doublées sur les 3 prochaines soirées.', (SELECT u FROM _ctx WHERE k='organizer'));

INSERT INTO promoter_clicks (promoter_id, clicked_at, source, event_id)
SELECT (SELECT u FROM _ctx WHERE k='promoter_v'), now() - (random()*60) * interval '1 day',
  (ARRAY['instagram','whatsapp','direct','tiktok','story'])[(1 + floor(random()*5))::int],
  (SELECT id FROM _ev WHERE kind = 'venue' ORDER BY random() LIMIT 1)
FROM generate_series(1, 220) g;
INSERT INTO promoter_clicks (promoter_id, clicked_at, source, event_id)
SELECT (SELECT u FROM _ctx WHERE k='promoter_o'), now() - (random()*60) * interval '1 day',
  (ARRAY['instagram','whatsapp','direct','tiktok'])[(1 + floor(random()*4))::int],
  (SELECT id FROM _ev WHERE kind = 'org' ORDER BY random() LIMIT 1)
FROM generate_series(1, 140) g;

-- Conversions club (sur billets club)
INSERT INTO promoter_conversions (promoter_id, conversion_type, event_id, ticket_id, amount, commission, status, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_v'), 'ticket', t.event_id, t.id,
  round(t.total_price - t.service_fee - COALESCE(t.insurance_fee, 0), 2), 3,
  CASE WHEN t.rnd < 0.5 THEN 'paid' ELSE 'pending' END, t.created_at,
  CASE WHEN t.rnd < 0.5 THEN t.created_at + interval '7 days' END
FROM (SELECT id, event_id, total_price, service_fee, insurance_fee, created_at, random() AS rnd
      FROM tickets WHERE purchase_source = 'demo_seed' AND status='paid'
        AND event_id IN (SELECT id FROM _ev WHERE kind='venue') ORDER BY random() LIMIT 60) t;
-- Conversions club (tables)
INSERT INTO promoter_conversions (promoter_id, conversion_type, event_id, table_reservation_id, amount, commission, status, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_v'), 'table', r.event_id, r.id,
  round(r.total_price - COALESCE(r.management_fee, 0), 2), round((r.total_price - COALESCE(r.management_fee, 0)) * 0.10, 2),
  CASE WHEN r.rnd < 0.5 THEN 'paid' ELSE 'pending' END, r.created_at,
  CASE WHEN r.rnd < 0.5 THEN r.created_at + interval '7 days' END
FROM (SELECT id, event_id, total_price, management_fee, created_at, random() AS rnd
      FROM table_reservations WHERE purchase_source = 'demo_seed' AND status='paid' ORDER BY random() LIMIT 15) r;
-- Conversions orga (billets orga)
INSERT INTO promoter_conversions (promoter_id, conversion_type, event_id, ticket_id, amount, commission, status, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_o'), 'ticket', t.event_id, t.id,
  round(t.total_price - t.service_fee - COALESCE(t.insurance_fee, 0), 2), 4,
  CASE WHEN t.rnd < 0.5 THEN 'paid' ELSE 'pending' END, t.created_at,
  CASE WHEN t.rnd < 0.5 THEN t.created_at + interval '7 days' END
FROM (SELECT id, event_id, total_price, service_fee, insurance_fee, created_at, random() AS rnd
      FROM tickets WHERE purchase_source = 'demo_seed' AND status='paid'
        AND event_id IN (SELECT id FROM _ev WHERE kind='org') ORDER BY random() LIMIT 30) t;

UPDATE promoters SET
  pending_amount = COALESCE((SELECT sum(commission) FROM promoter_conversions WHERE promoter_id = promoters.id AND status = 'pending'), 0),
  total_paid     = COALESCE((SELECT sum(commission) FROM promoter_conversions WHERE promoter_id = promoters.id AND status = 'paid'), 0)
WHERE id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'));

INSERT INTO promoter_payouts (promoter_id, venue_id, amount, status, period_label, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_v'), (SELECT t FROM _ctx WHERE k='venue'),
  round((100 + random()*300)::numeric, 2), 'paid', to_char(now() - (g * 30) * interval '1 day', 'YYYY-MM'),
  now() - (g * 30) * interval '1 day', now() - (g * 30) * interval '1 day'
FROM generate_series(1, 4) g;
INSERT INTO promoter_payouts (promoter_id, organizer_user_id, amount, status, period_label, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_o'), (SELECT u FROM _ctx WHERE k='organizer'),
  round((150 + random()*400)::numeric, 2), 'paid', to_char(now() - (g * 30) * interval '1 day', 'YYYY-MM'),
  now() - (g * 30) * interval '1 day', now() - (g * 30) * interval '1 day'
FROM generate_series(1, 3) g;

INSERT INTO promoter_event_assignments (promoter_id, event_id, status, can_access_guestlist, can_access_tables, goal_target)
SELECT (SELECT u FROM _ctx WHERE k='promoter_v'), id, 'active', true, true, 80
FROM _ev WHERE kind='venue' AND doff BETWEEN -7 AND 30;
INSERT INTO promoter_event_assignments (promoter_id, event_id, status, can_access_guestlist, can_access_tables, goal_target)
SELECT (SELECT u FROM _ctx WHERE k='promoter_o'), id, 'active', true, false, 120
FROM _ev WHERE kind='org' AND doff BETWEEN -7 AND 30;

-- ----------------------------------------------------------------------------
-- ÉTAPE 12 — Guest lists (events récents/à venir) + entrées.
-- ----------------------------------------------------------------------------
INSERT INTO guest_lists (event_id, venue_id, quota, free_before_time, is_active, share_token, visible_on_club_page, organizer_user_id)
SELECT e.id, CASE WHEN e.kind = 'venue' THEN (SELECT t FROM _ctx WHERE k='venue') END,
  200, '01:00', true, 'demo-' || substr(md5(random()::text), 1, 10), true,
  CASE WHEN e.kind = 'org' THEN (SELECT u FROM _ctx WHERE k='organizer') END
FROM _ev e WHERE e.doff BETWEEN -7 AND 30;

INSERT INTO guest_list_entries (guest_list_id, full_name, email, phone, gender, qr_code, status, entry_scanned, entry_scanned_at, promoter_id, created_at)
SELECT gl.id,
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  'guest' || g || '-' || substr(md5(random()::text), 1, 4) || '@demo.womber.fr',
  '+336' || lpad((floor(random()*100000000))::int::text, 8, '0'),
  (ARRAY['M','F'])[(1 + floor(random()*2))::int], 'demo-gl-' || gen_random_uuid()::text, 'pending',
  sc.scanned, CASE WHEN sc.scanned THEN ev.start_ts + interval '1 hour' END,
  CASE WHEN random() < 0.5 THEN (SELECT u FROM _ctx WHERE k='promoter_v') END,
  ev.start_ts - (random()*14) * interval '1 day'
FROM guest_lists gl JOIN _ev ev ON ev.id = gl.event_id
CROSS JOIN LATERAL generate_series(1, (30 + floor(random()*40))::int) g
CROSS JOIN LATERAL (SELECT (ev.doff < 0 AND random() < 0.7) AS scanned) sc;

-- ----------------------------------------------------------------------------
-- ÉTAPE 13 — DJ : sets + assignations event (club + orga).
-- ----------------------------------------------------------------------------
INSERT INTO event_djs (event_id, dj_id)
SELECT id, (SELECT u FROM _ctx WHERE k='dj_v') FROM _ev WHERE kind='venue' ORDER BY random() LIMIT 6;
INSERT INTO event_djs (event_id, dj_id)
SELECT id, (SELECT u FROM _ctx WHERE k='dj_o') FROM _ev WHERE kind='org';

INSERT INTO dj_sets (dj_id, event_id, venue_id, start_time, end_time, title, music_genre, fee, fee_paid, fee_paid_at)
SELECT (SELECT u FROM _ctx WHERE k='dj_v'), e.id, (SELECT t FROM _ctx WHERE k='venue'),
  e.start_ts + interval '1 hour', e.start_ts + interval '4 hours', 'Closing set', 'house',
  round((400 + random()*600)::numeric, 0), (e.doff < 0), CASE WHEN e.doff < 0 THEN e.start_ts + interval '2 days' END
FROM _ev e WHERE e.kind='venue' AND e.id IN (SELECT event_id FROM event_djs);
INSERT INTO dj_sets (dj_id, event_id, organizer_user_id, start_time, end_time, title, music_genre, fee, fee_paid, fee_paid_at)
SELECT (SELECT u FROM _ctx WHERE k='dj_o'), e.id, (SELECT u FROM _ctx WHERE k='organizer'),
  e.start_ts + interval '1 hour', e.start_ts + interval '4 hours', 'Headline set', 'house',
  round((600 + random()*800)::numeric, 0), (e.doff < 0), CASE WHEN e.doff < 0 THEN e.start_ts + interval '2 days' END
FROM _ev e WHERE e.kind='org';

-- ----------------------------------------------------------------------------
-- ÉTAPE 14 — Marketing : campagnes email + SMS + loyalty (club + orga).
-- ----------------------------------------------------------------------------
INSERT INTO email_campaigns (venue_id, name, subject, type, status, recipients_count, opens_count, clicks_count, created_at, sent_at)
VALUES
  ((SELECT t FROM _ctx WHERE k='venue'), 'Yuno — Soirée Friday', 'Ce vendredi au Yuno 🔥', 'promotional', 'sent', 1240, 612, 188, now()-interval '20 days', now()-interval '20 days'),
  ((SELECT t FROM _ctx WHERE k='venue'), 'Yuno — Tables VIP', 'Réserve ta table VIP', 'promotional', 'sent', 980, 410, 132, now()-interval '9 days', now()-interval '9 days'),
  ((SELECT t FROM _ctx WHERE k='venue'), 'Yuno — Newsletter', 'Le programme du mois', 'informational', 'draft', 0, 0, 0, now()-interval '2 days', NULL);
INSERT INTO email_campaigns (organizer_user_id, name, subject, type, status, recipients_count, opens_count, clicks_count, created_at, sent_at)
VALUES
  ((SELECT u FROM _ctx WHERE k='organizer'), 'Yuno Festival — Save the date', 'Le festival Yuno arrive', 'promotional', 'sent', 2100, 1180, 360, now()-interval '15 days', now()-interval '15 days'),
  ((SELECT u FROM _ctx WHERE k='organizer'), 'Yuno — Boat Party', 'Boat Party sur la Seine', 'promotional', 'scheduled', 0, 0, 0, now()-interval '1 day', now()+interval '3 days');

INSERT INTO sms_campaigns (venue_id, name, body_template, created_by, status, estimated_recipients, sent_count, delivered_count, created_at, sent_at)
VALUES
  ((SELECT t FROM _ctx WHERE k='venue'), 'Rappel soirée', 'Yuno: ta soirée commence à 23h, à ce soir !', (SELECT u FROM _ctx WHERE k='owner'), 'sent', 850, 850, 832, now()-interval '7 days', now()-interval '7 days'),
  ((SELECT t FROM _ctx WHERE k='venue'), 'Promo tables', 'Yuno: -10% sur les tables VIP ce week-end', (SELECT u FROM _ctx WHERE k='owner'), 'draft', 0, 0, 0, now()-interval '1 day', NULL);
INSERT INTO sms_campaigns (organizer_id, name, body_template, created_by, status, estimated_recipients, sent_count, delivered_count, created_at, sent_at)
VALUES
  ((SELECT u FROM _ctx WHERE k='organizer'), 'Festival reminder', 'Yuno Festival demain, porte 18h !', (SELECT u FROM _ctx WHERE k='organizer'), 'sent', 1600, 1600, 1571, now()-interval '5 days', now()-interval '5 days');

INSERT INTO loyalty_settings (venue_id, is_enabled, points_per_euro, welcome_bonus, post_visit_notification)
VALUES ((SELECT t FROM _ctx WHERE k='venue'), true, 1, 100, true);
INSERT INTO loyalty_rewards (venue_id, name, description, points_required, reward_type, is_active, position)
VALUES
  ((SELECT t FROM _ctx WHERE k='venue'), 'Conso offerte', 'Une boisson au choix offerte', 200, 'free_drink', true, 0),
  ((SELECT t FROM _ctx WHERE k='venue'), 'Entrée offerte', 'Une entrée gratuite + coupe-file', 500, 'free_ticket', true, 1),
  ((SELECT t FROM _ctx WHERE k='venue'), 'Table -50%', '50% sur une table VIP', 1500, 'discount', true, 2);

-- ----------------------------------------------------------------------------
-- ÉTAPE 15 — Partenariat club <-> orga (onglets Partners / Collaborations).
-- ----------------------------------------------------------------------------
INSERT INTO venue_organizer_partnerships (venue_id, organizer_user_id, initiated_by, status, default_split_rules, requested_at, accepted_at, split_approved_by_organizer, split_approved_by_venue)
VALUES ((SELECT t FROM _ctx WHERE k='venue'), (SELECT u FROM _ctx WHERE k='organizer'), 'venue'::partnership_initiator,
        'active'::partnership_status, '{"venue":70,"organizer":30}'::jsonb, now()-interval '40 days', now()-interval '39 days', true, true);

-- ----------------------------------------------------------------------------
-- ÉTAPE 16 — Affilié : clubs partenaires, events, clics, vues.
-- ----------------------------------------------------------------------------
INSERT INTO affiliate_venues (affiliate_id, name, slug, city, is_active, genres)
SELECT (SELECT u FROM _ctx WHERE k='affiliate_id'), x.name, 'demo-' || x.s || '-' || substr(md5(random()::text), 1, 6), 'Paris', true, ARRAY['house','techno']
FROM (VALUES ('Le Rex Club','rex'), ('Concrete','concrete'), ('La Machine','machine')) x(name, s);

CREATE TEMP TABLE _aff_ev AS
SELECT gen_random_uuid() AS id, x.name, 'demo-aev-' || x.s || '-' || substr(md5(random()::text), 1, 6) AS slug,
  (now()::date + x.doff) AS event_date, x.doff
FROM (VALUES ('Techno Night @ Rex', -25, 'rex1'), ('Concrete Open Air', -12, 'conc1'), ('House Sessions', -3, 'house1'),
             ('Boiler Room Paris', 6, 'boiler1'), ('Sunrise Festival', 18, 'sunrise1'), ('Warehouse Rave', 30, 'ware1')) x(name, doff, s);

INSERT INTO affiliate_events (id, affiliate_id, affiliate_venue_id, name, slug, event_date, external_ticket_url)
SELECT ae.id, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT id FROM affiliate_venues WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id') ORDER BY random() LIMIT 1),
  ae.name, ae.slug, ae.event_date,
  CASE WHEN ae.name = 'Boiler Room Paris' THEN NULL ELSE 'https://shotgun.live/fr/events/demo' END
FROM _aff_ev ae;

INSERT INTO affiliate_clicks (affiliate_event_id, affiliate_id, affiliate_venue_id, clicked_at, is_internal, device_type)
SELECT ae.id, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT affiliate_venue_id FROM affiliate_events WHERE id = ae.id),
  now() - (random()*60) * interval '1 day', false, (ARRAY['mobile','desktop'])[(1 + floor(random()*2))::int]
FROM _aff_ev ae CROSS JOIN LATERAL generate_series(1, (25 + floor(random()*35))::int) g;

INSERT INTO affiliate_visitor_sessions (session_id, affiliate_id, affiliate_event_id, visited_at, is_internal, device_type)
SELECT 'demo-aff-' || gen_random_uuid()::text, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT id FROM _aff_ev ORDER BY random() LIMIT 1), now() - (random()*60) * interval '1 day', false,
  (ARRAY['mobile','desktop'])[(1 + floor(random()*2))::int]
FROM generate_series(1, 200) g;

-- ----------------------------------------------------------------------------
-- ÉTAPE 17 — Récap.
-- ----------------------------------------------------------------------------
SELECT 'club Yuno (venue_id)' AS objet, (SELECT t FROM _ctx WHERE k='venue') AS valeur
UNION ALL SELECT 'events',            count(*)::text FROM events WHERE access_code = 'DEMO_SEED'
UNION ALL SELECT 'billets payés',     count(*)::text FROM tickets WHERE purchase_source = 'demo_seed' AND status='paid'
UNION ALL SELECT 'billets remboursés',count(*)::text FROM tickets WHERE purchase_source = 'demo_seed' AND status='refunded'
UNION ALL SELECT 'CA billets (€)',    round(COALESCE(sum(total_price - service_fee - COALESCE(insurance_fee,0)),0))::text FROM tickets WHERE purchase_source='demo_seed' AND status='paid'
UNION ALL SELECT 'commandes bar',     count(*)::text FROM orders WHERE order_number LIKE 'DEMO-%'
UNION ALL SELECT 'tables VIP',        count(*)::text FROM table_reservations WHERE purchase_source = 'demo_seed'
UNION ALL SELECT 'visitor_sessions',  count(*)::text FROM visitor_sessions WHERE session_id LIKE 'demo-%'
UNION ALL SELECT 'clients CRM',       count(*)::text FROM venue_customers WHERE email LIKE '%@demo.womber.fr'
UNION ALL SELECT 'promoter conversions', count(*)::text FROM promoter_conversions WHERE promoter_id IN (SELECT u FROM _ctx WHERE k IN ('promoter_v','promoter_o'))
UNION ALL SELECT 'guest entries',     count(*)::text FROM guest_list_entries WHERE qr_code LIKE 'demo-gl-%'
UNION ALL SELECT 'dj sets',           count(*)::text FROM dj_sets WHERE dj_id IN (SELECT u FROM _ctx WHERE k IN ('dj_v','dj_o'))
UNION ALL SELECT 'email campaigns',   count(*)::text FROM email_campaigns WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer')
UNION ALL SELECT 'affiliate clicks',  count(*)::text FROM affiliate_clicks WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
