-- Tables VIP, vague A bis — I1 : la table ne se libère jamais AVANT que la session Stripe ne puisse plus être payée,
-- et un paiement qui arrive quand même sur une table déjà vendue ne tombe jamais.
--
-- Constat (relecture, I1) : `created_at` de la réservation est posé AVANT l'écriture du compte connecté et l'appel Stripe, et la
-- garde de la place coupait à 31 min pour une session créée avec expires_at = +31 min : la session expirait APRÈS que la base
-- avait cessé de compter la pending (3-D Secure qui traîne, seconde tentative « carte seule »). Un second client réservait la même
-- table / la dernière place de la zone, puis le paiement du premier aboutissait : deux tables payées pour une.
--
-- Règle posée : la session Stripe dure 30 min + 20 s (create-table-checkout, expires_at), la place est gardée 35 min depuis la
-- création de la réservation — UNE seule valeur, `_table_resa_holds`, lue par reserve_table_slot, get_event_table_availability,
-- prevent_floor_plan_table_removal (qui écrivait 31 min en dur) et create_manual_table_reservation (qui comptait toute pending,
-- sans âge : M5 de la relecture). Le nettoyage des pending (45 min côté edge) et checkout.session.expired (libération tout de suite)
-- restent derrière.
--
-- Et au passage à `paid` (verify-table-payment) : table_resolve_paid_conflict. Si la table demandée / attribuée est tenue par une
-- AUTRE réservation déjà payée (premier payé = premier servi, départage paid_at puis id), la vente ne tombe JAMAIS (l'argent est
-- pris) : la réservation passe en placement à l'arrivée (table demandée et attribuée retirées, placement_status 'assign_on_arrival')
-- et la fonction rend de quoi prévenir le pro et le super admin. Un dépassement du plafond de zone est rendu aussi (jamais corrigé
-- en silence). Même verrou consultatif que reserve_table_slot et vip_set_table_placement (événement:table).

CREATE OR REPLACE FUNCTION public._table_resa_holds(p_status text, p_created_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p_status IN ('paid', 'confirmed')
      OR (p_status = 'pending' AND p_created_at > now() - interval '35 minutes');
$function$;
REVOKE ALL ON FUNCTION public._table_resa_holds(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._table_resa_holds(text, timestamptz) TO service_role;

-- Garde « table vendue » : la même règle de rétention que la vente (35 min), plus un seuil écrit en dur.
CREATE OR REPLACE FUNCTION public.prevent_floor_plan_table_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_removed text[];
  v_sold    text;
BEGIN
  SELECT array_agg(old_id) INTO v_removed
  FROM (
    SELECT e->>'id' AS old_id
    FROM jsonb_array_elements(COALESCE(OLD.layout->'tables', '[]'::jsonb)) AS e
    EXCEPT
    SELECT e->>'id'
    FROM jsonb_array_elements(COALESCE(NEW.layout->'tables', '[]'::jsonb)) AS e
  ) sub;

  IF v_removed IS NULL OR array_length(v_removed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- P3.2 : une table vendue (réservation active, soirée pas terminée) ne quitte pas le plan.
  SELECT x.tid INTO v_sold
  FROM (
    SELECT t.tid
      FROM unnest(v_removed) AS t(tid)
     WHERE EXISTS (
       SELECT 1
         FROM public.table_reservations tr
         JOIN public.events e ON e.id = tr.event_id
        WHERE (
                (NEW.event_id IS NOT NULL AND tr.event_id = NEW.event_id)
                OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL
                    AND (e.venue_id = NEW.venue_id OR e.partner_venue_id = NEW.venue_id)
                    AND NOT EXISTS (SELECT 1 FROM public.venue_floor_plans f2 WHERE f2.event_id = e.id))
              )
          AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()
          AND public._table_resa_holds(tr.status, tr.created_at)
          AND (
                tr.assigned_table_id::text = t.tid
                OR (tr.requested_table_id::text = t.tid AND tr.placement_status IN ('requested', 'approved'))
              )
     )
     ORDER BY t.tid
     LIMIT 1
  ) x;

  IF v_sold IS NOT NULL THEN
    RAISE EXCEPTION 'table_has_reservation:%', v_sold
      USING ERRCODE = 'YU003';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    LEFT JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE (
        (NEW.event_id IS NOT NULL AND tr.event_id = NEW.event_id)
        OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL AND tz.venue_id = NEW.venue_id)
      )
      AND tr.assigned_table_id::text = ANY(v_removed)
      AND tr.vip_status IN ('placed', 'active')
      AND tr.status NOT IN ('cancelled', 'refunded')
      -- Une soirée terminée garde ses clients « installés » à jamais : elle ne retient plus rien.
      AND EXISTS (SELECT 1 FROM public.events e2 WHERE e2.id = tr.event_id
                   AND COALESCE(e2.end_at, e2.start_at + interval '8 hours') > now())
  ) THEN
    RAISE EXCEPTION
      'Cannot remove a table that currently has a seated VIP reservation. Finish service or reassign those tables first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_floor_plan_table_removal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevent_floor_plan_table_removal() TO authenticated, service_role;

