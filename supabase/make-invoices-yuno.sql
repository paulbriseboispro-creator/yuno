-- ============================================================================
-- Factures démo — remplit la page FACTURES du club Yuno (owner@womber.fr) ET de
-- l'orga Yuno (organizer@womber.fr). Génère des `invoices` (reçus client) à partir
-- des ventes déjà seedées (billets / commandes bar / tables VIP).
--
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
-- Idempotent : efface les factures démo (invoice_number LIKE 'YUNO-%') puis re-crée.
-- Additif (ne touche ni au seed ni aux events à flyers).
--
-- HT/TVA = TVA 20% (amount TTC → total_ht = amount/1.2, tva = amount - total_ht).
-- ============================================================================

DROP TABLE IF EXISTS _ictx;

DO $$
DECLARE
  v_owner uuid; v_venue text; v_org uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'owner@womber.fr introuvable.'; END IF;
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN RAISE EXCEPTION 'Club Yuno introuvable.'; END IF;
  SELECT id INTO v_org FROM auth.users WHERE email = 'organizer@womber.fr';

  CREATE TEMP TABLE _ictx (k text PRIMARY KEY, u uuid, txt text);
  INSERT INTO _ictx (k, u, txt) VALUES ('venue', NULL, v_venue), ('org', v_org, NULL);
END $$;

-- Idempotence : on retire les factures démo précédentes.
DELETE FROM invoices WHERE invoice_number LIKE 'YUNO-%'
  AND (venue_id = (SELECT txt FROM _ictx WHERE k='venue') OR organizer_user_id = (SELECT u FROM _ictx WHERE k='org'));

-- ----------------------------------------------------------------------------
-- CLUB — factures billets (50)
-- ----------------------------------------------------------------------------
INSERT INTO invoices (venue_id, type, invoice_number, customer_email, customer_name,
  event_id, event_name, event_date, event_poster, amount, total_ht, tva, service_fee, insurance_fee, items, ticket_id, created_at)
SELECT (SELECT txt FROM _ictx WHERE k='venue'), 'ticket',
  'YUNO-T-' || lpad((row_number() OVER (ORDER BY src.created_at))::text, 5, '0'),
  src.user_email, src.full_name, src.event_id, src.title, src.start_at, src.poster_url,
  src.total_price, round(src.total_price / 1.2, 2), round(src.total_price - src.total_price / 1.2, 2),
  src.service_fee, COALESCE(src.insurance_fee, 0),
  jsonb_build_array(jsonb_build_object('description', src.title || ' — Billet', 'quantity', src.quantity,
                    'unitPrice', src.unit_price, 'total', src.total_price)),
  src.id, src.created_at
FROM (
  SELECT t.id, t.user_email, t.full_name, t.event_id, t.total_price, t.service_fee, t.insurance_fee,
         t.quantity, t.unit_price, t.created_at, e.title, e.start_at, e.poster_url
  FROM tickets t JOIN events e ON e.id = t.event_id
  WHERE t.purchase_source = 'demo_seed' AND t.status = 'paid'
    AND e.venue_id = (SELECT txt FROM _ictx WHERE k='venue')
  ORDER BY random() LIMIT 50
) src;

-- ----------------------------------------------------------------------------
-- CLUB — factures commandes bar (50)
-- ----------------------------------------------------------------------------
INSERT INTO invoices (venue_id, type, invoice_number, customer_email, amount, total_ht, tva, service_fee, items, order_id, created_at)
SELECT (SELECT txt FROM _ictx WHERE k='venue'), 'order',
  'YUNO-O-' || lpad((row_number() OVER (ORDER BY o.created_at))::text, 5, '0'),
  COALESCE(o.user_email, 'client@demo.womber.fr'), o.total, round(o.total / 1.2, 2), round(o.total - o.total / 1.2, 2), o.service_fee,
  (SELECT jsonb_agg(jsonb_build_object('description', it->>'name',
            'quantity', COALESCE((it->>'quantity')::int, 1),
            'unitPrice', COALESCE((it->>'price')::numeric, 0),
            'total', COALESCE((it->>'price')::numeric, 0) * COALESCE((it->>'quantity')::int, 1)))
   FROM jsonb_array_elements(o.items) it),
  o.id, o.created_at
FROM (SELECT * FROM orders WHERE order_number LIKE 'DEMO-%' AND status IN ('paid','served') ORDER BY random() LIMIT 50) o;

-- ----------------------------------------------------------------------------
-- CLUB — factures tables VIP (25)
-- ----------------------------------------------------------------------------
INSERT INTO invoices (venue_id, type, invoice_number, customer_email, customer_name,
  event_id, event_name, event_date, amount, total_ht, tva, management_fee, items, table_reservation_id, created_at)
SELECT (SELECT txt FROM _ictx WHERE k='venue'), 'table',
  'YUNO-V-' || lpad((row_number() OVER (ORDER BY src.created_at))::text, 5, '0'),
  src.user_email, src.full_name, src.event_id, src.title, src.start_at,
  src.total_price, round(src.total_price / 1.2, 2), round(src.total_price - src.total_price / 1.2, 2), src.management_fee,
  jsonb_build_array(jsonb_build_object('description', src.title || ' — Table VIP', 'quantity', 1,
                    'unitPrice', src.total_price, 'total', src.total_price)),
  src.id, src.created_at
FROM (
  SELECT r.id, r.user_email, r.full_name, r.event_id, r.total_price, r.management_fee, r.created_at, e.title, e.start_at
  FROM table_reservations r JOIN events e ON e.id = r.event_id
  WHERE r.purchase_source = 'demo_seed' AND r.status = 'paid'
  ORDER BY random() LIMIT 25
) src;

-- ----------------------------------------------------------------------------
-- ORGA — factures billets des events orga (30)
-- ----------------------------------------------------------------------------
INSERT INTO invoices (organizer_user_id, type, invoice_number, customer_email, customer_name,
  event_id, event_name, event_date, event_poster, amount, total_ht, tva, service_fee, insurance_fee, items, ticket_id, created_at)
SELECT (SELECT u FROM _ictx WHERE k='org'), 'ticket',
  'YUNO-ORG-' || lpad((row_number() OVER (ORDER BY src.created_at))::text, 5, '0'),
  src.user_email, src.full_name, src.event_id, src.title, src.start_at, src.poster_url,
  src.total_price, round(src.total_price / 1.2, 2), round(src.total_price - src.total_price / 1.2, 2),
  src.service_fee, COALESCE(src.insurance_fee, 0),
  jsonb_build_array(jsonb_build_object('description', src.title || ' — Billet', 'quantity', src.quantity,
                    'unitPrice', src.unit_price, 'total', src.total_price)),
  src.id, src.created_at
FROM (
  SELECT t.id, t.user_email, t.full_name, t.event_id, t.total_price, t.service_fee, t.insurance_fee,
         t.quantity, t.unit_price, t.created_at, e.title, e.start_at, e.poster_url
  FROM tickets t JOIN events e ON e.id = t.event_id
  WHERE t.purchase_source = 'demo_seed' AND t.status = 'paid'
    AND e.organizer_user_id = (SELECT u FROM _ictx WHERE k='org')
  ORDER BY random() LIMIT 30
) src;

-- ----------------------------------------------------------------------------
-- Récap
-- ----------------------------------------------------------------------------
SELECT CASE WHEN venue_id IS NOT NULL THEN 'club' ELSE 'orga' END AS scope,
       type, count(*) AS factures, round(sum(amount))::text AS total_ttc
FROM invoices WHERE invoice_number LIKE 'YUNO-%'
GROUP BY 1, 2 ORDER BY 1, 2;
