-- ════════════════════════════════════════════════════════════════════════════
-- Porte — refuser UN ami d'un billet nominatif ne rembourse que SA place
-- (2026-10-19, avant House Of Masquerade)
--
-- Un billet acheté pour plusieurs personnes porte un QR par ami nommé à
-- l'achat (`ticket_attendees`). Hors créneau, « Refuser + rembourser » appelait
-- staff-cancel sur le billet PARENT : un seul ami en retard faisait rembourser
-- toute la commande, et si un autre ami était déjà entré (billet parent marqué
-- par `door_attendee_scan_marks_ticket`), staff-cancel refusait tout.
--
-- Désormais une place se rembourse seule :
--  - `ticket_attendees` porte son remboursement (`refunded_at`, `refund_amount`,
--    `refunded_by`, `refund_reason`) et les places de la jauge qu'il a rendues
--    (`seats_released`) ;
--  - `door_refund_ticket_place` (service_role, appelée par staff-cancel) pose,
--    sous le verrou du billet, la place remboursée, le cumul `refund_amount` du
--    billet (le verrou existant de toute la chaîne de remboursement) et les
--    places rendues à la jauge ; la dernière place remboursée passe le billet
--    « refunded ». Le montant vient de `doorPlaceRefundCents`
--    (_shared/sale-refund.ts, testé) : la part de la place dans le
--    remboursement net du billet entier ;
--  - une place remboursée ne passe plus la porte, par aucun chemin : garde
--    `guard_ticket_attendee_place` (la mise à jour d'entrée est ignorée), QR du
--    billet entier qui ne la consomme plus, manifeste hors ligne qui la dit
--    « refunded », synchro hors ligne qui la refuse ;
--  - `release_refunded_ticket` ne rend plus deux fois les places déjà rendues
--    une à une ; le compteur de porte n'attend plus les places remboursées.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ticket_attendees
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS refunded_by uuid,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS seats_released integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ticket_attendees.refunded_at IS
  'Place remboursée seule à la porte (door_refund_ticket_place) : elle ne passe plus la porte.';
COMMENT ON COLUMN public.ticket_attendees.seats_released IS
  'Places de la jauge (ticket_rounds.tickets_sold) rendues avec cette place.';

-- ─── Garde : le remboursement d'une place n'appartient qu'au serveur ─────────
-- SECURITY INVOKER + current_user (un trigger de garde DEFINER se
-- désactiverait lui-même). La seconde règle vaut pour TOUS les rôles : une
-- place remboursée qu'on tente de marquer « entrée » est ignorée (la mise à
-- jour rend 0 ligne : « déjà traité » pour le téléphone, « not_valid » pour la
-- synchro hors ligne), jamais une exception qui ferait tomber un lot de synchro.
CREATE OR REPLACE FUNCTION public.guard_ticket_attendee_place()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.refunded_at     IS DISTINCT FROM OLD.refunded_at
    OR NEW.refund_amount   IS DISTINCT FROM OLD.refund_amount
    OR NEW.refunded_by     IS DISTINCT FROM OLD.refunded_by
    OR NEW.refund_reason   IS DISTINCT FROM OLD.refund_reason
    OR NEW.seats_released  IS DISTINCT FROM OLD.seats_released
    OR NEW.ticket_id       IS DISTINCT FROM OLD.ticket_id) THEN
    RAISE EXCEPTION 'ticket_attendees: refund fields are server-only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.refunded_at IS NOT NULL
     AND COALESCE(NEW.entry_scanned, false) AND NOT COALESCE(OLD.entry_scanned, false) THEN
    RETURN NULL;
  END IF;
  -- Une place remboursée le reste.
  IF OLD.refunded_at IS NOT NULL AND NEW.refunded_at IS NULL THEN
    NEW.refunded_at := OLD.refunded_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_ticket_attendee_place() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ticket_attendee_place ON public.ticket_attendees;
CREATE TRIGGER trg_guard_ticket_attendee_place BEFORE UPDATE ON public.ticket_attendees
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_attendee_place();

