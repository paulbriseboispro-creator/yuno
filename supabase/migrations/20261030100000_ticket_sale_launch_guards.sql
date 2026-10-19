-- Garde-fous avant la première soirée payante (House Of Masquerade, Amoris).
--
-- 1. Les réservations de places ne s'appellent QUE depuis les fonctions de
--    checkout (service_role). Exécutables par tout compte connecté, elles
--    laissaient n'importe qui geler un tarif (quantité et durée de blocage au
--    choix de l'appelant) : le premier billet d'une chaîne ne se vendait plus
--    et le suivant ne s'ouvrait jamais.
-- 2. Un billet (ticket_rounds) ou une soirée qui a des ventes ne se supprime
--    plus depuis la Console : la clé étrangère emportait en cascade les billets
--    payés et leurs QR, l'argent restant chez Stripe sans aucun billet. Les
--    chemins serveur (suppression de compte, purge d'un club, crons) passent :
--    la garde ne vise que les rôles client de l'API. On marque « Complet » ou on
--    désactive à la place.
-- 3. Le manifeste hors ligne de la porte porte l'heure limite d'entrée du tarif
--    (« Before 1 AM ») et l'heure limite de la boisson offerte : sans réseau, un
--    billet d'avant 01:00 passait en vert à 03:00.

-- 1. ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('reserve_ticket_capacity', 'reserve_table_slot')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- 2. ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_ticket_round_delete_with_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- auth.role() vaut 'service_role' pour les fonctions serveur et NULL pour
  -- un cron : seuls les rôles client de l'API sont arrêtés.
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND NOT COALESCE(public.is_super_admin(), false)
     AND EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.ticket_round_id = OLD.id
          AND t.status IN ('paid', 'refunded', 'pending')
     )
  THEN
    RAISE EXCEPTION 'ticket_round_has_sales'
      USING ERRCODE = 'P0001',
            HINT = 'Ce billet a des ventes : le marquer « Complet » au lieu de le supprimer.';
  END IF;
  RETURN OLD;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.guard_ticket_round_delete_with_sales() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ticket_round_delete_with_sales ON public.ticket_rounds;
CREATE TRIGGER trg_guard_ticket_round_delete_with_sales
  BEFORE DELETE ON public.ticket_rounds
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_round_delete_with_sales();

CREATE OR REPLACE FUNCTION public.guard_event_delete_with_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND NOT COALESCE(public.is_super_admin(), false)
     AND (
       EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.event_id = OLD.id AND t.status IN ('paid', 'refunded', 'pending')
       )
       OR EXISTS (
         SELECT 1 FROM public.table_reservations r
          WHERE r.event_id = OLD.id AND r.status IN ('paid', 'confirmed', 'refunded')
       )
     )
  THEN
    RAISE EXCEPTION 'event_has_sales'
      USING ERRCODE = 'P0001',
            HINT = 'Cette soirée a des ventes : la désactiver, ou l''annuler avec remboursement.';
  END IF;
  RETURN OLD;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.guard_event_delete_with_sales() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_event_delete_with_sales ON public.events;
CREATE TRIGGER trg_guard_event_delete_with_sales
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_delete_with_sales();

-- 3. ─────────────────────────────────────────────────────────────────────────
-- Définition reprise de la base liée (pg_get_functiondef), deux champs ajoutés
-- aux billets et aux participants : 'deadline' et 'drink_cutoff'.
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
        'ticket_id', t.id, 'status', t.status, 'qty', t.quantity,
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
        'qty', t.quantity, 'round', tr.name, 'drink', tr.includes_drink,
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
