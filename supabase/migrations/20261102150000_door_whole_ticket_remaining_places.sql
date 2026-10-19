-- Porte : le QR du BILLET ENTIER fait entrer les places encore libres (2026-10-19)
-- Depuis que l'achat réel crée un QR par personne (create-ticket-checkout,
-- _shared/ticket-places.ts), un ami entré avec SON QR marquait le billet parent :
-- l'acheteur et les autres amis voyaient ensuite « Déjà scanné » sur le QR de
-- l'e-mail / Wallet. Le manifeste hors ligne et la synchro suivent la même règle
-- que l'app (wholeTicketDoorState, enterRemainingPlaces).
-- Répétée sur la prod le 19/10 (transaction annulée, SMOKE_OK) : manifeste, synchro,
-- entrée en ligne sous RLS, places remboursées jamais admises.

CREATE OR REPLACE FUNCTION public.get_event_scan_manifest(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue_id text;
  v_partner_venue_id text;
  v_organizer_user_id uuid;
  v_partner_organizer_id uuid;
  v_uid uuid := auth.uid();
  v_found boolean;
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT true, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_found, v_venue_id, v_partner_venue_id, v_organizer_user_id, v_partner_organizer_id
    FROM events e WHERE e.id = p_event_id;
  -- Une soirée org-led n'a NI club NI club partenaire : l'existence se teste
  -- sur la ligne, jamais sur ses colonnes de rattachement.
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Staff porte OU owner de l'un des deux clubs de l'event (lead ou partenaire)
  -- OU organisateur de l'event (lead ou partenaire) OU son staff de porte.
  --
  -- ⚠️ AUCUN terme ne doit pouvoir valoir NULL. `v_uid IN (a, b)` renvoie NULL
  -- — pas FALSE — dès qu'un des deux membres est NULL et qu'aucun ne matche.
  -- Or sur une soirée de club les deux colonnes organizer SONT NULL : le OU
  -- entier retombait à NULL, `IF NOT NULL` ne déclenche pas, et le manifeste
  -- partait à n'importe quel compte connecté. D'où `IS NOT DISTINCT FROM`
  -- (jamais NULL) et un COALESCE de ceinture sur la garde elle-même.
  v_ok := COALESCE((
    SELECT EXISTS (
      SELECT 1
        FROM user_roles ur
        JOIN profiles p ON p.id = ur.user_id
       WHERE ur.user_id = v_uid
         AND ur.role IN ('bouncer', 'vip_host', 'manager')
         AND p.venue_id IN (v_venue_id, v_partner_venue_id)
    )), false)
    OR COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM venues v
       WHERE v.id IN (v_venue_id, v_partner_venue_id) AND v.owner_id = v_uid
    )), false)
    OR v_uid IS NOT DISTINCT FROM v_organizer_user_id
    OR v_uid IS NOT DISTINCT FROM v_partner_organizer_id
    OR COALESCE(is_event_door_staff(v_uid, p_event_id), false);

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'event', (
      -- venue_id = le club qui tient la porte, NULL sur une soirée org-led.
      -- organizer_user_id prend alors le relais comme périmètre de la porte.
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
        'venue_id', COALESCE(e.venue_id, e.partner_venue_id),
        'organizer_user_id', COALESCE(e.organizer_user_id, e.partner_organizer_id),
        'alcohol_free', e.alcohol_free
      ) FROM events e WHERE e.id = p_event_id
    ),
    'attendees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ta.id, 'qr', ta.qr_code, 'name', COALESCE(ta.full_name, t.full_name),
        'scanned', COALESCE(ta.entry_scanned, false), 'scanned_at', ta.entry_scanned_at,
        -- Place remboursée une à une : refusée à la porte, hors ligne compris.
        'ticket_id', t.id,
        'status', CASE WHEN ta.refunded_at IS NOT NULL THEN 'refunded' ELSE t.status END,
        'qty', t.quantity,
        'round', tr.name, 'drink', tr.includes_drink,
        'deadline', tr.entry_deadline,
        'drink_cutoff', CASE WHEN tr.drink_deadline_type = 'fixed_time' THEN tr.drink_cutoff_time END
      ))
      FROM ticket_attendees ta
      JOIN tickets t ON t.id = ta.ticket_id
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
      WHERE t.event_id = p_event_id AND ta.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'qr', t.qr_code, 'name', t.full_name, 'status', t.status,
        -- Billet à places : le QR entier fait entrer les places encore libres
        -- (ni entrées, ni remboursées) ; « scanné » quand il n'en reste aucune.
        'scanned', CASE WHEN pl.n > 0 THEN pl.free = 0 ELSE COALESCE(t.entry_scanned, false) END,
        'scanned_at', t.entry_scanned_at,
        'qty', CASE WHEN pl.n > 0 THEN GREATEST(1, pl.free) ELSE GREATEST(1, COALESCE(t.quantity, 1)) END,
        'round', tr.name, 'drink', tr.includes_drink,
        'deadline', tr.entry_deadline,
        'drink_cutoff', CASE WHEN tr.drink_deadline_type = 'fixed_time' THEN tr.drink_cutoff_time END
      ))
      FROM tickets t
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE x.refunded_at IS NULL AND NOT COALESCE(x.entry_scanned, false))::int AS free
          FROM ticket_attendees x WHERE x.ticket_id = t.id
      ) pl
      WHERE t.event_id = p_event_id AND t.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'guest_list', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'qr', g.qr_code, 'name', g.full_name, 'status', g.status,
        'scanned', COALESCE(g.entry_scanned, false), 'scanned_at', g.entry_scanned_at,
        'entry_deadline', g.entry_deadline, 'entry_type', g.entry_type,
        'gl_deadline', gl.entry_deadline, 'free_before', gl.free_before_time,
        'gl_drink', gl.includes_drink
      ))
      FROM guest_list_entries g
      JOIN guest_lists gl ON gl.id = g.guest_list_id
      WHERE gl.event_id = p_event_id AND g.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'qr', r.qr_code, 'name', r.full_name, 'status', r.status,
        'scanned', COALESCE(r.entry_scanned, false), 'scanned_at', r.entry_scanned_at,
        'guests', r.guest_count, 'zone', z.name, 'pack', pk.name,
        'arrival', pk.arrival_deadline,
        'deposit', r.deposit, 'total', r.total_price
      ))
      FROM table_reservations r
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      WHERE r.event_id = p_event_id AND r.qr_code IS NOT NULL
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_offline_scans(p_scans jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_venue_id text;
  v_partner_venue_id text;
  v_organizer_user_id uuid;
  v_partner_organizer_id uuid;
  v_found boolean;
  v_ok boolean;
  item jsonb;
  results jsonb := '[]'::jsonb;
  v_type text;
  v_id uuid;
  v_rows int;
  v_ts timestamptz;
  v_existing timestamptz;
  v_ticket_id uuid;
  v_invalid boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_scans IS NULL OR jsonb_typeof(p_scans) <> 'array' OR jsonb_array_length(p_scans) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_array_length(p_scans) > 200 THEN
    RAISE EXCEPTION 'batch_too_large';
  END IF;

  -- Autorisation : même règle que le manifeste, sur l'event du premier item
  -- (le client envoie des batchs mono-event).
  v_event_id := (p_scans -> 0 ->> 'event_id')::uuid;
  SELECT true, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_found, v_venue_id, v_partner_venue_id, v_organizer_user_id, v_partner_organizer_id
    FROM events e WHERE e.id = v_event_id;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  v_ok := COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
       WHERE ur.user_id = v_uid AND ur.role IN ('bouncer', 'vip_host', 'manager')
         AND p.venue_id IN (v_venue_id, v_partner_venue_id)
    )), false)
    OR COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM venues v
       WHERE v.id IN (v_venue_id, v_partner_venue_id) AND v.owner_id = v_uid
    )), false)
    OR v_uid IS NOT DISTINCT FROM v_organizer_user_id
    OR v_uid IS NOT DISTINCT FROM v_partner_organizer_id
    OR COALESCE(is_event_door_staff(v_uid, v_event_id), false);
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_scans) LOOP
    v_type := item ->> 'entity_type';
    v_id := (item ->> 'entity_id')::uuid;
    -- Anti clock-skew : jamais dans le futur, jamais plus vieux que 48 h.
    v_ts := LEAST(GREATEST((item ->> 'scanned_at')::timestamptz, now() - interval '48 hours'), now());
    v_rows := 0;
    v_existing := NULL;
    v_invalid := false;

    IF (item ->> 'event_id')::uuid IS DISTINCT FROM v_event_id THEN
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'error', 'message', 'event_mismatch');
      CONTINUE;
    END IF;

    IF v_type = 'ticket_attendee' THEN
      UPDATE ticket_attendees ta
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
        FROM tickets t
       WHERE ta.id = v_id AND t.id = ta.ticket_id AND t.event_id = v_event_id
         AND t.status = 'paid'
         AND ta.refunded_at IS NULL
         AND COALESCE(ta.entry_scanned, false) = false
      RETURNING ta.ticket_id INTO v_ticket_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT CASE WHEN ta.entry_scanned THEN COALESCE(ta.entry_scanned_at, now()) END,
               t.status IS DISTINCT FROM 'paid' OR ta.refunded_at IS NOT NULL
          INTO v_existing, v_invalid
          FROM ticket_attendees ta JOIN tickets t ON t.id = ta.ticket_id
         WHERE ta.id = v_id;
      END IF;

    ELSIF v_type = 'ticket' THEN
      IF EXISTS (SELECT 1 FROM ticket_attendees WHERE ticket_id = v_id) THEN
        -- Billet à places : le QR entier fait entrer les places encore libres
        -- (le billet parent est marqué par ricochet).
        UPDATE ticket_attendees ta
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
          FROM tickets t
         WHERE ta.ticket_id = v_id AND t.id = ta.ticket_id AND t.event_id = v_event_id
           AND t.status = 'paid' AND ta.refunded_at IS NULL
           AND COALESCE(ta.entry_scanned, false) = false;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      ELSE
        UPDATE tickets
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
         WHERE id = v_id AND event_id = v_event_id AND status = 'paid'
           AND COALESCE(entry_scanned, false) = false;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      END IF;
      IF v_rows = 0 THEN
        SELECT CASE WHEN t.entry_scanned THEN COALESCE(t.entry_scanned_at, now()) END,
               t.status IS DISTINCT FROM 'paid'
          INTO v_existing, v_invalid
          FROM tickets t WHERE t.id = v_id;
      END IF;

    ELSIF v_type = 'guest_list_entry' THEN
      UPDATE guest_list_entries g
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid, status = 'entered'
        FROM guest_lists gl
       WHERE g.id = v_id AND gl.id = g.guest_list_id AND gl.event_id = v_event_id
         AND g.status IS DISTINCT FROM 'cancelled'
         AND COALESCE(g.entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT CASE WHEN g.entry_scanned THEN COALESCE(g.entry_scanned_at, now()) END,
               g.status = 'cancelled'
          INTO v_existing, v_invalid
          FROM guest_list_entries g WHERE g.id = v_id;
      END IF;

    ELSIF v_type = 'table_reservation' THEN
      -- La notification « Arrivée VIP » part du trigger
      -- trg_notify_vip_host_on_arrival (un seul émetteur, le club de la zone).
      UPDATE table_reservations
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid,
             checked_in_at = COALESCE(checked_in_at, v_ts)
       WHERE id = v_id AND event_id = v_event_id AND status = 'paid'
         AND COALESCE(entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT CASE WHEN tr.entry_scanned THEN COALESCE(tr.entry_scanned_at, now()) END,
               tr.status IS DISTINCT FROM 'paid'
          INTO v_existing, v_invalid
          FROM table_reservations tr WHERE tr.id = v_id;
      END IF;

    ELSE
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'error', 'message', 'unknown_entity_type');
      CONTINUE;
    END IF;

    IF v_rows > 0 THEN
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'applied', 'server_scanned_at', v_ts);
    ELSIF v_existing IS NOT NULL THEN
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'conflict', 'conflict_scanned_at', v_existing);
    ELSIF COALESCE(v_invalid, false) THEN
      -- Remboursé / annulé pendant la coupure : refusé, définitivement.
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'error', 'message', 'not_valid');
    ELSE
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'error', 'message', 'not_found');
    END IF;
  END LOOP;

  RETURN results;
END;
$function$;
