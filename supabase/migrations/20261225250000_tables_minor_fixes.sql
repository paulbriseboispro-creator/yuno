-- Tables VIP, vague A bis — mineurs de la relecture corrigeables sans décision produit : M4, M6, M7.
--
-- M4 : supprimer le plan d'une SOIRÉE (policy « Event-scoped floor plans… » FOR ALL) contournait la garde « table vendue » : la
--      soirée retombait sur le plan du club et les assigned_table_id / requested_table_id ne pointaient plus sur rien. Un
--      DELETE d'un compte connecté est refusé (YU003 table_has_reservation:<id>) tant qu'une réservation active d'une soirée pas
--      terminée tient une table de ce plan ; les cascades (suppression d'une soirée, d'un club — pg_trigger_depth() > 1) et le
--      super admin passent. SECURITY DEFINER (il lit les réservations que le pro ne voit pas toutes) mais jugé sur le rôle de la
--      REQUÊTE (auth.role()), jamais sur current_user (toujours le propriétaire dans une fonction DEFINER).
-- M6 : cancel_unpaid_table_reservation annulait un client déjà entré / installé : refusé (YU008 already_seated) ; un ajout manuel
--      (walk-in, installé par définition) reste annulable.
-- M7 : get_table_receipt rendait l'adresse d'une soirée SECRÈTE que l'organisateur ne dévoile pas par e-mail : même règle que
--      send-vip-confirmation (adresse masquée, `address_deferred` = true). Ajoute aussi `charged_total` (ce que la session Stripe a
--      prélevé), pour que le reçu n'ait plus à le recalculer.

CREATE OR REPLACE FUNCTION public.prevent_event_floor_plan_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sold text;
BEGIN
  -- Cascade (suppression d'une soirée, d'un club) : jamais bloquée. Super admin : décide en connaissance de cause.
  IF pg_trigger_depth() > 1 OR COALESCE(auth.role(), '') <> 'authenticated' OR public.is_super_admin() THEN
    RETURN OLD;
  END IF;
  SELECT t->>'id' INTO v_sold
    FROM jsonb_array_elements(COALESCE(OLD.layout->'tables', '[]'::jsonb)) t
   WHERE EXISTS (
     SELECT 1 FROM public.table_reservations tr
       JOIN public.events e ON e.id = tr.event_id
      WHERE tr.event_id = OLD.event_id
        AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()
        AND public._table_resa_holds(tr.status, tr.created_at)
        AND (tr.assigned_table_id::text = t->>'id'
             OR (tr.requested_table_id::text = t->>'id' AND tr.placement_status IN ('requested', 'approved')))
   )
   ORDER BY t->>'id' LIMIT 1;
  IF v_sold IS NOT NULL THEN
    RAISE EXCEPTION 'table_has_reservation:%', v_sold USING ERRCODE = 'YU003';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_event_floor_plan_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevent_event_floor_plan_delete() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_prevent_event_floor_plan_delete ON public.venue_floor_plans;
CREATE TRIGGER trg_prevent_event_floor_plan_delete
  BEFORE DELETE ON public.venue_floor_plans
  FOR EACH ROW
  WHEN (old.event_id IS NOT NULL)
  EXECUTE FUNCTION public.prevent_event_floor_plan_delete();

