-- Scan offline (app Yuno Pro) : rejeu par lots des scans effectués pendant une
-- coupure réseau. Politique « premier scan gagne » : chaque UPDATE porte le
-- verrou entry_scanned=false ; un scan déjà appliqué ailleurs renvoie
-- 'conflict' avec l'horodatage existant (informatif, non bloquant — à la
-- porte, deux devices qui ont validé le même QR offline ont laissé entrer le
-- même groupe une seule fois).
--
-- Entrée p_scans (jsonb array) :
--   [{ "client_id": "...", "entity_type": "ticket_attendee|ticket|guest_list_entry|table_reservation",
--      "entity_id": "uuid", "scanned_at": "ISO", "device_id": "...", "event_id": "uuid" }]
-- Sortie : [{ "client_id", "status": "applied|conflict|error", "server_scanned_at"?, "conflict_scanned_at"?, "message"? }]

CREATE OR REPLACE FUNCTION public.sync_offline_scans(p_scans jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_venue_id text;
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

  -- Autorisation : même règle que le manifeste, sur l'event du premier item
  -- (le client envoie des batchs mono-event).
  v_event_id := (p_scans -> 0 ->> 'event_id')::uuid;
  SELECT e.venue_id INTO v_venue_id FROM events e WHERE e.id = v_event_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
     WHERE ur.user_id = v_uid AND ur.role IN ('bouncer', 'vip_host', 'manager')
       AND p.venue_id = v_venue_id
  ) OR EXISTS (
    SELECT 1 FROM venues v WHERE v.id = v_venue_id AND v.owner_id = v_uid
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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
        SELECT v_venue_id, v_event_id, 'vip_host', 'vip_entry',
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

GRANT EXECUTE ON FUNCTION public.sync_offline_scans(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_offline_scans(jsonb) FROM anon;
