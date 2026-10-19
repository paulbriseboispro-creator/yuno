-- Une table de N personnes = un ticket par personne (2026-10-19, demande de Paul)
-- « Pour une table de tant de personnes, un ticket nominatif pour la personne qui
-- a réservé, et des tickets invité 1, 2 etc. reliés à la résa de la table. »
--
-- table_reservation_guests : une ligne par personne d'une réservation de 2 à 50
-- personnes. N° 0 = le titulaire (son nom), n° k = « Invité k ». QR = QR de la
-- réservation + « -<n°+1> », comme les places nominatives d'un billet
-- (_shared/ticket-places.ts). Une table d'UNE personne n'a pas de ligne : son QR
-- est son ticket.
--
-- Créées par la BASE (trigger sur table_reservations), donc sur tous les chemins
-- qui écrivent une réservation : paiement Stripe (réservation « pending », partie
-- en cascade si jamais payée), démo simulée, règlement sur place. Une réservation
-- sans QR (ajout manuel, walk-in de l'hôte VIP) n'a pas de tickets d'invités.
--
-- Porte (même règle que les billets, 20261102150000) :
--  - QR d'un invité = une personne, si la réservation est payée ;
--  - QR de la réservation = les invités encore dehors, « déjà scanné » quand il
--    n'en reste aucun ;
--  - la première entrée marque la réservation (entry_scanned + checked_in_at) :
--    l'hôte VIP reçoit « Arrivée VIP » une fois (trg_notify_vip_host_on_arrival) ;
--  - un ancien scan du QR de la réservation (app Pro pas à jour) fait entrer
--    toute la table, comme avant.
-- Le compteur de porte (_door_headcount) compte les invités entrés un par un.
-- get_event_scan_manifest et sync_offline_scans repartent de leur définition en
-- prod au 19/10 (après 20261102150000) : seuls les blocs table changent.

CREATE TABLE IF NOT EXISTS public.table_reservation_guests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id   uuid NOT NULL REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  guest_number     integer NOT NULL CHECK (guest_number >= 0 AND guest_number < 50),
  full_name        text,
  qr_code          text NOT NULL,
  entry_scanned    boolean NOT NULL DEFAULT false,
  entry_scanned_at timestamptz,
  entry_scanned_by uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_reservation_guests_number_key UNIQUE (reservation_id, guest_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS table_reservation_guests_qr_key
  ON public.table_reservation_guests (qr_code);

COMMENT ON TABLE public.table_reservation_guests IS
  'Un ticket par personne d''une table (n° 0 = titulaire, n° k = Invité k). Écrite par la base seule (_table_guests_sync) ; la porte ne change que entry_scanned.';

ALTER TABLE public.table_reservation_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_reservation_guests FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.table_reservation_guests TO authenticated;
GRANT ALL ON public.table_reservation_guests TO service_role;

-- Nombre de tickets d'une table (0 = le QR de la réservation suffit).
CREATE OR REPLACE FUNCTION public._table_guest_ticket_count(p_guest_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT CASE WHEN p_guest_count BETWEEN 2 AND 50 THEN p_guest_count ELSE 0 END
$$;

-- La seule écriture des tickets d'une table. Idempotente : crée les numéros
-- manquants, retire ceux de trop qui ne sont pas encore entrés, suit le QR et le
-- nom du titulaire. Jamais un ticket entré n'est effacé ni renommé.
CREATE OR REPLACE FUNCTION public._table_guests_sync(p_reservation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_n integer;
  v_holder text;
  v_first boolean;
BEGIN
  SELECT tr.id, tr.qr_code, tr.guest_count, tr.full_name, tr.guest_first_name, tr.guest_last_name,
         tr.user_email, tr.entry_scanned, tr.entry_scanned_at, tr.entry_scanned_by
    INTO r
    FROM table_reservations tr WHERE tr.id = p_reservation_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_n := CASE WHEN r.qr_code IS NULL OR btrim(r.qr_code) = '' THEN 0
              ELSE _table_guest_ticket_count(r.guest_count) END;

  DELETE FROM table_reservation_guests
   WHERE reservation_id = r.id AND guest_number >= v_n AND NOT entry_scanned;
  IF v_n = 0 THEN RETURN; END IF;

  v_holder := COALESCE(
    NULLIF(btrim(r.full_name), ''),
    NULLIF(btrim(concat_ws(' ', r.guest_first_name, r.guest_last_name)), ''),
    NULLIF(split_part(COALESCE(r.user_email, ''), '@', 1), ''),
    'Guest');

  -- Première création sur une réservation déjà entrée (rattrapage) : ses tickets
  -- naissent entrés, le compteur de porte ne recule pas.
  v_first := NOT EXISTS (SELECT 1 FROM table_reservation_guests WHERE reservation_id = r.id);

  INSERT INTO table_reservation_guests
    (reservation_id, guest_number, full_name, qr_code,
     entry_scanned, entry_scanned_at, entry_scanned_by, created_at)
  SELECT r.id, k, CASE WHEN k = 0 THEN v_holder END, r.qr_code || '-' || (k + 1),
         v_first AND COALESCE(r.entry_scanned, false),
         CASE WHEN v_first AND COALESCE(r.entry_scanned, false) THEN COALESCE(r.entry_scanned_at, now()) END,
         CASE WHEN v_first AND COALESCE(r.entry_scanned, false) THEN r.entry_scanned_by END,
         now() + make_interval(secs => k / 1000.0)
    FROM generate_series(0, v_n - 1) AS k
  ON CONFLICT (reservation_id, guest_number) DO NOTHING;

  UPDATE table_reservation_guests g
     SET qr_code = r.qr_code || '-' || (g.guest_number + 1),
         full_name = CASE WHEN g.guest_number = 0 THEN v_holder ELSE g.full_name END
   WHERE g.reservation_id = r.id AND NOT g.entry_scanned
     AND (g.qr_code IS DISTINCT FROM r.qr_code || '-' || (g.guest_number + 1)
          OR (g.guest_number = 0 AND g.full_name IS DISTINCT FROM v_holder));
END;
$$;
REVOKE ALL ON FUNCTION public._table_guests_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._table_guests_sync(uuid) TO service_role;

-- Un échec ne coûte jamais la réservation : le QR de la réservation fait entrer
-- toute la table, comme avant.
CREATE OR REPLACE FUNCTION public.table_reservation_guests_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public._table_guests_sync(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'table_reservation_guests_follow(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.table_reservation_guests_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_table_reservation_guests_insert ON public.table_reservations;
CREATE TRIGGER trg_table_reservation_guests_insert
  AFTER INSERT ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.table_reservation_guests_follow();

DROP TRIGGER IF EXISTS trg_table_reservation_guests_update ON public.table_reservations;
CREATE TRIGGER trg_table_reservation_guests_update
  AFTER UPDATE OF guest_count, qr_code, full_name, guest_first_name, guest_last_name
  ON public.table_reservations
  FOR EACH ROW
  WHEN (OLD.guest_count IS DISTINCT FROM NEW.guest_count
     OR OLD.qr_code IS DISTINCT FROM NEW.qr_code
     OR OLD.full_name IS DISTINCT FROM NEW.full_name
     OR OLD.guest_first_name IS DISTINCT FROM NEW.guest_first_name
     OR OLD.guest_last_name IS DISTINCT FROM NEW.guest_last_name)
  EXECUTE FUNCTION public.table_reservation_guests_follow();

-- Porte d'une soirée : la même règle que le manifeste et la synchro hors ligne
-- (staff du club, propriétaire, organisateur, staff de porte de l'organisateur,
-- co-hôte éditeur). Toujours sur l'appelant : jamais une question sur un autre.
CREATE OR REPLACE FUNCTION public.can_scan_table_reservation(p_reservation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT
      COALESCE((SELECT EXISTS (
        SELECT 1 FROM user_roles ur JOIN profiles p ON p.id = ur.user_id
         WHERE ur.user_id = auth.uid() AND ur.role IN ('bouncer', 'vip_host', 'manager')
           AND p.venue_id IN (e.venue_id, e.partner_venue_id))), false)
      OR COALESCE((SELECT EXISTS (
        SELECT 1 FROM venues v
         WHERE v.id IN (e.venue_id, e.partner_venue_id) AND v.owner_id = auth.uid())), false)
      OR auth.uid() IS NOT DISTINCT FROM e.organizer_user_id
      OR auth.uid() IS NOT DISTINCT FROM e.partner_organizer_id
      OR COALESCE(is_event_door_staff(auth.uid(), e.id), false)
      FROM table_reservations r JOIN events e ON e.id = r.event_id
     WHERE r.id = p_reservation_id AND auth.uid() IS NOT NULL
  ), false)
$$;
REVOKE ALL ON FUNCTION public.can_scan_table_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_scan_table_reservation(uuid) TO authenticated, service_role;

-- Lecture : qui voit la réservation voit ses tickets (le client, la porte, le club,
-- l'organisateur). Écriture : la porte seule, et seulement entry_scanned.
DROP POLICY IF EXISTS "Table guests follow their reservation" ON public.table_reservation_guests;
CREATE POLICY "Table guests follow their reservation"
  ON public.table_reservation_guests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.id = reservation_id));

DROP POLICY IF EXISTS "Door staff scan table guests" ON public.table_reservation_guests;
CREATE POLICY "Door staff scan table guests"
  ON public.table_reservation_guests FOR UPDATE TO authenticated
  USING (public.can_scan_table_reservation(reservation_id))
  WITH CHECK (public.can_scan_table_reservation(reservation_id));

-- Garde : un client ne touche qu'au scan ; un invité d'une réservation qui n'est
-- pas payée (remboursée, annulée, en attente) n'entre pas.
CREATE OR REPLACE FUNCTION public.guard_table_reservation_guest()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
    OR NEW.guest_number   IS DISTINCT FROM OLD.guest_number
    OR NEW.qr_code        IS DISTINCT FROM OLD.qr_code
    OR NEW.full_name      IS DISTINCT FROM OLD.full_name
    OR NEW.created_at     IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'table_reservation_guests: only the entry scan can change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.entry_scanned AND NOT OLD.entry_scanned AND NOT EXISTS (
       SELECT 1 FROM public.table_reservations r
        WHERE r.id = NEW.reservation_id AND r.status = 'paid') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_table_reservation_guest ON public.table_reservation_guests;
CREATE TRIGGER trg_guard_table_reservation_guest
  BEFORE UPDATE ON public.table_reservation_guests
  FOR EACH ROW EXECUTE FUNCTION public.guard_table_reservation_guest();

-- Qui et quand : posés par la base, jamais par le téléphone (même trigger que
-- billets, places et réservations).
DROP TRIGGER IF EXISTS trg_stamp_door_entry_scan ON public.table_reservation_guests;
CREATE TRIGGER trg_stamp_door_entry_scan
  BEFORE UPDATE ON public.table_reservation_guests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_door_entry_scan();

-- Le premier invité entré marque la réservation : arrivée de la table, hôte VIP
-- prévenu une fois, chiffres d'arrivée des tables.
CREATE OR REPLACE FUNCTION public.door_table_guest_scan_marks_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.entry_scanned AND NOT OLD.entry_scanned THEN
    UPDATE public.table_reservations
       SET entry_scanned = true,
           entry_scanned_at = COALESCE(NEW.entry_scanned_at, now()),
           entry_scanned_by = NEW.entry_scanned_by,
           checked_in_at = COALESCE(checked_in_at, NEW.entry_scanned_at, now())
     WHERE id = NEW.reservation_id
       AND COALESCE(entry_scanned, false) = false;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.door_table_guest_scan_marks_reservation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_door_table_guest_scan_marks_reservation ON public.table_reservation_guests;
CREATE TRIGGER trg_door_table_guest_scan_marks_reservation
  AFTER UPDATE OF entry_scanned ON public.table_reservation_guests
  FOR EACH ROW EXECUTE FUNCTION public.door_table_guest_scan_marks_reservation();

-- Le QR de la réservation scanné à l'ancienne (app Pro pas à jour, ou table dont
-- personne n'est encore entré) fait entrer toute la table.
CREATE OR REPLACE FUNCTION public.door_table_scan_consumes_guests()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (COALESCE(NEW.entry_scanned, false) AND NOT COALESCE(OLD.entry_scanned, false)) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_reservation_guests
     WHERE reservation_id = NEW.id AND entry_scanned
  ) THEN
    RETURN NEW;
  END IF;
  UPDATE public.table_reservation_guests
     SET entry_scanned = true,
         entry_scanned_at = COALESCE(NEW.entry_scanned_at, now()),
         entry_scanned_by = NEW.entry_scanned_by
   WHERE reservation_id = NEW.id AND NOT entry_scanned;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.door_table_scan_consumes_guests() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_door_table_scan_consumes_guests ON public.table_reservations;
CREATE TRIGGER trg_door_table_scan_consumes_guests
  AFTER UPDATE OF entry_scanned ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.door_table_scan_consumes_guests();

-- Manifeste de porte (définition prod du 19/10 + blocs table).
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
        -- Table à tickets d'invités : le QR de la réservation fait entrer les
        -- invités encore dehors ; « scanné » quand il n'en reste aucun.
        'scanned', CASE WHEN gp.n > 0 THEN gp.free = 0 ELSE COALESCE(r.entry_scanned, false) END,
        'scanned_at', r.entry_scanned_at,
        'guests', CASE WHEN gp.n > 0 THEN GREATEST(1, gp.free) ELSE r.guest_count END,
        'party', r.guest_count,
        'zone', z.name, 'pack', pk.name,
        'arrival', pk.arrival_deadline,
        'deposit', r.deposit, 'total', r.total_price
      ))
      FROM table_reservations r
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE NOT x.entry_scanned)::int AS free
          FROM table_reservation_guests x WHERE x.reservation_id = r.id
      ) gp
      WHERE r.event_id = p_event_id AND r.qr_code IS NOT NULL
    ), '[]'::jsonb),
    -- Un ticket par personne d'une table : le titulaire (n° 0) puis Invité 1, 2…
    'table_guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'qr', g.qr_code, 'reservation_id', r.id,
        'number', g.guest_number, 'name', g.full_name, 'holder', r.full_name,
        'status', r.status,
        'scanned', g.entry_scanned, 'scanned_at', g.entry_scanned_at,
        'party', r.guest_count, 'zone', z.name, 'pack', pk.name,
        'arrival', pk.arrival_deadline,
        'deposit', r.deposit, 'total', r.total_price
      ) ORDER BY r.id, g.guest_number)
      FROM table_reservation_guests g
      JOIN table_reservations r ON r.id = g.reservation_id
      LEFT JOIN table_zones z ON z.id = r.zone_id
      LEFT JOIN table_packs pk ON pk.id = r.pack_id
      WHERE r.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$function$;

