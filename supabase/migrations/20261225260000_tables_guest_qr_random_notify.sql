-- Tables VIP, vague B bis (26/11/2026)
--  D12 / I2 : QR des invités d'une table ALÉATOIRES et indépendants de celui de la réservation (impossible de remonter
--             au QR de la table depuis celui d'un invité). La porte, le manifeste, la synchro hors ligne, get_table_guest_pass
--             et get_table_receipt lisent déjà table_reservation_guests.qr_code tel que stocké : rien d'autre à changer.
--  I3       : vip_set_table_placement rend `notify` ('table_changed' ou NULL), décidé par le serveur.
-- Les QR des invités existants des soirées à venir (non entrés, encore au format dérivé « <QR résa>-<n> ») sont régénérés.

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

  v_first := NOT EXISTS (SELECT 1 FROM table_reservation_guests WHERE reservation_id = r.id);

  -- QR d'un invité : aléatoire (80 bits), jamais dérivé du QR de la réservation. Il ne change plus une fois créé.
  INSERT INTO table_reservation_guests
    (reservation_id, guest_number, full_name, qr_code,
     entry_scanned, entry_scanned_at, entry_scanned_by, created_at)
  SELECT r.id, k, CASE WHEN k = 0 THEN v_holder END,
         'TG-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 20)),
         v_first AND COALESCE(r.entry_scanned, false),
         CASE WHEN v_first AND COALESCE(r.entry_scanned, false) THEN COALESCE(r.entry_scanned_at, now()) END,
         CASE WHEN v_first AND COALESCE(r.entry_scanned, false) THEN r.entry_scanned_by END,
         now() + make_interval(secs => k / 1000.0)
    FROM generate_series(0, v_n - 1) AS k
  ON CONFLICT (reservation_id, guest_number) DO NOTHING;

  UPDATE table_reservation_guests g
     SET full_name = v_holder
   WHERE g.reservation_id = r.id AND NOT g.entry_scanned
     AND g.guest_number = 0 AND g.full_name IS DISTINCT FROM v_holder;
END;
$$;
REVOKE ALL ON FUNCTION public._table_guests_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._table_guests_sync(uuid) TO service_role;

-- Rattrapage : soirées à venir (ou finies depuis moins de 6 h), invités non entrés, QR encore au format dérivé.
UPDATE public.table_reservation_guests g
   SET qr_code = 'TG-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 20))
  FROM public.table_reservations r
  JOIN public.events e ON e.id = r.event_id
 WHERE g.reservation_id = r.id
   AND NOT g.entry_scanned
   AND g.qr_code = r.qr_code || '-' || (g.guest_number + 1)
   AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now() - interval '6 hours';

