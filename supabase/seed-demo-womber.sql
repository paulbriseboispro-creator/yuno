-- ============================================================================
-- SEED DÉMO — Club "Womber" (owner@womber.fr) + comptes liés (orga / promoteur /
-- affilié / staff) avec données fictives pour des dashboards vivants en démo.
--
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
-- Tourne sur la PROD. Idempotent : rejouable autant de fois que voulu (le bloc
-- TEARDOWN en tête nettoie les données de la run précédente avant de re-seed).
--
-- IDENTIFIANTS DÉMO créés/utilisés :
--   owner@womber.fr      -> club "Womber" (compte EXISTANT, on le remplit)
--   organizer@womber.fr  -> orga / BDE          mdp : YunoDemo2026!
--   promoter@womber.fr   -> promoteur du club   mdp : YunoDemo2026!
--   affiliate@womber.fr  -> agence affiliée     mdp : YunoDemo2026!
--   bouncer@womber.fr    -> videur (PIN 1234)   mdp : YunoDemo2026!
--   barman@womber.fr     -> barman (PIN 1234)   mdp : YunoDemo2026!
--   cloakroom@womber.fr  -> vestiaire (PIN 1234)mdp : YunoDemo2026!
--
-- Le club est masqué du public (venues.is_hidden = true) et les events ne sont
-- pas découvrables (is_discoverable=false, visibility='private').
--
-- PRÉREQUIS : owner@womber.fr doit déjà exister dans Auth. Les 6 autres comptes
-- sont créés par ce script. Si la création auth échoue sur ta version GoTrue,
-- crée les 6 comptes à la main (Auth > Add user > "Auto Confirm User", même mdp)
-- puis relance : le script détecte les comptes existants et ne les recrée pas.
--
-- POUR TOUT SUPPRIMER : voir seed-demo-womber-teardown.sql
-- ============================================================================

-- Nettoyage défensif des tables temporaires (si une run précédente a échoué).
DROP TABLE IF EXISTS _ctx, _ev, _round, _aff_ev;

-- ----------------------------------------------------------------------------
-- ÉTAPE 1 — Identités : résoudre l'owner + le club, créer les comptes liés,
-- câbler rôles / profils / promoteur / affilié / staff. Stocke les ids dans _ctx.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_pw        text := 'YunoDemo2026!';
  v_owner     uuid;
  v_venue     text;
  v_org       uuid;
  v_promo     uuid;
  v_aff       uuid;
  v_promoter  uuid;  -- promoters.id (ligne)
  v_affiliate uuid;  -- affiliates.id (ligne)
  v_salt      text;
  v_emails    text[] := ARRAY[
    'organizer@womber.fr','promoter@womber.fr','affiliate@womber.fr',
    'bouncer@womber.fr','barman@womber.fr','cloakroom@womber.fr'];
  e           text;
  uid         uuid;
  rec         record;