-- ── Ajout manuel / walk-in : la même règle de rétention que la vente (M5) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(p_event_id uuid, p_zone_id uuid, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_guest_count integer DEFAULT 1, p_total_price numeric DEFAULT 0, p_minimum_spend numeric DEFAULT 0, p_assigned_table_id uuid DEFAULT NULL::uuid, p_remarks text DEFAULT NULL::text, p_open_tab boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_zone_event uuid;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_email      text := COALESCE(NULLIF(btrim(p_email), ''), '');
  v_org        uuid;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT venue_id, event_id, tables_count, name
    INTO v_venue, v_zone_event, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL AND v_zone_event IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_venue IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = p_event_id
         AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
    ) THEN
      RAISE EXCEPTION 'event not in venue' USING ERRCODE = '22023';
    END IF;

    IF NOT (
      public.is_venue_owner(v_uid, v_venue)
      OR public.manager_has_permission(v_uid, v_venue, 'tables')
      OR COALESCE(public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'), false)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Zone d'une soirée sans club : elle doit appartenir À CETTE soirée, et
    -- l'appelant en être l'organisateur (ou de son équipe).
    IF v_zone_event <> p_event_id THEN
      RAISE EXCEPTION 'zone not in event' USING ERRCODE = '22023';
    END IF;
    SELECT organizer_user_id INTO v_org FROM public.events WHERE id = p_event_id;
    IF NOT (
      public.can_manage_organizer_rooms(v_uid, v_org)
      OR public.is_event_partner_organizer(v_uid, p_event_id)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Capacité de la zone : une résa terminée, no-show ou refusée a rendu sa
  -- table — le club la refait tourner dans la nuit.
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND public._table_resa_holds(status, created_at)
       AND COALESCE(vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));
    -- Tient la table : un groupe installé, un client pré-placé qui n'est pas
    -- encore arrivé, une demande de table en attente de réponse.
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND public._table_resa_holds(r.status, r.created_at)
         AND (
           (r.assigned_table_id = p_assigned_table_id
             AND COALESCE(r.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
           OR (r.requested_table_id = p_assigned_table_id
             AND r.assigned_table_id IS NULL
             AND r.placement_status = 'requested'
             AND COALESCE(r.vip_status, 'waiting') = 'waiting')
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source, newsletter_opt_in
  ) VALUES (
    p_event_id, p_zone_id, NULL, v_email, true, GREATEST(COALESCE(p_guest_count, 1), 1),
    0,
    CASE WHEN p_open_tab THEN 0 ELSE GREATEST(COALESCE(p_total_price, 0), 0) END,
    0, 0, false,
    GREATEST(COALESCE(p_minimum_spend, 0), 0), 'paid', now(),
    NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''), p_remarks,
    p_assigned_table_id,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN 'approved' ELSE 'none' END,
    'active',
    CASE WHEN p_open_tab THEN 'manual_open' ELSE 'manual' END,
    (v_email <> '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean) TO authenticated, service_role;

-- ── Passage à payé sur une table déjà vendue ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.table_resolve_paid_conflict(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_table text;
  v_other uuid;
  v_tables text[] := '{}';
  v_others uuid[] := '{}';
  v_clear_req boolean := false;
  v_clear_asg boolean := false;
  v_max integer;
  v_zone_name text;
  v_used integer;
BEGIN
  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('conflict', false, 'zone_overflow', false, 'reason', 'not_found');
  END IF;
  IF r.status NOT IN ('paid', 'confirmed') THEN
    RETURN jsonb_build_object('conflict', false, 'zone_overflow', false, 'reason', 'not_paid');
  END IF;

  FOR v_table IN
    SELECT t FROM (SELECT DISTINCT unnest(ARRAY[r.assigned_table_id::text, r.requested_table_id::text]) AS t) x
     WHERE t IS NOT NULL ORDER BY t
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.event_id::text || ':' || v_table, 0));
    -- Tenue par une AUTRE réservation déjà payée avant celle-ci (paid_at, puis id) : premier payé = premier servi.
    -- Une pending ne compte pas : elle ne tient la table qu'en attendant son propre paiement, et s'y heurtera à son tour.
    SELECT o.id INTO v_other
      FROM public.table_reservations o
     WHERE o.event_id = r.event_id
       AND o.id <> r.id
       AND o.status IN ('paid', 'confirmed')
       AND COALESCE(o.vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied')
       AND (o.assigned_table_id::text = v_table
            OR (o.requested_table_id::text = v_table AND o.assigned_table_id IS NULL AND o.placement_status IN ('requested', 'approved')))
       AND (COALESCE(o.paid_at, '-infinity'::timestamptz) < COALESCE(r.paid_at, 'infinity'::timestamptz)
            OR (o.paid_at IS NOT DISTINCT FROM r.paid_at AND o.id < r.id))
     ORDER BY o.paid_at NULLS FIRST, o.id
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      v_tables := v_tables || v_table;
      v_others := v_others || v_other;
      IF r.requested_table_id::text = v_table THEN v_clear_req := true; END IF;
      IF r.assigned_table_id::text = v_table THEN v_clear_asg := true; END IF;
    END IF;
  END LOOP;

  IF array_length(v_tables, 1) IS NOT NULL THEN
    UPDATE public.table_reservations
       SET requested_table_id = CASE WHEN v_clear_req THEN NULL ELSE requested_table_id END,
           assigned_table_id  = CASE WHEN v_clear_asg THEN NULL ELSE assigned_table_id END,
           placed_by          = CASE WHEN v_clear_asg THEN NULL ELSE placed_by END,
           placed_at          = CASE WHEN v_clear_asg THEN NULL ELSE placed_at END,
           placement_status   = 'assign_on_arrival',
           placement_adjustment = NULL,
           placement_adjustment_amount = NULL
     WHERE id = r.id;
  END IF;

  -- Plafond de la zone : jamais corrigé en silence (l'argent est pris) mais rendu, pour que le pro et Yuno le voient.
  IF r.zone_id IS NOT NULL THEN
    SELECT tables_count, name INTO v_max, v_zone_name FROM public.table_zones WHERE id = r.zone_id;
    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT count(*) INTO v_used FROM public.table_reservations
       WHERE event_id = r.event_id AND zone_id = r.zone_id AND public._table_resa_holds(status, created_at)
         AND COALESCE(vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'conflict', array_length(v_tables, 1) IS NOT NULL,
    'tables', to_jsonb(v_tables),
    'held_by', to_jsonb(v_others),
    'zone_overflow', v_max IS NOT NULL AND v_max > 0 AND COALESCE(v_used, 0) > v_max,
    'zone_name', v_zone_name,
    'zone_used', v_used,
    'zone_max', v_max
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.table_resolve_paid_conflict(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_resolve_paid_conflict(uuid) TO service_role;