CREATE OR REPLACE FUNCTION public.vip_set_table_placement(
  p_reservation_id uuid,
  p_action text,
  p_table_id text DEFAULT NULL,
  p_adjustment text DEFAULT NULL,
  p_adjustment_amount numeric DEFAULT NULL,
  p_expected_placement_status text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.table_reservations%ROWTYPE;
  v_club text;
  v_layout jsonb;
  v_table jsonb;
  v_tid uuid;
  v_bound uuid;
  v_pack_event uuid;
  v_pack_venue text;
  v_needs_adjustment boolean := false;
  v_adj text;
  v_amt numeric;
  v_status text;
  v_notify text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('assign', 'on_arrival') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._can_manage_table_reservation(v_uid, r.event_id, r.zone_id, true) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'assign' THEN
    IF p_table_id IS NULL OR btrim(p_table_id) = '' THEN
      RAISE EXCEPTION 'table_required' USING ERRCODE = '22023';
    END IF;
    IF p_table_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'table_unknown' USING ERRCODE = 'YU009';
    END IF;
    v_tid := p_table_id::uuid;
    -- Même verrou que reserve_table_slot et enforce_assigned_table_exists : deux collègues sur la même table passent l'un après l'autre.
    PERFORM pg_advisory_xact_lock(hashtextextended(r.event_id::text || ':' || v_tid::text, 0));
  END IF;

  -- Relecture sous verrou de ligne : l'état jugé est celui que personne ne change plus.
  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF r.status NOT IN ('paid', 'confirmed')
     OR COALESCE(r.vip_status, 'waiting') IN ('finished', 'no_show', 'denied') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU008';
  END IF;
  IF p_expected_placement_status IS NOT NULL
     AND COALESCE(r.placement_status, 'none') IS DISTINCT FROM p_expected_placement_status THEN
    RAISE EXCEPTION 'placement_changed' USING ERRCODE = 'YU004';
  END IF;

  IF p_action = 'on_arrival' THEN
    IF COALESCE(r.vip_status, 'waiting') IN ('placed', 'active') THEN
      RAISE EXCEPTION 'already_seated' USING ERRCODE = 'YU008';
    END IF;
    -- I3 : le client est prévenu s'il avait une demande ou une table, et si ce n'était pas déjà « à l'arrivée ».
    v_notify := CASE WHEN (r.requested_table_id IS NOT NULL OR r.assigned_table_id IS NOT NULL)
                       AND COALESCE(r.placement_status, 'none') IS DISTINCT FROM 'assign_on_arrival'
                     THEN 'table_changed' END;
    UPDATE public.table_reservations
       SET assigned_table_id = NULL,
           placement_status = 'assign_on_arrival',
           placement_reviewed_by = v_uid,
           placement_reviewed_at = now(),
           placement_adjustment = NULL,
           placement_adjustment_amount = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed_table', (r.assigned_table_id IS NOT NULL),
      'previous_table', r.assigned_table_id,
      'requested_table', r.requested_table_id,
      'new_table', NULL,
      'placement_status', 'assign_on_arrival',
      'placement_adjustment', NULL,
      'placement_adjustment_amount', NULL,
      'notify', v_notify
    );
  END IF;

  -- ── assign ───────────────────────────────────────────────────────────────
  -- 1) La table doit exister sur le plan de CETTE soirée (plan de la soirée, sinon celui du club).
  SELECT COALESCE(venue_id, partner_venue_id) INTO v_club FROM public.events WHERE id = r.event_id;
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = r.event_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_layout IS NULL AND v_club IS NOT NULL THEN
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_club AND event_id IS NULL
     ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_layout IS NOT NULL THEN
    SELECT t INTO v_table FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE t->>'id' = v_tid::text LIMIT 1;
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'table_unknown' USING ERRCODE = 'YU009';
  END IF;

  -- 2) La table doit être libre : un autre client installé, pré-placé, ou une demande de table encore vivante
  --    (même règle que create_manual_table_reservation, avec le seuil de 31 min des réservations en attente).
  IF EXISTS (
    SELECT 1 FROM public.table_reservations o
     WHERE o.event_id = r.event_id
       AND o.id <> r.id
       AND public._table_resa_holds(o.status, o.created_at)
       AND (
         (o.assigned_table_id = v_tid AND COALESCE(o.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
         OR (o.requested_table_id = v_tid AND o.assigned_table_id IS NULL
             AND o.placement_status IN ('requested', 'approved') AND COALESCE(o.vip_status, 'waiting') = 'waiting')
       )
  ) THEN
    RAISE EXCEPTION 'table_taken' USING ERRCODE = 'YU007';
  END IF;

  -- 3) Table liée (plan) à une AUTRE formule : surclassement offert ou différence à régler sur place, au choix du pro.
  --    La liaison ne s'applique que si la formule liée vit dans le MÊME périmètre que celle de la réservation
  --    (comme reserve_table_slot) ; une réservation sans formule (ajout manuel) n'a rien à comparer.
  IF r.pack_id IS NOT NULL
     AND NULLIF(v_table->>'packId', '') IS NOT NULL
     AND (v_table->>'packId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND (v_table->>'packId')::uuid <> r.pack_id THEN
    SELECT event_id, venue_id INTO v_pack_event, v_pack_venue FROM public.table_packs WHERE id = r.pack_id;
    SELECT p.id INTO v_bound FROM public.table_packs p
     WHERE p.id = (v_table->>'packId')::uuid
       AND p.event_id IS NOT DISTINCT FROM v_pack_event
       AND p.venue_id IS NOT DISTINCT FROM v_pack_venue;
    v_needs_adjustment := v_bound IS NOT NULL;
  END IF;

  IF v_needs_adjustment THEN
    IF p_adjustment IS NULL AND r.assigned_table_id = v_tid AND r.placement_adjustment IS NOT NULL THEN
      -- Même table qu'avant : le choix déjà fait reste (un écran qui renvoie la table sans le rappeler).
      v_adj := r.placement_adjustment;
      v_amt := r.placement_adjustment_amount;
    ELSE
      IF p_adjustment IS NULL THEN
        RAISE EXCEPTION 'formula_change_requires_adjustment' USING ERRCODE = 'YU005';
      END IF;
      IF p_adjustment NOT IN ('upgrade_free', 'pay_on_site') THEN
        RAISE EXCEPTION 'invalid_adjustment' USING ERRCODE = '22023';
      END IF;
      IF p_adjustment = 'pay_on_site' AND (p_adjustment_amount IS NULL OR p_adjustment_amount < 0) THEN
        RAISE EXCEPTION 'invalid_adjustment_amount' USING ERRCODE = '22023';
      END IF;
      IF p_adjustment = 'upgrade_free' AND p_adjustment_amount IS NOT NULL AND p_adjustment_amount < 0 THEN
        RAISE EXCEPTION 'invalid_adjustment_amount' USING ERRCODE = '22023';
      END IF;
      v_adj := p_adjustment;
      v_amt := round(p_adjustment_amount, 2);
    END IF;
  ELSE
    -- Même formule (ou table sans formule liée) : aucun ajustement ; un ancien choix est remis à zéro.
    v_adj := NULL;
    v_amt := NULL;
  END IF;

  v_status := CASE WHEN r.requested_table_id IS NULL OR r.requested_table_id = v_tid THEN 'approved' ELSE 'modified' END;

  -- I3 : le client est prévenu quand la table qu'il croit avoir change : table déjà attribuée qui bouge, ou, sans table
  --      attribuée, table finale différente de celle qu'il avait demandée. Même table qu'avant = rien à dire.
  v_notify := CASE WHEN r.assigned_table_id IS NOT NULL THEN
                     CASE WHEN v_tid <> r.assigned_table_id THEN 'table_changed' END
                   WHEN r.requested_table_id IS NOT NULL AND v_tid <> r.requested_table_id THEN 'table_changed'
              END;

  UPDATE public.table_reservations
     SET assigned_table_id = v_tid,
         placement_status = v_status,
         placement_reviewed_by = v_uid,
         placement_reviewed_at = now(),
         placement_adjustment = v_adj,
         placement_adjustment_amount = v_amt
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true,
    'changed_table', (r.assigned_table_id IS DISTINCT FROM v_tid),
    'previous_table', r.assigned_table_id,
    'requested_table', r.requested_table_id,
    'new_table', v_tid,
    'placement_status', v_status,
    'placement_adjustment', v_adj,
    'placement_adjustment_amount', v_amt,
    'notify', v_notify
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.vip_set_table_placement(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vip_set_table_placement(uuid, text, text, text, numeric, text) TO authenticated, service_role;