BEGIN
  -- 1a. Owner (doit exister)
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'owner@womber.fr introuvable dans auth.users. Crée ce compte (Auth > Add user) puis relance.';
  END IF;

  -- 1b. Club "Womber" : résoudre via owner_id, sinon profiles.venue_id, sinon créer.
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN
    v_venue := 'womber';
    INSERT INTO venues (id, name, city, owner_id, is_hidden, menu_enabled, stripe_charges_enabled, created_at)
    VALUES (v_venue, 'Womber', 'Paris', v_owner, true, true, true, now())
    ON CONFLICT (id) DO NOTHING;
  END IF;
  -- Forcer flags + liaison owner <-> venue (sans toucher au MFA de l'owner).
  UPDATE venues   SET owner_id = v_owner, is_hidden = true, menu_enabled = true,
                      stripe_charges_enabled = true
                  WHERE id = v_venue;
  UPDATE profiles SET venue_id = v_venue WHERE id = v_owner;
  RAISE NOTICE 'Club démo résolu : venue_id = %', v_venue;

  -- 1c. Créer les 6 comptes liés si absents (auth.users + auth.identities).
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
        jsonb_build_object('first_name', initcap(split_part(e, '@', 1)), 'last_name', 'Démo'),
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

  -- 1d. ORGANIZER : rôle + profil orga + onboarding + Stripe débloqué.
  INSERT INTO user_roles (user_id, role)
    SELECT v_org, 'organizer'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_org AND role = 'organizer');
  UPDATE profiles SET
    profile_type = 'organizer',
    onboarding_completed = true,
    organization_name = 'BDE Démo Paris',
    preferred_language = 'fr',
    stripe_connect_account_id = 'acct_demo_org',
    stripe_connect_status = 'active',
    stripe_connect_charges_enabled = true,
    stripe_connect_payouts_enabled = true,
    stripe_connect_onboarded_at = now()
  WHERE id = v_org;
  IF NOT EXISTS (SELECT 1 FROM organizer_profiles WHERE user_id = v_org) THEN
    INSERT INTO organizer_profiles (user_id, display_name, bio, cover_url, is_public)
    VALUES (v_org, 'BDE Démo Paris',
            'Le bureau des étudiants qui fait bouger Paris : soirées, galas et boat parties.',
            'https://images.unsplash.com/photo-1492684223066-81342ee5ff30', true);
  END IF;

  -- 1e. PROMOTER : rôle + ligne promoters (commission 3€/billet, 10%/table).
  INSERT INTO user_roles (user_id, role)
    SELECT v_promo, 'promoter'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_promo AND role = 'promoter');
  SELECT id INTO v_promoter FROM promoters WHERE user_id = v_promo AND venue_id = v_venue;
  IF v_promoter IS NULL THEN
    v_promoter := gen_random_uuid();
    INSERT INTO promoters (id, user_id, venue_id, promo_code, first_name, last_name, is_active,
                           ticket_commission_type, ticket_commission_value,
                           table_commission_type, table_commission_value, can_scan_entries)
    VALUES (v_promoter, v_promo, v_venue, 'WOMBER-DEMO', 'Alex', 'Rivière', true,
            'fixed', 3, 'percentage', 10, true);
  END IF;

  -- 1f. AFFILIATE : rôle + ligne affiliates (agence ville).
  INSERT INTO user_roles (user_id, role)
    SELECT v_aff, 'affiliate'::app_role
    WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_aff AND role = 'affiliate');
  SELECT id INTO v_affiliate FROM affiliates WHERE user_id = v_aff;
  IF v_affiliate IS NULL THEN
    v_affiliate := gen_random_uuid();
    INSERT INTO affiliates (id, user_id, name, city, type, commission_rate, is_active, linktree_slug)
    VALUES (v_affiliate, v_aff, 'Paris Night Agency', 'Paris', 'city_agency', 10, true,
            'paris-night-demo');
  END IF;

  -- 1g. STAFF (videur / barman / vestiaire) : rôle + venue_id + PIN 1234 (sha256 salt:hash).
  FOR rec IN SELECT * FROM (VALUES
      ('bouncer@womber.fr',   'bouncer'),
      ('barman@womber.fr',    'barman'),
      ('cloakroom@womber.fr', 'cloakroom')) s(email, role)
  LOOP
    SELECT id INTO uid FROM auth.users WHERE email = rec.email;
    INSERT INTO user_roles (user_id, role)
      SELECT uid, rec.role::app_role
      WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = uid AND role = rec.role::app_role);
    v_salt := gen_random_uuid()::text;
    UPDATE profiles SET
      venue_id = v_venue,
      employee_pin = v_salt || ':' || encode(extensions.digest('1234' || v_salt, 'sha256'), 'hex')
    WHERE id = uid;
  END LOOP;

  -- 1h. Contexte partagé pour le reste du script.
  CREATE TEMP TABLE _ctx (k text PRIMARY KEY, u uuid, t text);
  INSERT INTO _ctx (k, u, t) VALUES
    ('owner',        v_owner,     NULL),
    ('venue',        NULL,        v_venue),
    ('organizer',    v_org,       NULL),
    ('promoter',     v_promo,     NULL),
    ('affiliate',    v_aff,       NULL),
    ('promoter_id',  v_promoter,  NULL),
    ('affiliate_id', v_affiliate, NULL);
END $$;

-- ----------------------------------------------------------------------------
-- ÉTAPE 2 — TEARDOWN : effacer les données démo de la run précédente.
-- Scopé par marqueurs (purchase_source='demo_seed', emails @demo.womber.fr,
-- events.access_code='DEMO_SEED', venue, ids démo). Ne touche JAMAIS au compte
-- owner@womber.fr ni à la ligne venue (UPDATE-only).
-- Ordre enfants -> parents.
-- ----------------------------------------------------------------------------
DELETE FROM promoter_conversions WHERE promoter_id = (SELECT u FROM _ctx WHERE k='promoter_id');
DELETE FROM promoter_clicks      WHERE promoter_id = (SELECT u FROM _ctx WHERE k='promoter_id');
DELETE FROM promoter_payouts     WHERE promoter_id = (SELECT u FROM _ctx WHERE k='promoter_id');

