-- Tables VIP, vague A — P1.1 / P1.2 : le client retrouve sa table et ses QR sans compte.
--
-- Constat (audit 1) : après Stripe, un acheteur SANS compte arrivait sur « introuvable » — la page de confirmation lit
-- table_reservations sous RLS, et un invité n'a aucune policy. Même problème que pour les billets (get_ticket_places) : on reprend
-- le même modèle, la PREUVE est le QR de la réservation (un secret que seul l'acheteur détient).
--
--   get_table_receipt(p_reservation_id, p_qr)  → le reçu complet de la réservation, ou NULL (mauvaise preuve = rien, jamais d'erreur
--                                                 qui apprendrait qu'une réservation existe).
--   get_table_guest_pass(p_qr)                 → UNE entrée d'invité (le QR d'un invité exact) : ce QR, son numéro, la soirée, la
--                                                 formule — rien sur l'acheteur ni sur le prix. Sert la page légère /t/<qr>, que le
--                                                 titulaire envoie à chaque ami (D4).
--
-- Les deux sont SECURITY DEFINER, lisibles par anon et authenticated, et ne rendent jamais plus que ce que la preuve ouvre.

CREATE OR REPLACE FUNCTION public.get_table_receipt(p_reservation_id uuid, p_qr text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      public.table_reservations%ROWTYPE;
  ev     public.events%ROWTYPE;
  v_club text;
  v_venue jsonb;
  v_pack  jsonb;
  v_zone  jsonb;
  v_layout jsonb;
  v_req_name text;
  v_asg_name text;
  v_guests jsonb;
BEGIN
  IF p_reservation_id IS NULL OR p_qr IS NULL OR btrim(p_qr) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id AND qr_code = p_qr;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO ev FROM public.events WHERE id = r.event_id;
  v_club := COALESCE(ev.venue_id, ev.partner_venue_id);

  IF v_club IS NOT NULL THEN
    SELECT jsonb_build_object('id', v.id, 'name', v.name, 'city', v.city, 'address', v.address)
      INTO v_venue FROM public.venues v WHERE v.id = v_club;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'name', p.name) INTO v_pack FROM public.table_packs p WHERE p.id = r.pack_id;
  SELECT jsonb_build_object('id', z.id, 'name', z.name) INTO v_zone FROM public.table_zones z WHERE z.id = r.zone_id;

  -- Nom des tables : plan de la soirée d'abord, plan du club ensuite (même résolution que le placement et la page publique).
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = r.event_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_layout IS NULL AND v_club IS NOT NULL THEN
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_club AND event_id IS NULL
     ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_layout IS NOT NULL THEN
    SELECT t->>'name' INTO v_req_name FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE r.requested_table_id IS NOT NULL AND t->>'id' = r.requested_table_id::text LIMIT 1;
    SELECT t->>'name' INTO v_asg_name FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE r.assigned_table_id IS NOT NULL AND t->>'id' = r.assigned_table_id::text LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'guest_number', g.guest_number,
           'full_name', g.full_name,
           'qr_code', g.qr_code,
           'entry_scanned', COALESCE(g.entry_scanned, false)
         ) ORDER BY g.guest_number), '[]'::jsonb)
    INTO v_guests
    FROM public.table_reservation_guests g WHERE g.reservation_id = r.id;

  RETURN jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'payment_mode', r.payment_mode,
    'paid_at', r.paid_at,
    'qr_code', r.qr_code,
    'reference_code', r.reference_code,
    'scannable', (r.status = 'paid'),
    'event', jsonb_build_object(
      'id', ev.id, 'title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at, 'timezone', ev.timezone,
      'poster_url', ev.poster_url, 'slug', ev.slug,
      'location_name', ev.location_name, 'location_address', ev.location_address, 'location_city', ev.location_city,
      'location_is_secret', COALESCE(ev.location_is_secret, false)
    ),
    'venue', v_venue,
    'pack', v_pack,
    'zone', v_zone,
    'requested_table_id', r.requested_table_id,
    'requested_table_name', v_req_name,
    'assigned_table_id', r.assigned_table_id,
    'assigned_table_name', v_asg_name,
    'placement_status', r.placement_status,
    'placement_adjustment', r.placement_adjustment,
    'placement_adjustment_amount', r.placement_adjustment_amount,
    'guest_count', r.guest_count,
    'total_price', r.total_price,
    'deposit', r.deposit,
    'service_fee', r.service_fee,
    'management_fee', r.management_fee,
    'fee_absorbed', COALESCE(r.fee_absorbed, false),
    'minimum_spend', r.minimum_spend,
    'remaining_on_site', GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.deposit, 0), 0),
    'holder', jsonb_build_object('full_name', r.full_name, 'email', r.user_email),
    'guests', v_guests
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_table_guest_pass(p_qr text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
           'qr_code', g.qr_code,
           'guest_number', g.guest_number,
           'is_holder', (g.guest_number = 0),
           'scannable', (r.status = 'paid'),
           'entry_scanned', COALESCE(g.entry_scanned, false),
           'event', jsonb_build_object(
             'title', e.title,
             'start_at', e.start_at,
             'timezone', e.timezone,
             'city', COALESCE(NULLIF(btrim(e.location_city), ''), v.city)
           ),
           'pack_name', p.name
         )
    FROM public.table_reservation_guests g
    JOIN public.table_reservations r ON r.id = g.reservation_id
    JOIN public.events e ON e.id = r.event_id
    LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
    LEFT JOIN public.table_packs p ON p.id = r.pack_id
   WHERE p_qr IS NOT NULL
     AND g.qr_code = p_qr
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_table_receipt(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_receipt(uuid, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_table_guest_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_guest_pass(text) TO anon, authenticated, service_role;
