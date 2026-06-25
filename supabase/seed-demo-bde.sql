-- ============================================================================
-- SEED DÉMO BDE — données MESURÉES sur bde@womber.fr (organisateur BDE).
--   • CA total visé < 10 000 €
--   • billets moyens ~8 € (prévente 6 / standard 8 / sur place 10)
--   • tables minimes (<5 % du mix)
--   • une soirée RÉCURRENTE tous les jeudis (template + occurrences)
-- Idempotent : teardown en tête (tags bde_demo_seed / BDE_DEMO / bde-demo-*).
-- ============================================================================
DO $$
DECLARE
  v_bde  uuid;
  v_tmpl uuid;
BEGIN
  SELECT id INTO v_bde FROM auth.users WHERE email = 'bde@womber.fr';
  IF v_bde IS NULL THEN RAISE EXCEPTION 'bde@womber.fr introuvable — crée d''abord le compte démo.'; END IF;

  -- Teardown (enfants -> parents).
  DELETE FROM tickets             WHERE purchase_source = 'bde_demo_seed';
  DELETE FROM table_reservations  WHERE purchase_source = 'bde_demo_seed';
  DELETE FROM guest_list_entries  WHERE qr_code LIKE 'bde-demo-gl-%';
  DELETE FROM guest_lists         WHERE organizer_user_id = v_bde AND share_token LIKE 'bde-demo-%';
  DELETE FROM ticket_rounds       WHERE event_id IN (SELECT id FROM events WHERE access_code = 'BDE_DEMO' AND organizer_user_id = v_bde);
  DELETE FROM visitor_sessions    WHERE session_id LIKE 'bde-demo-%';
  DELETE FROM events              WHERE access_code = 'BDE_DEMO' AND organizer_user_id = v_bde;
  DELETE FROM owner_recurring_templates WHERE organizer_user_id = v_bde AND name = 'Jeudi Étudiant';

  -- Template récurrent : tous les JEUDIS (day_of_week 4, 0=dimanche).
  INSERT INTO owner_recurring_templates
    (organizer_user_id, name, description, day_of_week, start_time, end_time,
     event_type, music_genres, is_active, advance_days, auto_enable_tables)
  VALUES
    (v_bde, 'Jeudi Étudiant',
     'La soirée étudiante hebdomadaire du BDE — tous les jeudis. Entrée à petit prix sur présentation de la carte étudiante.',
     4, '22:00', '03:00', 'club', ARRAY['open','house'], true, 21, false)
  RETURNING id INTO v_tmpl;

  CREATE TEMP TABLE _bctx (k text PRIMARY KEY, u uuid);
  INSERT INTO _bctx VALUES ('bde', v_bde), ('tmpl', v_tmpl);
END $$;

-- ----------------------------------------------------------------------------
-- Occurrences : 12 jeudis passés (ventes) + 3 à venir (peu/pas de ventes).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _bev AS
SELECT gen_random_uuid() AS id,
       d.g,
       (d.g >= 1) AS is_past,
       (50 + floor(random()*35))::int AS n_tickets,   -- 50-85 billets / soirée passée
       ((d.dthu + time '22:00') AT TIME ZONE 'Europe/Paris') AS start_ts,
       d.dthu
FROM (
  SELECT g, (date_trunc('week', now())::date + 3 - g*7) AS dthu
  FROM generate_series(-2, 12) g                       -- g<=0 : à venir ; g>=1 : passé
) d;

INSERT INTO events (id, title, start_at, end_at, organizer_user_id, description,
  music_genre, event_type, event_kind, event_mode, visibility, is_active, is_discoverable,
  ticketing_enabled, tables_enabled, access_code, location_name, location_city,
  image_url, poster_url, recurring_template_id, created_at)
SELECT e.id,
  'Jeudi Étudiant — ' || to_char(e.dthu, 'DD/MM'),
  e.start_ts, e.start_ts + interval '5 hours',
  (SELECT u FROM _bctx WHERE k='bde'),
  'Soirée étudiante hebdomadaire du BDE. Tarif mini, ambiance maxi. Carte étudiante demandée à l''entrée. Lieu communiqué par lien aux inscrits.',
  'open', 'club',
  'private_event'::event_kind, 'solo_organizer'::event_mode,
  'private'::event_visibility, true, false,
  true, e.is_past, 'BDE_DEMO', 'Campus Party', 'Toulouse',
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7',
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7',
  (SELECT u FROM _bctx WHERE k='tmpl'),
  e.start_ts - interval '21 days'
FROM _bev e;

-- ----------------------------------------------------------------------------
-- Rounds billets (3 paliers / soirée passée) — moyenne pondérée ~7,9 €.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE _bround AS
SELECT gen_random_uuid() AS id, e.id AS event_id, e.start_ts, e.n_tickets,
       r.name, r.price, r.pos, r.share