DELETE FROM guest_list_entries WHERE guest_list_id IN (
  SELECT id FROM guest_lists
  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
     OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer'));
DELETE FROM guest_lists
  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
     OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer');

DELETE FROM tickets            WHERE purchase_source = 'demo_seed';
DELETE FROM table_reservations WHERE purchase_source = 'demo_seed';
DELETE FROM orders
  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
    AND (order_number LIKE 'DEMO-%' OR user_email LIKE '%@demo.womber.fr');

DELETE FROM ticket_rounds WHERE event_id IN (
  SELECT id FROM events WHERE access_code = 'DEMO_SEED'
    AND (venue_id = (SELECT t FROM _ctx WHERE k='venue')
         OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer')));

DELETE FROM visitor_sessions
  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') AND session_id LIKE 'demo-%';
DELETE FROM venue_customers
  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue') AND email LIKE '%@demo.womber.fr';

DELETE FROM vip_tables  WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');
DELETE FROM table_zones WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');

DELETE FROM events WHERE access_code = 'DEMO_SEED'
  AND (venue_id = (SELECT t FROM _ctx WHERE k='venue')
       OR organizer_user_id = (SELECT u FROM _ctx WHERE k='organizer'));

DELETE FROM drinks WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue');

DELETE FROM affiliate_visitor_sessions WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_clicks           WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_events           WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');
DELETE FROM affiliate_venues           WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');

-- ----------------------------------------------------------------------------
-- ÉTAPE 3 — Catalogue du club : boissons, zones VIP, tables.
-- ----------------------------------------------------------------------------
INSERT INTO drinks (id, venue_id, name, price, img_url, collection, active, position)
SELECT 'womber-' || d.slug, (SELECT t FROM _ctx WHERE k='venue'), d.name, d.price, d.img, d.coll, true, d.pos
FROM (VALUES
  ('mojito','Mojito',11,'https://images.unsplash.com/photo-1551538827-9c037cb4f32a','drink',0),
  ('gintonic','Gin Tonic',10,'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b','drink',1),
  ('vodkarb','Vodka Red Bull',12,'https://images.unsplash.com/photo-1470337458703-46ad1756a187','drink',2),
  ('whiskycoca','Whisky Coca',11,'https://images.unsplash.com/photo-1569924995012-c4c706bfcd51','drink',3),
  ('spritz','Aperol Spritz',10,'https://images.unsplash.com/photo-1560512823-829485b8bf24','drink',4),
  ('margarita','Margarita',12,'https://images.unsplash.com/photo-1556679343-c7306c1976bc','drink',5),
  ('tequila','Shot Tequila',5,'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b','shot',6),
  ('jager','Shot Jägermeister',5,'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b','shot',7),
  ('vodkashot','Shot Vodka',4,'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b','shot',8),
  ('coca','Coca-Cola',4,'https://images.unsplash.com/photo-1554866585-cd94860890b7','soft',9),
  ('redbull','Red Bull',5,'https://images.unsplash.com/photo-1613618948931-9b1c6f3a0e1a','soft',10),
  ('eau','Eau minérale',3,'https://images.unsplash.com/photo-1560023907-5f339617ea30','soft',11)
) d(slug, name, price, img, coll, pos);

INSERT INTO table_zones (id, venue_id, name, color, position, price)
SELECT gen_random_uuid(), (SELECT t FROM _ctx WHERE k='venue'), z.name, z.color, z.pos, z.price
FROM (VALUES
  ('Carré VIP','#d4af37',0,400),
  ('Mezzanine','#7c3aed',1,250),
  ('Pit','#06b6d4',2,150)
) z(name, color, pos, price);

INSERT INTO vip_tables (id, venue_id, zone_id, table_number, capacity, price, position_x, position_y)
SELECT gen_random_uuid(), tz.venue_id, tz.id,
       substr(tz.name, 1, 3) || '-' || g, (6 + floor(random()*6))::int, tz.price,
       (random()*800)::int, (random()*500)::int
FROM table_zones tz
CROSS JOIN LATERAL generate_series(1, 4) g
WHERE tz.venue_id = (SELECT t FROM _ctx WHERE k='venue');

-- ----------------------------------------------------------------------------
-- ÉTAPE 4 — Events (club + orga), répartis sur ~90 jours passés + à venir.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _ev AS
SELECT slug, id, kind, title, doff, ticketing, tables, genre,
       (((now()::date + doff)::timestamp + time '23:00') AT TIME ZONE 'Europe/Paris') AS start_ts
FROM (VALUES
  -- slug, id, kind, title, jours_offset, ticketing, tables, genre
  ('v1',  gen_random_uuid(), 'venue', 'Friday Night Sessions',  -84, true,  true,  'house'),
  ('v2',  gen_random_uuid(), 'venue', 'Techno Warehouse',       -70, true,  true,  'techno'),
  ('v3',  gen_random_uuid(), 'venue', 'Hip-Hop All Stars',      -56, true,  false, 'hip-hop'),
  ('v4',  gen_random_uuid(), 'venue', 'Afro Vibes',             -42, true,  true,  'afro'),
  ('v5',  gen_random_uuid(), 'venue', 'Ladies Night',           -28, true,  false, 'open'),
  ('v6',  gen_random_uuid(), 'venue', 'House Marathon',         -14, true,  true,  'house'),
  ('v7',  gen_random_uuid(), 'venue', 'Saturday Fever',          -5, true,  true,  'disco'),
  ('v8',  gen_random_uuid(), 'venue', 'Reggaeton Party',          4, true,  true,  'latino'),
  ('v9',  gen_random_uuid(), 'venue', 'Open Format Saturdays',   12, true,  true,  'open'),
  ('v10', gen_random_uuid(), 'venue', 'Techno Sunrise',          26, true,  false, 'techno'),
  ('o1',  gen_random_uuid(), 'org',   'Soirée BDE — Welcome',   -50, true,  false, 'open'),
  ('o2',  gen_random_uuid(), 'org',   'Gala Étudiant',          -20, true,  false, 'open'),
  ('o3',  gen_random_uuid(), 'org',   'Boat Party Seine',         7, true,  false, 'house'),
  ('o4',  gen_random_uuid(), 'org',   'After-Exams Bash',        20, true,  false, 'open')
) v(slug, id, kind, title, doff, ticketing, tables, genre);

INSERT INTO events (id, title, start_at, end_at, venue_id, organizer_user_id,
  music_genre, event_type, event_kind, event_mode, visibility, is_active, is_discoverable,
  ticketing_enabled, tables_enabled, access_code, location_name, location_city,
  image_url, poster_url, created_at)
SELECT e.id, e.title, e.start_ts, e.start_ts + interval '6 hours',
  CASE WHEN e.kind = 'venue' THEN (SELECT t FROM _ctx WHERE k='venue') END,
  CASE WHEN e.kind = 'org'   THEN (SELECT u FROM _ctx WHERE k='organizer') END,
  e.genre, 'club',
  (CASE WHEN e.kind = 'org' THEN 'organizer_event' ELSE 'club_event' END)::event_kind,
  (CASE WHEN e.kind = 'org' THEN 'solo_organizer' ELSE 'solo_venue' END)::event_mode,
  'private'::event_visibility, true, false,
  e.ticketing, e.tables, 'DEMO_SEED',
  CASE WHEN e.kind = 'org' THEN 'Salle Wagram' END, 'Paris',
  'https://images.unsplash.com/photo-1566737236500-c8ac43014a67',
  'https://images.unsplash.com/photo-1566737236500-c8ac43014a67',
  e.start_ts - interval '30 days'
FROM _ev e;

-- Paliers de billets (Early Bird / Regular / Last Tickets) par event ticketé.
CREATE TEMP TABLE _round AS
SELECT gen_random_uuid() AS id, e.id AS event_id, e.doff AS doff, e.start_ts AS start_ts,
       r.name, r.price, r.maxt, r.pos
FROM _ev e
CROSS JOIN (VALUES
  ('Early Bird', 12, 80, 0),
  ('Regular',    16, 150, 1),
  ('Last Tickets', 20, 100, 2)
) r(name, price, maxt, pos)
WHERE e.ticketing;

INSERT INTO ticket_rounds (id, event_id, name, price, max_tickets, position, ticket_type, is_active, tickets_sold)
SELECT id, event_id, name, price, maxt, pos, 'standard', true, 0 FROM _round;

-- ----------------------------------------------------------------------------
-- ÉTAPE 5 — Billets payés (étalés avant chaque event ; passés = scannés).
-- Math frais cohérente : service_fee = max(0.99, 4%), total = sous-total + frais,
-- CA Club = total - service_fee - insurance_fee = sous-total.
-- ----------------------------------------------------------------------------
INSERT INTO tickets (event_id, ticket_round_id, user_id, user_email, full_name, is_guest,
  quantity, unit_price, total_price, service_fee, insurance_fee, status, ticket_type,
  qr_code, purchase_source, paid_at, created_at, used, entry_scanned, entry_scanned_at)
SELECT
  r.event_id, r.id, NULL,
  'buyer' || (1 + floor(random()*60))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  true,
  q.qty, r.price,
  round(r.price * q.qty + greatest(0.99, r.price * q.qty * 0.04), 2),
  round(greatest(0.99, r.price * q.qty * 0.04), 2),
  0, 'paid', 'standard',
  'demo-tkt-' || gen_random_uuid()::text, 'demo_seed',
  ts.t, ts.t,
  sc.scanned, sc.scanned,
  CASE WHEN sc.scanned THEN r.start_ts + interval '1 hour' END
FROM _round r
CROSS JOIN LATERAL generate_series(1,
  (CASE WHEN r.doff < 0 THEN 4 + floor(random()*11)
        WHEN r.doff <= 21 THEN 2 + floor(random()*6)
        ELSE floor(random()*2) END)::int) gs
CROSS JOIN LATERAL (SELECT (1 + floor(random()*3))::int AS qty) q
CROSS JOIN LATERAL (SELECT (r.doff < 0 AND random() < 0.78) AS scanned) sc
CROSS JOIN LATERAL (SELECT least(
    now() - interval '1 hour',
    (r.start_ts - interval '30 days') + random() * (least(r.start_ts, now()) - (r.start_ts - interval '30 days'))
  ) AS t) ts;

UPDATE ticket_rounds tr
SET tickets_sold = COALESCE(
  (SELECT sum(t.quantity) FROM tickets t WHERE t.ticket_round_id = tr.id AND t.status = 'paid'), 0)
WHERE tr.id IN (SELECT id FROM _round);

-- ----------------------------------------------------------------------------
-- ÉTAPE 6 — Commandes bar (boissons), ~220 sur 90 jours.
-- items jsonb porte les DEUX formes de clés (writer + readers analytics).
-- service_fee = 5%, total = sous-total + frais, CA Club = total - service_fee.
-- ----------------------------------------------------------------------------
INSERT INTO orders (venue_id, event_id, user_id, user_email, items, total, service_fee,
  status, paid_at, created_at, order_number, is_guest)
SELECT
  (SELECT t FROM _ctx WHERE k='venue'), NULL, NULL,
  'buyer' || (1 + floor(random()*60))::int || '@demo.womber.fr',
  li.items,
  round(li.subtotal + round(li.subtotal * 0.05, 2), 2),
  round(li.subtotal * 0.05, 2),
  CASE WHEN random() < 0.85 THEN 'paid' ELSE 'served' END,
  ts.t, ts.t,
  'DEMO-' || g, true
FROM generate_series(1, 220) g
CROSS JOIN LATERAL (SELECT now() - (random()*90) * interval '1 day' - (random()*6) * interval '1 hour' AS t) ts
CROSS JOIN LATERAL (
  SELECT
    jsonb_agg(jsonb_build_object(
      'id', d.id, 'drinkId', d.id, 'name', d.name,
      'price', d.price, 'unitPrice', d.price,
      'qty', dq.q, 'quantity', dq.q, 'collection', d.collection)) AS items,
    sum(d.price * dq.q) AS subtotal
  FROM (
    SELECT id, name, price, collection FROM drinks
    WHERE venue_id = (SELECT t FROM _ctx WHERE k='venue')
    ORDER BY random() LIMIT (1 + floor(random()*3))::int
  ) d
  CROSS JOIN LATERAL (SELECT (1 + floor(random()*2))::int AS q) dq
) li
WHERE li.items IS NOT NULL;

-- ----------------------------------------------------------------------------
-- ÉTAPE 7 — Réservations de tables VIP payées (events club avec tables).
-- management_fee = max(0.99, 4%), total_price = base + management_fee,
-- deposit = total_price (le dashboard home lit deposit). service_fee = 0.
-- ----------------------------------------------------------------------------
-- Une table DISTINCTE par (event) : row_number sur les tables mélangées, puis on
-- garde les rn <= nombre voulu de résas pour cet event (contrainte unique table_id+event_id).
WITH ev AS (
  SELECT id AS event_id, doff, start_ts,
         (CASE WHEN doff < 0 THEN 2 + floor(random()*4)
               WHEN doff <= 21 THEN floor(random()*3)
               ELSE 0 END)::int AS cnt
  FROM _ev WHERE tables
),
ranked AS (
  SELECT e.event_id, e.doff, e.start_ts, e.cnt, vt.id AS table_id, vt.zone_id,
         row_number() OVER (PARTITION BY e.event_id ORDER BY random()) AS rn
  FROM ev e
  CROSS JOIN vip_tables vt
  WHERE vt.venue_id = (SELECT t FROM _ctx WHERE k='venue')
)
INSERT INTO table_reservations (event_id, table_id, zone_id, user_id, user_email, full_name,
  is_guest, guest_count, total_price, deposit, service_fee, management_fee, status,
  paid_at, created_at, purchase_source, entry_scanned, entry_scanned_at)
SELECT
  r.event_id, r.table_id, r.zone_id, NULL,
  'buyer' || (1 + floor(random()*60))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  true, (4 + floor(random()*6))::int,
  base.total, base.total, 0, base.mgmt, 'paid',
  ts.t, ts.t, 'demo_seed',
  sc.scanned, CASE WHEN sc.scanned THEN r.start_ts + interval '1 hour' END
FROM ranked r
CROSS JOIN LATERAL (SELECT (150 + floor(random()*250))::numeric AS b) bb
CROSS JOIN LATERAL (SELECT
    round(greatest(0.99, bb.b * 0.04), 2) AS mgmt,
    round(bb.b + greatest(0.99, bb.b * 0.04), 2) AS total) base
CROSS JOIN LATERAL (SELECT (r.doff < 0 AND random() < 0.7) AS scanned) sc
CROSS JOIN LATERAL (SELECT least(
    now() - interval '1 hour',
    (r.start_ts - interval '20 days') + random() * (least(r.start_ts, now()) - (r.start_ts - interval '20 days'))
  ) AS t) ts
WHERE r.rn <= r.cnt;

-- ----------------------------------------------------------------------------
-- ÉTAPE 8 — Sessions visiteurs (funnel : panier -> checkout -> commande).
-- ----------------------------------------------------------------------------
INSERT INTO visitor_sessions (session_id, venue_id, visited_at, created_at,
  added_to_cart, proceeded_to_checkout, completed_order, device_type, pages_viewed, duration_seconds)
SELECT
  'demo-' || gen_random_uuid()::text, (SELECT t FROM _ctx WHERE k='venue'),
  ts.t, ts.t,
  c.cart, ck.chk, cp.comp,
  (ARRAY['mobile','desktop','tablet'])[(1 + floor(random()*3))::int],
  (1 + floor(random()*8))::int, (30 + floor(random()*600))::int
FROM generate_series(1, 220) g
CROSS JOIN LATERAL (SELECT now() - (random()*90) * interval '1 day' AS t) ts
CROSS JOIN LATERAL (SELECT random() < 0.45 AS cart) c
CROSS JOIN LATERAL (SELECT c.cart AND random() < 0.6 AS chk) ck
CROSS JOIN LATERAL (SELECT ck.chk AND random() < 0.6 AS comp) cp;

-- ----------------------------------------------------------------------------
-- ÉTAPE 9 — CRM clients (emails alignés sur les acheteurs des ventes ci-dessus).
-- Le RPC get_venue_customer_segments recalcule le RFM depuis les ventes par email.
-- ----------------------------------------------------------------------------
INSERT INTO venue_customers (venue_id, user_id, email, first_name, last_name, phone,
  first_visit_at, last_visit_at, total_spent, ticket_count, order_count, table_count,
  is_banned, ban_reason)
SELECT
  (SELECT t FROM _ctx WHERE k='venue'), gen_random_uuid(),
  'buyer' || g || '@demo.womber.fr',
  (ARRAY['Lucas','Emma','Hugo','Léa','Nathan','Chloé','Théo','Manon','Enzo','Camille'])[(1 + floor(random()*10))::int],
  (ARRAY['Martin','Bernard','Dubois','Moreau','Petit','Laurent','Garcia','Roux','Fontaine','Girard'])[(1 + floor(random()*10))::int],
  '+336' || lpad((floor(random()*100000000))::int::text, 8, '0'),
  now() - (60 + random()*120) * interval '1 day',
  now() - (random()*25) * interval '1 day',
  round((20 + random()*600)::numeric, 2),
  (floor(random()*8))::int, (floor(random()*15))::int, (floor(random()*3))::int,
  (g <= 2), CASE WHEN g <= 2 THEN 'Comportement agressif à l''entrée' END
FROM generate_series(1, 40) g;

-- ----------------------------------------------------------------------------
-- ÉTAPE 10 — Promoteur : clics, conversions (sur de vrais billets/tables), payouts.
-- ----------------------------------------------------------------------------
INSERT INTO promoter_clicks (promoter_id, clicked_at, source, event_id)
SELECT (SELECT u FROM _ctx WHERE k='promoter_id'),
  now() - (random()*60) * interval '1 day',
  (ARRAY['instagram','whatsapp','direct','tiktok','story'])[(1 + floor(random()*5))::int],
  (SELECT id FROM _ev WHERE kind = 'venue' ORDER BY random() LIMIT 1)
FROM generate_series(1, 90) g;

INSERT INTO promoter_conversions (promoter_id, conversion_type, event_id, ticket_id,
  amount, commission, status, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_id'), 'ticket', t.event_id, t.id,
  round(t.total_price - t.service_fee - COALESCE(t.insurance_fee, 0), 2), 3,
  CASE WHEN t.rnd < 0.55 THEN 'paid' ELSE 'pending' END,
  t.created_at,
  CASE WHEN t.rnd < 0.55 THEN t.created_at + interval '7 days' END
FROM (
  SELECT id, event_id, total_price, service_fee, insurance_fee, created_at, random() AS rnd
  FROM tickets WHERE purchase_source = 'demo_seed' ORDER BY random() LIMIT 25
) t;

INSERT INTO promoter_conversions (promoter_id, conversion_type, event_id, table_reservation_id,
  amount, commission, status, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_id'), 'table', r.event_id, r.id,
  round(r.total_price - COALESCE(r.management_fee, 0), 2),
  round((r.total_price - COALESCE(r.management_fee, 0)) * 0.10, 2),
  CASE WHEN r.rnd < 0.5 THEN 'paid' ELSE 'pending' END,
  r.created_at,
  CASE WHEN r.rnd < 0.5 THEN r.created_at + interval '7 days' END
FROM (
  SELECT id, event_id, total_price, management_fee, created_at, random() AS rnd
  FROM table_reservations WHERE purchase_source = 'demo_seed' ORDER BY random() LIMIT 8
) r;

UPDATE promoters SET
  pending_amount = COALESCE((SELECT sum(commission) FROM promoter_conversions
                             WHERE promoter_id = promoters.id AND status = 'pending'), 0),
  total_paid     = COALESCE((SELECT sum(commission) FROM promoter_conversions
                             WHERE promoter_id = promoters.id AND status = 'paid'), 0)
WHERE id = (SELECT u FROM _ctx WHERE k='promoter_id');

INSERT INTO promoter_payouts (promoter_id, venue_id, amount, status, period_label, created_at, paid_at)
SELECT (SELECT u FROM _ctx WHERE k='promoter_id'), (SELECT t FROM _ctx WHERE k='venue'),
  round((50 + random()*150)::numeric, 2), 'paid',
  to_char(now() - (g * 30) * interval '1 day', 'YYYY-MM'),
  now() - (g * 30) * interval '1 day', now() - (g * 30) * interval '1 day'
FROM generate_series(1, 3) g;

-- ----------------------------------------------------------------------------
-- ÉTAPE 11 — Guest lists (events récents/à venir) + entrées (certaines scannées).
-- ----------------------------------------------------------------------------
INSERT INTO guest_lists (event_id, venue_id, quota, free_before_time, is_active,
  share_token, visible_on_club_page, organizer_user_id)
SELECT e.id,
  CASE WHEN e.kind = 'venue' THEN (SELECT t FROM _ctx WHERE k='venue') END,
  120, '01:00', true,
  'demo-' || substr(md5(random()::text), 1, 10), true,
  CASE WHEN e.kind = 'org' THEN (SELECT u FROM _ctx WHERE k='organizer') END
FROM _ev e
WHERE e.doff BETWEEN -7 AND 30;

INSERT INTO guest_list_entries (guest_list_id, full_name, email, phone, gender, qr_code,
  status, entry_scanned, entry_scanned_at, promoter_id, created_at)
SELECT gl.id,
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  'guest' || g || '-' || substr(md5(random()::text), 1, 4) || '@demo.womber.fr',
  '+336' || lpad((floor(random()*100000000))::int::text, 8, '0'),
  (ARRAY['M','F'])[(1 + floor(random()*2))::int],
  'demo-gl-' || gen_random_uuid()::text,
  'pending',
  sc.scanned, CASE WHEN sc.scanned THEN ev.start_ts + interval '1 hour' END,
  CASE WHEN random() < 0.5 THEN (SELECT u FROM _ctx WHERE k='promoter_id') END,
  ev.start_ts - (random()*14) * interval '1 day'
FROM guest_lists gl
JOIN _ev ev ON ev.id = gl.event_id
CROSS JOIN LATERAL generate_series(1, (15 + floor(random()*20))::int) g
CROSS JOIN LATERAL (SELECT (ev.doff < 0 AND random() < 0.7) AS scanned) sc;

-- ----------------------------------------------------------------------------
-- ÉTAPE 12 — Affilié : clubs partenaires, events (1 sans URL = warning), clics, vues.
-- ----------------------------------------------------------------------------
INSERT INTO affiliate_venues (affiliate_id, name, slug, city, is_active, genres)
SELECT (SELECT u FROM _ctx WHERE k='affiliate_id'), x.name,
  'demo-' || x.s || '-' || substr(md5(random()::text), 1, 6), 'Paris', true, ARRAY['house','techno']
FROM (VALUES ('Le Rex Club','rex'), ('Concrete','concrete')) x(name, s);

CREATE TEMP TABLE _aff_ev AS
SELECT gen_random_uuid() AS id, x.name,
  'demo-aev-' || x.s || '-' || substr(md5(random()::text), 1, 6) AS slug,
  (now()::date + x.doff) AS event_date, x.doff
FROM (VALUES
  ('Techno Night @ Rex', -25, 'rex1'),
  ('Concrete Open Air',  -12, 'conc1'),
  ('House Sessions',      -3, 'house1'),
  ('Boiler Room Paris',    6, 'boiler1'),
  ('Sunrise Festival',    18, 'sunrise1'),
  ('Warehouse Rave',      30, 'ware1')
) x(name, doff, s);

INSERT INTO affiliate_events (id, affiliate_id, affiliate_venue_id, name, slug, event_date,
  external_ticket_url)
SELECT ae.id, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT id FROM affiliate_venues
   WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id') ORDER BY random() LIMIT 1),
  ae.name, ae.slug, ae.event_date,
  CASE WHEN ae.name = 'Boiler Room Paris' THEN NULL ELSE 'https://shotgun.live/fr/events/demo' END
FROM _aff_ev ae;

INSERT INTO affiliate_clicks (affiliate_event_id, affiliate_id, affiliate_venue_id, clicked_at,
  is_internal, device_type)
SELECT ae.id, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT affiliate_venue_id FROM affiliate_events WHERE id = ae.id),
  now() - (random()*60) * interval '1 day', false,
  (ARRAY['mobile','desktop'])[(1 + floor(random()*2))::int]
FROM _aff_ev ae
CROSS JOIN LATERAL generate_series(1, (15 + floor(random()*25))::int) g;

INSERT INTO affiliate_visitor_sessions (session_id, affiliate_id, affiliate_event_id, visited_at,
  is_internal, device_type)
SELECT 'demo-aff-' || gen_random_uuid()::text, (SELECT u FROM _ctx WHERE k='affiliate_id'),
  (SELECT id FROM _aff_ev ORDER BY random() LIMIT 1),
  now() - (random()*60) * interval '1 day', false,
  (ARRAY['mobile','desktop'])[(1 + floor(random()*2))::int]
FROM generate_series(1, 110) g;

-- ----------------------------------------------------------------------------
-- ÉTAPE 13 — Récap de ce qui a été semé.
-- ----------------------------------------------------------------------------
SELECT 'club (venue_id)' AS objet, (SELECT t FROM _ctx WHERE k='venue') AS valeur
UNION ALL SELECT 'events',            count(*)::text FROM events WHERE access_code = 'DEMO_SEED'
UNION ALL SELECT 'ticket_rounds',     count(*)::text FROM ticket_rounds WHERE id IN (SELECT id FROM _round)
UNION ALL SELECT 'tickets',           count(*)::text FROM tickets WHERE purchase_source = 'demo_seed'
UNION ALL SELECT 'orders (bar)',      count(*)::text FROM orders WHERE order_number LIKE 'DEMO-%'
UNION ALL SELECT 'tables VIP réservées', count(*)::text FROM table_reservations WHERE purchase_source = 'demo_seed'
UNION ALL SELECT 'visitor_sessions',  count(*)::text FROM visitor_sessions WHERE session_id LIKE 'demo-%'
UNION ALL SELECT 'venue_customers',   count(*)::text FROM venue_customers WHERE email LIKE '%@demo.womber.fr'
UNION ALL SELECT 'promoter_clicks',   count(*)::text FROM promoter_clicks WHERE promoter_id = (SELECT u FROM _ctx WHERE k='promoter_id')
UNION ALL SELECT 'promoter_conversions', count(*)::text FROM promoter_conversions WHERE promoter_id = (SELECT u FROM _ctx WHERE k='promoter_id')
UNION ALL SELECT 'guest_list_entries', count(*)::text FROM guest_list_entries WHERE qr_code LIKE 'demo-gl-%'
UNION ALL SELECT 'affiliate_clicks',  count(*)::text FROM affiliate_clicks WHERE affiliate_id = (SELECT u FROM _ctx WHERE k='affiliate_id');

-- Fin. Tables temporaires (_ctx,_ev,_round,_aff_ev) auto-nettoyées en fin de session.
