-- Scan offline (app Yuno Pro) : manifeste pré-téléchargé de tout ce qui se
-- scanne À LA PORTE d'un événement — billets, participants nominatifs, guest
-- list, tables VIP. Le device le stocke en IndexedDB et valide localement
-- pendant les coupures réseau (mêmes règles que le chemin online, voir
-- src/lib/scan/rules.ts). Contient des PII (noms) : accès réservé au staff
-- porte du venue (bouncer / vip_host / manager, rattachés via
-- profiles.venue_id) ou à l'owner.

CREATE OR REPLACE FUNCTION public.get_event_scan_manifest(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.venue_id INTO v_venue_id FROM events e WHERE e.id = p_event_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Staff porte du venue OU owner du venue.
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN profiles p ON p.id = ur.user_id
     WHERE ur.user_id = v_uid
       AND ur.role IN ('bouncer', 'vip_host', 'manager')
       AND p.venue_id = v_venue_id
  ) OR EXISTS (
    SELECT 1 FROM venues v WHERE v.id = v_venue_id AND v.owner_id = v_uid
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
        'venue_id', e.venue_id, 'alcohol_free', e.alcohol_free
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

GRANT EXECUTE ON FUNCTION public.get_event_scan_manifest(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_scan_manifest(uuid) FROM anon;
