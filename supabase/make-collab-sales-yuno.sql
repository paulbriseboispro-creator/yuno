-- ============================================================================
-- Ventes / CA sur les soirées CO-EVENT house (club Yuno <-> orga Yuno).
-- Crée 6 soirées collab PASSÉES (vendredis) + garde celle à venir, et y ajoute
-- billets + tables + revenue_distributions (split 70/30) → la page Collaboration
-- et les deux dashboards (club + orga) affichent du CA réel sur la collab.
--
-- À COLLER DANS : SQL editor / supabase db query --linked -f. Idempotent.
-- Ventes taguées purchase_source='demo_seed' + emails @demo.womber.fr (cleanables).
-- ============================================================================

DROP TABLE IF EXISTS _coev, _cctx;

DO $$
DECLARE
  v_venue text := 'womber';
  v_org   uuid;
  v_poster text; v_desc text; v_pos jsonb;
  d date; i int; v_ev uuid;
BEGIN
  SELECT id INTO v_org FROM auth.users WHERE email = 'organizer@womber.fr';
  IF v_org IS NULL THEN RAISE EXCEPTION 'orga introuvable'; END IF;
  -- branding repris du co-event existant
  SELECT poster_url, description, poster_position INTO v_poster, v_desc, v_pos
  FROM events WHERE venue_id = v_venue AND title = 'Yuno Electronic Body' AND partner_organizer_id = v_org
  ORDER BY start_at LIMIT 1;

  CREATE TEMP TABLE _cctx (k text PRIMARY KEY, u uuid, t text);
  INSERT INTO _cctx VALUES ('org', v_org, NULL), ('venue', NULL, v_venue);
  CREATE TEMP TABLE _coev (id uuid, start_ts timestamptz);

  -- 6 vendredis passés (idempotent : on supprime d'abord d'éventuelles collab démo passées recréées)
  DELETE FROM events WHERE venue_id = v_venue AND title = 'Yuno Electronic Body'
    AND partner_organizer_id = v_org AND access_code = 'DEMO_SEED'
    AND recurring_template_id IS NULL;  -- ne touche pas aux occurrences du template

  FOR i IN 1..6 LOOP
    d := (date_trunc('week', (now() AT TIME ZONE 'Europe/Paris'))::date + 4 - i*7);  -- vendredi i semaines avant
    INSERT INTO events (venue_id, partner_organizer_id, title, description, poster_url, poster_position,
      music_genre, music_genres, event_type, start_at, end_at, is_active, is_discoverable, visibility,
      event_mode, event_kind, revenue_split_rules, split_approved_by_venue, split_approved_by_organizer, split_locked_at,
      ticketing_enabled, ticket_selling_mode, tables_enabled, access_code, created_at)
    VALUES (v_venue, v_org, 'Yuno Electronic Body', v_desc, v_poster, v_pos,
      'house', ARRAY['house'], 'club',
      (d + time '23:00') AT TIME ZONE 'Europe/Paris', ((d+1) + time '05:00') AT TIME ZONE 'Europe/Paris',
      true, false, 'private',
      'co_event'::public.event_mode, 'club_event'::public.event_kind, '{"venue":70,"organizer":30}'::jsonb, true, true, now(),
      true, 'rounds', true, 'DEMO_SEED', (d - 30)::timestamp AT TIME ZONE 'Europe/Paris')
    RETURNING id INTO v_ev;
    INSERT INTO ticket_rounds (event_id, name, price, max_tickets, position, ticket_type, is_active, tickets_sold)
    VALUES (v_ev,'Early Bird',12,150,0,'standard',true,0),
           (v_ev,'Regular',15,300,1,'standard',true,0),
           (v_ev,'Last Tickets',20,200,2,'standard',true,0);
    INSERT INTO _coev VALUES (v_ev, (d + time '23:00') AT TIME ZONE 'Europe/Paris');
  END LOOP;

  -- + le co-event à venir (déjà généré par le template) pour des PRÉ-ventes
  INSERT INTO _coev
  SELECT e.id, e.start_at FROM events e
  WHERE e.venue_id = v_venue AND e.title = 'Yuno Electronic Body' AND e.partner_organizer_id = v_org
    AND e.recurring_template_id IS NOT NULL AND e.start_at > now();