-- Synchro hors ligne (définition prod du 19/10 + invités de table).
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
      IF EXISTS (SELECT 1 FROM table_reservation_guests WHERE reservation_id = v_id) THEN
        -- Table à tickets d'invités : le QR de la réservation fait entrer les
        -- invités encore dehors (la réservation est marquée par ricochet).
        UPDATE table_reservation_guests g
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
          FROM table_reservations tr
         WHERE g.reservation_id = v_id AND tr.id = g.reservation_id
           AND tr.event_id = v_event_id AND tr.status = 'paid'
           AND NOT g.entry_scanned;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      ELSE
        UPDATE table_reservations
           SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid,
               checked_in_at = COALESCE(checked_in_at, v_ts)
         WHERE id = v_id AND event_id = v_event_id AND status = 'paid'
           AND COALESCE(entry_scanned, false) = false;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      END IF;
      IF v_rows = 0 THEN
        SELECT CASE WHEN tr.entry_scanned THEN COALESCE(tr.entry_scanned_at, now()) END,
               tr.status IS DISTINCT FROM 'paid'
          INTO v_existing, v_invalid
          FROM table_reservations tr WHERE tr.id = v_id;
      END IF;

    ELSIF v_type = 'table_guest' THEN
      UPDATE table_reservation_guests g
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
        FROM table_reservations tr
       WHERE g.id = v_id AND tr.id = g.reservation_id AND tr.event_id = v_event_id
         AND tr.status = 'paid'
         AND NOT g.entry_scanned;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT CASE WHEN g.entry_scanned THEN COALESCE(g.entry_scanned_at, now()) END,
               tr.status IS DISTINCT FROM 'paid'
          INTO v_existing, v_invalid
          FROM table_reservation_guests g JOIN table_reservations tr ON tr.id = g.reservation_id
         WHERE g.id = v_id;
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

