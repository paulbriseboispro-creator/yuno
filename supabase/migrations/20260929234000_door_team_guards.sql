-- ════════════════════════════════════════════════════════════════════════════
-- Porte — plusieurs videurs, une seule vérité, chaque scan signé (2026-09-29)
--
-- Revue du profil videur avant les premières vraies soirées à plusieurs
-- téléphones. Le verrou « premier scan gagne » (UPDATE … WHERE entry_scanned
-- = false) était déjà atomique ; ce qui manquait tient dans la base :
--
-- 1. Qui a scanné : entry_scanned_by venait du téléphone (souvent NULL quand
--    l'appel réseau getUser() échouait, et falsifiable). Désormais la base
--    signe le scan d'un client connecté (auth.uid(), now()) et interdit de
--    « dé-scanner » une entrée.
--
-- 2. Billet de groupe : le QR du BILLET (email, Wallet) et les QR NOMINATIFS
--    (X-1…X-n) étaient deux lignes indépendantes. Scanner le billet laissait
--    passer ensuite chaque QR nominatif : un billet de 4 faisait entrer 8
--    personnes. Désormais un scan du billet entier consomme ses nominatifs, et
--    un scan nominatif marque le billet (comme le faisaient déjà le videur et
--    la synchro hors ligne, mais maintenant sur tous les chemins).
--
-- 3. Un videur (ou un promoteur, un barman) pouvait réécrire le statut, le
--    prix, l'acheteur d'un billet par PostgREST : même garde que
--    table_reservations.
--
-- 4. Notification « Arrivée VIP » : écrite par le téléphone du videur avec SON
--    club de profil (mauvais club s'il en a changé, aucune sur une soirée
--    d'organisateur), et une seconde fois par la synchro hors ligne. Un seul
--    émetteur désormais : le trigger, avec le club de la ZONE.
--
-- 5. Commission promoteur à la tête (guest list) : appel « fire and forget »
--    du téléphone, absent de la synchro hors ligne → promoteur non payé.
--    Désormais un trigger sur l'entrée (idempotent : index unique).
--
-- 6. sync_offline_scans : ne vérifiait pas qu'un billet était encore PAYÉ (un
--    billet remboursé pendant la coupure passait à la synchro).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Scan signé par la base, jamais annulé par un client ─────────────────
-- SECURITY INVOKER + current_user : un trigger de garde DEFINER se
-- désactiverait lui-même (cf. CLAUDE.md, cycle promoteur). Les chemins serveur
-- (edge en service_role, sync_offline_scans DEFINER) gardent leurs valeurs.
CREATE OR REPLACE FUNCTION public.stamp_door_entry_scan()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.entry_scanned, false) AND NOT COALESCE(NEW.entry_scanned, false) THEN
    RAISE EXCEPTION '%: entry_scanned cannot be reset', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(NEW.entry_scanned, false) AND NOT COALESCE(OLD.entry_scanned, false) THEN
    NEW.entry_scanned_by := auth.uid();
    NEW.entry_scanned_at := now();
  ELSIF COALESCE(OLD.entry_scanned, false) THEN
    -- Une entrée validée garde qui et quand, pour toujours.
    NEW.entry_scanned_by := OLD.entry_scanned_by;
    NEW.entry_scanned_at := OLD.entry_scanned_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_door_entry_scan ON public.tickets;
CREATE TRIGGER trg_stamp_door_entry_scan BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_door_entry_scan();
DROP TRIGGER IF EXISTS trg_stamp_door_entry_scan ON public.ticket_attendees;
CREATE TRIGGER trg_stamp_door_entry_scan BEFORE UPDATE ON public.ticket_attendees
  FOR EACH ROW EXECUTE FUNCTION public.stamp_door_entry_scan();
DROP TRIGGER IF EXISTS trg_stamp_door_entry_scan ON public.guest_list_entries;
CREATE TRIGGER trg_stamp_door_entry_scan BEFORE UPDATE ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_door_entry_scan();
DROP TRIGGER IF EXISTS trg_stamp_door_entry_scan ON public.table_reservations;
CREATE TRIGGER trg_stamp_door_entry_scan BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_door_entry_scan();