END $$;

-- Nettoyage des ventes démo précédentes sur ces co-events (idempotence)
DELETE FROM revenue_distributions WHERE ticket_id IN (SELECT id FROM tickets WHERE event_id IN (SELECT id FROM _coev) AND purchase_source='demo_seed');
DELETE FROM revenue_distributions WHERE table_reservation_id IN (SELECT id FROM table_reservations WHERE event_id IN (SELECT id FROM _coev) AND purchase_source='demo_seed');
DELETE FROM tickets WHERE event_id IN (SELECT id FROM _coev) AND purchase_source='demo_seed';
DELETE FROM table_reservations WHERE event_id IN (SELECT id FROM _coev) AND purchase_source='demo_seed';

-- Billets payés (étalés avant chaque date)
INSERT INTO tickets (event_id, ticket_round_id, user_id, user_email, full_name, is_guest,
  quantity, unit_price, total_price, service_fee, insurance_fee, status, ticket_type,
  qr_code, purchase_source, paid_at, created_at, used, entry_scanned)
SELECT r.event_id, r.id, NULL,
  'buyer' || (1 + floor(random()*80))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit',
         'Chloé Laurent','Théo Garcia','Manon Roux','Enzo Fontaine','Camille Girard'])[(1 + floor(random()*10))::int],
  true, q.qty, r.price,
  round(r.price*q.qty + greatest(0.99, r.price*q.qty*0.04), 2),
  round(greatest(0.99, r.price*q.qty*0.04), 2), 0, 'paid', 'standard',
  'demo-tkt-' || gen_random_uuid()::text, 'demo_seed', ts.t, ts.t,
  (c.start_ts < now()), (c.start_ts < now() AND random() < 0.8)
FROM ticket_rounds r
JOIN _coev c ON c.id = r.event_id
CROSS JOIN LATERAL generate_series(1, (12 + floor(random()*22))::int) g
CROSS JOIN LATERAL (SELECT (1 + floor(random()*3))::int AS qty) q
CROSS JOIN LATERAL (SELECT least(now() - interval '1 hour',
   (c.start_ts - interval '30 days') + random()*(least(c.start_ts, now()) - (c.start_ts - interval '30 days'))) AS t) ts;

UPDATE ticket_rounds tr SET tickets_sold = COALESCE(
  (SELECT sum(t.quantity) FROM tickets t WHERE t.ticket_round_id = tr.id AND t.status='paid'),0)
WHERE tr.event_id IN (SELECT id FROM _coev);

-- Tables VIP payées (table distincte par event)
WITH ranked AS (
  SELECT c.id AS event_id, c.start_ts, vt.id AS table_id, vt.zone_id,
         row_number() OVER (PARTITION BY c.id ORDER BY random()) rn,
         (3 + floor(random()*4))::int AS cnt
  FROM _coev c CROSS JOIN vip_tables vt WHERE vt.venue_id = 'womber'
)
INSERT INTO table_reservations (event_id, table_id, zone_id, user_id, user_email, full_name,
  is_guest, guest_count, total_price, deposit, service_fee, management_fee, status,
  paid_at, created_at, purchase_source, entry_scanned)
SELECT r.event_id, r.table_id, r.zone_id, NULL,
  'buyer' || (1 + floor(random()*80))::int || '@demo.womber.fr',
  (ARRAY['Lucas Martin','Emma Bernard','Hugo Dubois','Léa Moreau','Nathan Petit'])[(1+floor(random()*5))::int],
  true, (4 + floor(random()*8))::int, base.total, base.total, 0, base.mgmt, 'paid',
  ts.t, ts.t, 'demo_seed', (r.start_ts < now() AND random() < 0.7)
