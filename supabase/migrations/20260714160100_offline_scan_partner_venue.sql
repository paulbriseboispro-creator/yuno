-- ============================================================================
-- Scan offline (app Yuno Pro) : couvrir les co-soirées menées par un
-- ORGANISATEUR (le club est alors events.partner_venue_id, et venue_id est
-- NULL ou différent).
--
-- TROU corrigé : get_event_scan_manifest et sync_offline_scans résolvaient le
-- club UNIQUEMENT via events.venue_id. Sur un co-event org-led (l'orga crée la
-- soirée puis invite le club — le flux d'invitation pose partner_venue_id sans
-- toucher venue_id), venue_id est NULL → 'event_not_found' : le staff porte du
-- club ne pouvait NI télécharger le manifeste offline NI rejouer ses scans.
-- Concrètement : soirée à 1000 personnes, wifi qui tombe, la porte est
-- aveugle. C'est exactement le scénario collab qu'on lance.
--
-- FIX : le staff/owner de N'IMPORTE LEQUEL des deux venues de l'event
-- (venue_id OU partner_venue_id) est autorisé, et les notifications VIP
-- partent vers le club opérateur (celui du staff qui synchronise).
-- Le corps des fonctions est inchangé par ailleurs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_event_scan_manifest(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_partner_venue_id text;
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.venue_id, e.partner_venue_id
    INTO v_venue_id, v_partner_venue_id
    FROM events e WHERE e.id = p_event_id;
  IF v_venue_id IS NULL AND v_partner_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Staff porte OU owner de l'un des deux venues de l'event (lead ou partenaire).
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN profiles p ON p.id = ur.user_id
     WHERE ur.user_id = v_uid
       AND ur.role IN ('bouncer', 'vip_host', 'manager')
       AND p.venue_id IN (v_venue_id, v_partner_venue_id)
  ) OR EXISTS (
    SELECT 1 FROM venues v
     WHERE v.id IN (v_venue_id, v_partner_venue_id) AND v.owner_id = v_uid
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'event', (
      -- venue_id = le club qui tient la porte (l'index offline compare le venue
      -- du staff à cette valeur) : venue_id, sinon le club partenaire.
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
        'venue_id', COALESCE(e.venue_id, e.partner_venue_id), 'alcohol_free', e.alcohol_free
      ) FROM events e WHERE e.id = p_event_id
    ),
    'attendees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ta.id, 'qr', ta.qr_code, 'name', COALESCE(ta.full_name, t.full_name),
        'scanned', COALESCE(ta.entry_scanned, false), 'scanned_at', ta.entry_scanned_at,
        'ticket_id', t.id, 'status', t.status, 'qty', t.quantity,
        'round', tr.name, 'drink', tr.includes_drink
      ))
      FROM ticket_attendees ta
      JOIN tickets t ON t.id = ta.ticket_id
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
      WHERE t.event_id = p_event_id AND ta.qr_code IS NOT NULL
    ), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'qr', t.qr_code, 'name', t.full_name, 'status', t.status,
        'scanned', COALESCE(t.entry_scanned, false), 'scanned_at', t.entry_scanned_at,
        'qty', t.quantity, 'round', tr.name, 'drink', tr.includes_drink
      ))
      FROM tickets t
      LEFT JOIN ticket_rounds tr ON tr.id = t.ticket_round_id
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
        'deposit', r.deposit, 'total', r.total_price
      ))
      FROM table_reservations r
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      WHERE r.event_id = p_event_id AND r.qr_code IS NOT NULL
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_offline_scans(p_scans jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_venue_id text;
  v_partner_venue_id text;
  v_op_venue_id text;
  v_ok boolean;
  item jsonb;
  results jsonb := '[]'::jsonb;
  v_type text;
  v_id uuid;
  v_rows int;
  v_ts timestamptz;
  v_existing timestamptz;
  v_ticket_id uuid;
  r record;
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

  -- Autorisation : même règle que le manifeste (staff/owner du venue lead OU
  -- partenaire), sur l'event du premier item (batchs mono-event).
  v_event_id := (p_scans -> 0 ->> 'event_id')::uuid;
  SELECT e.venue_id, e.partner_venue_id
    INTO v_venue_id, v_partner_venue_id
    FROM events e WHERE e.id = v_event_id;
  IF v_venue_id IS NULL AND v_partner_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
     WHERE ur.user_id = v_uid AND ur.role IN ('bouncer', 'vip_host', 'manager')
       AND p.venue_id IN (v_venue_id, v_partner_venue_id)
  ) OR EXISTS (
    SELECT 1 FROM venues v
     WHERE v.id IN (v_venue_id, v_partner_venue_id) AND v.owner_id = v_uid
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Le venue « opérateur » (notifications VIP host) = le club physique de la
  -- soirée : venue_id s'il existe, sinon le club partenaire.
  v_op_venue_id := COALESCE(v_venue_id, v_partner_venue_id);

  FOR item IN SELECT * FROM jsonb_array_elements(p_scans) LOOP
    v_type := item ->> 'entity_type';
    v_id := (item ->> 'entity_id')::uuid;
    -- Anti clock-skew : jamais dans le futur, jamais plus vieux que 48 h.
    v_ts := LEAST(GREATEST((item ->> 'scanned_at')::timestamptz, now() - interval '48 hours'), now());
    v_rows := 0;
    v_existing := NULL;

    -- Chaque item borné à l'event autorisé du batch.
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
         AND COALESCE(ta.entry_scanned, false) = false
      RETURNING ta.ticket_id INTO v_ticket_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        UPDATE tickets SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
         WHERE id = v_ticket_id AND COALESCE(entry_scanned, false) = false;
      ELSE
        SELECT ta.entry_scanned_at INTO v_existing FROM ticket_attendees ta WHERE ta.id = v_id;
      END IF;

    ELSIF v_type = 'ticket' THEN
      UPDATE tickets
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
       WHERE id = v_id AND event_id = v_event_id AND COALESCE(entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT t.entry_scanned_at INTO v_existing FROM tickets t WHERE t.id = v_id;
      END IF;

    ELSIF v_type = 'guest_list_entry' THEN
      UPDATE guest_list_entries g
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid, status = 'entered'
        FROM guest_lists gl
       WHERE g.id = v_id AND gl.id = g.guest_list_id AND gl.event_id = v_event_id
         AND COALESCE(g.entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT g.entry_scanned_at INTO v_existing FROM guest_list_entries g WHERE g.id = v_id;
      END IF;

    ELSIF v_type = 'table_reservation' THEN
      UPDATE table_reservations
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid, checked_in_at = v_ts
       WHERE id = v_id AND event_id = v_event_id AND COALESCE(entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        -- Notification VIP host différée (émise au sync — accepté par la spec).
        SELECT full_name, guest_count, zone_id INTO r FROM table_reservations WHERE id = v_id;
        INSERT INTO staff_notifications (venue_id, event_id, target_role, notification_type,
          title, message, reference_type, reference_id, priority, metadata)
        SELECT v_op_venue_id, v_event_id, 'vip_host', 'vip_entry',
               'Arrivée VIP',
               COALESCE(r.full_name, 'VIP') || ' (' || COALESCE(r.guest_count, 1) || ' pers.) est arrivé'
                 || COALESCE(' - ' || z.name, ''),
               'table_reservation', v_id, 'high',
               jsonb_build_object('guest_name', r.full_name, 'guest_count', COALESCE(r.guest_count, 1),
                                  'zone_name', z.name, 'offline_sync', true)
          FROM (SELECT 1) one
          LEFT JOIN table_zones z ON z.id = r.zone_id;
      ELSE
        SELECT tr.entry_scanned_at INTO v_existing FROM table_reservations tr WHERE tr.id = v_id;
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
    ELSE
      results := results || jsonb_build_object(
        'client_id', item ->> 'client_id', 'status', 'error', 'message', 'not_found');
    END IF;
  END LOOP;

  RETURN results;
END;
$$;