-- ─── 3. Billet : argent et identité intouchables côté client ────────────────
CREATE OR REPLACE FUNCTION public.protect_ticket_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.status                       IS DISTINCT FROM OLD.status
       OR NEW.total_price               IS DISTINCT FROM OLD.total_price
       OR NEW.unit_price                IS DISTINCT FROM OLD.unit_price
       OR NEW.service_fee               IS DISTINCT FROM OLD.service_fee
       OR NEW.quantity                  IS DISTINCT FROM OLD.quantity
       OR NEW.paid_at                   IS DISTINCT FROM OLD.paid_at
       OR NEW.stripe_session_id         IS DISTINCT FROM OLD.stripe_session_id
       OR NEW.stripe_payment_intent_id  IS DISTINCT FROM OLD.stripe_payment_intent_id
       OR NEW.stripe_connected_account_id IS DISTINCT FROM OLD.stripe_connected_account_id
       OR NEW.refund_amount             IS DISTINCT FROM OLD.refund_amount
       OR NEW.refund_reason             IS DISTINCT FROM OLD.refund_reason
       OR NEW.refunded_at               IS DISTINCT FROM OLD.refunded_at
       OR NEW.refunded_by               IS DISTINCT FROM OLD.refunded_by
       OR NEW.cancelled_at              IS DISTINCT FROM OLD.cancelled_at
       OR NEW.user_id                   IS DISTINCT FROM OLD.user_id
       OR NEW.user_email                IS DISTINCT FROM OLD.user_email
       OR NEW.event_id                  IS DISTINCT FROM OLD.event_id
       OR NEW.ticket_round_id           IS DISTINCT FROM OLD.ticket_round_id
       OR NEW.qr_code                   IS DISTINCT FROM OLD.qr_code
       OR NEW.reference_code            IS DISTINCT FROM OLD.reference_code
       OR NEW.has_insurance             IS DISTINCT FROM OLD.has_insurance
       OR NEW.insurance_fee             IS DISTINCT FROM OLD.insurance_fee
       OR NEW.fee_absorbed              IS DISTINCT FROM OLD.fee_absorbed
       OR NEW.promo_code_id             IS DISTINCT FROM OLD.promo_code_id
       OR NEW.promo_discount            IS DISTINCT FROM OLD.promo_discount
       OR NEW.tracked_link_id           IS DISTINCT FROM OLD.tracked_link_id
       OR NEW.purchase_source           IS DISTINCT FROM OLD.purchase_source
       OR NEW.collab_split              IS DISTINCT FROM OLD.collab_split
       OR NEW.is_guest                  IS DISTINCT FROM OLD.is_guest
       OR NEW.claimed_at                IS DISTINCT FROM OLD.claimed_at
       OR NEW.claimed_by_user_id        IS DISTINCT FROM OLD.claimed_by_user_id THEN
      RAISE EXCEPTION 'tickets: financial and identity fields are immutable for client roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_ticket_immutable_fields ON public.tickets;
CREATE TRIGGER trg_protect_ticket_immutable_fields BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.protect_ticket_immutable_fields();

-- ─── 2. Billet de groupe ↔ QR nominatifs ─────────────────────────────────────
-- Scan d'un QR nominatif → le billet est marqué (statistiques, et le QR du
-- billet entier ne fait plus entrer le groupe une deuxième fois).
CREATE OR REPLACE FUNCTION public.door_attendee_scan_marks_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.tickets
     SET entry_scanned = true,
         entry_scanned_at = COALESCE(NEW.entry_scanned_at, now()),
         entry_scanned_by = NEW.entry_scanned_by
   WHERE id = NEW.ticket_id
     AND COALESCE(entry_scanned, false) = false;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_door_attendee_scan_marks_ticket ON public.ticket_attendees;
CREATE TRIGGER trg_door_attendee_scan_marks_ticket
  AFTER UPDATE OF entry_scanned ON public.ticket_attendees
  FOR EACH ROW WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION public.door_attendee_scan_marks_ticket();