FROM ranked r
CROSS JOIN LATERAL (SELECT (300 + floor(random()*600))::numeric AS b) bb
CROSS JOIN LATERAL (SELECT round(greatest(0.99, bb.b*0.04),2) AS mgmt, round(bb.b + greatest(0.99, bb.b*0.04),2) AS total) base
CROSS JOIN LATERAL (SELECT least(now() - interval '1 hour',
   (r.start_ts - interval '20 days') + random()*(least(r.start_ts, now()) - (r.start_ts - interval '20 days'))) AS t) ts
WHERE r.rn <= r.cnt;

-- revenue_distributions : split 70% club (primary venue) / 30% orga (secondary organizer)
INSERT INTO revenue_distributions (payment_intent_id, item_type, event_id, ticket_id, gross_amount_cents,
  primary_recipient_kind, primary_recipient_venue_id, primary_amount_cents,
  secondary_recipient_kind, secondary_recipient_organizer_id, secondary_amount_cents,
  split_mode, split_rules_applied, organizer_pct_applied, venue_pct_applied,
  yuno_fee_cents, stripe_fee_estimated_cents, primary_transfer_status, secondary_transfer_status, created_at)
SELECT 'pi_demo_'||t.id, 'ticket', t.event_id, t.id, round(t.total_price*100),
  'venue', 'womber', round((t.total_price - t.service_fee - COALESCE(t.insurance_fee,0)) * 0.70 * 100),
  'organizer', (SELECT u FROM _cctx WHERE k='org'), round((t.total_price - t.service_fee - COALESCE(t.insurance_fee,0)) * 0.30 * 100),
  'fixed_percent', '{"venue":70,"organizer":30}'::jsonb, 30, 70,
  round(t.service_fee*100), round((t.total_price*0.015+0.25)*100), 'succeeded', 'succeeded', t.created_at
FROM tickets t WHERE t.event_id IN (SELECT id FROM _coev) AND t.purchase_source='demo_seed' AND t.status='paid';

INSERT INTO revenue_distributions (payment_intent_id, item_type, event_id, table_reservation_id, gross_amount_cents,
  primary_recipient_kind, primary_recipient_venue_id, primary_amount_cents,
  secondary_recipient_kind, secondary_recipient_organizer_id, secondary_amount_cents,
  split_mode, split_rules_applied, organizer_pct_applied, venue_pct_applied,
  yuno_fee_cents, stripe_fee_estimated_cents, primary_transfer_status, secondary_transfer_status, created_at)
SELECT 'pi_demo_'||r.id, 'table', r.event_id, r.id, round(r.total_price*100),
  'venue', 'womber', round((r.total_price - COALESCE(r.management_fee,0)) * 0.70 * 100),
  'organizer', (SELECT u FROM _cctx WHERE k='org'), round((r.total_price - COALESCE(r.management_fee,0)) * 0.30 * 100),
  'fixed_percent', '{"venue":70,"organizer":30}'::jsonb, 30, 70,
  round(COALESCE(r.management_fee,0)*100), round((r.total_price*0.015+0.25)*100), 'succeeded', 'succeeded', r.created_at
FROM table_reservations r WHERE r.event_id IN (SELECT id FROM _coev) AND r.purchase_source='demo_seed' AND r.status='paid';

-- Récap
SELECT to_char(c.start_ts AT TIME ZONE 'Europe/Paris','dd/MM (Dy)') date,
  CASE WHEN c.start_ts < now() THEN 'passée' ELSE 'à venir' END etat,
  (SELECT count(*) FROM tickets t WHERE t.event_id=c.id AND t.purchase_source='demo_seed') billets,
  (SELECT count(*) FROM table_reservations tr WHERE tr.event_id=c.id AND tr.purchase_source='demo_seed') tables,
  round((SELECT sum(d.primary_amount_cents+d.secondary_amount_cents)/100.0 FROM revenue_distributions d WHERE d.event_id=c.id)) ca_club_net,
  round((SELECT sum(d.secondary_amount_cents)/100.0 FROM revenue_distributions d WHERE d.event_id=c.id)) part_orga
FROM _coev c ORDER BY c.start_ts;
