-- ============================================================================
-- La porte d'une soirée SANS CLUB : ouvrir le scan au staff d'un organisateur.
--
-- Contexte : une soirée 100 % org-led (events.venue_id ET partner_venue_id à
-- NULL) n'a aucun club dans l'équation. Tout le périmètre « porte » de Yuno
-- était pourtant résolu par le club du scanneur (profiles.venue_id), posé à
-- l'acceptation d'une invitation de club. Un videur invité par un ORGANISATEUR
-- reçoit son rôle `bouncer` et une ligne `org_staff`, jamais de venue_id : il
-- ouvrait l'app Pro sur une porte vide.
--
-- Trois trous fermés ici, tous côté autorisation :
--
--  1. get_event_scan_manifest n'ouvrait la lecture qu'à `org_members` (rôle
--     scanner mini). Le videur d'un organisateur vit dans `org_staff` — table
--     qu'AUCUNE policy ni fonction n'interrogeait. Il ne pouvait donc pas
--     télécharger le manifeste hors-ligne.
--
--  2. sync_offline_scans (le rejeu de la file hors-ligne) résolvait encore
--     l'event par son club UNIQUEMENT : `IF v_venue_id IS NULL ... RAISE
--     event_not_found`. Sur une soirée org-led les deux colonnes venue sont
--     NULL → la fonction refusait TOUT rejeu, y compris pour l'organisateur
--     lui-même. Le mode hors-ligne aurait avalé les scans sans jamais les
--     rendre. C'est le trou le plus grave : il est silencieux jusqu'au
--     lendemain matin.
--
--  3. Les policies de scan (guest_list_entries, tickets, ticket_attendees,
--     table_reservations) passent toutes par `is_event_partner_organizer`, qui
--     exige le rôle `editor` minimum et ignore `org_staff`. Un videur ne
--     pouvait donc pas écrire `entry_scanned`.
--
-- CE QU'ON NE FAIT PAS : élargir `is_event_partner_organizer`. Ce prédicat
-- garde aussi `invoices`, `invoice_numbers` et `promoter_conversions` — de
-- l'argent. Un videur doit recevoir des pouvoirs de PORTE, pas les pouvoirs
-- d'un éditeur. D'où un prédicat neuf, `is_event_door_staff`, et des policies
-- ADDITIVES : rien de ce qui marche aujourd'hui pour les clubs n'est touché.
-- ============================================================================

-- ─── 1. Le prédicat « cette personne tient la porte de cette soirée » ───────
--
-- Deux populations, les deux invitées depuis /organizer-app/team :
--   • org_members  (admin | editor | scanner) — l'équipe de l'organisateur,
--     dont le rôle `scanner` existe précisément pour la porte.
--   • org_staff    (barman | bouncer | cloakroom) — le staff opérationnel.
--     Seul le VIDEUR tient la porte : le barman et le vestiaire ont leurs
--     propres surfaces et n'ont rien à faire dans la liste nominative.
--
-- SECURITY DEFINER : appelé depuis des policies, il doit voir org_members et
-- org_staff sans dépendre de la RLS de l'appelant.
CREATE OR REPLACE FUNCTION public.is_event_door_staff(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = _event_id
       AND (
         EXISTS (
           SELECT 1 FROM public.org_members om
            WHERE om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND om.member_user_id = _user_id
              AND om.invitation_status = 'accepted'
              AND om.role IN ('admin', 'editor', 'scanner')
         )
         OR EXISTS (
           SELECT 1 FROM public.org_staff os
            WHERE os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND os.user_id = _user_id
              AND os.invitation_status = 'accepted'
              AND os.role = 'bouncer'
         )
       )
  )
$$;

-- Variante « par part de guest list ». Elle existe pour que la policy sur
-- guest_list_entries n'ait pas à faire un EXISTS sur `guest_lists` en clair :
-- un tel EXISTS s'exécute sous la RLS de l'appelant, et une part que le videur
-- ne peut pas lire ferait échouer le test sans que rien ne l'explique.
-- Ici la résolution part → soirée se fait à l'intérieur du DEFINER.
CREATE OR REPLACE FUNCTION public.is_guest_list_door_staff(_user_id uuid, _guest_list_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guest_lists gl
     WHERE gl.id = _guest_list_id
       AND gl.event_id IS NOT NULL
       AND public.is_event_door_staff(_user_id, gl.event_id)
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_event_door_staff(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_guest_list_door_staff(uuid, uuid) TO authenticated;

-- ─── 2. Policies de porte (toutes ADDITIVES, aucune existante modifiée) ─────

-- La soirée elle-même. « Everyone can view active events » couvre déjà le cas
-- courant, mais une soirée privée ou désactivée le soir même laisserait la
-- porte aveugle : on ne veut pas que le droit de scanner dépende d'un flag de
-- publication.
DROP POLICY IF EXISTS "Door staff can view their organizer events" ON public.events;
CREATE POLICY "Door staff can view their organizer events"
  ON public.events FOR SELECT TO authenticated
  USING (public.is_event_door_staff(auth.uid(), id));

-- Les parts de guest list : lues en jointure par le scan de porte.
DROP POLICY IF EXISTS "Door staff can view organizer guest lists" ON public.guest_lists;
CREATE POLICY "Door staff can view organizer guest lists"
  ON public.guest_lists FOR SELECT TO authenticated
  USING (event_id IS NOT NULL AND public.is_event_door_staff(auth.uid(), event_id));

-- Les invités : lecture (recherche par nom, manifeste) + écriture du scan.
-- Pas d'INSERT ni de DELETE : un videur valide des entrées, il ne compose pas
-- la liste.
DROP POLICY IF EXISTS "Door staff can view organizer guest entries" ON public.guest_list_entries;
CREATE POLICY "Door staff can view organizer guest entries"
  ON public.guest_list_entries FOR SELECT TO authenticated
  USING (public.is_guest_list_door_staff(auth.uid(), guest_list_id));

DROP POLICY IF EXISTS "Door staff can scan organizer guest entries" ON public.guest_list_entries;
CREATE POLICY "Door staff can scan organizer guest entries"
  ON public.guest_list_entries FOR UPDATE TO authenticated
  USING (public.is_guest_list_door_staff(auth.uid(), guest_list_id))
  WITH CHECK (public.is_guest_list_door_staff(auth.uid(), guest_list_id));

-- Billetterie. La soirée du 11/09 n'en a pas, mais une billetterie ouverte
-- entre-temps ne doit pas rendre la porte muette sur un billet payé.
DROP POLICY IF EXISTS "Door staff can view organizer tickets" ON public.tickets;
CREATE POLICY "Door staff can view organizer tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (public.is_event_door_staff(auth.uid(), event_id));

DROP POLICY IF EXISTS "Door staff can scan organizer tickets" ON public.tickets;
CREATE POLICY "Door staff can scan organizer tickets"
  ON public.tickets FOR UPDATE TO authenticated
  USING (public.is_event_door_staff(auth.uid(), event_id))
  WITH CHECK (public.is_event_door_staff(auth.uid(), event_id));

DROP POLICY IF EXISTS "Door staff can view organizer ticket attendees" ON public.ticket_attendees;
CREATE POLICY "Door staff can view organizer ticket attendees"
  ON public.ticket_attendees FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_door_staff(auth.uid(), t.event_id)
  ));

DROP POLICY IF EXISTS "Door staff can scan organizer ticket attendees" ON public.ticket_attendees;
CREATE POLICY "Door staff can scan organizer ticket attendees"
  ON public.ticket_attendees FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_door_staff(auth.uid(), t.event_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.id = ticket_attendees.ticket_id
       AND public.is_event_door_staff(auth.uid(), t.event_id)
  ));

-- Tables VIP : même raisonnement que la billetterie.
DROP POLICY IF EXISTS "Door staff can view organizer reservations" ON public.table_reservations;
CREATE POLICY "Door staff can view organizer reservations"
  ON public.table_reservations FOR SELECT TO authenticated
  USING (event_id IS NOT NULL AND public.is_event_door_staff(auth.uid(), event_id));

DROP POLICY IF EXISTS "Door staff can scan organizer reservations" ON public.table_reservations;
CREATE POLICY "Door staff can scan organizer reservations"
  ON public.table_reservations FOR UPDATE TO authenticated
  USING (event_id IS NOT NULL AND public.is_event_door_staff(auth.uid(), event_id))
  WITH CHECK (event_id IS NOT NULL AND public.is_event_door_staff(auth.uid(), event_id));

-- ─── 3. Manifeste hors-ligne : autoriser le staff de porte de l'organisateur ─
--
-- Corps repris de 20260824120002. Deux changements :
--   • le bloc d'autorisation délègue à is_event_door_staff (couvre org_members
--     scanner comme avant, ET org_staff bouncer),
--   • l'objet `event` porte désormais organizer_user_id / partner_organizer_id.
--     C'est nécessaire côté client : le contrôle « ce QR appartient-il bien à
--     ma porte ? » comparait un venue_id, qui est NULL des deux côtés sur une
--     soirée org-led — donc un contrôle qui ne contrôlait plus rien. Avec
--     l'organisateur dans le manifeste, le contrôle redevient effectif.
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

-- ─── 4. Rejeu hors-ligne : le trou silencieux ───────────────────────────────
--
-- Corps repris de 20260714160100. Trois changements :
--   • l'existence de la soirée se teste sur la LIGNE, plus sur son venue_id :
--     une soirée org-led ne pouvait rien rejouer du tout ;
--   • l'autorisation couvre l'organisateur et son staff de porte ;
--   • la notification « arrivée VIP » n'est émise que s'il y a un club à
--     notifier — staff_notifications.venue_id ne peut pas être NULL, et une
--     insertion en échec ferait échouer TOUT le lot de rejeu, donc perdrait
--     des entrées déjà validées à la porte.
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
  v_organizer_user_id uuid;
  v_partner_organizer_id uuid;
  v_op_venue_id text;
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
  SELECT true, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
    INTO v_found, v_venue_id, v_partner_venue_id, v_organizer_user_id, v_partner_organizer_id
    FROM events e WHERE e.id = v_event_id;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Même précaution NULL qu'au manifeste : voir le commentaire là-haut.
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

  -- Le club « opérateur » (notifications VIP host) : venue_id, sinon le club
  -- partenaire. NULL sur une soirée org-led — il n'y a personne à prévenir.
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
      IF v_rows > 0 AND v_op_venue_id IS NOT NULL THEN
        -- Notification VIP host différée (émise au sync — accepté par la spec).
        -- Sautée sur une soirée sans club : il n'y a pas d'hôte VIP de club.
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
      ELSIF v_rows = 0 THEN
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