-- Scan du billet ENTIER (QR de l'email / du Wallet) alors qu'aucun nominatif
-- n'est encore passé → tout le groupe est entré : ses QR nominatifs sont
-- consommés. Si un nominatif est déjà passé, le billet n'est marqué que par
-- ricochet (trigger ci-dessus) : on ne touche pas aux autres.
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
     AND COALESCE(entry_scanned, false) = false;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_door_ticket_scan_consumes_attendees ON public.tickets;
CREATE TRIGGER trg_door_ticket_scan_consumes_attendees
  AFTER UPDATE OF entry_scanned ON public.tickets
  FOR EACH ROW WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION public.door_ticket_scan_consumes_attendees();

-- ─── 4. « Arrivée VIP » : un seul émetteur, le bon club ─────────────────────
CREATE OR REPLACE FUNCTION public.notify_vip_host_on_arrival()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_zone  text;
  v_pack  text;
BEGIN
  SELECT z.venue_id, z.name INTO v_venue, v_zone FROM public.table_zones z WHERE z.id = NEW.zone_id;
  IF v_venue IS NULL THEN
    SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_venue FROM public.events e WHERE e.id = NEW.event_id;
  END IF;
  IF v_venue IS NULL THEN
    RETURN NEW; -- soirée sans club : pas d'hôte VIP de club à prévenir
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_notifications
     WHERE reference_type = 'table_reservation' AND reference_id = NEW.id
       AND notification_type = 'vip_entry'
       AND created_at > now() - interval '6 hours'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT p.name INTO v_pack FROM public.table_packs p WHERE p.id = NEW.pack_id;

  INSERT INTO public.staff_notifications (
    venue_id, event_id, target_role, notification_type, title, message,
    reference_type, reference_id, priority, metadata
  ) VALUES (
    v_venue, NEW.event_id, 'vip_host', 'vip_entry',
    'Arrivée VIP',
    COALESCE(NEW.full_name, 'VIP') || ' (' || COALESCE(NEW.guest_count, 1) || ' pers.) est arrivé'
      || COALESCE(' - ' || v_zone, ''),
    'table_reservation', NEW.id, 'high',
    jsonb_build_object(
      'guest_name', NEW.full_name,
      'guest_count', COALESCE(NEW.guest_count, 1),
      'zone_name', v_zone,
      'pack_name', v_pack,
      'deposit', COALESCE(NEW.deposit, 0),
      'scanned_by', NEW.entry_scanned_by
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- une notification ne fait jamais échouer une entrée
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_vip_host_on_arrival ON public.table_reservations;
CREATE TRIGGER trg_notify_vip_host_on_arrival
  AFTER UPDATE OF entry_scanned ON public.table_reservations
  FOR EACH ROW WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned)
  EXECUTE FUNCTION public.notify_vip_host_on_arrival();

-- ─── 5. Commission du promoteur sur son invité, quel que soit le scanner ────
CREATE OR REPLACE FUNCTION public.record_guest_entry_promoter_conversion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event uuid;
BEGIN
  SELECT event_id INTO v_event FROM public.guest_lists WHERE id = NEW.guest_list_id;
  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;
  -- Idempotent : index unique sur guest_list_entry_id (ON CONFLICT DO NOTHING).
  PERFORM public.record_promoter_conversion(
    p_promoter_id := NEW.promoter_id,
    p_conversion_type := 'guestlist',
    p_amount := 0,
    p_event_id := v_event,
    p_guest_list_entry_id := NEW.id,
    p_scan_at := COALESCE(NEW.entry_scanned_at, now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- la porte avance même si la commission échoue
END;
$function$;

DROP TRIGGER IF EXISTS trg_record_guest_entry_promoter_conversion ON public.guest_list_entries;
CREATE TRIGGER trg_record_guest_entry_promoter_conversion
  AFTER UPDATE OF entry_scanned ON public.guest_list_entries
  FOR EACH ROW WHEN (NEW.entry_scanned AND OLD.entry_scanned IS DISTINCT FROM NEW.entry_scanned
                     AND NEW.promoter_id IS NOT NULL)
  EXECUTE FUNCTION public.record_guest_entry_promoter_conversion();

-- ─── 6. Synchro hors ligne : seulement ce qui est encore valable ────────────
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
         AND COALESCE(ta.entry_scanned, false) = false
      RETURNING ta.ticket_id INTO v_ticket_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        SELECT CASE WHEN ta.entry_scanned THEN COALESCE(ta.entry_scanned_at, now()) END,
               t.status IS DISTINCT FROM 'paid'
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