FROM _bev e
CROSS JOIN (VALUES
  ('Prévente étudiante', 6, 0, 0.30),
  ('Standard',           8, 1, 0.45),
  ('Sur place',          10, 2, 0.25)
) r(name, price, pos, share)
WHERE e.is_past;

INSERT INTO ticket_rounds (id, event_id, name, price, max_tickets, position, ticket_type, is_active, tickets_sold)
SELECT id, event_id, name, price, 300, pos, 'standard', true, 0 FROM _bround;

-- ----------------------------------------------------------------------------
-- Billets payés (qty 1 = 1 entrée). service_fee = plancher BDE 0,49 €.
-- CA Club billet = total_price - service_fee = prix du palier.
-- ----------------------------------------------------------------------------
INSERT INTO tickets (event_id, ticket_round_id, user_id, user_email, full_name, is_guest,
  quantity, unit_price, total_price, service_fee, insurance_fee, status, ticket_type,
  qr_code, purchase_source, paid_at, created_at, used, entry_scanned, entry_scanned_at)
SELECT
  br.event_id, br.id, NULL,
  'etudiant' || (1 + floor(random()*220))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard',
         'Jade Lefebvre','Tom Mercier','Inès Faure','Noah Blanc','Sarah Henry'])[(1 + floor(random()*15))::int],
  true, 1, br.price,
  round(br.price + greatest(0.49, br.price * 0.04), 2),
  round(greatest(0.49, br.price * 0.04), 2), 0, 'paid', 'standard',
  'bde-demo-tkt-' || gen_random_uuid()::text, 'bde_demo_seed', ts.t, ts.t,
  sc.scanned, sc.scanned, CASE WHEN sc.scanned THEN br.start_ts + interval '1 hour' END
FROM _bround br
CROSS JOIN LATERAL generate_series(1, greatest(1, round(br.n_tickets * br.share)::int)) gs
CROSS JOIN LATERAL (SELECT (random() < 0.82) AS scanned) sc
CROSS JOIN LATERAL (SELECT least(now() - interval '1 hour',
    (br.start_ts - interval '18 days') + random() * (least(br.start_ts, now()) - (br.start_ts - interval '18 days'))) AS t) ts;

UPDATE ticket_rounds tr SET tickets_sold = COALESCE(
  (SELECT sum(t.quantity) FROM tickets t WHERE t.ticket_round_id = tr.id AND t.status = 'paid'), 0)
WHERE tr.id IN (SELECT id FROM _bround);

-- ----------------------------------------------------------------------------
-- Tables : 3 réservations « asso » sur les 3 jeudis récents (~90 € chacune).
-- <5 % du mix revenu. table_id/zone_id null (event organisateur sans club).
-- ----------------------------------------------------------------------------
INSERT INTO table_reservations (event_id, table_id, zone_id, user_id, user_email, full_name,
  is_guest, guest_count, total_price, deposit, service_fee, management_fee, status,
  paid_at, created_at, purchase_source, entry_scanned, entry_scanned_at)
SELECT e.id, NULL, NULL, NULL,
  'asso' || e.g || '@demo.womber.fr',
  'Asso ' || (ARRAY['Rugby','Théâtre','Gala','BDS'])[(1 + floor(random()*4))::int],
  true, (8 + floor(random()*6))::int,
  round(90 + greatest(0.49, 90 * 0.04), 2), 90, 0, round(greatest(0.49, 90 * 0.04), 2), 'paid',
  e.start_ts - interval '5 days', e.start_ts - interval '5 days', 'bde_demo_seed', true, e.start_ts + interval '1 hour'
FROM _bev e WHERE e.g IN (1, 2, 3);

-- ----------------------------------------------------------------------------
-- Remboursements : quelques annulations (onglet Refunds).
-- ----------------------------------------------------------------------------
UPDATE tickets SET status = 'refunded', refund_amount = round(total_price * 0.8, 2),
  refund_reason = 'Annulation étudiant', refunded_at = created_at + interval '2 days'
WHERE id IN (SELECT id FROM tickets WHERE purchase_source = 'bde_demo_seed' AND status = 'paid' ORDER BY random() LIMIT 5);

-- ----------------------------------------------------------------------------
-- Guest list (les 6 jeudis récents) — entrées « +1 » gratuites.
-- ----------------------------------------------------------------------------
INSERT INTO guest_lists (event_id, organizer_user_id, quota, free_before_time, is_active, share_token, visible_on_club_page)
SELECT e.id, (SELECT u FROM _bctx WHERE k='bde'), 150, '00:30', true,
  'bde-demo-' || substr(md5(random()::text), 1, 10), true