-- ─── Rembourser une place : tout en une transaction, sous le verrou du billet ─
-- Appelée par staff-cancel AVANT Stripe (même ordre que le billet entier :
-- verrou et montant posés, puis l'argent). `p_amount` est calculé par
-- `doorPlaceRefundCents` à partir de ce que staff-cancel a lu ;
-- `p_expected_refund_amount` et `p_expected_places_refunded` disent ce qu'il a
-- lu : si un autre téléphone (ou la Console) est passé entre-temps, rien n'est
-- écrit (`stale`) et la porte recommence. Les places de la jauge se partagent
-- comme l'argent : floor(N·(k+1)/n) − floor(N·k/n), la somme tombe juste.
CREATE OR REPLACE FUNCTION public.door_refund_ticket_place(
  p_attendee_id uuid,
  p_amount numeric,
  p_expected_refund_amount numeric,
  p_expected_places_refunded integer,
  p_reason text,
  p_by uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_t public.tickets%ROWTYPE;
  v_att public.ticket_attendees%ROWTYPE;
  v_places integer;
  v_refunded integer;
  v_total_seats integer;
  v_seats integer := 0;
  v_cum numeric;
  v_full boolean;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT ticket_id INTO v_ticket_id FROM public.ticket_attendees WHERE id = p_attendee_id;
  IF v_ticket_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attendee_not_found');
  END IF;

  -- Le billet d'abord (ordre de verrou unique), puis la place, relue sous verrou.
  SELECT * INTO v_t FROM public.tickets WHERE id = v_ticket_id FOR UPDATE;
  SELECT * INTO v_att FROM public.ticket_attendees WHERE id = p_attendee_id FOR UPDATE;

  IF v_t.status IS DISTINCT FROM 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_paid');
  END IF;
  IF COALESCE(v_att.entry_scanned, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_scanned');
  END IF;
  IF v_att.refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_refunded');
  END IF;

  SELECT count(*)::int, count(*) FILTER (WHERE refunded_at IS NOT NULL)::int
    INTO v_places, v_refunded
    FROM public.ticket_attendees WHERE ticket_id = v_t.id;

  IF round(COALESCE(v_t.refund_amount, 0) * 100) <> round(COALESCE(p_expected_refund_amount, 0) * 100)
     OR v_refunded <> COALESCE(p_expected_places_refunded, -1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale');
  END IF;
  -- Filet : jamais plus que ce que le client a payé et n'a pas encore récupéré.
  IF round(p_amount * 100) > round(GREATEST(0, COALESCE(v_t.total_price, 0) - COALESCE(v_t.refund_amount, 0)) * 100) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_exceeds_paid');
  END IF;

  -- Places de la jauge : même règle que release_refunded_ticket (capacité tenue
  -- par la réservation, sinon la quantité), partagée entre les places.
  IF v_t.ticket_round_id IS NOT NULL THEN
    SELECT r.capacity_held INTO v_total_seats FROM public.ticket_reservations r WHERE r.id = v_t.reservation_id;
    v_total_seats := COALESCE(NULLIF(v_total_seats, 0), NULLIF(v_t.quantity, 0), 1);
    v_seats := floor(v_total_seats::numeric * (v_refunded + 1) / v_places)::int
             - floor(v_total_seats::numeric * v_refunded / v_places)::int;
  END IF;

  UPDATE public.ticket_attendees
     SET refunded_at = now(),
         refund_amount = round(p_amount, 2),
         refunded_by = p_by,
         refund_reason = left(p_reason, 500),
         seats_released = v_seats
   WHERE id = p_attendee_id;

  IF v_seats > 0 THEN
    UPDATE public.ticket_rounds
       SET tickets_sold = GREATEST(0, tickets_sold - v_seats)
     WHERE id = v_t.ticket_round_id;
  END IF;

  v_cum := round(COALESCE(v_t.refund_amount, 0) + p_amount, 2);
  v_full := (v_refunded + 1) >= v_places;

  -- La dernière place remboursée passe le billet « refunded » : le trigger
  -- release_refunded_ticket ne rend alors que les places qui restaient.
  UPDATE public.tickets
     SET refund_amount = CASE WHEN p_amount > 0 THEN v_cum ELSE refund_amount END,
         refunded_at   = CASE WHEN p_amount > 0 THEN now() ELSE refunded_at END,
         status        = CASE WHEN v_full THEN 'refunded' ELSE status END,
         cancelled_at  = CASE WHEN v_full THEN now() ELSE cancelled_at END,
         refunded_by   = CASE WHEN v_full THEN p_by ELSE refunded_by END,
         refund_reason = CASE WHEN v_full THEN left(p_reason, 500) ELSE refund_reason END
   WHERE id = v_t.id;

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', v_t.id,
    'cumulative', CASE WHEN p_amount > 0 THEN v_cum ELSE COALESCE(v_t.refund_amount, 0) END,
    'fully_refunded', v_full,
    'places', v_places,
    'places_refunded', v_refunded + 1,
    'seats_released', v_seats
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.door_refund_ticket_place(uuid, numeric, numeric, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.door_refund_ticket_place(uuid, numeric, numeric, integer, text, uuid) TO service_role;

-- ─── Stripe a refusé : l'argent n'est pas parti ─────────────────────────────
-- La place reste refusée (l'entrée a été refusée, on ne la ranime pas, comme
-- le billet entier), mais le montant enregistré revient à ce qui a vraiment été
-- rendu. Le super admin rembourse à la main depuis Stripe ; le webhook
-- `charge.refunded` enregistrera alors le montant et préviendra le client.
CREATE OR REPLACE FUNCTION public.door_place_refund_not_sent(p_attendee_id uuid, p_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_att public.ticket_attendees%ROWTYPE;
BEGIN
  SELECT ticket_id INTO v_ticket_id FROM public.ticket_attendees WHERE id = p_attendee_id;
  IF v_ticket_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.tickets WHERE id = v_ticket_id FOR UPDATE;
  SELECT * INTO v_att FROM public.ticket_attendees WHERE id = p_attendee_id FOR UPDATE;
  IF v_att.refunded_at IS NULL OR round(COALESCE(v_att.refund_amount, 0) * 100) <> round(p_amount * 100) THEN
    RETURN false;
  END IF;
  UPDATE public.ticket_attendees SET refund_amount = 0 WHERE id = p_attendee_id;
  UPDATE public.tickets
     SET refund_amount = NULLIF(GREATEST(0, round(COALESCE(refund_amount, 0) - p_amount, 2)), 0)
   WHERE id = v_ticket_id;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.door_place_refund_not_sent(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.door_place_refund_not_sent(uuid, numeric) TO service_role;

-- ─── Le QR du billet entier ne consomme plus une place remboursée ───────────
CREATE OR REPLACE FUNCTION public.door_ticket_scan_consumes_attendees()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ticket_attendees
     WHERE ticket_id = NEW.id AND COALESCE(entry_scanned, false)
  ) THEN
    RETURN NEW;
  END IF;
  UPDATE public.ticket_attendees
     SET entry_scanned = true,
         entry_scanned_at = COALESCE(NEW.entry_scanned_at, now()),
         entry_scanned_by = NEW.entry_scanned_by
   WHERE ticket_id = NEW.id
     AND refunded_at IS NULL
     AND COALESCE(entry_scanned, false) = false;
  RETURN NEW;
END;
$function$;

-- ─── Un billet remboursé ne rend pas deux fois une place déjà rendue ────────
CREATE OR REPLACE FUNCTION public.release_refunded_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seats integer;
BEGIN
  IF NEW.ticket_round_id IS NOT NULL AND NOT COALESCE(OLD.entry_scanned, false) THEN
    BEGIN
      SELECT r.capacity_held INTO v_seats
      FROM public.ticket_reservations r
      WHERE r.id = NEW.reservation_id;

      v_seats := COALESCE(NULLIF(v_seats, 0), NULLIF(NEW.quantity, 0), 1)
        -- Places déjà rendues une à une à la porte (door_refund_ticket_place) :
        -- jamais rendues deux fois.
        - COALESCE((SELECT sum(a.seats_released) FROM public.ticket_attendees a
                     WHERE a.ticket_id = NEW.id), 0);

      IF v_seats > 0 THEN
        UPDATE public.ticket_rounds
        SET tickets_sold = GREATEST(0, tickets_sold - v_seats)
        WHERE id = NEW.ticket_round_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'release_refunded_ticket: seats not released for ticket % (%)', NEW.id, SQLERRM;
    END;
  END IF;

  BEGIN
    DELETE FROM public.order_pack_credits WHERE ticket_order_id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'release_refunded_ticket: drink credits not removed for ticket % (%)', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- ─── Compteur de porte : une place remboursée n'est plus attendue ───────────
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
    SELECT GREATEST(COALESCE(r.guest_count, 1), 1) AS guests, r.entry_scanned, r.entry_scanned_at
      FROM public.table_reservations r
     WHERE r.event_id = ANY(p_event_ids) AND r.status = 'paid'
  )
  SELECT jsonb_build_object(
    'entered',
      (SELECT count(*) FROM public.ticket_attendees a JOIN t ON t.id = a.ticket_id
        WHERE a.entry_scanned AND (p_since IS NULL OR a.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(t.quantity), 0) FROM t
        WHERE NOT t.nominative AND t.entry_scanned AND (p_since IS NULL OR t.entry_scanned_at >= p_since))
    + (SELECT COALESCE(sum(tr.guests), 0) FROM tr
        WHERE tr.entry_scanned AND (p_since IS NULL OR tr.entry_scanned_at >= p_since))
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

-- ─── Manifeste hors ligne : place remboursée = refusée ──────────────────────
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
        'scanned', COALESCE(t.entry_scanned, false), 'scanned_at', t.entry_scanned_at,
        -- Le QR du billet entier ne fait plus entrer les places remboursées.
        'qty', GREATEST(1, COALESCE(t.quantity, 1) - (
          SELECT count(*)::int FROM ticket_attendees x
           WHERE x.ticket_id = t.id AND x.refunded_at IS NOT NULL)),
        'round', tr.name, 'drink', tr.includes_drink,
        'deadline', tr.entry_deadline,
        'drink_cutoff', CASE WHEN tr.drink_deadline_type = 'fixed_time' THEN tr.drink_cutoff_time END
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
$function$;

-- ─── Synchro hors ligne : une place remboursée pendant la coupure est refusée ─
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
      UPDATE tickets
         SET entry_scanned = true, entry_scanned_at = v_ts, entry_scanned_by = v_uid
       WHERE id = v_id AND event_id = v_event_id AND status = 'paid'
         AND COALESCE(entry_scanned, false) = false;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
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