-- Compteur de porte : un invité entré = une personne.
CREATE OR REPLACE FUNCTION public._door_headcount(p_event_ids uuid[], p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT tk.id, tk.quantity, tk.entry_scanned, tk.entry_scanned_at,
           EXISTS (SELECT 1 FROM public.ticket_attendees a WHERE a.ticket_id = tk.id) AS nominative
      FROM public.tickets tk
     WHERE tk.event_id = ANY(p_event_ids) AND tk.status = 'paid'
  ), gle AS (
    SELECT g.entry_scanned, g.entry_scanned_at
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = ANY(p_event_ids) AND g.status IS DISTINCT FROM 'cancelled'
  ), tr AS (
    SELECT r.id, GREATEST(COALESCE(r.guest_count, 1), 1) AS guests, r.entry_scanned, r.entry_scanned_at,
           EXISTS (SELECT 1 FROM public.table_reservation_guests g WHERE g.reservation_id = r.id) AS nominative
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status = 'paid'
  )
  SELECT jsonb_build_object(
    'entered',
      (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id
        WHERE a.entry_scanned AND (p_since IS NULL OR a.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(t.quantity), 0) FROM t
        WHERE NOT t.nominative AND t.entry_scanned AND (p_since IS NULL OR t.entry_scanned_at >= p_since))
    + (SELECT count(*) FROM public.table_reservation_guests g JOIN tr ON tr.id = g.reservation_id
        WHERE g.entry_scanned AND (p_since IS NULL OR g.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr
        WHERE NOT tr.nominative AND tr.entry_scanned AND (p_since IS NULL OR tr.entry_scanned_at >= p_since))
    + (SELECT count(*) FROM gle
        WHERE gle.entry_scanned AND (p_since IS NULL OR gle.entry_scanned_at >= p_since)),
    'expected',
      (SELECT COALESCE(sum(t.quantity), 0) FROM t)
    - (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id
        WHERE a.refunded_at IS NOT NULL)
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr)
    + (SELECT count(*) FROM gle)
  )
$function$;

-- Rattrapage : les tables des soirées pas encore finies reçoivent leurs tickets
-- (celles déjà entrées les reçoivent entrés).
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN
    SELECT r.id FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
     WHERE r.qr_code IS NOT NULL
       AND r.status IN ('paid', 'pending')
       AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()
  LOOP
    PERFORM public._table_guests_sync(v_id);
  END LOOP;
END $$;