CREATE OR REPLACE FUNCTION public.cancel_unpaid_table_reservation(p_reservation_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.table_reservations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._can_manage_table_reservation(v_uid, r.event_id, r.zone_id, false) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF r.stripe_payment_intent_id IS NOT NULL OR r.stripe_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'use_refund' USING ERRCODE = 'YU006';
  END IF;
  IF r.status NOT IN ('paid', 'confirmed') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU008';
  END IF;
  -- Un groupe déjà entré ou installé (hors ajout manuel, installé par définition) ne perd pas sa table sous lui : ni ici ni
  -- sans le dire. Rembourser un client déjà entré reste un choix du pro, par le remboursement, que l'écran doit signaler.
  IF r.entry_scanned = true
     OR (COALESCE(r.vip_status, 'waiting') IN ('placed', 'active') AND COALESCE(r.purchase_source, '') NOT LIKE 'manual%') THEN
    RAISE EXCEPTION 'already_seated' USING ERRCODE = 'YU008';
  END IF;

  UPDATE public.table_reservations
     SET status = 'cancelled',
         refund_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 200), ''),
         assigned_table_id = NULL,
         placement_status = 'none',
         placement_adjustment = NULL,
         placement_adjustment_amount = NULL
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', r.id,
    'previous_status', r.status,
    'released_table', r.assigned_table_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_unpaid_table_reservation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_table_reservation(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_table_receipt(p_reservation_id uuid, p_qr text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      public.table_reservations%ROWTYPE;
  ev     public.events%ROWTYPE;
  v_club text;
  v_venue jsonb;
  v_pack  jsonb;
  v_zone  jsonb;
  v_layout jsonb;
  v_req_name text;
  v_asg_name text;
  v_guests jsonb;
  -- Adresse secrète que l'organisateur ne dévoile pas par e-mail (même règle que send-vip-confirmation) : jamais rendue ici.
  v_hide boolean;
BEGIN
  IF p_reservation_id IS NULL OR p_qr IS NULL OR btrim(p_qr) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id AND qr_code = p_qr;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO ev FROM public.events WHERE id = r.event_id;
  v_club := COALESCE(ev.venue_id, ev.partner_venue_id);
  v_hide := COALESCE(ev.location_is_secret, false) AND ev.reveal_address_in_email IS NOT DISTINCT FROM false;

  IF v_club IS NOT NULL THEN
    SELECT jsonb_build_object('id', v.id, 'name', v.name, 'city', v.city, 'address', CASE WHEN v_hide THEN NULL ELSE v.address END)
      INTO v_venue FROM public.venues v WHERE v.id = v_club;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'name', p.name) INTO v_pack FROM public.table_packs p WHERE p.id = r.pack_id;
  SELECT jsonb_build_object('id', z.id, 'name', z.name) INTO v_zone FROM public.table_zones z WHERE z.id = r.zone_id;

  -- Nom des tables : plan de la soirée d'abord, plan du club ensuite (même résolution que le placement et la page publique).
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = r.event_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_layout IS NULL AND v_club IS NOT NULL THEN
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_club AND event_id IS NULL
     ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_layout IS NOT NULL THEN
    SELECT t->>'name' INTO v_req_name FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE r.requested_table_id IS NOT NULL AND t->>'id' = r.requested_table_id::text LIMIT 1;
    SELECT t->>'name' INTO v_asg_name FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE r.assigned_table_id IS NOT NULL AND t->>'id' = r.assigned_table_id::text LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'guest_number', g.guest_number,
           'full_name', g.full_name,
           'qr_code', g.qr_code,
           'entry_scanned', COALESCE(g.entry_scanned, false)
         ) ORDER BY g.guest_number), '[]'::jsonb)
    INTO v_guests
    FROM public.table_reservation_guests g WHERE g.reservation_id = r.id;

  RETURN jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'payment_mode', r.payment_mode,
    'paid_at', r.paid_at,
    'qr_code', r.qr_code,
    'reference_code', r.reference_code,
    'scannable', (r.status = 'paid'),
    'event', jsonb_build_object(
      'id', ev.id, 'title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at, 'timezone', ev.timezone,
      'poster_url', ev.poster_url, 'slug', ev.slug,
      'location_name', CASE WHEN v_hide THEN NULL ELSE ev.location_name END,
      'location_address', CASE WHEN v_hide THEN NULL ELSE ev.location_address END,
      'location_city', ev.location_city,
      'address_deferred', v_hide,
      'location_is_secret', COALESCE(ev.location_is_secret, false)
    ),
    'venue', v_venue,
    'pack', v_pack,
    'zone', v_zone,
    'requested_table_id', r.requested_table_id,
    'requested_table_name', v_req_name,
    'assigned_table_id', r.assigned_table_id,
    'assigned_table_name', v_asg_name,
    'placement_status', r.placement_status,
    'placement_adjustment', r.placement_adjustment,
    'placement_adjustment_amount', r.placement_adjustment_amount,
    'guest_count', r.guest_count,
    'total_price', r.total_price,
    'deposit', r.deposit,
    'service_fee', r.service_fee,
    'management_fee', r.management_fee,
    -- Ce que la session Stripe a prélevé (acompte + ligne de frais), posé au checkout : le reçu n'a plus à le recalculer.
    'charged_total', r.charged_total,
    'fee_absorbed', COALESCE(r.fee_absorbed, false),
    'minimum_spend', r.minimum_spend,
    'remaining_on_site', GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.deposit, 0), 0),
    'holder', jsonb_build_object('full_name', r.full_name, 'email', r.user_email),
    'guests', v_guests
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_table_receipt(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_table_receipt(uuid, text) TO anon, authenticated, service_role;
