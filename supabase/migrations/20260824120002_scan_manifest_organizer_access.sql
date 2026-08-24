-- Manifeste de scan : ouvrir la lecture à l'organisateur de la soirée.
--
-- `get_event_scan_manifest` n'autorisait que le staff de porte (bouncer,
-- vip_host, manager) et les owners des clubs de l'événement. Sur une soirée
-- org-led, l'organisateur n'est ni l'un ni l'autre : il ne pouvait donc pas
-- utiliser la recherche par nom à la porte (onglet « Liste » du videur et de
-- /organizer-app/checkin) sur SA PROPRE soirée.
--
-- Ce n'est pas un élargissement de périmètre : l'organisateur voit déjà cette
-- liste nominative dans ses pages Commandes et Guest list. On aligne juste le
-- manifeste sur ce qu'il a le droit de lire ailleurs, en incluant son équipe
-- (rôle 'scanner' minimum) — ce sont précisément les gens qui tiennent la porte
-- pour lui.
--
-- Corps repris à l'identique de 20260730130500, seul le bloc d'autorisation
-- change (ajout du troisième EXISTS).

CREATE OR REPLACE FUNCTION public.get_event_scan_manifest(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_partner_venue_id text;
  v_organizer_user_id uuid;
  v_partner_organizer_id uuid;
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_venue_id, v_partner_venue_id, v_organizer_user_id, v_partner_organizer_id
    FROM events e WHERE e.id = p_event_id;
  IF v_venue_id IS NULL AND v_partner_venue_id IS NULL
     AND v_organizer_user_id IS NULL AND v_partner_organizer_id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Staff porte OU owner de l'un des deux venues de l'event (lead ou partenaire)
  -- OU organisateur de l'event (lead ou partenaire), lui-même ou son équipe.
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
  ) OR (
    v_uid IN (v_organizer_user_id, v_partner_organizer_id)
    OR (v_organizer_user_id IS NOT NULL
        AND is_org_team_member(v_uid, v_organizer_user_id, 'scanner'))
    OR (v_partner_organizer_id IS NOT NULL
        AND is_org_team_member(v_uid, v_partner_organizer_id, 'scanner'))
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
$$;

GRANT EXECUTE ON FUNCTION public.get_event_scan_manifest(uuid) TO authenticated;