FROM _bev e WHERE e.g BETWEEN 1 AND 6;

INSERT INTO guest_list_entries (guest_list_id, full_name, email, phone, gender, qr_code, status, entry_scanned, entry_scanned_at, created_at)
SELECT gl.id,
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  'guest' || gs.n || '-' || substr(md5(random()::text), 1, 4) || '@demo.womber.fr',
  '+336' || lpad((floor(random()*100000000))::int::text, 8, '0'),
  (ARRAY['M','F'])[(1 + floor(random()*2))::int], 'bde-demo-gl-' || gen_random_uuid()::text, 'pending',
  sc.scanned, CASE WHEN sc.scanned THEN ev.start_ts + interval '1 hour' END,
  ev.start_ts - (random()*9) * interval '1 day'
FROM guest_lists gl JOIN _bev ev ON ev.id = gl.event_id
CROSS JOIN LATERAL generate_series(1, (12 + floor(random()*14))::int) AS gs(n)
CROSS JOIN LATERAL (SELECT (ev.is_past AND random() < 0.7) AS scanned) sc
WHERE gl.share_token LIKE 'bde-demo-%';

-- ----------------------------------------------------------------------------
-- Sessions visiteurs (funnel) — onglet Trafic/Engagement de l'orga.
-- ----------------------------------------------------------------------------
INSERT INTO visitor_sessions (session_id, venue_id, organizer_user_id, visited_at, created_at,
  added_to_cart, proceeded_to_checkout, completed_order, device_type, pages_viewed, duration_seconds)
SELECT 'bde-demo-' || gen_random_uuid()::text, NULL, (SELECT u FROM _bctx WHERE k='bde'),
  ts.t, ts.t, c.cart, ck.chk, cp.comp,
  (ARRAY['mobile','mobile','desktop','tablet'])[(1 + floor(random()*4))::int],
  (1 + floor(random()*6))::int, (30 + floor(random()*400))::int
FROM generate_series(1, 320) g
CROSS JOIN LATERAL (SELECT now() - (power(random(), 1.6) * 70) * interval '1 day' AS t) ts
CROSS JOIN LATERAL (SELECT random() < 0.5 AS cart) c
CROSS JOIN LATERAL (SELECT c.cart AND random() < 0.6 AS chk) ck
CROSS JOIN LATERAL (SELECT ck.chk AND random() < 0.6 AS comp) cp;

-- ----------------------------------------------------------------------------
-- Récap (vérifie CA TOTAL < 10 000 € et la part tables < 5 %).
-- ----------------------------------------------------------------------------
WITH tk AS (
  SELECT COALESCE(sum(total_price - service_fee - COALESCE(insurance_fee,0)),0) AS ca
  FROM tickets WHERE purchase_source='bde_demo_seed' AND status='paid'
), tb AS (
  SELECT COALESCE(sum(total_price - COALESCE(management_fee,0)),0) AS ca
  FROM table_reservations WHERE purchase_source='bde_demo_seed' AND status='paid'
)
SELECT 'soirées (occurrences)' AS objet, count(*)::text AS valeur FROM events WHERE access_code='BDE_DEMO'
UNION ALL SELECT 'billets payés',     count(*)::text FROM tickets WHERE purchase_source='bde_demo_seed' AND status='paid'
UNION ALL SELECT 'billets remboursés', count(*)::text FROM tickets WHERE purchase_source='bde_demo_seed' AND status='refunded'
UNION ALL SELECT 'prix moyen billet (€)', round((SELECT avg(unit_price) FROM tickets WHERE purchase_source='bde_demo_seed' AND status='paid'),2)::text
UNION ALL SELECT 'CA billets (€)',     round((SELECT ca FROM tk))::text
UNION ALL SELECT 'tables',             count(*)::text FROM table_reservations WHERE purchase_source='bde_demo_seed'
UNION ALL SELECT 'CA tables (€)',      round((SELECT ca FROM tb))::text
UNION ALL SELECT 'part tables (%)',    round((SELECT tb.ca FROM tb) / NULLIF((SELECT tk.ca FROM tk) + (SELECT tb.ca FROM tb),0) * 100, 1)::text
UNION ALL SELECT 'CA TOTAL (€)',       round((SELECT tk.ca FROM tk) + (SELECT tb.ca FROM tb))::text
UNION ALL SELECT 'guest entries',      count(*)::text FROM guest_list_entries WHERE qr_code LIKE 'bde-demo-gl-%'
UNION ALL SELECT 'visitor_sessions',   count(*)::text FROM visitor_sessions WHERE session_id LIKE 'bde-demo-%';
